/**
 * Feature pages a blog article can point at. One list: the blog schema,
 * the topic defaults and the related-articles block all use it.
 * Agents is a feature page with its own renderer. The deep-dive union in
 * `resolve.ts` (`DeepDiveSlug`) is this list without `agents`.
 */
export const FEATURE_SLUGS = [
  'budget',
  'portfolio',
  'it-landscape',
  'knowledge',
  'ai',
  'agents',
] as const;

export type FeatureSlug = (typeof FEATURE_SLUGS)[number];

/** Feature deep-dive page content shape. */

export interface FeatureSection {
  title: string;
  body: string;
  bullets: string[];
  /** Product screenshot alt text. */
  shotAlt: string;
}

export interface FeatureMore {
  title: string;
  body: string;
}

export interface FeatureCrossLink {
  label: string;
  href: string; // relative, will get locale-prefixed
}

export interface FeatureContent {
  meta: { title: string; description: string };
  header: {
    eyebrow: string;
    title: string;
    lead: string;
  };
  sections: FeatureSection[];
  more: {
    title: string;
    items: FeatureMore[];
  };
  crossLinks: {
    label: string;
    links: FeatureCrossLink[];
  };
  cta: {
    title: string;
    body: string;
    primary: string;
    secondary: string;
  };
}

/**
 * Agents page content — a feature deep-dive plus a transparency / connector
 * lead-capture block. Same section/more/crossLink/cta shape as other feature
 * pages, rendered by a dedicated AgentsPage component (Deploy-free CTA to
 * GitHub, plus the transparency block).
 */
export interface AgentsTransparency {
  eyebrow: string;
  title: string;
  body: string;
  ctaLabel: string;
  /** Relative, locale-prefixed at render (the connector lead funnel). */
  ctaHref: string;
}

export interface AgentsContent extends FeatureContent {
  transparency: AgentsTransparency;
}

/** Hub page (features landing) — role-based scenarios. */

export interface PersonaModuleRef {
  /** Feature slug (`budget` | `it-landscape` | `portfolio` | `knowledge` | `ai`). */
  slug: string;
  label: string;
}

export interface Persona {
  /** Short role label rendered as eyebrow above the headline. */
  role: string;
  /** The H2 — concrete pain or task framed in the role's voice. */
  headline: string;
  /** 3–5 sentence narrative of how the persona uses KANAP. */
  body: string;
  /** One-line punchline rendered with a teal accent (the "win"). */
  outcome: string;
  /** Modules combined in the scenario; chips link to the deep-dive pages. */
  modules: PersonaModuleRef[];
  /** Product screenshot alt text. */
  shotAlt: string;
}

export interface FeaturesHubContent {
  meta: { title: string; description: string };
  header: {
    eyebrow: string;
    title: string;
    lead: string;
  };
  /** Label rendered above the modules chip list, e.g. "Modules combined". */
  modulesUsedLabel: string;
  personas: Persona[];
  cta: {
    title: string;
    body: string;
    primary: string;
    secondary: string;
  };
}
