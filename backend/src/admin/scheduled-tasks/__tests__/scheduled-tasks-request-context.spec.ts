import * as assert from 'node:assert/strict';
import {
  currentRequestContext,
  currentRequestTenant,
  runOutsideRequest,
  runWithRequestTenant,
} from '../../../common/tenancy/request-tenant-context';
import { ScheduledTasksService } from '../scheduled-tasks.service';

// A cron job scheduled again from a request (an admin edit of its schedule) and a
// task started by hand run outside that request: their timers do not keep the
// tenant and the user of the request that created them (the Markdown workers
// share their time by user, and treat work outside a request as background work).

type Seen = { tenant: string | null; context: ReturnType<typeof currentRequestContext> };

function harness() {
  const row = { name: 'every-second', description: 'd', cron_expression: '* * * * * *', enabled: true, updated_at: new Date() };
  const jobs: Array<{ stop: () => void }> = [];
  const taskRepo = {
    findOne: async () => row,
    findOneBy: async () => row,
    query: async () => [],
    update: async () => undefined,
    save: async () => row,
  };
  const registry = {
    deleteCronJob: () => { throw new Error('no job'); },
    addCronJob: (_name: string, job: { stop: () => void }) => { jobs.push(job); },
  };
  const service = new ScheduledTasksService(taskRepo as any, {} as any, {} as any, registry as any);
  (service as any).logger = { log: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined };
  const ticks: Seen[] = [];
  const runs: Seen[] = [];
  const seen = (): Seen => ({ tenant: currentRequestTenant(), context: currentRequestContext() });
  (service as any).runScheduledTick = async () => { ticks.push(seen()); };
  (service as any).executeTask = async () => { runs.push(seen()); };
  service.register({ name: row.name, description: row.description, defaultCron: row.cron_expression, handler: async () => ({}) });
  return { service, ticks, runs, stopJobs: () => jobs.forEach((job) => job.stop()) };
}

const request = { user: { sub: 'user-1' } };

async function testRequestContext() {
  assert.equal(currentRequestContext(), null);
  runWithRequestTenant('tenant-a', () => {
    assert.deepEqual(currentRequestContext(), { tenantId: 'tenant-a', userId: 'user-1' });
    // A request without tenant is a request still, with no tenant of its own.
    runWithRequestTenant(null, () => {
      assert.equal(currentRequestTenant(), null);
      assert.deepEqual(currentRequestContext(), { tenantId: null, userId: null });
    });
    runOutsideRequest(() => assert.equal(currentRequestContext(), null));
  }, request);
}

async function testCronJobsAndManualRunsLeaveTheRequest() {
  const { service, ticks, runs, stopJobs } = harness();
  try {
    await runWithRequestTenant('tenant-a', async () => {
      // An admin request changes the schedule (the job is created again) and starts the task.
      await service.updateTask('every-second', { cron_expression: '* * * * * *' });
      await service.triggerTask('every-second');
    }, request);
    await new Promise((resolve) => setTimeout(resolve, 2300));
    assert.ok(ticks.length >= 1, `${ticks.length} ticks`);
    for (const tick of ticks) assert.deepEqual(tick, { tenant: null, context: null });
    assert.deepEqual(runs, [{ tenant: null, context: null }]);
  } finally {
    stopJobs();
  }
}

async function run() {
  await testRequestContext();
  await testCronJobsAndManualRunsLeaveTheRequest();
}

run().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error);
  process.exit(1);
});
