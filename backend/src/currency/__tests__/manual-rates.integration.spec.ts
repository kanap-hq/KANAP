import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { Tenant } from '../../tenants/tenant.entity';
import { CurrencyRateSet } from '../currency-rate-set.entity';
import { CurrencySettingsService } from '../currency-settings.service';
import { FxRateService } from '../fx-rate.service';
import { FxIngestionService } from '../fx-ingestion.service';
import {
  MANUAL_RATE_NOT_FOUND_CODE,
  MANUAL_RATE_REPORTING_CODE,
  MANUAL_RATE_REPORTING_MESSAGE,
  ManualRatesService,
} from '../manual-rates.service';

// @database-spec: seeds its own tenants, sets app.current_tenant, and rolls the transaction back.
// It runs on a CI database lane (or the throwaway appdb_fx), never on the dev appdb.

const CURRENT_YEAR = new Date().getFullYear();

function sortPairs(pairs: Array<{ currency: string; year: number }>) {
  return [...pairs].sort((a, b) => a.year - b.year || (a.currency < b.currency ? -1 : a.currency > b.currency ? 1 : 0));
}

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function insertTenant(runner: QueryRunner, name: string) {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [id, `fx-manual-${id}`, name],
  );
  return id;
}

async function insertLine(
  runner: QueryRunner,
  tenantId: string,
  fields: { nature: 'opex' | 'capex'; currency: string; year: number; itemNumber: number },
) {
  const capex = fields.nature === 'capex';
  const [item] = await runner.query(
    `INSERT INTO spend_items (
       tenant_id, nature, product_name, ppe_type, investment_type, priority, currency, effective_start, item_number, legacy_number
     ) VALUES (
       $1, $2, $3, $4::ppe_type, $5::capex_investment_type, $6::priority_level, $7, $8, $9, $10
     ) RETURNING id`,
    [
      tenantId,
      fields.nature,
      `${fields.currency} line`,
      capex ? 'hardware' : null,
      capex ? 'replacement' : null,
      capex ? 'medium' : null,
      fields.currency,
      `${fields.year}-01-01`,
      fields.itemNumber,
      capex ? `CPX-${fields.itemNumber}` : null,
    ],
  );
  await runner.query(
    `INSERT INTO spend_versions (tenant_id, spend_item_id, version_name, input_grain, as_of_date, budget_year, allocation_method)
     VALUES ($1, $2, 'Budget', 'annual', $3, $4, 'default')`,
    [tenantId, item.id, `${fields.year}-01-01`, fields.year],
  );
}

async function insertCompany(runner: QueryRunner, tenantId: string, name: string, currency: string) {
  const [company] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city, base_currency) VALUES ($1, $2, 'FR', 'Lyon', $3) RETURNING id`,
    [tenantId, name, currency],
  );
  return company.id as string;
}

async function insertMetric(runner: QueryRunner, tenantId: string, companyId: string, year: number, turnover: number | null) {
  await runner.query(
    `INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount, turnover)
     VALUES ($1, $2, $3, 4, $4)`,
    [tenantId, companyId, year, turnover],
  );
}

function httpError(error: unknown): { status?: number; message: string; code?: string } {
  const candidate = error as { getStatus?: () => number; getResponse?: () => unknown; message?: string };
  const response = typeof candidate.getResponse === 'function' ? candidate.getResponse() : undefined;
  const body = response && typeof response === 'object' ? (response as { code?: string }) : {};
  return {
    status: typeof candidate.getStatus === 'function' ? candidate.getStatus() : undefined,
    message: candidate.message ?? '',
    code: body.code,
  };
}

async function latestSet(runner: QueryRunner, tenantId: string, year: number) {
  const [row] = await runner.query(
    `SELECT id, TRIM(base_currency) AS base_currency, rates, rate_sources, source, rate_basis
       FROM currency_rate_sets
      WHERE tenant_id = $1 AND fiscal_year = $2
      ORDER BY captured_at DESC
      LIMIT 1`,
    [tenantId, year],
  );
  return row as {
    id: string;
    base_currency: string;
    rates: Record<string, number | null>;
    rate_sources: Record<string, string> | null;
    source: string;
    rate_basis: string;
  };
}

async function main() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const [{ current }] = await runner.query(`SELECT current_database() AS current`);
    assert.notEqual(current, 'appdb', 'this spec must not write the dev database');
    const [{ column }] = await runner.query(
      `SELECT column_name AS column FROM information_schema.columns
        WHERE table_name = 'currency_rate_sets' AND column_name = 'rate_sources'`,
    );
    assert.ok(column, 'currency_rate_sets.rate_sources is required');

    await runner.query(
      `INSERT INTO currencies (code, name) VALUES
         ('AUD', 'Australian Dollar'),
         ('CHF', 'Swiss Franc'),
         ('SEK', 'Swedish Krona'),
         ('JPY', 'Japanese Yen'),
         ('MXN', 'Mexican Peso'),
         ('NOK', 'Norwegian Krone'),
         ('XPF', 'CFP Franc')
       ON CONFLICT (code) DO NOTHING`,
    );

    const tenantA = await insertTenant(runner, 'Manual rates A');
    const tenantB = await insertTenant(runner, 'Manual rates B');
    const userId = randomUUID();

    await setTenant(runner, tenantA);
    await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates, rate_sources, source, rate_basis, captured_at)
       VALUES
         ($1, 2022, 'EUR', '{"EUR":1,"USD":null}'::jsonb, NULL, 'world-bank-annual', 'annual_avg', now() - interval '5 days'),
         ($1, 2022, 'EUR', '{"EUR":1,"USD":0.92}'::jsonb, '{"EUR":"identity","USD":"world-bank-annual"}'::jsonb, 'world-bank-annual', 'annual_avg', now() - interval '2 days'),
         ($1, 2021, 'EUR', '{"EUR":1,"CHF":0}'::jsonb, '{"EUR":"identity","CHF":"world-bank-annual"}'::jsonb, 'world-bank-annual', 'annual_avg', now() - interval '2 days')`,
      [tenantA],
    );
    await insertLine(runner, tenantA, { nature: 'opex', currency: 'USD', year: 2022, itemNumber: 1 });
    await insertLine(runner, tenantA, { nature: 'opex', currency: 'EUR', year: 2022, itemNumber: 2 });
    await insertLine(runner, tenantA, { nature: 'opex', currency: 'GBP', year: 2023, itemNumber: 3 });
    await insertLine(runner, tenantA, { nature: 'capex', currency: 'AUD', year: 2024, itemNumber: 4 });
    const chfCompany = await insertCompany(runner, tenantA, 'Swiss mill', 'CHF');
    await insertMetric(runner, tenantA, chfCompany, 2020, 10);
    await insertMetric(runner, tenantA, chfCompany, 2021, 12);
    await insertMetric(runner, tenantA, chfCompany, 2019, null);
    const eurCompany = await insertCompany(runner, tenantA, 'Home mill', 'EUR');
    await insertMetric(runner, tenantA, eurCompany, 2022, 30);
    const mxnCompany = await insertCompany(runner, tenantA, 'Quiet mill', 'MXN');
    await insertMetric(runner, tenantA, mxnCompany, 2018, null);
    const [supplier] = await runner.query(
      `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'FX supplier') RETURNING id`,
      [tenantA],
    );
    await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, currency)
       VALUES ($1, 'Swedish licence', $2, $3, '2024-01-01', 'SEK'),
              ($1, 'Home licence', $2, $3, '2024-01-01', 'EUR')`,
      [tenantA, eurCompany, supplier.id],
    );
    // Ended in 2015: no year the contract pages read.
    await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, duration_months, auto_renewal, currency)
       VALUES ($1, 'Ended licence', $2, $3, '2015-01-01', 12, false, 'NOK')`,
      [tenantA, eurCompany, supplier.id],
    );

    await setTenant(runner, tenantB);
    await insertLine(runner, tenantB, { nature: 'opex', currency: 'JPY', year: 2019, itemNumber: 1 });
    const otherCompany = await insertCompany(runner, tenantB, 'Other mill', 'EUR');
    const [otherSupplier] = await runner.query(
      `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Other supplier') RETURNING id`,
      [tenantB],
    );
    await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, currency)
       VALUES ($1, 'Norwegian licence', $2, $3, '2019-01-01', 'NOK')`,
      [tenantB, otherCompany, otherSupplier.id],
    );
    const [{ jpy }] = await runner.query(`SELECT count(*)::int AS jpy FROM spend_items WHERE UPPER(TRIM(currency)) = 'JPY'`);
    assert.equal(jpy, 1, 'tenant B has its own line');

    await setTenant(runner, tenantA);
    const audit = new AuditService(dataSource.getRepository(AuditLog));
    const settings = new CurrencySettingsService(dataSource.getRepository(Tenant), audit);
    const fxRates = new FxRateService(dataSource.getRepository(CurrencyRateSet), settings);
    const reported: number[][] = [];
    fxRates.onMissingRates((_tenantId, years) => reported.push([...years]));
    const queued: Array<{ years: unknown; label?: string }> = [];
    let queueStatus: 'queued' | 'merged' = 'queued';
    const ingestion = {
      queueManualRefresh: async (_tenantId: string, years: unknown, opts?: { label?: string }) => {
        queued.push({ years, label: opts?.label });
        return queueStatus;
      },
    };
    const manual = new ManualRatesService(settings, fxRates, ingestion as any, audit);

    // Only the years the contract pages read (the current one and the two after; the year
    // before has no budget line), and among them only those the contract runs in.
    const contractYears = [CURRENT_YEAR, CURRENT_YEAR + 1, CURRENT_YEAR + 2];
    const expected = sortPairs([
      { currency: 'CHF', year: 2020 },
      { currency: 'CHF', year: 2021 },
      { currency: 'GBP', year: 2023 },
      { currency: 'AUD', year: 2024 },
      ...contractYears.map((year) => ({ currency: 'SEK', year })),
    ]);
    const missing = await manual.listMissingPairs(tenantA, runner.manager);
    assert.deepEqual(missing, expected);
    const [{ versions }] = await runner.query(
      `SELECT count(*)::int AS versions FROM spend_versions WHERE tenant_id = $1 AND budget_year = $2`,
      [tenantA, CURRENT_YEAR + 2],
    );
    assert.equal(versions, 0, 'the later contract year has no budget version');
    assert.ok(missing.some((pair) => pair.currency === 'SEK' && pair.year === CURRENT_YEAR + 2));
    assert.ok(!missing.some((pair) => pair.currency === 'EUR'), 'the reporting currency is excluded');
    assert.ok(!missing.some((pair) => pair.currency === 'USD'), 'a usable stored rate is not missing');
    assert.ok(!missing.some((pair) => pair.currency === 'JPY' || pair.currency === 'NOK'), 'another tenant is excluded');
    assert.ok(!missing.some((pair) => pair.currency === 'MXN'), 'a company year without turnover is excluded');
    assert.deepEqual(reported[0], Array.from(new Set(expected.map((pair) => pair.year))).sort((a, b) => a - b));
    assert.ok(!missing.some((pair) => pair.currency === 'SEK' && pair.year < CURRENT_YEAR), 'a contract has no pair for an older version year');
    console.log('ok - missing pairs come from budget lines, companies and contracts');

    // A blank contract currency converts as EUR: with a USD reporting currency it needs EUR.
    await runner.query(
      `UPDATE tenants SET metadata = '{"reporting_currency":"USD"}'::jsonb WHERE id = $1`,
      [tenantB],
    );
    await setTenant(runner, tenantB);
    await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, currency)
       VALUES ($1, 'Blank licence', $2, $3, '2024-01-01', '   ')`,
      [tenantB, otherCompany, otherSupplier.id],
    );
    // Its 2019 version stays pinned to a set of an older base (XPF): that base is in use.
    const [oldBaseSet] = await runner.query(
      `INSERT INTO currency_rate_sets (tenant_id, fiscal_year, base_currency, rates, source, rate_basis)
       VALUES ($1, 2019, 'XPF', '{"XPF":1,"JPY":1.2}'::jsonb, 'manual', 'manual') RETURNING id`,
      [tenantB],
    );
    await runner.query(
      `UPDATE spend_versions SET fx_rate_set_id = $2 WHERE tenant_id = $1 AND budget_year = 2019`,
      [tenantB, oldBaseSet.id],
    );
    const missingB = await manual.listMissingPairs(tenantB, runner.manager, { report: false });
    assert.deepEqual(missingB, sortPairs([
      { currency: 'JPY', year: 2019 },
      { currency: 'XPF', year: 2019 },
      ...contractYears.flatMap((year) => [{ currency: 'EUR', year }, { currency: 'NOK', year }]),
    ]));
    const ingestionB = new FxIngestionService(
      dataSource.getRepository(CurrencyRateSet),
      dataSource.getRepository(Tenant),
      settings,
      fxRates,
      {} as any,
    );
    const contextB = await (ingestionB as any).buildTenantContext(tenantB, runner.manager);
    assert.ok(contextB.currencies.includes('XPF'), 'the refresh fetches the old base of a pinned set');
    await setTenant(runner, tenantA);
    console.log('ok - a contract with a blank currency needs the EUR rate of each year it runs in');
    console.log('ok - the old base of a pinned set is listed as missing and fetched');

    await assert.rejects(
      () => manual.setManualRate(tenantA, { currency: 'EUR', year: 2024, rate: 1.2 }, userId, runner.manager),
      (error: unknown) => {
        const http = httpError(error);
        assert.equal(http.status, 400);
        assert.equal(http.message, MANUAL_RATE_REPORTING_MESSAGE);
        assert.equal(http.code, MANUAL_RATE_REPORTING_CODE);
        return true;
      },
    );
    console.log('ok - the reporting currency is rejected');

    const [{ xpfBefore }] = await runner.query(`SELECT count(*)::int AS "xpfBefore" FROM currencies WHERE TRIM(code) = 'XPF'`);
    const created = await manual.setManualRate(tenantA, { currency: 'xpf', year: 2050, rate: 1.5 }, userId, runner.manager);
    const createdRow = await latestSet(runner, tenantA, 2050);
    assert.equal(createdRow.id, created.id);
    assert.equal(createdRow.base_currency, 'EUR');
    assert.deepEqual(createdRow.rates, { EUR: 1, XPF: 1.5 });
    assert.deepEqual(createdRow.rate_sources, { EUR: 'identity', XPF: 'manual' });
    assert.equal(createdRow.source, 'manual');
    assert.equal(createdRow.rate_basis, 'manual');
    const [{ xpfAfter }] = await runner.query(`SELECT count(*)::int AS "xpfAfter" FROM currencies WHERE TRIM(code) = 'XPF'`);
    assert.equal(xpfAfter, 1);
    assert.ok(xpfAfter >= xpfBefore);
    console.log('ok - a year with no set stores a manual set');

    const [sets2022Before] = await runner.query(
      `SELECT count(*)::int AS n FROM currency_rate_sets WHERE tenant_id = $1 AND fiscal_year = 2022`,
      [tenantA],
    );
    const updated = await manual.setManualRate(tenantA, { currency: 'usd', year: 2022, rate: 1.1 }, userId, runner.manager);
    const updatedRow = await latestSet(runner, tenantA, 2022);
    assert.equal(updatedRow.id, updated.id);
    assert.notEqual(updatedRow.id, created.id);
    assert.equal(updatedRow.rates.EUR, 1);
    assert.equal(updatedRow.rates.USD, 1.1);
    assert.equal(updatedRow.rate_sources?.USD, 'manual');
    assert.equal(updatedRow.rate_sources?.EUR, 'identity');
    assert.equal(updatedRow.source, 'world-bank-annual');
    assert.equal(updatedRow.rate_basis, 'annual_avg');
    const [sets2022After] = await runner.query(
      `SELECT count(*)::int AS n FROM currency_rate_sets WHERE tenant_id = $1 AND fiscal_year = 2022`,
      [tenantA],
    );
    assert.equal(sets2022After.n, sets2022Before.n + 1, 'the manual value is a new set');
    console.log('ok - a manual rate copies the latest set of the year');

    const gbp = await manual.setManualRate(tenantA, { currency: 'GBP', year: 2023, rate: 1.23456789 }, userId, runner.manager);
    assert.equal(gbp.rates.GBP, 1.234568);
    const afterManual = await manual.listMissingPairs(tenantA, runner.manager);
    assert.deepEqual(afterManual, expected.filter((pair) => !(pair.currency === 'GBP' && pair.year === 2023)));
    console.log('ok - a manual rate removes the pair from the missing list');

    const removed = await manual.removeManualRate(tenantA, { currency: 'gbp', year: 2023 }, userId, runner.manager);
    assert.deepEqual(removed, { ok: true, refreshQueued: true });
    const removedRow = await latestSet(runner, tenantA, 2023);
    assert.equal(removedRow.rates.GBP, null);
    assert.equal(removedRow.rates.EUR, 1);
    assert.equal(removedRow.rate_sources?.GBP, undefined);
    assert.equal(removedRow.rate_sources?.EUR, 'identity');
    assert.deepEqual(queued, [{ years: [2023], label: 'manual-rate-removed' }]);
    const afterRemoval = await manual.listMissingPairs(tenantA, runner.manager);
    assert.deepEqual(afterRemoval, expected);
    console.log('ok - removing the manual rate clears it and queues a refresh');

    await assert.rejects(
      () => manual.removeManualRate(tenantA, { currency: 'CHF', year: 2021 }, userId, runner.manager),
      (error: unknown) => {
        const http = httpError(error);
        assert.equal(http.status, 404);
        assert.equal(http.message, 'No manual rate is stored for CHF in 2021.');
        assert.equal(http.code, MANUAL_RATE_NOT_FOUND_CODE);
        return true;
      },
    );
    console.log('ok - a currency that is not manual answers 404');

    queueStatus = 'merged';
    const reportedBefore = reported.length;
    const merged = await manual.removeManualRate(tenantA, { currency: 'USD', year: 2022 }, userId, runner.manager);
    assert.deepEqual(merged, { ok: true, refreshQueued: true });
    assert.deepEqual(queued[1], { years: [2022], label: 'manual-rate-removed' });
    assert.equal(reported.length, reportedBefore, 'the next run takes the year: nothing to report');
    const usdRow = await latestSet(runner, tenantA, 2022);
    assert.equal(usdRow.rates.USD, null);
    assert.equal(usdRow.rate_sources?.USD, undefined);
    console.log('ok - a refresh already running takes the removed year into its next run');

    const audits = await runner.query(
      `SELECT action, record_id, before_json, after_json, user_id::text AS user_id
         FROM audit_log
        WHERE table_name = 'currency_rate_sets'
        ORDER BY created_at, action`,
    );
    assert.deepEqual(
      audits.map((row: { action: string; record_id: string }) => ({ action: row.action, record_id: row.record_id })),
      [
        { action: 'create', record_id: created.id },
        { action: 'update', record_id: updated.id },
        { action: 'create', record_id: gbp.id },
        { action: 'delete', record_id: removedRow.id },
        { action: 'delete', record_id: usdRow.id },
      ],
    );
    assert.deepEqual(audits[0].before_json, { fiscal_year: 2050, currency: 'XPF', rate: null, source: null });
    assert.deepEqual(audits[0].after_json, { fiscal_year: 2050, currency: 'XPF', rate: 1.5, source: 'manual' });
    assert.deepEqual(audits[1].before_json, { fiscal_year: 2022, currency: 'USD', rate: 0.92, source: 'world-bank-annual' });
    assert.deepEqual(audits[1].after_json, { fiscal_year: 2022, currency: 'USD', rate: 1.1, source: 'manual' });
    assert.deepEqual(audits[3].before_json, { fiscal_year: 2023, currency: 'GBP', rate: 1.234568, source: 'manual' });
    assert.equal(audits[3].after_json, null);
    assert.ok(audits.every((row: { user_id: string }) => row.user_id === userId));
    console.log('ok - each manual entry, change and removal is audited');

    await setTenant(runner, tenantB);
    const otherMissing = await manual.listMissingPairs(tenantB, runner.manager);
    assert.ok(otherMissing.some((pair) => pair.currency === 'JPY' && pair.year === 2019));
    assert.ok(otherMissing.some((pair) => pair.currency === 'NOK'));
    assert.ok(!otherMissing.some((pair) => pair.currency === 'GBP' || pair.currency === 'SEK' || pair.currency === 'AUD' || pair.currency === 'CHF'));
    console.log(`ok - manual rates and missing pairs on ${current}`);
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
