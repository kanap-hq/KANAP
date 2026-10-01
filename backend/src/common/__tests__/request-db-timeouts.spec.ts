import * as assert from 'node:assert/strict';
import { Reflector } from '@nestjs/core';
import {
  BULK_WRITE_TIMEOUTS,
  DEFAULT_REQUEST_DB_TIMEOUTS,
  LongRunningRequest,
  OUTSIDE_WORK_TIMEOUTS,
  requestDbTimeoutDefaults,
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

function context(cls: any, handler: string) {
  return { getHandler: () => cls.prototype[handler], getClass: () => cls } as any;
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
  await testStartTenantTransaction();
  console.log('request-db-timeouts.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
