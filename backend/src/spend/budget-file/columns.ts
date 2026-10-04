import { AmountMeasure } from '../amounts-write.util';
import { BUDGET_AMOUNT_COLUMNS, CsvDateOrder, CsvLanguage, CsvReadSchema, DecimalMark } from '../../common/csv-sheet';
import { looseKey } from '../../common/csv-sheet/text';
import { BudgetFileDetail, BudgetFileScope } from './types';
import { parseToken } from './token';

/**
 * The old files this engine refuses as a whole. Headers are compared with the
 * csv-sheet loose match (case, spaces, underscores, hyphens).
 */
const OLD_HEADER_KEYS = new Set([
  'ybudget', 'yminus1budget', 'yminus1landing', 'yfollowup', 'ylanding', 'yrevision',
  'yplus1budget', 'yplus1revision', 'yplus2budget',
  'productname', 'analyticscategory', 'effectiveend', 'disabledat', 'itemtype',
]);

export const OLD_BUDGET_FILE_MESSAGE =
  'This file comes from an earlier version of KANAP. Export a fresh file from this list, copy your changes into it, and import it again.';

/** File names of the five columns, in the order the export writes them. */
export const FILE_COLUMNS = ['budget', 'revision', 'forecast', 'actual', 'landing'] as const;

export type FileColumn = (typeof FILE_COLUMNS)[number];

const MEASURE_BY_COLUMN = new Map<string, AmountMeasure>(
  BUDGET_AMOUNT_COLUMNS.map((column) => [column.names[0], column.measure as AmountMeasure]),
);

export function isFileColumn(value: string): value is FileColumn {
  return (FILE_COLUMNS as readonly string[]).includes(value);
}

export function measureOfColumn(column: string): AmountMeasure {
  const measure = MEASURE_BY_COLUMN.get(column);
  if (!measure) throw new Error(`Unknown budget column '${column}'.`);
  return measure;
}

export function columnOfMeasure(measure: AmountMeasure): FileColumn {
  const found = BUDGET_AMOUNT_COLUMNS.find((column) => column.measure === measure);
  return (found?.names[0] ?? measure) as FileColumn;
}

/**
 * Detail columns in file order. `dimensionCodes` inserts `analytics:<code>`
 * after `run_build`. The token is not here: it is the last column, after amounts.
 */
export function detailColumns(scope: BudgetFileScope, dimensionCodes: readonly string[]): string[] {
  const columns = ['item_number', 'name'];
  if (scope === 'opex') columns.push('description');
  else columns.push('ppe_type', 'investment_type', 'priority');
  columns.push(
    'company_name', 'supplier_name', 'supplier_erp_id', 'account_number', 'cost_center_code', 'run_build',
  );
  for (const code of dimensionCodes) columns.push(`analytics:${code}`);
  columns.push(
    'owner_it_email', 'owner_business_email', 'project', 'currency', 'effective_start', 'end_of_validity', 'notes',
  );
  return columns;
}

/** Columns csv-sheet matches as fields. Analytics columns are declared separately. */
export function schemaFields(scope: BudgetFileScope): string[] {
  return [...detailColumns(scope, []), 'kanap_token'];
}

export function amountHeaders(years: readonly number[], columns: readonly string[], detail: BudgetFileDetail): string[] {
  const headers: string[] = [];
  for (const year of years) {
    for (const column of columns) {
      if (detail === 'yearly') {
        headers.push(`${column}_${year}`);
        continue;
      }
      for (let month = 1; month <= 12; month += 1) {
        headers.push(`${column}_${year}_${String(month).padStart(2, '0')}`);
      }
    }
  }
  return headers;
}

export function exportHeaders(
  scope: BudgetFileScope,
  dimensionCodes: readonly string[],
  years: readonly number[],
  columns: readonly string[],
  detail: BudgetFileDetail,
): string[] {
  return [...detailColumns(scope, dimensionCodes), ...amountHeaders(years, columns, detail), 'kanap_token'];
}

export function budgetFileSchema(
  scope: BudgetFileScope,
  language: CsvLanguage,
  dimensionCodes: readonly string[],
  dateOrder?: CsvDateOrder,
  decimalMark?: DecimalMark,
): CsvReadSchema {
  return {
    fields: schemaFields(scope),
    amounts: BUDGET_AMOUNT_COLUMNS,
    dimensions: dimensionCodes,
    dateFields: ['effective_start', 'end_of_validity'],
    language,
    dateOrder,
    decimalMark,
    conventionHint: {
      field: 'kanap_token',
      languageOf: (cell) => {
        const token = parseToken(cell);
        return token.kind === 'ok' ? token.language : null;
      },
    },
  };
}

/** True when the header row is an OPEX item file, a CAPEX item file, or a budget rows file. */
export function isOldBudgetLayout(headers: readonly string[]): boolean {
  const keys = headers.map((header) => looseKey(header));
  if (keys.some((key) => OLD_HEADER_KEYS.has(key))) return true;
  return keys.includes('measure') && keys.includes('jan');
}
