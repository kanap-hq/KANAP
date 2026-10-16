import type { ItOpsSettings } from './it-ops-settings.service';
import { SHIPPED_CATALOG_LABELS } from './catalog-shipped-labels.data';

export { SHIPPED_CATALOG_LABELS, type ShippedLabels } from './catalog-shipped-labels.data';

/** The labels a catalog value is shown with in any language, while the tenant keeps the shipped label; none otherwise. */
export function shippedLabelsOf(list: string, option: { code?: string | null; label?: string | null }): string[] {
  const shipped = option.code ? SHIPPED_CATALOG_LABELS[list]?.[option.code] : undefined;
  if (!shipped || shipped.source !== option.label) return [];
  return [...new Set([shipped.en, shipped.fr, shipped.de, shipped.es])];
}

/**
 * The catalogs with, on each value still carrying its shipped label, the labels the app shows for
 * it in every language (`shippedLabels`), so an import accepts them. Other values are unchanged.
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
