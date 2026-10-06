import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import { DatabaseThrottlerStorage } from '../rate-limit-store';

// HTTP rate limits with several API processes (API_WORKERS > 1): the in-memory counter of each
// process would give every process its own budget (4 processes, 4 times the login attempts).
// The counts live in rate_limit_hits; two storages on two DataSources stand for two processes.

const TTL = 60_000;

async function testCountsAddUpAcrossProcesses(a: DatabaseThrottlerStorage, b: DatabaseThrottlerStorage) {
  const key = `spec-${randomUUID()}`;
  // Login: 5 a minute. Eight attempts spread over two processes, three of them at once.
  const first = await Promise.all([a.increment(key, TTL, 5, TTL, 'default'), b.increment(key, TTL, 5, TTL, 'default'), a.increment(key, TTL, 5, TTL, 'default')]);
  assert.deepEqual(first.map((r) => r.totalHits).sort(), [1, 2, 3], 'concurrent hits are counted one by one');
  assert.ok(first.every((r) => !r.isBlocked));
  const fourth = await b.increment(key, TTL, 5, TTL, 'default');
  const fifth = await a.increment(key, TTL, 5, TTL, 'default');
  assert.deepEqual([fourth.totalHits, fifth.totalHits, fifth.isBlocked], [4, 5, false], 'up to the limit: allowed');
  const sixth = await b.increment(key, TTL, 5, TTL, 'default');
  assert.equal(sixth.isBlocked, true, 'the sixth attempt, on the other process, is refused');
  assert.ok(sixth.timeToBlockExpire > 55 && sixth.timeToBlockExpire <= 60, 'blocked for the block duration');
  const seventh = await a.increment(key, TTL, 5, TTL, 'default');
  assert.equal(seventh.isBlocked, true, 'still blocked on every process');
  assert.equal(seventh.totalHits, 6, 'hits are not counted while blocked');
  assert.ok(seventh.timeToExpire > 0 && seventh.timeToExpire <= 60);
}

async function testWindowAndBlockEnd(a: DatabaseThrottlerStorage, b: DatabaseThrottlerStorage) {
  const key = `spec-${randomUUID()}`;
  await a.increment(key, TTL, 2, TTL, 'default');
  await b.increment(key, TTL, 2, TTL, 'default');
  // The window passed: the count starts again.
  await dataSource.query(`UPDATE rate_limit_hits SET window_ends_at = now() - interval '1 second' WHERE key = $1`, [key]);
  const fresh = await b.increment(key, TTL, 2, TTL, 'default');
  assert.deepEqual([fresh.totalHits, fresh.isBlocked], [1, false], 'a new window opens');
  await a.increment(key, TTL, 2, TTL, 'default');
  const blocked = await a.increment(key, TTL, 2, TTL, 'default');
  assert.equal(blocked.isBlocked, true);
  // The block passed: the next hit opens a new window.
  await dataSource.query(`UPDATE rate_limit_hits SET blocked_until = now() - interval '1 second' WHERE key = $1`, [key]);
  const reopened = await b.increment(key, TTL, 2, TTL, 'default');
  assert.deepEqual([reopened.totalHits, reopened.isBlocked], [1, false], 'after the block, counting starts again');
}

async function testFallsBackWhenTheDatabaseFails() {
  const broken = { query: async () => { throw new Error('timeout exceeded when trying to connect'); } };
  const storage = new DatabaseThrottlerStorage(broken as any);
  (storage as any).logger = { warn: () => undefined };
  const key = `spec-${randomUUID()}`;
  const one = await storage.increment(key, TTL, 1, TTL, 'default');
  const two = await storage.increment(key, TTL, 1, TTL, 'default');
  assert.deepEqual([one.totalHits, one.isBlocked, two.isBlocked], [1, false, true], 'the process counts in memory meanwhile');
}

/** A saturated pool: the count does not wait past 1.5 s, it falls back to this process's memory. */
async function testDoesNotWaitForASaturatedPool() {
  const stuck = { query: () => new Promise(() => undefined) };
  const storage = new DatabaseThrottlerStorage(stuck as any, 200);
  (storage as any).logger = { warn: () => undefined };
  const started = Date.now();
  const counting = storage.increment(`spec-${randomUUID()}`, TTL, 5, TTL, 'default');
  // Timers fire in the order they expire, however late a loaded machine runs them: the count
  // must give up at its 200 ms wait, before this timer (and before the 1.5 s default wait).
  let lateTimer: NodeJS.Timeout | undefined;
  const late = new Promise<'late'>((resolve) => { lateTimer = setTimeout(() => resolve('late'), 1_000); });
  const record = await Promise.race([counting, late]);
  clearTimeout(lateTimer);
  const waited = Date.now() - started;
  assert.ok(record !== 'late', 'gave up after its own wait');
  assert.ok(waited >= 180, `gave up after the wait (${waited} ms)`);
  assert.deepEqual([record.totalHits, record.isBlocked], [1, false], 'counted in memory');
}

async function main() {
  process.exitCode = 1;
  await dataSource.initialize();
  const other = new DataSource({ ...(dataSource.options as any), poolSize: 4 });
  await other.initialize();
  const a = new DatabaseThrottlerStorage(dataSource);
  const b = new DatabaseThrottlerStorage(other);
  const failures: string[] = [];
  try {
    for (const [label, test] of [
      ['testCountsAddUpAcrossProcesses', () => testCountsAddUpAcrossProcesses(a, b)],
      ['testWindowAndBlockEnd', () => testWindowAndBlockEnd(a, b)],
      ['testFallsBackWhenTheDatabaseFails', () => testFallsBackWhenTheDatabaseFails()],
      ['testDoesNotWaitForASaturatedPool', () => testDoesNotWaitForASaturatedPool()],
    ] as const) {
      try {
        await test();
        console.log(`ok - ${label}`);
      } catch (err) {
        failures.push(`${label}: ${(err as Error).message}`);
      }
    }
  } finally {
    await dataSource.query(`DELETE FROM rate_limit_hits WHERE key LIKE 'spec-%'`);
    await other.destroy();
    await dataSource.destroy();
  }
  if (failures.length) {
    console.error(`rate-limit-store.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('rate-limit-store.integration.spec: ok');
  process.exit(0);
}

void main();
