import * as assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import { DatabaseConnectionError } from '../filters/database-error.mapping';
import {
  BULK_WRITE_TIMEOUTS,
  connectRequestRunner,
  DEFAULT_REQUEST_DB_TIMEOUTS,
  isMultipartRequest,
  LongRunningRequest,
  OUTSIDE_WORK_TIMEOUTS,
  rememberRequestDbTimeouts,
  requestDbTimeoutDefaults,
  requestDbTimeoutsOf,
  resolveRequestDbTimeouts,
  startTenantTransaction,
  TENANT_PURGE_TIMEOUTS,
} from '../request-db-timeouts';

// Bounded waits of the request transaction (plan planning/perf-scale, lot 1D):
// defaults, environment overrides, @LongRunningRequest raising them, and the
// one statement that opens the transaction. Against PostgreSQL:
// request-transaction-bounds-http.integration.spec.ts and the race spec
// request-lock-timeout-race.integration.spec.ts.

class Probe {
  plain() {
    return undefined;
  }

  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  bulk() {
    return undefined;
  }

  @LongRunningRequest({ lockTimeoutMs: 1_000, statementTimeoutMs: 0 })
  lowerAndUnlimited() {
    return undefined;
  }
}

@LongRunningRequest(OUTSIDE_WORK_TIMEOUTS)
class OutsideProbe {
  handler() {
    return undefined;
  }

  @LongRunningRequest(TENANT_PURGE_TIMEOUTS)
  purge() {
    return undefined;
  }
}

function context(cls: any, handler: string, contentType?: string) {
  const req = { headers: contentType ? { 'content-type': contentType } : {} };
  return { getHandler: () => cls.prototype[handler], getClass: () => cls, switchToHttp: () => ({ getRequest: () => req }) } as any;
}

function testDefaults() {
  assert.deepEqual(requestDbTimeoutDefaults({}), { lockTimeoutMs: 5_000, statementTimeoutMs: 30_000, idleInTransactionTimeoutMs: 60_000 });
  assert.deepEqual(DEFAULT_REQUEST_DB_TIMEOUTS, { lockTimeoutMs: 5_000, statementTimeoutMs: 30_000, idleInTransactionTimeoutMs: 60_000 });
  assert.deepEqual(
    requestDbTimeoutDefaults({ DB_LOCK_TIMEOUT_MS: '2000', DB_STATEMENT_TIMEOUT_MS: '0', DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '90000' }),
    { lockTimeoutMs: 2_000, statementTimeoutMs: 0, idleInTransactionTimeoutMs: 90_000 },
    'the environment overrides each default; 0 is no limit',
  );
  assert.deepEqual(
    requestDbTimeoutDefaults({ DB_LOCK_TIMEOUT_MS: 'abc', DB_STATEMENT_TIMEOUT_MS: '-5', DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '1.5' }),
    DEFAULT_REQUEST_DB_TIMEOUTS,
    'an invalid value keeps the built-in default',
  );
}

function testDecorator() {
  const reflector = new Reflector();
  const defaults = requestDbTimeoutDefaults({});
  assert.deepEqual(resolveRequestDbTimeouts(reflector, context(Probe, 'plain'), defaults), defaults, 'no decorator: the defaults');
  assert.deepEqual(
    resolveRequestDbTimeouts(reflector, context(Probe, 'bulk'), defaults),
    { lockTimeoutMs: 30_000, statementTimeoutMs: 120_000, idleInTransactionTimeoutMs: 300_000 },
    'bulk writes raise all three',
  );
  assert.deepEqual(
    resolveRequestDbTimeouts(reflector, context(Probe, 'lowerAndUnlimited'), defaults),
    { lockTimeoutMs: 5_000, statementTimeoutMs: 0, idleInTransactionTimeoutMs: 60_000 },
    'a decorator never lowers a default; 0 (no limit) is the longest',
  );
  assert.deepEqual(
    resolveRequestDbTimeouts(reflector, context(OutsideProbe, 'handler'), defaults),
    { lockTimeoutMs: 5_000, statementTimeoutMs: 30_000, idleInTransactionTimeoutMs: 600_000 },
    'a controller-level decorator applies to its routes',
  );
  assert.deepEqual(
    resolveRequestDbTimeouts(reflector, context(OutsideProbe, 'purge'), defaults),
    { lockTimeoutMs: 5_000, statementTimeoutMs: 30_000, idleInTransactionTimeoutMs: 1_800_000 },
    'the handler wins over its controller',
  );
  const raisedEnv = requestDbTimeoutDefaults({ DB_LOCK_TIMEOUT_MS: '45000' });
  assert.equal(resolveRequestDbTimeouts(reflector, context(Probe, 'bulk'), raisedEnv).lockTimeoutMs, 45_000, 'an environment default above the decorator is kept');
}

/** A file upload's body is read inside the transaction: it gets the idle limit of outside work. */
function testUploads() {
  const reflector = new Reflector();
  const defaults = requestDbTimeoutDefaults({});
  const multipart = 'multipart/form-data; boundary=----x';
  assert.ok(isMultipartRequest({ headers: { 'content-type': multipart } }));
  assert.ok(isMultipartRequest({ headers: { 'content-type': 'Multipart/Form-Data;boundary=x' } }));
  assert.equal(isMultipartRequest({ headers: { 'content-type': 'application/json' } }), false);
  assert.equal(isMultipartRequest({ headers: {} }), false);
  assert.deepEqual(
    resolveRequestDbTimeouts(reflector, context(Probe, 'plain', multipart), defaults),
    { lockTimeoutMs: 5_000, statementTimeoutMs: 30_000, idleInTransactionTimeoutMs: 600_000 },
    'an upload raises the idle limit only',
  );
  assert.deepEqual(
    resolveRequestDbTimeouts(reflector, context(Probe, 'bulk', multipart), defaults),
    { lockTimeoutMs: 30_000, statementTimeoutMs: 120_000, idleInTransactionTimeoutMs: 600_000 },
    'an import upload keeps its raised waits, with the longer idle limit',
  );
  assert.deepEqual(resolveRequestDbTimeouts(reflector, context(Probe, 'plain', 'application/json'), defaults), defaults, 'a JSON body: the defaults');
  assert.equal(
    resolveRequestDbTimeouts(reflector, context(Probe, 'plain', multipart), requestDbTimeoutDefaults({ DB_IDLE_IN_TRANSACTION_TIMEOUT_MS: '0' })).idleInTransactionTimeoutMs,
    0,
    'no limit stays no limit',
  );
}

/** The request keeps its waits for a runner opened later (an import that gives its connection back). */
function testRememberedTimeouts() {
  const req: any = {};
  assert.deepEqual(requestDbTimeoutsOf(req), requestDbTimeoutDefaults(), 'nothing remembered: the defaults');
  rememberRequestDbTimeouts(req, { lockTimeoutMs: 30_000, statementTimeoutMs: 120_000, idleInTransactionTimeoutMs: 300_000 });
  assert.deepEqual(requestDbTimeoutsOf(req), { lockTimeoutMs: 30_000, statementTimeoutMs: 120_000, idleInTransactionTimeoutMs: 300_000 });
}

/** No free connection: a DatabaseConnectionError (503 busy), the runner given back. */
async function testConnectFailure() {
  let released = 0;
  const failing = { connect: async () => { throw new Error('timeout exceeded when trying to connect'); }, release: async () => { released += 1; } };
  await assert.rejects(
    connectRequestRunner(failing as any),
    (error: unknown) => error instanceof DatabaseConnectionError && error.reason === 'no connection'
      && (error as any).cause?.message === 'timeout exceeded when trying to connect',
  );
  assert.equal(released, 1);
  let connected = 0;
  await connectRequestRunner({ connect: async () => { connected += 1; }, release: async () => undefined } as any);
  assert.equal(connected, 1);
}

async function testStartTenantTransaction() {
  const calls: Array<[string, unknown[] | undefined]> = [];
  const runner = {
    startTransaction: async () => { calls.push(['BEGIN', undefined]); },
    query: async (sql: string, params?: unknown[]) => { calls.push([sql.replace(/\s+/g, ' ').trim(), params]); return []; },
  };
  await startTenantTransaction(runner as any, 'tenant-1', { lockTimeoutMs: 5_000, statementTimeoutMs: 30_000, idleInTransactionTimeoutMs: 60_000 });
  assert.equal(calls.length, 2, 'BEGIN, then one round trip');
  assert.equal(calls[0][0], 'BEGIN');
  assert.match(calls[1][0], /set_config\('app\.current_tenant', \$1, true\)/);
  for (const name of ['lock_timeout', 'statement_timeout', 'idle_in_transaction_session_timeout']) {
    assert.match(calls[1][0], new RegExp(`set_config\\('${name}', \\$\\d, true\\)`), `${name} is transaction-local`);
  }
  assert.deepEqual(calls[1][1], ['tenant-1', '5000', '30000', '60000']);
}

async function main() {
  testDefaults();
  testDecorator();
  testUploads();
  testRememberedTimeouts();
  await testConnectFailure();
  await testStartTenantTransaction();
  console.log('request-db-timeouts.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
