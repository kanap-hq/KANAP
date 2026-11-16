/**
 * How an import finds an existing record by the name a file gives it (lots I1 and I3 of 26.11.9,
 * "match before create"). One rule for every import, the budget file's and the others:
 * - the same name, case aside: the same record;
 * - the same name once accents are set aside (`Societe X` for `Société X`): a match the server makes,
 *   listed so the person may undo it;
 * - a name in another of the four languages, for the lists the server translates: a match too.
 * Accents are set aside in JavaScript, never with SQL's `unaccent` (which also folds œ, ß and ø).
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

/** Lines of the file a match names: the first ones. */
export const MATCH_LINE_LIMIT = 20;
/** Entries of a list of matches. */
export const MATCH_LIST_LIMIT = 200;

/**
 * A value of the file matched to an existing record beyond case: listed, and the person may undo it.
 * The budget file's matching and the other imports' result (`CsvImportResult.matches`) share it.
 */
export interface ImportNameMatch {
  /** The file column (`supplier_name`, `analytics:<code>`, `company_name`...). */
  column: string;
  /** The dimension's name for an `analytics:` column of the budget file; null otherwise. */
  name: string | null;
  /** The value as the file writes it. */
  value: string;
  /** The name of the existing record it stands for. */
  target: string;
  /** The record's business reference (`SUP-3`) when its family has one; null otherwise. Absent in the budget file. */
  ref?: string | null;
  /** `server`: the check found it (accents, another language); `model`: Kad proposed it and the check found the record. */
  origin: 'server' | 'model';
  reason: 'accents' | 'translation' | 'model';
  /** The lines of the file the value is on (the first ones), and how many there are. */
  lines: number[];
  count: number;
  /** Whether the person may undo it (the server takes the undone value back as an unknown one). */
  undoable: boolean;
}

/**
 * Notes a match on `line`: one entry per column, value and target, with its lines (the first ones)
 * and their count. The result lists the first `MATCH_LIST_LIMIT` entries and gives their total.
 */
export function noteNameMatch(
  matches: Map<string, ImportNameMatch>,
  entry: Omit<ImportNameMatch, 'lines' | 'count'>,
  line: number,
): void {
  const key = JSON.stringify([entry.column, entry.name, foldKey(entry.value), entry.target, entry.ref ?? null]);
  const found = matches.get(key);
  if (found) {
    found.count += 1;
    if (found.lines.length < MATCH_LINE_LIMIT && !found.lines.includes(line)) found.lines.push(line);
    return;
  }
  matches.set(key, { ...entry, lines: [line], count: 1 });
}

/** The records a refusal for a name of several records names: the first ones. */
export const AMBIGUOUS_NAMES_SHOWN = 5;

/** Whether the person undid the match of `value` in `column` (an import's `unmatched`): then it is found case aside only. */
export function undoneMatch(
  unmatched: ReadonlyArray<{ column: string; value: string }> | null | undefined,
  column: string,
  value: string,
): boolean {
  return (unmatched ?? []).some((item) => item.column === column && foldKey(item.value) === foldKey(value));
}

/** What a name of a file finds in a list an import reads itself: nothing, several records (named), or one. */
export type RecordNameLookup<T> =
  | { kind: 'none' }
  | { kind: 'many'; level: 'case' | 'accents'; names: string[] }
  | { kind: 'one'; row: T; how: MatchHow };

/**
 * The record of `rows` a name of a file finds, for the imports that read their own lists (contracts,
 * cost centers, business processes, a task's related object), by `matchByName`'s steps. Records of
 * the same name are one name, the first listed. With `caseBlind`, names equal case aside are one name
 * too (the first listed wins, as these imports did); without, they are several. Several names at a
 * step: `many`, named by `label` (a reference, else the name), the first `AMBIGUOUS_NAMES_SHOWN`.
 */
export function findRecordByName<T extends { name: string }>(
  rows: readonly T[],
  cell: string,
  options: { beyondCase: boolean; caseBlind: boolean; label?: (row: T) => string | null | undefined },
): RecordNameLookup<T> {
  const named = new Map<string, T>();
  for (const row of rows) {
    const key = options.caseBlind ? row.name.trim().toLowerCase() : row.name.trim();
    if (!named.has(key)) named.set(key, row);
  }
  const names = [...named.values()];
  const found = matchByName(names, cell, { beyondCase: options.beyondCase });
  if (found.kind !== 'many') return found;
  const text = cell.trim().toLowerCase();
  const sameCase = names.filter((row) => row.name.trim().toLowerCase() === text);
  const level = sameCase.length > 1 ? 'case' : 'accents';
  const among = level === 'case' ? sameCase : names.filter((row) => accentFreeKey(row.name) === accentFreeKey(cell));
  return {
    kind: 'many',
    level,
    names: among.slice(0, AMBIGUOUS_NAMES_SHOWN).map((row) => options.label?.(row) || row.name.trim()),
  };
}

/** The matches an import found, for its result: the first `MATCH_LIST_LIMIT` and their total; nothing when none. */
export function listedMatches(matches: ReadonlyMap<string, ImportNameMatch> | undefined): { matches?: ImportNameMatch[]; matchesTotal?: number } {
  const all = [...(matches?.values() ?? [])];
  return all.length > 0 ? { matches: all.slice(0, MATCH_LIST_LIMIT), matchesTotal: all.length } : {};
}
