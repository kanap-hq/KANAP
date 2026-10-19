import * as assert from 'node:assert/strict';
import { CurrencyController } from '../currency.controller';
import { ManualRatesService } from '../manual-rates.service';

/**
 * The rate matrix reads only sets of the current reporting currency, latest per
 * year, and keeps a currency when it is in use or carries a manual rate.
 * `currencies` is the row list, reporting currency first.
 */

type SetRow = {
  fiscal_year: number;
  base_currency: string;
  rates: Record<string, number | null>;
  rate_sources: Record<string, string> | null;
  captured_at: Date;
  source: string;
};

type Settings = {
  reportingCurrency: string;
  defaultSpendCurrency: string;
  defaultCapexCurrency: string;
  allowedCurrencies: string[] | null;
};

function matrixService(settings: Settings, rows: SetRow[], used: {
  budget?: Array<{ currency: string; year: number }>;
  companies?: Array<{ currency: string; year: number }>;
  contracts?: Array<{ currency: string; year: number }>;
}) {
  const queries: string[] = [];
  const manager = {
    queries,
    query: async (sql: string, params?: unknown[]) => {
      queries.push(sql);
      if (sql.includes('FROM spend_items')) return used.budget ?? [];
      if (sql.includes('FROM companies')) return used.companies ?? [];
      if (sql.includes('FROM contracts')) return used.contracts ?? [];
      if (sql.includes('FROM currency_rate_sets') && sql.includes('DISTINCT ON')) {
        const base = String(params?.[1] ?? '');
        // A query that forgets the reporting-currency predicate receives every base.
        const scoped = /UPPER\(TRIM\(base_currency\)\)/.test(sql)
          ? rows.filter((row) => row.base_currency.trim().toUpperCase() === base)
          : rows;
        const latest = new Map<number, SetRow>();
        const ordered = [...scoped].sort((a, b) => a.fiscal_year - b.fiscal_year || b.captured_at.getTime() - a.captured_at.getTime());
        for (const row of ordered) {
          if (!latest.has(row.fiscal_year)) latest.set(row.fiscal_year, row);
        }
        return Array.from(latest.values()).map((row) => ({
          fiscal_year: row.fiscal_year,
          base_currency: row.base_currency.trim(),
          rates: row.rates,
          rate_sources: row.rate_sources,
          captured_at: row.captured_at,
          source: row.source,
        }));
      }
      return [];
    },
  };
  const service = new ManualRatesService(
    { getSettings: async () => settings } as any,
    { reportMissingYears: () => undefined } as any,
    {} as any,
    {} as any,
  );
  const controller = new CurrencyController({} as any, {} as any, service, { manager } as any);
  return { controller, manager };
}

const settings = (patch: Partial<Settings> = {}): Settings => ({
  reportingCurrency: 'EUR',
  defaultSpendCurrency: 'EUR',
  defaultCapexCurrency: 'EUR',
  allowedCurrencies: null,
  ...patch,
});

async function testOldBaseSetIsIgnored() {
  const older = new Date('2024-01-01T00:00:00.000Z');
  const latest = new Date('2024-06-01T00:00:00.000Z');
  const { controller, manager } = matrixService(settings(), [
    { fiscal_year: 2024, base_currency: 'USD', rates: { USD: 1, EUR: 0.9 }, rate_sources: { USD: 'identity' }, captured_at: latest, source: 'world-bank-annual' },
    { fiscal_year: 2024, base_currency: 'EUR', rates: { EUR: 1, USD: 1.1 }, rate_sources: { EUR: 'identity', USD: 'world-bank-annual' }, captured_at: older, source: 'world-bank-annual' },
    { fiscal_year: 2023, base_currency: 'USD', rates: { USD: 1 }, rate_sources: null, captured_at: older, source: 'manual' },
  ], { budget: [{ currency: 'USD', year: 2024 }] });

  const listed = await controller.listRates({ tenant: { id: 'tenant-1' }, queryRunner: { manager } });
  assert.deepEqual(listed.rates.map((row: { fiscalYear: number; baseCurrency: string }) => [row.fiscalYear, row.baseCurrency]), [[2024, 'EUR']]);
  assert.equal(listed.rates[0].rates.USD, 1.1);
  assert.equal(listed.rates[0].rates.EUR, 1);
  console.log('ok - a set of the previous reporting currency is not shown');
}

async function testUnusedCurrencyIsDropped() {
  const at = new Date('2024-06-01T00:00:00.000Z');
  const { controller, manager } = matrixService(settings(), [
    {
      fiscal_year: 2024,
      base_currency: 'EUR',
      rates: { EUR: 1, USD: 1.1, XTS: null, NOK: null, ZAR: 0.05, GGP: null },
      rate_sources: { EUR: 'identity', USD: 'world-bank-annual', ZAR: 'world-bank-annual' },
      captured_at: at,
      source: 'world-bank-annual',
    },
  ], { budget: [{ currency: 'USD', year: 2024 }] });

  const listed = await controller.listRates({ tenant: { id: 'tenant-1' }, queryRunner: { manager } });
  assert.deepEqual(listed.rates[0].rates, { EUR: 1, USD: 1.1 });
  assert.deepEqual(listed.rates[0].rateSources, { EUR: 'identity', USD: 'world-bank-annual' });
  assert.deepEqual(listed.currencies, ['EUR', 'USD']);
  console.log('ok - a currency with no use and no manual rate is dropped');
}

async function testManualRateCurrencyIsKept() {
  const at = new Date('2024-06-01T00:00:00.000Z');
  const { controller, manager } = matrixService(settings(), [
    {
      fiscal_year: 2024,
      base_currency: 'EUR',
      rates: { EUR: 1, ZAR: 0.05 },
      rate_sources: { EUR: 'identity', ZAR: 'manual' },
      captured_at: at,
      source: 'world-bank-annual',
    },
  ], { budget: [{ currency: 'USD', year: 2025 }] });

  const listed = await controller.listRates({ tenant: { id: 'tenant-1' }, queryRunner: { manager } });
  assert.equal(listed.rates[0].rates.ZAR, 0.05);
  assert.equal(listed.rates[0].rateSources.ZAR, 'manual');
  // USD is in use in 2025 and has no key on the 2024 set: it is a row, and 2024 does not invent a rate.
  assert.equal(listed.rates[0].rates.USD, undefined);
  assert.deepEqual(listed.currencies, ['EUR', 'USD', 'ZAR']);
  console.log('ok - a currency carrying a manual rate stays, and a used currency stays a row');
}

async function testCurrenciesAreSortedWithTheReportingCurrencyFirst() {
  const at = new Date('2024-06-01T00:00:00.000Z');
  const { controller, manager } = matrixService(
    settings({ defaultSpendCurrency: 'CHF', defaultCapexCurrency: 'EUR', allowedCurrencies: ['GBP', 'CHF'] }),
    [
      {
        fiscal_year: 2024,
        base_currency: ' EUR ',
        rates: { eur: 1, usd: 1.08 },
        rate_sources: { EUR: 'identity', USD: 'world-bank-annual' },
        captured_at: at,
        source: 'world-bank-annual',
      },
    ],
    {
      budget: [{ currency: 'usd', year: 2024 }],
      companies: [{ currency: 'NOK', year: 2024 }],
      contracts: [{ currency: 'SEK', year: 2024 }],
    },
  );

  const listed = await controller.listRates({ tenant: { id: 'tenant-1' }, queryRunner: { manager } });
  assert.equal(listed.rates[0].baseCurrency, 'EUR');
  assert.deepEqual(listed.rates[0].rates, { EUR: 1, USD: 1.08 });
  assert.deepEqual(listed.currencies, ['EUR', 'CHF', 'GBP', 'NOK', 'SEK', 'USD']);
  console.log('ok - currencies are sorted with the reporting currency first');
}

(async () => {
  await testOldBaseSetIsIgnored();
  await testUnusedCurrencyIsDropped();
  await testManualRateCurrencyIsKept();
  await testCurrenciesAreSortedWithTheReportingCurrencyFirst();
  console.log('rate-matrix.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
