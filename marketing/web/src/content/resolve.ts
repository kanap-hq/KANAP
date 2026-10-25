/**
 * Content resolver, imports the right locale variant of a page's content.
 *
 * Content files live at `src/content/{page}/{locale}.ts` and export a
 * typed default object. This helper picks the right one, falling back to
 * English if a locale file is missing.
 */

import type { Locale } from '../i18n/ui';
import { DEFAULT_LOCALE } from '../i18n/ui';
import type { FeatureSlug } from './features/types';

import homeEn from './home/en';
import homeFr from './home/fr';
import homeDe from './home/de';
import homeEs from './home/es';

import offerEn from './offer/en';
import offerFr from './offer/fr';
import offerDe from './offer/de';
import offerEs from './offer/es';

import onpremEn from './onpremise/en';
import onpremFr from './onpremise/fr';
import onpremDe from './onpremise/de';
import onpremEs from './onpremise/es';

// Features, full 4-locale set
import budgetEn from './features/budget/en';
import budgetFr from './features/budget/fr';
import budgetDe from './features/budget/de';
import budgetEs from './features/budget/es';
import itLandscapeEn from './features/it-landscape/en';
import itLandscapeFr from './features/it-landscape/fr';
import itLandscapeDe from './features/it-landscape/de';
import itLandscapeEs from './features/it-landscape/es';
import portfolioEn from './features/portfolio/en';
import portfolioFr from './features/portfolio/fr';
import portfolioDe from './features/portfolio/de';
import portfolioEs from './features/portfolio/es';
import knowledgeEn from './features/knowledge/en';
import knowledgeFr from './features/knowledge/fr';
import knowledgeDe from './features/knowledge/de';
import knowledgeEs from './features/knowledge/es';
import contractsEn from './features/contracts/en';
import contractsFr from './features/contracts/fr';
import contractsDe from './features/contracts/de';
import contractsEs from './features/contracts/es';
import incidentsEn from './features/incidents/en';
import incidentsFr from './features/incidents/fr';
import incidentsDe from './features/incidents/de';
import incidentsEs from './features/incidents/es';
import aiEn from './features/ai/en';
import aiFr from './features/ai/fr';
import aiDe from './features/ai/de';
import aiEs from './features/ai/es';
import agentsEn from './features/agents/en';
import agentsFr from './features/agents/fr';
import agentsDe from './features/agents/de';
import agentsEs from './features/agents/es';
import hubEn from './features-hub/en';
import hubFr from './features-hub/fr';
import hubDe from './features-hub/de';
import hubEs from './features-hub/es';

import trialEn from './trial/en';
import trialFr from './trial/fr';
import trialDe from './trial/de';
import trialEs from './trial/es';

import faqEn from './faq/en';
import faqFr from './faq/fr';
import faqDe from './faq/de';
import faqEs from './faq/es';
import securityEn from './security/en';
import securityFr from './security/fr';
import securityDe from './security/de';
import securityEs from './security/es';
import changelogEn from './changelog/en';
import changelogFr from './changelog/fr';
import changelogDe from './changelog/de';
import changelogEs from './changelog/es';
import contactEn from './contact/en';
import contactFr from './contact/fr';
import contactDe from './contact/de';
import contactEs from './contact/es';

import aboutEn from './about/en';
import aboutFr from './about/fr';
import aboutDe from './about/de';
import aboutEs from './about/es';

import legalEn from './legal/en';
import legalFr from './legal/fr';

import type { HomeContent } from './home/types';
import type { OfferContent } from './offer/types';
import type { OnPremContent } from './onpremise/types';
import type { FeatureContent, FeaturesHubContent, AgentsContent } from './features/types';
import type { TrialContent } from './trial/types';
import type { FaqContent } from './faq/types';
import type { SecurityContent } from './security/types';
import type { ChangelogContent } from './changelog/types';
import type { ContactContent } from './contact/types';
import type { LegalContent } from './legal/types';
import type { AboutContent } from './about/types';

const HOME: Record<Locale, HomeContent> = {
  en: homeEn,
  fr: homeFr,
  de: homeDe,
  es: homeEs,
};

const OFFER: Record<Locale, OfferContent> = {
  en: offerEn,
  fr: offerFr,
  de: offerDe,
  es: offerEs,
};

export function getHomeContent(locale: Locale): HomeContent {
  return HOME[locale] ?? HOME[DEFAULT_LOCALE];
}

export function getOfferContent(locale: Locale): OfferContent {
  return OFFER[locale] ?? OFFER[DEFAULT_LOCALE];
}

const ONPREM: Record<Locale, OnPremContent> = {
  en: onpremEn,
  fr: onpremFr,
  de: onpremDe,
  es: onpremEs,
};

export function getOnPremContent(locale: Locale): OnPremContent {
  return ONPREM[locale] ?? ONPREM[DEFAULT_LOCALE];
}

/* ---------------- Features ---------------- */

/** Pages rendered by FeatureDeepDive. Agents has its own page. */
export type DeepDiveSlug = Exclude<FeatureSlug, 'agents'>;

/**
 * Feature content resolution. DE/ES fall back to EN until the translation
 * pass writes per-locale files; the resolver is forward-compatible and
 * picks them up automatically when they exist.
 */
const FEATURE_MAP: Record<DeepDiveSlug, Record<Locale, FeatureContent>> = {
  budget: { en: budgetEn, fr: budgetFr, de: budgetDe, es: budgetEs },
  'it-landscape': { en: itLandscapeEn, fr: itLandscapeFr, de: itLandscapeDe, es: itLandscapeEs },
  portfolio: { en: portfolioEn, fr: portfolioFr, de: portfolioDe, es: portfolioEs },
  knowledge: { en: knowledgeEn, fr: knowledgeFr, de: knowledgeDe, es: knowledgeEs },
  contracts: { en: contractsEn, fr: contractsFr, de: contractsDe, es: contractsEs },
  incidents: { en: incidentsEn, fr: incidentsFr, de: incidentsDe, es: incidentsEs },
  ai: { en: aiEn, fr: aiFr, de: aiDe, es: aiEs },
};

export function getFeatureContent(slug: DeepDiveSlug, locale: Locale): FeatureContent {
  return FEATURE_MAP[slug][locale] ?? FEATURE_MAP[slug][DEFAULT_LOCALE];
}

/* ---------------- Agents page ---------------- */
/*
 * The Agents page is richer than a standard feature deep-dive (it adds a
 * transparency / connector lead-capture block and a Deploy-free CTA), so it
 * has its own content type and resolver and is rendered by AgentsPage.astro.
 * EN-first: fr/de/es re-export en until the translation pass (A-37).
 */
const AGENTS: Record<Locale, AgentsContent> = {
  en: agentsEn,
  fr: agentsFr,
  de: agentsDe,
  es: agentsEs,
};

export function getAgentsContent(locale: Locale): AgentsContent {
  return AGENTS[locale] ?? AGENTS[DEFAULT_LOCALE];
}

/* ---------------- Features hub ---------------- */

const HUB: Record<Locale, FeaturesHubContent> = {
  en: hubEn,
  fr: hubFr,
  de: hubDe,
  es: hubEs,
};

export function getFeaturesHubContent(locale: Locale): FeaturesHubContent {
  return HUB[locale] ?? HUB[DEFAULT_LOCALE];
}

/* ---------------- Trial ---------------- */

const TRIAL: Record<Locale, TrialContent> = {
  en: trialEn,
  fr: trialFr,
  de: trialDe,
  es: trialEs,
};

export function getTrialContent(locale: Locale): TrialContent {
  return TRIAL[locale] ?? TRIAL[DEFAULT_LOCALE];
}

/* ---------------- Secondary pages (FAQ / Security / Changelog / Contact) ---------------- */
/*
 * EN is authoritative. Phase 6 fills in FR/DE/ES. Resolvers fall back
 * to EN in the meantime, with loaders wired for forward-compatibility.
 */

const FAQ: Record<Locale, FaqContent> = { en: faqEn, fr: faqFr, de: faqDe, es: faqEs };
export function getFaqContent(locale: Locale): FaqContent {
  return FAQ[locale] ?? FAQ[DEFAULT_LOCALE];
}

const SECURITY: Record<Locale, SecurityContent> = { en: securityEn, fr: securityFr, de: securityDe, es: securityEs };
export function getSecurityContent(locale: Locale): SecurityContent {
  return SECURITY[locale] ?? SECURITY[DEFAULT_LOCALE];
}

const CHANGELOG: Record<Locale, ChangelogContent> = { en: changelogEn, fr: changelogFr, de: changelogDe, es: changelogEs };
export function getChangelogContent(locale: Locale): ChangelogContent {
  return CHANGELOG[locale] ?? CHANGELOG[DEFAULT_LOCALE];
}

const CONTACT: Record<Locale, ContactContent> = { en: contactEn, fr: contactFr, de: contactDe, es: contactEs };
export function getContactContent(locale: Locale): ContactContent {
  return CONTACT[locale] ?? CONTACT[DEFAULT_LOCALE];
}

const LEGAL: Partial<Record<Locale, LegalContent>> = { en: legalEn, fr: legalFr };
export function getLegalContent(locale: Locale): LegalContent {
  return LEGAL[locale] ?? LEGAL[DEFAULT_LOCALE]!;
}

const ABOUT: Record<Locale, AboutContent> = { en: aboutEn, fr: aboutFr, de: aboutDe, es: aboutEs };

export function getAboutContent(locale: Locale): AboutContent {
  return ABOUT[locale] ?? ABOUT[DEFAULT_LOCALE];
}
