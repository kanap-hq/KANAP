import { createHash, timingSafeEqual } from 'crypto';
import { isSecureRequest } from '../../auth/auth-cookie.util';

/**
 * MCP OAuth: addresses, resource indicators (RFC 8707), redirect matching and PKCE (RFC 7636).
 * Spec: planning/mcp-oauth.md. The authorization server and the protected resource are the
 * tenant's own address: `https://<slug>.kanap.net` is the issuer, `<issuer>/api/ai/mcp` the resource.
 */

/** The path the API is served under behind every proxy of this repository (infra/nginx, frontend/nginx). */
export const PUBLIC_API_PREFIX = '/api';
export const MCP_RESOURCE_PATH = `${PUBLIC_API_PREFIX}/ai/mcp`;
export const MCP_OAUTH_SCOPE = 'mcp:read';
export const MCP_OAUTH_SCOPES_SUPPORTED = [MCP_OAUTH_SCOPE] as const;

export const AUTHORIZATION_CODE_TTL_SECONDS = 60;
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_DAYS = 90;

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/**
 * The tenant's address as the client reached it: scheme from `isSecureRequest` (always https in
 * production), host from the `Host` header the tenancy middleware resolved the tenant from,
 * lowercased, default port left out.
 */
export function requestOrigin(req: any): string | null {
  const scheme = isSecureRequest(req) ? 'https' : 'http';
  const host = headerValue(req?.headers?.host).trim().toLowerCase();
  if (!host || /[\s/\\?#@]/.test(host)) return null;
  let url: URL;
  try {
    url = new URL(`${scheme}://${host}`);
  } catch {
    return null;
  }
  return url.origin;
}

export function mcpResourceUrl(origin: string): string {
  return `${origin}${MCP_RESOURCE_PATH}`;
}

export function protectedResourceMetadataUrl(origin: string): string {
  return `${origin}/.well-known/oauth-protected-resource${MCP_RESOURCE_PATH}`;
}

/**
 * Canonical form of a resource indicator: lowercase scheme and host, no default port, no
 * trailing slash, no query or fragment. Null for anything that is not an absolute http(s) URL.
 */
export function canonicalResource(value: unknown): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.origin}${path}`;
}

/** The resource the client named is this tenant's MCP endpoint (a trailing slash is tolerated). */
export function isThisMcpResource(value: unknown, origin: string): boolean {
  return canonicalResource(value) === mcpResourceUrl(origin);
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export function isLoopbackRedirect(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === 'http:' && LOOPBACK_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Whether a registered redirect URI accepts a requested one. Exact string match, except for
 * loopback redirects (RFC 8252 §7.3): `http://localhost/callback` and `http://127.0.0.1/callback`
 * accept any port, as Claude Code listens on an ephemeral one. Scheme, host, path and query must
 * still match exactly.
 */
export function redirectUriMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  if (!isLoopbackRedirect(registered) || !isLoopbackRedirect(requested)) return false;
  const a = new URL(registered);
  const b = new URL(requested);
  return a.hostname === b.hostname
    && a.pathname === b.pathname
    && a.search === b.search
    && a.hash === '' && b.hash === ''
    && a.username === '' && b.username === '' && a.password === '' && b.password === '';
}

/** A redirect URI a client may register: https, or plain http on a loopback host. No fragment. */
export function isAcceptableRedirectUri(uri: unknown): uri is string {
  if (typeof uri !== 'string' || uri.length === 0 || uri.length > 2000) return false;
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  if (url.protocol === 'https:') return true;
  return isLoopbackRedirect(uri);
}

export function redirectHost(uri: string): string {
  try {
    return new URL(uri).hostname;
  } catch {
    return '';
  }
}

/** `code_challenge` and `code_verifier` share the PKCE alphabet; the challenge of S256 is 43 chars. */
const PKCE_VERIFIER = /^[A-Za-z0-9\-._~]{43,128}$/;
const PKCE_S256_CHALLENGE = /^[A-Za-z0-9\-_]{43}$/;

export function isValidS256Challenge(value: unknown): value is string {
  return typeof value === 'string' && PKCE_S256_CHALLENGE.test(value);
}

export function s256Challenge(verifier: string): string {
  return createHash('sha256').update(verifier, 'ascii').digest('base64url');
}

export function pkceVerifierMatches(verifier: unknown, challenge: string): boolean {
  if (typeof verifier !== 'string' || !PKCE_VERIFIER.test(verifier)) return false;
  const computed = Buffer.from(s256Challenge(verifier), 'utf8');
  const expected = Buffer.from(challenge, 'utf8');
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

/** `scope` of an authorization request: empty means `mcp:read`; anything else must be `mcp:read`. */
export function normalizeScope(value: unknown): string | null {
  if (value === undefined || value === null || value === '') return MCP_OAUTH_SCOPE;
  if (typeof value !== 'string') return null;
  const scopes = value.split(' ').filter(Boolean);
  if (scopes.length === 0) return MCP_OAUTH_SCOPE;
  return scopes.every((scope) => scope === MCP_OAUTH_SCOPE) ? MCP_OAUTH_SCOPE : null;
}

/** Append OAuth response parameters to a validated redirect URI, keeping its own query. */
export function redirectWithParams(redirectUri: string, params: Record<string, string | null | undefined>): string {
  const url = new URL(redirectUri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  }
  return url.toString();
}

/**
 * The tenant address of a request: the tenant the tenancy middleware resolved from the host, and
 * the origin the client used. Null without a tenant, on the platform-admin host, or without a
 * readable host.
 */
export function oauthHostOf(req: any): { tenantId: string; origin: string; isPlatformHost: boolean; requestId: string | null } | null {
  const tenantId = typeof req?.tenant?.id === 'string' ? req.tenant.id : '';
  if (!tenantId || req?.isPlatformHost === true) return null;
  const origin = requestOrigin(req);
  if (!origin) return null;
  return { tenantId, origin, isPlatformHost: false, requestId: req?.id ?? null };
}

/** The `WWW-Authenticate` challenge of the MCP endpoint (RFC 6750 §3, RFC 9728 §5.1). */
export function mcpBearerChallenge(origin: string | null, error?: 'invalid_token'): string {
  const parts: string[] = [];
  if (error) parts.push(`error="${error}"`);
  if (origin) parts.push(`resource_metadata="${protectedResourceMetadataUrl(origin)}"`);
  parts.push(`scope="${MCP_OAUTH_SCOPE}"`);
  return `Bearer ${parts.join(', ')}`;
}
