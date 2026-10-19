import * as assert from 'node:assert/strict';
import { EntityManager } from 'typeorm';
import { AllocationCalculatorService } from '../allocation-calculator.service';
import { AllocationRule } from '../allocation-rule.entity';
import { SpendAllocation } from '../spend-allocation.entity';
import { Company } from '../../companies/company.entity';
import { CompanyMetric } from '../../companies/company-metric.entity';

/**
 * The turnover driver weighs each company's turnover in the reporting currency, at the rates of
 * the allocated version (its frozen rate set, else the live rates of its year), as the version
 * amounts are converted. Fixture: 70 M EUR (Paris) and 35 M USD (New York), USD at 0.9 live and
 * 0.8 in the frozen set `set-1`.
 */

const TENANT = 't1';

/** The rows whose `key` is in the `In(...)` of `where[key]`, when the query names one. */
function byIds(list: any[], where: any, key: string) {
  const ids = where?.[key]?.value;
  return Array.isArray(ids) ? list.filter((row) => ids.includes(row[key])) : list;
}

function fakeManager(rows: { companies: any[]; metrics: any[]; allocations?: any[]; rules?: any[] }) {
  return {
    getRepository: (entity: unknown) => ({
      find: async (opts?: { where?: any }) => {
        if (entity === Company) return byIds(rows.companies, opts?.where, 'id');
        if (entity === CompanyMetric) return byIds(rows.metrics, opts?.where, 'company_id');
        if (entity === SpendAllocation) return rows.allocations ?? [];
        if (entity === AllocationRule) return rows.rules ?? [];
        throw new Error(`unexpected repository ${String((entity as any)?.name)}`);
      },
    }),
  } as unknown as EntityManager;
}

function fakeFx(reportingCurrency: string, rates: Record<string, number>) {
  const calls: any[] = [];
  return {
    calls,
    resolveRates: async (tenantId: string, lookups: any[]) => {
      calls.push({ tenantId, lookups });
      const map = new Map<string, any>();
      for (const l of lookups) {
        const currency = String(l.sourceCurrency).toUpperCase();
        const key = `${l.rateSetId || 'live'}:${l.fiscalYear}:${currency}`;
        const same = currency === reportingCurrency;
        const rate = same ? 1 : rates[key];
        map.set(key, {
          rate: rate ?? 1, rateSetId: l.rateSetId ?? null, fiscalYear: l.fiscalYear, reportingCurrency,
          source: same ? 'identity' : rate != null ? 'live' : 'missing', capturedAt: null,
        });
      }
      return { map, settings: { reportingCurrency } };
    },
  };
}

const companies = [
  { id: 'paris', tenant_id: TENANT, base_currency: 'EUR', disabled_at: null },
  { id: 'newyork', tenant_id: TENANT, base_currency: 'USD', disabled_at: null },
];
const metrics = [
  { company_id: 'paris', fiscal_year: 2026, headcount: 100, it_users: 80, turnover: '70' },
  { company_id: 'newyork', fiscal_year: 2026, headcount: 100, it_users: 20, turnover: '35' },
];

function version(id: string, extra: Record<string, unknown> = {}) {
  return { id, tenant_id: TENANT, budget_year: 2026, allocation_method: 'turnover', allocation_driver: 'turnover', fx_rate_set_id: null, ...extra } as any;
}

function calculator(fx: any) {
  return new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any, fx);
}

function pct(shares: Array<{ company_id: string; allocation_pct: number }>) {
  return Object.fromEntries(shares.map((s) => [s.company_id, s.allocation_pct]));
}

async function testTurnoverSharesUseTheReportingCurrency() {
  const fx = fakeFx('EUR', { 'live:2026:USD': 0.9, 'set-1:2026:USD': 0.8 });
  const result = await calculator(fx).computeForVersions(
    [version('live'), version('frozen', { fx_rate_set_id: 'set-1' })],
    { manager: fakeManager({ companies, metrics }), tenantId: TENANT },
  );
  const live = result.get('live')!;
  assert.equal(live.resolvedMethod, 'turnover');
  // Raw, 35 M USD weighed as 35 M EUR: 66.6667 / 33.3333. Converted: 70 / 101.5 and 31.5 / 101.5.
  assert.deepEqual(pct(live.shares), { paris: 68.9655, newyork: 31.0345 });
  assert.equal(live.warning, null);
  // The frozen version converts at its rate set: 35 × 0.8 = 28.
  assert.deepEqual(pct(result.get('frozen')!.shares), { paris: 71.4286, newyork: 28.5714 });
  // Rates read once per rate set and year, for the tenant of the call.
  assert.equal(fx.calls.length, 2);
  assert.ok(fx.calls.every((c) => c.tenantId === TENANT));
}

async function testManualCompanySelectionConvertsToo() {
  const fx = fakeFx('EUR', { 'live:2026:USD': 0.9 });
  const allocations = [
    { id: 'r1', tenant_id: TENANT, version_id: 'manual', company_id: 'paris', department_id: null, allocation_pct: '66.6667', is_system_generated: false },
    { id: 'r2', tenant_id: TENANT, version_id: 'manual', company_id: 'newyork', department_id: null, allocation_pct: '33.3333', is_system_generated: false },
  ];
  const result = await calculator(fx).computeForVersions(
    [version('manual', { allocation_method: 'manual_company', allocation_driver: 'turnover' })],
    { manager: fakeManager({ companies, metrics, allocations }), tenantId: TENANT },
  );
  assert.deepEqual(pct(result.get('manual')!.shares), { paris: 68.9655, newyork: 31.0345 });
}

async function testSameCurrencyNeedsNoRate() {
  const fx = fakeFx('EUR', {});
  const euroOnly = [companies[0], { ...companies[1], base_currency: 'EUR' }];
  const result = await calculator(fx).computeForVersions([version('v')], { manager: fakeManager({ companies: euroOnly, metrics }), tenantId: TENANT });
  assert.deepEqual(pct(result.get('v')!.shares), { paris: 66.6667, newyork: 33.3333 });
  assert.equal(result.get('v')!.warning, null);
}

async function testMissingRateCountsUnconvertedWithAWarning() {
  const fx = fakeFx('EUR', {});
  const result = await calculator(fx).computeForVersions([version('v')], { manager: fakeManager({ companies, metrics }), tenantId: TENANT });
  const v = result.get('v')!;
  // As the version amounts: rate 1 (resolveRates has the year fetched), and the user is told.
  assert.deepEqual(pct(v.shares), { paris: 66.6667, newyork: 33.3333 });
  assert.equal(v.error, null);
  // Structured, so each screen words it in the user's language.
  assert.deepEqual(v.warning, { code: 'turnover_fx_missing', currencies: ['USD'], year: 2026, reportingCurrency: 'EUR' });
}

async function testOtherDriversReadNoRate() {
  const fx = fakeFx('EUR', {});
  const result = await calculator(fx).computeForVersions(
    [version('v', { allocation_method: 'it_users' })],
    { manager: fakeManager({ companies, metrics }), tenantId: TENANT },
  );
  assert.deepEqual(pct(result.get('v')!.shares), { paris: 80, newyork: 20 });
  assert.equal(fx.calls.length, 0);
}

async function testRatesAreReadOncePerRateSetAndYear() {
  const fx = fakeFx('EUR', { 'live:2026:USD': 0.9 });
  const tokyo = { id: 'tokyo', tenant_id: TENANT, base_currency: 'JPY', disabled_at: null };
  const rows = (versionId: string, companyIds: string[]) => companyIds.map((companyId, i) => ({
    id: `${versionId}-${i}`, tenant_id: TENANT, version_id: versionId, company_id: companyId, department_id: null, allocation_pct: '50', is_system_generated: false,
  }));
  const manual = { allocation_method: 'manual_company', allocation_driver: 'turnover' };
  const result = await calculator(fx).computeForVersions(
    [
      version('auto'),
      version('a', manual),
      version('b', manual),
      version('default', { allocation_method: 'default' }),
    ],
    {
      manager: fakeManager({
        companies: [...companies, tokyo],
        metrics: [...metrics, { company_id: 'tokyo', fiscal_year: 2026, headcount: 10, it_users: 5, turnover: '1000' }],
        allocations: [...rows('a', ['paris', 'newyork']), ...rows('b', ['newyork', 'tokyo'])],
        rules: [{ tenant_id: TENANT, fiscal_year: 2026, mode: 'manual_company', method: 'turnover', company_ids: ['paris', 'tokyo'] }],
      }),
      tenantId: TENANT,
    },
  );
  assert.equal(result.size, 4);
  assert.deepEqual(pct(result.get('a')!.shares), { paris: 68.9655, newyork: 31.0345 });
  // Two selections, the default selection and the automatic split of one (rate set, year): one read.
  assert.equal(fx.calls.length, 1);
  assert.deepEqual(fx.calls[0].lookups.map((l: any) => l.sourceCurrency).sort(), ['EUR', 'JPY', 'USD']);
}

Promise.resolve()
  .then(testRatesAreReadOncePerRateSetAndYear)
  .then(testTurnoverSharesUseTheReportingCurrency)
  .then(testManualCompanySelectionConvertsToo)
  .then(testSameCurrencyNeedsNoRate)
  .then(testMissingRateCountsUnconvertedWithAWarning)
  .then(testOtherDriversReadNoRate)
  .then(() => console.log('allocation-calculator-turnover-fx: ok'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
