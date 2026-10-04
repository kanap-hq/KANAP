import { CENTS_LIMIT } from '../../common/amount';
import { CsvDateOrder, CsvLanguage, CsvParsedDate, CsvReadResult, DecimalMark, readCsv } from '../../common/csv-sheet';
import { AmountMeasure } from '../amounts-write.util';
import { budgetFileSchema, isOldBudgetLayout, OLD_BUDGET_FILE_MESSAGE, schemaFields } from './columns';
import { parseToken, ParsedToken } from './token';
import { BudgetFileScope } from './types';

export type FieldCell =
  | { kind: 'absent' }
  | { kind: 'blank' }
  | { kind: 'clear' }
  | { kind: 'value'; text: string };

export type ItemNumberCell =
  | { kind: 'blank' }
  | { kind: 'invalid'; raw: string }
  | { kind: 'other'; raw: string }
  | { kind: 'number'; n: number; raw: string };

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
 * Read one budget file. An old layout comes back as that one message and no
 * rows, so the preflight does not also list a missing name on every line.
 */
export async function readBudgetCsv(
  input: Buffer | string,
  options: {
    scope: BudgetFileScope;
    language: CsvLanguage;
    dimensionCodes: readonly string[];
    dateOrder?: CsvDateOrder;
    decimalMark?: DecimalMark;
  },
): Promise<CsvReadResult> {
  const read = await readCsv(input, budgetFileSchema(options.scope, options.language, options.dimensionCodes, options.dateOrder, options.decimalMark));
  if (!isOldBudgetLayout(read.rawHeaders)) return read;
  return {
    ...read,
    headerErrors: [],
    ignoredColumns: [],
    fileErrors: [OLD_BUDGET_FILE_MESSAGE],
    rows: [],
    dates: null,
    amounts: null,
  };
}

/** Turn parsed cells into the budget file's own cells. No database. */
export function interpretBudgetFile(scope: BudgetFileScope, read: CsvReadResult): InterpretedRow[] {
  const fields = schemaFields(scope);
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
      itemNumber: parseItemNumber(scope, cells.item_number ?? { kind: 'absent' }),
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

function parseItemNumber(scope: BudgetFileScope, cell: FieldCell): ItemNumberCell {
  if (cell.kind === 'absent' || cell.kind === 'blank') return { kind: 'blank' };
  if (cell.kind === 'clear') return { kind: 'invalid', raw: '-' };
  const text = cell.text.trim();
  const prefixed = /^(OPX|CPX)-(\d+)$/i.exec(text);
  if (prefixed) {
    const prefix = prefixed[1].toUpperCase();
    const expected = scope === 'opex' ? 'OPX' : 'CPX';
    const n = Number(prefixed[2]);
    if (!Number.isSafeInteger(n) || n < 1) return { kind: 'invalid', raw: text };
    if (prefix !== expected) return { kind: 'other', raw: `${prefix}-${n}` };
    return { kind: 'number', n, raw: text };
  }
  if (/^\d+$/.test(text)) {
    const n = Number(text);
    if (!Number.isSafeInteger(n) || n < 1) return { kind: 'invalid', raw: text };
    return { kind: 'number', n, raw: text };
  }
  return { kind: 'invalid', raw: text };
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
