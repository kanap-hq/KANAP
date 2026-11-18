/**
 * One cell of an import file, read by the rule every import follows (D21 of 26.11.9), the budget
 * file's own: a blank cell leaves the stored value as it is, `-` clears it, anything else is a
 * value. `__CLEAR__`, the clear mark of older files, reads as `-`. A value that only holds a
 * dash (`Jean-Pierre`, `-5`) is a value. The amount and date readers (`amount.ts`, `date.ts`)
 * read `-` the same way.
 */
export type ImportCell = { kind: 'blank' } | { kind: 'clear' } | { kind: 'value'; text: string };

/** The mark that clears a value. */
export const CLEAR_MARK = '-';
/** The clear mark of older files, read as `CLEAR_MARK`. */
const LEGACY_CLEAR_MARK = '__CLEAR__';
/**
 * The cell an export writes for a stored "-" (the formula guard), which the import reads as the
 * text "-": an export re-imported as it is changes nothing. Write it to keep a dash as a value.
 */
export const GUARDED_DASH = "'-";

/**
 * The text of an .xlsx text cell. `'-` typed in Excel holds "-", the apostrophe going to the cell's
 * format (`quotePrefix`): that cell is `GUARDED_DASH`, a dash kept as a value, as in a CSV file.
 */
export function quotePrefixedText(cell: { value: string; quotePrefix?: true }): string {
  return cell.quotePrefix && cell.value.trim() === CLEAR_MARK ? GUARDED_DASH : cell.value;
}

/** The code of a row error for `-` on a value that cannot be cleared: a key, a required value, a status. */
export const CANNOT_BE_CLEARED = 'CSV_VALUE_CANNOT_BE_CLEARED';
/**
 * The code of a row error for `-` on a number zero stands for: an amount, a count. Its text says
 * to write 0, or to leave the cell empty to keep the stored value.
 */
export const NUMBER_CANNOT_BE_CLEARED = 'CSV_NUMBER_CANNOT_BE_CLEARED';

/** A raw cell, trimmed (the spaces Excel writes around ` - ` included): blank, clear or a value. */
export function readImportCell(raw: string | null | undefined): ImportCell {
  const text = (raw ?? '').trim();
  if (text === '') return { kind: 'blank' };
  if (text === CLEAR_MARK || text === LEGACY_CLEAR_MARK) return { kind: 'clear' };
  if (text === GUARDED_DASH) return { kind: 'value', text: CLEAR_MARK };
  return { kind: 'value', text };
}
