import { BadRequestException } from '@nestjs/common';
import { isProductionEnv } from './env';
import { Features } from '../config/features';

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

function getConfiguredAppBaseUrl(): URL | null {
  const value = String(process.env.APP_BASE_URL || process.env.PUBLIC_APP_URL || '').trim();
  if (!value) return null;
  try {
    return new URL(value);
  } catch {
    throw new BadRequestException('application url is not configured');
  }
}

function getRequestOrigin(req: any): string | null {
  const host = sanitizeHost(
    (req?.headers?.['x-forwarded-host'] as string | undefined)
      ?? (req?.headers?.host as string | undefined),
  );
  if (!host) return null;
  const proto = normalizeProto(
    (req?.headers?.['x-forwarded-proto'] as string | undefined)
      ?? (req?.protocol as string | undefined)
      ?? 'http',
  );
  return `${proto}://${host}`;
}

function resolveTenantOriginFromHost(host: string, tenantSlug: string, proto: 'http' | 'https'): string | null {
  const normalizedHost = sanitizeHost(host);
  if (!normalizedHost) return null;
  const slug = tenantSlug.toLowerCase();

  // If the host is already a tenant host for this slug, reuse it.
  if (normalizedHost.startsWith(`${slug}.`)) {
    return `${proto}://${normalizedHost}`;
  }

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

export function resolveAppBaseUrl(req: any) {
  const configured = getConfiguredAppBaseUrl();
  // In production, only trust explicit application config.
  if (isProductionEnv()) {
    if (configured) return configured.origin;
    throw new BadRequestException('application url is not configured');
  }

  // In non-production, keep request-derived origin for local subdomain workflows.
  const requestOrigin = getRequestOrigin(req);
  if (requestOrigin) return requestOrigin;
  if (configured) return configured.origin;
  throw new BadRequestException('application url is not configured');
}

export function resolveTenantAppBaseUrl(req: any, tenantSlug: string) {
  if (!tenantSlug || typeof tenantSlug !== 'string') {
    throw new BadRequestException('tenant slug is required');
  }

  const configured = getConfiguredAppBaseUrl();

  // Single-tenant: one address, the configured application URL.
  if (Features.SINGLE_TENANT && configured) return configured.origin;

  // In non-production, preserve request-host behavior for local workflows.
  if (!isProductionEnv()) {
    const requestHost = sanitizeHost(
      (req?.headers?.['x-forwarded-host'] as string | undefined)
        ?? (req?.headers?.host as string | undefined),
    );
    const requestProto = normalizeProto(
      (req?.headers?.['x-forwarded-proto'] as string | undefined)
        ?? (req?.protocol as string | undefined)
        ?? 'http',
    );
    const fromRequest = resolveTenantOriginFromHost(requestHost, tenantSlug, requestProto);
    if (fromRequest) return fromRequest;
  }

  // In production, derive from canonical configured host only.
  if (configured) {
    const configuredProto = normalizeProto(configured.protocol);
    const fromConfigured = resolveTenantOriginFromHost(configured.host, tenantSlug, configuredProto);
    if (fromConfigured) return fromConfigured;
    return configured.origin.replace(/\/$/, '');
  }

  if (isProductionEnv()) {
    throw new BadRequestException('application url is not configured');
  }

  const requestOrigin = getRequestOrigin(req);
  if (requestOrigin) return requestOrigin.replace(/\/$/, '');
  throw new BadRequestException('application url is not configured');
}

/**
 * Resolve a base URL for notification links (emails, digests).
 * In single-tenant mode, uses APP_BASE_URL directly (no subdomain logic).
 * In multi-tenant mode, derives from APP_URL with slug substitution.
 */
export function resolveNotificationBaseUrl(tenantSlug: string | null): string {
  if (Features.SINGLE_TENANT) {
    const url = (process.env.APP_BASE_URL || '').trim();
    if (!url) {
      throw new Error('FATAL: APP_BASE_URL is required in single-tenant mode for notification links');
    }
    return url.replace(/\/$/, '');
  }
  const appUrl = process.env.APP_URL || 'https://app.kanap.net';
  if (!tenantSlug) return appUrl;
  return appUrl.replace(/\/\/app\./, `//${tenantSlug}.`);
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
