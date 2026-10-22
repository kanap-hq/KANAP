import type { ItOpsSettings } from './it-ops-settings.service';
import { SHIPPED_CATALOG_LABELS, type ShippedLabelText } from './catalog-shipped-labels.data';

export { SHIPPED_CATALOG_LABELS, type ShippedLabels, type ShippedLabelText } from './catalog-shipped-labels.data';

const CATALOG_LANGUAGES = ['en', 'fr', 'de', 'es'] as const;
type CatalogLanguage = (typeof CATALOG_LANGUAGES)[number];

/** The shipped text of a value whose stored label is still the shipped source, or a former source. */
function shippedTextOf(list: string, option: { code?: string | null; label?: string | null }): ShippedLabelText | undefined {
  const shipped = option.code ? SHIPPED_CATALOG_LABELS[list]?.[option.code] : undefined;
  if (!shipped) return undefined;
  if (shipped.source === option.label) return shipped;
  return shipped.former?.find((entry) => entry.source === option.label);
}

/**
 * The label a catalog value is shown with in `language`, while the tenant keeps the shipped label
 * or a former shipped label. Null when the tenant renamed it.
 */
export function shippedLabelIn(
  list: string,
  option: { code?: string | null; label?: string | null },
  language: CatalogLanguage,
): string | null {
  return shippedTextOf(list, option)?.[language] ?? null;
}

/** The labels a catalog value is shown with in any language, while the tenant keeps the shipped label or a former one; none otherwise. */
export function shippedLabelsOf(list: string, option: { code?: string | null; label?: string | null }): string[] {
  const text = shippedTextOf(list, option);
  if (!text) return [];
  return [...new Set(CATALOG_LANGUAGES.map((language) => text[language]))];
}

/**
 * The catalogs with, on each value still carrying its shipped label or a former one, the labels the
 * app shows for it in every language (`shippedLabels`), so an import accepts them. Other values are unchanged.
 */
export function withShippedLabels(settings: ItOpsSettings): ItOpsSettings {
  const next: Record<string, unknown> = { ...settings };
  for (const list of Object.keys(SHIPPED_CATALOG_LABELS)) {
    const options = (settings as unknown as Record<string, unknown>)[list];
    if (!Array.isArray(options)) continue;
    next[list] = options.map((option) => {
      const shippedLabels = shippedLabelsOf(list, option);
      return shippedLabels.length ? { ...option, shippedLabels } : option;
    });
  }
  return next as unknown as ItOpsSettings;
}
