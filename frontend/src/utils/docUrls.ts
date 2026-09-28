/**
 * Documentation URL mapping
 *
 * Maps application routes to their corresponding documentation pages.
 * Published at: https://doc.kanap.net/
 */

const DOC_BASE_URL = 'https://doc.kanap.net';

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
  [/^\/it\/settings/, 'it-ops-settings'],

  // Budget Management
  [/^\/ops\/opex\/\d+/, 'opex'],
  [/^\/ops\/opex/, 'opex'],
  [/^\/ops\/capex\/\d+/, 'capex'],
  [/^\/ops\/capex/, 'capex'],
  [/^\/ops\/contracts\/\d+/, 'contracts'],
  [/^\/ops\/contracts/, 'contracts'],
  [/^\/ops\/tasks\/\d+/, 'tasks'],
  [/^\/ops\/tasks/, 'tasks'],
  [/^\/ops\/reports/, 'reports'],
  [/^\/ops\/operations/, 'budget-operations'],
  [/^\/ops$/, 'operations-dashboard'],

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
  [/^\/master-data\/currency/, 'currencies'],
  [/^\/master-data\/operations/, 'master-data-operations'],

  // Admin
  [/^\/admin\/users/, 'admin'],
  [/^\/admin\/roles/, 'admin'],
  [/^\/admin\/audit-logs/, 'admin'],
  [/^\/admin\/billing/, 'admin'],
  [/^\/admin\/auth/, 'admin'],
  [/^\/admin\/branding/, 'branding'],
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
 * Get the documentation URL for a given route path.
 * Returns the specific page URL if a mapping exists, otherwise returns the docs home.
 * When a supported locale is provided, URLs are prefixed with the locale path.
 */
export function getDocUrl(pathname: string, locale?: string): string {
  const prefix = getLocalePrefix(locale);
  for (const [pattern, slug] of routeToDocSlug) {
    if (pattern.test(pathname)) {
      return `${DOC_BASE_URL}${prefix}/${slug}/`;
    }
  }
  return `${DOC_BASE_URL}${prefix}/`;
}

/**
 * Get just the doc slug (without base URL) for a given route path.
 * Returns null if no specific mapping exists.
 */
export function getDocSlug(pathname: string): string | null {
  for (const [pattern, slug] of routeToDocSlug) {
    if (pattern.test(pathname)) {
      return slug;
    }
  }
  return null;
}
