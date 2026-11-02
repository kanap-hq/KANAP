import * as assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { MemoryHitCounter } from '../../common/rate-limit-store';
import { RATE_LIMITS } from '../../common/rate-limit';
import { AuthController } from '../auth.controller';
import { AuthRefusedException } from '../auth-refused.exception';
import { LoginAttemptLimit, loginAttemptKey, normalizeLoginIdentifier } from '../login-attempt-limit';

// Password sign-in attempts per account and client address (login-attempt-limit.ts), through
// AuthController.login:
// - five refused attempts for one account from one client address within 15 minutes, then the
//   next is refused with 429, even with the right password, before the password check, for 15
//   minutes from the fifth refusal;
// - the fifth refusal writes one too_many_attempts event; the attempts refused during the block
//   write none;
// - the same account from another client address, and another account from the same client
//   address, sign in;
// - a successful sign-in clears the count of its pair;
// - a completed password reset clears the counts of its account from every client address, and
//   only those: the new password works at once;
// - an error other than a refusal does not count, and the earlier refusals stay counted;
// - an identifier no account has gets the same answers, events and refusal as a known one;
// - the identifier typed counts in lower case and without spaces, per tenant;
// - attempts sent at the same moment do not pass the limit together;
// - RATE_LIMIT_ENABLED=false turns the count off.

const PASSWORD = 'Right-pass-2026';
const ACCOUNTS: Record<string, string> = { 'ada@example.com': 'user-ada', 'bob@example.com': 'user-bob' };
const INVALID_CREDENTIALS = { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' };
/** The password the service answers with an error other than a refusal. */
const SERVER_ERROR = 'Server-error-0';

function tenantDataSource() {
  const runner: any = {
    manager: { id: 'tenant-manager' },
    isTransactionActive: false,
    connect: async () => undefined,
    startTransaction: async () => { runner.isTransactionActive = true; },
    query: async () => undefined,
    commitTransaction: async () => { runner.isTransactionActive = false; },
    rollbackTransaction: async () => { runner.isTransactionActive = false; },
    release: async () => undefined,
  };
  return { createQueryRunner: () => runner } as any;
}

function setup(now: () => number = Date.now) {
  const checks: string[] = [];
  const events: any[] = [];
  /** Passwords set by a reset, per account. */
  const passwords: Record<string, string> = {};
  const auth = {
    // The service's answers: the same 401 for a wrong password and an unknown address.
    validateUser: async (email: string, password: string) => {
      checks.push(email);
      await new Promise((resolve) => setTimeout(resolve, 5));
      if (password === SERVER_ERROR) throw new Error('database unavailable');
      const id = ACCOUNTS[email.trim().toLowerCase()];
      if (!id) throw new AuthRefusedException(INVALID_CREDENTIALS, 'unknown_user');
      if (password !== (passwords[id] ?? PASSWORD)) throw new AuthRefusedException(INVALID_CREDENTIALS, 'bad_password', id);
      return { id, email, role: 'member', tenant_id: 'tenant-1' };
    },
    // The reset link names the account: the token here is its e-mail.
    resetPasswordWithToken: async (token: string, nextPassword: string) => {
      passwords[ACCOUNTS[token]] = nextPassword;
      return { id: ACCOUNTS[token], email: token };
    },
    signTokens: async () => ({ access_token: 'access-token', refresh_token: 'refresh-token', expires_in: 900, refresh_expires_in: 14_400 }),
  };
  const controller = new AuthController(
    auth as any,
    { touchLastLogin: async () => undefined } as any,
    {} as any,
    {} as any,
    {} as any,
    { maybeRefreshOnLogin: async () => undefined } as any,
    tenantDataSource(),
    {} as any,
    { recordAuthEvent: async (_tenantId: unknown, event: any) => { events.push(event); } } as any,
    new LoginAttemptLimit(new MemoryHitCounter(now)),
  );
  return { controller, checks, events };
}

type Answer = { status: number; body: unknown; retryAfter: string | null };

async function signIn(
  controller: AuthController,
  email: string,
  password: string,
  address: string,
  tenantId = 'tenant-1',
): Promise<Answer> {
  const headers: Record<string, string> = {};
  const res = {
    cookie: () => undefined,
    setHeader: (name: string, value: string) => { headers[name.toLowerCase()] = value; },
  } as any;
  const req = { tenant: { id: tenantId }, ip: address, headers: { 'user-agent': 'Spec' } };
  try {
    const body = await controller.login({ email, password }, req, res);
    return { status: 201, body, retryAfter: headers['retry-after'] ?? null };
  } catch (error) {
    if (!(error instanceof HttpException)) return { status: 500, body: null, retryAfter: headers['retry-after'] ?? null };
    return { status: error.getStatus(), body: error.getResponse(), retryAfter: headers['retry-after'] ?? null };
  }
}

async function refuseFiveTimes(controller: AuthController, email: string, address: string) {
  for (let i = 1; i <= RATE_LIMITS.authLoginFailures.limit; i += 1) {
    const answer = await signIn(controller, email, 'Wrong-pass-0', address);
    assert.equal(answer.status, 401, `refused attempt ${i}`);
    assert.deepEqual(answer.body, INVALID_CREDENTIALS);
  }
}

const TOO_MANY = { action: 'login_failed', reason: 'too_many_attempts' };

async function testFiveRefusalsBlockThePair() {
  assert.deepEqual(RATE_LIMITS.authLoginFailures, { limit: 5, ttl: 15 * 60_000 }, 'five attempts in 15 minutes');
  const { controller, checks, events } = setup();
  for (let i = 1; i <= 4; i += 1) await signIn(controller, 'ada@example.com', 'Wrong-pass-0', '198.51.100.1');
  assert.equal(events.filter((e) => e.reason === 'too_many_attempts').length, 0, 'no block event before the fifth refusal');
  assert.equal((await signIn(controller, 'ada@example.com', 'Wrong-pass-0', '198.51.100.1')).status, 401, 'fifth refusal');
  assert.deepEqual(events.slice(-2), [
    { action: 'login_failed', reason: 'bad_password', userId: 'user-ada' },
    TOO_MANY,
  ], 'the fifth refusal, then the start of the block');
  const recorded = events.length;
  const checked = checks.length;
  const blocked = await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.1');
  assert.equal(blocked.status, 429, 'the 6th attempt is refused, even with the right password');
  assert.equal(blocked.body, 'ThrottlerException: Too Many Requests', 'the answer of the address limit');
  assert.ok(Number(blocked.retryAfter) > 890 && Number(blocked.retryAfter) <= 900, `Retry-After ${blocked.retryAfter}`);
  assert.equal(checks.length, checked, 'refused before the password check');
  assert.equal((await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.1')).status, 429, 'still refused');
  assert.equal(events.length, recorded, 'the attempts refused during the block are not recorded');

  // The same account from another client address, another account from the same client address.
  assert.equal((await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.2')).status, 201, 'another client address signs in');
  assert.equal((await signIn(controller, 'bob@example.com', PASSWORD, '198.51.100.1')).status, 201, 'another account signs in');
}

async function testSuccessClearsTheCount() {
  const { controller } = setup();
  for (let i = 0; i < 4; i += 1) assert.equal((await signIn(controller, 'ada@example.com', 'Wrong-pass-0', '198.51.100.3')).status, 401);
  assert.equal((await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.3')).status, 201);
  await refuseFiveTimes(controller, 'ada@example.com', '198.51.100.3');
  assert.equal((await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.3')).status, 429, 'five new refusals after the success');
}

async function testPasswordResetClearsTheAccount() {
  const { controller, events } = setup();
  await refuseFiveTimes(controller, 'Ada@example.com', '198.51.100.11');
  await refuseFiveTimes(controller, 'ada@example.com', '198.51.100.12');
  await refuseFiveTimes(controller, 'bob@example.com', '198.51.100.11');
  assert.equal((await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.11')).status, 429, 'blocked before the reset');

  const req = { tenant: { id: 'tenant-1' }, ip: '203.0.113.1', headers: { 'user-agent': 'Spec' } };
  assert.deepEqual(await controller.completePasswordReset({ token: 'ada@example.com', password: 'New-pass-2026' } as any, req), { ok: true });
  assert.deepEqual(events.at(-1), { action: 'password_reset_completed', userId: 'user-ada' });

  assert.equal((await signIn(controller, 'ada@example.com', 'New-pass-2026', '198.51.100.11')).status, 201, 'the new password works at once');
  assert.equal((await signIn(controller, 'ada@example.com', 'New-pass-2026', '198.51.100.12')).status, 201, 'from every client address');
  assert.equal((await signIn(controller, 'bob@example.com', PASSWORD, '198.51.100.11')).status, 429, 'another account stays blocked');
  await refuseFiveTimes(controller, 'ada@example.com', '198.51.100.11');
  assert.equal((await signIn(controller, 'ada@example.com', 'New-pass-2026', '198.51.100.11')).status, 429, 'five new refusals block again');
}

/** `clearPrefix` forgets the keys that start with the prefix, and only those. */
async function testClearPrefix() {
  const counter = new MemoryHitCounter();
  const rule = { limit: 5, ttl: 15 * 60_000, blockDuration: 15 * 60_000 };
  for (const key of ['a.1', 'a.2', 'ab.1']) for (let i = 0; i < 3; i += 1) await counter.hit(key, rule);
  await counter.clearPrefix('a.');
  assert.equal((await counter.hit('a.1', rule)).hits, 1);
  assert.equal((await counter.hit('a.2', rule)).hits, 1);
  assert.equal((await counter.hit('ab.1', rule)).hits, 4, 'another prefix keeps its count');
}

async function testUnknownAccountGetsTheSameAnswers() {
  const { controller, checks, events } = setup();
  const reasons = (from: number) => events.slice(from).map((e) => `${e.action}/${e.reason}`);
  await refuseFiveTimes(controller, 'nobody@example.com', '198.51.100.4');
  const unknownEvents = reasons(0);
  const from = events.length;
  await refuseFiveTimes(controller, 'ada@example.com', '198.51.100.4');
  const knownEvents = reasons(from).map((r) => r.replace('bad_password', 'unknown_user'));
  assert.deepEqual(unknownEvents, knownEvents, 'the same events, the reason of each refusal aside');
  assert.equal(unknownEvents.filter((r) => r.endsWith('too_many_attempts')).length, 1, 'one block event each');
  const checked = checks.length;
  const recorded = events.length;
  const unknown = await signIn(controller, 'nobody@example.com', PASSWORD, '198.51.100.4');
  const known = await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.4');
  assert.equal(unknown.status, 429);
  assert.deepEqual(unknown.body, known.body, 'same body');
  assert.ok(Math.abs(Number(unknown.retryAfter) - Number(known.retryAfter)) <= 1, 'same wait');
  assert.equal(checks.length, checked, 'neither reaches the account lookup');
  assert.equal(events.length, recorded, 'neither is recorded');
}

async function testErrorOtherThanRefusalDoesNotCount() {
  const { controller, events } = setup();
  for (let i = 0; i < 4; i += 1) assert.equal((await signIn(controller, 'ada@example.com', 'Wrong-pass-0', '198.51.100.10')).status, 401);
  for (let i = 0; i < 3; i += 1) {
    assert.equal((await signIn(controller, 'ada@example.com', SERVER_ERROR, '198.51.100.10')).status, 500, `server error ${i + 1}`);
  }
  assert.equal(events.filter((e) => e.reason === 'too_many_attempts').length, 0, 'the errors do not start a block');
  assert.equal((await signIn(controller, 'ada@example.com', 'Wrong-pass-0', '198.51.100.10')).status, 401, 'the fifth refusal is still checked');
  assert.equal((await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.10')).status, 429, 'the earlier refusals stayed counted');
}

/** `release` takes back one hit of its own window only, and nothing from a blocked key. */
async function testReleaseKeepsTheOtherHits() {
  let now = Date.now();
  const counter = new MemoryHitCounter(() => now);
  const rule = { limit: 5, ttl: 15 * 60_000, blockDuration: 15 * 60_000 };
  await counter.hit('k', rule);
  await counter.hit('k', rule);
  const third = await counter.hit('k', rule);
  await counter.release('k', third.window);
  assert.equal((await counter.hit('k', rule)).hits, 3, 'one hit taken back, two kept');

  now += 15 * 60_000;
  const fresh = await counter.hit('k', rule);
  assert.equal(fresh.hits, 1, 'a new window');
  await counter.release('k', third.window);
  assert.equal((await counter.hit('k', rule)).hits, 2, 'a hit of a window that has ended takes nothing back');

  for (let i = 0; i < 4; i += 1) await counter.hit('k', rule);
  const over = await counter.hit('k', rule);
  assert.equal(over.blocked, true);
  await counter.release('k', over.window);
  assert.equal((await counter.hit('k', rule)).blocked, true, 'a blocked key stays blocked');
}

async function testIdentifierTypedIsNormalizedPerTenant() {
  assert.equal(normalizeLoginIdentifier('  Ada@Example.COM \t'), 'ada@example.com');
  assert.equal(loginAttemptKey('t', '198.51.100.5', ' ADA@example.com'), loginAttemptKey('t', '198.51.100.5', 'ada@example.com'));
  assert.notEqual(loginAttemptKey('t', '198.51.100.5', 'ada@example.com'), loginAttemptKey('u', '198.51.100.5', 'ada@example.com'));
  assert.match(loginAttemptKey('t', '198.51.100.5', 'ada@example.com'), /^[0-9a-f]{64}\.[0-9a-f]{64}$/, 'hashes: neither identifier nor client address in clear');
  assert.equal(
    loginAttemptKey('t', '198.51.100.5', 'ada@example.com').split('.')[0],
    loginAttemptKey('t', '198.51.100.6', 'ada@example.com').split('.')[0],
    'one account part for every client address',
  );

  const { controller } = setup();
  await refuseFiveTimes(controller, 'Ada@Example.com', '198.51.100.5');
  assert.equal((await signIn(controller, 'ADA@example.com', PASSWORD, '198.51.100.5')).status, 429, 'case does not matter');
  assert.equal((await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.5', 'tenant-2')).status, 201, 'another tenant has its own count');
}

async function testBlockAndWindowEnd() {
  let now = Date.now();
  const { controller } = setup(() => now);
  await refuseFiveTimes(controller, 'ada@example.com', '198.51.100.6');
  assert.equal((await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.6')).status, 429);
  now += 14 * 60_000;
  assert.equal((await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.6')).status, 429, 'blocked for 15 minutes');
  now += 60_000 + 1;
  assert.equal((await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.6')).status, 201, 'then signs in again');

  // The fifth refusal starts the 15 minutes, even late in the window.
  for (let i = 0; i < 4; i += 1) await signIn(controller, 'ada@example.com', 'Wrong-pass-0', '198.51.100.9');
  now += 14 * 60_000;
  assert.equal((await signIn(controller, 'ada@example.com', 'Wrong-pass-0', '198.51.100.9')).status, 401, 'fifth refusal');
  now += 2 * 60_000;
  const late = await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.9');
  assert.equal(late.status, 429, 'refused after the window of the first attempt has ended');
  assert.ok(Number(late.retryAfter) > 12 * 60 && Number(late.retryAfter) <= 13 * 60, `15 minutes from the fifth refusal (${late.retryAfter} s left)`);
  now += 13 * 60_000 + 1;
  assert.equal((await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.9')).status, 201, 'then signs in again');

  // Refusals older than the 15-minute window no longer count.
  for (let i = 0; i < 4; i += 1) await signIn(controller, 'bob@example.com', 'Wrong-pass-0', '198.51.100.6');
  now += 15 * 60_000;
  await refuseFiveTimes(controller, 'bob@example.com', '198.51.100.6');
}

async function testAttemptsAtTheSameMomentDoNotPassTogether() {
  const { controller, checks, events } = setup();
  const answers = await Promise.all(
    Array.from({ length: 12 }, () => signIn(controller, 'ada@example.com', 'Wrong-pass-0', '198.51.100.7')),
  );
  assert.equal(answers.filter((a) => a.status === 401).length, 5, 'five checked');
  assert.equal(answers.filter((a) => a.status === 429).length, 7, 'the others refused');
  assert.equal(checks.length, 5, 'five password checks');
  assert.equal(events.filter((e) => e.reason === 'too_many_attempts').length, 1, 'one block event');
}

async function testOffWithTheOtherLimits() {
  process.env.RATE_LIMIT_ENABLED = 'false';
  try {
    const { controller } = setup();
    for (let i = 0; i < 8; i += 1) assert.equal((await signIn(controller, 'ada@example.com', 'Wrong-pass-0', '198.51.100.8')).status, 401);
  } finally {
    process.env.RATE_LIMIT_ENABLED = 'true';
  }
}

async function run() {
  process.env.RATE_LIMIT_ENABLED = 'true';
  process.env.JWT_SECRET ||= 'login-attempt-limit-spec-signing-key';
  const failures: string[] = [];
  for (const [label, test] of [
    ['testFiveRefusalsBlockThePair', testFiveRefusalsBlockThePair],
    ['testSuccessClearsTheCount', testSuccessClearsTheCount],
    ['testPasswordResetClearsTheAccount', testPasswordResetClearsTheAccount],
    ['testClearPrefix', testClearPrefix],
    ['testUnknownAccountGetsTheSameAnswers', testUnknownAccountGetsTheSameAnswers],
    ['testErrorOtherThanRefusalDoesNotCount', testErrorOtherThanRefusalDoesNotCount],
    ['testReleaseKeepsTheOtherHits', testReleaseKeepsTheOtherHits],
    ['testIdentifierTypedIsNormalizedPerTenant', testIdentifierTypedIsNormalizedPerTenant],
    ['testBlockAndWindowEnd', testBlockAndWindowEnd],
    ['testAttemptsAtTheSameMomentDoNotPassTogether', testAttemptsAtTheSameMomentDoNotPassTogether],
    ['testOffWithTheOtherLimits', testOffWithTheOtherLimits],
  ] as const) {
    try {
      await test();
      console.log(`ok - ${label}`);
    } catch (error) {
      failures.push(`${label}: ${(error as Error)?.message ?? error}`);
    }
  }
  if (failures.length) {
    console.error(`login-attempt-limit.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
    process.exit(1);
  }
  console.log('login-attempt-limit.spec: ok');
}

void run();
