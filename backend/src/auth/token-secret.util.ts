import { createHmac } from 'crypto';
import { requireJwtSecret } from '../common/env';

/**
 * Per-family signing keys.
 *
 * Every token family (access, password reset, provisioning, SSO state) used to fall back to
 * `JWT_SECRET` when its own variable was unset, so a single key signed and verified all four
 * families. Each family now has a key of its own and a verified `purpose` claim.
 *
 * Most families now derive their own key from `JWT_SECRET` through HMAC with a stable, versioned
 * label: rotating a label version rotates that family's key material without touching
 * `JWT_SECRET`. A configured dedicated key is the ONLY key used for its family — no fallback
 * attempt with another key after a failure.
 *
 * Provisioning is the exception, deliberately: its tokens are minted by a service outside this
 * repository, so the default stays `JWT_SECRET` and the marker stays `provision` until that issuer
 * is redeployed. Its dedicated variable takes effect as soon as it is set (lockstep).
 */

export const TOKEN_SECRET_LABEL_PREFIX = 'kanap:v1:';

/** Families whose key is derived from `JWT_SECRET` when they have no dedicated variable. */
export const TOKEN_SECRET_LABEL = {
  'password-reset': `${TOKEN_SECRET_LABEL_PREFIX}password-reset`,
  'entra-state': `${TOKEN_SECRET_LABEL_PREFIX}entra-state`,
  'mcp-oauth-code': `${TOKEN_SECRET_LABEL_PREFIX}mcp-oauth-code`,
  'mcp-access': `${TOKEN_SECRET_LABEL_PREFIX}mcp-access`,
  creation: `${TOKEN_SECRET_LABEL_PREFIX}creation`,
} as const;

export type DerivedTokenFamily = keyof typeof TOKEN_SECRET_LABEL;
export type TokenFamily = DerivedTokenFamily | 'provisioning';

/** Environment variable holding a family's dedicated key, when the operator sets one. */
export const TOKEN_FAMILY_ENV: Record<TokenFamily, string> = {
  'password-reset': 'PASSWORD_RESET_SECRET',
  provisioning: 'PROVISIONING_TOKEN_SECRET',
  'entra-state': 'ENTRA_STATE_SECRET',
  'mcp-oauth-code': 'MCP_OAUTH_CODE_SECRET',
  'mcp-access': 'MCP_ACCESS_TOKEN_SECRET',
  creation: 'CREATION_TOKEN_SECRET',
};

export type TokenSecretSource = 'dedicated-key' | 'derived-key' | 'jwt-secret';

export const TOKEN_FAMILIES: TokenFamily[] = ['password-reset', 'provisioning', 'entra-state', 'mcp-oauth-code', 'mcp-access', 'creation'];

/**
 * Derive a family key from `JWT_SECRET` with a distinct, stable HMAC label (RFC 2104 PRF).
 * Same base secret + same label ⇒ same key on every instance and environment.
 */
export function deriveSecret(jwtSecret: string, family: DerivedTokenFamily): string {
  if (!jwtSecret || jwtSecret.trim() === '') {
    throw new Error('FATAL: cannot derive a token family key without JWT_SECRET');
  }
  return createHmac('sha256', jwtSecret)
    .update(TOKEN_SECRET_LABEL[family], 'utf8')
    .digest('hex');
}

export type ResolvedFamilySecret = { secret: string; source: TokenSecretSource; envVar: string };

export function resolveFamilySecret(
  family: TokenFamily,
  env: NodeJS.ProcessEnv = process.env,
): ResolvedFamilySecret {
  const envVar = TOKEN_FAMILY_ENV[family];
  const dedicated = (env[envVar] || '').trim();
  if (dedicated !== '') {
    return { secret: dedicated, source: 'dedicated-key', envVar };
  }
  // The provisioning issuer lives outside this repository and cannot compute a derived key.
  if (family === 'provisioning') {
    return { secret: requireJwtSecret(env), source: 'jwt-secret', envVar };
  }
  return { secret: deriveSecret(requireJwtSecret(env), family), source: 'derived-key', envVar };
}

/** Password-reset link signing key. */
export function getPasswordResetSecret(env: NodeJS.ProcessEnv = process.env): string {
  return resolveFamilySecret('password-reset', env).secret;
}

/**
 * Provisioning exchange token signing key: `PROVISIONING_TOKEN_SECRET` when configured, otherwise
 * `JWT_SECRET`, which is what the external issuer signs with today.
 */
export function getProvisioningSecret(env: NodeJS.ProcessEnv = process.env): string {
  return resolveFamilySecret('provisioning', env).secret;
}

/** Entra SSO state / login handoff signing key. */
export function getEntraStateSecret(env: NodeJS.ProcessEnv = process.env): string {
  return resolveFamilySecret('entra-state', env).secret;
}

/** MCP OAuth authorization code signing key (ai/oauth). */
export function getMcpOAuthCodeSecret(env: NodeJS.ProcessEnv = process.env): string {
  return resolveFamilySecret('mcp-oauth-code', env).secret;
}

/** MCP OAuth access token signing key (ai/oauth): verified only by the MCP guard. */
export function getMcpAccessTokenSecret(env: NodeJS.ProcessEnv = process.env): string {
  return resolveFamilySecret('mcp-access', env).secret;
}

/** Signing key of the token that lets a record's creator cancel its creation (common/creation). */
export function getCreationTokenSecret(env: NodeJS.ProcessEnv = process.env): string {
  return resolveFamilySecret('creation', env).secret;
}

export type TokenSecretPolicyEntry = {
  family: TokenFamily;
  envVar: string;
  source: TokenSecretSource;
};

/**
 * Effective key policy, for the start-up line. Reads no secret value: only where each family
 * key comes from, so it is safe to log.
 */
export function describeSecretPolicy(env: NodeJS.ProcessEnv = process.env): TokenSecretPolicyEntry[] {
  return TOKEN_FAMILIES.map((family) => {
    const { source, envVar } = resolveFamilySecret(family, env);
    return { family, envVar, source };
  });
}
