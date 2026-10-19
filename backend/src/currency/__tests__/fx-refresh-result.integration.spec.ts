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
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';

// A forced sync waits for the fetch and reports what arrived. The World Bank
// client is a stub. The seed is committed first: the fetch uses its own connection.
// @database-spec: opens the data-source. Run it on a dedicated database, never appdb.

function worldBank() {
  return {
    resolveCode: (currency: string) => {
      const code = currency.toUpperCase();
      if (code === 'EUR') return 'EMU';
      if (code === 'ZAR') return 'ZAF';
      if (code === 'USD') return 'USA';
      return null;
    },
    fetchAnnualRates: async (currency: string, start: number, end: number) => {
      const map = new Map<number, number>();
      const code = currency.toUpperCase();
      if (code !== 'EUR' && code !== 'ZAR') return map;
      const value = code === 'ZAR' ? 18 : 1.1;
      for (let year = start; year <= end; year += 1) map.set(year, value);
      return map;
    },
    fetchSpotRate: async (currency: string) => {
      const code = currency.toUpperCase();
      if (code === 'ZAR') return 18.5;
      if (code === 'EUR') return 0.92;
      return null;
    },
  };
}

async function insertLine(runner: QueryRunner, tenantId: string, currency: string, itemNumber: number) {
  const [item] = await runner.query(
    `INSERT INTO spend_items (tenant_id, nature, product_name, currency, effective_start, item_number)
     VALUES ($1, 'opex', $2, $3, '2028-01-01', $4) RETURNING id`,
    [tenantId, `${currency} line`, currency, itemNumber],
  );
  await runner.query(
    `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
     VALUES ($1, $2, 'Budget', 'annual', '2028-01-01', 2028, 'default')`,
    [tenantId, item.id],
  );
}

async function sweepLeftovers() {
  const leftovers = await dataSource.query(`SELECT id FROM tenants WHERE slug LIKE 'races-fx-refresh-%'`);
  for (const row of leftovers as Array<{ id: string }>) await dropRaceTenant(row.id);
  await dataSource.query(`DELETE FROM currencies WHERE code = 'XXX' AND name = 'No quote'`);
}

async function main() {
  await dataSource.initialize();
  const [{ current }] = await dataSource.query(`SELECT current_database() AS current`);
  assert.notEqual(current, 'appdb', 'this spec must not write the dev database');
  await sweepLeftovers();
  const tenantId = await createRaceTenant('fx-refresh');
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    await seed(tenantId, async (tx) => {
      await tx.query(
        `INSERT INTO currencies (code, name) VALUES ('ZAR', 'South African Rand'), ('XXX', 'No quote')
         ON CONFLICT (code) DO NOTHING`,
      );
      await insertLine(tx, tenantId, 'ZAR', 1);
      await insertLine(tx, tenantId, 'XXX', 2);
    });
    const settings = new CurrencySettingsService(dataSource.getRepository(Tenant), { log: async () => undefined } as unknown as AuditService);
    const fxRates = new FxRateService(dataSource.getRepository(CurrencyRateSet), settings);
    const ingestion = new FxIngestionService(
      dataSource.getRepository(CurrencyRateSet),
      dataSource.getRepository(Tenant),
      settings,
      fxRates,
      worldBank() as any,
    );
    const manual = new ManualRatesService(settings, fxRates, ingestion, { log: async () => undefined } as any);
    const controller = new CurrencyController(settings, ingestion, manual, dataSource.getRepository(CurrencyRateSet));

    await runner.startTransaction();
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const req = { tenant: { id: tenantId }, user: { sub: null }, queryRunner: runner };
    const currentYear = new Date().getFullYear();
    const result = await controller.refreshRates(undefined, req);
    assert.equal(result.completed, true, JSON.stringify(result));
    if (!result.completed) return;
    for (const year of [currentYear - 1, currentYear, currentYear + 1, 2028]) {
      assert.ok(result.years.includes(year), `years ${result.years.join(',')} include ${year}`);
    }
    assert.ok(!result.stillMissing.some((pair) => pair.currency === 'ZAR' && pair.year === 2028), JSON.stringify(result.stillMissing));
    assert.ok(result.stillMissing.some((pair) => pair.currency === 'XXX' && pair.year === 2028), JSON.stringify(result.stillMissing));
    const [stored] = await runner.query(
      `SELECT rates FROM currency_rate_sets
        WHERE tenant_id = $1 AND fiscal_year = 2028
        ORDER BY captured_at DESC LIMIT 1`,
      [tenantId],
    );
    assert.ok(stored, '2028 has a rate set');
    const rates = stored.rates as Record<string, number | null>;
    assert.ok(typeof rates.ZAR === 'number' && rates.ZAR > 0);
    let usable = 0;
    for (const year of result.years) {
      const [row] = await runner.query(
        `SELECT rates FROM currency_rate_sets
          WHERE tenant_id = $1 AND fiscal_year = $2
          ORDER BY captured_at DESC LIMIT 1`,
        [tenantId, year],
      );
      for (const value of Object.values((row?.rates ?? {}) as Record<string, unknown>)) {
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) usable += 1;
      }
    }
    assert.equal(result.fetched, usable, 'fetched counts the pairs that became usable');
    console.log('ok - a forced sync fetches the missing year and reports what is still missing');

    const named = await controller.refreshRates({ years: [2020] }, req);
    assert.equal(named.completed, true, JSON.stringify(named));
    if (!named.completed) return;
    assert.deepEqual(named.years, [2020]);
    console.log('ok - explicit years do not add a missing pair year');
    console.log(`ok - forced sync result on ${current}`);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    await sweepLeftovers();
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
