import * as assert from 'node:assert/strict';
import { EntityManager, QueryRunner } from 'typeorm';
import { applyDataAccess, transactionDataAccessMode } from '../data-access';

/**
 * Data-scoped access (planning/data-scoped-access/spec.md §6.3): the mode `applyDataAccess`
 * remembers on a query runner lives as long as the transaction that applied it. A runner reused for
 * a later transaction must not answer a stale `limited` (the write checks would refuse unscoped
 * work), nor a stale `all`. No database: a runner that records its statements.
 */

type FakeRunner = QueryRunner & { statements: string[]; begin: () => void };

function fakeRunner(applied: 'all' | 'limited'): FakeRunner {
  // As TypeORM's runner: a transaction started inside one is a savepoint (depth > 1).
  let depth = 0;
  const end = async () => {
    depth -= 1;
    runner.isTransactionActive = depth > 0;
  };
  const runner: any = {
    isTransactionActive: false,
    statements: [] as string[],
    begin() {
      depth += 1;
      runner.isTransactionActive = true;
    },
    async query(sql: string) {
      runner.statements.push(sql);
      if (sql.includes('data_access_apply')) return [{ mode: applied }];
      // The setting of a transaction where the access was not applied.
      if (sql.includes("current_setting('app.da_mode'")) return [{ limited: false }];
      throw new Error(`unexpected statement: ${sql}`);
    },
    commitTransaction: end,
    rollbackTransaction: end,
  };
  runner.manager = { queryRunner: runner, query: (sql: string) => runner.query(sql) } as unknown as EntityManager;
  return runner as FakeRunner;
}

async function modeAndQueries(runner: FakeRunner): Promise<[string, number]> {
  const before = runner.statements.length;
  const mode = await transactionDataAccessMode(runner.manager);
  return [mode, runner.statements.length - before];
}

async function run() {
  for (const end of ['commitTransaction', 'rollbackTransaction'] as const) {
    const runner = fakeRunner('limited');
    runner.begin();
    assert.equal(await applyDataAccess(runner, 'person'), 'limited');
    assert.deepEqual(await modeAndQueries(runner), ['limited', 0], 'in the transaction: the remembered mode, no query');
    await runner[end]();
    // The runner reused for a later transaction where the access was not applied.
    runner.begin();
    assert.deepEqual(await modeAndQueries(runner), ['all', 1], `after ${end}: the setting is read, no stale limited`);
    // Applied again in that transaction: remembered again, and forgotten again at its end.
    await applyDataAccess(runner, 'person');
    assert.deepEqual(await modeAndQueries(runner), ['limited', 0]);
    await runner[end]();
    runner.begin();
    assert.deepEqual(await modeAndQueries(runner), ['all', 1]);
  }
  console.log('  a limited mode is forgotten at commit and at rollback; the next transaction reads its own: OK');

  // An unscoped person costs no query while the transaction lasts, and leaves nothing after it.
  const unscoped = fakeRunner('all');
  unscoped.begin();
  assert.equal(await applyDataAccess(unscoped, 'person'), 'all');
  assert.deepEqual(await modeAndQueries(unscoped), ['all', 0]);
  await unscoped.commitTransaction();
  unscoped.begin();
  assert.deepEqual(await modeAndQueries(unscoped), ['all', 1]);
  console.log('  mode all: no query in its transaction, nothing remembered after it: OK');

  // A savepoint released or rolled back leaves the transaction active: the mode stays.
  const nested = fakeRunner('limited');
  nested.begin();
  await applyDataAccess(nested, 'person');
  for (const end of ['commitTransaction', 'rollbackTransaction'] as const) {
    nested.begin();
    await nested[end]();
    assert.equal(nested.isTransactionActive, true);
    assert.deepEqual(await modeAndQueries(nested), ['limited', 0], `a savepoint ${end}: the mode stays`);
  }
  await nested.commitTransaction();
  nested.begin();
  assert.deepEqual(await modeAndQueries(nested), ['all', 1], 'the outer commit forgets it');
  console.log('  a savepoint released or rolled back keeps the remembered mode, the outer end forgets it: OK');
  console.log('data access mode lifetime: all scenarios passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
