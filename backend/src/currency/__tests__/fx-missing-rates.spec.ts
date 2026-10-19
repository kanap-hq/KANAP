import * as assert from 'node:assert/strict';
import { FxIngestionService } from '../fx-ingestion.service';

/**
 * A refresh keeps a rate it already knows when this fetch does not return one,
 * and the source that produced it. A fresh real value wins over a stored one;
 * an estimate does not.
 */

function service(): FxIngestionService {
  return new FxIngestionService(
    { manager: {} } as any,
    {} as any,
    {} as any,
    { getLatestRateSet: async () => null } as any,
    {} as any,
  );
}

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    year: 2024,
    quotes: { EUR: 0.9, GBP: null, USD: 1 },
    source: 'world-bank-annual',
    missingCurrencies: ['GBP'],
    ...overrides,
  };
}

function harness(existing: Record<string, unknown> | null) {
  const saved: Array<Record<string, any>> = [];
  const repo = {
    findOne: async () => existing,
    create: (row: Record<string, unknown>) => ({ ...row }),
    save: async (row: Record<string, any>) => {
      const stored = { id: `set-${saved.length + 1}`, captured_at: new Date('2026-10-19T00:00:00Z'), ...row };
      saved.push(stored);
      return stored;
    },
  };
  const manager = { getRepository: () => repo };
  return { saved, manager };
}

const context = {
  tenantId: 'tenant-1',
  reportingCurrency: 'EUR',
  currencies: ['EUR', 'GBP', 'USD'],
};

async function testFailedFetchKeepsPreviousValueAndSource() {
  const existing = {
    id: 'old',
    tenant_id: 'tenant-1',
    fiscal_year: 2024,
    base_currency: 'EUR',
    rates: { EUR: 1, GBP: 1.17, USD: 0.92, JPY: 0.006 },
    rate_sources: {
      EUR: 'identity',
      GBP: 'exchangerateapi-spot',
      USD: 'exchangerateapi-spot',
      JPY: 'world-bank-annual',
    },
    source: 'exchangerateapi-spot',
    captured_at: new Date('2024-06-01'),
  };
  const { saved, manager } = harness(existing);
  const set = await (service() as any).saveRateSet(context, snapshot(), manager);
  assert.equal(saved.length, 1, 'the merged set is stored');
  assert.equal(set.rates.GBP, 1.17, 'a currency the fetch missed keeps its rate');
  assert.equal(set.rate_sources.GBP, 'exchangerateapi-spot', 'and the source that produced it');
  assert.equal(set.rates.JPY, 0.006, 'a currency absent from this fetch list is kept');
  assert.equal(set.rate_sources.JPY, 'world-bank-annual');
  assert.equal(set.rates.EUR, 1);
  assert.equal(set.rate_sources.EUR, 'identity');
  const usd = Number((0.9 / 1).toFixed(6));
  assert.equal(set.rates.USD, usd, 'a fresh real quote replaces the stored one');
  assert.equal(set.rate_sources.USD, 'world-bank-annual');
}

async function testEstimateDoesNotReplaceARealRate() {
  const existing = {
    id: 'old',
    tenant_id: 'tenant-1',
    fiscal_year: 2024,
    base_currency: 'EUR',
    rates: { EUR: 1, GBP: 1.17, USD: 0.9 },
    rate_sources: { EUR: 'identity', GBP: 'exchangerateapi-spot', USD: 'world-bank-annual' },
    source: 'exchangerateapi-spot',
  };
  const { saved, manager } = harness(existing);
  const fresh = snapshot({
    quotes: { EUR: 0.9, GBP: 0.8, USD: 1 },
    quoteSources: { EUR: 'world-bank-annual', GBP: 'estimate', USD: 'identity' },
    missingCurrencies: [],
    source: 'world-bank-annual',
  });
  const set = await (service() as any).saveRateSet(context, fresh, manager);
  assert.equal(saved.length, 1);
  assert.equal(set.rates.GBP, 1.17, 'a stored real rate beats a fresh estimate');
  assert.equal(set.rate_sources.GBP, 'exchangerateapi-spot');
}

async function testFreshRealReplacesStoredEstimate() {
  const existing = {
    id: 'old',
    tenant_id: 'tenant-1',
    fiscal_year: 2024,
    base_currency: 'EUR',
    rates: { EUR: 1, GBP: 1.125, USD: 0.9 },
    rate_sources: { EUR: 'identity', GBP: 'estimate', USD: 'world-bank-annual' },
    source: 'world-bank-annual',
  };
  const { saved, manager } = harness(existing);
  const fresh = snapshot({
    quotes: { EUR: 0.9, GBP: 0.75, USD: 1 },
    quoteSources: { EUR: 'world-bank-annual', GBP: 'world-bank-annual', USD: 'identity' },
    missingCurrencies: [],
  });
  const set = await (service() as any).saveRateSet(context, fresh, manager);
  assert.equal(saved.length, 1);
  assert.equal(set.rates.GBP, Number((0.9 / 0.75).toFixed(6)));
  assert.equal(set.rate_sources.GBP, 'world-bank-annual', 'a published value replaces the estimate');
}

async function testUnchangedMergedSetIsNotInserted() {
  const existing = {
    id: 'old',
    tenant_id: 'tenant-1',
    fiscal_year: 2024,
    base_currency: 'EUR',
    rates: { EUR: 1, GBP: 1.17, USD: 0.92 },
    rate_sources: null,
    source: 'world-bank-annual',
  };
  const { saved, manager } = harness(existing);
  const fresh = snapshot({ quotes: { EUR: 0.92, GBP: null, USD: 1 } });
  const set = await (service() as any).saveRateSet(context, fresh, manager);
  assert.equal(saved.length, 0, 'identical merged rates skip the insert');
  assert.equal(set.id, 'old');
}

async function testOldSetWithoutProvenanceLendsItsSource() {
  const existing = {
    id: 'old',
    tenant_id: 'tenant-1',
    fiscal_year: 2024,
    base_currency: 'EUR',
    rates: { EUR: 1, GBP: 1.17 },
    source: 'exchangerateapi-spot',
  };
  const { saved, manager } = harness(existing);
  const set = await (service() as any).saveRateSet(
    { ...context, currencies: ['EUR', 'GBP'] },
    snapshot({ quotes: { EUR: 0.9, GBP: null, USD: 1 } }),
    manager,
  );
  assert.equal(saved.length, 1);
  assert.equal(set.rates.GBP, 1.17);
  assert.equal(set.rate_sources.GBP, 'exchangerateapi-spot', 'the set source stands in for a missing rate_sources');
}

function annualClient(annual: Record<string, Record<number, number>>, spot: Record<string, number | null> = {}) {
  return {
    resolveCode: (currency: string) => (currency.toUpperCase() === 'USD' ? 'USA' : currency.toUpperCase()),
    fetchAnnualRates: async (currency: string, startYear: number, endYear: number) => {
      const series = annual[currency.toUpperCase()] ?? {};
      const map = new Map<number, number>();
      const first = Math.min(startYear, endYear);
      const last = Math.max(startYear, endYear);
      for (let year = first; year <= last; year += 1) {
        if (series[year] != null) map.set(year, series[year]);
      }
      return map;
    },
    fetchSpotRate: async (currency: string) => {
      const upper = currency.toUpperCase();
      return Object.prototype.hasOwnProperty.call(spot, upper) ? spot[upper] : null;
    },
  };
}

/**
 * A past year the World Bank has not published takes the nearest published
 * year (closest earlier, otherwise closest later) as an estimate. A real rate
 * captured for that year beats the estimate. The published value replaces both.
 * The reporting currency follows the same chain, so a missing base quote with
 * an estimate still stores the year.
 */
async function testPastYearEstimateChain() {
  const annual: Record<string, Record<number, number>> = {
    EUR: { 2020: 0.9 },
    GBP: { 2010: 0.7, 2021: 0.99 },
    JPY: { 2021: 110 },
  };
  const fx = new FxIngestionService(
    { manager: {} } as any,
    {} as any,
    {} as any,
    { getLatestRateSet: async () => null } as any,
    annualClient(annual) as any,
  );
  const ctx = { tenantId: 't', reportingCurrency: 'EUR', currencies: ['EUR', 'GBP', 'JPY', 'USD'] };
  const sets: Array<Record<string, any>> = [];
  const repo = {
    findOne: async () => sets[sets.length - 1] ?? null,
    create: (row: Record<string, unknown>) => ({ ...row }),
    save: async (row: Record<string, any>) => {
      const stored = { id: `s${sets.length + 1}`, captured_at: new Date(), ...row };
      sets.push(stored);
      return stored;
    },
  };
  const manager = { getRepository: () => repo };
  const snap = async () => ((await (fx as any).buildYearlySnapshots(ctx, [2020])) as Array<Record<string, any>>)[0];

  const first = await snap();
  assert.equal(first.quotes.GBP, 0.7, 'an earlier published year wins over a closer later one');
  assert.equal(first.quoteSources.GBP, 'estimate');
  assert.equal(first.quotes.JPY, 110, 'with no earlier year, the closest later year is the estimate');
  assert.equal(first.quoteSources.JPY, 'estimate');
  assert.equal(first.quotes.EUR, 0.9);
  assert.equal(first.quoteSources.EUR, 'world-bank-annual');
  assert.equal(first.source, 'world-bank-annual');
  assert.ok(!first.missingCurrencies.includes('GBP'));

  const estimated = await (fx as any).saveRateSet(ctx, first, manager);
  assert.equal(estimated.rates.GBP, Number((0.9 / 0.7).toFixed(6)));
  assert.equal(estimated.rate_sources.GBP, 'estimate');
  assert.equal(estimated.rate_sources.EUR, 'identity');

  sets[sets.length - 1] = {
    ...estimated,
    rates: { ...estimated.rates, GBP: 1.17 },
    rate_sources: { ...estimated.rate_sources, GBP: 'exchangerateapi-spot' },
  };
  const held = await (fx as any).saveRateSet(ctx, await snap(), manager);
  assert.equal(held.rates.GBP, 1.17, 'the spot captured for that year beats the estimate');
  assert.equal(held.rate_sources.GBP, 'exchangerateapi-spot');

  annual.GBP[2020] = 0.75;
  const published = await snap();
  assert.equal(published.quotes.GBP, 0.75);
  assert.equal(published.quoteSources.GBP, 'world-bank-annual');
  const replaced = await (fx as any).saveRateSet(ctx, published, manager);
  assert.equal(replaced.rates.GBP, Number((0.9 / 0.75).toFixed(6)));
  assert.equal(replaced.rate_sources.GBP, 'world-bank-annual', 'the published value replaces the captured rate and the estimate');
}

async function testEstimatedBaseStillStoresTheYear() {
  const fx = new FxIngestionService(
    { manager: {} } as any,
    {} as any,
    {
      getSettings: async () => ({
        reportingCurrency: 'CHF',
        defaultCapexCurrency: 'CHF',
        defaultSpendCurrency: 'CHF',
        allowedCurrencies: ['EUR'],
      }),
      ensureCurrencyRecords: async () => undefined,
    } as any,
    { getLatestRateSet: async () => null } as any,
    annualClient({ CHF: { 2019: 0.95 }, EUR: { 2020: 0.9 } }) as any,
  );
  const saved: Array<Record<string, any>> = [];
  const manager = {
    queryRunner: {},
    query: async () => [],
    getRepository: () => ({
      findOne: async () => null,
      create: (row: Record<string, unknown>) => ({ ...row }),
      save: async (row: Record<string, any>) => {
        const stored = { id: 'chf-2020', ...row };
        saved.push(stored);
        return stored;
      },
    }),
  };
  const sets = await fx.refreshTenant('tenant-1', [2020], { manager: manager as any });
  assert.equal(sets.length, 1, 'an estimate for the reporting currency stores the year');
  assert.equal(saved[0].rates.CHF, 1);
  assert.equal(saved[0].rate_sources.CHF, 'identity');
  assert.equal(saved[0].rates.EUR, Number((0.95 / 0.9).toFixed(6)));
  assert.equal(saved[0].rate_sources.EUR, 'world-bank-annual');
  assert.equal(saved[0].source, 'world-bank-annual');
}

/**
 * A refresh that asks only for the current year, with the spot feed down, still
 * falls back to the latest published year. The same fallback covers a future
 * year requested on its own.
 */
async function testCurrentYearAloneFallsBackToLatestPublished() {
  const currentYear = new Date().getFullYear();
  const calls: Array<{ currency: string; start: number; end: number }> = [];
  const annual: Record<string, Record<number, number>> = {
    EUR: { [currentYear - 12]: 0.5, [currentYear - 4]: 0.88, [currentYear - 1]: 0.91 },
    GBP: { [currentYear - 3]: 0.78 },
    OLD: { [currentYear - 12]: 2 },
  };
  const fx = new FxIngestionService(
    { manager: {} } as any,
    {} as any,
    {} as any,
    { getLatestRateSet: async () => null } as any,
    {
      ...annualClient(annual, { EUR: null, GBP: null }),
      fetchAnnualRates: async (currency: string, startYear: number, endYear: number) => {
        calls.push({ currency: currency.toUpperCase(), start: startYear, end: endYear });
        return annualClient(annual).fetchAnnualRates(currency, startYear, endYear);
      },
    } as any,
  );
  const ctx = { tenantId: 't', reportingCurrency: 'EUR', currencies: ['EUR', 'GBP', 'OLD'] };
  const [current] = await (fx as any).buildYearlySnapshots(ctx, [currentYear]);
  assert.equal(current.quotes.EUR, 0.91, 'the latest year inside the ten-year window');
  assert.equal(current.quoteSources.EUR, 'world-bank-forward');
  assert.equal(current.source, 'world-bank-forward');
  assert.equal(current.quotes.GBP, 0.78);
  assert.equal(current.quoteSources.GBP, 'world-bank-forward');
  assert.equal(current.quotes.OLD, null, 'a publication older than the ten-year window is not the fallback');
  const fallback = calls.filter((call) => call.currency === 'EUR' && call.start === currentYear - 10 && call.end === currentYear - 1);
  assert.equal(fallback.length, 1, 'the current year alone reads the published window');

  calls.length = 0;
  const [future] = await (fx as any).buildYearlySnapshots(ctx, [currentYear + 2]);
  assert.equal(future.quotes.EUR, 0.91);
  assert.equal(future.quoteSources.EUR, 'world-bank-forward');
  assert.equal(future.source, 'world-bank-forward');
  assert.ok(
    calls.some((call) => call.currency === 'EUR' && call.start === currentYear - 10 && call.end === currentYear - 1),
    'a future year requested alone reads the same window',
  );
}

(async () => {
  await testFailedFetchKeepsPreviousValueAndSource();
  await testEstimateDoesNotReplaceARealRate();
  await testFreshRealReplacesStoredEstimate();
  await testUnchangedMergedSetIsNotInserted();
  await testOldSetWithoutProvenanceLendsItsSource();
  await testPastYearEstimateChain();
  await testEstimatedBaseStillStoresTheYear();
  await testCurrentYearAloneFallsBackToLatestPublished();
  console.log('FX refresh keeps a known rate.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
