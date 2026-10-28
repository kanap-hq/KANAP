import { BadRequestException } from '@nestjs/common';
import { matchCatalogAliases, normalizeAlias, type CatalogTranslations } from './catalog-codes';
import { shippedLabelIn, withShippedLabels } from './catalog-shipped-labels';

export type CatalogOptionLike = { code: string; label?: string | null; deprecated?: boolean; translations?: CatalogTranslations; shippedLabels?: string[] };

/**
 * Shared resolution policy for catalog values coming from the API, CSV or Plaid: an input matches an
 * entry when it equals its code or its name (trimmed, case-insensitive), else, for an import, a label
 * the app shows for a shipped value in any language (`withShippedLabels`). Exactly one entry must match;
 * several matches are an ambiguity and are refused rather than letting "the last alias win".
 *
 * A deprecated entry can only be named to keep the value a record already holds (`current`) when
 * `excludeDeprecated` is set: it is then no longer offered to new records, as the screen hides it.
 * Callers that accept a retired value (an administrator zone still assignable by a bulk action)
 * keep the default.
 */
export function findCatalogOption<T extends CatalogOptionLike>(
  input: unknown,
  options: T[],
  current?: string | null,
  excludeDeprecated = false,
): T | null {
  const key = normalizeAlias(input);
  if (!key) return null;
  const currentKey = normalizeAlias(current);
  const selectable = excludeDeprecated
    ? options.filter((option) => !option.deprecated || normalizeAlias(option.code) === currentKey)
    : options;
  const matches = matchCatalogAliases(selectable, key);
  const distinct = [...new Map(matches.map((option) => [option.code, option])).values()];
  if (distinct.length > 1) throw new BadRequestException(`"${String(input)}" matches several values (${distinct.map((option) => option.label || option.code).join(', ')}); use the exact name of one of them`);
  return distinct[0] ?? null;
}

/** Resolves to a code; unknown values are returned as typed so the caller decides (tolerant import) or throws. */
export function resolveCatalogCode<T extends CatalogOptionLike>(input: unknown, options: T[], mode: 'strict' | 'tolerant' = 'tolerant'): string | null {
  if (input === null || input === undefined || String(input).trim() === '') return null;
  const option = findCatalogOption(input, options);
  if (option) return option.code;
  if (mode === 'strict') throw new BadRequestException(`Unknown value "${String(input)}"; use one of ${options.map((item) => item.label || item.code).join(', ')}`);
  return String(input).trim();
}

/**
 * Import hooks need the effective catalogs; the entity CSV service preloads them under the tenant lock.
 * They come with the labels shown for the shipped values in every language, so a value typed as the
 * user sees it ("Serveur physique") resolves to its code.
 */
export async function requireImportCatalogs(context: { itOpsSettings?: import('./it-ops-settings.service').ItOpsSettings }): Promise<import('./it-ops-settings.service').ItOpsSettings> {
  if (!context.itOpsSettings) throw new Error('CSV import context is missing the IT Ops catalogs');
  return withShippedLabels(context.itOpsSettings);
}

/** Replaces catalog codes by names on an export row (arrays element-wise); unknown codes stay as they are. */
export function exportCatalogLabels(row: Record<string, any>, fields: Record<string, CatalogOptionLike[]>): void {
  for (const [field, options] of Object.entries(fields)) {
    const value = row[field];
    if (value === null || value === undefined) continue;
    const labelOf = (code: unknown) => options.find((option) => option.code === String(code))?.label || String(code);
    row[field] = Array.isArray(value) ? value.map(labelOf) : labelOf(value);
  }
}

/**
 * `exportCatalogLabels` in the language of the file: a value still carrying its shipped label is
 * written as the screen shows it in `language` ("Actif", "Faible"); a name the tenant gave stays.
 */
export function exportCatalogLabelsIn(
  row: Record<string, any>,
  fields: Record<string, { list: string; options: CatalogOptionLike[] }>,
  language: 'en' | 'fr' | 'de' | 'es',
): void {
  for (const [field, { list, options }] of Object.entries(fields)) {
    const value = row[field];
    if (value === null || value === undefined) continue;
    const labelOf = (code: unknown) => {
      const option = options.find((item) => item.code === String(code));
      if (!option) return String(code);
      return shippedLabelIn(list, option, language) ?? (option.label || String(code));
    };
    row[field] = Array.isArray(value) ? value.map(labelOf) : labelOf(value);
  }
}
