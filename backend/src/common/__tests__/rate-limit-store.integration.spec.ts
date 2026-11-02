import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { DataSource } from 'typeorm';
import dataSource from '../../data-source';
import { DatabaseHitCounter, DatabaseThrottlerStorage } from '../rate-limit-store';

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

const ATTEMPTS = { limit: 5, ttl: 15 * 60_000, blockDuration: 15 * 60_000 };

/** The sign-in attempt counts (DatabaseHitCounter): shared by the processes, and cleared for all of them. */
async function testHitCounterSharedAndCleared(a: DataSource, b: DataSource) {
  const one = new DatabaseHitCounter(a);
  const two = new DatabaseHitCounter(b);
  const key = `spec-${randomUUID()}`;
  const first = await Promise.all([one.hit(key, ATTEMPTS), two.hit(key, ATTEMPTS), one.hit(key, ATTEMPTS)]);
  assert.ok(first.every((r) => !r.blocked));
  assert.equal((await two.hit(key, ATTEMPTS)).blocked, false);
  assert.equal((await one.hit(key, ATTEMPTS)).blocked, false, 'five attempts over two processes: allowed');
  const sixth = await two.hit(key, ATTEMPTS);
  assert.equal(sixth.blocked, true, 'the sixth, on the other process, is refused');
  assert.ok(sixth.retryAfterMs > 890_000 && sixth.retryAfterMs <= 900_000, `blocked for 15 minutes (${sixth.retryAfterMs} ms)`);
  assert.equal((await one.hit(key, ATTEMPTS)).blocked, true, 'on every process');

  await one.clear(key);
  const [row] = await dataSource.query(`SELECT count(*)::int AS n FROM rate_limit_hits WHERE key = $1`, [key]);
  assert.equal(row.n, 0, 'cleared in the table');
  assert.equal((await two.hit(key, ATTEMPTS)).blocked, false, 'the other process starts again from zero');

  const other = `spec-${randomUUID()}`;
  for (let i = 0; i < 4; i += 1) await one.hit(other, ATTEMPTS);
  await two.clear(other);
  for (let i = 0; i < 5; i += 1) assert.equal((await (i % 2 ? one : two).hit(other, ATTEMPTS)).blocked, false, `after a clear, attempt ${i + 1}`);
  assert.equal((await one.hit(other, ATTEMPTS)).blocked, true);
}

/** `clearPrefix` forgets, on every process, the keys that start with the prefix, and only those. */
async function testHitCounterClearPrefix(a: DataSource, b: DataSource) {
  const one = new DatabaseHitCounter(a);
  const two = new DatabaseHitCounter(b);
  const account = `spec-${randomUUID()}`;
  const keys = [`${account}.1`, `${account}.2`, `${account}x.1`];
  for (const key of keys) {
    for (let i = 0; i < 5; i += 1) await one.hit(key, ATTEMPTS);
    await one.block(key, ATTEMPTS.blockDuration);
  }
  await two.clearPrefix(`${account}.`);
  assert.equal((await one.hit(keys[0], ATTEMPTS)).hits, 1, 'cleared');
  assert.equal((await two.hit(keys[1], ATTEMPTS)).hits, 1, 'cleared for every key of the prefix');
  assert.equal((await one.hit(keys[2], ATTEMPTS)).blocked, true, 'another prefix stays blocked');
  await one.clearPrefix(account);
}

/** A block set by one process refuses the key on every process, past the end of the window. */
async function testHitCounterBlockIsShared(a: DataSource, b: DataSource) {
  const one = new DatabaseHitCounter(a);
  const two = new DatabaseHitCounter(b);
  const key = `spec-${randomUUID()}`;
  for (let i = 1; i <= 5; i += 1) assert.equal((await one.hit(key, ATTEMPTS)).hits, i, `hit ${i} counted`);
  await two.block(key, 15 * 60_000);
  await dataSource.query(`UPDATE rate_limit_hits SET window_ends_at = now() - interval '1 second' WHERE key = $1`, [key]);
  const refused = await one.hit(key, ATTEMPTS);
  assert.equal(refused.blocked, true, 'refused on the other process after the window');
  assert.ok(refused.retryAfterMs > 890_000 && refused.retryAfterMs <= 900_000, `for the block (${refused.retryAfterMs} ms)`);
  await one.block(key, 60_000);
  assert.ok((await two.hit(key, ATTEMPTS)).retryAfterMs > 890_000, 'a shorter block keeps the longer one');
  await dataSource.query(`UPDATE rate_limit_hits SET blocked_until = now() - interval '1 second' WHERE key = $1`, [key]);
  const after = await two.hit(key, ATTEMPTS);
  assert.deepEqual([after.hits, after.blocked, after.retryAfterMs], [1, false, 0], 'after the block, a new window');
  const fresh = `spec-${randomUUID()}`;
  await one.block(fresh, 60_000);
  assert.equal((await two.hit(fresh, ATTEMPTS)).blocked, true, 'a key without hits can be blocked');
}

/** A block the database takes is not copied into the process's memory: the memory stays empty. */
async function testHitCounterMemoryStaysBounded(a: DataSource) {
  const counter = new DatabaseHitCounter(a);
  const memory = () => ((counter as any).fallback as any).entries.size as number;
  for (let i = 0; i < 50; i += 1) {
    const key = `spec-${randomUUID()}`;
    await counter.hit(key, ATTEMPTS);
    await counter.block(key, 15 * 60_000);
    assert.equal((await counter.hit(key, ATTEMPTS)).blocked, true, 'blocked in the database');
  }
  assert.equal(memory(), 0, 'fifty blocks, nothing kept in memory');
}

/** `release` takes back one hit of its window on every process, and leaves the other hits counted. */
async function testHitCounterRelease(a: DataSource, b: DataSource) {
  const one = new DatabaseHitCounter(a);
  const two = new DatabaseHitCounter(b);
  const key = `spec-${randomUUID()}`;
  await one.hit(key, ATTEMPTS);
  await two.hit(key, ATTEMPTS);
  const third = await one.hit(key, ATTEMPTS);
  assert.equal(third.hits, 3);
  await two.release(key, third.window);
  assert.equal((await one.hit(key, ATTEMPTS)).hits, 3, 'one hit taken back, the two earlier ones kept');

  // A window that has ended: its hit is not taken from the next window.
  await dataSource.query(`UPDATE rate_limit_hits SET window_ends_at = now() - interval '1 second' WHERE key = $1`, [key]);
  const fresh = await two.hit(key, ATTEMPTS);
  assert.equal(fresh.hits, 1, 'a new window');
  await one.release(key, third.window);
  assert.equal((await two.hit(key, ATTEMPTS)).hits, 2, 'nothing taken back from the new window');

  // A blocked key stays blocked.
  for (let i = 0; i < 3; i += 1) await one.hit(key, ATTEMPTS);
  const over = await two.hit(key, ATTEMPTS);
  assert.equal(over.blocked, true);
  await one.release(key, over.window);
  assert.equal((await two.hit(key, ATTEMPTS)).blocked, true, 'still blocked');

  // Concurrent releases and hits add up exactly.
  const other = `spec-${randomUUID()}`;
  const hits = await Promise.all([one.hit(other, ATTEMPTS), two.hit(other, ATTEMPTS), one.hit(other, ATTEMPTS), two.hit(other, ATTEMPTS)]);
  await Promise.all([one.release(other, hits[0].window), two.release(other, hits[1].window), one.hit(other, ATTEMPTS)]);
  const [row] = await dataSource.query(`SELECT hits FROM rate_limit_hits WHERE key = $1`, [other]);
  assert.equal(Number(row.hits), 3, 'four hits, two taken back, one more');
}

async function testHitCounterFallsBackWhenTheDatabaseFails() {
  const broken = { query: async () => { throw new Error('timeout exceeded when trying to connect'); } };
  const counter = new DatabaseHitCounter(broken as any);
  (counter as any).logger = { warn: () => undefined };
  const rule = { limit: 1, ttl: TTL, blockDuration: TTL };
  const key = `spec-${randomUUID()}`;
  assert.equal((await counter.hit(key, rule)).blocked, false);
  assert.equal((await counter.hit(key, rule)).blocked, true, 'the process counts in memory meanwhile');
  await counter.clear(key);
  assert.equal((await counter.hit(key, rule)).blocked, false, 'and clears in memory');
  await counter.block(key, TTL);
  assert.equal((await counter.hit(key, rule)).blocked, true, 'and blocks in memory');
  const counted = `spec-${randomUUID()}`;
  const wide = { limit: 5, ttl: TTL, blockDuration: TTL };
  await counter.hit(counted, wide);
  const second = await counter.hit(counted, wide);
  await counter.release(counted, second.window);
  assert.equal((await counter.hit(counted, wide)).hits, 2, 'and takes a hit back in memory');
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
      ['testHitCounterSharedAndCleared', () => testHitCounterSharedAndCleared(dataSource, other)],
      ['testHitCounterClearPrefix', () => testHitCounterClearPrefix(dataSource, other)],
      ['testHitCounterBlockIsShared', () => testHitCounterBlockIsShared(dataSource, other)],
      ['testHitCounterMemoryStaysBounded', () => testHitCounterMemoryStaysBounded(dataSource)],
      ['testHitCounterRelease', () => testHitCounterRelease(dataSource, other)],
      ['testHitCounterFallsBackWhenTheDatabaseFails', () => testHitCounterFallsBackWhenTheDatabaseFails()],
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
