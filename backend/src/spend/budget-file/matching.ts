import * as fs from 'node:fs';
import * as path from 'node:path';
import { Logger } from '@nestjs/common';
import { DEFAULT_ANALYTICS_AXIS_CODE } from '../../analytics/analytics-axes.util';
import {
  costPoolNames,
  RECOMMENDED_DIMENSION_EQUIVALENTS,
  recommendedDimensionTable,
  type RecommendedDimensionKey,
  SEED_LANGUAGES,
} from '../../analytics/recommended-dimensions.seed';
import type { BudgetFileChoice, CatalogDimension } from './types';

/**
 * How the budget file finds an existing supplier, company or dimension value for a value of the
 * file before it creates one (lot I1 of 26.11.9, "match before create"). The check of the screen
 * and Kad's card share it:
 * - the same name, case aside: the same value, as before;
 * - the same name once accents are set aside (`Societe X` for `Société X`): a match the server makes;
 * - a value of a recommended dimension, or of the sample data's own business domain, named in another
 *   of the four languages (`Hardware` for `Matériel`, `Retail` for `Magasins`): a match the server makes;
 * - a value Kad proposes for the cell (its mapping's `values`), accepted only when that value exists
 *   in the workspace's list and is enabled: a match of the model.
 * Two candidates equally good make no match. Every match beyond case is listed, with its origin, and
 * the person may undo it (a choice): the value is then created, or refused, as an unknown one.
 */

/** A value as the file and the list are compared: compatibility forms folded, outer spaces trimmed, lower case. */
export function foldKey(value: string): string {
  return value.normalize('NFKC').trim().toLowerCase();
}

/** A value set apart from its accents, the way exports often write capitals (`Elevee` for `Élevée`). */
export function accentFreeKey(value: string): string {
  return foldKey(value).normalize('NFD').replace(/\p{M}/gu, '');
}

export type MatchHow = 'exact' | 'case' | 'accents' | 'translation';

export type NameMatch<T> = { kind: 'none' } | { kind: 'many' } | { kind: 'one'; row: T; how: MatchHow };

/**
 * The row of `rows` whose name is `cell`: exactly, then case aside, then accents aside (`accents`),
 * then, for a dimension the server translates, by the value's name in another language (`translate`). Several
 * rows at the first step that finds any: `many`.
 */
export function matchByName<T extends { name: string }>(
  rows: readonly T[],
  cell: string,
  options: { beyondCase: boolean; translate?: (cell: string, rows: readonly T[]) => T[] } = { beyondCase: true },
): NameMatch<T> {
  const text = cell.trim();
  const pick = (found: T[], how: MatchHow): NameMatch<T> | null => {
    if (found.length === 1) return { kind: 'one', row: found[0], how };
    return found.length > 1 ? { kind: 'many' } : null;
  };
  const exact = pick(rows.filter((row) => row.name.trim() === text), 'exact');
  if (exact) return exact;
  const folded = pick(rows.filter((row) => row.name.trim().toLowerCase() === text.toLowerCase()), 'case');
  if (folded) return folded;
  if (!options.beyondCase) return { kind: 'none' };
  const key = accentFreeKey(text);
  const accents = pick(rows.filter((row) => accentFreeKey(row.name) === key), 'accents');
  if (accents) return accents;
  if (options.translate) {
    const translated = pick(options.translate(text, rows), 'translation');
    if (translated) return translated;
  }
  return { kind: 'none' };
}

/** A dimension's own name without the ` (2)` the seed adds when another dimension holds it. */
function baseName(name: string | null): string {
  return accentFreeKey((name ?? '').replace(/\s*\(\d+\)\s*$/, ''));
}

/**
 * The recommended dimension a dimension of the workspace stands for, as the seed finds it
 * (`findPresent`): its code, an older code that stands for it, or the default dimension named as the
 * cost pool in one of the four languages.
 */
export function recommendedKeyOf(dimension: Pick<CatalogDimension, 'code' | 'axisName'>): RecommendedDimensionKey | null {
  const code = dimension.code.trim().toLowerCase();
  for (const seed of recommendedDimensionTable('en')) {
    if (seed.code === code || (RECOMMENDED_DIMENSION_EQUIVALENTS[seed.key] ?? []).includes(code)) return seed.key;
  }
  if (code === DEFAULT_ANALYTICS_AXIS_CODE && costPoolNames().map(baseName).includes(baseName(dimension.axisName))) return 'cost_pool';
  return null;
}

const valueKeysCache = new Map<RecommendedDimensionKey, Map<string, string>>();

/** The seed key of each value name of a recommended dimension, over the four languages, accents aside. */
function valueKeysByName(key: RecommendedDimensionKey): Map<string, string> {
  const cached = valueKeysCache.get(key);
  if (cached) return cached;
  const byName = new Map<string, string>();
  for (const language of SEED_LANGUAGES) {
    const seed = recommendedDimensionTable(language).find((item) => item.key === key);
    for (const value of seed?.values ?? []) byName.set(accentFreeKey(value.name), value.key);
  }
  valueKeysCache.set(key, byName);
  return byName;
}

/**
 * The sample data's own dimensions, as its loader creates them in the workspace's language
 * (`fixtures/fromage-co/fixture-dimensions.mjs`, in the image under `/app/fixtures`). The server reads
 * that module itself, so the names it translates are the ones the loader wrote.
 */
export const FIXTURE_DIMENSIONS_RELATIVE_PATH = path.join('fixtures', 'fromage-co', 'fixture-dimensions.mjs');

/**
 * The one dimension of the sample data the server translates, found by its code. The budget
 * reference's values are codes, the same in every language: nothing to translate.
 */
export const FIXTURE_TRANSLATED_DIMENSION = 'business_domain';

type FixtureDimensionsModule = {
  FIXTURE_LANGUAGES: readonly string[];
  fixtureDimensions: (language: string) => Array<{ code: string; values: Array<{ key: string; name: string }> }>;
};

/** The sample data's dimensions module, looked up from `from` up to the backend directory; null when it is not there. */
export function findFixtureDimensionsModule(from: string = __dirname): string | null {
  for (let dir = from; ; dir = path.dirname(dir)) {
    const candidate = path.join(dir, FIXTURE_DIMENSIONS_RELATIVE_PATH);
    if (fs.existsSync(candidate)) return candidate;
    const backendRoot = fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'tsconfig.json'));
    if (backendRoot || path.dirname(dir) === dir) return null;
  }
}

let fixtureKeys: Map<string, string> | null | undefined;

/**
 * The value key of each name of the sample data's business domain, over its four languages, accents
 * aside. Read once; an installation without the module translates nothing more (said once in the log).
 */
export function fixtureValueKeysByName(): ReadonlyMap<string, string> | null {
  if (fixtureKeys !== undefined) return fixtureKeys;
  fixtureKeys = null;
  const file = findFixtureDimensionsModule();
  try {
    if (!file) throw new Error(`${FIXTURE_DIMENSIONS_RELATIVE_PATH} not found below the backend directory`);
    // An ES module, loaded synchronously by Node's require (Node 22.12 and later): no top-level await in it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fixtures = require(file) as FixtureDimensionsModule;
    const byName = new Map<string, string>();
    for (const language of fixtures.FIXTURE_LANGUAGES) {
      const axis = fixtures.fixtureDimensions(language).find((item) => item.code === FIXTURE_TRANSLATED_DIMENSION);
      for (const value of axis?.values ?? []) byName.set(accentFreeKey(value.name), value.key);
    }
    fixtureKeys = byName;
  } catch (error) {
    new Logger('BudgetFileMatching').warn(`The sample data's business domain is not translated: ${(error as Error).message}`);
  }
  return fixtureKeys;
}

/**
 * The names a dimension's values are translated by: a recommended dimension's (the seed), or the
 * sample data's business domain (its loader's table); null for any other dimension.
 */
export function translationTableOf(dimension: Pick<CatalogDimension, 'code' | 'axisName'>): ReadonlyMap<string, string> | null {
  const key = recommendedKeyOf(dimension);
  if (key) return valueKeysByName(key);
  if (dimension.code.trim().toLowerCase() === FIXTURE_TRANSLATED_DIMENSION) return fixtureValueKeysByName();
  return null;
}

/**
 * The values of `rows` that stand for the same value as `cell` in another language, by the names of
 * `table` (`Hardware` → `Matériel`, `Retail` → `Magasins`). None without a table, or for a name it lacks.
 */
export function translatedValues<T extends { name: string }>(table: ReadonlyMap<string, string> | null, cell: string, rows: readonly T[]): T[] {
  if (!table) return [];
  const wanted = table.get(accentFreeKey(cell));
  if (!wanted) return [];
  return rows.filter((row) => table.get(accentFreeKey(row.name)) === wanted);
}

/** The trigrams of a text, as pg_trgm takes them: per word, lower case and accents aside, padded with two spaces before and one after. */
function trigrams(value: string): Set<string> {
  const grams = new Set<string>();
  for (const word of accentFreeKey(value).split(/[^\p{L}\p{N}]+/u)) {
    if (!word) continue;
    const padded = `  ${word} `;
    for (let index = 0; index + 3 <= padded.length; index += 1) grams.add(padded.slice(index, index + 3));
  }
  return grams;
}

/** pg_trgm's similarity of two texts: shared trigrams over all trigrams, 0 to 1. */
export function similarity(a: string, b: string): number {
  const left = trigrams(a);
  const right = trigrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

/** pg_trgm's default threshold: below it, two names are not alike. */
export const CANDIDATE_THRESHOLD = 0.3;
export const CANDIDATE_LIMIT = 3;

/** The names of the list closest to `value`, the closest first: three at most, from the threshold up. */
export function closestNames(value: string, names: readonly string[]): Array<{ name: string; score: number }> {
  const seen = new Set<string>();
  const scored: Array<{ name: string; score: number }> = [];
  for (const name of names) {
    const key = foldKey(name);
    if (seen.has(key)) continue;
    seen.add(key);
    const score = similarity(value, name);
    if (score >= CANDIDATE_THRESHOLD) scored.push({ name, score: Math.round(score * 100) / 100 });
  }
  return scored
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, CANDIDATE_LIMIT);
}

/** The columns whose values the check matches and Kad may propose a value for: the supplier and the dimensions. */
export function isMatchedColumn(column: string): boolean {
  return column === 'supplier_name' || column.startsWith('analytics:');
}

/** Choices bounded: a card or a request holds a few, each value as long as a cell. */
const CHOICE_LIMIT = 200;
const CHOICE_VALUE_MAX = 200;

/**
 * The person's choices on a check, as a route or a card receives them (a JSON text or a list): the
 * matches they undo, and whether the missing suppliers are created. Anything else is refused.
 */
export function parseBudgetFileChoices(raw: unknown): BudgetFileChoice[] {
  let value = raw;
  if (raw === undefined || raw === null || raw === '') return [];
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error('The choices are not valid.');
    }
  }
  if (!Array.isArray(value) || value.length > CHOICE_LIMIT) throw new Error('The choices are not valid.');
  const choices: BudgetFileChoice[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const item = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    if (item.kind === 'unmatch' && typeof item.column === 'string' && typeof item.value === 'string'
      && isMatchedColumn(item.column) && item.value.trim() !== '' && item.value.length <= CHOICE_VALUE_MAX && item.column.length <= 120) {
      const key = `unmatch|${item.column}|${foldKey(item.value)}`;
      if (!seen.has(key)) choices.push({ kind: 'unmatch', column: item.column, value: item.value.trim() });
      seen.add(key);
      continue;
    }
    if (item.kind === 'create_suppliers' && typeof item.value === 'boolean') {
      if (!seen.has('create_suppliers')) choices.push({ kind: 'create_suppliers', value: item.value });
      seen.add('create_suppliers');
      continue;
    }
    throw new Error('The choices are not valid.');
  }
  return choices;
}

/** The value of the "Create missing suppliers" choice, or undefined when the choices leave it to the caller. */
export function createSuppliersChoice(choices: readonly BudgetFileChoice[]): boolean | undefined {
  const found = choices.find((choice) => choice.kind === 'create_suppliers');
  return found?.kind === 'create_suppliers' ? found.value : undefined;
}

/** The key of a value of a column the choices and proposals name. */
export function cellKey(column: string, value: string): string {
  return `${column}\u0000${foldKey(value)}`;
}
