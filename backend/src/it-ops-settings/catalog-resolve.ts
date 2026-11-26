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
 * A record's write applies that rule through `resolveOfferedCatalogCode`; the default (every entry)
 * serves the reads that only name a stored value (filters, exports, the import's lookups).
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

/** The values a record holds, normalized for comparison: one code, a list of codes, or none. */
function heldKeys(held: unknown): Set<string> {
  const values = Array.isArray(held) ? held : held == null ? [] : [held];
  return new Set(values.map(normalizeAlias).filter(Boolean));
}

/**
 * The entries a record may take (rule P7, maintainer's decision of 2026-11-23): the entries still
 * offered, and a retired one only on the record that already holds it (`held`: its value or its
 * values). Every write of a catalog value (screen, Plaid, bulk change, import) offers this list.
 */
export function offeredCatalogOptions<T extends CatalogOptionLike>(options: T[], held?: unknown): T[] {
  const keys = heldKeys(held);
  return options.filter((option) => !option.deprecated || keys.has(normalizeAlias(option.code)));
}

/** The offered entries as a refusal names them: `code (name)`, or the code alone when the name is the code. */
export function offeredCatalogList(options: CatalogOptionLike[], held?: unknown): string {
  return offeredCatalogOptions(options, held)
    .map((option) => {
      const label = String(option.label || '').trim();
      return label && label !== option.code ? `${option.code} (${label})` : option.code;
    })
    .join(', ');
}

/** Where a refused value comes from: the settings list (`connectionTypes`) the screens name it from. */
export type CatalogRefusalOptions = { held?: unknown; what: string; list?: string; unknownCode?: string };

/**
 * The refusal of a catalog value (rule P7), always coded so that the screens say it in the person's
 * language: `catalog_value_retired` for a retired value, `unknownCode` (by default
 * `catalog_value_unknown`) for one the catalog does not know. Its params: `value` (a retired value by
 * its catalog name, an unknown one as typed), `allowed` (the values the record may take, which Plaid,
 * the API and the import report show), and for a retired value its code and its list (`valueCode`,
 * `list`), from which a screen names it as the field's selector does. `message` is the English text
 * Plaid and the API read.
 */
export function catalogValueRefusal(
  refusal: { value: string; allowed: string; retired: boolean; valueCode?: string; list?: string },
  message: string,
  unknownCode = 'catalog_value_unknown',
  detail?: CatalogRefusalDetail,
): BadRequestException {
  const { value, allowed, retired, valueCode, list } = refusal;
  const error = new BadRequestException({
    code: retired ? 'catalog_value_retired' : unknownCode,
    message,
    params: { value, allowed, ...(retired && valueCode ? { valueCode } : {}), ...(retired && list ? { list } : {}) },
  });
  return detail ? Object.assign(error, { catalogRefusal: detail }) : error;
}

/**
 * What Plaid needs to say a catalog refusal with the names the person reads (`ai-catalog-refusal.ts`):
 * the field, its list, the refused value and the entries the record may take. It rides on the
 * exception, outside its response: the API and the import keep their answer.
 */
export type CatalogRefusalDetail = {
  what: string;
  list?: string;
  retired: boolean;
  value: string;
  valueCode?: string;
  offered: Array<{ code: string; label?: string | null }>;
  /** What the field also takes besides the values (`or null (not set)` for a filter). */
  orElse?: string;
};

/** The detail a catalog refusal carries for Plaid, if any. */
export function catalogRefusalDetailOf(error: unknown): CatalogRefusalDetail | null {
  const detail = (error as { catalogRefusal?: CatalogRefusalDetail } | null)?.catalogRefusal;
  return detail && Array.isArray(detail.offered) ? detail : null;
}

/**
 * Rule P7 on a write: `input` (a code or an exact name) resolves to the code of an offered entry.
 * A retired entry is refused unless the record already holds it; a value the catalog does not know
 * is refused too, unless the record already holds it (a value stored before the catalog changed
 * stays on its record). Both refusals are coded (`catalogValueRefusal`) and list the values the
 * record may take.
 */
export function resolveOfferedCatalogCode(input: unknown, options: CatalogOptionLike[], opts: CatalogRefusalOptions): string {
  const value = String(input ?? '').trim();
  const option = findCatalogOption(value, options);
  const keys = heldKeys(opts.held);
  if (option && (!option.deprecated || keys.has(normalizeAlias(option.code)))) return option.code;
  if (!option && keys.has(normalizeAlias(value))) {
    const held = (Array.isArray(opts.held) ? opts.held : [opts.held]).find((item) => normalizeAlias(item) === normalizeAlias(value));
    return String(held);
  }
  const allowed = offeredCatalogList(options, opts.held);
  const offered = offeredCatalogOptions(options, opts.held).map(({ code, label }) => ({ code, label }));
  if (!option) {
    throw catalogValueRefusal({ value, allowed, retired: false }, `Unknown ${opts.what} "${value}". Use one of: ${allowed}.`, opts.unknownCode, {
      what: opts.what, list: opts.list, retired: false, value, offered,
    });
  }
  const name = String(option.label || '').trim() || option.code;
  throw catalogValueRefusal(
    { value: name, allowed, retired: true, valueCode: option.code, list: opts.list },
    `The ${opts.what} "${name}" is retired: only a record that already holds it keeps it. Use one of: ${allowed}.`,
    undefined,
    { what: opts.what, list: opts.list, retired: true, value: name, valueCode: option.code, offered },
  );
}

/** `resolveOfferedCatalogCode` for each value of a list field (access methods, protocols), duplicates dropped. */
export function resolveOfferedCatalogCodes(inputs: unknown, options: CatalogOptionLike[], opts: CatalogRefusalOptions): string[] {
  const values = Array.isArray(inputs) ? inputs : inputs == null ? [] : [inputs];
  const codes = values
    .filter((item) => String(item ?? '').trim() !== '')
    .map((item) => resolveOfferedCatalogCode(item, options, opts));
  return [...new Set(codes)];
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
