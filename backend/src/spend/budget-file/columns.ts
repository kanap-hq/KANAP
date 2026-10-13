import { AmountMeasure } from '../amounts-write.util';
import { BUDGET_AMOUNT_COLUMNS, CsvDateOrder, CsvLanguage, CsvReadSchema, DecimalMark } from '../../common/csv-sheet';
import { looseKey } from '../../common/csv-sheet/text';
import { BudgetFileDetail } from './types';
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

/**
 * The columns of the three CAPEX criteria before lot C1. A file with all three is a CAPEX file
 * exported before lot C1: refused as a whole, since their values are dimension values now, read
 * from `analytics:ppe_type`, `analytics:investment_type` and `analytics:priority` (never guessed
 * from the former codes). One or two of them alone are unknown columns, ignored with a warning
 * like any other. Compared like the old headers.
 */
const CRITERIA_HEADER_KEYS = new Set(['ppetype', 'investmenttype', 'priority']);

export const CRITERIA_COLUMNS_MESSAGE =
  'The ppe_type, investment_type and priority columns are now dimension columns (analytics:ppe_type, analytics:investment_type, analytics:priority). '
  + 'Export a fresh file from this list, copy your changes into it, and import it again.';

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
 * Detail columns in file order, the same for both natures since lot C1b: `nature` first (the
 * line's type, `opex` or `capex`), then `item_number` (`BL-n`). `dimensionCodes` inserts
 * `analytics:<code>` after `run_build`, one column per enabled dimension whatever the lines it is
 * for (the PP&E type, investment type and priority of a CAPEX line among them since lot C1). The
 * token is not here: it is the last column, after amounts.
 */
export function detailColumns(dimensionCodes: readonly string[]): string[] {
  const columns = [
    'nature', 'item_number', 'name', 'description',
    'company_name', 'supplier_name', 'supplier_erp_id', 'account_number', 'cost_center_code', 'run_build',
  ];
  for (const code of dimensionCodes) columns.push(`analytics:${code}`);
  columns.push(
    'owner_it_email', 'owner_business_email', 'project', 'currency', 'effective_start', 'end_of_validity', 'notes',
  );
  return columns;
}

/** Columns csv-sheet matches as fields. Analytics columns are declared separately. */
export function schemaFields(): string[] {
  return [...detailColumns([]), 'kanap_token'];
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
  dimensionCodes: readonly string[],
  years: readonly number[],
  columns: readonly string[],
  detail: BudgetFileDetail,
): string[] {
  return [...detailColumns(dimensionCodes), ...amountHeaders(years, columns, detail), 'kanap_token'];
}

/** The reader's schema. Every enabled dimension is a column; a line's own nature decides whether it may hold a value. */
export function budgetFileSchema(
  language: CsvLanguage,
  dimensionCodes: readonly string[],
  dateOrder?: CsvDateOrder,
  decimalMark?: DecimalMark,
): CsvReadSchema {
  return {
    fields: schemaFields(),
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

/** True when the header row has the three columns of the CAPEX criteria of before lot C1, on any route. */
export function hasCriteriaColumns(headers: readonly string[]): boolean {
  const keys = new Set(headers.map((header) => looseKey(header)));
  return [...CRITERIA_HEADER_KEYS].every((key) => keys.has(key));
}

/** True when the header row is an OPEX item file, a CAPEX item file, or a budget rows file. */
export function isOldBudgetLayout(headers: readonly string[]): boolean {
  const keys = headers.map((header) => looseKey(header));
  if (keys.some((key) => OLD_HEADER_KEYS.has(key))) return true;
  return keys.includes('measure') && keys.includes('jan');
}
