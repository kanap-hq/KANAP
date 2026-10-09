/**
 * Constat n°2 — an access token must be an access token, not merely a token this application can
 * verify. Every case below signs with the SAME key the guard uses (`JWT_SECRET`), with a valid
 * `sub` and the expected tenant: only the purpose control can reject them.
 *
 * The last test proves that control is load-bearing: with `checkAccessTokenPurpose` neutralised,
 * the suite fails.
 */
import * as assert from 'node:assert/strict';
import * as crypto from 'crypto';
import * as jwt from 'jsonwebtoken';
import { UnauthorizedException } from '@nestjs/common';
import { JwtAuthGuard } from '../jwt-auth.guard';
import * as accessTokenUtil from '../access-token.util';
import {
  ACCESS_TOKEN_PURPOSE,
  ENTRA_LOGIN_HANDOFF_TYPE,
  ENTRA_STATE_PURPOSE,
  PROVISIONING_PURPOSE,
  PASSWORD_RESET_PURPOSE,
  describeTokenPurposePolicy,
  resolveAccessTokenPolicy,
} from '../access-token.util';
import { deriveSecret } from '../token-secret.util';

const JWT_SECRET = 'jwt-auth-guard-spec-secret';
const TENANT_ID = 'tenant-1';

process.env.JWT_SECRET = JWT_SECRET;
process.env.PASSWORD_RESET_SECRET = '';
process.env.PROVISIONING_TOKEN_SECRET = '';
process.env.ENTRA_STATE_SECRET = '';
// Far-future cut-over: the transition window is open (pre-fix tokens still accepted).
process.env.JWT_LEGACY_ACCESS_TOKEN_DEADLINE = '2099-01-01T00:00:00.000Z';

function reflectorStub() {
  return { getAllAndOverride: () => false } as any;
}

function createContext(req: any) {
  return {
    getHandler: () => 'handler',
    getClass: () => 'controller',
    switchToHttp: () => ({
      getRequest: () => req,
    }),
  } as any;
}

function requestWith(token: string, tenantId: string | null = TENANT_ID, extra: Record<string, unknown> = {}) {
  return {
    headers: { authorization: `Bearer ${token}` },
    ...(tenantId ? { tenant: { id: tenantId } } : {}),
    ...extra,
  };
}

function sign(payload: Record<string, unknown>, secret: string = JWT_SECRET, options: jwt.SignOptions = {}) {
  return jwt.sign(payload, secret, options);
}

function accessClaims(overrides: Record<string, unknown> = {}) {
  return {
    sub: 'user-1',
    email: 'user@example.com',
    role: { role_name: 'Member' },
    tenant_id: TENANT_ID,
    ...overrides,
  };
}

function isUnauthorized(error: unknown) {
  assert.ok(error instanceof UnauthorizedException, `expected UnauthorizedException, got ${String(error)}`);
  return true;
}

function hash(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function assertRejected(guard: JwtAuthGuard, req: any, label: string) {
  assert.throws(() => guard.canActivate(createContext(req)), isUnauthorized, label);
}

function assertAccepted(guard: JwtAuthGuard, req: any, label: string) {
  assert.equal(guard.canActivate(createContext(req)), true, label);
}

function newGuard(clock: { now?: () => number } = {}) {
  return new JwtAuthGuard(reflectorStub()).setClock(clock);
}

// --- accepted shapes -------------------------------------------------------------------------

function testAcceptsMarkedAccessToken() {
  const guard = newGuard();
  const token = sign(accessClaims({ purpose: ACCESS_TOKEN_PURPOSE }));
  const req: any = requestWith(token);
  assertAccepted(guard, req, 'marked access token');
  assert.equal(req.user.sub, 'user-1');
  assert.equal(req.user.purpose, ACCESS_TOKEN_PURPOSE);
}

function testAcceptsLegacyAccessTokenDuringWindow() {
  const guard = newGuard();
  assertAccepted(guard, requestWith(sign(accessClaims())), 'legacy (untyped) access token');
}

// --- rejected families ----------------------------------------------------------------------

function testRejectsPasswordResetToken() {
  const guard = newGuard();
  const token = sign(accessClaims({ purpose: PASSWORD_RESET_PURPOSE, jti: 'jti-1' }));
  assertRejected(guard, requestWith(token), 'password-reset token');
}

function testRejectsNewPasswordResetTokenFromDerivedKey() {
  // Same family, new signing key: refused by the purpose control, not by the signature.
  const guard = newGuard();
  const token = sign(
    accessClaims({ purpose: PASSWORD_RESET_PURPOSE, jti: 'jti-1' }),
    deriveSecret(JWT_SECRET, 'password-reset'),
  );
  assertRejected(guard, requestWith(token), 'password-reset token (derived key)');
}

function testRejectsProvisioningToken() {
  const guard = newGuard();
  const token = sign(accessClaims({ purpose: PROVISIONING_PURPOSE }));
  assertRejected(guard, requestWith(token), 'provisioning token');
}

function testRejectsEntraHandoffToken() {
  const guard = newGuard();
  const token = sign({
    type: ENTRA_LOGIN_HANDOFF_TYPE,
    tenantId: TENANT_ID,
    userId: 'user-1',
    tenant_id: TENANT_ID,
    sub: 'user-1',
  });
  assertRejected(guard, requestWith(token), 'Entra login handoff');
}

function testRejectsEntraStateToken() {
  const guard = newGuard();
  const token = sign({
    purpose: ENTRA_STATE_PURPOSE,
    mode: 'login',
    tenantId: TENANT_ID,
    nonce: 'nonce-1',
    tenant_id: TENANT_ID,
    sub: 'user-1',
  });
  assertRejected(guard, requestWith(token), 'Entra state');
}

function testRejectsPrefixEntraStateTokenWithoutAnyMarker() {
  // A state minted by an instance running the previous build: signed with the shared secret and
  // carrying neither `purpose` nor `type`. It looks like a legacy access token to a naive check,
  // and on an apex host there is no request tenant to fail the comparison — the legacy branch
  // must refuse it on shape alone.
  const guard = newGuard();
  const prefixState = sign({ mode: 'login', tenantId: TENANT_ID, redirectTo: '/', nonce: 'nonce-1' });
  assertRejected(guard, requestWith(prefixState), 'pre-fix Entra state (tenant host)');
  assertRejected(guard, requestWith(prefixState, null), 'pre-fix Entra state (apex host, no tenant)');

  // Same for a handoff, which the guard refuses on its own `type` marker.
  const prefixHandoff = sign({ tenantId: TENANT_ID, userId: 'user-1', redirectTo: '/' });
  assertRejected(guard, requestWith(prefixHandoff, null), 'marker-less payload without subject');
}

// --- malformed or absent purpose --------------------------------------------------------------

function testRejectsMalformedPurpose() {
  const guard = newGuard();
  const cases: Array<[string, unknown]> = [
    ['null', null],
    ['empty string', ''],
    ['number', 42],
    ['object', { kind: 'access' }],
    ['boolean', true],
    ['array', ['access']],
    ['unknown family', 'refresh'],
  ];
  for (const [label, purpose] of cases) {
    assertRejected(guard, requestWith(sign(accessClaims({ purpose }))), `purpose=${label}`);
  }
}

// --- shape is checked on every acceptance path ------------------------------------------------

function testMarkedTokenMustStillBeShapedLikeAnAccessToken() {
  // A contradictory payload must never be accepted just because it declares `purpose: 'access'`.
  const guard = newGuard();
  const { sub: _sub, ...withoutSubject } = accessClaims();
  const cases: Array<[string, Record<string, unknown>]> = [
    ['marked, no sub', { ...withoutSubject, purpose: ACCESS_TOKEN_PURPOSE }],
    ['marked, empty sub', { ...accessClaims(), sub: '', purpose: ACCESS_TOKEN_PURPOSE }],
    ['marked, non-string sub', { ...accessClaims(), sub: 42, purpose: ACCESS_TOKEN_PURPOSE }],
    ['marked, foreign type', { ...accessClaims(), purpose: ACCESS_TOKEN_PURPOSE, type: ENTRA_LOGIN_HANDOFF_TYPE }],
    ['marked, unknown type', { ...accessClaims(), purpose: ACCESS_TOKEN_PURPOSE, type: 'something_else' }],
    ['marked, null type', { ...accessClaims(), purpose: ACCESS_TOKEN_PURPOSE, type: null }],
    ['legacy, unknown type', { ...accessClaims(), type: 'something_else' }],
    ['legacy, null type', { ...accessClaims(), type: null }],
  ];
  for (const [label, payload] of cases) {
    assertRejected(guard, requestWith(sign(payload)), label);
  }
}

// --- tenant and signature controls stay intact ------------------------------------------------

function testRejectsTenantMismatch() {
  const guard = newGuard();
  const token = sign(accessClaims({ purpose: ACCESS_TOKEN_PURPOSE }));
  assertRejected(guard, requestWith(token, 'tenant-2'), 'tenant mismatch');
}

function testRejectsPlatformHostTenantMismatch() {
  // Pre-existing behaviour, kept: the platform host does not waive the tenant comparison.
  const guard = newGuard();
  const token = sign(accessClaims({ purpose: ACCESS_TOKEN_PURPOSE }));
  assertRejected(
    guard,
    requestWith(token, 'tenant-2', { isPlatformHost: true }),
    'tenant mismatch on the platform host',
  );
}

function testRejectsInvalidSignature() {
  const guard = newGuard();
  const token = sign(accessClaims({ purpose: ACCESS_TOKEN_PURPOSE }), 'another-secret');
  assertRejected(guard, requestWith(token), 'invalid signature');
}

// --- platform-admin scenario ------------------------------------------------------------------

function testRejectsResetTokenThatWouldPassEveryOtherCheckOnPlatformHost() {
  // An administrator/system identity on the platform host: `sub` resolves, there is no request
  // tenant to compare against, and the platform-admin guard reads `req.user`. Nothing but the
  // purpose control stands between this reset link and a platform session.
  const guard = newGuard();
  const token = sign({
    purpose: PASSWORD_RESET_PURPOSE,
    jti: 'jti-platform',
    sub: 'platform-admin-user',
    email: 'admin@kanap.net',
    role: { role_name: 'Administrator' },
    tenant_id: null,
  });
  const req = requestWith(token, null, { isPlatformHost: true, headers: { authorization: `Bearer ${token}` } });
  assertRejected(guard, req, 'reset token on platform host');
}

// --- consumption does not rehabilitate a reset token ------------------------------------------

/** Reset-token store of the real flow: `used_at` is set by `AuthService.resetPasswordWithToken`. */
function createResetTokenStore() {
  const records = new Map<string, { usedAt: Date | null }>();
  return {
    records,
    insert(token: string) {
      records.set(hash(token), { usedAt: null });
    },
    findOne(token: string) {
      const record = records.get(hash(token));
      return record && record.usedAt === null ? record : null;
    },
    consume(token: string) {
      const record = records.get(hash(token));
      if (!record || record.usedAt !== null) return { affected: 0 };
      record.usedAt = new Date();
      return { affected: 1 };
    },
  };
}

function testResetTokenRejectedBeforeAndAfterConsumption() {
  // `resetPasswordWithToken` burns the record (`used_at`) but does not revoke the JWT itself;
  // only the purpose control closes that window. The store below is the authority the service
  // consults, so "after consumption" exercises a real state change, not a local flag.
  const guard = newGuard();
  const store = createResetTokenStore();
  const token = sign(
    accessClaims({ purpose: PASSWORD_RESET_PURPOSE, jti: 'jti-consumed' }),
    deriveSecret(JWT_SECRET, 'password-reset'),
  );
  store.insert(token);

  assertRejected(guard, requestWith(token), 'reset token before consumption');
  assert.equal(store.consume(token).affected, 1, 'the legitimate flow consumes the record');
  assertRejected(guard, requestWith(token), 'reset token after consumption');
  assert.equal(store.consume(token).affected, 0, 'a consumed token cannot be consumed twice');
}

// --- marker-less tokens: refused unless a deadline is configured -------------------------------

const DEADLINE_ENV = 'JWT_LEGACY_ACCESS_TOKEN_DEADLINE';

/** Runs `fn` with the deadline variable set to `value` (`undefined`: unset), then restores it. */
function withDeadline(value: string | undefined, fn: () => void) {
  const previous = process.env[DEADLINE_ENV];
  if (value === undefined) delete process.env[DEADLINE_ENV];
  else process.env[DEADLINE_ENV] = value;
  try {
    fn();
  } finally {
    if (previous === undefined) delete process.env[DEADLINE_ENV];
    else process.env[DEADLINE_ENV] = previous;
  }
}

function testRefusesUntypedTokenRightAfterStartWithoutDeadline() {
  // A guard built just now stands for a process that has just started: without a configured
  // deadline, a token without the marker is refused from the first request on.
  for (const [label, value] of [['unset', undefined], ['blank', '   ']] as const) {
    withDeadline(value, () => {
      const guard = newGuard();
      assertRejected(guard, requestWith(sign(accessClaims())), `legacy token right after start (${label})`);
      assertAccepted(
        guard,
        requestWith(sign(accessClaims({ purpose: ACCESS_TOKEN_PURPOSE }))),
        `marked access token right after start (${label})`,
      );

      const policy = resolveAccessTokenPolicy(process.env);
      assert.equal(policy.legacyDeadline, null, `no deadline (${label})`);
      const report = describeTokenPurposePolicy(process.env, Date.now(), Date.now());
      assert.equal(report.level, 'info', `refusing marker-less tokens needs no operator decision (${label})`);
      assert.match(report.message, /legacy untyped access tokens: refused\)/);
      assert.doesNotMatch(report.message, /JWT_LEGACY_ACCESS_TOKEN_DEADLINE=/, 'no deadline is suggested');
    });
  }
}

function testAcceptsUntypedTokenUntilConfiguredDeadline() {
  const deadline = Date.parse('2030-01-01T00:00:00.000Z');
  withDeadline('2030-01-01T00:00:00.000Z', () => {
    const before = newGuard({ now: () => deadline - 1 });
    assertAccepted(before, requestWith(sign(accessClaims())), 'legacy token before the deadline');

    const at = newGuard({ now: () => deadline });
    assertRejected(at, requestWith(sign(accessClaims())), 'legacy token at the deadline');
    assertAccepted(
      at,
      requestWith(sign(accessClaims({ purpose: ACCESS_TOKEN_PURPOSE }))),
      'marked access token at the deadline',
    );

    // The start-up line names the instant the guard enforces.
    const report = describeTokenPurposePolicy(process.env, deadline - 1, deadline - 1);
    assert.equal(report.level, 'info');
    assert.ok(
      report.message.includes(`accepted until ${new Date(deadline).toISOString()}`),
      `report does not name the enforced deadline: ${report.message}`,
    );
  });
}

function testRefusesUntypedTokenOnceDeadlineIsPast() {
  withDeadline('2020-01-01T00:00:00.000Z', () => {
    const guard = newGuard();
    assertRejected(guard, requestWith(sign(accessClaims())), 'legacy token after the deadline');
    assertAccepted(
      guard,
      requestWith(sign(accessClaims({ purpose: ACCESS_TOKEN_PURPOSE }))),
      'marked access token after the deadline',
    );
    const report = describeTokenPurposePolicy(process.env, Date.now(), Date.now());
    assert.equal(report.level, 'warn');
    assert.match(report.message, /already past/);
  });
}

function testInvalidDeadlineRefusesUntypedTokenAndWarns() {
  withDeadline('not-a-date', () => {
    const guard = newGuard();
    assertRejected(guard, requestWith(sign(accessClaims())), 'legacy token with an unparseable deadline');
    assertAccepted(
      guard,
      requestWith(sign(accessClaims({ purpose: ACCESS_TOKEN_PURPOSE }))),
      'marked access token with an unparseable deadline',
    );
    const policy = resolveAccessTokenPolicy(process.env);
    assert.deepEqual(policy, { legacyDeadline: null, deadlineInvalid: true });
    const report = describeTokenPurposePolicy(process.env, Date.now(), Date.now());
    assert.equal(report.level, 'warn', 'an unparseable deadline is still reported as a warning');
    assert.match(report.message, /not a parseable instant/);
  });
}

// --- mutation: the purpose control must be load-bearing ---------------------------------------

function testMutationWithoutPurposeControlAcceptsForeignTokens() {
  // The mutation is applied to the module the guard actually calls, so this proves the purpose
  // control is load-bearing rather than merely present.
  const util = accessTokenUtil as any;
  const original = util.checkAccessTokenPurpose;
  util.checkAccessTokenPurpose = () => ({ ok: true, legacy: false });
  try {
    const guard = newGuard();
    const mutated = [
      sign(accessClaims({ purpose: PASSWORD_RESET_PURPOSE, jti: 'jti-1' })),
      sign(accessClaims({ purpose: PROVISIONING_PURPOSE })),
      sign(accessClaims({ purpose: null })),
    ];
    for (const token of mutated) {
      assertAccepted(guard, requestWith(token), 'purpose control removed: foreign token accepted');
    }
  } finally {
    util.checkAccessTokenPurpose = original;
  }
}

function run() {
  testAcceptsMarkedAccessToken();
  testAcceptsLegacyAccessTokenDuringWindow();
  testRejectsPasswordResetToken();
  testRejectsNewPasswordResetTokenFromDerivedKey();
  testRejectsProvisioningToken();
  testRejectsEntraHandoffToken();
  testRejectsEntraStateToken();
  testRejectsPrefixEntraStateTokenWithoutAnyMarker();
  testRejectsMalformedPurpose();
  testMarkedTokenMustStillBeShapedLikeAnAccessToken();
  testRejectsTenantMismatch();
  testRejectsPlatformHostTenantMismatch();
  testRejectsInvalidSignature();
  testRejectsResetTokenThatWouldPassEveryOtherCheckOnPlatformHost();
  testResetTokenRejectedBeforeAndAfterConsumption();
  testRefusesUntypedTokenRightAfterStartWithoutDeadline();
  testAcceptsUntypedTokenUntilConfiguredDeadline();
  testRefusesUntypedTokenOnceDeadlineIsPast();
  testInvalidDeadlineRefusesUntypedTokenAndWarns();
  testMutationWithoutPurposeControlAcceptsForeignTokens();
  // eslint-disable-next-line no-console
  console.log('jwt-auth.guard.spec: OK (20 cases)');
}

run();
