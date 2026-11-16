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

/** The words of a text, as pg_trgm cuts them: runs of letters and digits, lower case and accents aside. */
export function nameWords(value: string): string[] {
  return accentFreeKey(value).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/** The trigrams of a text, as pg_trgm takes them: per word, lower case and accents aside, padded with two spaces before and one after. */
export function trigrams(value: string): Set<string> {
  const grams = new Set<string>();
  for (const word of nameWords(value)) {
    const padded = `  ${word} `;
    for (let index = 0; index + 3 <= padded.length; index += 1) grams.add(padded.slice(index, index + 3));
  }
  return grams;
}

/** pg_trgm's similarity of two texts: shared trigrams over all trigrams, 0 to 1 (lot I2 of 26.11.9; common since lot I3). */
export function similarity(a: string, b: string): number {
  return trigramSimilarity(trigrams(a), trigrams(b));
}

/** `similarity` of two texts' trigrams (`trigrams`), for a caller that compares one text with many: each text's trigrams taken once. */
export function trigramSimilarity(left: ReadonlySet<string>, right: ReadonlySet<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return shared / (left.size + right.size - shared);
}

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
  /**
   * `server`: the check found it (accents, another language); `model`: Kad proposed it and the check found the record;
   * `editor`: an application's publisher names the supplier of a row that gives none (lot I3 of 26.11.9, T-I3k).
   */
  origin: 'server' | 'model' | 'editor';
  /**
   * `version`: a version label found by a prefix rule (`22.04` for `22.04 LTS`, `technologies/version-label-match.ts`);
   * `editor`: the publisher's name found the supplier (origin `editor`).
   */
  reason: 'accents' | 'translation' | 'model' | 'version' | 'editor';
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
 * cost centers, business processes, a task's related object and phase), by `matchByName`'s steps. With
 * `caseBlind` (an import that kept the first record of a name), records whose names are equal case
 * aside are one name, the first listed, exactly and case aside. Accents aside, and at every step
 * without `caseBlind`, each record counts: two records of the very same name are several (T-I3a).
 * Several records at a step: `many`, named by `label` (a reference, else the name), the first
 * `AMBIGUOUS_NAMES_SHOWN`.
 */
export function findRecordByName<T extends { name: string }>(
  rows: readonly T[],
  cell: string,
  options: { beyondCase: boolean; caseBlind: boolean; label?: (row: T) => string | null | undefined },
): RecordNameLookup<T> {
  if (options.caseBlind) {
    const named = new Map<string, T>();
    for (const row of rows) {
      const key = row.name.trim().toLowerCase();
      if (!named.has(key)) named.set(key, row);
    }
    // One record per name: exactly or case aside, at most one answers.
    const first = matchByName([...named.values()], cell, { beyondCase: false });
    if (first.kind === 'one') return first;
  }
  const found = matchByName(rows, cell, { beyondCase: options.beyondCase });
  if (found.kind !== 'many') return found;
  const text = cell.trim().toLowerCase();
  const sameCase = rows.filter((row) => row.name.trim().toLowerCase() === text);
  const level = sameCase.length > 1 ? 'case' : 'accents';
  const among = level === 'case' ? sameCase : rows.filter((row) => accentFreeKey(row.name) === accentFreeKey(cell));
  return {
    kind: 'many',
    level,
    names: among.slice(0, AMBIGUOUS_NAMES_SHOWN).map((row) => options.label?.(row) || row.name.trim()),
  };
}

/**
 * The matches of a result: every one of Kad's proposals (as many as the request carries: the file
 * prepared from Kad's card writes each of them), then the first `MATCH_LIST_LIMIT` the server made.
 */
export function listedMatchEntries<T extends { origin: 'server' | 'model' | 'editor' }>(all: readonly T[]): T[] {
  let made = 0;
  return all.filter((entry) => entry.origin === 'model' || (made += 1) <= MATCH_LIST_LIMIT);
}

/** The matches an import found, for its result (`listedMatchEntries`) and their total; nothing when none. */
export function listedMatches(matches: ReadonlyMap<string, ImportNameMatch> | undefined): { matches?: ImportNameMatch[]; matchesTotal?: number } {
  const all = [...(matches?.values() ?? [])];
  return all.length > 0 ? { matches: listedMatchEntries(all), matchesTotal: all.length } : {};
}

/**
 * Kad's proposals for an import (lot I3 of 26.11.9, second pass), by file column: a value of the file
 * and the name of the existing record it stands for. The file keeps the person's value; the import
 * accepts a proposal only when that record exists (its name exactly, or case aside) in a family the
 * person reads, and lists it (`origin: 'model'`); otherwise it lists the refusal and the value follows
 * its own rule.
 */
export type ImportProposals = Readonly<Record<string, Readonly<Record<string, string>>>>;

/** A proposal of Kad the import did not accept. */
export interface ImportRefusedProposal {
  column: string;
  /** The dimension's name for an `analytics:` column of the budget file; null otherwise. */
  name: string | null;
  /** The value as the file writes it. */
  value: string;
  /**
   * The name Kad proposed (`missing`), or the record's own name (`disabled`, the budget file only).
   * A family the person does not read is refused as missing: nothing of its list is named.
   */
  target: string;
  /** `missing`: no such record the person reads; `disabled`: the record is disabled (the budget file). */
  reason: 'missing' | 'disabled';
  lines: number[];
  count: number;
}

/** Kad's proposal for `value` in `column`: none when it names the value itself, case aside (no proposal to check). */
export function proposalFor(proposals: ImportProposals | null | undefined, column: string, value: string): string | undefined {
  const byValue = proposals?.[column];
  if (!byValue) return undefined;
  const key = foldKey(value);
  for (const [from, to] of Object.entries(byValue)) {
    const target = String(to ?? '').trim();
    if (foldKey(from) === key && target !== '' && foldKey(target) !== key) return target;
  }
  return undefined;
}

/** Notes a refused proposal on `line`: one entry per column and value, with its lines (the first ones) and their count. */
export function noteRefusedProposal(
  refused: Map<string, ImportRefusedProposal>,
  entry: Omit<ImportRefusedProposal, 'lines' | 'count'>,
  line: number,
): void {
  const key = JSON.stringify([entry.column, entry.name, foldKey(entry.value)]);
  const found = refused.get(key) ?? { ...entry, lines: [], count: 0 };
  found.count += 1;
  if (found.lines.length < MATCH_LINE_LIMIT && !found.lines.includes(line)) found.lines.push(line);
  refused.set(key, found);
}

/** The proposals an import refused, for its result: all of them (as many as the request carries) and their total; nothing when none. */
export function listedRefusedProposals(refused: ReadonlyMap<string, ImportRefusedProposal> | undefined): {
  refusedProposals?: ImportRefusedProposal[];
  refusedProposalsTotal?: number;
} {
  const all = [...(refused?.values() ?? [])];
  return all.length > 0 ? { refusedProposals: all, refusedProposalsTotal: all.length } : {};
}

/** The matches and refused proposals of an import that reads its own lists. */
export interface ImportMatchState {
  matches: Map<string, ImportNameMatch>;
  refused: Map<string, ImportRefusedProposal>;
}

type ProposalArgs<T> = {
  proposals: ImportProposals | null | undefined;
  unmatched: ReadonlyArray<{ column: string; value: string }> | null | undefined;
  column: string;
  value: string;
  line: number;
  rows: readonly T[];
  reads: boolean;
  caseBlind: boolean;
  ref?: (row: T) => string | null;
  /** How a refusal names a record of several (`ref` when absent). */
  label?: (row: T) => string | null;
};

/**
 * Kad's proposal for a value of the file, for the imports that read their own lists (contracts, cost
 * centers, business processes, a task's related object, the links of the technologies): the record of
 * `rows` it names, exactly or case aside (`findRecordByName`), when the person reads the family
 * (`reads`) and has not undone the match; then listed as a match of origin `model`. A name of several
 * records (an import that is not `caseBlind`): `many`, named by `label` (else `ref`), for the row's refusal
 * (`CSV_NAME_AMBIGUOUS_AMONG`), as a name written so. Refused (listed as missing, under Kad's own
 * words) otherwise. Undefined when there is no proposal to take or it was refused: the value then
 * follows its own rule.
 */
export function proposedRecord<T extends { name: string }>(
  state: ImportMatchState,
  args: ProposalArgs<T>,
): { kind: 'one'; row: T } | { kind: 'many'; names: string[] } | undefined {
  const proposal = proposalFor(args.proposals, args.column, args.value);
  if (proposal === undefined || undoneMatch(args.unmatched, args.column, args.value)) return undefined;
  const found = args.reads
    ? findRecordByName(args.rows, proposal, { beyondCase: false, caseBlind: args.caseBlind, label: args.label ?? args.ref })
    : null;
  if (found?.kind === 'one') {
    noteNameMatch(state.matches, {
      column: args.column, name: null, value: args.value.trim(), target: found.row.name.trim(), ref: args.ref?.(found.row) ?? null,
      origin: 'model', reason: 'model', undoable: true,
    }, args.line);
    return { kind: 'one', row: found.row };
  }
  if (found?.kind === 'many') return { kind: 'many', names: found.names };
  noteRefusedProposal(state.refused, { column: args.column, name: null, value: args.value.trim(), target: proposal, reason: 'missing' }, args.line);
  return undefined;
}

/**
 * `proposedRecord` for an import that keeps the first record of a name (`caseBlind`), where a
 * proposal never names several: the record taken, else undefined (the value follows its own rule).
 */
export function takeProposal<T extends { name: string }>(state: ImportMatchState, args: ProposalArgs<T>): T | undefined {
  const taken = proposedRecord(state, args);
  if (taken?.kind === 'one') return taken.row;
  if (taken?.kind === 'many') {
    noteRefusedProposal(state.refused, { column: args.column, name: null, value: args.value.trim(), target: String(proposalFor(args.proposals, args.column, args.value)), reason: 'missing' }, args.line);
  }
  return undefined;
}
