import { TOKEN_SECRET_LABEL } from './token-secret.util';

/**
 * Access-token purpose marker, and the optional window (`JWT_LEGACY_ACCESS_TOKEN_DEADLINE`) that
 * keeps accepting access tokens issued before the marker existed.
 *
 * RFC 8725 §3.12, "Use Explicit Typing": a JWT must be checked not only as a valid token, but as
 * a valid token OF THE EXPECTED KIND. Every other family signed by this application (password
 * reset, provisioning, SSO state, SSO handoff) declares its own purpose and is refused here;
 * this is what stops a password-reset link from being replayed as a `Bearer` credential.
 * https://www.rfc-editor.org/rfc/rfc8725.html#section-3.12
 */

export const ACCESS_TOKEN_PURPOSE = 'access';

/**
 * Purpose markers of the other families. Two double as the versioned HMAC labels that derive their
 * signing keys, so a marker rename cannot silently desynchronise a family from its key derivation.
 * Provisioning keeps its historical marker, because its issuer is a service outside this
 * repository; the handoff is discriminated by `ENTRA_LOGIN_HANDOFF_TYPE`, its own legacy marker.
 * All four are listed here so the access-token predicate refuses the whole set.
 */
export const PASSWORD_RESET_PURPOSE = TOKEN_SECRET_LABEL['password-reset'];
export const PROVISIONING_PURPOSE = 'provision';
export const ENTRA_STATE_PURPOSE = TOKEN_SECRET_LABEL['entra-state'];
export const ENTRA_LOGIN_HANDOFF_TYPE = 'entra_login_handoff';

/**
 * Every marker that identifies a token family other than an access token. Listed in one place so
 * the access-token predicate refuses the whole set, declared under `purpose` or — for the handoff
 * — under its own legacy `type`.
 */
export const FOREIGN_TOKEN_MARKERS: readonly string[] = [
  PASSWORD_RESET_PURPOSE,
  PROVISIONING_PURPOSE,
  ENTRA_STATE_PURPOSE,
  ENTRA_LOGIN_HANDOFF_TYPE,
];

/**
 * Access tokens declare nothing but `purpose: 'access'`. Everything else that shares the legacy
 * layout is refused: the SSO state is `{ mode, tenantId, nonce }` and the login handoff is
 * `{ type, tenantId, userId }` — both signed with `JWT_SECRET` by an instance that predates this
 * fix, and neither carrying a usable subject. The subject is required even on the accepted path,
 * so a token can never be both "an access token" and something else.
 */
function hasAccessTokenSubject(payload: Record<string, unknown>): boolean {
  return typeof payload.sub === 'string' && payload.sub !== '';
}

export type AccessTokenPurposeCheck = {
  ok: boolean;
  /** Present when `ok` is false. */
  reason?: 'purpose-declared' | 'purpose-malformed' | 'legacy-window-closed';
  /** True for a marker-less token accepted before `JWT_LEGACY_ACCESS_TOKEN_DEADLINE`. */
  legacy: boolean;
};

export type AccessTokenPolicy = {
  /**
   * Instant until which a token without `purpose: 'access'` is still accepted, from
   * `JWT_LEGACY_ACCESS_TOKEN_DEADLINE`. Null when no valid deadline is configured: such a token is
   * refused at all times.
   */
  legacyDeadline: number | null;
  /** `JWT_LEGACY_ACCESS_TOKEN_DEADLINE` was set but is not a parseable instant. */
  deadlineInvalid: boolean;
};

const LEGACY_DEADLINE_ENV = 'JWT_LEGACY_ACCESS_TOKEN_DEADLINE';

/** The configured cut-over instant, trimmed; `null` when unset or blank. */
export function configuredLegacyDeadline(env: NodeJS.ProcessEnv = process.env): string | null {
  const raw = (env[LEGACY_DEADLINE_ENV] ?? '').trim();
  return raw === '' ? null : raw;
}

/**
 * Decide until when a token without the purpose marker is accepted.
 *
 * Every access token this API issues carries the marker. A marker-less token comes from a build
 * older than the marker, and is refused unless the operator keeps accepting such tokens until an
 * explicit instant with `JWT_LEGACY_ACCESS_TOKEN_DEADLINE` (ISO-8601). Without that variable, or
 * with a value that is not an instant, they are refused at all times, whenever the process started.
 */
export function resolveAccessTokenPolicy(env: NodeJS.ProcessEnv = process.env): AccessTokenPolicy {
  const rawDeadline = configuredLegacyDeadline(env);
  if (rawDeadline === null) return { legacyDeadline: null, deadlineInvalid: false };
  const parsed = Date.parse(rawDeadline);
  if (Number.isNaN(parsed)) return { legacyDeadline: null, deadlineInvalid: true };
  return { legacyDeadline: parsed, deadlineInvalid: false };
}

/** Parse the deadline once per value of the variable, not once per request. */
export function createAccessTokenPolicyResolver(
  env: NodeJS.ProcessEnv = process.env,
): () => AccessTokenPolicy {
  let cache: { raw: string | undefined; policy: AccessTokenPolicy } | null = null;
  return () => {
    const raw = env[LEGACY_DEADLINE_ENV];
    if (!cache || cache.raw !== raw) {
      cache = { raw, policy: resolveAccessTokenPolicy(env) };
    }
    return cache.policy;
  };
}

/**
 * Start-up line for the token-purpose policy. Informational when marker-less tokens are refused
 * (the default) or accepted until a configured future deadline; a warning when
 * `JWT_LEGACY_ACCESS_TOKEN_DEADLINE` is unparseable or already past.
 *
 * `_processStartedAt` is not used: the policy no longer depends on when the process started. The
 * parameter stays until the start-up caller stops passing it.
 */
export function describeTokenPurposePolicy(
  env: NodeJS.ProcessEnv = process.env,
  _processStartedAt?: number,
  now: number = Date.now(),
): { level: 'info' | 'warn'; message: string } {
  const policy = resolveAccessTokenPolicy(env);
  const base = 'Access tokens must carry purpose="access"';
  if (policy.deadlineInvalid) {
    return {
      level: 'warn',
      message: `${base} (legacy untyped access tokens: refused; ${LEGACY_DEADLINE_ENV} is not a parseable instant)`,
    };
  }
  if (policy.legacyDeadline === null) {
    return { level: 'info', message: `${base} (legacy untyped access tokens: refused)` };
  }
  const deadline = new Date(policy.legacyDeadline).toISOString();
  if (now < policy.legacyDeadline) {
    return { level: 'info', message: `${base} (legacy untyped access tokens: accepted until ${deadline})` };
  }
  return {
    level: 'warn',
    message: `${base} (legacy untyped access tokens: refused; ${LEGACY_DEADLINE_ENV} ${deadline} is already past)`,
  };
}

/**
 * Purpose test for an access token.
 *
 * Shape is checked first and applies to every acceptance path, so a token can never be accepted as
 * an access token while also being something else:
 *
 * - an unrecognised `type` claim, or a missing/empty `sub`, is refused — with or without
 *   `purpose: 'access'`;
 * - `purpose: 'access'` → accepted;
 * - no `purpose` claim at all → accepted only before `JWT_LEGACY_ACCESS_TOKEN_DEADLINE`, when the
 *   operator configured one, for the marker-less access tokens older builds issued; refused
 *   otherwise;
 * - anything else — another family's marker, `null`, `''`, a number, an object — refused, error or
 *   not. "Absent" is tested explicitly (`hasOwnProperty`), never by truthiness.
 */
export function checkAccessTokenPurpose(
  payload: Record<string, unknown>,
  policy: AccessTokenPolicy,
  now: number = Date.now(),
): AccessTokenPurposeCheck {
  if (declaresForeignType(payload) || !hasAccessTokenSubject(payload)) {
    return { ok: false, legacy: false, reason: 'purpose-declared' };
  }

  const declaresPurpose = Object.prototype.hasOwnProperty.call(payload, 'purpose');
  if (declaresPurpose) {
    const purpose = payload.purpose;
    if (typeof purpose !== 'string' || purpose === '') return { ok: false, legacy: false, reason: 'purpose-malformed' };
    if (purpose === ACCESS_TOKEN_PURPOSE) return { ok: true, legacy: false };
    return { ok: false, legacy: false, reason: 'purpose-declared' };
  }
  if (declaresForeignFamily(payload)) return { ok: false, legacy: false, reason: 'purpose-declared' };
  if (policy.legacyDeadline === null || now >= policy.legacyDeadline) {
    return { ok: false, legacy: false, reason: 'legacy-window-closed' };
  }
  return { ok: true, legacy: true };
}

/** A family marker, declared under `purpose` or under the handoff's legacy `type`. */
function declaresForeignFamily(payload: Record<string, unknown>): boolean {
  return FOREIGN_TOKEN_MARKERS.some(
    (marker) => payload.purpose === marker || payload.type === marker,
  );
}

/** Any `type` claim other than `undefined` marks a payload this predicate does not issue. */
function declaresForeignType(payload: Record<string, unknown>): boolean {
  return payload.type !== undefined;
}

export function isAccessTokenPayload(
  payload: Record<string, unknown>,
  policy: AccessTokenPolicy,
  now: number = Date.now(),
): boolean {
  return checkAccessTokenPurpose(payload, policy, now).ok;
}
