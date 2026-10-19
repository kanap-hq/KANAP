import * as assert from 'node:assert/strict';
import { CurrencyController } from '../currency.controller';
import { FxIngestionService } from '../fx-ingestion.service';

/**
 * A forced sync waits for the fetch, and a second call while it runs does not
 * start another one. The year set and the answer shape are checked on a
 * controller whose collaborators are stubs.
 */

function ingestion(): FxIngestionService {
  return new FxIngestionService({} as any, {} as any, {} as any, {} as any, {} as any);
}

async function testTimeoutLeavesTheJobRunning() {
  const service = ingestion() as any;
  let calls = 0;
  let release: () => void = () => undefined;
  const hung = new Promise<unknown[]>((resolve) => {
    release = () => resolve([]);
  });
  service.refreshTenant = () => {
    calls += 1;
    return hung;
  };

  const first = await service.refreshWithin('tenant-1', [2028], { label: 'manual-api', timeoutMs: 40 });
  assert.deepEqual(first, { completed: false });
  assert.equal(calls, 1, 'the timed-out refresh is still the one job');
  const second = await service.refreshWithin('tenant-1', [2028], { timeoutMs: 40 });
  assert.deepEqual(second, { completed: false });
  assert.equal(calls, 1, 'a refresh already running is not started again');

  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  const third = await service.refreshWithin('tenant-1', [2028], { timeoutMs: 40 });
  assert.deepEqual(third, { completed: true });
  assert.equal(calls, 2);
  console.log('ok - a forced sync that runs long answers completed false and does not start a second fetch');
}

async function testEnqueueAfterChainsTheNextRefresh() {
  const service = ingestion() as any;
  const calls: Array<{ years: unknown; reportingCurrency?: string; label?: string }> = [];
  let release: () => void = () => undefined;
  const hung = new Promise<unknown[]>((resolve) => {
    release = () => resolve([]);
  });
  service.refreshTenant = (_tenantId: string, years: unknown, opts?: { reportingCurrency?: string; label?: string }) => {
    calls.push({ years, reportingCurrency: opts?.reportingCurrency, label: opts?.label });
    return calls.length === 1 ? hung : Promise.resolve([]);
  };

  const first = await service.refreshWithin('tenant-1', [2024], { timeoutMs: 20 });
  assert.deepEqual(first, { completed: false });
  const second = await service.refreshWithin('tenant-1', [2019, 2028], {
    label: 'reporting-currency',
    reportingCurrency: 'CHF',
    enqueueAfter: true,
    timeoutMs: 20,
  });
  assert.deepEqual(second, { completed: false });
  assert.equal(calls.length, 1, 'the running job is not replaced');

  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(calls.length, 2, 'the chained refresh starts once the running job has released the tenant');
  assert.deepEqual(calls[1].years, [2019, 2028]);
  assert.equal(calls[1].reportingCurrency, 'CHF');
  assert.equal(calls[1].label, 'reporting-currency');
  console.log('ok - a reporting-currency refresh waits for the running job, then fetches its own years');
}

function controller(opts: {
  missing: Array<{ currency: string; year: number }>;
  completed: boolean;
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
    refreshWithin: async () => ({ completed: opts.completed }),
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
  const api = new CurrencyController({} as any, fxIngestion as any, manualRates as any, { manager } as any);
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
  assert.equal(finished.fetched, 2, 'ZAR and EUR became usable; 0 and null did not');
  assert.deepEqual(finished.stillMissing, [{ currency: 'XXX', year: 2028 }]);
  assert.deepEqual(done.reports, [false, false]);
  console.log('ok - a finished sync counts the new rates and lists what is still missing');

  const explicit = controller({ missing: [{ currency: 'ZAR', year: 2028 }], completed: false });
  const named = await explicit.api.refreshRates({ years: [2020] }, { tenant: { id: 'tenant-1' }, queryRunner: { manager: explicit.manager } });
  assert.deepEqual(named, { ok: true, completed: false, years: [2020] });
  assert.deepEqual(explicit.reports, [], 'an explicit year list does not read the missing pairs');
  console.log('ok - explicit years stay the requested years');
}

(async () => {
  await testTimeoutLeavesTheJobRunning();
  await testEnqueueAfterChainsTheNextRefresh();
  await testRefreshAnswer();
  console.log('fx-refresh-wait.spec: ok');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
