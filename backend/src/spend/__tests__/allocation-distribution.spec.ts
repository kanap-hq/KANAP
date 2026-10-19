import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { Company } from '../../companies/company.entity';
import { CompanyMetric } from '../../companies/company-metric.entity';
import {
  AllocationSplitError,
  TurnoverFxRates,
  buildCompanyWeights,
  computeCompanyShares,
  computeCompanySharesWithFx,
  convertTurnovers,
  fiscalYearStart,
  describeAllocationWarning,
  normalizeWeights,
  turnoverFxMissingWarning,
} from '../allocation-distribution';

/**
 * `resolveRates` stub: `rates` maps `<rate set or live>:<year>:<currency>` to the rate into the
 * reporting currency (`amount * rate`); an unknown key answers rate 1 with the source `missing`,
 * as `FxRateService` does.
 */
function fakeFx(reportingCurrency: string, rates: Record<string, number>) {
  const calls: any[][] = [];
  const fx = {
    calls,
    resolveRates: async (tenantId: string, lookups: any[]) => {
      calls.push([tenantId, lookups]);
      const map = new Map<string, any>();
      for (const l of lookups) {
        const key = `${l.rateSetId || 'live'}:${l.fiscalYear}:${String(l.sourceCurrency).toUpperCase()}`;
        const same = String(l.sourceCurrency).toUpperCase() === reportingCurrency;
        const rate = same ? 1 : rates[key];
        map.set(key, {
          rate: rate ?? 1,
          rateSetId: l.rateSetId ?? null,
          fiscalYear: l.fiscalYear,
          reportingCurrency,
          source: same ? 'identity' : rate != null ? (l.rateSetId ? 'snapshot' : 'live') : 'missing',
          capturedAt: null,
        });
      }
      return { map, settings: { reportingCurrency } as any };
    },
  };
  return fx as unknown as TurnoverFxRates & { calls: any[][] };
}

function sum(values: number[]): number {
  return values.reduce((acc, value) => acc + value, 0);
}

function testEqualWeightsRoundToExactlyOneHundred() {
  const result = normalizeWeights([
    { id: 'a', weight: 1 },
    { id: 'b', weight: 1 },
    { id: 'c', weight: 1 },
  ]);
  assert.deepEqual(result.map((r) => r.pct), [33.3333, 33.3333, 33.3334]);
  assert.equal(Math.abs(sum(result.map((r) => r.pct)) - 100) < 1e-9, true);
}

function testLastEntryAbsorbsTheRoundingRemainder() {
  const sixths = normalizeWeights(
    Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, weight: 1 })),
  );
  assert.deepEqual(sixths.map((r) => r.pct), [16.6667, 16.6667, 16.6667, 16.6667, 16.6667, 16.6665]);
  // The exported percentages always add up to 100, whatever the rounding.
  const others = sum(sixths.slice(0, -1).map((r) => r.pct));
  assert.equal(Number((100 - others).toFixed(4)), sixths[sixths.length - 1].pct);
}

function testSingleEntryTakesEverything() {
  assert.deepEqual(normalizeWeights([{ id: 'only', weight: 42 }]), [{ id: 'only', pct: 100 }]);
  assert.deepEqual(normalizeWeights([{ id: 'only', weight: 0.0001 }]), [{ id: 'only', pct: 100 }]);
}

function testProportionalWeights() {
  const result = normalizeWeights([
    { id: 'a', weight: 3 },
    { id: 'b', weight: 7 },
  ]);
  assert.deepEqual(result, [
    { id: 'a', pct: 30 },
    { id: 'b', pct: 70 },
  ]);
}

function testDecimalWeights() {
  const result = normalizeWeights([
    { id: 'big', weight: 1234.56 },
    { id: 'small', weight: 0.44 },
  ]);
  assert.deepEqual(result.map((r) => r.pct), [99.9644, 0.0356]);
}

function testNonPositiveTotalIsRejected() {
  assert.throws(
    () => normalizeWeights([{ id: 'a', weight: 0 }, { id: 'b', weight: 0 }]),
    (err: unknown) => err instanceof BadRequestException,
  );
  assert.throws(
    () => normalizeWeights([{ id: 'a', weight: Number.NaN }]),
    (err: unknown) => err instanceof BadRequestException,
  );
}

function testCompanyWeightsFollowTheDriverValues() {
  const weights = buildCompanyWeights(
    ['a', 'b'],
    new Map<string, number | string | null>([
      ['a', 300],
      ['b', 100],
    ]),
    'headcount',
  );
  assert.deepEqual(weights, [
    { id: 'a', weight: 300 },
    { id: 'b', weight: 100 },
  ]);
}

function testCompanyWeightsRejectMissingOrZeroValues() {
  for (const values of [
    new Map<string, number | string | null>([['a', 10], ['b', null]]),
    new Map<string, number | string | null>([['a', 10], ['b', 0]]),
    new Map<string, number | string | null>([['a', 10]]),
    new Map<string, number | string | null>([['a', 10], ['b', Number.NaN]]),
  ]) {
    assert.throws(
      () => buildCompanyWeights(['a', 'b'], values, 'it_users'),
      (err: unknown) => err instanceof BadRequestException && /it users/.test((err as Error).message),
    );
  }
}

function testFiscalYearStart() {
  assert.equal(fiscalYearStart(2026).toISOString(), '2026-01-01T00:00:00.000Z');
}

/** EntityManager stub: company/metric reads are served from the given rows. */
function fakeManager(rows: { companies: any[]; metrics: any[] }) {
  const captured: any[] = [];
  const manager = {
    getRepository: (entity: unknown) => ({
      find: async (options: any) => {
        captured.push({ entity, options });
        return entity === Company ? rows.companies : rows.metrics;
      },
    }),
    captured,
  };
  return manager as unknown as EntityManager & { captured: any[] };
}

async function testSharesUseDriverValues() {
  const manager = fakeManager({
    companies: [{ id: 'a' }, { id: 'b' }],
    metrics: [
      { company_id: 'a', headcount: 1200 },
      { company_id: 'b', headcount: 400 },
    ],
  });
  const shares = await computeCompanyShares({
    manager, tenantId: 't1', fiscalYear: 2026, companyIds: ['a', 'b'], driver: 'headcount', fxRates: undefined,
  });
  assert.deepEqual(Array.from(shares.entries()), [['a', 75], ['b', 25]]);

  // The company lookup stays tenant-scoped and year-aware.
  const companyQuery = manager.captured.find((c) => c.entity === Company)!.options.where;
  assert.equal(companyQuery.tenant_id, 't1');
  assert.ok(companyQuery.disabled_at);
  const metricsQuery = manager.captured.find((c) => c.entity === CompanyMetric)!.options.where;
  assert.equal(metricsQuery.tenant_id, 't1');
  assert.equal(metricsQuery.fiscal_year, 2026);
}

async function testTurnoverColumnIsUsedForTheTurnoverDriver() {
  const manager = fakeManager({
    companies: [{ id: 'a', base_currency: 'EUR' }, { id: 'b', base_currency: 'EUR' }],
    metrics: [
      { company_id: 'a', headcount: 10, turnover: '180' },
      { company_id: 'b', headcount: 990, turnover: '60' },
    ],
  });
  const shares = await computeCompanyShares({
    manager, tenantId: 't1', fiscalYear: 2026, companyIds: ['a', 'b'], driver: 'turnover', fxRates: fakeFx('EUR', {}),
  });
  assert.deepEqual(Array.from(shares.entries()), [['a', 75], ['b', 25]]);
}

/** 70 M EUR and 35 M USD at 0.9: 70 / 101.5 and 31.5 / 101.5, not 70 / 105 and 35 / 105. */
async function testTurnoversInOtherCurrenciesAreConvertedAtTheVersionRates() {
  const manager = fakeManager({
    companies: [{ id: 'eu', base_currency: 'EUR' }, { id: 'us', base_currency: 'usd' }],
    metrics: [
      { company_id: 'eu', turnover: '70' },
      { company_id: 'us', turnover: '35' },
    ],
  });
  const fx = fakeFx('EUR', { 'live:2026:USD': 0.9, 'set-1:2026:USD': 0.8 });
  const live = await computeCompanySharesWithFx({
    manager, tenantId: 't1', fiscalYear: 2026, companyIds: ['eu', 'us'], driver: 'turnover', fxRates: fx, rateSetId: null,
  });
  assert.deepEqual(Array.from(live.shares.entries()), [['eu', 68.9655], ['us', 31.0345]]);
  assert.deepEqual(live.fxMissing, []);
  assert.equal(fx.calls[0][0], 't1');
  assert.deepEqual(fx.calls[0][1].map((l: any) => [l.rateSetId, l.fiscalYear, l.sourceCurrency]), [[null, 2026, 'EUR'], [null, 2026, 'USD']]);

  // A frozen version converts at its rate set: 35 × 0.8 = 28.
  const frozen = await computeCompanySharesWithFx({
    manager, tenantId: 't1', fiscalYear: 2026, companyIds: ['eu', 'us'], driver: 'turnover', fxRates: fx, rateSetId: 'set-1',
  });
  assert.deepEqual(Array.from(frozen.shares.entries()), [['eu', 71.4286], ['us', 28.5714]]);
}

async function testTurnoverWithoutARateIsLeftOutAndReported() {
  const fx = fakeFx('EUR', {});
  const converted = await convertTurnovers({
    fxRates: fx, manager: {} as EntityManager, tenantId: 't1', fiscalYear: 2027, rateSetId: null,
    entries: [
      { companyId: 'eu', currency: 'EUR', turnover: 70 },
      { companyId: 'us', currency: 'USD', turnover: '35' },
      { companyId: 'none', currency: 'USD', turnover: null },
    ],
  });
  assert.equal(converted.reportingCurrency, 'EUR');
  assert.deepEqual(Array.from(converted.values.entries()), [['eu', 70], ['none', null]]);
  assert.deepEqual(converted.missing, [{ companyId: 'us', currency: 'USD' }]);
  // The missing year is still asked of the rate service, so a refresh can fetch it.
  assert.equal(fx.calls.length, 1);
}

/** 70 M EUR and 30 M JPY stay; 35 M USD without a rate is left out, and the two share 100 %. */
async function testManualSplitLeavesOutTheCompanyWithoutARate() {
  const manager = fakeManager({
    companies: [
      { id: 'eu', name: 'Paris', base_currency: 'EUR' },
      { id: 'us', name: 'New York', base_currency: 'USD' },
      { id: 'jp', name: 'Osaka', base_currency: 'JPY' },
    ],
    metrics: [
      { company_id: 'eu', turnover: '70' },
      { company_id: 'us', turnover: '35' },
      { company_id: 'jp', turnover: '30' },
    ],
  });
  const computed = await computeCompanySharesWithFx({
    manager, tenantId: 't1', fiscalYear: 2026, companyIds: ['eu', 'us', 'jp'], driver: 'turnover',
    fxRates: fakeFx('EUR', { 'live:2026:JPY': 1 }),
  });
  assert.deepEqual(Array.from(computed.shares.entries()), [['eu', 70], ['jp', 30]]);
  assert.equal(Array.from(computed.shares.values()).reduce((sum, pct) => sum + pct, 0), 100);
  assert.deepEqual(computed.fxMissing, [{
    companyId: 'us', companyName: 'New York', currency: 'USD', year: 2026,
  }]);
}

/** Every selected company lacks a rate: the split has no driver, and the warning stays on the error. */
async function testManualSplitWithNoRateHasNoDriver() {
  const manager = fakeManager({
    companies: [
      { id: 'us', name: 'New York', base_currency: 'USD' },
      { id: 'jp', name: 'Osaka', base_currency: 'JPY' },
    ],
    metrics: [
      { company_id: 'us', turnover: '35' },
      { company_id: 'jp', turnover: '30' },
    ],
  });
  await assert.rejects(
    () => computeCompanySharesWithFx({
      manager, tenantId: 't1', fiscalYear: 2026, companyIds: ['us', 'jp'], driver: 'turnover', fxRates: fakeFx('EUR', {}),
    }),
    (err: unknown) => {
      assert.ok(err instanceof AllocationSplitError);
      assert.equal(err.getStatus(), 400);
      assert.equal((err.getResponse() as { code?: string }).code, 'turnover_fx_missing_all');
      assert.equal(err.message, 'No exchange rate from JPY, USD to EUR for 2026: the turnover of the selected companies cannot be compared. Enter the rate, or choose another allocation driver.');
      assert.deepEqual(err.warning.items.map((item) => item.companyId), ['jp', 'us']);
      assert.equal(err.warning.reportingCurrency, 'EUR');
      return true;
    },
  );
}

async function testSameCurrencyIsNotConverted() {
  const fx = fakeFx('USD', { 'live:2026:EUR': 1.1 });
  const converted = await convertTurnovers({
    fxRates: fx, manager: {} as EntityManager, tenantId: 't1', fiscalYear: 2026, rateSetId: null,
    entries: [
      { companyId: 'us', currency: 'USD', turnover: 35.123 },
      { companyId: 'eu', currency: 'EUR', turnover: 10 },
      { companyId: 'blank', currency: null, turnover: 2 },
    ],
  });
  assert.equal(converted.values.get('us'), 35.123);
  assert.equal(Math.round(converted.values.get('eu')! * 1000) / 1000, 11);
  // A company without base currency counts as the reporting currency.
  assert.equal(converted.values.get('blank'), 2);
  assert.deepEqual(converted.missing, []);
}

async function testTurnoverConversionNeedsTheRates() {
  await assert.rejects(() => convertTurnovers({
    fxRates: undefined, manager: {} as EntityManager, tenantId: 't1', fiscalYear: 2026, rateSetId: null, entries: [],
  }), /exchange rates/);
}

async function testCompanyDisabledForTheYearIsRejected() {
  // The query only returns enabled companies, so a shorter result set means a rejected one.
  const manager = fakeManager({
    companies: [{ id: 'a' }],
    metrics: [{ company_id: 'a', headcount: 10 }],
  });
  await assert.rejects(
    () => computeCompanyShares({
      manager, tenantId: 't1', fiscalYear: 2026, companyIds: ['a', 'b'], driver: 'headcount', fxRates: undefined,
    }),
    (err: unknown) =>
      err instanceof BadRequestException && /not available for manual allocation/.test((err as Error).message),
  );
}

async function testCompanyWithoutMetricIsRejected() {
  const manager = fakeManager({
    companies: [{ id: 'a' }, { id: 'b' }],
    metrics: [{ company_id: 'a', headcount: 1200 }],
  });
  await assert.rejects(
    () => computeCompanyShares({
      manager, tenantId: 't1', fiscalYear: 2026, companyIds: ['a', 'b'], driver: 'headcount', fxRates: undefined,
    }),
    (err: unknown) =>
      err instanceof BadRequestException && /Provide headcount values/.test((err as Error).message),
  );
}

function testSingleCompanyTakesEverythingWithoutADriverValue() {
  assert.deepEqual(buildCompanyWeights(['a'], new Map(), 'headcount'), [{ id: 'a', weight: 1 }]);
  assert.deepEqual(
    buildCompanyWeights(['a'], new Map<string, number | string | null>([['a', null]]), 'it_users'),
    [{ id: 'a', weight: 1 }],
  );
}

async function testSingleCompanySharesAreOneHundredWithoutMetrics() {
  const manager = fakeManager({ companies: [{ id: 'a' }], metrics: [] });
  const shares = await computeCompanyShares({
    manager, tenantId: 't1', fiscalYear: 2026, companyIds: ['a'], driver: 'headcount', fxRates: undefined,
  });
  assert.deepEqual(Array.from(shares.entries()), [['a', 100]]);
}

async function testSingleDisabledCompanyIsStillRejected() {
  const manager = fakeManager({ companies: [], metrics: [] });
  await assert.rejects(
    () => computeCompanyShares({
      manager, tenantId: 't1', fiscalYear: 2026, companyIds: ['a'], driver: 'headcount', fxRates: undefined,
    }),
    (err: unknown) =>
      err instanceof BadRequestException && /not available for manual allocation/.test((err as Error).message),
  );
}

/**
 * The warning of turnovers left out is data, worded by each screen in the user's language;
 * the API's text fields (the AI's summary rows) get it in English.
 */
function testFxMissingWarningIsStructured() {
  assert.equal(turnoverFxMissingWarning([], 'EUR'), null);
  const warning = turnoverFxMissingWarning([
    { companyId: 'jp', companyName: 'Osaka', currency: 'JPY', year: 2026 },
    { companyId: 'us', companyName: 'New York', currency: 'USD', year: 2026 },
  ], 'EUR');
  assert.deepEqual(warning, {
    code: 'turnover_fx_missing',
    items: [
      { companyId: 'jp', companyName: 'Osaka', currency: 'JPY', year: 2026 },
      { companyId: 'us', companyName: 'New York', currency: 'USD', year: 2026 },
    ],
    reportingCurrency: 'EUR',
  });
  assert.match(describeAllocationWarning(warning!), /No EUR exchange rate for JPY in 2026, USD in 2026/);
  assert.match(describeAllocationWarning(warning!), /left out of the totals/);
}

function run() {
  testFxMissingWarningIsStructured();
  testEqualWeightsRoundToExactlyOneHundred();
  testLastEntryAbsorbsTheRoundingRemainder();
  testSingleEntryTakesEverything();
  testProportionalWeights();
  testDecimalWeights();
  testNonPositiveTotalIsRejected();
  testCompanyWeightsFollowTheDriverValues();
  testCompanyWeightsRejectMissingOrZeroValues();
  testSingleCompanyTakesEverythingWithoutADriverValue();
  testFiscalYearStart();
  return Promise.resolve()
    .then(testSharesUseDriverValues)
    .then(testTurnoverColumnIsUsedForTheTurnoverDriver)
    .then(testTurnoversInOtherCurrenciesAreConvertedAtTheVersionRates)
    .then(testTurnoverWithoutARateIsLeftOutAndReported)
    .then(testManualSplitLeavesOutTheCompanyWithoutARate)
    .then(testManualSplitWithNoRateHasNoDriver)
    .then(testSameCurrencyIsNotConverted)
    .then(testTurnoverConversionNeedsTheRates)
    .then(testCompanyDisabledForTheYearIsRejected)
    .then(testCompanyWithoutMetricIsRejected)
    .then(testSingleCompanySharesAreOneHundredWithoutMetrics)
    .then(testSingleDisabledCompanyIsStillRejected)
    .then(() => console.log('allocation-distribution: ok'));
}

void run();
