import * as assert from 'node:assert/strict';
import { CompaniesService } from '../companies.service';

/**
 * `GET /companies/totals`: turnovers are entered in millions of each company's base currency;
 * the total is converted into the reporting currency at the rates of the requested year (the
 * rate set the year is frozen at, else the live rates).
 * Headcount and IT users are plain sums.
 */

/** A query builder that records its calls and answers `rows` (one per base currency). */
function fakeRepo(rows: any[], frozenSet: string | null = null) {
  const calls: Array<{ method: string; args: any[] }> = [];
  const qb: any = new Proxy({}, {
    get(_target, prop: string) {
      if (prop === 'getRawMany') return async () => rows;
      return (...args: any[]) => {
        calls.push({ method: prop, args });
        return qb;
      };
    },
  });
  const manager = {
    marker: 'tenant-manager',
    // The rate set the year's versions are frozen at (`yearRateSetId`).
    query: async (sql: string, params: unknown[]) => {
      calls.push({ method: 'query', args: [sql, params] });
      return /FROM spend_versions/.test(sql) && frozenSet ? [{ id: frozenSet }] : [];
    },
  };
  const repo = { manager, createQueryBuilder: () => qb };
  return { repo, calls };
}

function fakeFx(reportingCurrency: string, rates: Record<string, number>) {
  const calls: any[] = [];
  return {
    calls,
    resolveRates: async (tenantId: string, lookups: any[], opts: any) => {
      calls.push({ tenantId, lookups, opts });
      const map = new Map<string, any>();
      for (const l of lookups) {
        const currency = String(l.sourceCurrency).toUpperCase();
        const key = `${l.rateSetId || 'live'}:${l.fiscalYear}:${currency}`;
        const same = currency === reportingCurrency;
        const rate = same ? 1 : rates[key];
        map.set(key, {
          rate: rate ?? 1, rateSetId: null, fiscalYear: l.fiscalYear, reportingCurrency,
          source: same ? 'identity' : rate != null ? 'live' : 'missing', capturedAt: null,
        });
      }
      return { map, settings: { reportingCurrency } };
    },
  };
}

function service(rows: any[], fx: any, frozenSet: string | null = null) {
  const { repo, calls } = fakeRepo(rows, frozenSet);
  const svc = new CompaniesService(repo as any, {} as any, {} as any, fx);
  return { svc, calls };
}

async function testTurnoverIsConvertedIntoTheReportingCurrency() {
  const fx = fakeFx('EUR', { 'live:2026:USD': 0.9 });
  const { svc, calls } = service([
    { currency: 'EUR', headcount: '300', it_users: '250', turnover: '120.5' },
    { currency: 'USD', headcount: '80', it_users: '60', turnover: '35' },
  ], fx);
  const totals = await svc.totals({ year: '2026' }, { tenantId: 't1' });
  // 120.5 + 35 × 0.9 = 152, not 155.5.
  assert.deepEqual(totals, {
    headcount: 380, it_users: 310, turnover: 152, turnover_currency: 'EUR', turnover_fx_missing: [], year: 2026,
  });
  assert.equal(fx.calls[0].tenantId, 't1');
  assert.deepEqual(fx.calls[0].lookups.map((l: any) => [l.rateSetId, l.fiscalYear, l.sourceCurrency]), [[null, 2026, 'EUR'], [null, 2026, 'USD']]);
  // Scoped by tenant on the companies and their metrics, grouped by currency.
  assert.ok(calls.some((c) => c.method === 'where' && /c\.tenant_id = :tenantId/.test(c.args[0]) && c.args[1].tenantId === 't1'));
  assert.ok(calls.some((c) => c.method === 'leftJoin' && /m\.tenant_id = c\.tenant_id/.test(c.args[2])));
  assert.ok(calls.some((c) => c.method === 'groupBy'));
}

async function testFrozenYearConvertsAtItsRateSet() {
  const fx = fakeFx('EUR', { 'live:2026:USD': 0.9, 'set-1:2026:USD': 0.8 });
  const { svc, calls } = service([
    { currency: 'EUR', headcount: '300', it_users: '250', turnover: '120.5' },
    { currency: 'USD', headcount: '80', it_users: '60', turnover: '35' },
  ], fx, 'set-1');
  const totals = await svc.totals({ year: '2026' }, { tenantId: 't1' });
  // The year is frozen: 120.5 + 35 × 0.8 = 148.5, as its versions and their allocations.
  assert.equal(totals.turnover, 148.5);
  assert.deepEqual(fx.calls[0].lookups.map((l: any) => l.rateSetId), ['set-1', 'set-1']);
  const yearSet = calls.find((c) => c.method === 'query');
  assert.ok(yearSet && /tenant_id = \$1/.test(yearSet.args[0]));
  assert.deepEqual(yearSet!.args[1], ['t1', 2026]);
}

async function testSameCurrencyIsNotConverted() {
  const fx = fakeFx('USD', {});
  const { svc } = service([
    { currency: 'USD', headcount: '80', it_users: '60', turnover: '35.123' },
    { currency: null, headcount: '1', it_users: '1', turnover: '1' },
  ], fx);
  const totals = await svc.totals({ year: '2026' }, { tenantId: 't1' });
  assert.equal(totals.turnover, 36.123);
  assert.equal(totals.turnover_currency, 'USD');
  assert.deepEqual(totals.turnover_fx_missing, []);
}

async function testMissingRateIsLeftOutAndNamed() {
  const fx = fakeFx('EUR', {});
  const { svc } = service([
    { currency: 'EUR', headcount: '300', it_users: '250', turnover: '120.5', companies: '2' },
    { currency: 'USD', headcount: '80', it_users: '60', turnover: '35', companies: '1' },
  ], fx);
  const totals = await svc.totals({ year: '2027' }, { tenantId: 't1' });
  assert.equal(totals.turnover, 120.5);
  assert.equal(totals.headcount, 380);
  assert.equal(totals.year, 2027);
  assert.deepEqual(totals.turnover_fx_missing, [{ currency: 'USD', year: 2027, companies: 1 }]);
}

async function testNoCompanyGivesNoTurnover() {
  const fx = fakeFx('EUR', {});
  const { svc, calls } = service([], fx);
  const totals = await svc.totals({ year: '2026' }, { tenantId: 't1' });
  assert.deepEqual(totals, { headcount: null, it_users: null, turnover: null, turnover_currency: 'EUR', turnover_fx_missing: [], year: 2026 });
  // SUM without COALESCE: an all-blank year stays null instead of a zero total.
  assert.ok(calls.some((c) => c.method === 'addSelect' && c.args[0] === 'SUM(m.headcount)' && c.args[1] === 'headcount'));
  assert.ok(calls.some((c) => c.method === 'addSelect' && c.args[0] === 'SUM(m.it_users)' && c.args[1] === 'it_users'));
  assert.ok(calls.some((c) => c.method === 'addSelect' && c.args[0] === 'SUM(m.turnover)' && c.args[1] === 'turnover'));
}

async function testYearWithNoMetricsIsNull() {
  const fx = fakeFx('EUR', {});
  const { svc } = service([
    { currency: 'EUR', headcount: null, it_users: null, turnover: null, companies: '0' },
    { currency: 'USD', headcount: null, it_users: null, turnover: null, companies: '0' },
  ], fx);
  const totals = await svc.totals({ year: '2028' }, { tenantId: 't1' });
  assert.equal(totals.headcount, null);
  assert.equal(totals.it_users, null);
  assert.equal(totals.turnover, null);
}

async function testEnteredZeroHeadcountStaysZero() {
  const fx = fakeFx('EUR', {});
  const { svc } = service([
    { currency: 'EUR', headcount: null, it_users: null, turnover: null, companies: '0' },
    { currency: 'USD', headcount: '0', it_users: '0', turnover: null, companies: '0' },
  ], fx);
  const totals = await svc.totals({ year: '2028' }, { tenantId: 't1' });
  // EUR has nothing. USD entered zeros, which stay zero. Turnover was never entered.
  assert.equal(totals.headcount, 0);
  assert.equal(totals.it_users, 0);
  assert.equal(totals.turnover, null);
}

async function testYearWithNoTurnoverEnteredIsNull() {
  const fx = fakeFx('EUR', {});
  const { svc } = service([
    { currency: 'EUR', headcount: '10', it_users: '4', turnover: null, companies: '0' },
    { currency: 'USD', headcount: '3', it_users: '1', turnover: null, companies: '0' },
  ], fx);
  const totals = await svc.totals({ year: '2028' }, { tenantId: 't1' });
  assert.equal(totals.turnover, null);
  assert.equal(totals.headcount, 13);
  assert.equal(totals.it_users, 5);
  assert.equal(totals.turnover_currency, 'EUR');
  assert.deepEqual(totals.turnover_fx_missing, []);
  assert.deepEqual(fx.calls[0].lookups, []);
}

async function testEnteredZeroTurnoverStaysZero() {
  const fx = fakeFx('EUR', {});
  const { svc } = service([
    { currency: 'EUR', headcount: '10', it_users: '4', turnover: '0', companies: '0' },
  ], fx);
  const totals = await svc.totals({ year: '2026' }, { tenantId: 't1' });
  assert.equal(totals.turnover, 0);
  assert.equal(totals.headcount, 10);
}

async function testBlankCurrencyDoesNotEraseAnother() {
  const fx = fakeFx('EUR', { 'live:2026:USD': 0.9 });
  const { svc } = service([
    { currency: 'EUR', headcount: '10', it_users: '4', turnover: null, companies: '0' },
    { currency: 'USD', headcount: '3', it_users: '1', turnover: '10', companies: '1' },
  ], fx);
  const totals = await svc.totals({ year: '2026' }, { tenantId: 't1' });
  assert.equal(totals.turnover, 9);
  assert.equal(totals.headcount, 13);
  assert.deepEqual(fx.calls[0].lookups.map((l: any) => l.sourceCurrency), ['USD']);
}

async function testTenantIsRequired() {
  const { svc } = service([], fakeFx('EUR', {}));
  await assert.rejects(() => svc.totals({}, { tenantId: '' }), /tenant/);
}

Promise.resolve()
  .then(testTurnoverIsConvertedIntoTheReportingCurrency)
  .then(testFrozenYearConvertsAtItsRateSet)
  .then(testSameCurrencyIsNotConverted)
  .then(testMissingRateIsLeftOutAndNamed)
  .then(testNoCompanyGivesNoTurnover)
  .then(testYearWithNoMetricsIsNull)
  .then(testEnteredZeroHeadcountStaysZero)
  .then(testYearWithNoTurnoverEnteredIsNull)
  .then(testEnteredZeroTurnoverStaysZero)
  .then(testBlankCurrencyDoesNotEraseAnother)
  .then(testTenantIsRequired)
  .then(() => console.log('companies-totals-fx: ok'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
