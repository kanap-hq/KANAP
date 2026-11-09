export const HOME_SCREENSHOT = '/screenshots/home-dashboard.png';

export const HOME_HERO_SCREENSHOTS = {
  main: '/screenshots/feature-plaid-query-2026-11-09.png',
  map: '/screenshots/it-interface-map-2026-11-09.png',
  budget: '/screenshots/budget-top-lines-2026-11-09.png',
} as const;

export const FEATURE_HUB_SCREENSHOTS = [
  '/screenshots/budget-top-lines-2026-11-09.png',
  '/screenshots/it-interface-map-2026-11-09.png',
  '/screenshots/portfolio-capacity-2026-11-09.png',
  '/screenshots/feature-plaid-query-2026-11-09.png',
  '/screenshots/it-applications-2026-11-09.png',
  '/screenshots/agent-queue-2026-11-09.png',
] as const;

export const FEATURE_SCREENSHOTS = {
  budget: [
    '/screenshots/budget-lines-grid-2026-11-09.png',
    '/screenshots/budget-allocations-2026-11-09.png',
    '/screenshots/budget-currency-2026-11-09.png',
    '/screenshots/budget-top-lines-2026-11-09.png',
  ],
  'it-landscape': [
    '/screenshots/it-applications-2026-11-09.png',
    '/screenshots/it-interface-technical-2026-11-09.png',
    '/screenshots/it-assets-2026-11-09.png',
    '/screenshots/release-26-10-6-technology-2026-11-09.png',
    '/screenshots/release-26-10-6-vulnerabilities-2026-11-09.png',
    '/screenshots/it-interface-map-2026-11-09.png',
  ],
  portfolio: [
    '/screenshots/portfolio-request-scoring-2026-11-09.png',
    '/screenshots/portfolio-request-summary-2026-11-09.png',
    '/screenshots/portfolio-project-timeline-2026-11-09.png',
    '/screenshots/portfolio-capacity-2026-11-09.png',
  ],
  knowledge: [
    '/screenshots/knowledge-editor-2026-11-09.png',
    '/screenshots/knowledge-library-2026-11-09.png',
    '/screenshots/knowledge-document-2026-11-09.png',
    '/screenshots/knowledge-linked-entities-2026-11-09.png',
  ],
  contracts: [
    '/screenshots/feature-contracts-list-2026-11-09.png',
    '/screenshots/feature-contracts-overview-2026-11-09.png',
    '/screenshots/feature-contracts-cancel-2026-11-09.png',
    '/screenshots/feature-contracts-budget-2026-11-09.png',
  ],
  incidents: [
    '/screenshots/feature-incidents-register-2026-11-09.png',
    '/screenshots/feature-incidents-review-2026-11-09.png',
    '/screenshots/feature-incidents-compliance-2026-11-09.png',
    '/screenshots/feature-incidents-relations-2026-11-09.png',
  ],
  ai: [
    '/screenshots/feature-plaid-query-2026-11-09.png',
    '/screenshots/feature-plaid-preview-2026-11-09.png',
    '/screenshots/feature-plaid-claude-2026-10-26.png',
    '/screenshots/feature-plaid-admin-2026-11-09b.png',
  ],
} as const;

/**
 * Agents page screenshots (plan §8), captured from the live agent UI on a
 * tenant loaded with the Fromage & Co sample data (2026-11-09): the fixture
 * agent and its demo run, its autonomy ladder before any reviewed proposal.
 * In section order.
 */
export const AGENT_SCREENSHOTS: readonly (string | undefined)[] = [
  '/screenshots/agent-autonomy-2026-11-09.png',
  '/screenshots/agent-proposal-2026-11-09b.png',
  '/screenshots/agent-settings-2026-11-09.png',
  '/screenshots/agent-activity-2026-11-09.png',
  '/screenshots/agent-queue-2026-11-09.png',
];

export type FeatureScreenshotSlug = keyof typeof FEATURE_SCREENSHOTS;

export function getFeatureSlugFromPath(pathname: string): FeatureScreenshotSlug | null {
  const parts = pathname.split('/').filter(Boolean);
  const featureIndex = parts.indexOf('features');
  const slug = featureIndex >= 0 ? parts[featureIndex + 1] : undefined;
  return slug && slug in FEATURE_SCREENSHOTS ? (slug as FeatureScreenshotSlug) : null;
}
