/** Homepage content shape, all locales implement this. */

export interface Pillar {
  title: string;
  body: string;
}

export interface ModuleEntry {
  /** Optional — when omitted, the tile renders without a CTA link. */
  slug?: string;
  title: string;
  blurb: string;
  bullets: string[];
  ctaLabel?: string;
}

export interface CrossCuttingFeature {
  title: string;
  body: string;
}

/**
 * Narrative band — a prose section (title + one or more paragraphs, optional
 * supporting points). Used for the agentic story sections on the home.
 * `body` may contain `\n` to split into paragraphs.
 */
export interface StoryBand {
  eyebrow?: string;
  title: string;
  body: string;
  bullets?: string[];
}

/** The three-layer model section (record / interaction / action). */
export interface LayersSection {
  eyebrow: string;
  title: string;
  intro: string;
  /** The three layers, named descriptively. */
  items: Pillar[];
  /** Closing line below the layer cards. */
  outro: string;
  /** Link to the budget guide article, below the closing line. `href` gets locale-prefixed. */
  guide?: { label: string; href: string };
}

export interface HomeContent {
  meta: {
    title: string;
    description: string;
  };
  hero: {
    eyebrow: string;
    title: string;
    lead: string;
    primaryCta: string;
    secondaryCta: string;
    trialNote: string;
  };
  pillars: {
    eyebrow: string;
    title: string;
    items: Pillar[];
  };
  /**
   * Agentic additions to the home. Optional so locale files written before
   * the refonte still type-check; those locales render the pre-refonte home
   * until the translation pass adds these sections.
   */
  layers?: LayersSection;
  vision?: StoryBand;
  modules: {
    eyebrow: string;
    title: string;
    intro: string;
    items: ModuleEntry[];
  };
  crossCutting: {
    eyebrow: string;
    title: string;
    intro: string;
    items: CrossCuttingFeature[];
  };
  cta: {
    title: string;
    body: string;
    primary: string;
    secondary: string;
  };
}
