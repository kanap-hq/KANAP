import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AmountsAutovacuum1853820000000 as Migration } from '../../migrations/1853820000000-amounts-autovacuum';

// Migration 1853820000000 (autovacuum of the amounts tables), against a real database, each test
// in a transaction rolled back at the end: up() sets the options, down() resets them, a table
// held by another session (a running VACUUM takes the same lock) is skipped after 5 s instead of
// blocking or failing the deploy, the transaction stays usable, and the lock timeout in force
// before is restored.

const migration = new Migration();

async function options(runner: QueryRunner, table: string): Promise<string[]> {
  const [row] = await runner.query(`SELECT COALESCE(reloptions, '{}') AS options FROM pg_class WHERE oid = to_regclass($1)`, [table]);
  return (row?.options ?? []).filter((o: string) => o.startsWith('autovacuum_')).sort();
}

async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function quiet<T>(fn: () => Promise<T>, lines: string[]): Promise<T> {
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try {
    return await fn();
  } finally {
    console.log = original;
  }
}

async function testUpAndDown() {
  await inRolledBackTransaction(async (runner) => {
    const lines: string[] = [];
    await quiet(() => migration.down(runner), lines);
    assert.deepEqual(await options(runner, 'spend_amounts'), [], 'down() resets the options');
    await quiet(() => migration.up(runner), lines);
    const [{ version }] = await runner.query(`SELECT current_setting('server_version_num')::int AS version`);
    const expected = [
      'autovacuum_analyze_scale_factor=0.01',
      'autovacuum_vacuum_scale_factor=0.02',
      ...(Number(version) >= 130000 ? ['autovacuum_vacuum_insert_scale_factor=0.05'] : []),
    ].sort();
    assert.deepEqual(await options(runner, 'spend_amounts'), expected);
    assert.deepEqual(await options(runner, 'capex_amounts'), expected);
    await quiet(() => migration.up(runner), lines);
    assert.deepEqual(await options(runner, 'spend_amounts'), expected, 'a second up() changes nothing');
  });
}

async function testBusyTableIsSkippedNotBlocking() {
  const holder = dataSource.createQueryRunner();
  await holder.connect();
  await holder.startTransaction();
  try {
    // The lock a VACUUM or an ANALYZE holds.
    await holder.query(`LOCK TABLE capex_amounts IN SHARE UPDATE EXCLUSIVE MODE`);
    await inRolledBackTransaction(async (runner) => {
      await runner.query(`SET LOCAL lock_timeout = '42s'`);
      await runner.query(`ALTER TABLE spend_amounts RESET (autovacuum_vacuum_scale_factor)`);
      const lines: string[] = [];
      const started = Date.now();
      await quiet(() => migration.up(runner), lines);
      const elapsed = Date.now() - started;
      assert.ok(elapsed >= 4_500 && elapsed < 15_000, `waited about 5 s for the busy table (${elapsed} ms)`);
      assert.ok(lines.some((l) => /capex_amounts was busy/.test(l)), 'the busy table is named in the log');
      assert.ok((await options(runner, 'spend_amounts')).includes('autovacuum_vacuum_scale_factor=0.02'), 'the free table is set');
      const [{ timeout }] = await runner.query(`SELECT current_setting('lock_timeout') AS timeout`);
      assert.equal(timeout, '42s', 'the lock timeout in force before is restored');
      const [{ ok }] = await runner.query(`SELECT 1 AS ok`);
      assert.equal(ok, 1, 'the migration transaction is still usable');
    });
  } finally {
    await holder.rollbackTransaction();
    await holder.release();
  }
}

/** A table the KANAP role does not own: up() and down() change nothing and say how to do it. */
async function testTableOfAnotherOwnerIsLeftAlone() {
  const sent: string[] = [];
  const fake = {
    isTransactionActive: true,
    query: async (sql: string) => {
      sent.push(sql);
      if (/server_version_num/.test(sql)) return [{ version: 160000 }];
      if (/pg_has_role/.test(sql)) return [{ present: true, owned: false }];
      return [];
    },
  } as unknown as QueryRunner;
  const lines: string[] = [];
  await quiet(() => migration.up(fake), lines);
  await quiet(() => migration.down(fake), lines);
  assert.equal(sent.filter((q) => /ALTER TABLE/.test(q)).length, 0, 'no ALTER on a table of another owner');
  assert.equal(lines.filter((l) => /owned by another role/.test(l)).length, 4, 'both tables, up and down, logged');
  assert.ok(lines.some((l) => /as its owner: ALTER TABLE spend_amounts SET \(/.test(l)), 'the statement to run is given');
}

async function main() {
  process.exitCode = 1;
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const [label, test] of [
      ['testUpAndDown', testUpAndDown],
      ['testBusyTableIsSkippedNotBlocking', testBusyTableIsSkippedNotBlocking],
      ['testTableOfAnotherOwnerIsLeftAlone', testTableOfAnotherOwnerIsLeftAlone],
    ] as const) {
      try {
        await test();
        console.log(`ok - ${label}`);
      } catch (err) {
        failures.push(`${label}: ${(err as Error).message}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    console.error(`amounts-autovacuum-migration.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('amounts-autovacuum-migration.integration.spec: ok');
  process.exitCode = 0;
}

void main();
