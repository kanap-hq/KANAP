import * as assert from 'node:assert/strict';
import { ScheduledTasksService } from '../scheduled-tasks.service';

// A task registered with `runOnStartup` runs once when the API server starts:
// `main.ts` calls `runStartupTasks()` after `listen`, never the bootstrap of an
// AppModule context (scripts, specs). Only enabled tasks run, at most once, the
// run is not awaited, and a failure is logged without escaping as an unhandled
// rejection.

type StoredTask = { name: string; description: string; cron_expression: string; enabled: boolean };

function harness(stored: StoredTask[]) {
  const rows = new Map(stored.map((task) => [task.name, { ...task }]));
  const jobs: Array<{ stop: () => void }> = [];
  const taskRepo = {
    findOne: async ({ where }: any) => rows.get(where.name) ?? null,
    findOneBy: async ({ name }: any) => rows.get(name) ?? null,
    save: async (task: StoredTask) => { rows.set(task.name, { ...task }); return task; },
    update: async () => undefined,
  };
  const registry = {
    deleteCronJob: () => { throw new Error('no job'); },
    addCronJob: (_name: string, job: { stop: () => void }) => { jobs.push(job); },
  };
  const service = new ScheduledTasksService(taskRepo as any, {} as any, {} as any, registry as any);
  (service as any).logger = { log: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined };
  const started: string[] = [];
  (service as any).executeTask = async (name: string) => {
    started.push(name);
    if (name === 'failing') throw new Error('boom');
  };
  return { service, started, stopJobs: () => jobs.forEach((job) => job.stop()) };
}

const handler = async () => ({});

async function testStartupRunOnlyForEnabledOptIn() {
  const { service, started, stopJobs } = harness([
    { name: 'disabled-opt-in', description: 'd', cron_expression: '0 * * * *', enabled: false },
  ]);
  service.register({ name: 'opt-in', description: 'a', defaultCron: '0 * * * *', handler, runOnStartup: true });
  service.register({ name: 'disabled-opt-in', description: 'd', defaultCron: '0 * * * *', handler, runOnStartup: true });
  service.register({ name: 'cron-only', description: 'c', defaultCron: '0 * * * *', handler });
  try {
    await service.onApplicationBootstrap();
    assert.deepEqual(started, [], 'the bootstrap alone (any AppModule context) runs nothing');
    service.runStartupTasks();
    assert.deepEqual(started, ['opt-in'], 'only the enabled task that opted in runs at startup');
    service.runStartupTasks();
    assert.deepEqual(started, ['opt-in'], 'at most once');
  } finally {
    stopJobs();
  }
}

async function testStartupFailureIsContained() {
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on('unhandledRejection', onUnhandled);
  const { service, started, stopJobs } = harness([]);
  service.register({ name: 'failing', description: 'f', defaultCron: '0 * * * *', handler, runOnStartup: true });
  try {
    await service.onApplicationBootstrap();
    service.runStartupTasks();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(started, ['failing']);
    assert.deepEqual(unhandled, [], 'a failing startup run is caught');
  } finally {
    process.off('unhandledRejection', onUnhandled);
    stopJobs();
  }
}

async function run() {
  await testStartupRunOnlyForEnabledOptIn();
  await testStartupFailureIsContained();
  console.log('scheduled-tasks-startup.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
