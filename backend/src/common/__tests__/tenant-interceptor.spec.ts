import * as assert from 'node:assert/strict';
import { EMPTY, NEVER, lastValueFrom, of, throwError } from 'rxjs';
import { TenantInterceptor } from '../tenant.interceptor';

// How TenantInterceptor finishes the request transaction, with mocked runners:
// commit before the value goes out, rollback before the error surfaces, and
// only for the runners it owns.

type Events = string[];

function createRunner(name: string, events: Events, active = true) {
  const runner = {
    isTransactionActive: active,
    isReleased: false,
    connect: async () => { events.push(`${name}:connect`); },
    startTransaction: async () => { runner.isTransactionActive = true; events.push(`${name}:start`); },
    query: async () => [],
    commitTransaction: async () => { runner.isTransactionActive = false; events.push(`${name}:commit`); },
    rollbackTransaction: async () => { runner.isTransactionActive = false; events.push(`${name}:rollback`); },
    release: async () => { runner.isReleased = true; events.push(`${name}:release`); },
  };
  return runner;
}

function createInterceptor(events: Events, createOwn = () => createRunner('own', events, false)) {
  const dataSource = { createQueryRunner: createOwn };
  const reflector = { getAllAndOverride: () => false };
  return new TenantInterceptor(dataSource as any, reflector as any);
}

function context(req: any) {
  return {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => req.res }),
  } as any;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Run the interceptor and record when the caller sees the outcome. */
async function run(events: Events, req: any, handle: () => any, interceptor = createInterceptor(events)) {
  try {
    const value = await lastValueFrom(interceptor.intercept(context(req), { handle }));
    events.push('caller:value');
    return value;
  } catch (err) {
    events.push(`caller:error:${(err as Error).message}`);
    return undefined;
  } finally {
    // Let anything still running after the outcome land in the events.
    await tick();
  }
}

/** Subscribe directly and record every notification the caller gets. */
function observe(events: Events, req: any, handle: () => any) {
  const interceptor = createInterceptor(events);
  return new Promise<void>((resolve) => {
    interceptor.intercept(context(req), { handle }).subscribe({
      next: (value) => events.push(`caller:next:${value}`),
      error: (err) => {
        events.push(`caller:error:${(err as Error).message}`);
        resolve();
      },
      complete: () => {
        events.push('caller:complete');
        resolve();
      },
    });
  });
}

/** Run with console.error captured; returns the first argument of each call. */
async function quietly(action: () => Promise<unknown>) {
  const logged: string[] = [];
  const originalError = console.error;
  console.error = (...args: any[]) => { logged.push(String(args[0])); };
  try {
    await action();
  } finally {
    console.error = originalError;
  }
  return logged;
}

const fail = () => throwError(() => new Error('boom'));

async function testOwnRunnerRollsBackBeforeTheErrorSurfaces() {
  const events: Events = [];
  const req: any = { tenant: { id: 'tenant-1' } };
  await run(events, req, fail);
  assert.deepEqual(events, ['own:connect', 'own:start', 'own:rollback', 'own:release', 'caller:error:boom']);
  assert.equal(req._tenantRunnerReleased, true);
}

async function testOwnRunnerCommitsOnSuccess() {
  const events: Events = [];
  const req: any = { tenant: { id: 'tenant-1' } };
  await run(events, req, () => of('ok'));
  assert.deepEqual(events, ['own:connect', 'own:start', 'own:commit', 'own:release', 'caller:value']);
}

async function testGuardOwnedRunnerRollsBack() {
  const events: Events = [];
  const guardRunner = createRunner('guard', events);
  const req: any = { tenant: { id: 'tenant-1' }, queryRunner: guardRunner, _tenantRunnerOwner: true };
  await run(events, req, fail);
  assert.deepEqual(events, ['guard:rollback', 'guard:release', 'caller:error:boom']);
  assert.equal(req._tenantRunnerReleased, true);
}

async function testGuardOwnedRunnerCommitsOnSuccess() {
  const events: Events = [];
  const guardRunner = createRunner('guard', events);
  const req: any = { tenant: { id: 'tenant-1' }, queryRunner: guardRunner, _tenantRunnerOwner: true };
  await run(events, req, () => of('ok'));
  assert.deepEqual(events, ['guard:commit', 'guard:release', 'caller:value']);
}

async function testSlowCommitStillGoesBeforeTheValue() {
  const events: Events = [];
  const guardRunner = createRunner('guard', events);
  guardRunner.commitTransaction = async () => {
    await tick();
    guardRunner.isTransactionActive = false;
    events.push('guard:commit');
  };
  const req: any = { tenant: { id: 'tenant-1' }, queryRunner: guardRunner, _tenantRunnerOwner: true };
  await observe(events, req, () => of('ok'));
  assert.deepEqual(events, ['guard:commit', 'guard:release', 'caller:next:ok', 'caller:complete']);
}

async function testOnlyTheLastValueGoesOutAfterTheCommit() {
  const events: Events = [];
  const guardRunner = createRunner('guard', events);
  const req: any = { tenant: { id: 'tenant-1' }, queryRunner: guardRunner, _tenantRunnerOwner: true };
  await observe(events, req, () => of('first', 'last'));
  assert.deepEqual(events, ['guard:commit', 'guard:release', 'caller:next:last', 'caller:complete']);
}

async function testEmptyObservableCommits() {
  const events: Events = [];
  const guardRunner = createRunner('guard', events);
  const req: any = { tenant: { id: 'tenant-1' }, queryRunner: guardRunner, _tenantRunnerOwner: true };
  await observe(events, req, () => EMPTY);
  assert.deepEqual(events, ['guard:commit', 'guard:release', 'caller:complete']);
}

async function testCommitErrorSurfacesAfterRollbackAndRelease() {
  const events: Events = [];
  const guardRunner = createRunner('guard', events);
  // Like TypeORM: a failed COMMIT leaves isTransactionActive set.
  guardRunner.commitTransaction = async () => { events.push('guard:commit-failed'); throw new Error('deferred check'); };
  const req: any = { tenant: { id: 'tenant-1' }, queryRunner: guardRunner, _tenantRunnerOwner: true };
  const logged = await quietly(() => run(events, req, () => of('ok')));
  assert.deepEqual(events, ['guard:commit-failed', 'guard:rollback', 'guard:release', 'caller:error:deferred check']);
  assert.equal(req._tenantRunnerReleased, true);
  assert.deepEqual(logged, ['[TenantInterceptor] Guard-owned commit failed:']);
}

async function testCommitErrorAfterTheHandlerAnsweredKeepsItsAnswer() {
  const events: Events = [];
  const guardRunner = createRunner('guard', events);
  guardRunner.commitTransaction = async () => { events.push('guard:commit-failed'); throw new Error('connection lost'); };
  // A @Res() handler that already started its download.
  const req: any = { tenant: { id: 'tenant-1' }, queryRunner: guardRunner, _tenantRunnerOwner: true, res: { headersSent: true } };
  const logged = await quietly(() => run(events, req, () => of(undefined)));
  assert.deepEqual(events, ['guard:commit-failed', 'guard:rollback', 'guard:release', 'caller:value']);
  assert.equal(req._tenantRunnerReleased, true);
  assert.deepEqual(logged, ['[TenantInterceptor] Guard-owned commit failed:']);
}

async function testOwnRunnerCommitErrorSurfacesAfterRollbackAndRelease() {
  const events: Events = [];
  const req: any = { tenant: { id: 'tenant-1' } };
  const interceptor = createInterceptor(events, () => {
    const own = createRunner('own', events, false);
    own.commitTransaction = async () => { events.push('own:commit-failed'); throw new Error('deferred check'); };
    return own;
  });
  await quietly(() => run(events, req, () => of('ok'), interceptor));
  assert.deepEqual(events, ['own:connect', 'own:start', 'own:commit-failed', 'own:rollback', 'own:release', 'caller:error:deferred check']);
  assert.equal(req._tenantRunnerReleased, true);
}

async function testValueIsNotEmittedWhenTheCommitFails() {
  const events: Events = [];
  const guardRunner = createRunner('guard', events);
  guardRunner.commitTransaction = async () => { events.push('guard:commit-failed'); throw new Error('deferred check'); };
  const req: any = { tenant: { id: 'tenant-1' }, queryRunner: guardRunner, _tenantRunnerOwner: true };
  await quietly(() => observe(events, req, () => of('ok')));
  assert.deepEqual(events, ['guard:commit-failed', 'guard:rollback', 'guard:release', 'caller:error:deferred check']);
}

async function testFailedCommitIsFinishedOnceEvenWhenReleaseFails() {
  const events: Events = [];
  const guardRunner = createRunner('guard', events);
  guardRunner.commitTransaction = async () => { events.push('guard:commit-failed'); throw new Error('deferred check'); };
  guardRunner.release = async () => { events.push('guard:release-failed'); throw new Error('pool gone'); };
  const req: any = { tenant: { id: 'tenant-1' }, queryRunner: guardRunner, _tenantRunnerOwner: true };
  await quietly(() => run(events, req, () => of('ok')));
  // The commit error does not go back through the rollback path: one rollback, one release attempt.
  assert.deepEqual(events, ['guard:commit-failed', 'guard:rollback', 'guard:release-failed', 'caller:error:deferred check']);
  assert.equal(req._tenantRunnerReleased, undefined);
}

async function testUnsubscribedBeforeCompletionStillCommits() {
  const events: Events = [];
  const guardRunner = createRunner('guard', events);
  const req: any = { tenant: { id: 'tenant-1' }, queryRunner: guardRunner, _tenantRunnerOwner: true };
  const subscription = createInterceptor(events).intercept(context(req), { handle: () => NEVER }).subscribe({
    next: (value) => events.push(`caller:next:${value}`),
  });
  await tick();
  subscription.unsubscribe();
  await tick();
  assert.deepEqual(events, ['guard:commit', 'guard:release']);
}

async function testUnsubscribedDuringTheCommitFinishesOnce() {
  const events: Events = [];
  const guardRunner = createRunner('guard', events);
  let commitStarted!: () => void;
  const started = new Promise<void>((resolve) => { commitStarted = resolve; });
  guardRunner.commitTransaction = async () => {
    events.push('guard:commit-start');
    commitStarted();
    await tick();
    guardRunner.isTransactionActive = false;
    events.push('guard:commit');
  };
  const req: any = { tenant: { id: 'tenant-1' }, queryRunner: guardRunner, _tenantRunnerOwner: true };
  const subscription = createInterceptor(events).intercept(context(req), { handle: () => of('ok') }).subscribe({
    next: (value) => events.push(`caller:next:${value}`),
  });
  await started;
  subscription.unsubscribe();
  await tick();
  await tick();
  // The safety net sees the commit path already running and leaves it alone.
  assert.deepEqual(events, ['guard:commit-start', 'guard:commit', 'guard:release']);
}

async function testSwappedRunnerRollsBack() {
  const events: Events = [];
  const guardRunner = createRunner('guard', events);
  const swapped = createRunner('swapped', events);
  const req: any = { tenant: { id: 'tenant-1' }, queryRunner: guardRunner, _tenantRunnerOwner: true };
  await run(events, req, () => {
    req.queryRunner = swapped;
    return fail();
  });
  assert.deepEqual(events, ['swapped:rollback', 'swapped:release', 'caller:error:boom']);
}

async function testForeignRunnerIsLeftToItsOwner() {
  const events: Events = [];
  const foreign = createRunner('foreign', events);
  const req: any = { tenant: { id: 'tenant-1' }, queryRunner: foreign };
  await run(events, req, fail);
  assert.deepEqual(events, ['caller:error:boom']);
  assert.equal(foreign.isTransactionActive, true);
  assert.equal(req._tenantRunnerReleased, undefined);
}

async function testRollbackFailureStillReleasesAndSurfacesTheOriginalError() {
  const events: Events = [];
  const guardRunner = createRunner('guard', events);
  guardRunner.rollbackTransaction = async () => { events.push('guard:rollback-failed'); throw new Error('connection lost'); };
  const req: any = { tenant: { id: 'tenant-1' }, queryRunner: guardRunner, _tenantRunnerOwner: true };
  const originalError = console.error;
  console.error = () => undefined;
  try {
    await run(events, req, fail);
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(events, ['guard:rollback-failed', 'guard:release', 'caller:error:boom']);
}

async function testFailedHandlerNeverCommitsEvenWhenCleanupFails() {
  const events: Events = [];
  const guardRunner = createRunner('guard', events);
  guardRunner.rollbackTransaction = async () => { events.push('guard:rollback-failed'); throw new Error('connection lost'); };
  guardRunner.release = async () => { events.push('guard:release-failed'); throw new Error('pool gone'); };
  const req: any = { tenant: { id: 'tenant-1' }, queryRunner: guardRunner, _tenantRunnerOwner: true };
  const originalError = console.error;
  console.error = () => undefined;
  try {
    await run(events, req, fail);
  } finally {
    console.error = originalError;
  }
  // The transaction is still open and the runner not released: finalize must not commit it.
  assert.equal(guardRunner.isTransactionActive, true);
  assert.deepEqual(events, ['guard:rollback-failed', 'guard:release-failed', 'caller:error:boom']);
}

async function main() {
  await testOwnRunnerRollsBackBeforeTheErrorSurfaces();
  await testOwnRunnerCommitsOnSuccess();
  await testGuardOwnedRunnerRollsBack();
  await testGuardOwnedRunnerCommitsOnSuccess();
  await testSlowCommitStillGoesBeforeTheValue();
  await testOnlyTheLastValueGoesOutAfterTheCommit();
  await testEmptyObservableCommits();
  await testCommitErrorSurfacesAfterRollbackAndRelease();
  await testOwnRunnerCommitErrorSurfacesAfterRollbackAndRelease();
  await testCommitErrorAfterTheHandlerAnsweredKeepsItsAnswer();
  await testValueIsNotEmittedWhenTheCommitFails();
  await testFailedCommitIsFinishedOnceEvenWhenReleaseFails();
  await testUnsubscribedBeforeCompletionStillCommits();
  await testUnsubscribedDuringTheCommitFinishesOnce();
  await testSwappedRunnerRollsBack();
  await testForeignRunnerIsLeftToItsOwner();
  await testRollbackFailureStillReleasesAndSurfacesTheOriginalError();
  await testFailedHandlerNeverCommitsEvenWhenCleanupFails();
  console.log('tenant-interceptor.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
