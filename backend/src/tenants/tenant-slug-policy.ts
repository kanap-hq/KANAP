import { Features } from '../config/features';

const RESERVED_TENANT_SLUG_LIST = [
  'www',
  'api',
  'admin',
  'billing',
  'account',
  'platform-admin',
  'app',
  'nextcloud',
  'migration',
  'example',
] as const;

/**
 * Subdomains the cloud keeps for its environments and services (`dev.<domain>`, `qa.<domain>`,
 * mail and status hosts) and for the product's names: reserved in multi-tenant mode only, so that the slug of a new
 * on-premise installation (`DEFAULT_TENANT_SLUG`) is refused for no more names than before.
 */
const RESERVED_CLOUD_SUBDOMAIN_LIST = [
  'dev',
  'qa',
  'doc',
  'send',
  'tenants',
  'mail',
  'autodiscover',
  'status',
  'kanap',
  'kadratis',
  'cadratis',
] as const;

const RESERVED_TENANT_SLUGS = new Set<string>(RESERVED_TENANT_SLUG_LIST);
const RESERVED_CLOUD_SUBDOMAINS = new Set<string>(RESERVED_CLOUD_SUBDOMAIN_LIST);

export function normalizeTenantSlug(slug: string): string {
  return slug.trim().toLowerCase();
}

/**
 * Whether a new slug is refused (creation, trial sign-up, change of slug). A tenant that already
 * holds a slug reserved later keeps it: the request's tenant is looked up by slug alone.
 */
export function isReservedTenantSlug(slug: string, singleTenant: boolean = Features.SINGLE_TENANT): boolean {
  const normalized = normalizeTenantSlug(slug);
  return RESERVED_TENANT_SLUGS.has(normalized) || (!singleTenant && RESERVED_CLOUD_SUBDOMAINS.has(normalized));
}

export function listReservedTenantSlugs(singleTenant: boolean = Features.SINGLE_TENANT): readonly string[] {
  return singleTenant ? RESERVED_TENANT_SLUG_LIST : [...RESERVED_TENANT_SLUG_LIST, ...RESERVED_CLOUD_SUBDOMAIN_LIST];
}
