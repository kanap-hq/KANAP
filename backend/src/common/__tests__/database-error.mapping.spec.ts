import * as assert from 'node:assert/strict';
import { BadRequestException, HttpException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';
import { BUSY_RETRY_AFTER_SECONDS, mapDatabaseError, sqlStateOf } from '../filters/database-error.mapping';

// The database errors a race can cause and their HTTP answer (plan
// planning/perf-scale, lot 1D), on the errors as TypeORM and node-postgres
// raise them. The HTTP level (filter, Retry-After, real PostgreSQL errors) is
// covered by request-transaction-bounds-http.integration.spec.ts.

function queryFailed(query: string, code: string, extra: Record<string, unknown> = {}) {
  const driverError = Object.assign(new Error(`pg error ${code}`), { code, ...extra });
  return new QueryFailedError(query, [], driverError);
}

function body(exception: HttpException) {
  return exception.getResponse() as { statusCode: number; code: string; message: string };
}

function testCodes() {
  const cases: Array<[unknown, number, string]> = [
    [queryFailed('INSERT INTO spend_versions (x) VALUES ($1)', '23505', { constraint: 'uniq_spend_item_budget_year' }), 409, 'duplicate'],
    [queryFailed('INSERT INTO spend_amounts (version_id) VALUES ($1)', '23503'), 409, 'parent_gone'],
    [queryFailed('UPDATE spend_items SET supplier_id = $1', '23503'), 409, 'parent_gone'],
    [queryFailed('  delete from companies where id = $1', '23503'), 409, 'in_use'],
    [queryFailed('UPDATE spend_amounts SET planned = 1', '40P01'), 409, 'retry'],
    [queryFailed('UPDATE spend_amounts SET planned = 1', '40001'), 409, 'retry'],
    [queryFailed('SELECT 1 FROM spend_amounts FOR UPDATE', '55P03'), 503, 'busy'],
    [queryFailed('SELECT pg_sleep(60)', '57014'), 503, 'busy'],
    [queryFailed('SELECT 1', '25P03'), 503, 'busy'],
    // A bare driver error (raw node-postgres, outside a TypeORM query) maps the same way.
    [Object.assign(new Error('duplicate key'), { code: '23505' }), 409, 'duplicate'],
  ];
  for (const [error, status, code] of cases) {
    const mapped = mapDatabaseError(error);
    assert.ok(mapped, `${code}: mapped`);
    assert.equal(mapped!.exception.getStatus(), status, `${code}: status`);
    assert.equal(body(mapped!.exception).code, code, `${code}: body code`);
    assert.equal(body(mapped!.exception).statusCode, status, `${code}: body statusCode`);
    assert.ok(body(mapped!.exception).message.length > 10, `${code}: a plain-language message`);
    assert.equal(mapped!.retryAfterSeconds, code === 'busy' ? BUSY_RETRY_AFTER_SECONDS : undefined, `${code}: Retry-After only when busy`);
  }
  assert.equal(mapDatabaseError(cases[0][0])!.constraint, 'uniq_spend_item_budget_year', 'the constraint is kept for the log');
}

function testOtherErrorsAreLeftAlone() {
  assert.equal(mapDatabaseError(queryFailed('SELECT 1/0', '22012')), null, 'division by zero stays a 500');
  assert.equal(mapDatabaseError(queryFailed('SELECT x', '42703')), null, 'undefined column stays a 500');
  assert.equal(mapDatabaseError(new Error('boom')), null, 'a plain error');
  assert.equal(mapDatabaseError(new BadRequestException('nope')), null, 'an HTTP exception keeps its own answer');
  // An HttpException carrying a code property must not be re-mapped.
  assert.equal(mapDatabaseError(Object.assign(new BadRequestException('x'), { code: '23505' })), null);
  assert.equal(mapDatabaseError(null), null);
  assert.equal(mapDatabaseError(Object.assign(new Error('system'), { code: 'ECONNRESET' })), null, 'a socket error code is no SQLSTATE');
}

function testSqlState() {
  assert.equal(sqlStateOf(queryFailed('x', '55P03')), '55P03');
  assert.equal(sqlStateOf({ code: '23505' }), '23505');
  assert.equal(sqlStateOf({ code: 'ETIMEDOUT' }), undefined);
  assert.equal(sqlStateOf(undefined), undefined);
}

function main() {
  testCodes();
  testOtherErrorsAreLeftAlone();
  testSqlState();
  console.log('database-error.mapping.spec: ok');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
