import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { EntityManager } from 'typeorm';
import dataSource from '../../data-source';
import { withSavepoint } from '../savepoint.util';

// withSavepoint against a real transaction: a failure inside undoes only its
// own work, the transaction stays usable, nested calls unwind one level each.
// Everything runs on a temporary table dropped with the rolled-back transaction.

async function inTransaction(fn: (manager: EntityManager) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`CREATE TEMP TABLE savepoint_probe (v text NOT NULL) ON COMMIT DROP`);
    await fn(runner.manager);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

const put = (m: EntityManager, v: string) => m.query(`INSERT INTO savepoint_probe (v) VALUES ($1)`, [v]);
const values = async (m: EntityManager) =>
  ((await m.query(`SELECT v FROM savepoint_probe ORDER BY v`)) as Array<{ v: string }>).map((r) => r.v);

async function testFailureRollsBackOnlyItsOwnWork() {
  await inTransaction(async (m) => {
    await put(m, 'a-before');
    await assert.rejects(
      withSavepoint(m, async () => {
        await put(m, 'b-inside');
        await m.query(`SELECT 1 / 0`);
      }),
      (err: any) => err?.code === '22012',
      'the database error is rethrown',
    );
    await put(m, 'c-after');
    assert.deepEqual(await values(m), ['a-before', 'c-after'], 'the transaction is usable and kept the work outside');
  });
}

async function testApplicationErrorRollsBackToo() {
  await inTransaction(async (m) => {
    await assert.rejects(
      withSavepoint(m, async () => {
        await put(m, 'written');
        throw new Error('refused');
      }),
      /refused/,
    );
    assert.deepEqual(await values(m), []);
  });
}

async function testSuccessReturnsAndKeepsWork() {
  await inTransaction(async (m) => {
    const result = await withSavepoint(m, async () => {
      await put(m, 'kept');
      return 42;
    });
    assert.equal(result, 42);
    assert.deepEqual(await values(m), ['kept']);
  });
}

async function testNestedInnerFailure() {
  await inTransaction(async (m) => {
    await withSavepoint(m, async () => {
      await put(m, 'outer-1');
      await assert.rejects(
        withSavepoint(m, async () => {
          await put(m, 'inner');
          await m.query(`INSERT INTO savepoint_probe (v) VALUES (NULL)`);
        }),
        (err: any) => err?.code === '23502',
      );
      await put(m, 'outer-2');
    });
    assert.deepEqual(await values(m), ['outer-1', 'outer-2'], 'only the inner level is undone');
  });
}

async function testNestedOuterFailureUndoesReleasedInner() {
  await inTransaction(async (m) => {
    await put(m, 'base');
    await assert.rejects(
      withSavepoint(m, async () => {
        await withSavepoint(m, () => put(m, 'inner'));
        await m.query(`SELECT 1 / 0`);
      }),
    );
    assert.deepEqual(await values(m), ['base'], 'a released inner level goes with its outer level');
  });
}

async function testWithoutTransactionRunsDirectly() {
  const result = await withSavepoint(dataSource.manager, async () => {
    const [row] = await dataSource.manager.query(`SELECT 7 AS n`);
    return Number(row.n);
  });
  assert.equal(result, 7);
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [
      testFailureRollsBackOnlyItsOwnWork,
      testApplicationErrorRollsBackToo,
      testSuccessReturnsAndKeepsWork,
      testNestedInnerFailure,
      testNestedOuterFailureUndoesReleasedInner,
      testWithoutTransactionRunsDirectly,
    ]) {
      try {
        await test();
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n')[0]}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`savepoint.util.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('savepoint.util.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
