import * as assert from 'node:assert/strict';
import { CompaniesService } from '../companies.service';

/**
 * `GET /companies/totals`: turnovers are entered in millions of each company's base currency;
 * the total is converted into the reporting currency at the live rates of the requested year.
 * Headcount and IT users are plain sums.
 */

/** A query builder that records its calls and answers `rows` (one per base currency). */
function fakeRepo(rows: any[]) {
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
  const repo = { manager: { marker: 'tenant-manager' }, createQueryBuilder: () => qb };
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

function service(rows: any[], fx: any) {
  const { repo, calls } = fakeRepo(rows);
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

async function testMissingRateIsCountedUnconvertedAndNamed() {
  const fx = fakeFx('EUR', {});
  const { svc } = service([
    { currency: 'EUR', headcount: '300', it_users: '250', turnover: '120.5' },
    { currency: 'USD', headcount: '80', it_users: '60', turnover: '35' },
  ], fx);
  const totals = await svc.totals({ year: '2027' }, { tenantId: 't1' });
  assert.equal(totals.turnover, 155.5);
  assert.equal(totals.year, 2027);
  assert.deepEqual(totals.turnover_fx_missing, ['USD']);
}

async function testNoCompanyGivesZero() {
  const fx = fakeFx('EUR', {});
  const { svc } = service([], fx);
  const totals = await svc.totals({ year: '2026' }, { tenantId: 't1' });
  assert.deepEqual(totals, { headcount: 0, it_users: 0, turnover: 0, turnover_currency: 'EUR', turnover_fx_missing: [], year: 2026 });
}

async function testTenantIsRequired() {
  const { svc } = service([], fakeFx('EUR', {}));
  await assert.rejects(() => svc.totals({}, { tenantId: '' }), /tenant/);
}

Promise.resolve()
  .then(testTurnoverIsConvertedIntoTheReportingCurrency)
  .then(testSameCurrencyIsNotConverted)
  .then(testMissingRateIsCountedUnconvertedAndNamed)
  .then(testNoCompanyGivesZero)
  .then(testTenantIsRequired)
  .then(() => console.log('companies-totals-fx: ok'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
