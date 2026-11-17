import { CANNOT_BE_CLEARED, NUMBER_CANNOT_BE_CLEARED, readImportCell } from './clear';
import { cellOf, ImportReportError, rowError } from './master-data';
import { CsvDataRow } from './types';
import { sameStoredValue } from './unchanged';

/**
 * What a row does to a record it updates, in the master-data imports that have their own
 * `importCsv` (suppliers, contacts, companies, departments, accounts, dimension values).
 *
 * `enrich` is the rule of every import route and of Kad's imports (D21 of 26.11.9, the budget file's rule): a blank
 * cell keeps the stored value, `-` clears it (`readImportCell`), and `-` on a value that cannot
 * be cleared refuses the row: `CSV_VALUE_CANNOT_BE_CLEARED` for a key, a required value or a
 * status, `CSV_NUMBER_CANNOT_BE_CLEARED` for an amount or a count (write 0). `-` in `disabled_at`
 * clears the end of validity, as the screen empties it, and the record is active again
 * (`clearsEndOfValidity`). On a new record `-` reads as a blank cell. The routes take no mode:
 * they always apply this rule.
 *
 * `replace` is kept for the internal callers that call a service without a mode, as these
 * imports always did: the chart of accounts templates. A blank
 * cell clears the stored value, or refuses the row when the value cannot be empty, and `-` is
 * read as any other text.
 *
 * In both modes a column the file leaves out is never written, and a new record takes the row's
 * cells and the defaults.
 */
export type CsvImportMode = 'enrich' | 'replace';

/**
 * Whether a row leaves the stored value of this column as it is, on a record it updates: the
 * file does not carry the column (either mode), or the cell is blank and the row completes the
 * record (`enrich`).
 */
export function keepsStoredValue(row: CsvDataRow, present: readonly string[], column: string, mode: CsvImportMode): boolean {
  if (!present.includes(column)) return true;
  return mode === 'enrich' && cellOf(row, column) === '';
}

/**
 * The values a row writes to a record it updates: `values` without those it keeps
 * (`keepsStoredValue`). Each value is read from the column of its own name, or from the one
 * `columnOf` names. Compared to the stored record (`sameStoredValues`), what is left says
 * whether the row changes anything.
 */
export function storedRecordValues<T extends object>(
  values: T,
  row: CsvDataRow,
  present: readonly string[],
  mode: CsvImportMode,
  columnOf: Partial<Record<keyof T & string, string>> = {},
): Partial<T> {
  const written: Partial<T> = {};
  for (const key of Object.keys(values) as Array<keyof T & string>) {
    if (!keepsStoredValue(row, present, columnOf[key] ?? key, mode)) written[key] = values[key];
  }
  return written;
}

/** Whether the row clears this column with `-`: under the import rule (`enrich`) only. */
export function clearsCell(row: CsvDataRow, column: string, mode: CsvImportMode): boolean {
  return mode === 'enrich' && readImportCell(row.cells[column]).kind === 'clear';
}

/**
 * A cell's text as the row writes it. Under the import rule, '' for a blank cell and for `-`
 * (`keepsStoredValue` then tells a kept value from a cleared one); when replacing, the trimmed
 * cell, as these imports always read it.
 */
export function cellText(row: CsvDataRow, column: string, mode: CsvImportMode): string {
  if (mode === 'replace') return cellOf(row, column);
  const cell = readImportCell(row.cells[column]);
  return cell.kind === 'value' ? cell.text : '';
}

/**
 * The row errors of `-` on the columns that cannot be cleared, one per column, named by the
 * column: nothing of the row is written. `values` are keys, required values and statuses;
 * `numbers` are amounts and counts, where the message says to write 0. None when replacing,
 * where `-` is text.
 */
export function clearRefusals(
  row: CsvDataRow,
  values: readonly string[],
  mode: CsvImportMode,
  numbers: readonly string[] = [],
): ImportReportError[] {
  const refused = (columns: readonly string[]) => columns.filter((column) => clearsCell(row, column, mode));
  return [
    ...refused(values).map((column) => rowError(row.line, column, CANNOT_BE_CLEARED, `${column} cannot be cleared.`)),
    ...refused(numbers).map((column) => rowError(row.line, column, NUMBER_CANNOT_BE_CLEARED,
      `${column} cannot be cleared. Use 0 to set it to zero, or leave the cell empty to keep the stored value.`)),
  ];
}

/**
 * Whether the row clears the end of validity with `-` (T-I4d of 26.11.9): the screen empties
 * `disabled_at`, and the record is active again. The row writes `disabled_at: null`
 * (`withClearedEndOfValidity`) to a stored record; on a new record `-` is a blank cell.
 */
export function clearsEndOfValidity(row: CsvDataRow, mode: CsvImportMode): boolean {
  return clearsCell(row, 'disabled_at', mode);
}

/** No end of validity, for the status check: a date never reached, the record stays active. */
const NO_END_OF_VALIDITY = new Date(8.64e15);

/**
 * The end of validity the row's status is checked against (`csvLifecycleConflict`): the date the
 * row gives, or, when `-` clears it, none. `disabled` with `-` is then a contradiction of its own
 * (`lifecycleConflictError`).
 */
export function endOfValidityToCheck<T>(date: T, clears: boolean): T | Date {
  return clears ? NO_END_OF_VALIDITY : date;
}

/** The code of a row whose status says disabled while `-` clears the end of validity. */
export const STATUS_DISABLED_DATE_CLEARED = 'CSV_STATUS_DISABLED_DATE_CLEARED';

/**
 * The row error, on the status, of a status that contradicts the end of validity
 * (`csvLifecycleConflict` against `endOfValidityToCheck`), or null when `conflict` is null.
 * When `-` clears the date, the only contradiction is `disabled`, worded as such; otherwise an
 * enabled status with a date passed, or a disabled one with a date to come.
 */
export function lifecycleConflictError(line: number, status: string | null, conflict: string | null, clears: boolean): ImportReportError | null {
  if (!conflict) return null;
  if (clears) {
    return rowError(line, 'status', STATUS_DISABLED_DATE_CLEARED, 'Status is disabled, but "-" clears the end of validity. Keep one or the other.');
  }
  return rowError(line, 'status', status === 'enabled' ? 'CSV_STATUS_DATE_PASSED' : 'CSV_STATUS_DATE_FUTURE', conflict);
}

/**
 * The status and end of validity a row writes to a stored record (`csvItemLifecycle`), with no end
 * of validity when `-` clears it: `update` then derives the enabled status.
 */
export function withClearedEndOfValidity<L extends object>(lifecycle: L, clears: boolean): L | (L & { disabled_at: null }) {
  return clears ? { ...lifecycle, disabled_at: null } : lifecycle;
}

/**
 * How many stored values the row clears with `-`: the fields whose column holds `-` and whose
 * stored value is not empty already (a `-` on an empty value changes nothing). Each field is read
 * from the column of its own name, or from the one `columnOf` names. The count of an import's
 * result (`MasterDataImportResult.cleared`) adds these up.
 */
export function clearedValueCount(
  stored: object | null | undefined,
  row: CsvDataRow,
  mode: CsvImportMode,
  fields: readonly string[],
  columnOf: Readonly<Record<string, string>> = {},
): number {
  if (!stored) return 0;
  const values = stored as Record<string, unknown>;
  return fields.filter((field) => clearsCell(row, columnOf[field] ?? field, mode) && !sameStoredValue(values[field], null)).length;
}
