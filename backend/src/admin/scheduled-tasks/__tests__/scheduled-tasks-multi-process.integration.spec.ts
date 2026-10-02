import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import dataSource from '../../../data-source';
import { ScheduledTask } from '../scheduled-task.entity';
import { ScheduledTaskRun } from '../scheduled-task-run.entity';
import { ScheduledTasksService } from '../scheduled-tasks.service';

// Several API processes (API_WORKERS > 1, plan planning/perf-scale lot 4A): every process
// schedules every task and their cron jobs fire together. The advisory lock of executeTask only
// skips a run that overlaps another; a fast task could end before the next process tries the
// lock and run once per process. Each tick is now claimed once in scheduled_tasks.last_tick_at.
// Two services on two DataSources stand for two processes.

type Registry = { added: Array<{ name: string; cron: string; job: { stop: () => void } }>; deleted: string[] };

function service(ds: DataSource, registry: Registry) {
  const fake = {
    deleteCronJob: (name: string) => {
      registry.deleted.push(name);
      for (const entry of registry.added.filter((e) => e.name === name)) entry.job.stop();
    },
    addCronJob: (name: string, job: any) => { registry.added.push({ name, cron: String(job.cronTime?.source ?? ''), job }); },
  };
  const svc = new ScheduledTasksService(ds.getRepository(ScheduledTask), ds.getRepository(ScheduledTaskRun), ds, fake as any);
  (svc as any).logger = { log: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined };
  return svc;
}

const tick = (svc: ScheduledTasksService, name: string, cron: string, at: string) =>
  (svc as any).runScheduledTick(name, cron, new Date(at)) as Promise<void>;

async function storedTick(name: string): Promise<string | null> {
  const [row] = await dataSource.query(`SELECT last_tick_at FROM scheduled_tasks WHERE name = $1`, [name]);
  return row?.last_tick_at ? new Date(row.last_tick_at).toISOString() : null;
}

async function cleanup(names: string[]) {
  await dataSource.query(`DELETE FROM scheduled_task_runs WHERE task_name = ANY($1)`, [names]);
  await dataSource.query(`DELETE FROM scheduled_tasks WHERE name = ANY($1)`, [names]);
}

async function testOneTickRunsOnce(other: DataSource) {
  const name = `spec-tick-${randomUUID()}`;
  const cron = '*/5 * * * *';
  await dataSource.query(`INSERT INTO scheduled_tasks (name, description, cron_expression, enabled) VALUES ($1, 'spec', $2, true)`, [name, cron]);
  const regA: Registry = { added: [], deleted: [] };
  const regB: Registry = { added: [], deleted: [] };
  const a = service(dataSource, regA);
  const b = service(other, regB);
  let runs = 0;
  for (const svc of [a, b]) svc.register({ name, description: 'spec', defaultCron: cron, handler: async () => { runs += 1; return {}; } });
  try {
    await Promise.all([tick(a, name, cron, '2026-10-02T10:05:00Z'), tick(b, name, cron, '2026-10-02T10:05:00Z')]);
    assert.equal(runs, 1, 'both processes fire the 10:05 tick, the task runs once');
    assert.equal(await storedTick(name), '2026-10-02T10:05:00.000Z');

    await Promise.all([tick(a, name, cron, '2026-10-02T10:05:00Z'), tick(b, name, cron, '2026-10-02T10:05:00Z')]);
    assert.equal(runs, 1, 'a tick already claimed never runs again');

    await Promise.all([tick(b, name, cron, '2026-10-02T10:10:00Z'), tick(a, name, cron, '2026-10-02T10:10:00Z')]);
    assert.equal(runs, 2, 'the next tick runs once');

    await tick(a, name, cron, '2026-10-02T10:05:00Z');
    assert.equal(runs, 2, 'an older tick (a late process) does not run');

    // Ten rounds of a fast task fired by both at once: exactly ten runs.
    for (let minute = 15; minute < 65; minute += 5) {
      const at = new Date(Date.UTC(2026, 9, 2, 10, minute)).toISOString();
      await Promise.all([tick(a, name, cron, at), tick(b, name, cron, at)]);
    }
    assert.equal(runs, 12, 'ten more ticks, ten more runs');
    const [{ n }] = await dataSource.query(`SELECT count(*)::int AS n FROM scheduled_task_runs WHERE task_name = $1`, [name]);
    assert.equal(n, 12, 'one run row per tick');
  } finally {
    await cleanup([name]);
  }
}

async function testRescheduleAndDisableReachOtherProcesses(other: DataSource) {
  const name = `spec-tick-${randomUUID()}`;
  await dataSource.query(`INSERT INTO scheduled_tasks (name, description, cron_expression, enabled) VALUES ($1, 'spec', '*/5 * * * *', true)`, [name]);
  const regB: Registry = { added: [], deleted: [] };
  const b = service(other, regB);
  let runs = 0;
  b.register({ name, description: 'spec', defaultCron: '*/5 * * * *', handler: async () => { runs += 1; return {}; } });
  try {
    // The admin console changed the cron through another process: this one still has the old job.
    await dataSource.query(`UPDATE scheduled_tasks SET cron_expression = '0 * * * *' WHERE name = $1`, [name]);
    await tick(b, name, '*/5 * * * *', '2026-10-02T11:05:00Z');
    assert.equal(runs, 0, 'a tick of the old schedule does not run');
    assert.deepEqual(regB.added.map((e) => [e.name, e.cron]), [[name, '0 * * * *']], 'the job is rescheduled on the stored cron');

    await tick(b, name, '0 * * * *', '2026-10-02T12:00:00Z');
    assert.equal(runs, 1, 'the new schedule runs');

    await dataSource.query(`UPDATE scheduled_tasks SET enabled = false WHERE name = $1`, [name]);
    await tick(b, name, '0 * * * *', '2026-10-02T13:00:00Z');
    assert.equal(runs, 1, 'a task disabled elsewhere does not run');
    assert.ok(regB.deleted.includes(name), 'and its job is removed here');
  } finally {
    for (const entry of regB.added) entry.job.stop();
    await cleanup([name]);
  }
}

async function testConcurrentBootstrapRegistersOnce(other: DataSource) {
  const name = `spec-boot-${randomUUID()}`;
  const regA: Registry = { added: [], deleted: [] };
  const regB: Registry = { added: [], deleted: [] };
  const services = [service(dataSource, regA), service(other, regB)];
  for (const svc of services) svc.register({ name, description: 'spec', defaultCron: '0 3 * * *', handler: async () => ({}) });
  try {
    // Only this task is registered on these services: both start at once on a database without it.
    await Promise.all(services.map((svc) => svc.onApplicationBootstrap()));
    const [{ n }] = await dataSource.query(`SELECT count(*)::int AS n FROM scheduled_tasks WHERE name = $1`, [name]);
    assert.equal(n, 1, 'one row, and neither process failed on the unique name');
    assert.equal(regA.added.length + regB.added.length, 2, 'both processes scheduled it');
  } finally {
    for (const entry of [...regA.added, ...regB.added]) entry.job.stop();
    await cleanup([name]);
  }
}

/**
 * A stored tick more than a day ahead (a clock that was ahead, a VM restored from a snapshot)
 * would stop the task until that date: it is claimed over, with a warning. Less than a day ahead
 * is left alone (an ordinary tick of another process can be slightly ahead of this one).
 */
async function testFutureTickIsClaimedOver(other: DataSource) {
  const name = `spec-tick-${randomUUID()}`;
  const cron = '0 * * * *';
  await dataSource.query(`INSERT INTO scheduled_tasks (name, description, cron_expression, enabled, last_tick_at) VALUES ($1, 'spec', $2, true, now() + interval '3 days')`, [name, cron]);
  const reg: Registry = { added: [], deleted: [] };
  const a = service(dataSource, reg);
  const b = service(other, reg);
  const warnings: string[] = [];
  (a as any).logger.warn = (line: string) => warnings.push(line);
  (b as any).logger.warn = (line: string) => warnings.push(line);
  let runs = 0;
  for (const svc of [a, b]) svc.register({ name, description: 'spec', defaultCron: cron, handler: async () => { runs += 1; return {}; } });
  try {
    const tickAt = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000);
    await Promise.all([tick(a, name, cron, tickAt.toISOString()), tick(b, name, cron, tickAt.toISOString())]);
    assert.equal(runs, 1, 'a tick stored 3 days ahead no longer stops the task, and it still runs once');
    assert.equal(await storedTick(name), tickAt.toISOString(), 'the stored tick is back to the real one');
    assert.equal(warnings.filter((w) => /in the future/.test(w)).length, 1, 'one warning');

    await dataSource.query(`UPDATE scheduled_tasks SET last_tick_at = now() + interval '1 hour' WHERE name = $1`, [name]);
    await tick(a, name, cron, new Date(tickAt.getTime() + 3_600_000).toISOString());
    assert.equal(runs, 1, 'a tick less than a day ahead is left alone');
  } finally {
    await cleanup([name]);
  }
}

/**
 * At a stop the scheduled tasks get until the deadline: a run that ends in time is recorded as
 * usual, a run still going is recorded as interrupted (not "running" for an hour), and no run
 * starts afterwards.
 */
async function testStopWaitsThenRecordsInterruptedRuns() {
  const quick = `spec-stop-${randomUUID()}`;
  const slow = `spec-stop-${randomUUID()}`;
  for (const name of [quick, slow]) {
    await dataSource.query(`INSERT INTO scheduled_tasks (name, description, cron_expression, enabled) VALUES ($1, 'spec', '0 * * * *', false)`, [name]);
  }
  const svc = service(dataSource, { added: [], deleted: [] });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let quickRuns = 0;
  svc.register({ name: quick, description: 'spec', defaultCron: '0 * * * *', handler: async () => { await new Promise((r) => setTimeout(r, 300)); quickRuns += 1; return {}; } });
  svc.register({ name: slow, description: 'spec', defaultCron: '0 * * * *', handler: async () => { await gate; return {}; } });
  try {
    const runs = [svc.executeTask(quick), svc.executeTask(slow)];
    await new Promise((resolve) => setTimeout(resolve, 150));
    const started = Date.now();
    const interrupted = await svc.drain(Date.now() + 1_000);
    const waited = Date.now() - started;
    assert.ok(waited >= 900 && waited < 3_000, `the stop waited until its deadline for the slow run (${waited} ms)`);
    assert.equal(interrupted, 1);
    assert.equal(quickRuns, 1, 'the quick run finished during the wait');
    const rows = await dataSource.query(
      `SELECT task_name, status, error FROM scheduled_task_runs WHERE task_name = ANY($1) ORDER BY task_name`, [[quick, slow]],
    );
    const byName = Object.fromEntries(rows.map((r: any) => [r.task_name, r]));
    assert.equal(byName[quick].status, 'success');
    assert.equal(byName[slow].status, 'failure');
    assert.match(byName[slow].error, /Interrupted: the API process stopped/);
    const [task] = await dataSource.query(`SELECT last_status FROM scheduled_tasks WHERE name = $1`, [slow]);
    assert.equal(task.last_status, 'failure', 'the task shows its last run failed, not running');

    await svc.executeTask(quick);
    assert.equal(quickRuns, 1, 'no run starts once the stop began');
    release();
    await Promise.allSettled(runs);
  } finally {
    release();
    await cleanup([quick, slow]);
  }
}

async function main() {
  process.exitCode = 1;
  await dataSource.initialize();
  const other = new DataSource({ ...(dataSource.options as any), poolSize: 4 });
  await other.initialize();
  const failures: string[] = [];
  try {
    for (const [label, test] of [
      ['testOneTickRunsOnce', testOneTickRunsOnce],
      ['testRescheduleAndDisableReachOtherProcesses', testRescheduleAndDisableReachOtherProcesses],
      ['testConcurrentBootstrapRegistersOnce', testConcurrentBootstrapRegistersOnce],
      ['testFutureTickIsClaimedOver', testFutureTickIsClaimedOver],
      ['testStopWaitsThenRecordsInterruptedRuns', () => testStopWaitsThenRecordsInterruptedRuns()],
    ] as const) {
      try {
        await test(other);
        console.log(`ok - ${label}`);
      } catch (err) {
        failures.push(`${label}: ${(err as Error).message}`);
      }
    }
  } finally {
    await other.destroy();
    await dataSource.destroy();
  }
  if (failures.length) {
    console.error(`scheduled-tasks-multi-process.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('scheduled-tasks-multi-process.integration.spec: ok');
  process.exitCode = 0;
}

void main();
