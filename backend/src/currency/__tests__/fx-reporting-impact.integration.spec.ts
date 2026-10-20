import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { Tenant } from '../../tenants/tenant.entity';
import { CurrencyController } from '../currency.controller';
import { CurrencyRateSet } from '../currency-rate-set.entity';
import { CurrencySettingsService } from '../currency-settings.service';
import { FxRateService, FxResolvedRate } from '../fx-rate.service';
import { MANUAL_RATE_CURRENCY_CODE, ManualRatesService } from '../manual-rates.service';
import {
  assert,
  inRolledBackTransaction,
  runSpecs,
  seedItem,
  seedTenant,
  seedVersion,
} from '../../spend/__tests__/round-inputs.fixtures';

// Manual rates of the current base stop applying when the reporting currency
// changes, and apply again when it changes back. The impact endpoint names
// them, with the frozen versions and whether the new code joins the allowed list.
// @database-spec: opens the data-source. Run it on a dedicated database, never appdb.

const YEAR = 2024;

async function setMeta(runner: QueryRunner, tenantId: string, patch: Record<string, unknown>) {
  await runner.query(
    `UPDATE tenants SET metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
    [tenantId, JSON.stringify(patch)],
  );
}

async function usd(fx: FxRateService, tenantId: string, manager: QueryRunner['manager']): Promise<FxResolvedRate | undefined> {
  const { map } = await fx.resolveRates(
    tenantId,
    [{ key: 'x', rateSetId: null, fiscalYear: YEAR, sourceCurrency: 'USD' }],
    { manager },
  );
  return map.get(`live:${YEAR}:USD`);
}

const tests: Array<[string, () => Promise<void>]> = [
  ['a manual rate of the old base applies again after switching back', () => inRolledBackTransaction(async (runner) => {
    const [{ current }] = await runner.query(`SELECT current_database() AS current`);
    assert.notEqual(current, 'appdb', 'this spec must not write the dev database');
    const tenantId = await seedTenant(runner, 'fx-impact');
    await runner.query(
      `INSERT INTO currencies (code, name)
       VALUES ('EUR', 'Euro'), ('USD', 'US dollar'), ('GBP', 'Pound'), ('CHF', 'Swiss franc')
       ON CONFLICT (code) DO NOTHING`,
    );
    await setMeta(runner, tenantId, { reporting_currency: 'EUR', allowed_currencies: ['EUR', 'USD'] });
    const [eurSet] = await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates, rate_sources, source, rate_basis)
       VALUES ($1, $2, 'EUR', $3::jsonb, $4::jsonb, 'manual', 'manual') RETURNING id`,
      [
        tenantId,
        YEAR,
        JSON.stringify({ EUR: 1, USD: 1.7, GBP: 0.85 }),
        JSON.stringify({ EUR: 'identity', USD: 'manual', GBP: 'world-bank-annual' }),
      ],
    );
    const pin = async (year: number, number: number) => {
      const itemId = await seedItem(runner, 'opex', tenantId, number, `Line ${year}`);
      const versionId = await seedVersion(runner, 'opex', tenantId, itemId, year);
      await runner.query(
        `UPDATE spend_versions SET fx_rate_set_id = $3 WHERE tenant_id = $1 AND id = $2`,
        [tenantId, versionId, eurSet.id],
      );
    };
    await pin(2023, 1);
    await pin(YEAR, 2);

    const audit = { log: async () => undefined } as unknown as AuditService;
    const settings = new CurrencySettingsService(dataSource.getRepository(Tenant), audit);
    const fx = new FxRateService(dataSource.getRepository(CurrencyRateSet), settings);
    const manual = new ManualRatesService(settings, fx, { queueManualRefresh: async () => 'queued' } as any, audit);
    const controller = new CurrencyController(settings, {} as any, manual, dataSource.getRepository(CurrencyRateSet));
    const req = { tenant: { id: tenantId }, queryRunner: runner };

    const impact = await controller.reportingChangeImpact('CHF', req);
    assert.deepEqual(impact, {
      manualRates: [{ currency: 'USD', year: YEAR, rate: 1.7 }],
      frozenVersions: [{ year: 2023, count: 1 }, { year: YEAR, count: 1 }],
      allowedAdded: true,
    });
    const listed = await controller.reportingChangeImpact('usd', req);
    assert.equal(listed.allowedAdded, false);
    await assert.rejects(
      () => controller.reportingChangeImpact('ZZZ', req),
      (error: any) => {
        assert.equal(error.getStatus(), 400);
        assert.equal(error.getResponse().code, MANUAL_RATE_CURRENCY_CODE);
        return true;
      },
    );
    await runner.query(`UPDATE tenants SET metadata = metadata - 'allowed_currencies' WHERE id = $1`, [tenantId]);
    const open = await controller.reportingChangeImpact('CHF', req);
    assert.equal(open.allowedAdded, false, 'an unrestricted list adds nothing');
    assert.deepEqual(open.manualRates, impact.manualRates);

    const before = await usd(fx, tenantId, runner.manager);
    assert.equal(before?.rate, 1.7);
    assert.equal(before?.reportingCurrency, 'EUR');
    assert.equal(before?.via, null);

    await setMeta(runner, tenantId, { reporting_currency: 'CHF' });
    await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates, source, rate_basis)
       VALUES ($1, $2, 'CHF', $3::jsonb, 'exchangerateapi-spot', 'spot')`,
      [tenantId, YEAR, JSON.stringify({ CHF: 1, EUR: 0.5, USD: 0.4 })],
    );
    const switched = await usd(fx, tenantId, runner.manager);
    assert.equal(switched?.rate, 0.4, 'the EUR manual rate does not apply on the CHF base');
    assert.equal(switched?.reportingCurrency, 'CHF');

    await setMeta(runner, tenantId, { reporting_currency: 'EUR' });
    const back = await usd(fx, tenantId, runner.manager);
    assert.equal(back?.rate, 1.7, 'switching back uses the manual rate of the EUR base');
    assert.equal(back?.reportingCurrency, 'EUR');
    assert.equal(back?.via, null);
    console.log(`ok - reporting-change impact on ${current}`);
  })],
];

runSpecs('fx-reporting-impact.integration.spec', tests).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
