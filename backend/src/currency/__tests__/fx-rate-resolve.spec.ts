import * as assert from 'node:assert/strict';
import { FxIngestionService } from '../fx-ingestion.service';
import { FxRateService } from '../fx-rate.service';

// The source `resolveRates` gives each lookup: a currency the year's live set
// does not rate is `missing` (counted at 1), never `live`. The years with a
// missing rate go to the FX ingestion, which fetches them once in a while.

const LIVE_2025 = { id: 'live-2025', tenant_id: 't', fiscal_year: 2025, base_currency: 'EUR', rates: { EUR: 1 }, captured_at: new Date('2026-10-06') };
const LIVE_2026 = { id: 'live-2026', tenant_id: 't', fiscal_year: 2026, base_currency: 'EUR', rates: { EUR: 1, USD: 0.9 }, captured_at: new Date('2026-10-12') };
const FROZEN_2026 = { id: 'frozen-2026', tenant_id: 't', fiscal_year: 2026, base_currency: 'EUR', rates: { EUR: 1 }, captured_at: new Date('2026-01-15') };

function createService() {
  const sets = [LIVE_2025, LIVE_2026, FROZEN_2026];
  const repo = {
    find: async ({ where }: any) => sets.filter((set) => where.id.value.includes(set.id)),
    findOne: async ({ where }: any) =>
      sets.filter((set) => set.fiscal_year === where.fiscal_year && set.id.startsWith('live')).at(0) ?? null,
  };
  const settings = { getSettings: async () => ({ reportingCurrency: 'EUR' }) };
  const service = new FxRateService(repo as any, settings as any);
  (service as any).logger = { warn: () => undefined };
  return service;
}

async function resolve(rateSetId: string | null, fiscalYear: number, sourceCurrency: string) {
  const { map } = await createService().resolveRates('t', [{ key: '', rateSetId, fiscalYear, sourceCurrency }]);
  const rate = map.get(`${rateSetId || 'live'}:${fiscalYear}:${sourceCurrency}`);
  assert.ok(rate, `a rate for ${rateSetId || 'live'} ${fiscalYear} ${sourceCurrency}`);
  return rate!;
}

async function testCurrencyMissingFromLiveSet() {
  const rate = await resolve(null, 2025, 'USD');
  assert.equal(rate.rate, 1);
  assert.equal(rate.source, 'missing');
}

async function testCurrencyInLiveSet() {
  const rate = await resolve(null, 2026, 'USD');
  assert.equal(rate.rate, 0.9);
  assert.equal(rate.source, 'live');
  assert.equal(rate.rateSetId, 'live-2026');
}

async function testReportingCurrencyIsIdentity() {
  for (const year of [2025, 2026, 2030]) {
    const rate = await resolve(null, year, 'EUR');
    assert.equal(rate.rate, 1);
    assert.equal(rate.source, 'identity', `EUR in ${year}`);
  }
}

async function testNoSetForTheYear() {
  const rate = await resolve(null, 2030, 'USD');
  assert.equal(rate.rate, 1);
  assert.equal(rate.source, 'missing');
}

async function testFrozenSetFallsBackToLive() {
  const rate = await resolve('frozen-2026', 2026, 'USD');
  assert.equal(rate.rate, 0.9);
  assert.equal(rate.source, 'live');
  assert.equal(rate.via, null, 'the pin and the reporting currency share a base');
}

// A pinned set kept after the reporting currency changed. The frozen rate stays
// the anchor: pinned[source → old base] × the live rate of that old base.
const PIN_EUR = {
  id: 'pin-2025', tenant_id: 't', fiscal_year: 2025, base_currency: 'EUR',
  rates: { EUR: 1, USD: 0.5, CHF: 4 }, captured_at: new Date('2025-01-15'),
};
const LIVE_CHF = {
  id: 'live-chf-2025', tenant_id: 't', fiscal_year: 2025, base_currency: 'CHF',
  rates: { CHF: 1, EUR: 0.5 }, captured_at: new Date('2026-10-01'),
};

function createCrossService(withLive: boolean) {
  const sets = withLive ? [PIN_EUR, LIVE_CHF] : [PIN_EUR];
  const repo = {
    find: async ({ where }: any) => sets.filter((set) => where.id.value.includes(set.id)),
    findOne: async ({ where }: any) =>
      sets.find((set) => set.fiscal_year === where.fiscal_year && set.base_currency === where.base_currency && set.id.startsWith('live')) ?? null,
  };
  const settings = { getSettings: async () => ({ reportingCurrency: 'CHF' }) };
  const service = new FxRateService(repo as any, settings as any);
  (service as any).logger = { warn: () => undefined };
  return service;
}

async function crossRate(sourceCurrency: string, withLive = true) {
  const service = createCrossService(withLive);
  const { map } = await service.resolveRates('t', [{ key: '', rateSetId: 'pin-2025', fiscalYear: 2025, sourceCurrency }]);
  const rate = map.get(`pin-2025:2025:${sourceCurrency}`);
  assert.ok(rate, sourceCurrency);
  return rate!;
}

async function testPinnedCrossRate() {
  const usd = await crossRate('USD');
  assert.equal(usd.rate, 0.25, '0.5 USD→EUR × 0.5 EUR→CHF');
  assert.equal(usd.source, 'snapshot');
  assert.equal(usd.via, 'EUR');
  assert.equal(usd.rateSetId, 'pin-2025');
  assert.equal(usd.reportingCurrency, 'CHF');

  const eur = await crossRate('EUR');
  assert.equal(eur.rate, 0.5, 'the old base takes the live rate alone');
  assert.equal(eur.source, 'live');
  assert.equal(eur.via, 'EUR');
  assert.equal(eur.rateSetId, 'pin-2025');
  assert.equal(eur.reportingCurrency, 'CHF');

  const chf = await crossRate('CHF');
  assert.equal(chf.rate, 2, '4 CHF→EUR × 0.5 EUR→CHF, not the identity 1');
  assert.equal(chf.source, 'snapshot');
  assert.equal(chf.via, 'EUR');
  assert.equal(chf.reportingCurrency, 'CHF');
}

async function testPinnedCrossRateMissingLive() {
  const service = createCrossService(false);
  const calls: Array<{ tenantId: string; years: number[] }> = [];
  service.onMissingRates((tenantId, years) => calls.push({ tenantId, years }));
  const { map } = await service.resolveRates('t', ['USD', 'EUR', 'CHF'].map((sourceCurrency) => ({
    key: '', rateSetId: 'pin-2025', fiscalYear: 2025, sourceCurrency,
  })));
  for (const sourceCurrency of ['USD', 'EUR', 'CHF']) {
    const rate = map.get(`pin-2025:2025:${sourceCurrency}`);
    assert.equal(rate?.source, 'missing', sourceCurrency);
    assert.equal(rate?.rate, 1, sourceCurrency);
    assert.equal(rate?.via, 'EUR', sourceCurrency);
    assert.equal(rate?.rateSetId, 'pin-2025', sourceCurrency);
    assert.equal(rate?.reportingCurrency, 'CHF', sourceCurrency);
  }
  assert.deepEqual(calls, [{ tenantId: 't', years: [2025] }], 'the year is fetched once');
}

async function testPinnedCurrencyAbsentFallsBackToLive() {
  const service = createCrossService(true);
  const { map } = await service.resolveRates('t', [{ key: '', rateSetId: 'pin-2025', fiscalYear: 2025, sourceCurrency: 'JPY' }]);
  const rate = map.get('pin-2025:2025:JPY');
  assert.equal(rate?.source, 'missing', 'the pin has no JPY, and neither does the live set');
  assert.equal(rate?.via, null, 'a currency the pin does not rate is not a cross rate');
}

async function testFrozenAndLiveSetsBothMissing() {
  const rate = await resolve('frozen-2026', 2025, 'USD');
  assert.equal(rate.rate, 1);
  assert.equal(rate.source, 'missing');
}

async function testMissingYearsGoToTheListener() {
  const service = createService();
  const calls: Array<{ tenantId: string; years: number[] }> = [];
  service.onMissingRates((tenantId, years) => calls.push({ tenantId, years }));
  const lookup = (rateSetId: string | null, fiscalYear: number, sourceCurrency: string) => ({ key: '', rateSetId, fiscalYear, sourceCurrency });
  await service.resolveRates('t', [
    lookup(null, 2026, 'USD'),
    lookup(null, 2026, 'EUR'),
    lookup('frozen-2026', 2026, 'USD'),
    lookup(null, 2030, 'EUR'),
  ]);
  assert.deepEqual(calls, [], 'every rate found: nothing to fetch');
  await service.resolveRates('t', [
    lookup(null, 2030, 'USD'),
    lookup(null, 2025, 'USD'),
    lookup('frozen-2026', 2025, 'USD'),
    lookup(null, 2026, 'USD'),
  ], { quiet: true });
  assert.deepEqual(calls, [{ tenantId: 't', years: [2025, 2030] }]);

  service.onMissingRates(() => { throw new Error('listener down'); });
  const rate = await resolve(null, 2025, 'USD');
  assert.equal(rate.source, 'missing', 'a failing listener leaves the read alone');
}

async function testMissingYearsRefreshedOnceInAWhile() {
  const fxRates = createService();
  const ingestion = new FxIngestionService({} as any, {} as any, {} as any, fxRates, {} as any);
  const queued: Array<{ tenantId: string; years: number[] }> = [];
  (ingestion as any).queueManualRefresh = async (tenantId: string, years: number[]) => {
    queued.push({ tenantId, years });
    return 'queued';
  };
  ingestion.onModuleInit();
  const lookup = (fiscalYear: number) => ({ key: '', rateSetId: null, fiscalYear, sourceCurrency: 'USD' });

  await fxRates.resolveRates('t', [lookup(2025)]);
  await fxRates.resolveRates('t', [lookup(2025), lookup(2030)]);
  await fxRates.resolveRates('other', [lookup(2025)]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(queued, [
    { tenantId: 't', years: [2025] },
    { tenantId: 't', years: [2030] },
    { tenantId: 'other', years: [2025] },
  ], 'each tenant year once');

}

async function testReportMissingYearsNeverThrows() {
  const service = createService();
  const calls: Array<{ tenantId: string; years: number[] }> = [];
  service.onMissingRates((tenantId, years) => calls.push({ tenantId, years }));
  service.reportMissingYears('t', [2030, 2025, 2030, 2024.5]);
  assert.deepEqual(calls, [{ tenantId: 't', years: [2025, 2030] }]);
  service.reportMissingYears('t', []);
  assert.equal(calls.length, 1, 'an empty list does not call the listener');
  service.onMissingRates(() => { throw new Error('listener down'); });
  service.reportMissingYears('t', [2025]);
}

(async () => {
  await testCurrencyMissingFromLiveSet();
  await testCurrencyInLiveSet();
  await testReportingCurrencyIsIdentity();
  await testNoSetForTheYear();
  await testFrozenSetFallsBackToLive();
  await testPinnedCrossRate();
  await testPinnedCrossRateMissingLive();
  await testPinnedCurrencyAbsentFallsBackToLive();
  await testFrozenAndLiveSetsBothMissing();
  await testMissingYearsGoToTheListener();
  await testMissingYearsRefreshedOnceInAWhile();
  await testReportMissingYearsNeverThrows();
  console.log('FX rate resolution sources pass.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
