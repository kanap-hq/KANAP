import { cellOf } from './master-data';
import { CsvDataRow } from './types';

/**
 * What a row does to a record it updates (lot I4 of 26.11.9), as the declarative imports do
 * (`CsvImportParams.mode`). `enrich` completes the record: a blank cell keeps the stored value.
 * `replace` writes every cell of the row: a blank cell clears the stored value, or refuses the
 * row when the value cannot be empty. In both modes, a column the file leaves out is never
 * written, and a new record takes the row's cells and the defaults.
 *
 * The import routes take `mode` (`parseImportMode`, default `ROUTE_IMPORT_MODE`). A service
 * called without it replaces, as these imports always did: Kad and the chart templates.
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
