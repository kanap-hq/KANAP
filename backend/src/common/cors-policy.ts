import { ForbiddenException } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import * as cors from 'cors';
import {
  CorsPattern,
  RuntimeMode,
  getRuntimeMode,
  isWildcardCorsPattern,
  matchesCorsOrigin,
  parseCorsPatterns,
} from './env';
import { resolveConfiguredAppBaseUrl } from './url';
import { tenantSlugFromHost } from './tenancy/request-tenancy.middleware';
import { Features } from '../config/features';

/**
 * Which browser origins may call the API with cookies. One policy for the CORS middleware
 * (main.ts) and for the cookie-based session routes (`POST /auth/refresh`, `POST /auth/logout`).
 *
 * A request without an `Origin` header is accepted (server-to-server calls, webhooks, scripts).
 * Otherwise the origin is accepted when it is:
 *   a. an exact entry of `CORS_ORIGINS`;
 *   b. the configured address of the application: `APP_BASE_URL` in single-tenant mode, the
 *      configured address of the tenant the request targets in multi-tenant mode (same
 *      derivation as the links, `resolveConfiguredAppBaseUrl`);
 *   c. the address of the request itself (host and port of `Origin` equal to the `Host` header);
 *   d. multi-tenant: a pattern entry of `CORS_ORIGINS` (`https://*.kanap.net`), for the address
 *      of the tenant the request targets only;
 *   e. single-tenant: a pattern entry of `CORS_ORIGINS`, as written (start-up warning);
 *   f. development mode: the entries of `CORS_ORIGINS` as written, and every origin when
 *      `CORS_ORIGINS` is empty.
 * With `CORS_ORIGINS` empty outside development mode, only b and c apply (production mode does
 * not start without it).
 */

export type OriginRule = 'no-origin' | 'open' | 'listed' | 'application' | 'same-origin' | 'tenant-pattern' | 'pattern';

export type OriginDecision = { allowed: true; rule: OriginRule } | { allowed: false };

export type OriginCheck = {
  /** The `Origin` header (or the origin of `Referer`), as received. */
  origin?: string | null;
  /** The `Host` header, as received. */
  host?: string | null;
  /** The tenant the request targets (multi-tenant mode), or null. */
  tenantSlug?: string | null;
};

export type OriginPolicy = {
  mode: RuntimeMode;
  check(request: OriginCheck): OriginDecision;
};

export type OriginPolicyOptions = {
  env?: NodeJS.ProcessEnv;
  singleTenant?: boolean;
};

const TENANT_SLUG_SHAPE = /^[a-z0-9][a-z0-9-]*$/;

function parseOrigin(raw: string): URL | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url;
  } catch {
    return null;
  }
}

/** Host and port of the origin equal to the `Host` header (default port of the origin's scheme omitted). */
function isSameAddressAsHost(origin: URL, host: string | null | undefined): boolean {
  const raw = String(host ?? '').split(',')[0].trim().toLowerCase();
  if (!raw || /[\s/\\@?#]/.test(raw)) return false;
  try {
    return new URL(`${origin.protocol}//${raw}`).host === origin.host;
  } catch {
    return false;
  }
}

/** A pattern entry, for the address of the given tenant only. */
function matchesTenantPattern(origin: URL, patterns: CorsPattern[], tenantSlug: string): boolean {
  const host = origin.hostname.toLowerCase();
  for (const pattern of patterns) {
    if (pattern.protocol !== origin.protocol) continue;
    if (pattern.port !== '*' && pattern.port !== origin.port) continue;
    const patternHost = pattern.host.toLowerCase();
    if (patternHost.startsWith('*.')) {
      if (host === `${tenantSlug}.${patternHost.slice(2)}`) return true;
    } else if (patternHost !== '*') {
      // Exact host with a port pattern: valid when that host is the tenant's address.
      if (host === patternHost && host.startsWith(`${tenantSlug}.`)) return true;
    }
  }
  return false;
}

export function createOriginPolicy(options: OriginPolicyOptions = {}): OriginPolicy {
  const env = options.env ?? process.env;
  const singleTenant = options.singleTenant ?? Features.SINGLE_TENANT;
  const mode = getRuntimeMode(env);
  const patterns = parseCorsPatterns(env);
  const exact = patterns.filter((pattern) => !isWildcardCorsPattern(pattern));
  const wildcards = patterns.filter(isWildcardCorsPattern);
  const openToEveryOrigin = mode === 'development' && patterns.length === 0;

  const applicationOrigin = (tenantSlug: string | null): string | null => {
    if (!singleTenant && !tenantSlug) return null;
    return resolveConfiguredAppBaseUrl(tenantSlug, env, singleTenant);
  };

  return {
    mode,
    check(request: OriginCheck): OriginDecision {
      const raw = String(request.origin ?? '').trim();
      if (!raw) return { allowed: true, rule: 'no-origin' };
      if (openToEveryOrigin) return { allowed: true, rule: 'open' };

      const origin = parseOrigin(raw);
      if (!origin) return { allowed: false };
      if (matchesCorsOrigin(origin.origin, exact)) return { allowed: true, rule: 'listed' };
      if (isSameAddressAsHost(origin, request.host)) return { allowed: true, rule: 'same-origin' };

      const slug = String(request.tenantSlug ?? '').trim().toLowerCase();
      const tenantSlug = slug && TENANT_SLUG_SHAPE.test(slug) ? slug : null;
      if (applicationOrigin(tenantSlug) === origin.origin) return { allowed: true, rule: 'application' };

      if (wildcards.length > 0) {
        if (mode === 'development' || singleTenant) {
          if (matchesCorsOrigin(origin.origin, wildcards)) return { allowed: true, rule: 'pattern' };
        } else if (tenantSlug && matchesTenantPattern(origin, wildcards, tenantSlug)) {
          return { allowed: true, rule: 'tenant-pattern' };
        }
      }
      return { allowed: false };
    },
  };
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

/**
 * The tenant a request targets: the tenant resolved by the tenancy middleware when it already
 * ran, otherwise the same reading of the `Host` header (the CORS middleware runs first).
 */
export function tenantSlugForRequest(req: any, env: NodeJS.ProcessEnv = process.env): string | null {
  const resolved = req?.tenant?.slug;
  if (typeof resolved === 'string' && resolved.trim()) return resolved.trim().toLowerCase();
  const host = headerValue(req?.headers?.host).split(':')[0]?.trim().toLowerCase() ?? '';
  if (!host) return null;
  const platformAdminHost = String(env.PLATFORM_ADMIN_HOST || '').trim().toLowerCase();
  if (platformAdminHost && host === platformAdminHost) return 'platform-admin';
  return tenantSlugFromHost(host);
}

function originOfReferer(referer: string): string | null {
  const value = referer.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

/**
 * Cookie-based session routes apply the origin policy even outside CORS: an `Origin` header
 * that is not allowed, or, without `Origin`, a `Referer` whose origin is not allowed, is
 * refused with 403 before anything else happens. Without either header (a client that is not
 * a browser) nothing changes.
 */
export function assertRequestOriginAllowed(req: any, policy: OriginPolicy = createOriginPolicy()): void {
  const origin = headerValue(req?.headers?.origin).trim();
  const candidate = origin || originOfReferer(headerValue(req?.headers?.referer));
  if (!candidate) return;
  const decision = policy.check({
    origin: candidate,
    host: headerValue(req?.headers?.host),
    tenantSlug: tenantSlugForRequest(req),
  });
  if (!decision.allowed) {
    throw new ForbiddenException({ statusCode: 403, error: 'Forbidden', message: 'Origin not allowed' });
  }
}

const REFUSAL_LOG_WINDOW_MS = 60_000;
const REFUSAL_LOG_MAX_KEYS = 1_000;

/** One log line per refused origin and per minute. */
export function createRefusedOriginLog(
  log: (line: string) => void = (line) => console.warn(line), // eslint-disable-line no-console
  now: () => number = () => Date.now(),
): (origin: string) => void {
  const lastLogged = new Map<string, number>();
  return (origin: string) => {
    const key = origin.slice(0, 200);
    const at = now();
    const previous = lastLogged.get(key);
    if (previous !== undefined && at - previous < REFUSAL_LOG_WINDOW_MS) return;
    if (lastLogged.size >= REFUSAL_LOG_MAX_KEYS) {
      for (const [entry, loggedAt] of lastLogged) {
        if (at - loggedAt >= REFUSAL_LOG_WINDOW_MS) lastLogged.delete(entry);
      }
      if (lastLogged.size >= REFUSAL_LOG_MAX_KEYS) lastLogged.clear();
    }
    lastLogged.set(key, at);
    log(`[CORS] Rejected origin: ${JSON.stringify(key)}`);
  };
}

/**
 * The middlewares main.ts mounts: a refused origin gets a short 403 without any
 * `Access-Control-Allow-*` header; an allowed one gets the usual CORS answer with credentials.
 */
export function createCorsMiddlewares(
  policy: OriginPolicy,
  options: { logRefusal?: (origin: string) => void; env?: NodeJS.ProcessEnv } = {},
): RequestHandler[] {
  const logRefusal = options.logRefusal ?? createRefusedOriginLog();
  const env = options.env ?? process.env;
  const guard: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    const origin = headerValue(req.headers.origin);
    const decision = policy.check({
      origin,
      host: headerValue(req.headers.host),
      tenantSlug: tenantSlugForRequest(req, env),
    });
    if (decision.allowed) {
      next();
      return;
    }
    logRefusal(origin);
    res.status(403).json({ statusCode: 403, error: 'Forbidden', message: 'Origin not allowed' });
  };
  return [guard, cors({ origin: true, credentials: true })];
}
