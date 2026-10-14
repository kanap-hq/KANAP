/**
 * The general terms of sale (GTC) a tenant accepts before subscribing (GTC art. 2). The French
 * text is binding; the English one is a translation.
 *
 * Bump GTC_VERSION to the publication date whenever the `sales` text of
 * `marketing/web/src/content/legal/fr.ts` or `marketing/web/src/content/legal/en.ts` changes:
 * subscribing then requires accepting the new version. The Enterprise Support form of the
 * marketing site sends its own copy (`marketing/web/src/content/legal/terms-version.ts`): bump
 * both together (support-invoice.spec.ts checks they match).
 */
export const GTC_VERSION = '2026-10-12';

export const GTC_URLS = {
  fr: 'https://kanap.net/fr/sales',
  en: 'https://kanap.net/sales',
} as const;

/** How the subscriber pays: card (Stripe Checkout) or bank transfer (Stripe invoice). */
export type TermsPaymentPath = 'card' | 'transfer';
