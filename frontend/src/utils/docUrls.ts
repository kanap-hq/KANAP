/**
 * Documentation URL mapping
 *
 * Maps application routes to their corresponding documentation pages.
 * Published at: https://doc.kanap.net/
 */

const DOC_BASE_URL = 'https://doc.kanap.net';

/** Release notes of each version, on the public repository. */
export const RELEASES_URL = 'https://github.com/kanap-hq/KANAP/releases';

/**
 * Route pattern to documentation slug mapping.
 * Patterns are matched in order - more specific patterns should come first.
 */
const routeToDocSlug: [RegExp, string][] = [
  // Home
  [/^\/$/, 'my-dashboard'],

  // Portfolio Management
  [/^\/portfolio\/tasks\/[^/]+/, 'tasks'],
  [/^\/portfolio\/tasks/, 'tasks'],
  [/^\/portfolio\/requests\/[^/]+/, 'portfolio-requests'],
  [/^\/portfolio\/requests/, 'portfolio-requests'],
  [/^\/portfolio\/projects\/[^/]+/, 'portfolio-projects'],
  [/^\/portfolio\/projects/, 'portfolio-projects'],
  [/^\/portfolio\/contributors\/[^/]+/, 'portfolio-team-members'],
  [/^\/portfolio\/contributors/, 'portfolio-team-members'],
  [/^\/portfolio\/team-members\/[^/]+/, 'portfolio-team-members'],
  [/^\/portfolio\/team-members/, 'portfolio-team-members'],
  [/^\/portfolio\/planning/, 'portfolio-planning'],
  [/^\/portfolio\/reports/, 'portfolio-reporting'],
  [/^\/portfolio\/settings/, 'portfolio-settings'],

  // Knowledge
  [/^\/knowledge\/[^/]+/, 'knowledge'],
  [/^\/knowledge/, 'knowledge'],

  // IT Landscape
  [/^\/it\/applications\/\d+/, 'applications'],
  [/^\/it\/applications/, 'applications'],
  [/^\/it\/interfaces\/\d+/, 'interfaces'],
  [/^\/it\/interfaces/, 'interfaces'],
  [/^\/it\/interface-map/, 'interface-map'],
  [/^\/it\/connections\/\d+/, 'connections'],
  [/^\/it\/connections/, 'connections'],
  [/^\/it\/connection-map/, 'connection-map'],
  [/^\/it\/locations\/\d+/, 'locations'],
  [/^\/it\/locations/, 'locations'],
  [/^\/it\/assets\/[^/]+/, 'assets'],
  [/^\/it\/assets/, 'assets'],
  [/^\/it\/technologies\/end-of-support/, 'end-of-support'],
  [/^\/it\/vulnerabilities/, 'vulnerabilities'],
  [/^\/it\/administration-view/, 'administration-view'],
  [/^\/it\/incidents\/[^/]+/, 'incidents'],
  [/^\/it\/incidents/, 'incidents'],
  [/^\/it\/technologies\/[^/]+/, 'technologies'],
  [/^\/it\/technologies/, 'technologies'],
  // IT settings is chosen below: the Netbox tab opens the Netbox manual, the lists tab this one.
  [/^\/it\/settings/, 'it-ops-settings'],
  [/^\/it\/netbox/, 'netbox'],

  // Budget Management
  // The History tab of a line opens the record history manual.
  [/^\/ops\/budget\/[^/]+\/history(?:\/|$)/, 'record-history'],
  [/^\/ops\/budget(?:\/|$)/, 'budget-lines'],
  [/^\/ops\/contracts\/\d+/, 'contracts'],
  [/^\/ops\/contracts/, 'contracts'],
  [/^\/ops\/tasks\/\d+/, 'tasks'],
  [/^\/ops\/tasks/, 'tasks'],
  [/^\/ops\/reports/, 'reports'],
  [/^\/ops\/operations\/currency/, 'currencies'],
  [/^\/ops\/operations\/master-data-freeze/, 'master-data-operations'],
  [/^\/ops\/operations\/metrics-copy/, 'master-data-operations'],
  [/^\/ops\/operations/, 'budget-operations'],
  [/^\/ops$/, 'my-dashboard'],

  // Master Data
  [/^\/master-data\/companies\/\d+/, 'companies'],
  [/^\/master-data\/companies/, 'companies'],
  [/^\/master-data\/departments\/\d+/, 'departments'],
  [/^\/master-data\/departments/, 'departments'],
  [/^\/master-data\/cost-centers/, 'cost-centers'],
  [/^\/master-data\/suppliers\/\d+/, 'suppliers'],
  [/^\/master-data\/suppliers/, 'suppliers'],
  [/^\/master-data\/contacts\/\d+/, 'contacts'],
  [/^\/master-data\/contacts/, 'contacts'],
  [/^\/master-data\/business-processes\/\d+/, 'business-processes'],
  [/^\/master-data\/business-processes/, 'business-processes'],
  [/^\/master-data\/accounts\/\d+/, 'chart-of-accounts'],
  [/^\/master-data\/accounts/, 'chart-of-accounts'],
  [/^\/master-data\/coa/, 'chart-of-accounts'],
  [/^\/master-data\/analytics/, 'analytics'],
  [/^\/master-data\/working-day-calendars/, 'working-day-calendars'],

  // Admin
  [/^\/admin\/data-access/, 'data-access'],
  [/^\/admin\/users/, 'admin'],
  [/^\/admin\/roles/, 'admin'],
  [/^\/admin\/audit-logs/, 'admin'],
  [/^\/admin\/billing/, 'admin'],
  [/^\/admin\/auth/, 'admin'],
  [/^\/admin\/branding/, 'branding'],
  [/^\/admin\/sample-data/, 'sample-data'],
  [/^\/admin\/ai-models/, 'ai-models'],
  [/^\/admin\/ai-usage/, 'ai-usage'],
  [/^\/admin\/ai/, 'ai-settings'],
  [/^\/admin\/integrations/, 'integrations'],
  [/^\/admin\/scheduled-tasks/, 'scheduled-tasks'],

  // AI Assistant
  [/^\/ai/, 'ai-assistant'],

  // AI Agents (specific sub-pages first, then the per-agent workspace, then the bare overview)
  [/^\/agents\/approvals/, 'agents-approvals'],
  [/^\/agents\/activity/, 'agents-activity'],
  [/^\/agents\/shared-context/, 'agents-shared-context'],
  [/^\/agents\/[^/]+/, 'agents-workspace'],
  [/^\/agents/, 'agents-overview'],

  [/^\/settings\/connected-apps/, 'connected-apps'],
  [/^\/settings/, 'fast-track/getting-started'],
];

/**
 * Get the locale prefix for documentation URLs.
 * English uses root (no prefix), other supported languages get /fr/, /de/, /es/.
 */
function getLocalePrefix(locale?: string): string {
  if (locale && ['fr', 'de', 'es'].includes(locale)) {
    return `/${locale}`;
  }
  return '';
}

/**
 * Slug for a route. IT settings uses the query: `tab=netbox` opens the Netbox manual,
 * any other tab (including the lists) opens the IT settings manual.
 */
export function getDocSlug(pathname: string, search?: string): string | null {
  if (/^\/it\/settings(?:\/|$)/.test(pathname) && new URLSearchParams(search ?? '').get('tab') === 'netbox') {
    return 'netbox';
  }
  for (const [pattern, slug] of routeToDocSlug) {
    if (pattern.test(pathname)) return slug;
  }
  return null;
}

/**
 * Get the documentation URL for a given route path.
 * Returns the specific page URL if a mapping exists, otherwise returns the docs home.
 * When a supported locale is provided, URLs are prefixed with the locale path.
 * `search` is the page query (`location.search`), used when one route has several manuals.
 */
export function getDocUrl(pathname: string, locale?: string, search?: string): string {
  const prefix = getLocalePrefix(locale);
  const slug = getDocSlug(pathname, search);
  if (slug) return `${DOC_BASE_URL}${prefix}/${slug}/`;
  return `${DOC_BASE_URL}${prefix}/`;
}

/**
 * Get the documentation URL of a page by its slug (for example `on-premise/operations`).
 * When a supported locale is provided, the URL is prefixed with the locale path.
 */
export function getDocPageUrl(slug: string, locale?: string): string {
  return `${DOC_BASE_URL}${getLocalePrefix(locale)}/${slug}/`;
}

/** Home of the user manual, in the user's language. */
export function getDocHomeUrl(locale?: string): string {
  return `${DOC_BASE_URL}${getLocalePrefix(locale)}/`;
}


