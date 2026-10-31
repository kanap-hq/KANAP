/**
 * Versions of the text of the consent box of the trial sign-up form ("I agree that Plaid, the
 * assistant, uses the included model..."). A version names the text of the box on the public
 * website (`marketing/web/src/content/trial/*.ts`, every language): any change to that text adds
 * a version here, and the form sends the new one. Older versions stay listed so that a form
 * deployed before the API keeps working.
 */
export const AI_SIGNUP_CONSENT_VERSIONS = ['2026-11-01'] as const;

export type AiSignupConsentVersion = (typeof AI_SIGNUP_CONSENT_VERSIONS)[number];

export const CURRENT_AI_SIGNUP_CONSENT_VERSION: AiSignupConsentVersion = '2026-11-01';

export function isKnownAiSignupConsentVersion(value: unknown): value is AiSignupConsentVersion {
  return typeof value === 'string' && (AI_SIGNUP_CONSENT_VERSIONS as readonly string[]).includes(value);
}
