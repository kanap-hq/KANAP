import { Decimal } from '../decimal';

/**
 * Shared CSV reading and writing for the budget files and the master-data
 * files. Importers do not call this yet. The caller passes the columns and
 * the user's language. Nothing here looks up a user or writes the database.
 */

/** A data file may not carry more rows than this. The header does not count. */
export const CSV_ROW_CAP = 20_000;

/** Real budget years. A two-digit year is relative and is refused. */
export const BUDGET_YEAR_MIN = 1900;
export const BUDGET_YEAR_MAX = 2199;

export type CsvLanguage = 'en' | 'fr' | 'de' | 'es';

/** How an ambiguous local date is read. English exports do not use this: they write ISO. */
export type CsvDateOrder = 'day-first' | 'month-first';

export type CsvSeparator = ',' | ';' | '\t';

/**
 * One amount column. `names[0]` is the name the writer uses (`budget`).
 * The other names are accepted on read (`planned`, and the old `follow_up`).
 * `measure` is the stored column (`planned`, `committed`, `forecast`, `actual`, `expected_landing`).
 */
export interface CsvAmountColumn {
  measure: string;
  names: readonly string[];
}

/**
 * The five budget columns. File names are `budget`, `revision`, `forecast`,
 * `actual` and `landing`. Storage keys and the old `follow_up` name are read
 * as the same columns.
 */
export const BUDGET_AMOUNT_COLUMNS: readonly CsvAmountColumn[] = [
  { measure: 'planned', names: ['budget', 'planned'] },
  { measure: 'committed', names: ['revision', 'committed'] },
  { measure: 'forecast', names: ['forecast'] },
  { measure: 'actual', names: ['actual', 'follow_up'] },
  { measure: 'expected_landing', names: ['landing', 'expected_landing'] },
];

export interface CsvReadSchema {
  /** Detail columns, in any order. Matching ignores case, spaces, underscores and hyphens. */
  fields: readonly string[];
  /**
   * When set, headers of the shape `<name>_<year>` and `<name>_<year>_<mm>` are amount
   * columns. A header that looks like one of these and does not parse is a header error.
   * Leave this unset on a master-data file.
   */
  amounts?: readonly CsvAmountColumn[];
  /**
   * When set, `analytics:<code>` is a column. A code that is not in the list is a header
   * error. Leave this unset when the file has no dimension columns.
   */
  dimensions?: readonly string[];
  /** Detail columns whose cells are dates. They must also be listed in `fields`. */
  dateFields?: readonly string[];
  language: CsvLanguage;
  /**
   * The preflight switch. Used only when the file itself does not show the date order.
   * When the file does show it, a switch that disagrees is a file error.
   */
  dateOrder?: CsvDateOrder;
  /** A caller-owned field that records the export's language. Mixed hints are ignored. */
  conventionHint?: { field: string; languageOf: (cell: string) => CsvLanguage | null };
}

export interface CsvFieldColumn {
  kind: 'field';
  id: string;
  header: string;
}

export interface CsvAmountHeader {
  kind: 'amount';
  /** Canonical id, for example `budget_2027` or `budget_2027_01`, whatever the file wrote. */
  id: string;
  header: string;
  measure: string;
  /** Canonical file name, the first of `names`. */
  column: string;
  year: number;
  /** 1 to 12, or null for a yearly total. */
  month: number | null;
}

export interface CsvAnalyticsColumn {
  kind: 'analytics';
  /** `analytics:` plus the dimension code as the schema spells it. */
  id: string;
  header: string;
  code: string;
}

export type CsvColumn = CsvFieldColumn | CsvAmountHeader | CsvAnalyticsColumn;

export type CsvParsedAmount =
  | { kind: 'blank' }
  | { kind: 'clear' }
  | { kind: 'value'; decimal: Decimal }
  | { kind: 'invalid' };

/**
 * A calendar day, an absolute instant, or `-` (clear). `time` is the clock
 * reading written next to a local date (`00:00`), with no time zone. It is
 * not an instant. Callers store a bare day themselves. Only `kind: 'instant'`
 * has a zone.
 *
 * `clear` is not a row error. The design clears end of validity, and refuses
 * `-` on a required column and on effective start. Master-data files refuse
 * it too: their importers do today. The caller decides.
 */
export type CsvParsedDate =
  | { kind: 'date'; isoDate: string; time: string | null }
  | { kind: 'instant'; iso: string }
  | { kind: 'clear' };

export interface CsvRowError {
  /** Column id, or null when the row itself is wrong. */
  column: string | null;
  message: string;
}

export interface CsvDataRow {
  /** Physical line where this row starts. A quoted cell that spans lines counts from its first line. */
  line: number;
  /** Column id to the trimmed cell. A missing cell is an empty string. */
  cells: Record<string, string>;
  amounts: Record<string, CsvParsedAmount>;
  dates: Record<string, CsvParsedDate>;
  errors: CsvRowError[];
}

/**
 * What the preflight says about dates. `notice` is set only when the file
 * could not settle the order. It is not an error, and an export that uses
 * the same language reads back without a question.
 */
export interface CsvDateReading {
  order: CsvDateOrder;
  settledByFile: boolean;
  notice: string | null;
}

/**
 * What the preflight says about amounts. `notice` is set only when a single
 * mark followed by three digits could not be settled from another cell.
 * It is not an error. An export writes no thousands separator, so it never
 * asks.
 */
export interface CsvAmountReading {
  /** The mark between the whole units and the fractional part. */
  decimal: ',' | '.';
  settledByFile: boolean;
  notice: string | null;
}

export interface CsvReadResult {
  encoding: 'utf-8' | 'windows-1252';
  separator: CsvSeparator | null;
  headerLine: number | null;
  /** Every header cell, trimmed, in file order. */
  rawHeaders: string[];
  columns: CsvColumn[];
  /** Headers that are not columns. The file still loads. Listed in file order. */
  ignoredColumns: string[];
  /**
   * Blocking header problems. A caller does not load a file that has any.
   * Rows are still filled so the same pass can list row errors.
   */
  headerErrors: string[];
  /** Blocking file problems. When one of these is set before rows are read, `rows` is empty. */
  fileErrors: string[];
  rows: CsvDataRow[];
  dates: CsvDateReading | null;
  amounts: CsvAmountReading | null;
}
