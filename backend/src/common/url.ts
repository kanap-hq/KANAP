import { BadRequestException } from '@nestjs/common';
import { isDevelopmentEnv } from './env';
import { Features } from '../config/features';

/** The answer of a feature that needs an application link when no address is configured. */
export const APP_URL_NOT_CONFIGURED_MESSAGE = 'application URL is not configured: set APP_BASE_URL';

function normalizeProto(raw: string | undefined): 'http' | 'https' {
  const base = String(raw || '')
    .split(',')[0]
    .trim()
    .replace(':', '')
    .toLowerCase();
  return base === 'https' ? 'https' : 'http';
}

function sanitizeHost(raw: string | undefined): string {
  const base = String(raw || '').split(',')[0].trim();
  if (!base) return '';
  const withoutScheme = base.replace(/^https?:\/\//i, '');
  const hostAndPort = withoutScheme.split('/')[0];
  // Keep existing behavior: ignore explicit ports for host-based tenant derivation.
  if (hostAndPort.startsWith('[')) {
    const end = hostAndPort.indexOf(']');
    return (end >= 0 ? hostAndPort.slice(0, end + 1) : hostAndPort).toLowerCase();
  }
  const colon = hostAndPort.indexOf(':');
  const hostOnly = colon >= 0 ? hostAndPort.slice(0, colon) : hostAndPort;
  return hostOnly.toLowerCase();
}

function getRequestHost(req: any): string {
  return sanitizeHost(
    (req?.headers?.['x-forwarded-host'] as string | undefined)
      ?? (req?.headers?.host as string | undefined),
  );
}

function getRequestProto(req: any): 'http' | 'https' {
  return normalizeProto(
    (req?.headers?.['x-forwarded-proto'] as string | undefined)
      ?? (req?.protocol as string | undefined)
      ?? 'http',
  );
}

/**
 * Hosts of the local development set-ups: lvh.me and its subdomains, localhost and
 * `*.localhost`, dev.kanap.net and its subdomains.
 */
export function isLocalDevelopmentHost(host: string): boolean {
  const h = sanitizeHost(host);
  if (!h) return false;
  return h === 'lvh.me' || h.endsWith('.lvh.me')
    || h === 'localhost' || h.endsWith('.localhost')
    || h === 'dev.kanap.net' || h.endsWith('.dev.kanap.net');
}

/**
 * The request host when links may follow it: in development mode only, and only for a local
 * development host. Everywhere else links come from the configuration.
 */
function developmentRequestHost(req: any): string | null {
  if (!isDevelopmentEnv()) return null;
  const host = getRequestHost(req);
  return host && isLocalDevelopmentHost(host) ? host : null;
}

/** A request host: reused when it already is this tenant's host, otherwise the domain rules. */
function resolveTenantOriginFromHost(host: string, tenantSlug: string, proto: 'http' | 'https'): string | null {
  const normalizedHost = sanitizeHost(host);
  if (!normalizedHost) return null;

  // If the host is already a tenant host for this slug, reuse it.
  if (normalizedHost.startsWith(`${tenantSlug.toLowerCase()}.`)) {
    return `${proto}://${normalizedHost}`;
  }
  return tenantOriginFromDomain(normalizedHost, tenantSlug, proto);
}

/** The tenant's address on the domain of a host (lvh.me, dev/qa.kanap.net, kanap.net, `app.<domain>`). */
function tenantOriginFromDomain(host: string, tenantSlug: string, proto: 'http' | 'https'): string | null {
  const normalizedHost = sanitizeHost(host);
  if (!normalizedHost) return null;
  const slug = tenantSlug.toLowerCase();

  // Dev: lvh.me wildcard
  if (normalizedHost === 'lvh.me' || normalizedHost === 'www.lvh.me' || normalizedHost.endsWith('.lvh.me')) {
    return `${proto}://${slug}.lvh.me`;
  }

  // Dev (local via tunnel): *.dev.kanap.net (apex dev.kanap.net)
  if (
    normalizedHost === 'dev.kanap.net'
    || normalizedHost === 'www.dev.kanap.net'
    || normalizedHost.endsWith('.dev.kanap.net')
  ) {
    return `${proto}://${slug}.dev.kanap.net`;
  }

  // QA: *.qa.kanap.net (apex qa.kanap.net)
  if (
    normalizedHost === 'qa.kanap.net'
    || normalizedHost === 'www.qa.kanap.net'
    || normalizedHost.endsWith('.qa.kanap.net')
  ) {
    return `${proto}://${slug}.qa.kanap.net`;
  }

  // Prod: *.kanap.net (apex kanap.net/www)
  if (
    normalizedHost === 'kanap.net'
    || normalizedHost === 'www.kanap.net'
    || normalizedHost.endsWith('.kanap.net')
  ) {
    return `${proto}://${slug}.kanap.net`;
  }

  // Generic app-subdomain pattern for on-prem/custom domains.
  if (normalizedHost.startsWith('app.')) {
    return `${proto}://${slug}.${normalizedHost.slice(4)}`;
  }

  return null;
}

function parseConfiguredUrl(raw: string | undefined): URL | null {
  const value = String(raw || '').trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/**
 * A configured address turned into the tenant's address, keeping its scheme and port. Only the
 * domain rules apply: `https://kanap.net` gives `https://kanap.kanap.net` for the tenant `kanap`.
 */
function tenantOriginFromConfiguredUrl(url: URL, tenantSlug: string): string | null {
  const proto = url.protocol === 'https:' ? 'https' : 'http';
  const derived = tenantOriginFromDomain(url.hostname, tenantSlug, proto);
  if (!derived) return null;
  return url.port ? `${derived}:${url.port}` : derived;
}

const TENANT_SLUG_SHAPE = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The base URL of the application for the links the API builds (emails, sign-in redirects,
 * exports), read from the configuration only. Priority:
 *
 * - single-tenant: `APP_BASE_URL`, then `PUBLIC_APP_URL`;
 * - multi-tenant, for a tenant: the first of `APP_BASE_URL`, `PUBLIC_APP_URL`, `APP_URL` whose
 *   host is on a known tenant domain (lvh.me, dev.kanap.net, qa.kanap.net, kanap.net, or a host
 *   starting with `app.`), turned into the tenant's address `<slug>.<domain>` (scheme and port
 *   kept); when none is, the first of them as configured;
 * - multi-tenant without a tenant: the first of `APP_BASE_URL`, `PUBLIC_APP_URL`, `APP_URL`.
 *
 * Returns the origin (no trailing slash), or null when nothing is configured.
 */
export function resolveConfiguredAppBaseUrl(
  tenantSlug?: string | null,
  env: NodeJS.ProcessEnv = process.env,
  singleTenant: boolean = Features.SINGLE_TENANT,
): string | null {
  const names = singleTenant ? ['APP_BASE_URL', 'PUBLIC_APP_URL'] : ['APP_BASE_URL', 'PUBLIC_APP_URL', 'APP_URL'];
  const configured = names
    .map((name) => parseConfiguredUrl(env[name]))
    .filter((url): url is URL => url !== null);
  if (configured.length === 0) return null;
  if (singleTenant) return configured[0].origin;

  const slug = String(tenantSlug ?? '').trim().toLowerCase();
  if (slug && TENANT_SLUG_SHAPE.test(slug)) {
    for (const url of configured) {
      const derived = tenantOriginFromConfiguredUrl(url, slug);
      if (derived) return derived;
    }
  }
  return configured[0].origin;
}

/**
 * Base URL of the links sent for a request (password reset, invitation): the configured
 * address (the tenant's address in multi-tenant mode). In development mode, a request on a
 * local development host keeps its links on that host.
 */
export function resolveAppBaseUrl(req: any): string {
  const devHost = developmentRequestHost(req);
  if (devHost) return `${getRequestProto(req)}://${devHost}`;
  const configured = resolveConfiguredAppBaseUrl(req?.tenant?.slug ?? null);
  if (configured) return configured;
  throw new BadRequestException(APP_URL_NOT_CONFIGURED_MESSAGE);
}

/**
 * Base URL of a given tenant for a request (sign-in redirects, knowledge links): the
 * configured address of that tenant. In development mode, a request on a local development
 * host keeps the redirect on the matching development host.
 */
export function resolveTenantAppBaseUrl(req: any, tenantSlug: string) {
  if (!tenantSlug || typeof tenantSlug !== 'string') {
    throw new BadRequestException('tenant slug is required');
  }

  const devHost = developmentRequestHost(req);
  if (devHost) {
    const fromRequest = resolveTenantOriginFromHost(devHost, tenantSlug, getRequestProto(req));
    if (fromRequest) return fromRequest;
  }

  const configured = resolveConfiguredAppBaseUrl(tenantSlug);
  if (configured) return configured;

  if (devHost) return `${getRequestProto(req)}://${devHost}`;
  throw new BadRequestException(APP_URL_NOT_CONFIGURED_MESSAGE);
}

/**
 * Base URL for notification links (emails, digests), which have no request: the configured
 * address of the tenant. Throws when no address is configured.
 */
export function resolveNotificationBaseUrl(tenantSlug: string | null): string {
  const configured = resolveConfiguredAppBaseUrl(tenantSlug);
  if (configured) return configured;
  throw new Error(APP_URL_NOT_CONFIGURED_MESSAGE);
}

/**
 * Base URL for links sent by e-mail in answer to a request (password reset,
 * invitation): e-mail links open the tenant address of the request.
 * Multi-tenant with a request tenant: the tenant address (`<slug>.<domain>`).
 * Single-tenant, or a request without a tenant: `resolveAppBaseUrl`.
 */
export function resolveRequestAppBaseUrl(req: any) {
  const tenantSlug = req?.tenant?.slug;
  if (!Features.SINGLE_TENANT && typeof tenantSlug === 'string' && tenantSlug) {
    return resolveTenantAppBaseUrl(req, tenantSlug);
  }
  return resolveAppBaseUrl(req);
}
