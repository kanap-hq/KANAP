import { CANNOT_BE_CLEARED, readImportCell } from './clear';
import { cellOf, ImportReportError, rowError } from './master-data';
import { CsvDataRow } from './types';
import { sameStoredValue } from './unchanged';

/**
 * What a row does to a record it updates, in the master-data imports that have their own
 * `importCsv` (suppliers, contacts, companies, departments, accounts, dimension values).
 *
 * `enrich` is the rule of every import route (D21 of 26.11.9, the budget file's rule): a blank
 * cell keeps the stored value, `-` clears it (`readImportCell`), and `-` on a value that cannot
 * be cleared (a key, a required value, a status, an amount) refuses the row with
 * `CSV_VALUE_CANNOT_BE_CLEARED`. On a new record `-` reads as a blank cell. The routes take no
 * mode: they always apply this rule.
 *
 * `replace` is kept for the internal callers that call a service without a mode, as these
 * imports always did: Kad (until its own pass) and the chart of accounts templates. A blank
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
 * The row errors of `-` on the columns that cannot be cleared (keys, required values, statuses,
 * amounts), one per column, named by the column: nothing of the row is written. None when
 * replacing, where `-` is text.
 */
export function clearRefusals(row: CsvDataRow, columns: readonly string[], mode: CsvImportMode): ImportReportError[] {
  return columns
    .filter((column) => clearsCell(row, column, mode))
    .map((column) => rowError(row.line, column, CANNOT_BE_CLEARED, `${column} cannot be cleared.`));
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
