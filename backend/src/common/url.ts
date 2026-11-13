import { BadRequestException } from '@nestjs/common';
import { isDevelopmentEnv } from './env';
import { Features } from '../config/features';
import { listedDomainOfHost, tenantBaseDomains } from './tenant-base-domains';

/** The answer of a feature that needs an application link when no address is configured. */
export const APP_URL_NOT_CONFIGURED_MESSAGE = 'application URL is not configured: set APP_BASE_URL';

/** 400 `APP_URL_NOT_CONFIGURED`: a link to send while the installation has no application address. */
export function appUrlNotConfigured(): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', code: 'APP_URL_NOT_CONFIGURED', message: APP_URL_NOT_CONFIGURED_MESSAGE });
}

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
 * `*.localhost`, and dev.kanap.net and its subdomains. When `TENANT_BASE_DOMAINS` is set, its
 * domains take the place of dev.kanap.net, in development mode only: a development machine lists
 * its own domains there (`dev.kanap.net,dev.example.com`), and no other mode widens this set.
 */
export function isLocalDevelopmentHost(host: string, env: NodeJS.ProcessEnv = process.env): boolean {
  const h = sanitizeHost(host);
  if (!h) return false;
  if (h === 'lvh.me' || h.endsWith('.lvh.me') || h === 'localhost' || h.endsWith('.localhost')) return true;
  const domains = tenantBaseDomains(env);
  if (domains) return isDevelopmentEnv(env) && listedDomainOfHost(h, domains) !== null;
  return h === 'dev.kanap.net' || h.endsWith('.dev.kanap.net');
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

/**
 * The address of the request (scheme and host, port left out) when links may follow it: in
 * development mode, on a local development host only. Null everywhere else.
 */
export function developmentRequestOrigin(req: any): string | null {
  const host = developmentRequestHost(req);
  return host ? `${getRequestProto(req)}://${host}` : null;
}

/** A request host: reused when it already is this tenant's host, otherwise the domain rules. */
function resolveTenantOriginFromHost(
  host: string,
  tenantSlug: string,
  proto: 'http' | 'https',
  domains: readonly string[] | null,
): string | null {
  const normalizedHost = sanitizeHost(host);
  if (!normalizedHost) return null;

  // If the host is already a tenant host for this slug, reuse it.
  if (normalizedHost.startsWith(`${tenantSlug.toLowerCase()}.`)) {
    return `${proto}://${normalizedHost}`;
  }
  return tenantOriginFromDomain(normalizedHost, tenantSlug, proto, domains);
}

/**
 * The tenant's address on the domain of a host: lvh.me, then the listed domains of
 * `TENANT_BASE_DOMAINS` when it is set (`domains`), otherwise dev/qa.kanap.net, kanap.net and
 * `app.<domain>`.
 */
function tenantOriginFromDomain(
  host: string,
  tenantSlug: string,
  proto: 'http' | 'https',
  domains: readonly string[] | null,
): string | null {
  const normalizedHost = sanitizeHost(host);
  if (!normalizedHost) return null;
  const slug = tenantSlug.toLowerCase();

  // Dev: lvh.me wildcard
  if (normalizedHost === 'lvh.me' || normalizedHost === 'www.lvh.me' || normalizedHost.endsWith('.lvh.me')) {
    return `${proto}://${slug}.lvh.me`;
  }

  // The listed domains replace the built-in ones: a link always leads to a host the tenancy
  // middleware reads as this tenant.
  if (domains) {
    const domain = listedDomainOfHost(normalizedHost, domains);
    return domain ? `${proto}://${slug}.${domain}` : null;
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
function tenantOriginFromConfiguredUrl(url: URL, tenantSlug: string, domains: readonly string[] | null): string | null {
  const proto = url.protocol === 'https:' ? 'https' : 'http';
  const derived = tenantOriginFromDomain(url.hostname, tenantSlug, proto, domains);
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
 *   host is on a known tenant domain (lvh.me, then the domains of `TENANT_BASE_DOMAINS` when it is
 *   set, otherwise dev.kanap.net, qa.kanap.net, kanap.net, or a host starting with `app.`),
 *   turned into the tenant's address `<slug>.<domain>` (scheme and port kept); when none is, the
 *   first of them as configured;
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
    const domains = tenantBaseDomains(env, singleTenant);
    for (const url of configured) {
      const derived = tenantOriginFromConfiguredUrl(url, slug, domains);
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
  const devOrigin = developmentRequestOrigin(req);
  if (devOrigin) return devOrigin;
  const configured = resolveConfiguredAppBaseUrl(req?.tenant?.slug ?? null);
  if (configured) return configured;
  throw appUrlNotConfigured();
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
    const fromRequest = resolveTenantOriginFromHost(devHost, tenantSlug, getRequestProto(req), tenantBaseDomains());
    if (fromRequest) return fromRequest;
  }

  const configured = resolveConfiguredAppBaseUrl(tenantSlug);
  if (configured) return configured;

  if (devHost) return `${getRequestProto(req)}://${devHost}`;
  throw appUrlNotConfigured();
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
