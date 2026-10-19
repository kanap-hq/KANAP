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

(async () => {
  await testFailedFetchKeepsPreviousValueAndSource();
  await testEstimateDoesNotReplaceARealRate();
  await testFreshRealReplacesStoredEstimate();
  await testUnchangedMergedSetIsNotInserted();
  await testOldSetWithoutProvenanceLendsItsSource();
  console.log('FX refresh keeps a known rate.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
