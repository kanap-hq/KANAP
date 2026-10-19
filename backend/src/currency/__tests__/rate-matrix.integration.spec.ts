import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { Tenant } from '../../tenants/tenant.entity';
import { CurrencyController } from '../currency.controller';
import { CurrencyRateSet } from '../currency-rate-set.entity';
import { CurrencySettingsService } from '../currency-settings.service';
import { FxRateService } from '../fx-rate.service';
import { ManualRatesService } from '../manual-rates.service';

// @database-spec: seeds its own tenants, sets app.current_tenant, and rolls the transaction back.
// It runs on a CI database lane (or the throwaway appdb_fxq1b), never on the dev appdb.

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function insertTenant(runner: QueryRunner, name: string, metadata: Record<string, unknown>) {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', $4::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [id, `fx-matrix-${id}`, name, JSON.stringify(metadata)],
  );
  return id;
}

async function insertLine(runner: QueryRunner, tenantId: string, fields: { currency: string; year: number; itemNumber: number }) {
  const [item] = await runner.query(
    `INSERT INTO spend_items (
       tenant_id, nature, product_name, currency, effective_start, item_number
     ) VALUES ($1, 'opex', $2, $3, $4, $5) RETURNING id`,
    [tenantId, `${fields.currency} line`, fields.currency, `${fields.year}-01-01`, fields.itemNumber],
  );
  const [version] = await runner.query(
    `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
     VALUES ($1, $2, 'Budget', 'annual', $3, $4, 'default') RETURNING id`,
    [tenantId, item.id, `${fields.year}-01-01`, fields.year],
  );
  return version.id as string;
}

async function main() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const [{ current }] = await runner.query(`SELECT current_database() AS current`);
    assert.notEqual(current, 'appdb', 'this spec must not write the dev database');

    await runner.query(
      `INSERT INTO currencies (code, name) VALUES
         ('CHF', 'Swiss Franc'),
         ('GBP', 'Pound Sterling'),
         ('SEK', 'Swedish Krona'),
         ('USD', 'US Dollar'),
         ('ZAR', 'Rand')
       ON CONFLICT (code) DO NOTHING`,
    );

    const tenantA = await insertTenant(runner, 'Matrix A', {
      reporting_currency: 'EUR',
      allowed_currencies: ['GBP'],
    });
    const tenantB = await insertTenant(runner, 'Matrix B', { reporting_currency: 'EUR' });
    const userId = randomUUID();

    await setTenant(runner, tenantA);
    await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates, rate_sources, source, rate_basis, captured_at)
       VALUES
         ($1, 2024, 'EUR',
          '{"EUR":1,"USD":1.1,"XTS":null,"NOK":null,"ZAR":18.5,"GGP":null}'::jsonb,
          '{"EUR":"identity","USD":"world-bank-annual","XTS":"world-bank-annual","NOK":"world-bank-annual","ZAR":"manual","GGP":"world-bank-annual"}'::jsonb,
          'world-bank-annual', 'annual_avg', now() - interval '2 days'),
         ($1, 2024, 'USD',
          '{"USD":1,"EUR":0.92,"NOK":9,"SEK":0.09}'::jsonb,
          '{"USD":"identity","SEK":"manual","NOK":"world-bank-annual"}'::jsonb,
          'world-bank-annual', 'annual_avg', now() - interval '1 day'),
         ($1, 2023, 'USD',
          '{"USD":1,"EUR":0.9}'::jsonb,
          '{"USD":"identity"}'::jsonb,
          'world-bank-annual', 'annual_avg', now() - interval '3 days')`,
      [tenantA],
    );
    const [pin] = await runner.query(
      `SELECT id FROM currency_rate_sets
        WHERE tenant_id = $1 AND fiscal_year = 2024 AND UPPER(TRIM(base_currency)) = 'EUR'
        ORDER BY captured_at DESC LIMIT 1`,
      [tenantA],
    );

    const usdVersion = await insertLine(runner, tenantA, { currency: 'USD', year: 2024, itemNumber: 1 });
    const eurPinned = await insertLine(runner, tenantA, { currency: 'EUR', year: 2024, itemNumber: 2 });
    await insertLine(runner, tenantA, { currency: 'EUR', year: 2024, itemNumber: 3 });
    const olderYear = await insertLine(runner, tenantA, { currency: 'EUR', year: 2023, itemNumber: 4 });
    await runner.query(
      `UPDATE spend_versions SET fx_rate_set_id = $2 WHERE tenant_id = $1 AND id = ANY($3::uuid[])`,
      [tenantA, pin.id, [usdVersion, eurPinned, olderYear]],
    );
    const [company] = await runner.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city, base_currency) VALUES ($1, 'Swiss mill', 'CH', 'Bern', 'CHF') RETURNING id`,
      [tenantA],
    );
    await runner.query(
      `INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount, turnover)
       VALUES ($1, $2, 2024, 4, 12)`,
      [tenantA, company.id],
    );

    await setTenant(runner, tenantB);
    const [otherSet] = await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates, source, rate_basis, captured_at)
       VALUES ($1, 2024, 'EUR', '{"EUR":1}'::jsonb, 'manual', 'manual', now())
       RETURNING id`,
      [tenantB],
    );
    const otherVersion = await insertLine(runner, tenantB, { currency: 'USD', year: 2024, itemNumber: 1 });
    await runner.query(
      `UPDATE spend_versions SET fx_rate_set_id = $2 WHERE tenant_id = $3 AND id = $1`,
      [otherVersion, otherSet.id, tenantB],
    );

    await setTenant(runner, tenantA);
    const audit = new AuditService(dataSource.getRepository(AuditLog));
    const settings = new CurrencySettingsService(dataSource.getRepository(Tenant), audit);
    const fxRates = new FxRateService(dataSource.getRepository(CurrencyRateSet), settings);
    const manual = new ManualRatesService(settings, fxRates, {
      queueManualRefresh: async () => 'queued',
    } as any, audit);
    const controller = new CurrencyController({} as any, {} as any, manual, { manager: runner.manager } as any);
    const req = { tenant: { id: tenantA }, user: { sub: userId }, queryRunner: { manager: runner.manager } };

    const listed = await controller.listRates(req);
    assert.deepEqual(listed.currencies, ['EUR', 'CHF', 'GBP', 'USD', 'ZAR']);
    assert.equal(listed.rates.length, 1);
    assert.equal(listed.rates[0].fiscalYear, 2024);
    assert.equal(listed.rates[0].baseCurrency, 'EUR');
    assert.deepEqual(listed.rates[0].rates, { EUR: 1, USD: 1.1, ZAR: 18.5 });
    assert.deepEqual(listed.rates[0].rateSources, {
      EUR: 'identity',
      USD: 'world-bank-annual',
      ZAR: 'manual',
    });
    console.log('ok - the matrix drops old-base sets and unused currencies');

    const saved = await controller.setManualRate({ currency: 'GBP', year: 2024, rate: 1.2 }, req);
    assert.equal(saved.fiscalYear, 2024);
    assert.equal(saved.rates.GBP, 1.2);
    assert.equal(saved.frozenVersions, 2);

    const removed = await controller.removeManualRate('2024', 'GBP', req);
    assert.deepEqual(removed, { ok: true, refreshQueued: true, frozenVersions: 2 });

    const emptyYear = await controller.setManualRate({ currency: 'USD', year: 2026, rate: 1.05 }, req);
    assert.equal(emptyYear.frozenVersions, 0);
    console.log(`ok - frozen versions are counted for the budget year on ${current}`);
  } finally {
    if (runner.isTransactionActive) await runner.rollbackTransaction();
    await runner.release();
    if (dataSource.isInitialized) await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
