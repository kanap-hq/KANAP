import * as assert from 'node:assert/strict';
import { CurrencyController } from '../currency.controller';
import { FxIngestionService } from '../fx-ingestion.service';

/**
 * The tenant refresh queue: a forced sync waits for the run that covers its
 * years (the running one, or the next one into which its years are merged),
 * nothing is dropped, and a run that throws leaves no stuck entry. The year set
 * and the answer shape are checked on a controller whose collaborators are stubs.
 */

function ingestion(): FxIngestionService {
  return new FxIngestionService({} as any, {} as any, {} as any, {} as any, {} as any);
}

type Call = { years: number[]; reportingCurrency?: string; label?: string; release: () => void; fail: (error: Error) => void };

/** A refreshTenant stub whose runs end only when the spec releases them. */
function controlledRuns(service: any): Call[] {
  const calls: Call[] = [];
  service.refreshTenant = (_tenantId: string, years: number[], opts?: { reportingCurrency?: string; label?: string }) =>
    new Promise<unknown[]>((resolve, reject) => {
      calls.push({
        years: [...years].sort((a, b) => a - b),
        reportingCurrency: opts?.reportingCurrency,
        label: opts?.label,
        release: () => resolve([]),
        fail: (error) => reject(error),
      });
    });
  return calls;
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

async function testTimeoutLeavesTheJobRunning() {
  const service = ingestion() as any;
  const calls = controlledRuns(service);

  const first = await service.refreshWithin('tenant-1', [2028], { label: 'manual-api', timeoutMs: 40 });
  assert.deepEqual(first, { completed: false });
  assert.equal(calls.length, 1, 'the timed-out refresh is still the one job');
  const second = service.refreshWithin('tenant-1', [2028], { timeoutMs: 1000 });
  await tick();
  assert.equal(calls.length, 1, 'a running job that covers the years answers the second request');
  calls[0].release();
  assert.deepEqual(await second, { completed: true, failed: false });
  await tick();
  assert.equal(service.hasQueuedRefresh('tenant-1'), false, 'the queue empties once the run ends');
  console.log('ok - a forced sync that runs long answers completed false; the next one waits for the same run');
}

async function testForcedSyncWhileAnotherJobRuns() {
  const service = ingestion() as any;
  const calls = controlledRuns(service);
  // A missing-rate read started a run for 2026, then the forced sync arrives with more years.
  service.refreshMissingYears('tenant-1', [2026]);
  await tick();
  assert.equal(calls.length, 1);
  const forced = service.refreshWithin('tenant-1', [2019, 2020, 2026], { label: 'manual-api', timeoutMs: 1000 });
  let settled = false;
  void forced.then(() => { settled = true; });
  calls[0].release();
  await tick();
  assert.equal(settled, false, 'the forced sync waits for its own run, not the one already going');
  assert.equal(calls.length, 2, 'its years run next');
  assert.deepEqual(calls[1].years, [2019, 2020, 2026]);
  calls[1].release();
  assert.deepEqual(await forced, { completed: true, failed: false });
  console.log('ok - a forced sync arriving while another refresh runs is queued next and awaited');
}

async function testConcurrentRequestsMergeIntoTheNextRun() {
  const service = ingestion() as any;
  const calls = controlledRuns(service);
  const running = service.refreshWithin('tenant-1', [2024], { timeoutMs: 1000 });
  await tick();
  const a = service.refreshWithin('tenant-1', [2019, 2028], {
    label: 'reporting-currency',
    reportingCurrency: 'chf',
    timeoutMs: 1000,
  });
  const b = service.refreshWithin('tenant-1', [2025], { label: 'manual-api', timeoutMs: 1000 });
  await tick();
  assert.equal(calls.length, 1, 'the running job is not replaced');
  calls[0].release();
  assert.deepEqual(await running, { completed: true, failed: false });
  await tick();
  assert.equal(calls.length, 2, 'both waiting requests share one next run');
  assert.deepEqual(calls[1].years, [2019, 2025, 2028]);
  assert.equal(calls[1].reportingCurrency, 'CHF', 'the run keeps the requested base');
  assert.equal(calls[1].label, 'reporting-currency+manual-api');
  calls[1].release();
  assert.deepEqual(await a, { completed: true, failed: false });
  assert.deepEqual(await b, { completed: true, failed: false });
  await tick();
  assert.equal(calls.length, 2);
  assert.equal(service.hasQueuedRefresh('tenant-1'), false);
  console.log('ok - two requests made while a run is going are merged into the next run, none dropped');
}

async function testAnotherBaseIsNotCoveredByTheRunningJob() {
  const service = ingestion() as any;
  const calls = controlledRuns(service);
  void service.queueManualRefresh('tenant-1', [2026], { label: 'missing-rate' });
  await tick();
  const change = service.refreshWithin('tenant-1', [2026], { reportingCurrency: 'USD', timeoutMs: 1000 });
  calls[0].release();
  await tick();
  assert.equal(calls.length, 2, 'a run without the new base does not answer a reporting change');
  assert.equal(calls[1].reportingCurrency, 'USD');
  calls[1].release();
  assert.deepEqual(await change, { completed: true, failed: false });
  console.log('ok - a reporting-currency change is never answered by a run of the old base');
}

async function testFailedJobLeavesNothingStuck() {
  const service = ingestion() as any;
  const calls = controlledRuns(service);
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  try {
    const first = service.refreshWithin('tenant-1', [2024], { timeoutMs: 1000 });
    const queued = service.refreshWithin('tenant-1', [2025], { timeoutMs: 1000 });
    await tick();
    calls[0].fail(new Error('World Bank unreachable'));
    assert.deepEqual(await first, { completed: true, failed: true });
    await tick();
    assert.equal(calls.length, 2, 'the next run starts after a failed one');
    calls[1].release();
    assert.deepEqual(await queued, { completed: true, failed: false });
    await tick();
    assert.equal(service.hasQueuedRefresh('tenant-1'), false, 'no stuck entry');
    const again = service.refreshWithin('tenant-1', [2024], { timeoutMs: 1000 });
    await tick();
    assert.equal(calls.length, 3, 'a later request starts a new run');
    calls[2].release();
    assert.deepEqual(await again, { completed: true, failed: false });
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.deepEqual(unhandled, [], 'no unhandled rejection');
  } finally {
    process.off('unhandledRejection', onUnhandled);
  }
  console.log('ok - a run that throws answers failed, frees the queue and rejects nothing');
}

async function testGateDelaysTheRun() {
  const service = ingestion() as any;
  const calls = controlledRuns(service);
  let open: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => { open = resolve; });
  assert.equal(await service.queueManualRefresh('tenant-1', [2024], { startAfter: gate }), 'queued');
  await tick();
  assert.equal(calls.length, 0, 'the run waits for the request to commit');
  const waiting = service.refreshWithin('tenant-1', [2024], { timeoutMs: 1000 });
  open();
  await tick();
  assert.equal(calls.length, 1, 'the forced sync is answered by the gated run');
  calls[0].release();
  assert.deepEqual(await waiting, { completed: true, failed: false });
  console.log('ok - a run queued by a settings save starts once its gate settles');
}

function controller(opts: {
  missing: Array<{ currency: string; year: number }>;
  completed: boolean;
  failed?: boolean;
  rates?: Array<{ fiscal_year: number; rates: Record<string, unknown> }>;
}) {
  const reports: Array<boolean | undefined> = [];
  let rateReads = 0;
  const manualRates = {
    listMissingPairs: async (_tenantId: string, _manager: unknown, options?: { report?: boolean }) => {
      reports.push(options?.report);
      return opts.missing;
    },
  };
  const fxIngestion = {
    refreshWithin: async () => (opts.completed ? { completed: true, failed: opts.failed ?? false } : { completed: false }),
  };
  const manager = {
    query: async (sql: string) => {
      if (sql.includes('currency_rate_sets')) {
        rateReads += 1;
        if (rateReads === 1) return [];
        return opts.rates ?? [];
      }
      return [];
    },
  };
  const settings = { getSettings: async () => ({ reportingCurrency: 'EUR' }) };
  const api = new CurrencyController(settings as any, fxIngestion as any, manualRates as any, { manager } as any);
  return { api, manager, reports };
}

async function testRefreshAnswer() {
  const current = new Date().getFullYear();
  const window = Array.from(new Set([current - 1, current, current + 1, 2028])).sort((a, b) => a - b);
  const running = controller({ missing: [{ currency: 'ZAR', year: 2028 }], completed: false });
  const req = { tenant: { id: 'tenant-1' }, queryRunner: { manager: running.manager } };
  const pending = await running.api.refreshRates(undefined, req);
  assert.deepEqual(pending.years, window);
  assert.deepEqual(pending, { ok: true, completed: false, years: window });
  assert.equal('fetched' in pending, false);
  assert.equal('stillMissing' in pending, false);
  assert.deepEqual(running.reports, [false]);
  console.log('ok - a sync still running names the years and nothing else');

  const done = controller({
    missing: [{ currency: 'XXX', year: 2028 }],
    completed: true,
    rates: [{ fiscal_year: 2028, rates: { zar: 0.055, EUR: 1, XXX: 0, empty: null } }],
  });
  // The year set is read first. The missing list after the fetch is the second call.
  const firstMissing = [{ currency: 'ZAR', year: 2028 }];
  let calls = 0;
  const manual = (done.api as any).manualRates;
  manual.listMissingPairs = async (_tenantId: string, _manager: unknown, options?: { report?: boolean }) => {
    done.reports.push(options?.report);
    calls += 1;
    return calls === 1 ? firstMissing : [{ currency: 'XXX', year: 2028 }];
  };
  const finished = await done.api.refreshRates(undefined, { tenant: { id: 'tenant-1' }, queryRunner: { manager: done.manager } });
  assert.equal(finished.completed, true);
  if (!finished.completed) return;
  assert.deepEqual(finished.years, window);
  assert.equal(finished.failed, false);
  assert.equal(finished.fetched, 2, 'ZAR and EUR became usable; 0 and null did not');
  assert.deepEqual(finished.stillMissing, [{ currency: 'XXX', year: 2028 }]);
  assert.deepEqual(done.reports, [false, false]);
  console.log('ok - a finished sync counts the new rates and lists what is still missing');

  const explicit = controller({ missing: [{ currency: 'ZAR', year: 2028 }], completed: false });
  const named = await explicit.api.refreshRates({ years: [2020] }, { tenant: { id: 'tenant-1' }, queryRunner: { manager: explicit.manager } });
  assert.deepEqual(named, { ok: true, completed: false, years: [2020] });
  assert.deepEqual(explicit.reports, [], 'an explicit year list does not read the missing pairs');
  console.log('ok - explicit years stay the requested years');

  const failing = controller({ missing: [{ currency: 'ZAR', year: 2028 }], completed: true, failed: true, rates: [{ fiscal_year: 2028, rates: { ZAR: 0.05 } }] });
  const failed = await failing.api.refreshRates({ years: [2028] }, { tenant: { id: 'tenant-1' }, queryRunner: { manager: failing.manager } });
  assert.deepEqual(failed, {
    ok: true,
    completed: true,
    failed: true,
    years: [2028],
    fetched: 0,
    stillMissing: [{ currency: 'ZAR', year: 2028 }],
  });
  console.log('ok - a failed fetch answers failed true, fetched 0 and what is still missing');
}

async function testRefreshCountsTheCurrentBaseOnly() {
  const queries: Array<{ sql: string; params?: unknown[] }> = [];
  const manager = {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      return [];
    },
  };
  const settings = { getSettings: async () => ({ reportingCurrency: 'USD' }) };
  const calls: unknown[] = [];
  const fxIngestion = {
    refreshWithin: async (...args: unknown[]) => {
      calls.push(args);
      return { completed: true, failed: false };
    },
  };
  const manualRates = { listMissingPairs: async () => [] };
  const api = new CurrencyController(settings as any, fxIngestion as any, manualRates as any, { manager } as any);
  await api.refreshRates({ years: [2024] }, { tenant: { id: 'tenant-1' }, queryRunner: { manager } });
  const rateQueries = queries.filter((query) => query.sql.includes('currency_rate_sets'));
  assert.equal(rateQueries.length, 2);
  for (const query of rateQueries) {
    assert.match(query.sql, /UPPER\(TRIM\(base_currency\)\) = \$3/);
    assert.equal(query.params?.[2], 'USD');
  }
  assert.equal((calls[0] as any[])[2].reportingCurrency, 'USD', 'the run targets the current base');
  console.log('ok - the forced sync counts the pairs of the current reporting currency only');
}

(async () => {
  await testTimeoutLeavesTheJobRunning();
  await testForcedSyncWhileAnotherJobRuns();
  await testConcurrentRequestsMergeIntoTheNextRun();
  await testAnotherBaseIsNotCoveredByTheRunningJob();
  await testFailedJobLeavesNothingStuck();
  await testGateDelaysTheRun();
  await testRefreshAnswer();
  await testRefreshCountsTheCurrentBaseOnly();
  console.log('fx-refresh-wait.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
