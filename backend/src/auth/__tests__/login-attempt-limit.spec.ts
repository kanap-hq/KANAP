import * as assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import { MemoryHitCounter } from '../../common/rate-limit-store';
import { RATE_LIMITS } from '../../common/rate-limit';
import { AuthController } from '../auth.controller';
import { AuthRefusedException } from '../auth-refused.exception';
import { LoginAttemptLimit, loginAttemptKey, normalizeLoginIdentifier } from '../login-attempt-limit';

// Password sign-in attempts per account and client address (login-attempt-limit.ts), through
// AuthController.login:
// - five refused attempts for one account from one address within 15 minutes, then the next is
//   refused with 429, even with the right password, before the password check, for 15 minutes
//   from the fifth refusal;
// - the same account from another address, and another account from the same address, sign in;
// - a successful sign-in clears the count of its pair;
// - an address no account has gets the same answers and the same refusal as a known one;
// - the address typed counts in lower case and without spaces, per tenant;
// - attempts sent at the same moment do not pass the limit together;
// - RATE_LIMIT_ENABLED=false turns the count off.

const PASSWORD = 'Right-pass-2026';
const ACCOUNTS: Record<string, string> = { 'ada@example.com': 'user-ada', 'bob@example.com': 'user-bob' };
const INVALID_CREDENTIALS = { code: 'INVALID_CREDENTIALS', message: 'Invalid credentials' };

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
  const auth = {
    // The service's answers: the same 401 for a wrong password and an unknown address.
    validateUser: async (email: string, password: string) => {
      checks.push(email);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const id = ACCOUNTS[email.trim().toLowerCase()];
      if (!id) throw new AuthRefusedException(INVALID_CREDENTIALS, 'unknown_user');
      if (password !== PASSWORD) throw new AuthRefusedException(INVALID_CREDENTIALS, 'bad_password', id);
      return { id, email, role: 'member', tenant_id: 'tenant-1' };
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
    if (!(error instanceof HttpException)) throw error;
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

async function testFiveRefusalsBlockThePair() {
  assert.deepEqual(RATE_LIMITS.authLoginFailures, { limit: 5, ttl: 15 * 60_000 }, 'five attempts in 15 minutes');
  const { controller, checks, events } = setup();
  await refuseFiveTimes(controller, 'ada@example.com', '198.51.100.1');
  const checked = checks.length;
  const blocked = await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.1');
  assert.equal(blocked.status, 429, 'the 6th attempt is refused, even with the right password');
  assert.equal(blocked.body, 'ThrottlerException: Too Many Requests', 'the answer of the address limit');
  assert.ok(Number(blocked.retryAfter) > 890 && Number(blocked.retryAfter) <= 900, `Retry-After ${blocked.retryAfter}`);
  assert.equal(checks.length, checked, 'refused before the password check');
  assert.deepEqual(events.at(-1), { action: 'login_failed', reason: 'too_many_attempts' }, 'recorded with its reason');
  assert.equal((await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.1')).status, 429, 'still refused');

  // The same account from another address, another account from the same address.
  assert.equal((await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.2')).status, 201, 'another address signs in');
  assert.equal((await signIn(controller, 'bob@example.com', PASSWORD, '198.51.100.1')).status, 201, 'another account signs in');
}

async function testSuccessClearsTheCount() {
  const { controller } = setup();
  for (let i = 0; i < 4; i += 1) assert.equal((await signIn(controller, 'ada@example.com', 'Wrong-pass-0', '198.51.100.3')).status, 401);
  assert.equal((await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.3')).status, 201);
  await refuseFiveTimes(controller, 'ada@example.com', '198.51.100.3');
  assert.equal((await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.3')).status, 429, 'five new refusals after the success');
}

async function testUnknownAddressGetsTheSameAnswers() {
  const { controller, checks } = setup();
  await refuseFiveTimes(controller, 'nobody@example.com', '198.51.100.4');
  await refuseFiveTimes(controller, 'ada@example.com', '198.51.100.4');
  const checked = checks.length;
  const unknown = await signIn(controller, 'nobody@example.com', PASSWORD, '198.51.100.4');
  const known = await signIn(controller, 'ada@example.com', PASSWORD, '198.51.100.4');
  assert.equal(unknown.status, 429);
  assert.deepEqual(unknown.body, known.body, 'same body');
  assert.ok(Math.abs(Number(unknown.retryAfter) - Number(known.retryAfter)) <= 1, 'same wait');
  assert.equal(checks.length, checked, 'neither reaches the account lookup');
}

async function testAddressTypedIsNormalizedPerTenant() {
  assert.equal(normalizeLoginIdentifier('  Ada@Example.COM \t'), 'ada@example.com');
  assert.equal(loginAttemptKey('t', '198.51.100.5', ' ADA@example.com'), loginAttemptKey('t', '198.51.100.5', 'ada@example.com'));
  assert.notEqual(loginAttemptKey('t', '198.51.100.5', 'ada@example.com'), loginAttemptKey('u', '198.51.100.5', 'ada@example.com'));
  assert.match(loginAttemptKey('t', '198.51.100.5', 'ada@example.com'), /^[0-9a-f]{64}$/, 'a hash: no address in clear');

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
  const { controller, checks } = setup();
  const answers = await Promise.all(
    Array.from({ length: 12 }, () => signIn(controller, 'ada@example.com', 'Wrong-pass-0', '198.51.100.7')),
  );
  assert.equal(answers.filter((a) => a.status === 401).length, 5, 'five checked');
  assert.equal(answers.filter((a) => a.status === 429).length, 7, 'the others refused');
  assert.equal(checks.length, 5, 'five password checks');
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
    ['testUnknownAddressGetsTheSameAnswers', testUnknownAddressGetsTheSameAnswers],
    ['testAddressTypedIsNormalizedPerTenant', testAddressTypedIsNormalizedPerTenant],
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
