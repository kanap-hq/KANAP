import i18n, { type InitOptions, type Resource, type ResourceLanguage } from 'i18next';
import { initReactI18next } from 'react-i18next';
import { z } from 'zod';
import { formatCount } from './formatters';
import { mergeAbbreviationPeriods } from '../lib/dateFormat';
import { bundledLocales, localeLoaders, type TranslationTree } from './localeSource';

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

const LOCALE_FILE = /\.\.\/locales\/([^/]+)\/([^/]+)\.json$/;

/** `../locales/<language>/<namespace>.json` paths, by language then namespace. */
function byLocale<T>(files: Record<string, T>): Map<SupportedLocale, Map<string, T>> {
  const result = new Map<SupportedLocale, Map<string, T>>();
  for (const [path, value] of Object.entries(files)) {
    const match = path.match(LOCALE_FILE);
    if (!match) continue;
    const [, locale, namespace] = match;
    if (!isSupportedLocale(locale)) continue;
    if (!result.has(locale)) result.set(locale, new Map());
    result.get(locale)!.set(namespace, value);
  }
  return result;
}

const namespaceLoaders = byLocale(localeLoaders);

/** Pending or finished downloads, by `<language>/<namespace>`; a failed one is forgotten so it can be retried. */
const namespaceLoads = new Map<string, Promise<void>>();

function loadNamespace(locale: SupportedLocale, namespace: string): Promise<void> {
  if (i18n.store && i18n.hasResourceBundle(locale, namespace)) return Promise.resolve();
  const load = namespaceLoaders.get(locale)?.get(namespace);
  if (!load) return Promise.resolve();
  const id = `${locale}/${namespace}`;
  let pending = namespaceLoads.get(id);
  if (!pending) {
    pending = load().then(
      (tree) => {
        i18n.addResourceBundle(locale, namespace, tree, true, true);
      },
      (error: unknown) => {
        namespaceLoads.delete(id);
        throw error;
      },
    );
    namespaceLoads.set(id, pending);
  }
  return pending;
}

async function fetchLocale(locale: SupportedLocale): Promise<ResourceLanguage> {
  const entries = await Promise.all(
    [...(namespaceLoaders.get(locale) ?? new Map<string, () => Promise<TranslationTree>>())].map(
      async ([namespace, load]) => [namespace, await load()] as const,
    ),
  );
  return Object.fromEntries(entries) as ResourceLanguage;
}

/** Downloads every namespace of a language and adds it to i18next (no-op for those already there). */
export async function loadLocale(locale: SupportedLocale): Promise<void> {
  await Promise.all([...(namespaceLoaders.get(locale)?.keys() ?? [])].map((namespace) => loadNamespace(locale, namespace)));
}

/** Switches the interface language once its texts are downloaded, so nothing shows a raw key meanwhile. */
export async function changeAppLanguage(value: string | null | undefined): Promise<void> {
  const locale = resolveSupportedLocale(value);
  try {
    await loadLocale(locale);
  } catch (error) {
    // Keep the current language rather than show raw keys; the next change retries the download.
    console.error(`Could not load the ${locale} texts`, error);
    return;
  }
  await i18n.changeLanguage(locale);
}

/** The language before any user profile: the stored override, else the browser language. */
export function initialLocale(): SupportedLocale {
  try {
    const stored = localStorage.getItem(LANGUAGE_OVERRIDE_STORAGE_KEY);
    if (stored) return resolveSupportedLocale(stored);
  } catch {
    // Storage unavailable: use the browser language.
  }
  return detectBrowserLocale();
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

/**
 * Formatters and other additions that need the initialised i18next services
 * (`i18n.services.formatter.add(...)`). Runs after every `init`.
 */
function registerPostInit(): void {
  // `{{count, count}}` in a text writes the number with the thousand separator of the language.
  i18n.services.formatter?.add('count', (value: unknown, lng: string | undefined) =>
    typeof value === 'number' ? formatCount(value, lng ?? 'en') : String(value ?? ''));
}

i18n
  .use(initReactI18next)
  .use({
    type: 'postProcessor',
    name: 'abbreviationPeriod',
    process: (value: string, _key: unknown, options: { lng?: string } | undefined, translator: { language?: string }) =>
      mergeAbbreviationPeriods(value, options?.lng ?? translator?.language ?? 'en'),
  });

// A component that calls `i18n.changeLanguage` directly still gets its texts: they load after the
// switch, then the language is applied again so `resolvedLanguage` points at them.
i18n.on('languageChanged', (lng) => {
  const locale = resolveSupportedLocale(lng);
  if (i18n.hasResourceBundle(locale, 'common')) return;
  void loadLocale(locale).then(
    () => {
      if (i18n.language === lng) void i18n.changeLanguage(lng);
    },
    (error: unknown) => console.error(`Could not load the ${locale} texts`, error),
  );
});

function i18nOptions(lng: SupportedLocale, resources: Resource): InitOptions {
  return {
    lng,
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
    // Nothing is saved: a key missing in the active language downloads its English namespace (and
    // `common`, the fallback namespace), and the components re-render on the store's `added` event.
    saveMissing: true,
    missingKeyHandler: (lngs, namespace) => {
      for (const fallback of lngs) {
        const locale = resolveSupportedLocale(fallback);
        for (const ns of new Set([namespace, 'common'])) {
          loadNamespace(locale, ns).catch((error: unknown) =>
            console.error(`Could not load the ${locale} ${ns} texts`, error),
          );
        }
      }
    },
    react: {
      bindI18nStore: 'added',
    },
    returnNull: false,
  };
}

/**
 * Downloads the texts of the initial language, then initialises i18next with them. The root render
 * waits for it (`main.tsx`), so the first screen is already in the user's language. English, the
 * fallback language, is downloaded per namespace only when a key is missing in the active language.
 */
export async function startI18n(): Promise<void> {
  let lng = initialLocale();
  const resources: Resource = {};
  try {
    resources[lng] = await fetchLocale(lng);
  } catch (error) {
    console.error(`Could not load the ${lng} texts`, error);
    if (lng !== 'en') {
      lng = 'en';
      resources.en = await fetchLocale('en').catch(() => ({}) as ResourceLanguage);
    }
  }
  await i18n.init(i18nOptions(lng, resources));
  registerPostInit();
}

/** Tests only: every language is already in memory, so i18next starts at import, as it always did. */
function startWithBundledLocales(files: Record<string, TranslationTree>): Promise<void> {
  const resources: Resource = {};
  for (const [locale, namespaces] of byLocale(files)) {
    resources[locale] = Object.fromEntries(namespaces) as ResourceLanguage;
  }
  const ready = i18n.init(i18nOptions(initialLocale(), resources));
  registerPostInit();
  return ready.then(() => undefined);
}

/** Resolves once i18next holds the initial language. */
export const i18nReady: Promise<void> = bundledLocales ? startWithBundledLocales(bundledLocales) : startI18n();

export default i18n;
