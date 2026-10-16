import i18n, { type Resource, type ResourceLanguage } from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';
import { z } from 'zod';
import { formatCount } from './formatters';
import { mergeAbbreviationPeriods } from '../lib/dateFormat';

export const LANGUAGE_OVERRIDE_STORAGE_KEY = 'kanap_language';
export const NAMESPACES = [
  'common',
  'nav',
  'auth',
  'settings',
  'portfolio',
  'ops',
  'master-data',
  'it',
  'admin',
  'knowledge',
  'ai',
  'agents',
  'validation',
  'errors',
  'grid',
] as const;
export const SUPPORTED_LOCALE_CODES = ['en', 'fr', 'de', 'es'] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALE_CODES)[number];

export const SUPPORTED_LANGUAGES = [
  { code: 'en', nativeLabel: 'English' },
  { code: 'fr', nativeLabel: 'Français' },
  { code: 'de', nativeLabel: 'Deutsch' },
  { code: 'es', nativeLabel: 'Español' },
] as const satisfies ReadonlyArray<{ code: SupportedLocale; nativeLabel: string }>;

type TranslationValue = string | { [key: string]: TranslationValue };
type TranslationTree = { [key: string]: TranslationValue };

function isSupportedLocale(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALE_CODES as readonly string[]).includes(value);
}

export function resolveSupportedLocale(value: string | null | undefined): SupportedLocale {
  const normalized = String(value ?? '').trim().toLowerCase().split('-')[0];
  return isSupportedLocale(normalized) ? normalized : 'en';
}

export function detectBrowserLocale(): SupportedLocale {
  if (typeof navigator === 'undefined') {
    return 'en';
  }

  const candidates = [...(navigator.languages ?? []), navigator.language].filter(
    (candidate): candidate is string => typeof candidate === 'string' && candidate.trim().length > 0,
  );

  for (const candidate of candidates) {
    const resolved = resolveSupportedLocale(candidate);
    const normalized = candidate.trim().toLowerCase().split('-')[0];
    if (resolved !== 'en' || normalized === 'en') {
      return resolved;
    }
  }

  return 'en';
}

const localeModules = import.meta.glob<{ default: TranslationTree }>('../locales/*/*.json', { eager: true });
const resources = SUPPORTED_LOCALE_CODES.reduce<Resource>((acc, locale) => {
  acc[locale] = {} as ResourceLanguage;
  return acc;
}, {} as Resource);

for (const [path, module] of Object.entries(localeModules)) {
  const match = path.match(/\.\.\/locales\/([^/]+)\/([^/]+)\.json$/);
  if (!match) continue;

  const [, locale, namespace] = match;
  if (!isSupportedLocale(locale)) continue;
  (resources[locale] as ResourceLanguage)[namespace] = module.default;
}

z.setErrorMap((issue) => {
  const t = i18n.t.bind(i18n);

  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      if (issue.input == null) {
        return { message: t('validation:required') };
      }
      return { message: t('validation:invalidType') };
    case z.ZodIssueCode.too_small:
      if (issue.origin === 'string' && Number(issue.minimum) === 1) {
        return { message: t('validation:required') };
      }
      if (issue.origin === 'string') {
        return { message: t('validation:minLength', { count: Number(issue.minimum) }) };
      }
      break;
    case z.ZodIssueCode.too_big:
      if (issue.origin === 'string') {
        return { message: t('validation:maxLength', { count: Number(issue.maximum) }) };
      }
      break;
    case z.ZodIssueCode.invalid_format:
      if (issue.format === 'email') {
        return { message: t('validation:invalidEmail') };
      }
      return { message: t('validation:invalidType') };
    case z.ZodIssueCode.invalid_value:
      return { message: t('validation:invalidType') };
    default:
      break;
  }

  return undefined;
});

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .use({
    type: 'postProcessor',
    name: 'abbreviationPeriod',
    process: (value: string, _key: unknown, options: { lng?: string } | undefined, translator: { language?: string }) =>
      mergeAbbreviationPeriods(value, options?.lng ?? translator?.language ?? 'en'),
  })
  .init({
    postProcess: ['abbreviationPeriod'],
    resources,
    fallbackLng: 'en',
    supportedLngs: [...SUPPORTED_LOCALE_CODES],
    load: 'languageOnly',
    cleanCode: true,
    nonExplicitSupportedLngs: true,
    defaultNS: 'common',
    fallbackNS: 'common',
    ns: [...NAMESPACES],
    interpolation: {
      escapeValue: false,
    },
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: LANGUAGE_OVERRIDE_STORAGE_KEY,
      // Explicit overrides are stored manually; browser auto-detect must stay non-sticky.
      caches: [],
    },
    returnNull: false,
  });

// `{{count, count}}` in a text writes the number with the thousand separator of the language.
i18n.services.formatter?.add('count', (value: unknown, lng: string | undefined) =>
  typeof value === 'number' ? formatCount(value, lng ?? 'en') : String(value ?? ''));

export default i18n;
