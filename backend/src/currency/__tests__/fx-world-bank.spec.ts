import * as assert from 'node:assert/strict';
import { FxIngestionService } from '../fx-ingestion.service';

type AnnualSeries = Record<number, number>;
type SpotSeries = Record<string, number | null>;

function createService(annual: Record<string, AnnualSeries>, spot: SpotSeries = {}) {
  const worldBankStub = {
    resolveCode: (currency: string) => {
      const upper = currency.toUpperCase();
      if (upper === 'USD') return 'USA';
      if (upper === 'EUR') return 'EMU';
      if (upper === 'GBP') return 'GBR';
      return upper;
    },
    fetchAnnualRates: async (currency: string, startYear: number, endYear: number) => {
      const series = annual[currency.toUpperCase()] ?? {};
      const map = new Map<number, number>();
      for (let year = startYear; year <= endYear; year += 1) {
        if (series[year] != null) {
          map.set(year, series[year]);
        }
      }
      return map;
    },
    fetchSpotRate: async (currency: string) => {
      const upper = currency.toUpperCase();
      if (Object.prototype.hasOwnProperty.call(spot, upper)) {
        return spot[upper];
      }
      return null;
    },
  };

  const repoStub = { manager: {} } as any;
  const tenantRepoStub = {} as any;
  const currencySettingsStub = {} as any;
  const fxRatesStub = {
    getLatestRateSet: async () => null,
  };

  return new FxIngestionService(repoStub, tenantRepoStub, currencySettingsStub, fxRatesStub as any, worldBankStub as any);
}

async function testAnnualOnly() {
  const service = createService(
    {
      EUR: { 2022: 0.9 },
      GBP: { 2022: 0.8 },
    },
    {},
  );

  const context = {
    tenantId: 'tenant',
    reportingCurrency: 'EUR',
    currencies: ['EUR', 'GBP', 'USD'],
  };

  const snapshots = await (service as any).buildYearlySnapshots(context, [2022]);
  assert.equal(snapshots.length, 1);
  const snapshot = snapshots[0];
  assert.equal(snapshot.source, 'world-bank-annual');
  assert.equal(snapshot.quotes.EUR, 0.9);
  assert.equal(snapshot.quotes.GBP, 0.8);
  const rates = (service as any).buildRateMap('EUR', snapshot, context.currencies);
  const expected = Number((0.9 / 0.8).toFixed(6));
  assert.equal(rates.GBP, expected);
}

async function testSpotRateBlending() {
  const currentYear = new Date().getFullYear();
  const service = createService(
    {
      EUR: { [currentYear - 1]: 0.89 },
      GBP: { [currentYear - 1]: 0.78 },
    },
    {
      EUR: 0.94,
      GBP: 0.82,
    },
  );

  const context = {
    tenantId: 'tenant',
    reportingCurrency: 'EUR',
    currencies: ['EUR', 'GBP'],
  };

  const snapshots = await (service as any).buildYearlySnapshots(context, [currentYear - 1, currentYear]);
  assert.equal(snapshots.length, 2);
  const snapshot = snapshots.find((entry: any) => entry.year === currentYear);
  assert.ok(snapshot);
  assert.equal(snapshot.source, 'exchangerateapi-spot');
  assert.equal(snapshot.quotes.EUR, 0.94);
  assert.equal(snapshot.quotes.GBP, 0.82);
  const rates = (service as any).buildRateMap('EUR', snapshot, context.currencies);
  const expected = Number((0.94 / 0.82).toFixed(6));
  assert.equal(rates.GBP, expected);
}

async function testMissingDataYieldsNull() {
  const service = createService(
    {
      EUR: { 2021: 0.95 },
    },
    {
      GBP: null,
    },
  );

  const context = {
    tenantId: 'tenant',
    reportingCurrency: 'EUR',
    currencies: ['EUR', 'GBP'],
  };

  const snapshots = await (service as any).buildYearlySnapshots(context, [2021]);
  assert.equal(snapshots.length, 1);
  const snapshot = snapshots[0];
  assert.equal(snapshot.source, 'world-bank-annual');
  assert.ok(snapshot.missingCurrencies.includes('GBP'));
  const rates = (service as any).buildRateMap('EUR', snapshot, context.currencies);
  assert.equal(rates.GBP, null);
}

async function testCurrentYearFallbackToHistorical() {
  const currentYear = new Date().getFullYear();
  const service = createService(
    {
      EUR: { [currentYear - 1]: 0.88 },
    },
    {},
  );

  const context = {
    tenantId: 'tenant',
    reportingCurrency: 'EUR',
    currencies: ['EUR', 'GBP'],
  };

  const snapshots = await (service as any).buildYearlySnapshots(context, [currentYear - 1, currentYear]);
  assert.equal(snapshots.length, 2);
  const snapshot = snapshots.find((entry: any) => entry.year === currentYear);
  assert.ok(snapshot);
  assert.equal(snapshot.source, 'world-bank-forward');
  const rates = (service as any).buildRateMap('EUR', snapshot, context.currencies);
  assert.equal(rates.EUR, 1);
  assert.equal(snapshot.quotes.EUR, 0.88);
}

async function testManualQueueDeduplication() {
  const service = createService({}, {}) as any;

  let calls = 0;
  const resolvers: Array<() => void> = [];

  service.refreshTenant = (_tenantId: string, _years?: number | number[]) => {
    calls += 1;
    return new Promise<any>((resolve) => {
      resolvers.push(() => resolve([]));
    });
  };

  const first = await service.queueManualRefresh('tenant', [2024]);
  assert.equal(first, 'queued');
  const second = await service.queueManualRefresh('tenant', [2024]);
  assert.equal(second, 'skipped');
  assert.equal(calls, 1);

  resolvers.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));

  const third = await service.queueManualRefresh('tenant', [2024]);
  assert.equal(third, 'queued');
  assert.equal(calls, 2);

  resolvers.shift()?.();
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * The refresh covers the base currencies of the tenant's companies: their turnovers are
 * converted at the year's rates (`convertTurnovers`), and a currency no set rates would stay
 * counted unconverted for good.
 */
async function testTenantContextCoversCompanyCurrencies() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const ensured: string[][] = [];
  const service = new FxIngestionService(
    {} as any,
    {} as any,
    {
      getSettings: async () => ({ reportingCurrency: 'EUR', defaultCapexCurrency: 'EUR', defaultSpendCurrency: 'EUR', allowedCurrencies: [] }),
      ensureCurrencyRecords: async (codes: Set<string>) => { ensured.push(Array.from(codes)); },
    } as any,
    {} as any,
    {} as any,
  );
  const manager = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (/FROM companies/.test(sql)) return [{ currency: 'USD' }, { currency: 'JPY' }];
      return [];
    },
  };
  const context = await (service as any).buildTenantContext('tenant-1', manager);
  assert.ok(context.currencies.includes('USD'), 'USD, a company base currency, is refreshed');
  assert.ok(context.currencies.includes('JPY'), 'JPY, a company base currency, is refreshed');
  assert.ok(ensured[0].includes('JPY'));
  const companies = queries.find((q) => /FROM companies/.test(q.sql));
  assert.ok(companies, 'the companies are read');
  assert.match(companies!.sql, /tenant_id = \$1/);
  assert.deepEqual(companies!.params, ['tenant-1']);
}

/** Contract amounts convert at the year's rates, so their currencies are fetched too. */
async function testTenantContextCoversContractCurrencies() {
  const queries: Array<{ sql: string; params: unknown[] }> = [];
  const service = new FxIngestionService(
    {} as any,
    {} as any,
    {
      getSettings: async () => ({ reportingCurrency: 'EUR', defaultCapexCurrency: 'EUR', defaultSpendCurrency: 'EUR', allowedCurrencies: [] }),
      ensureCurrencyRecords: async () => undefined,
    } as any,
    {} as any,
    {} as any,
  );
  const manager = {
    query: async (sql: string, params: unknown[] = []) => {
      queries.push({ sql, params });
      if (/FROM contracts/.test(sql)) return [{ currency: 'CHF' }, { currency: 'JPY' }, { currency: 'EU' }];
      return [];
    },
  };
  const context = await (service as any).buildTenantContext('tenant-1', manager);
  assert.ok(context.currencies.includes('CHF'));
  assert.ok(context.currencies.includes('JPY'));
  assert.ok(!context.currencies.includes('EU'), 'a code that is not three letters is left out');
  const contracts = queries.find((q) => /FROM contracts/.test(q.sql));
  assert.ok(contracts);
  assert.match(contracts!.sql, /UPPER\(TRIM\(currency\)\)/);
  assert.match(contracts!.sql, /tenant_id = \$1/);
  assert.deepEqual(contracts!.params, ['tenant-1']);
}

(async () => {
  await testTenantContextCoversCompanyCurrencies();
  await testTenantContextCoversContractCurrencies();
  await testAnnualOnly();
  await testSpotRateBlending();
  await testMissingDataYieldsNull();
  await testCurrentYearFallbackToHistorical();
  await testManualQueueDeduplication();
  console.log('World Bank FX ingestion helpers pass unit checks.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
