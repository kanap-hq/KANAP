import * as assert from 'node:assert/strict';
import { BadRequestException, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { QueryFailedError } from 'typeorm';
import { ReleaseTenantRunnerFilter } from '../filters/release-tenant-runner.filter';
import { ClientAbortedError } from '../request-finalizer.middleware';

// ReleaseTenantRunnerFilter with mocked runners (plan planning/perf-scale, lot
// 1D): it still rolls back and releases a runner left open; a database error
// a race can cause goes on as a 409 / 503 HttpException (Retry-After on 503);
// after a client abort it answers and logs nothing. Over HTTP against
// PostgreSQL: request-transaction-bounds-http.integration.spec.ts.

type Sent = { exception: unknown };

function host(req: any, res: any) {
  return { switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }) } as any;
}

function runner(events: string[]) {
  return {
    isTransactionActive: true,
    isReleased: false,
    rollbackTransaction: async function () { this.isTransactionActive = false; events.push('rollback'); },
    release: async function () { this.isReleased = true; events.push('release'); },
  };
}

function response() {
  const headers: Record<string, string> = {};
  return { headersSent: false, headers, setHeader: (name: string, value: string) => { headers[name] = value; } };
}

async function withSentCapture(fn: (sent: Sent[]) => Promise<void>) {
  const sent: Sent[] = [];
  const original = BaseExceptionFilter.prototype.catch;
  const originalWarn = console.warn;
  BaseExceptionFilter.prototype.catch = function (exception: unknown) { sent.push({ exception }); } as any;
  console.warn = () => undefined;
  try {
    await fn(sent);
  } finally {
    BaseExceptionFilter.prototype.catch = original;
    console.warn = originalWarn;
  }
}

async function testRollsBackThenMaps() {
  await withSentCapture(async (sent) => {
    const events: string[] = [];
    const req: any = { method: 'POST', url: '/x', queryRunner: runner(events) };
    const res = response();
    const error = new QueryFailedError('SELECT 1 FOR UPDATE', [], Object.assign(new Error('lock timeout'), { code: '55P03' }));
    await new ReleaseTenantRunnerFilter().catch(error, host(req, res));
    assert.deepEqual(events, ['rollback', 'release'], 'the runner is rolled back and released first');
    assert.equal(req._tenantRunnerReleased, true);
    assert.equal(sent.length, 1);
    const answered = sent[0].exception as HttpException;
    assert.ok(answered instanceof HttpException);
    assert.equal(answered.getStatus(), 503);
    assert.equal((answered.getResponse() as any).code, 'busy');
    assert.equal(res.headers['Retry-After'], '2');
  });
}

async function testOtherErrorsUnchanged() {
  await withSentCapture(async (sent) => {
    const req: any = { method: 'GET', url: '/x' };
    const plain = new Error('boom');
    const http = new BadRequestException('nope');
    await new ReleaseTenantRunnerFilter().catch(plain, host(req, response()));
    await new ReleaseTenantRunnerFilter().catch(http, host(req, response()));
    assert.equal(sent[0].exception, plain, 'an unknown error goes on as it is (a 500)');
    assert.equal(sent[1].exception, http, 'an HTTP exception keeps its own answer');
  });
}

async function testClientAbortIsQuiet() {
  await withSentCapture(async (sent) => {
    const events: string[] = [];
    // The finalizer already rolled back and released.
    const req: any = { method: 'POST', url: '/x', _clientAborted: true, _tenantRunnerReleased: true, queryRunner: runner(events) };
    await new ReleaseTenantRunnerFilter().catch(new ClientAbortedError(), host(req, response()));
    await new ReleaseTenantRunnerFilter().catch(
      new QueryFailedError('INSERT', [], Object.assign(new Error('rls'), { code: '42501' })),
      host(req, response()),
    );
    assert.deepEqual(sent, [], 'nothing answered, nothing logged by the base filter');
    assert.deepEqual(events, [], 'the runner is not touched again');
  });
}

async function main() {
  await testRollsBackThenMaps();
  await testOtherErrorsUnchanged();
  await testClientAbortIsQuiet();
  console.log('release-tenant-runner.filter.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
