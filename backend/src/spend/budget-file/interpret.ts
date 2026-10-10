import { CENTS_LIMIT } from '../../common/amount';
import { CsvDateOrder, CsvLanguage, CsvParsedDate, CsvReadResult, DecimalMark, readCsv } from '../../common/csv-sheet';
import { AmountMeasure } from '../amounts-write.util';
import type { BudgetNature } from '../budget-nature';
import { budgetFileSchema, CRITERIA_COLUMNS_MESSAGE, hasCriteriaColumns, isOldBudgetLayout, OLD_BUDGET_FILE_MESSAGE, schemaFields } from './columns';
import { parseToken, ParsedToken } from './token';

export type FieldCell =
  | { kind: 'absent' }
  | { kind: 'blank' }
  | { kind: 'clear' }
  | { kind: 'value'; text: string };

/**
 * The prefix a file names a line by: `BL` its own number (a bare number too, since lot C1b);
 * `OPX` and `CPX` the numbers of the files of before lot C1b (`legacy_number`, lot Z1).
 */
export type ItemNumberPrefix = 'BL' | 'OPX' | 'CPX';

export type ItemNumberCell =
  | { kind: 'blank' }
  | { kind: 'invalid'; raw: string }
  /** `ref`: the reference as the report names it (`BL-12`, `CPX-3`). */
  | { kind: 'number'; prefix: ItemNumberPrefix; n: number; raw: string; ref: string };

/** The `nature` cell: absent when the file has no such column (a file of before lot C1b). */
export type NatureCell =
  | { kind: 'absent' }
  | { kind: 'blank' }
  | { kind: 'clear' }
  | { kind: 'invalid'; raw: string }
  | { kind: 'value'; nature: BudgetNature };

export type MoneyCell =
  | { kind: 'blank' }
  | { kind: 'clear' }
  | { kind: 'invalid' }
  | { kind: 'value'; cents: bigint };

export interface InterpretedAmount {
  id: string;
  column: string;
  measure: AmountMeasure;
  year: number;
  month: number | null;
  cell: MoneyCell;
}

export interface InterpretedRow {
  line: number;
  nature: NatureCell;
  itemNumber: ItemNumberCell;
  token: ParsedToken;
  fields: Record<string, FieldCell>;
  analytics: Record<string, FieldCell>;
  /** Parsed date cells. A blank, a clear and an invalid date are not here. */
  dates: Record<string, CsvParsedDate>;
  amounts: InterpretedAmount[];
  errors: Array<{ column: string | null; message: string }>;
}

/**
 * Read one budget file. An old layout, or a CAPEX file of before lot C1 (the
 * three criteria columns together), comes back as that one message and no
 * rows, so the preflight does not also list a missing name or dimension on
 * every line.
 */
export async function readBudgetCsv(
  input: Buffer | string,
  options: {
    language: CsvLanguage;
    /** The enabled dimensions, of both natures (`loadFileDimensions`). */
    dimensionCodes: readonly string[];
    dateOrder?: CsvDateOrder;
    decimalMark?: DecimalMark;
  },
): Promise<CsvReadResult> {
  const read = await readCsv(
    input,
    budgetFileSchema(options.language, options.dimensionCodes, options.dateOrder, options.decimalMark),
  );
  const refusal = isOldBudgetLayout(read.rawHeaders)
    ? OLD_BUDGET_FILE_MESSAGE
    : hasCriteriaColumns(read.rawHeaders) ? CRITERIA_COLUMNS_MESSAGE : null;
  if (!refusal) return read;
  return {
    ...read,
    headerErrors: [],
    ignoredColumns: [],
    fileErrors: [refusal],
    rows: [],
    dates: null,
    amounts: null,
  };
}

/** Turn parsed cells into the budget file's own cells. No database. */
export function interpretBudgetFile(read: CsvReadResult): InterpretedRow[] {
  const fields = schemaFields();
  const amountColumns = read.columns.filter((column) => column.kind === 'amount');
  const analyticsColumns = read.columns.filter((column) => column.kind === 'analytics');
  const presentFields = new Set(read.columns.filter((column) => column.kind === 'field').map((column) => column.id));
  return read.rows.map((row) => {
    const errors = row.errors.map((error) => ({ column: error.column, message: error.message }));
    const cells: Record<string, FieldCell> = {};
    for (const field of fields) {
      if (field === 'kanap_token') continue;
      cells[field] = presentFields.has(field) ? fieldCell(row.cells[field] ?? '') : { kind: 'absent' };
    }
    const analytics: Record<string, FieldCell> = {};
    for (const column of analyticsColumns) {
      analytics[column.code] = fieldCell(row.cells[column.id] ?? '');
    }
    const dates: Record<string, CsvParsedDate> = {};
    for (const field of ['effective_start', 'end_of_validity']) {
      const parsed = row.dates[field];
      if (parsed && parsed.kind !== 'clear') dates[field] = parsed;
    }
    const amounts: InterpretedAmount[] = amountColumns.map((column) => {
      const parsed = row.amounts[column.id] ?? { kind: 'blank' as const };
      let cell: MoneyCell;
      if (parsed.kind === 'blank') cell = { kind: 'blank' };
      else if (parsed.kind === 'clear') {
        cell = { kind: 'clear' };
        errors.push({
          column: column.id,
          message: `${column.id} cannot be cleared. Use 0 to set an amount to zero, or leave the cell empty to keep the stored amount.`,
        });
      } else if (parsed.kind === 'invalid') cell = { kind: 'invalid' };
      else {
        const text = parsed.decimal.toString();
        const fraction = text.split('.')[1] ?? '';
        const cents = parsed.decimal.toCents();
        if (fraction.length > 2) {
          cell = { kind: 'invalid' };
          errors.push({ column: column.id, message: `${column.id} has more than two decimals.` });
        } else if (cents >= CENTS_LIMIT || cents <= -CENTS_LIMIT) {
          cell = { kind: 'invalid' };
          errors.push({ column: column.id, message: `${column.id} is too large.` });
        } else cell = { kind: 'value', cents };
      }
      return {
        id: column.id,
        column: column.column,
        measure: column.measure as AmountMeasure,
        year: column.year,
        month: column.month,
        cell,
      };
    });
    const tokenRaw = presentFields.has('kanap_token') ? (row.cells.kanap_token ?? '') : null;
    return {
      line: row.line,
      nature: parseNature(cells.nature ?? { kind: 'absent' }),
      itemNumber: parseItemNumber(cells.item_number ?? { kind: 'absent' }),
      token: tokenRaw == null ? { kind: 'absent' } : parseToken(tokenRaw),
      fields: cells,
      analytics,
      dates,
      amounts,
      errors,
    };
  });
}

function fieldCell(raw: string): FieldCell {
  const text = raw.trim();
  if (text === '') return { kind: 'blank' };
  if (text === '-') return { kind: 'clear' };
  return { kind: 'value', text };
}

/** `opex` or `capex`, any case. */
function parseNature(cell: FieldCell): NatureCell {
  if (cell.kind !== 'value') return cell;
  const text = cell.text.trim().toLowerCase();
  if (text === 'opex' || text === 'capex') return { kind: 'value', nature: text };
  return { kind: 'invalid', raw: cell.text.trim() };
}

/** `BL-n`, `OPX-n`, `CPX-n` (any case) or a bare number, which is the line's own number (`BL-n`). */
export function parseItemNumber(cell: FieldCell): ItemNumberCell {
  if (cell.kind === 'absent' || cell.kind === 'blank') return { kind: 'blank' };
  if (cell.kind === 'clear') return { kind: 'invalid', raw: '-' };
  const text = cell.text.trim();
  const prefixed = /^(BL|OPX|CPX)-(\d+)$/i.exec(text);
  const digits = prefixed ? prefixed[2] : /^\d+$/.test(text) ? text : null;
  if (digits == null) return { kind: 'invalid', raw: text };
  const n = Number(digits);
  if (!Number.isSafeInteger(n) || n < 1) return { kind: 'invalid', raw: text };
  const prefix = (prefixed ? prefixed[1].toUpperCase() : 'BL') as ItemNumberPrefix;
  return { kind: 'number', prefix, n, raw: text, ref: `${prefix}-${n}` };
}

/** The first year of a row that carries an amount, for a blank effective start on a new line. */
export function firstAmountYear(row: InterpretedRow): number | null {
  let year: number | null = null;
  for (const amount of row.amounts) {
    if (amount.cell.kind !== 'value') continue;
    if (year == null || amount.year < year) year = amount.year;
  }
  return year;
}

/** Cents as a two-decimal string (`12280.50`). The writer keeps the trailing zeros. */
export function moneyText(cents: bigint): string {
  const negative = cents < 0n;
  const digits = (negative ? -cents : cents).toString().padStart(3, '0');
  return `${negative ? '-' : ''}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}
