export const HOME_SCREENSHOT = '/screenshots/home-dashboard.png';

export const HOME_HERO_SCREENSHOTS = {
  main: '/screenshots/ai-conversation.png',
  map: '/screenshots/it-interface-map.png',
  budget: '/screenshots/budget-top-items-2026-10.png',
} as const;

export const FEATURE_HUB_SCREENSHOTS = [
  '/screenshots/budget-top-items-2026-10.png',
  '/screenshots/it-interface-map.png',
  '/screenshots/portfolio-capacity.png',
  '/screenshots/ai-conversation.png',
  '/screenshots/it-applications.png',
  '/screenshots/agent-queue.png',
] as const;

export const FEATURE_SCREENSHOTS = {
  budget: [
    '/screenshots/budget-opex-grid-2026-10.png',
    '/screenshots/budget-allocations-2026-10b.png',
    '/screenshots/budget-currency-2026-10.png',
    '/screenshots/budget-top-items-2026-10.png',
  ],
  'it-landscape': [
    '/screenshots/it-applications.png',
    '/screenshots/it-interface-technical.png',
    '/screenshots/it-assets.png',
    '/screenshots/it-interface-map.png',
  ],
  portfolio: [
    '/screenshots/portfolio-request-scoring.png',
    '/screenshots/portfolio-request-summary.png',
    '/screenshots/portfolio-project-timeline.png',
    '/screenshots/portfolio-capacity.png',
  ],
  knowledge: [
    '/screenshots/knowledge-editor.png',
    '/screenshots/knowledge-library.png',
    '/screenshots/knowledge-document.png',
    '/screenshots/knowledge-linked-entities.png',
  ],
  ai: [
    '/screenshots/ai-conversation.png',
    '/screenshots/ai-preview.png',
    '/screenshots/ai-integrations.png',
    '/screenshots/ai-admin.png',
  ],
} as const;

/**
 * Agents page screenshots (plan §8), captured from the live agent UI on the
 * Fromage & Co demo tenant (graduated-autonomy panel from a calibrated pilot
 * agent). In section order.
 */
export const AGENT_SCREENSHOTS: readonly (string | undefined)[] = [
  '/screenshots/agent-autonomy.png',
  '/screenshots/agent-proposal.png',
  '/screenshots/agent-settings.png',
  '/screenshots/agent-activity.png',
  '/screenshots/agent-queue.png',
];

export type FeatureScreenshotSlug = keyof typeof FEATURE_SCREENSHOTS;

export function getFeatureSlugFromPath(pathname: string): FeatureScreenshotSlug | null {
  const parts = pathname.split('/').filter(Boolean);
  const featureIndex = parts.indexOf('features');
  const slug = featureIndex >= 0 ? parts[featureIndex + 1] : undefined;
  return slug && slug in FEATURE_SCREENSHOTS ? (slug as FeatureScreenshotSlug) : null;
}
