import { BadRequestException } from '@nestjs/common';

/**
 * Catalog codes are stable identifiers generated from the name at creation and never shown to users.
 * Names (labels) are the visible identity: import and the API accept a code or a name, so every alias
 * (code or name, normalized) must designate a single entry of a list.
 */

const MAX_CODE_LENGTH = 64;
const GENERATED_BASE_LENGTH = 56;

export const CATALOG_LOCALES = ['en', 'fr', 'de', 'es'] as const;
export type CatalogLocale = (typeof CATALOG_LOCALES)[number];
/** Per-locale overrides of a value's name and description; an absent field falls back (default translation, then base text). */
export type CatalogTranslations = Partial<Record<CatalogLocale, { label?: string; description?: string }>>;

/** Keeps known locales and non-empty fields only; returns undefined when nothing remains. */
export function normalizeTranslations(raw: unknown): CatalogTranslations | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const result: CatalogTranslations = {};
  for (const locale of CATALOG_LOCALES) {
    const entry = (raw as Record<string, unknown>)[locale];
    if (!entry || typeof entry !== 'object') continue;
    const label = String((entry as Record<string, unknown>).label ?? '').trim();
    const description = String((entry as Record<string, unknown>).description ?? '').trim();
    if (label.length > 200) throw new BadRequestException(`Translation "${label}" is too long (200 characters maximum)`);
    if (description.length > 4000) throw new BadRequestException('A translated description is too long (4000 characters maximum)');
    if (!label && !description) continue;
    result[locale] = { ...(label ? { label } : {}), ...(description ? { description } : {}) };
  }
  return Object.keys(result).length ? result : undefined;
}

/** Every alias a value answers to: its code, its name and its translated names. */
export function catalogAliases(row: { code?: unknown; label?: unknown; translations?: CatalogTranslations }): string[] {
  const aliases = [normalizeAlias(row.code), normalizeAlias(row.label)];
  for (const locale of CATALOG_LOCALES) aliases.push(normalizeAlias(row.translations?.[locale]?.label));
  return [...new Set(aliases.filter(Boolean))];
}

/**
 * The entries `key` (normalized) designates: by code, name or tenant translation first; when none
 * does, by a label the app shows for a shipped value (`shippedLabels`, added for imports by
 * `withShippedLabels`). A tenant's own names therefore always win over the shipped translations.
 */
export function matchCatalogAliases<T extends { code?: unknown; label?: unknown; translations?: CatalogTranslations; shippedLabels?: string[] }>(options: T[], key: string): T[] {
  const direct = options.filter((option) => catalogAliases(option).includes(key));
  if (direct.length) return direct;
  return options.filter((option) => (option.shippedLabels ?? []).some((label) => normalizeAlias(label) === key));
}

export function normalizeAlias(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

/** Slug of a name: accents stripped, lowercase, non-alphanumerics folded to `_`. Empty when nothing usable remains. */
export function slugifyCatalogCode(label: unknown): string {
  return String(label ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, GENERATED_BASE_LENGTH)
    .replace(/_+$/g, '');
}

/** Generates a code for `label` that is not in `taken`, and reserves it. */
export function generateCatalogCode(label: unknown, taken: Set<string>): string {
  const base = slugifyCatalogCode(label) || 'value';
  let candidate = base;
  for (let suffix = 2; taken.has(candidate); suffix += 1) candidate = `${base}_${suffix}`;
  taken.add(candidate);
  return candidate;
}

export type CatalogRowLike = { code?: unknown; label?: unknown; translations?: unknown; [key: string]: unknown };
export type PrepareListOptions = {
  /** Human name of the list for error messages. */
  listName: string;
  /** Names of this list are serialized as a comma-separated CSV cell: commas are refused. */
  commaSeparatedInCsv?: boolean;
  /** Rows whose code is in this set are managed by the server and skipped by the checks. */
  skipCodes?: Set<string>;
};

/**
 * Write-time preparation of a catalog list: reserves explicit codes, generates missing ones from the
 * name, and enforces the alias rule. Reads stay tolerant; this runs only on the lists a PATCH carries.
 */
export function prepareCatalogListForWrite<T extends CatalogRowLike>(rows: unknown, options: PrepareListOptions): T[] {
  if (!Array.isArray(rows)) throw new BadRequestException(`${options.listName}: a list of values is expected`);
  const list = rows.map((row) => ({ ...(row as Record<string, unknown>) })) as T[];
  const taken = new Set<string>();
  // Reserve every explicit code first so generation never depends on row order.
  for (const row of list) {
    const code = normalizeAlias(row.code);
    if (!code) continue;
    if (!/^[a-z0-9][a-z0-9_.-]{0,63}$/.test(code) || code.length > MAX_CODE_LENGTH) throw new BadRequestException(`${options.listName}: "${String(row.code)}" is not a valid code`);
    if (taken.has(code) && !options.skipCodes?.has(code)) throw new BadRequestException(`${options.listName}: the code "${code}" appears twice`);
    taken.add(code);
    row.code = code;
  }
  const aliases = new Map<string, number>();
  list.forEach((row, index) => {
    const label = String(row.label ?? '').trim();
    if (options.skipCodes?.has(String(row.code))) return;
    if (!label) throw new BadRequestException(`${options.listName}: every value needs a name`);
    if (label.length > 200) throw new BadRequestException(`${options.listName}: "${label}" is too long (200 characters maximum)`);
    if (options.commaSeparatedInCsv && /[,;]/.test(label)) throw new BadRequestException(`${options.listName}: "${label}" cannot contain a comma or a semicolon`);
    row.label = label;
    const translations = normalizeTranslations(row.translations);
    if (translations) row.translations = translations; else delete row.translations;
    if (options.commaSeparatedInCsv && Object.values(translations ?? {}).some((entry) => /[,;]/.test(entry.label ?? ''))) throw new BadRequestException(`${options.listName}: a translation of "${label}" contains a comma or a semicolon`);
    if (!normalizeAlias(row.code)) row.code = generateCatalogCode(label, taken);
    // Names, codes and translated names are all aliases: each designates one entry, in any language.
    for (const alias of catalogAliases({ code: row.code, label, translations })) {
      const owner = aliases.get(alias);
      if (owner !== undefined && owner !== index) throw new BadRequestException(`${options.listName}: "${label}" clashes with "${String(list[owner].label)}" (names, translations and codes must be unique)`);
      aliases.set(alias, index);
    }
  });
  return list;
}
