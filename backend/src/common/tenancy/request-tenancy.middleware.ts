import { NextFunction, Request, Response } from 'express';
import { BUSY_RETRY_AFTER_SECONDS } from '../filters/database-error.mapping';

/**
 * The tenancy middleware main.ts mounts before every route: it reads the
 * tenant from the Host header (or the single-tenant slug) and attaches
 * `req.tenant` ({ id, slug, name }, or null for apex / marketing hosts).
 *
 * - Unknown tenant slug: 404 TENANT_NOT_FOUND with the marketing URL.
 * - Single-tenant tenant not provisioned yet: 503 TENANT_NOT_READY.
 * - Platform-admin host without its tenant: 503 PLATFORM_ADMIN_TENANT_MISSING.
 * - The tenant lookup itself fails (pool exhausted, database down or slow):
 *   503 `busy` with Retry-After. Going on without a tenant would answer later
 *   with fake 401s and "Tenant context is required", and a 401 sends the
 *   browser into a token refresh, even a logout.
 * - The liveness route (`/health`) reads nothing and needs no tenant: it is not
 *   looked up at all and goes on with `req.tenant = null`, so it costs no
 *   connection and still answers that the process is alive when the pool is
 *   exhausted (a monitor or an orchestrator does not restart a busy API), or
 *   before the single tenant is provisioned. Same for the ops metrics of a
 *   monitoring tool (`/ops/metrics`).
 * - A tenant being reset to its starting state (`metadata.demo.status` is
 *   `resetting`, demo-data.service.ts): its write requests get 409
 *   `tenant_resetting`, so nothing written during the reset survives it. Reads
 *   go on, as do the token refresh and the sign-out, which only touch the
 *   sessions the reset keeps (a refused refresh would sign the user out).
 */
export type TenantLookupRow = { id: string; slug: string; name: string; demo_status?: string | null };

export type RequestTenancyOptions = {
  /** Runs one read query (the DataSource's `query`). */
  query: (sql: string, params: unknown[]) => Promise<TenantLookupRow[]>;
  singleTenant: boolean;
  defaultTenantSlug: string;
  platformAdminHost: string;
  marketingRedirectUrl: string;
};

const TENANT_BY_SLUG = `SELECT id, slug, name, metadata->'demo'->>'status' AS demo_status
  FROM tenants WHERE slug = $1 AND deleted_at IS NULL LIMIT 1`;

/** The code of the 409 a write request of a tenant being reset gets. */
export const TENANT_RESETTING_CODE = 'tenant_resetting';

/** Methods that write nothing: served while the tenant is being reset. */
const READ_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Writes allowed during a reset: the session routes, which touch only the sessions it keeps. */
const SESSION_PATHS = new Set(['/auth/refresh', '/api/auth/refresh', '/auth/logout', '/api/auth/logout']);

/** Whether a request of a tenant whose sample data status is `demoStatus` is refused. */
export function refusedWhileResetting(req: Request, demoStatus: string | null | undefined): boolean {
  if (demoStatus !== 'resetting') return false;
  if (READ_METHODS.has(String(req.method || 'GET').toUpperCase())) return false;
  return !SESSION_PATHS.has(routePath(req));
}

/**
 * Routes that need no tenant and are never looked up: the liveness route, and the ops metrics of
 * a monitoring tool (token-protected, admin/ops/ops-metrics.controller.ts), which must answer
 * when the pool is saturated.
 */
const LIVENESS_PATHS = new Set(['/health', '/api/health', '/ops/metrics', '/api/ops/metrics']);

/** The request path without a trailing slash (`/health/` is `/health`). */
function routePath(req: Request): string {
  return (req.path || '/').replace(/\/+$/, '') || '/';
}

/** The tenant subdomain of a host, or null for apex, www and unknown hosts. */
export function tenantSlugFromHost(host: string): string | null {
  const h = host;
  if (!h) return null;
  // Dev: *.lvh.me
  if (h.endsWith('.lvh.me')) {
    const sub = h.replace('.lvh.me', '');
    if (sub === 'www' || sub === 'lvh') return null;
    return sub;
  }
  // Dev (local via tunnel): *.dev.kanap.net (apex dev.kanap.net)
  if (h.endsWith('.dev.kanap.net')) {
    const sub = h.replace('.dev.kanap.net', '');
    if (!sub || sub === 'www') return null;
    return sub;
  }
  if (h === 'dev.kanap.net') return null;
  // QA: *.qa.kanap.net (apex qa.kanap.net)
  if (h.endsWith('.qa.kanap.net')) {
    const sub = h.replace('.qa.kanap.net', '');
    if (!sub || sub === 'www') return null;
    return sub;
  }
  if (h === 'qa.kanap.net') return null;
  // Prod: *.kanap.net (apex kanap.net/www)
  if (h.endsWith('.kanap.net')) {
    const sub = h.replace('.kanap.net', '');
    if (!sub || sub === 'www') return null;
    return sub;
  }
  return null;
}

/** The 503 `busy` answer to a request whose tenant could not be looked up. */
export function answerTenantLookupFailed(req: Request, res: Response, error: unknown) {
  // eslint-disable-next-line no-console
  console.error(`[tenancy] ${req.method} ${req.originalUrl ?? req.url}: tenant lookup failed, answered 503 busy:`, (error as Error)?.message ?? error);
  if (res.headersSent) return;
  res.setHeader('Retry-After', String(BUSY_RETRY_AFTER_SECONDS));
  res.status(503).json({
    statusCode: 503,
    error: 'Service Unavailable',
    code: 'busy',
    message: 'The server is busy. Please try again in a few seconds.',
  });
}

export function createRequestTenancyMiddleware(options: RequestTenancyOptions) {
  const platformAdminHost = options.platformAdminHost.toLowerCase();
  return async (req: Request, res: Response, next: NextFunction) => {
    if (LIVENESS_PATHS.has(routePath(req))) {
      (req as any).tenant = null;
      next();
      return;
    }
    let rows: TenantLookupRow[];
    let found: TenantLookupRow | null = null;
    try {
      // Single-tenant mode: skip all Host parsing, resolve tenant by slug
      if (options.singleTenant) {
        rows = await options.query(TENANT_BY_SLUG, [options.defaultTenantSlug]);
        if (!rows?.[0]) {
          res.status(503).json({ error: 'TENANT_NOT_READY', message: 'Single-tenant provisioning in progress. Retry shortly.' });
          return;
        }
        (req as any).tenant = { id: rows[0].id, slug: rows[0].slug, name: rows[0].name };
        found = rows[0];
      } else {
        const rawHost = req.headers.host || '';
        const host = rawHost.split(':')[0]?.toLowerCase() ?? '';

        if (platformAdminHost && host === platformAdminHost) {
          rows = await options.query(TENANT_BY_SLUG, ['platform-admin']);
          if (!rows?.[0]) {
            res.status(503).json({ error: 'PLATFORM_ADMIN_TENANT_MISSING' });
            return;
          }
          (req as any).isPlatformHost = true;
          (req as any).tenant = { id: rows[0].id, slug: rows[0].slug, name: rows[0].name };
          found = rows[0];
        } else {
          // Apex hosts are marketing/public (no tenant)
          const slug = tenantSlugFromHost(host);
          if (!slug) {
            (req as any).tenant = null;
          } else {
            rows = await options.query(TENANT_BY_SLUG, [slug]);
            if (!rows?.[0]) {
              res.status(404).json({ error: 'TENANT_NOT_FOUND', marketingUrl: options.marketingRedirectUrl });
              return;
            }
            (req as any).tenant = { slug, id: rows[0].id, name: rows[0].name };
            found = rows[0];
          }
        }
      }
    } catch (error) {
      answerTenantLookupFailed(req, res, error);
      return;
    }
    if (found && refusedWhileResetting(req, found.demo_status)) {
      res.status(409).json({
        statusCode: 409,
        error: 'Conflict',
        code: TENANT_RESETTING_CODE,
        message: 'This workspace is being reset to its starting state. Try again in a moment.',
      });
      return;
    }
    // Outside the try: an error further down the chain is not a tenant lookup failure.
    next();
  };
}
