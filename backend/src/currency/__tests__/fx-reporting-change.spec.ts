import * as assert from 'node:assert/strict';
import { CurrencyController } from '../currency.controller';

/**
 * Saving a new reporting currency refreshes every year of that base and
 * answers with the same block as a forced sync. Saving anything else still
 * refreshes the current year and answers the settings alone.
 */

type Settings = {
  reportingCurrency: string;
  defaultSpendCurrency: string;
  defaultCapexCurrency: string;
  allowedCurrencies: string[] | null;
};

function settings(reportingCurrency: string): Settings {
  return {
    reportingCurrency,
    defaultSpendCurrency: 'EUR',
    defaultCapexCurrency: 'EUR',
    allowedCurrencies: null,
  };
}

type SaveAnswer = Settings & {
  completed?: boolean;
  years?: number[];
  fetched?: number;
  stillMissing?: Array<{ currency: string; year: number }>;
};

function harness(opts: { before: string; after: string; completed?: boolean }) {
  const order: string[] = [];
  const ensured: string[][] = [];
  const refreshWithinCalls: Array<{ years: number[]; opts: unknown }> = [];
  const refreshTenantCalls: unknown[][] = [];
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  let rateReads = 0;
  const years = [2019, 2024, 2025, 2026, 2027, 2028];
  const currency = {
    getSettings: async () => {
      order.push('read');
      return settings(opts.before);
    },
    updateSettings: async () => {
      order.push('update');
      return settings(opts.after);
    },
    ensureCurrencyRecords: async (codes: Iterable<string>) => {
      order.push('ensure');
      ensured.push(Array.from(codes));
    },
  };
  const fxIngestion = {
    refreshWithin: async (_tenantId: string, calledYears: number[], callOpts: unknown) => {
      order.push('refresh-within');
      refreshWithinCalls.push({ years: calledYears, opts: callOpts });
      return { completed: opts.completed ?? true };
    },
    refreshTenant: async (...args: unknown[]) => {
      order.push('refresh-tenant');
      refreshTenantCalls.push(args);
      return [];
    },
  };
  const manualRates = {
    reportingChangeYears: async () => years,
    listMissingPairs: async () => [{ currency: 'SEK', year: 2028 }],
  };
  const manager = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (!sql.includes('currency_rate_sets')) return [];
      rateReads += 1;
      if (rateReads === 1) return [];
      return [{ fiscal_year: 2024, rates: { USD: 0.9, EUR: 0.95, XXX: 0, empty: null } }];
    },
  };
  const api = new CurrencyController(currency as any, fxIngestion as any, manualRates as any, { manager } as any);
  const req = { tenant: { id: 'tenant-1' }, user: { sub: null }, queryRunner: { manager } };
  return { api, req, order, ensured, refreshWithinCalls, refreshTenantCalls, queries, years };
}

async function testUnchangedReportingCurrencyRefreshesTheCurrentYear() {
  const { api, req, order, ensured, refreshWithinCalls, refreshTenantCalls } = harness({ before: 'EUR', after: 'EUR' });
  const saved = await api.updateSettings({ defaultSpendCurrency: 'USD' }, req) as SaveAnswer;
  assert.equal('completed' in saved, false);
  assert.equal(saved.reportingCurrency, 'EUR');
  assert.deepEqual(ensured, []);
  assert.deepEqual(refreshWithinCalls, []);
  assert.equal(refreshTenantCalls.length, 1);
  assert.equal(refreshTenantCalls[0][1], new Date().getFullYear());
  assert.deepEqual(order, ['read', 'update', 'refresh-tenant']);
  console.log('ok - a save that keeps the reporting currency answers the settings and refreshes the current year');
}

async function testChangedCurrencyStillRunning() {
  const { api, req, order, ensured, refreshWithinCalls, years } = harness({ before: 'EUR', after: 'CHF', completed: false });
  const saved = await api.updateSettings({ reportingCurrency: 'chf' }, req) as SaveAnswer;
  assert.equal(saved.reportingCurrency, 'CHF');
  assert.equal(saved.completed, false);
  assert.deepEqual(saved.years, years);
  assert.equal('fetched' in saved, false);
  assert.equal('stillMissing' in saved, false);
  assert.deepEqual(ensured, [['CHF']]);
  assert.deepEqual(order, ['read', 'ensure', 'update', 'refresh-within']);
  assert.equal(refreshWithinCalls.length, 1);
  assert.deepEqual(refreshWithinCalls[0].years, years);
  assert.deepEqual(refreshWithinCalls[0].opts, {
    label: 'reporting-currency',
    reportingCurrency: 'CHF',
    enqueueAfter: true,
  });
  console.log('ok - a new reporting currency still being fetched names the years and nothing else');
}

async function testChangedCurrencyFinished() {
  const { api, req, queries } = harness({ before: 'EUR', after: 'CHF', completed: true });
  const saved = await api.updateSettings({ reportingCurrency: 'CHF' }, req) as SaveAnswer;
  assert.equal(saved.completed, true);
  if (!saved.completed) return;
  assert.equal(saved.fetched, 2, 'USD and EUR became usable on the new base; 0 and null did not');
  assert.deepEqual(saved.stillMissing, [{ currency: 'SEK', year: 2028 }]);
  const rateQueries = queries.filter((query) => query.sql.includes('currency_rate_sets'));
  assert.equal(rateQueries.length, 2);
  for (const query of rateQueries) {
    assert.match(query.sql, /UPPER\(TRIM\(base_currency\)\) = \$3/);
    assert.equal(query.params?.[2], 'CHF');
  }
  console.log('ok - a finished reporting-currency refresh counts pairs of the new base');
}

(async () => {
  await testUnchangedReportingCurrencyRefreshesTheCurrentYear();
  await testChangedCurrencyStillRunning();
  await testChangedCurrencyFinished();
  console.log('fx-reporting-change.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
