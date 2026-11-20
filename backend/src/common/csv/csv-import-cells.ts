/**
 * The clearing rule of every import (D21 of 26.11.9) in the shared CSV import (`CsvImportService`),
 * for the service and for the hooks of the family configs that write a column themselves (clusters,
 * operating system, owners, data residency, the people of a task, ...).
 *
 * The rule: a blank cell keeps the stored value; `-` clears it (`__CLEAR__`, the mark of older files,
 * reads as `-`); a column the file leaves out is not touched; on a new record `-` reads as a blank
 * cell; a cell that holds several values is the whole list and replaces the stored one. The check
 * says how many stored values the import clears (`CsvImportResult.cleared`).
 *
 * Contract for the hooks:
 * - `importCell(row.raw, column)` reads a cell: `blank`, `clear`, or `value` with its trimmed text.
 *   A `'-` of the file (the export's guard on a stored "-", or `'-` typed in Excel) is the value "-".
 *   The parser has already turned it into "-" in `raw`, so `raw` holds "-" both for a typed `-` and for
 *   a guarded one: a hook that must tell them apart reads the cell here, never `raw` directly. A
 *   column the file leaves out reads `blank`; test `column in row.raw` when its absence matters.
 * - `refuseClear(row, column)` refuses a `-` on a value that cannot be empty, as a row error naming
 *   the column (`CSV_VALUE_CANNOT_BE_CLEARED`; `{ number: true }` for a number zero stands for:
 *   `CSV_NUMBER_CANNOT_BE_CLEARED`, whose text says to write 0). The row is not written.
 * - `noteCleared(row, count)` declares stored values a hook clears, for `cleared`: a link or a value
 *   that `-` removes, and the stored entries a filled list removes (`removedEntries`): a cell that
 *   names clusters A and B on an asset in A, B and C clears one link.
 * - Call them in a hook that runs at the preflight as at the load (`beforeValidate`, `settleRows`,
 *   `afterValidate`, `sameAsStored`): `beforeCommit`, `afterCommit` and the relation handlers run at
 *   the load only, and the preflight must announce what the load does. Rows with an error, rows left
 *   out, new records and rows skipped by the operation count nothing.
 */
import { CANNOT_BE_CLEARED, ImportCell, NUMBER_CANNOT_BE_CLEARED, readImportCell } from '../csv-sheet/clear';
import { sameStoredValue } from '../csv-sheet/unchanged';
import type { CsvImportRow } from './csv-field.types';

/** The cells of each row that held `'-` (the text "-"), by row: `raw` itself holds "-". */
const guardedDashes = new WeakMap<Record<string, string>, Set<string>>();

/** The parser's note: this cell of the row held `'-`, the text "-". */
export function markGuardedDash(raw: Record<string, string>, column: string): void {
  let columns = guardedDashes.get(raw);
  if (!columns) guardedDashes.set(raw, (columns = new Set()));
  columns.add(column);
}

/** A cell of the row, by the clearing rule: blank (also a column the file leaves out), clear, or a value. */
export function importCell(raw: Record<string, string>, column: string): ImportCell {
  if (guardedDashes.get(raw)?.has(column)) return { kind: 'value', text: '-' };
  return readImportCell(raw[column]);
}

/** A row error for `-` on a value that cannot be empty. The row is not written. */
export function refuseClear(row: CsvImportRow, column: string, options: { number?: boolean } = {}): void {
  row.errors.push(options.number
    ? {
      row: row.rowNumber,
      column,
      message: `${column} cannot be cleared. Use 0 to set it to zero, or leave the cell empty to keep the stored value.`,
      code: NUMBER_CANNOT_BE_CLEARED,
      params: { column },
    }
    : { row: row.rowNumber, column, message: `${column} cannot be cleared.`, code: CANNOT_BE_CLEARED, params: { column } });
}

/** Stored values a hook clears on this row, added to the result's `cleared`. */
export function noteCleared(row: CsvImportRow, count: number): void {
  if (count > 0) row.clearedByConfig = (row.clearedByConfig ?? 0) + count;
}

/** The stored entries of a list that the new list no longer holds. */
export function removedEntries(stored: readonly unknown[] | null | undefined, next: readonly unknown[] | null | undefined): number {
  const kept = next ?? [];
  return (stored ?? []).filter((entry) => !kept.some((value) => sameStoredValue(entry, value))).length;
}
