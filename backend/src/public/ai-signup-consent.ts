/**
 * Versions of the text of the consent box of the trial sign-up form ("I agree that Plaid, the
 * assistant, uses the included model..."). A version names the text of the box on the public
 * website (`marketing/web/src/content/trial/*.ts`, every language): any change to that text adds
 * a version here, and the form sends the new one. Older versions stay listed so that a form
 * deployed before the API keeps working.
 *
 * Each version names the place where its text says the questions are processed. At activation
 * the assistant is turned on only when the platform's included model is processed in that place
 * (`consentLocationMatches`).
 */
export const AI_SIGNUP_CONSENT_VERSIONS = {
  '2026-11-01': { location: 'US' },
} as const;

export type AiSignupConsentVersion = keyof typeof AI_SIGNUP_CONSENT_VERSIONS;

export type AiSignupConsentLocation = (typeof AI_SIGNUP_CONSENT_VERSIONS)[AiSignupConsentVersion]['location'];

export const CURRENT_AI_SIGNUP_CONSENT_VERSION: AiSignupConsentVersion = '2026-11-01';

/**
 * The ways the platform console may write a place (`platform_ai_config.disclosure_location`),
 * compared without case, accents or punctuation.
 */
const LOCATION_NAMES: Record<AiSignupConsentLocation, readonly string[]> = {
  US: ['us', 'usa', 'united states', 'united states of america', 'etats unis', "etats-unis d'amerique"],
};

export function isKnownAiSignupConsentVersion(value: unknown): value is AiSignupConsentVersion {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(AI_SIGNUP_CONSENT_VERSIONS, value);
}

/** The place the text of a version names, null for an unknown version. */
export function aiSignupConsentLocation(version: string | null | undefined): AiSignupConsentLocation | null {
  return isKnownAiSignupConsentVersion(version) ? AI_SIGNUP_CONSENT_VERSIONS[version].location : null;
}

function normalizePlace(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[-\s]+/g, ' ')
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/ +/g, ' ')
    .trim();
}

/** True when `place` (free text from the platform console) is the place the version names. */
export function consentLocationMatches(version: string | null | undefined, place: string | null | undefined): boolean {
  const location = aiSignupConsentLocation(version);
  if (!location || !place) return false;
  const wanted = normalizePlace(place);
  return wanted !== '' && LOCATION_NAMES[location].some((name) => normalizePlace(name) === wanted);
}
