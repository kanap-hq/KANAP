import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../../data-source';
import { ScheduledTask } from '../scheduled-task.entity';
import { ScheduledTaskRun } from '../scheduled-task-run.entity';
import { ScheduledTasksService } from '../scheduled-tasks.service';

// `executeTask` holds the task's session advisory lock on one dedicated pool
// connection and releases it there. Before, the lock and the unlock were two
// `dataSource.query` calls that could land on two pool connections: the unlock
// then failed silently and the lock stayed held, so later runs were skipped.
// A second run of a task that is still running is skipped.

function service() {
  const registry = { deleteCronJob: () => undefined, addCronJob: () => undefined };
  const svc = new ScheduledTasksService(
    dataSource.getRepository(ScheduledTask),
    dataSource.getRepository(ScheduledTaskRun),
    dataSource,
    registry as any,
  );
  (svc as any).logger = { log: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined };
  return svc;
}

/** Sessions holding the task's advisory lock (low 32 bits of the hashtext key, one-key form). */
async function lockHolders(name: string): Promise<number> {
  const [row] = await dataSource.query(
    `SELECT count(*)::int AS n FROM pg_locks
      WHERE locktype = 'advisory' AND objsubid = 1 AND granted
        AND objid::bigint = (hashtext($1)::bigint & 4294967295)`,
    [name],
  );
  return row.n;
}

/** Whether a fresh connection can take the lock (and gives it back at once). */
async function lockIsFree(name: string): Promise<boolean> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  try {
    const [row] = await runner.query(`SELECT pg_try_advisory_lock(hashtext($1)) AS acquired`, [name]);
    if (row.acquired) await runner.query(`SELECT pg_advisory_unlock(hashtext($1))`, [name]);
    return row.acquired;
  } finally {
    await runner.release();
  }
}

/** The task row the run log references (deleted with its runs afterwards). */
async function seedTask(name: string) {
  await dataSource.query(
    `INSERT INTO scheduled_tasks (name, description, cron_expression, enabled) VALUES ($1, 'spec', '0 * * * *', false)`,
    [name],
  );
}

async function cleanup(name: string) {
  await dataSource.query(`DELETE FROM scheduled_tasks WHERE name = $1`, [name]);
}

async function testUnlockReleasesWithConcurrentQueries() {
  const name = `spec-lock-${randomUUID()}`;
  await seedTask(name);
  const svc = service();
  let calls = 0;
  svc.register({
    name,
    description: 'spec',
    defaultCron: '0 * * * *',
    handler: async () => {
      calls += 1;
      // The short query takes the most recently released connection (the one the
      // lock was taken on), the long one another: after them, the pool hands out
      // the other connection first, so a pool-level unlock would miss the lock.
      await Promise.all([
        dataSource.query(`SELECT pg_sleep(0.02)`),
        dataSource.query(`SELECT pg_sleep(0.15)`),
      ]);
      return {};
    },
  });
  try {
    for (let round = 1; round <= 3; round++) {
      await svc.executeTask(name);
      assert.equal(calls, round, `round ${round}: the task ran (the lock was free)`);
      assert.equal(await lockHolders(name), 0, `round ${round}: no session holds the lock after the run`);
      assert.equal(await lockIsFree(name), true, `round ${round}: another connection can take the lock`);
    }
  } finally {
    await cleanup(name);
  }
}

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function testConcurrentRunIsSkipped() {
  const name = `spec-lock-${randomUUID()}`;
  await seedTask(name);
  const svc = service();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const running = new Promise<void>((resolve) => { entered = resolve; });
  svc.register({
    name,
    description: 'spec',
    defaultCron: '0 * * * *',
    handler: async () => {
      calls += 1;
      entered();
      await gate;
      return {};
    },
  });
  const runs: Array<Promise<void>> = [];
  try {
    runs.push(svc.executeTask(name));
    await Promise.race([running, delay(5000).then(() => { throw new Error('the first run did not start'); })]);
    assert.equal(await lockHolders(name), 1, 'the running task holds the lock');

    runs.push(svc.executeTask(name));
    const outcome = await Promise.race([runs[1].then(() => 'returned'), delay(2000).then(() => 'still running')]);
    assert.equal(outcome, 'returned', 'a second run while the first is running returns at once');
    assert.equal(calls, 1, 'the second run is skipped');

    release();
    await runs[0];
    assert.equal(await lockHolders(name), 0, 'released after the run');
    await svc.executeTask(name);
    assert.equal(calls, 2, 'the next run goes ahead');
  } finally {
    release();
    await Promise.allSettled(runs);
    await cleanup(name);
  }
}

async function main() {
  // A run that never settles would let the process exit 0 with nothing printed.
  process.exitCode = 1;
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const [label, test] of [
      ['testUnlockReleasesWithConcurrentQueries', testUnlockReleasesWithConcurrentQueries],
      ['testConcurrentRunIsSkipped', testConcurrentRunIsSkipped],
    ] as const) {
      try {
        await test();
      } catch (err) {
        failures.push(`${label}: ${(err as Error).message}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    console.error(`scheduled-tasks-lock.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('scheduled-tasks-lock.integration.spec: ok');
  process.exitCode = 0;
}

void main();
