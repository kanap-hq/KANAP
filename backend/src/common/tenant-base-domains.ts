import { Features } from '../config/features';

/**
 * `TENANT_BASE_DOMAINS`: the domains the tenants are served under, `<slug>.<domain>` (comma-
 * separated, spaces and case ignored), read in multi-tenant mode only. Each environment lists all
 * of its domains (`kanap.net,example.com` in production, `qa.kanap.net,qa.example.com` in QA).
 *
 * Set, the list replaces the built-in domains (kanap.net, qa.kanap.net, dev.kanap.net) everywhere
 * a host is read: the tenant of a request, the CORS check, the sample data host check, and the
 * tenant's address the links are built on. The lvh.me and localhost rules stay as they are.
 * Empty or absent, the built-in domains apply as before (`null` below).
 */

const DOMAIN_SHAPE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;
const SLUG_SHAPE = /^[a-z0-9][a-z0-9-]*$/;

let cachedRaw: string | null = null;
let cachedDomains: readonly string[] | null = null;

function parseDomains(raw: string): readonly string[] | null {
  const entries = raw.split(',').map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  const domains = [...new Set(entries.filter((entry) => DOMAIN_SHAPE.test(entry)))];
  const ignored = entries.filter((entry) => !DOMAIN_SHAPE.test(entry));
  if (ignored.length > 0) {
    // eslint-disable-next-line no-console
    console.warn(`[tenancy] TENANT_BASE_DOMAINS: ignored ${JSON.stringify(ignored)} (a domain name such as example.com is expected)`);
  }
  if (domains.length === 0) return null;
  // Longest first: `acme.qa.kanap.net` is on qa.kanap.net when both qa.kanap.net and kanap.net are listed.
  return domains.sort((a, b) => b.length - a.length);
}

/** The listed tenant domains, longest first, or null when the list is not set (or single-tenant). */
export function tenantBaseDomains(
  env: NodeJS.ProcessEnv = process.env,
  singleTenant: boolean = Features.SINGLE_TENANT,
): readonly string[] | null {
  if (singleTenant) return null;
  const raw = String(env.TENANT_BASE_DOMAINS ?? '');
  if (raw !== cachedRaw) {
    cachedDomains = parseDomains(raw);
    cachedRaw = raw;
  }
  return cachedDomains;
}

/** The listed domain a host name is on (the domain itself or one of its subdomains), or null. */
export function listedDomainOfHost(host: string, domains: readonly string[]): string | null {
  for (const domain of domains) {
    if (host === domain || host.endsWith(`.${domain}`)) return domain;
  }
  return null;
}

/**
 * The tenant slug of a host name on a listed domain: one label right under the domain, `www`
 * excepted. The apex, `www.<domain>`, deeper subdomains and other domains give null.
 */
export function tenantSlugOnListedDomains(host: string, domains: readonly string[]): string | null {
  const domain = listedDomainOfHost(host, domains);
  if (!domain || host === domain) return null;
  const sub = host.slice(0, -(domain.length + 1));
  if (sub === 'www' || !SLUG_SHAPE.test(sub)) return null;
  return sub;
}
