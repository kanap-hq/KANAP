import { provideGlobalGridOptions } from 'ag-grid-community';
import type { CsvExportParams } from 'ag-grid-community';

// A cell a spreadsheet would read as a formula: =, +, -, @, tab or a line break
// first (spaces before = + - @ too). Same rule as the server's CSV exports.
const FORMULA_TRIGGER = /^[=+\-@\t\r\n]|^\s+[=+\-@]/;
// A negative amount as the grids format it ("-1200.5", "-1 234,50 €", "-12 %"):
// digits, separators, a currency or percent sign. It cannot hold a formula, and a
// leading apostrophe would show in the spreadsheet, so it is left as it is.
const NEGATIVE_AMOUNT = /^-[\d\s  .,']*\d[\d\s  .,']*\s*(?:%|\p{Sc}|[A-Z]{3})?$/u;

/** The text, prefixed with a single quote when a spreadsheet would run it as a formula. */
export function neutralizeCsvText(text: string): string {
  if (!text) return text;
  return FORMULA_TRIGGER.test(text) && !NEGATIVE_AMOUNT.test(text) ? `'${text}` : text;
}

const guard = <T>(value: T): T | string => (typeof value === 'string' ? neutralizeCsvText(value) : value);

/**
 * CSV export defaults of every AG Grid: headers, group headers and cells pass
 * through `neutralizeCsvText`, so a tenant-defined name (budget column labels in
 * report headers, item names in cells) never runs as a formula. Each callback
 * reproduces what the grid writes without one: the CSV display name, the group's
 * header name, the formatted value unless the column opts out of formatting.
 */
export const CSV_EXPORT_GUARD: CsvExportParams = {
  processHeaderCallback: ({ api, column }) => String(guard(api.getDisplayNameForColumn(column, 'csv') ?? '')),
  processGroupHeaderCallback: ({ api, columnGroup }) => String(guard(api.getDisplayNameForColumnGroup(columnGroup, 'header') ?? '')),
  processCellCallback: ({ column, value, formatValue }) => {
    const shown = column.getColDef().useValueFormatterForExport === false ? value : formatValue(value);
    return guard(shown ?? '') as string;
  },
};

/** Installs the guard for every grid of the app; a grid's own export params still win. */
export function installCsvExportGuard(): void {
  provideGlobalGridOptions({ defaultCsvExportParams: CSV_EXPORT_GUARD }, 'deep');
}
