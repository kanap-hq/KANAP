import * as assert from 'node:assert/strict';
import { CurrencyRateSet } from '../currency-rate-set.entity';
import { FxRateService } from '../fx-rate.service';
import {
  MANUAL_RATE_CURRENCY_MESSAGE,
  MANUAL_RATE_RATE_MESSAGE,
  MANUAL_RATE_REPORTING_MESSAGE,
  MANUAL_RATE_YEAR_MESSAGE,
  ManualRatesService,
} from '../manual-rates.service';

/**
 * A manual rate is a new set for the year, with that currency's source
 * `manual`. Removing it writes another set where the currency is null, and
 * queues a refresh. Validation fails before any write.
 */

type Row = {
  id: string;
  tenant_id: string;
  fiscal_year: number;
  base_currency: string;
  rates: Record<string, number | null>;
  rate_sources: Record<string, string> | null;
  rate_basis: string;
  source: string;
  captured_at: Date;
};

function harness(reporting = 'EUR') {
  const rows: Row[] = [];
  const audits: Array<Record<string, unknown>> = [];
  const ensured: string[][] = [];
  const locks: string[] = [];
  const queued: Array<{ tenantId: string; years: unknown; label?: string }> = [];
  const reported: number[][] = [];
  let queueStatus: 'queued' | 'skipped' = 'queued';
  let tick = 0;
  let ids = 0;

  const repo = {
    create: (row: Record<string, unknown>) => ({ ...row }),
    save: async (row: Record<string, any>) => {
      const stored: Row = {
        id: `set-${++ids}`,
        tenant_id: row.tenant_id,
        fiscal_year: row.fiscal_year,
        base_currency: row.base_currency,
        rates: row.rates,
        rate_sources: row.rate_sources ?? null,
        rate_basis: row.rate_basis,
        source: row.source,
        captured_at: new Date(0),
      };
      rows.push(stored);
      return stored;
    },
    findOne: async (opts: { where?: Record<string, unknown> }) => {
      const where = opts?.where ?? {};
      if (where.fiscal_year != null && where.id == null) {
        assert.ok(
          locks.includes(`fx-rate-set:tenant-1:${where.fiscal_year}`),
          'the lock is taken before the latest set is read',
        );
      }
      const matches = rows.filter((row) => {
        if (where.id != null && row.id !== where.id) return false;
        if (where.tenant_id != null && row.tenant_id !== where.tenant_id) return false;
        if (where.fiscal_year != null && row.fiscal_year !== where.fiscal_year) return false;
        if (where.base_currency != null && row.base_currency !== where.base_currency) return false;
        return true;
      });
      matches.sort((a, b) => b.captured_at.getTime() - a.captured_at.getTime());
      return matches[0] ?? null;
    },
  };

  const manager = {
    query: async (sql: string, params?: unknown[]) => {
      if (sql.includes('pg_advisory_xact_lock')) locks.push(String(params?.[0]));
      if (sql.includes('clock_timestamp')) {
        const row = rows.find((candidate) => candidate.id === params?.[0]);
        if (row) row.captured_at = new Date(Date.UTC(2100, 0, 1) + (++tick) * 1000);
      }
      return [];
    },
    getRepository: () => repo,
  };

  const settings = {
    getSettings: async () => ({
      reportingCurrency: reporting,
      defaultSpendCurrency: reporting,
      defaultCapexCurrency: reporting,
      allowedCurrencies: null,
    }),
    ensureCurrencyRecords: async (codes: Iterable<string>) => {
      ensured.push(Array.from(codes));
    },
  };
  const fxRates = new FxRateService({} as any, settings as any);
  fxRates.onMissingRates((_tenantId, years) => {
    reported.push(years);
  });
  const ingestion = {
    queueManualRefresh: async (tenantId: string, years: unknown, opts?: { label?: string }) => {
      queued.push({ tenantId, years, label: opts?.label });
      return queueStatus;
    },
  };
  const audit = {
    log: async (entry: Record<string, unknown>) => {
      audits.push(entry);
    },
  };
  const service = new ManualRatesService(settings as any, fxRates, ingestion as any, audit as any);
  return {
    service,
    manager,
    rows,
    audits,
    ensured,
    locks,
    queued,
    reported,
    setQueueStatus: (status: 'queued' | 'skipped') => {
      queueStatus = status;
    },
    seed(row: Partial<Row> & Pick<Row, 'fiscal_year' | 'rates'>) {
      rows.push({
        id: `seed-${++ids}`,
        tenant_id: 'tenant-1',
        base_currency: reporting,
        rate_sources: null,
        rate_basis: 'annual_avg',
        source: 'world-bank-annual',
        captured_at: new Date(1_600_000_000_000 + ids),
        ...row,
      });
    },
  };
}

async function rejects(run: () => Promise<unknown>, message: string, status: number) {
  await assert.rejects(run, (error: any) => {
    assert.equal(error.message, message);
    assert.equal(typeof error.getStatus === 'function' ? error.getStatus() : error.status, status);
    return true;
  });
}

async function testValidationWritesNothing() {
  const { service, manager, rows, locks } = harness();
  const cases: Array<[Record<string, unknown>, string]> = [
    [{ currency: 'GB', year: 2024, rate: 1.2 }, MANUAL_RATE_CURRENCY_MESSAGE],
    [{ currency: 'GBPP', year: 2024, rate: 1.2 }, MANUAL_RATE_CURRENCY_MESSAGE],
    [{ currency: 'G1P', year: 2024, rate: 1.2 }, MANUAL_RATE_CURRENCY_MESSAGE],
    [{ currency: 12, year: 2024, rate: 1.2 }, MANUAL_RATE_CURRENCY_MESSAGE],
    [{ currency: 'GBP', year: 1989, rate: 1.2 }, MANUAL_RATE_YEAR_MESSAGE],
    [{ currency: 'GBP', year: 2101, rate: 1.2 }, MANUAL_RATE_YEAR_MESSAGE],
    [{ currency: 'GBP', year: 2024.5, rate: 1.2 }, MANUAL_RATE_YEAR_MESSAGE],
    [{ currency: 'GBP', year: '2024', rate: 1.2 }, MANUAL_RATE_YEAR_MESSAGE],
    [{ currency: 'GBP', year: 2024, rate: 0 }, MANUAL_RATE_RATE_MESSAGE],
    [{ currency: 'GBP', year: 2024, rate: -1 }, MANUAL_RATE_RATE_MESSAGE],
    [{ currency: 'GBP', year: 2024, rate: 1e9 + 1 }, MANUAL_RATE_RATE_MESSAGE],
    [{ currency: 'GBP', year: 2024, rate: Number.NaN }, MANUAL_RATE_RATE_MESSAGE],
    [{ currency: 'GBP', year: 2024, rate: Number.POSITIVE_INFINITY }, MANUAL_RATE_RATE_MESSAGE],
    [{ currency: 'GBP', year: 2024, rate: '1.2' }, MANUAL_RATE_RATE_MESSAGE],
    [{ currency: 'GBP', year: 2024, rate: 0.0000004 }, MANUAL_RATE_RATE_MESSAGE],
  ];
  for (const [input, message] of cases) {
    await rejects(() => service.setManualRate('tenant-1', input as any, 'user-1', manager as any), message, 400);
  }
  await rejects(
    () => service.setManualRate('tenant-1', { currency: 'eur', year: 2024, rate: 1 }, 'user-1', manager as any),
    MANUAL_RATE_REPORTING_MESSAGE,
    400,
  );
  await rejects(
    () => service.removeManualRate('tenant-1', { currency: 'GB', year: 2024 }, 'user-1', manager as any),
    MANUAL_RATE_CURRENCY_MESSAGE,
    400,
  );
  assert.equal(rows.length, 0, 'invalid input inserts no set');
  assert.equal(locks.length, 0, 'invalid input takes no lock');
  assert.ok(cases.length > 0);
  console.log('ok - invalid input is rejected before a write');
}

async function testNoSetForTheYear() {
  const { service, manager, rows, audits, ensured, locks } = harness();
  const set = await service.setManualRate('tenant-1', { currency: ' gbp ', year: 2050, rate: 1.23456789 }, 'user-1', manager as any);
  assert.equal(rows.length, 1);
  assert.equal(set.id, rows[0].id);
  assert.equal(set.fiscal_year, 2050);
  assert.equal(set.base_currency, 'EUR');
  assert.deepEqual(set.rates, { EUR: 1, GBP: 1.234568 });
  assert.deepEqual(set.rate_sources, { EUR: 'identity', GBP: 'manual' });
  assert.equal(set.source, 'manual');
  assert.equal(set.rate_basis, 'manual');
  assert.deepEqual(ensured, [['EUR', 'GBP']]);
  assert.deepEqual(locks, ['fx-rate-set:tenant-1:2050']);
  assert.equal(audits.length, 1);
  assert.equal(audits[0].action, 'create');
  assert.equal(audits[0].table, 'currency_rate_sets');
  assert.equal(audits[0].recordId, set.id);
  assert.equal(audits[0].userId, 'user-1');
  assert.deepEqual(audits[0].before, { fiscal_year: 2050, currency: 'GBP', rate: null, source: null });
  assert.deepEqual(audits[0].after, { fiscal_year: 2050, currency: 'GBP', rate: 1.234568, source: 'manual' });
  console.log('ok - a year with no set stores the reporting currency and the manual rate');
}

async function testSetCopiesTheLatestSet() {
  const { service, manager, rows, audits, seed } = harness();
  seed({
    fiscal_year: 2022,
    rates: { EUR: 1, USD: 0.92, gbp: 1.1 },
    rate_sources: { EUR: 'identity', USD: 'world-bank-annual', gbp: 'estimate' },
    captured_at: new Date('2022-01-01'),
  });
  const set = await service.setManualRate('tenant-1', { currency: 'USD', year: 2022, rate: 1.1 }, null, manager as any);
  assert.equal(rows.length, 2, 'the previous set stays; the manual value is a new set');
  assert.equal(set.rates.EUR, 1);
  assert.equal(set.rates.USD, 1.1);
  assert.equal(set.rates.gbp, 1.1, 'another currency is copied as it was stored');
  assert.equal(set.rate_sources?.USD, 'manual');
  assert.equal(set.rate_sources?.EUR, 'identity');
  assert.equal(set.rate_sources?.gbp, 'estimate');
  assert.equal(set.source, 'world-bank-annual');
  assert.equal(set.rate_basis, 'annual_avg');
  assert.equal(audits[0].action, 'update');
  assert.deepEqual(audits[0].before, { fiscal_year: 2022, currency: 'USD', rate: 0.92, source: 'world-bank-annual' });
  assert.deepEqual(audits[0].after, { fiscal_year: 2022, currency: 'USD', rate: 1.1, source: 'manual' });
  assert.equal(audits[0].userId, null);
  console.log('ok - a manual rate copies the latest set and replaces that currency');
}

async function testRemoveRequiresAManualValue() {
  const { service, manager, rows, queued, seed } = harness();
  seed({
    fiscal_year: 2023,
    rates: { EUR: 1, GBP: 1.17 },
    rate_sources: { EUR: 'identity', GBP: 'world-bank-annual' },
  });
  await rejects(
    () => service.removeManualRate('tenant-1', { currency: 'GBP', year: 2023 }, 'user-1', manager as any),
    'No manual rate is stored for GBP in 2023.',
    404,
  );
  await rejects(
    () => service.removeManualRate('tenant-1', { currency: 'CHF', year: 2050 }, 'user-1', manager as any),
    'No manual rate is stored for CHF in 2050.',
    404,
  );
  assert.equal(rows.length, 1, 'a missing manual value inserts nothing');
  assert.equal(queued.length, 0);
  console.log('ok - removing a currency that is not manual answers 404');
}

async function testRemoveClearsTheCurrencyAndQueuesARefresh() {
  const { service, manager, rows, audits, queued, seed } = harness();
  seed({
    fiscal_year: 2024,
    rates: { EUR: 1, GBP: 1.2, USD: 0.9 },
    rate_sources: { EUR: 'identity', GBP: 'manual', USD: 'exchangerateapi-spot' },
    source: 'exchangerateapi-spot',
    rate_basis: 'spot',
  });
  const removed = await service.removeManualRate('tenant-1', { currency: 'gbp', year: 2024 }, 'user-1', manager as any);
  assert.deepEqual(removed, { ok: true, refreshQueued: true });
  assert.equal(rows.length, 2);
  const set = rows[1];
  assert.equal(set.rates.GBP, null);
  assert.equal(set.rates.USD, 0.9);
  assert.equal(set.rates.EUR, 1);
  assert.equal(set.rate_sources?.GBP, undefined);
  assert.equal(set.rate_sources?.USD, 'exchangerateapi-spot');
  assert.equal(set.source, 'exchangerateapi-spot');
  assert.equal(set.rate_basis, 'spot');
  assert.equal(audits[0].action, 'delete');
  assert.equal(audits[0].recordId, set.id);
  assert.deepEqual(audits[0].before, { fiscal_year: 2024, currency: 'GBP', rate: 1.2, source: 'manual' });
  assert.equal(audits[0].after, null);
  assert.deepEqual(queued, [{ tenantId: 'tenant-1', years: [2024], label: 'manual-rate-removed' }]);
  console.log('ok - removing a manual rate clears it and queues a refresh of the year');
}

async function testSkippedRefreshReportsTheYear() {
  const { service, manager, reported, queued, seed, setQueueStatus } = harness();
  seed({
    fiscal_year: 2024,
    rates: { EUR: 1, GBP: 1.2 },
    rate_sources: { EUR: 'identity', GBP: 'manual' },
  });
  setQueueStatus('skipped');
  const removed = await service.removeManualRate('tenant-1', { currency: 'GBP', year: 2024 }, 'user-1', manager as any);
  assert.deepEqual(removed, { ok: true, refreshQueued: false });
  assert.equal(queued.length, 1);
  assert.deepEqual(reported, [[2024]]);
  console.log('ok - a refresh already running is followed through the missing-year report');
}

async function testLatestSetWins() {
  const { service, manager, rows, seed } = harness();
  seed({
    fiscal_year: 2024,
    rates: { EUR: 1, GBP: 1.2 },
    rate_sources: { GBP: 'manual' },
    captured_at: new Date('2024-01-01'),
  });
  seed({
    fiscal_year: 2024,
    rates: { EUR: 1, GBP: 1.4 },
    rate_sources: { GBP: 'manual' },
    captured_at: new Date('2024-06-01'),
  });
  const set = await service.setManualRate('tenant-1', { currency: 'GBP', year: 2024, rate: 1.5 }, 'user-1', manager as any);
  assert.equal(set.rates.GBP, 1.5);
  assert.equal(rows.length, 3);
  const latest = await new FxRateService({} as any, {} as any).getLatestRateSet('tenant-1', 2024, 'EUR', { manager: manager as any });
  assert.equal(latest?.id, set.id);
  assert.ok(latest instanceof Object);
  assert.equal((latest as CurrencyRateSet).rates.GBP, 1.5);
  console.log('ok - the manual write reads and becomes the latest set of the year');
}

(async () => {
  await testValidationWritesNothing();
  await testNoSetForTheYear();
  await testSetCopiesTheLatestSet();
  await testRemoveRequiresAManualValue();
  await testRemoveClearsTheCurrencyAndQueuesARefresh();
  await testSkippedRefreshReportsTheYear();
  await testLatestSetWins();
  console.log('manual-rates.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
