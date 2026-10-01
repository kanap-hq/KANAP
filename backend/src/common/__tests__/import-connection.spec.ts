import * as assert from 'node:assert/strict';
import { DatabaseConnectionError } from '../filters/database-error.mapping';
import { createRequestCommitThenRun, createRequestReleaseConnection } from '../import-connection';
import { BULK_WRITE_TIMEOUTS, rememberRequestDbTimeouts, requestDbTimeoutDefaults } from '../request-db-timeouts';

// createRequestReleaseConnection (an import): the
// request's transaction is committed and its connection given back while the
// outside work runs, then a new transaction is opened for the rest of the
// request, with the same tenant and the same bounded waits as the route's
// first one (an import keeps its raised BULK_WRITE_TIMEOUTS, not the defaults).
// A request whose connection ended while it held its transaction has nothing
// committed: giving the connection back fails with a DatabaseConnectionError
// (503 busy), the outside work does not run. createRequestCommitThenRun (the
// user invitation) commits and gives the connection back, runs the outside
// work, and opens no new transaction.

function fakeRunner(log: string[], name: string) {
  return {
    isReleased: false,
    isTransactionActive: false,
    manager: { name },
    connect: async () => { log.push(`${name} connect`); },
    startTransaction: async function () { this.isTransactionActive = true; log.push(`${name} BEGIN`); },
    commitTransaction: async function () { this.isTransactionActive = false; log.push(`${name} COMMIT`); },
    rollbackTransaction: async function () { this.isTransactionActive = false; log.push(`${name} ROLLBACK`); },
    release: async function () { this.isReleased = true; log.push(`${name} release`); },
    query: async (_sql: string, params?: unknown[]) => { log.push(`${name} set_config ${JSON.stringify(params)}`); return []; },
  };
}

async function testReacquiredRunnerKeepsTheRouteWaits() {
  const log: string[] = [];
  const first = fakeRunner(log, 'first');
  first.isTransactionActive = true;
  const second = fakeRunner(log, 'second');
  const dataSource: any = { createQueryRunner: () => second };
  const req: any = { queryRunner: first, tenant: { id: 'tenant-1' } };
  const timeouts = { ...requestDbTimeoutDefaults({}), ...BULK_WRITE_TIMEOUTS } as any;
  rememberRequestDbTimeouts(req, timeouts);

  const release = createRequestReleaseConnection(req, dataSource, 'tenant-1');
  const { result, manager } = await release(async () => { log.push('outside work'); return 42; });
  assert.equal(result, 42);
  assert.equal(manager, second.manager);
  assert.deepEqual(log, [
    'first COMMIT',
    'first release',
    'outside work',
    'second connect',
    'second BEGIN',
    `second set_config ${JSON.stringify(['tenant-1', '30000', '120000', '300000'])}`,
  ], 'committed and released before the outside work, reopened after it with the raised waits');
  assert.equal(req.queryRunner, second);
  assert.equal(req._tenantRunnerReleased, false);
}

async function testWithoutRememberedWaitsTheDefaults() {
  const log: string[] = [];
  const second = fakeRunner(log, 'second');
  const req: any = { queryRunner: null };
  await createRequestReleaseConnection(req, { createQueryRunner: () => second } as any, 'tenant-1')(async () => undefined);
  const d = requestDbTimeoutDefaults();
  assert.ok(log.includes(`second set_config ${JSON.stringify(['tenant-1', String(d.lockTimeoutMs), String(d.statementTimeoutMs), String(d.idleInTransactionTimeoutMs)])}`));
}

async function testLostConnectionIsNoSuccess() {
  for (const make of [
    (req: any, ds: any) => createRequestReleaseConnection(req, ds, 'tenant-1'),
    (req: any) => createRequestCommitThenRun(req),
  ]) {
    const log: string[] = [];
    // TypeORM released the runner when its connection ended; the transaction flag stays set.
    const lost = { ...fakeRunner(log, 'lost'), isReleased: true, isTransactionActive: true };
    const req: any = { queryRunner: lost };
    let ran = false;
    await assert.rejects(
      make(req, { createQueryRunner: () => fakeRunner(log, 'second') })(async () => { ran = true; return undefined; }),
      (error: unknown) => error instanceof DatabaseConnectionError && error.reason === 'connection lost',
    );
    assert.equal(ran, false, 'the outside work does not run');
    assert.deepEqual(log, [], 'no COMMIT, ROLLBACK or new connection on a lost runner');
    assert.equal(req.queryRunner, null);
    assert.equal(req._tenantRunnerReleased, true);
  }
}

async function testCommitThenRunOpensNothingAfter() {
  const log: string[] = [];
  const first = fakeRunner(log, 'first');
  first.isTransactionActive = true;
  const req: any = { queryRunner: first };
  await createRequestCommitThenRun(req)(async () => { log.push('outside work'); });
  assert.deepEqual(log, ['first COMMIT', 'first release', 'outside work']);
  assert.equal(req.queryRunner, null, 'no new runner: the request queries nothing after');
  assert.equal(req._tenantRunnerReleased, true);
}

async function main() {
  await testReacquiredRunnerKeepsTheRouteWaits();
  await testWithoutRememberedWaitsTheDefaults();
  await testLostConnectionIsNoSuccess();
  await testCommitThenRunOpensNothingAfter();
  console.log('import-connection.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
