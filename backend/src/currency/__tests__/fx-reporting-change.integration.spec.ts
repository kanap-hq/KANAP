import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { Tenant } from '../../tenants/tenant.entity';
import { CurrencyController } from '../currency.controller';
import { CurrencyRateSet } from '../currency-rate-set.entity';
import { CurrencySettingsService } from '../currency-settings.service';
import { FxIngestionService } from '../fx-ingestion.service';
import { FxRateService } from '../fx-rate.service';
import { ManualRatesService } from '../manual-rates.service';
import { EventEmitter } from 'node:events';

import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';

// Saving a new reporting currency queues every year in use for that base, to
// start once the save has committed; the forced sync with those years waits for
// it. The World Bank client is a stub. The seed is committed first: the fetch uses
// its own connection and must see the versions, the company year and the contract.
// @database-spec: opens the data-source. Run it on a dedicated database, never appdb.

const QUOTES: Record<string, number> = { EUR: 0.92, CHF: 0.88, GBP: 0.78, SEK: 10.4 };
const SPOT: Record<string, number> = { EUR: 0.93, CHF: 0.9, GBP: 0.79, SEK: 10.6 };

function worldBank() {
  return {
    resolveCode: (currency: string) => {
      const codes: Record<string, string> = { EUR: 'EMU', CHF: 'CHE', USD: 'USA', GBP: 'GBR', SEK: 'SWE' };
      return codes[currency.toUpperCase()] ?? null;
    },
    fetchAnnualRates: async (currency: string, start: number, end: number) => {
      const map = new Map<number, number>();
      const value = QUOTES[currency.toUpperCase()];
      if (value == null) return map;
      for (let year = start; year <= end; year += 1) map.set(year, value);
      return map;
    },
    fetchSpotRate: async (currency: string) => SPOT[currency.toUpperCase()] ?? null,
  };
}

async function sweepLeftovers() {
  const leftovers = await dataSource.query(`SELECT id FROM tenants WHERE slug LIKE 'races-fx-reporting-%'`);
  for (const row of leftovers as Array<{ id: string }>) await dropRaceTenant(row.id);
}

async function main() {
  await dataSource.initialize();
  const [{ current }] = await dataSource.query(`SELECT current_database() AS current`);
  assert.notEqual(current, 'appdb', 'this spec must not write the dev database');
  await sweepLeftovers();
  const tenantId = await createRaceTenant('fx-reporting');
  const currentYear = new Date().getFullYear();
  try {
    await seed(tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO currencies (code, name)
         VALUES ('EUR', 'Euro'), ('USD', 'US dollar'), ('GBP', 'Pound'), ('SEK', 'Krona'), ('CHF', 'Swiss franc')
         ON CONFLICT (code) DO NOTHING`,
      );
      const [pinned] = await tx.query(
        `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates, rate_sources, source, rate_basis)
         VALUES ($1, 2024, 'EUR', $2::jsonb, $3::jsonb, 'manual', 'manual') RETURNING id`,
        [tenantId, JSON.stringify({ EUR: 1, USD: 1.7 }), JSON.stringify({ EUR: 'identity', USD: 'manual' })],
      );
      const [item] = await tx.query(
        `INSERT INTO spend_items (tenant_id, nature, product_name, currency, effective_start, item_number)
         VALUES ($1, 'opex', 'Dollar line', 'USD', '2024-01-01', 1) RETURNING id`,
        [tenantId],
      );
      await tx.query(
        `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method, fx_rate_set_id)
         VALUES ($1, $2, 'Budget', 'annual', '2024-01-01', 2024, 'default', $3)`,
        [tenantId, item.id, pinned.id],
      );
      const [company] = await tx.query(
        `INSERT INTO companies (tenant_id, name, country_iso, city, base_currency)
         VALUES ($1, 'London mill', 'FR', 'Lyon', 'GBP') RETURNING id`,
        [tenantId],
      );
      await tx.query(
        `INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount, turnover)
         VALUES ($1, $2, 2019, 4, 10), ($1, $2, 2018, 4, NULL)`,
        [tenantId, company.id],
      );
      const [supplier] = await tx.query(
        `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'FX supplier') RETURNING id`,
        [tenantId],
      );
      await tx.query(
        `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, currency)
         VALUES ($1, 'Swedish licence', $2, $3, '2024-01-01', 'SEK')`,
        [tenantId, company.id, supplier.id],
      );
    });

    const audit = { log: async () => undefined } as unknown as AuditService;
    const settings = new CurrencySettingsService(dataSource.getRepository(Tenant), audit);
    const fxRates = new FxRateService(dataSource.getRepository(CurrencyRateSet), settings);
    const ingestion = new FxIngestionService(
      dataSource.getRepository(CurrencyRateSet),
      dataSource.getRepository(Tenant),
      settings,
      fxRates,
      worldBank() as any,
    );
    const manual = new ManualRatesService(settings, fxRates, ingestion, audit);
    const controller = new CurrencyController(settings, ingestion, manual, dataSource.getRepository(CurrencyRateSet));

    const runner = dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    const res = new EventEmitter();
    const req = { tenant: { id: tenantId }, user: { sub: null }, queryRunner: runner, res };
    const saved = await controller.updateSettings({ reportingCurrency: 'CHF' }, req);
    assert.equal(saved.reportingCurrency, 'CHF');
    assert.equal('completed' in saved, false, 'the save does not wait for the fetch');
    for (const year of [2019, 2024, currentYear - 1, currentYear, currentYear + 1, currentYear + 2]) {
      assert.ok(saved.refreshYears.includes(year), `years ${saved.refreshYears.join(',')} include ${year}`);
    }
    assert.ok(!saved.refreshYears.includes(2018), 'a company year without turnover is not refreshed');
    assert.ok(ingestion.hasQueuedRefresh(tenantId), 'the refresh is queued by the save');
    await runner.commitTransaction();
    await runner.release();

    const waitRunner = dataSource.createQueryRunner();
    await waitRunner.connect();
    await waitRunner.startTransaction();
    try {
      await waitRunner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      const waitReq = { tenant: { id: tenantId }, user: { sub: null }, queryRunner: waitRunner };
      // The response of the save goes out while the forced sync is already waiting.
      setTimeout(() => res.emit('finish'), 300);
      const synced = await controller.refreshRates({ years: saved.refreshYears }, waitReq);
      assert.equal(synced.completed, true, JSON.stringify(synced));
      if (!synced.completed) return;
      assert.equal(synced.failed, false);
      assert.ok(synced.fetched > 0, 'the new base gained usable pairs');
      assert.ok(!synced.stillMissing.some((pair) => pair.currency === 'USD' && pair.year === 2024), JSON.stringify(synced.stillMissing));
      const runner = waitRunner;

      const sets = async (tx: QueryRunner, year: number, base: string) => tx.query(
        `SELECT id, rates FROM currency_rate_sets
          WHERE tenant_id = $1 AND fiscal_year = $2 AND UPPER(TRIM(base_currency)) = $3
          ORDER BY captured_at DESC`,
        [tenantId, year, base],
      );
      const chf2024 = await sets(runner, 2024, 'CHF');
      const chfForward = await sets(runner, currentYear + 2, 'CHF');
      assert.ok(chf2024.length > 0, '2024 has a CHF set');
      assert.ok(chfForward.length > 0, `${currentYear + 2} has a CHF set`);
      assert.equal(typeof chf2024[0].rates.USD, 'number');
      const eur2024 = await sets(runner, 2024, 'EUR');
      assert.ok(eur2024.length > 0, 'the EUR set of the frozen year is kept');
      assert.equal(eur2024[0].rates.USD, 1.7, 'the EUR manual rate stays on the old base');
      console.log('ok - saving a new reporting currency queues every year in use; the forced sync waits for that run');
      console.log(`ok - reporting-currency refresh on ${current}`);
    } finally {
      if (waitRunner.isTransactionActive) await waitRunner.rollbackTransaction();
      await waitRunner.release();
    }
  } finally {
    await sweepLeftovers();
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
