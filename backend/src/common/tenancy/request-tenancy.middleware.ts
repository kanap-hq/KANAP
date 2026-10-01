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
 *   browser into a token refresh, even a logout. Except the liveness route
 *   (`/health`), which reads nothing: it goes on without a tenant and still
 *   answers that the process is alive, so a monitor or an orchestrator does
 *   not restart a busy API (in single-tenant mode every request looks the
 *   tenant up, the health check included).
 */
export type RequestTenancyOptions = {
  /** Runs one read query (the DataSource's `query`). */
  query: (sql: string, params: unknown[]) => Promise<Array<{ id: string; slug: string; name: string }>>;
  singleTenant: boolean;
  defaultTenantSlug: string;
  platformAdminHost: string;
  marketingRedirectUrl: string;
};

const TENANT_BY_SLUG = 'SELECT id, slug, name FROM tenants WHERE slug = $1 AND deleted_at IS NULL LIMIT 1';

/** Liveness routes: no tenant needed, never refused because the database is busy. */
const LIVENESS_PATHS = new Set(['/health', '/api/health']);

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
    let rows: Array<{ id: string; slug: string; name: string }>;
    try {
      // Single-tenant mode: skip all Host parsing, resolve tenant by slug
      if (options.singleTenant) {
        rows = await options.query(TENANT_BY_SLUG, [options.defaultTenantSlug]);
        if (!rows?.[0]) {
          res.status(503).json({ error: 'TENANT_NOT_READY', message: 'Single-tenant provisioning in progress. Retry shortly.' });
          return;
        }
        (req as any).tenant = { id: rows[0].id, slug: rows[0].slug, name: rows[0].name };
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
          }
        }
      }
    } catch (error) {
      if (LIVENESS_PATHS.has(req.path)) {
        (req as any).tenant = null;
        next();
        return;
      }
      answerTenantLookupFailed(req, res, error);
      return;
    }
    // Outside the try: an error further down the chain is not a tenant lookup failure.
    next();
  };
}
