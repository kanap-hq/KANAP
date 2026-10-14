import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from 'crypto';
import * as jwt from 'jsonwebtoken';
import { MCP_ACCESS_PURPOSE, MCP_OAUTH_CODE_PURPOSE } from '../../auth/access-token.util';
import { ISSUED_TOKEN_ALGORITHM, ISSUED_TOKEN_ALGORITHMS } from '../../auth/jwt-algorithms';
import { getMcpAccessTokenSecret, getMcpOAuthCodeSecret } from '../../auth/token-secret.util';
import { ACCESS_TOKEN_TTL_SECONDS, AUTHORIZATION_CODE_TTL_SECONDS, canonicalResource } from './mcp-oauth.util';

/**
 * The three credentials of an MCP OAuth grant:
 *
 * - the authorization code: a JWT of the `mcp-oauth-code` family, 60 s, never stored; single use
 *   comes from the unique `oauth_code_jti` of the grant the first exchange creates;
 * - the access token: a JWT of the `mcp-access` family, 15 min, never stored; the MCP guard also
 *   reads the grant row on every request, so a revocation takes effect at once;
 * - the refresh token: `kanap_mcprt_<prefix>_<nonce>_<mac>`, hashed into the grant's `key_hash`
 *   and replaced on every use. The prefix names the grant and stays the same across rotations;
 *   the MAC proves the token was issued here, so a token that is genuine but no longer the current
 *   one is a replay (the grant is revoked), while a forged one is merely refused. The successor of
 *   a token is derived from it (`successorRefreshToken`): a client whose refresh answer was lost,
 *   or that refreshed twice at once, presents the same token again and gets the same successor.
 *
 * Both JWT families have their own signing key (auth/token-secret.util.ts), distinct from the
 * session key: a session token never verifies as an MCP token, and the reverse.
 */

export type McpOAuthCodeClaims = {
  purpose: typeof MCP_OAUTH_CODE_PURPOSE;
  sub: string;
  tenant_id: string;
  iss: string;
  client_id: string;
  client_name: string;
  redirect_uri: string;
  code_challenge: string;
  resource: string;
  scope: string;
  remember: boolean;
  jti: string;
};

export type McpAccessClaims = {
  purpose: typeof MCP_ACCESS_PURPOSE;
  sub: string;
  tenant_id: string;
  iss: string;
  aud: string;
  grant: string;
  scope: string;
  jti: string;
};

export function signAuthorizationCode(claims: Omit<McpOAuthCodeClaims, 'purpose' | 'jti'>): { code: string; jti: string } {
  const jti = randomUUID();
  const code = jwt.sign({ ...claims, purpose: MCP_OAUTH_CODE_PURPOSE, jti }, getMcpOAuthCodeSecret(), {
    algorithm: ISSUED_TOKEN_ALGORITHM,
    expiresIn: AUTHORIZATION_CODE_TTL_SECONDS,
  });
  return { code, jti };
}

/** The code's claims, or null when it is not a valid, unexpired code of this family. */
export function verifyAuthorizationCode(code: unknown): McpOAuthCodeClaims | null {
  if (typeof code !== 'string' || code.length === 0 || code.length > 4096) return null;
  try {
    const payload = jwt.verify(code, getMcpOAuthCodeSecret(), { algorithms: [...ISSUED_TOKEN_ALGORITHMS] });
    if (!payload || typeof payload === 'string') return null;
    const claims = payload as Record<string, unknown>;
    if (claims.purpose !== MCP_OAUTH_CODE_PURPOSE) return null;
    for (const key of ['sub', 'tenant_id', 'iss', 'client_id', 'redirect_uri', 'code_challenge', 'resource', 'scope', 'jti']) {
      if (typeof claims[key] !== 'string' || claims[key] === '') return null;
    }
    return claims as unknown as McpOAuthCodeClaims;
  } catch {
    return null;
  }
}

export function signAccessToken(claims: Omit<McpAccessClaims, 'purpose' | 'jti'>): string {
  return jwt.sign({ ...claims, purpose: MCP_ACCESS_PURPOSE, jti: randomUUID() }, getMcpAccessTokenSecret(), {
    algorithm: ISSUED_TOKEN_ALGORITHM,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

/**
 * The access token's claims when it is a valid `mcp-access` token issued by `issuer` for
 * `resource` (compared in canonical form, so a trailing slash on either side is tolerated).
 */
export function verifyAccessToken(token: string, expected: { issuer: string; resource: string }): McpAccessClaims | null {
  try {
    const payload = jwt.verify(token, getMcpAccessTokenSecret(), { algorithms: [...ISSUED_TOKEN_ALGORITHMS] });
    if (!payload || typeof payload === 'string') return null;
    const claims = payload as Record<string, unknown>;
    if (claims.purpose !== MCP_ACCESS_PURPOSE) return null;
    if (claims.iss !== expected.issuer) return null;
    if (canonicalResource(claims.aud) === null || canonicalResource(claims.aud) !== canonicalResource(expected.resource)) return null;
    for (const key of ['sub', 'tenant_id', 'grant', 'scope']) {
      if (typeof claims[key] !== 'string' || claims[key] === '') return null;
    }
    return claims as unknown as McpAccessClaims;
  } catch {
    return null;
  }
}

export function looksLikeJwt(value: string): boolean {
  return /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value);
}

const REFRESH_TOKEN_PREFIX = 'kanap_mcprt';
const REFRESH_TOKEN_SHAPE = /^kanap_mcprt_([a-f0-9]{12})_([A-Za-z0-9_-]{32})_([A-Za-z0-9_-]{43})$/;

/** The refresh token MAC key, separated from the code-signing key by its own label. */
function refreshMacKey(): Buffer {
  return createHmac('sha256', getMcpOAuthCodeSecret()).update('kanap:v1:mcp-refresh-token-mac', 'utf8').digest();
}

function refreshMac(tenantId: string, grantPrefix: string, nonce: string): string {
  return createHmac('sha256', refreshMacKey())
    .update(`${tenantId}\n${grantPrefix}\n${nonce}`, 'utf8')
    .digest('base64url');
}

export function newGrantPrefix(): string {
  return randomBytes(6).toString('hex');
}

function refreshTokenWithNonce(tenantId: string, grantPrefix: string, nonce: string): { token: string; hash: string } {
  const token = `${REFRESH_TOKEN_PREFIX}_${grantPrefix}_${nonce}_${refreshMac(tenantId, grantPrefix, nonce)}`;
  return { token, hash: hashRefreshToken(token) };
}

/** The first refresh token of a grant. */
export function issueRefreshToken(tenantId: string, grantPrefix: string): { token: string; hash: string } {
  return refreshTokenWithNonce(tenantId, grantPrefix, randomBytes(24).toString('base64url'));
}

/** The token that replaces `previous`: always the same one, and only this server can compute it. */
export function successorRefreshToken(tenantId: string, grantPrefix: string, previous: string): { token: string; hash: string } {
  const nonce = createHmac('sha256', refreshMacKey())
    .update(`successor\n${tenantId}\n${previous}`, 'utf8')
    .digest('base64url')
    .slice(0, 32);
  return refreshTokenWithNonce(tenantId, grantPrefix, nonce);
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** The grant prefix of a well-formed refresh token, and whether this server issued it for the tenant. */
export function parseRefreshToken(token: unknown, tenantId: string): { prefix: string; genuine: boolean } | null {
  if (typeof token !== 'string') return null;
  const match = token.match(REFRESH_TOKEN_SHAPE);
  if (!match) return null;
  const [, prefix, nonce, mac] = match;
  const expected = Buffer.from(refreshMac(tenantId, prefix, nonce), 'utf8');
  const presented = Buffer.from(mac, 'utf8');
  const genuine = expected.length === presented.length && timingSafeEqual(expected, presented);
  return { prefix, genuine };
}

export function refreshTokenMatchesHash(token: string, storedHash: string | null | undefined): boolean {
  if (!storedHash) return false;
  const computed = Buffer.from(hashRefreshToken(token), 'hex');
  const stored = Buffer.from(storedHash, 'hex');
  return computed.length === stored.length && timingSafeEqual(computed, stored);
}
