import * as assert from 'node:assert/strict';
import { contractFxRates } from '../contract-budget';

/**
 * Contract amounts convert with the year's latest rate set. A year in which a
 * contract currency of the tenant has no rate is reported, so the FX refresh
 * can fetch it. The reporting currency is never missing.
 */

function harness(sets: Record<number, { rates: Record<string, number> } | null>, currencies: Array<string | null>) {
  const calls: Array<{ tenantId: string; years: number[] }> = [];
  const queries: string[] = [];
  const fx = {
    resolveRates: async () => ({ map: new Map(), settings: { reportingCurrency: 'EUR' } }),
    getLatestRateSet: async (_tenantId: string, year: number) => sets[year] ?? null,
    reportMissingYears: (tenantId: string, years: number[]) => calls.push({ tenantId, years }),
  };
  const manager = {
    query: async (sql: string, params: unknown[]) => {
      queries.push(sql);
      assert.match(sql, /SELECT DISTINCT UPPER\(currency\)/);
      assert.match(sql, /FROM contracts/);
      assert.match(sql, /tenant_id = \$1/);
      assert.deepEqual(params, ['tenant-1']);
      return currencies.map((currency) => ({ currency }));
    },
  };
  return { fx, manager, calls, queries };
}

async function testMissingContractYearsAreReported() {
  const { fx, manager, calls } = harness(
    {
      2024: { rates: { EUR: 1, USD: 0.9 } },
      2025: { rates: { EUR: 1 } },
      2026: { rates: { EUR: 1, USD: 0.92, GBP: 1.17 } },
    },
    ['usd', 'GBP', 'EUR', 'EU', null],
  );
  const rates = await contractFxRates(fx as any, manager as any, 'tenant-1', [2024, 2025, 2026, 2024]);
  assert.equal(rates.reportingCurrency, 'EUR');
  assert.equal(rates.rateOf(2024, 'USD'), 0.9);
  assert.equal(rates.rateOf(2024, 'GBP'), null);
  assert.equal(rates.rateOf(2024, 'EUR'), 1);
  assert.equal(rates.rateOf(2025, 'USD'), null);
  assert.equal(rates.rateOf(2026, 'GBP'), 1.17);
  assert.deepEqual(calls, [{ tenantId: 'tenant-1', years: [2024, 2025] }], '2026 rates every contract currency');
}

async function testCompleteYearsStayQuiet() {
  const { fx, manager, calls } = harness(
    { 2024: { rates: { EUR: 1, CHF: 0.95 } } },
    ['CHF', 'EUR'],
  );
  const rates = await contractFxRates(fx as any, manager as any, 'tenant-1', [2024]);
  assert.equal(rates.rateOf(2024, 'CHF'), 0.95);
  assert.deepEqual(calls, []);
}

(async () => {
  await testMissingContractYearsAreReported();
  await testCompleteYearsStayQuiet();
  console.log('contract FX rates report missing years.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});