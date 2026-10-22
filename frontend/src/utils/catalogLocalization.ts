import type { CatalogLocale, CatalogTranslations } from '../services/itOpsSettings';

export type LocalizableCatalogItem = { code: string; label: string; description?: string; translations?: CatalogTranslations };
export type DefaultCopy = { label: string; description?: string };
/** A label a tenant may still store after a shipped rename, with the text shown in each language. */
export type FormerCopy = { source: string; en: string; fr: string; de: string; es: string };
/** Shipped defaults for a catalog: the canonical English text per code and its translation per locale. */
export type CatalogDefaults = {
  source: Record<string, DefaultCopy>;
  translated: (locale: string, code: string) => DefaultCopy | undefined;
  /** Recognized while the stored label equals `source`. Not part of the defaults a new tenant receives. */
  former?: Record<string, readonly FormerCopy[]>;
};

export function toCatalogLocale(language: string | undefined): CatalogLocale {
  const short = (language || 'en').split('-')[0];
  return (['en', 'fr', 'de', 'es'].includes(short) ? short : 'en') as CatalogLocale;
}

/**
 * Display projection of one catalog value, field by field: the tenant's translation for the locale, else the
 * shipped translation when the base field is still the shipped default, else the base text. The raw item is
 * never modified; editors keep working on base text.
 */
export function localizeCatalogItem<T extends LocalizableCatalogItem>(item: T, locale: CatalogLocale, defaults?: CatalogDefaults): T {
  const tenant = item.translations?.[locale];
  const source = defaults?.source[item.code];
  const shipped = source ? defaults?.translated(locale, item.code) : undefined;
  const former = defaults?.former?.[item.code]?.find((entry) => entry.source === item.label);
  const label = tenant?.label
    || (source && shipped && item.label === source.label ? shipped.label : undefined)
    || (former ? former[locale] : undefined)
    || item.label;
  const description = item.description === undefined
    ? undefined
    : tenant?.description || (source && shipped && item.description === (source.description ?? '') ? shipped.description : undefined) || item.description;
  if (label === item.label && description === item.description) return item;
  return { ...item, label, ...(description === undefined ? {} : { description }) };
}

export function localizeCatalogList<T extends LocalizableCatalogItem>(list: T[] | undefined, locale: CatalogLocale, defaults?: CatalogDefaults): T[] {
  if (!list) return [];
  let changed = false;
  const next = list.map((item) => { const localized = localizeCatalogItem(item, locale, defaults); if (localized !== item) changed = true; return localized; });
  return changed ? next : list;
}

/** What a value will display in `locale` once `translations` is saved (for the translation dialog preview). */
export function previewCatalogField(item: LocalizableCatalogItem, locale: CatalogLocale, field: 'label' | 'description', translations: CatalogTranslations | undefined, defaults?: CatalogDefaults): string {
  const localized = localizeCatalogItem({ ...item, translations }, locale, defaults);
  return field === 'label' ? localized.label : localized.description ?? '';
}
