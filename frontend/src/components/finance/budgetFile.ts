import type { QueryClient } from '@tanstack/react-query';
import type { AxiosResponse } from 'axios';
import api from '../../api';
import { withListContext } from '../../lib/listContext';
import { statusScopeParams } from '../../utils/statusScopeParams';
import type { AmountReading, DateReading, ScreenLanguage } from '../csv/readings';
import type { ExportFormat } from '../csv/exportFormat';

// The reading helpers are shared with every other CSV import; they live in
// `components/csv/readings.ts` and are re-exported here for this dialog.
export {
  AMOUNT_COMMA,
  AMOUNT_DOT,
  DATE_DAY,
  DATE_MONTH,
  amountReadingOf,
  dateReadingOf,
  screenLanguage,
} from '../csv/readings';
export type { AmountReading, DateReading, ScreenLanguage } from '../csv/readings';

/**
 * The budget file of the OPEX and CAPEX lists: export, preflight and load
 * (`/spend-items/budget-file/*`, `/capex-items/budget-file/*`). One file holds
 * lines of both natures (its `nature` column); the list it is exported from or
 * loaded on gives the nature of a line in a file without that column.
 */

export type BudgetFileScope = 'opex' | 'capex';
export type BudgetFileExportScope = BudgetFileScope | 'all';

/** The name of an exported file, from either list. */
export const BUDGET_FILE_NAME = 'budget.csv';
export const BUDGET_XLSX_FILE_NAME = 'budget.xlsx';

/** The list queries a load may change: a file may hold lines of both natures. */
export const BUDGET_LIST_QUERY_KEYS = ['budget-lines-summary', 'spend-items-summary', 'capex-items-summary'] as const;

/**
 * Drop the cached budget lists. Dashboard tiles share these keys: the snapshot,
 * the recent updates and the top lines all start with `budget-lines-summary`,
 * and the snapshot stays fresh for five minutes. Call this once a line or its
 * amounts are stored, so the overview shows them on the next visit.
 */
export function invalidateBudgetLists(queryClient: QueryClient): void {
  for (const key of BUDGET_LIST_QUERY_KEYS) void queryClient.invalidateQueries({ queryKey: [key] });
}

export type BudgetFileLanguage = ScreenLanguage;

export type BudgetListState = {
  sort: string;
  q: string;
  filters: string;
  statusScope: string;
};

export function budgetFileBase(scope: BudgetFileScope): string {
  return scope === 'opex' ? '/spend-items/budget-file' : '/capex-items/budget-file';
}

/** The list whose filters a long export saves as `ctx`. */
export function budgetListEndpoint(scope: BudgetFileExportScope): string {
  if (scope === 'all') return '/budget-lines/summary';
  return scope === 'opex' ? '/spend-items/summary' : '/capex-items/summary';
}

export const FILE_COLUMN_KEYS = ['budget', 'revision', 'forecast', 'actual', 'landing'] as const;
export type FileColumnKey = (typeof FILE_COLUMN_KEYS)[number];

/** The server's year bound: within ten years of the current one, at most twelve years. */
export const MAX_EXPORT_YEARS = 12;
const YEAR_REACH = 10;

export function defaultYearRange(currentYear: number): { from: number; to: number } {
  return { from: currentYear - 1, to: currentYear + 1 };
}

/** Years the export may name. */
export function offerableYears(currentYear: number): number[] {
  return Array.from({ length: YEAR_REACH * 2 + 1 }, (_, index) => currentYear - YEAR_REACH + index);
}

/** The years of a range, at most `MAX_EXPORT_YEARS`. */
export function yearsOfRange(from: number, to: number): number[] {
  const start = Math.min(from, to);
  const end = Math.min(Math.max(from, to), start + MAX_EXPORT_YEARS - 1);
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

export type BudgetFileReport = {
  ok: boolean;
  notices: { dates: string | null; amounts: string | null };
  fileErrors: string[];
  headerErrors: string[];
  errors: Array<{ line: number; column: string | null; message: string }>;
  errorCount: number;
  missing: Array<{ type: string; count: number; examples: string[]; where: string; message: string }>;
  deleted: Array<{ line: number; itemNumber: string }>;
  deletedCount: number;
  changes: {
    created: number;
    updated: number;
    unchanged: number;
    createdLines: Array<{ line: number; name: string }>;
    updatedLines: Array<{ line: number; itemNumber: string; fields: string[] }>;
  };
  changedSinceExport: Array<{
    line: number;
    itemNumber: string;
    by: string | null;
    at: string | null;
    message: string;
  }>;
  changedSinceExportCount: number;
  warnings: {
    duplicates: Array<{ line: number; message: string }>;
    ignoredColumns: string[];
    supplierNames: Array<{ line: number; message: string }>;
    /** company_name of another company than the cost center's; `code` names the sentence in `errors`. */
    costCenterCompanies?: Array<{
      line: number;
      code: string;
      costCenter: string;
      company: string;
      costCenterCompany: string;
      message: string;
    }>;
    /** Cells the load does not read, by line and column (the description of a CAPEX line). */
    ignoredCells: Array<{ line: number; column: string; message: string }>;
    /**
     * Changed amounts on a column that follows its calculation lines: the lines stay as a reference.
     * `column` is the file column (`revision`), `total` what the lines give, two decimals.
     */
    calculationLines?: Array<{ line: number; item: string; column: string; year: number; count: number; total: string; message: string }>;
    /** How many calculation lines warnings there are in all; the list holds the first 20. */
    calculationLinesCount?: number;
  };
  creates: {
    /** Unknown values the load will create. */
    dimensionValues: Array<{ dimension: string; names: string[] }>;
    /** Unknown values of a closed list, refused to a limited person (their rows are errors too). Limited only. */
    refusedDimensionValues?: Array<{ dimension: string; names: string[] }>;
    suppliers: Array<{ name: string; erpId: string | null }>;
  };
  supplierMessage: string | null;
  snapshot: { lines: unknown[] };
  /** An Excel workbook of several sheets: the name of the one read, the first. */
  firstSheetOnly?: string;
  /** The check followed a limited person's access, line by line. */
  dataAccessLimited?: true;
};

export type BudgetFileLoad = {
  ok: true;
  dryRun: false;
  inserted: number;
  updated: number;
};

/* ---- Server sentences the dialog shows ---- */

/** `budget-file/import-file.ts` PREFLIGHT_STALE. */
export const STALE_SENTENCE = 'Some lines changed since the preflight. Run the preflight again.';
/** `budget-file/columns.ts`, the one message of a file in an old layout. */
export const OLD_LAYOUT_SENTENCE = 'This file comes from an earlier version of KANAP. Export a fresh file from this list, copy your changes into it, and import it again.';
/** `common/csv-sheet/decode.ts` CSV_DECODE_MESSAGES: a file that is not CSV text, by the code the interface translates. */
export const DECODE_SENTENCE_CODES: Record<string, string> = {
  'This file is not UTF-8 or Windows-1252.': 'CSV_ENCODING_UNSUPPORTED',
  'This file is an Excel workbook, not a CSV. In Excel: File › Save As › CSV UTF-8 (Comma delimited).': 'CSV_FILE_EXCEL',
  'This file is an OpenDocument spreadsheet, not a CSV. In LibreOffice Calc: File › Save As › Text CSV.': 'CSV_FILE_OPENDOCUMENT',
  'This file is not a CSV file. Save it as CSV UTF-8 and import it again.': 'CSV_FILE_NOT_TEXT',
  // `common/csv-sheet/read.ts` CSV_FILE_EMPTY_MESSAGE.
  'The file is empty.': 'CSV_FILE_EMPTY',
  // `budget-file/columns.ts` MISSING_BUDGET_HEADER_MESSAGE.
  'The first line of this file is not a budget file header. Export a fresh file from this list, copy your changes into it, and import it again.':
    'CSV_HEADER_NOT_BUDGET_FILE',
  // `common/xlsx/read.ts`: an Excel file that cannot be read (its `XlsxReadErrorCode`).
  'This is an old Excel file (.xls). Save it as .xlsx or CSV and import it again.': 'XLSX_OLD_FORMAT',
  'This file is not an Excel workbook (.xlsx). Save it as .xlsx or CSV and import it again.': 'XLSX_NOT_WORKBOOK',
  'This Excel file could not be read: it is damaged or incomplete. Save it again as .xlsx or CSV and import it again.': 'XLSX_INVALID',
  'This Excel file could not be read: it holds a document type declaration, which Excel never writes.': 'XLSX_DOCTYPE',
  'This workbook has no sheet to read.': 'XLSX_NO_SHEET',
};
/** `common/xlsx/read.ts` XLSX_TOO_LARGE: one sentence per limit, all with this start. */
export const XLSX_TOO_LARGE_START = 'This file is too large to read: ';
const SUPPLIERS_MISSING = /^(\d+) suppliers? do(?:es)? not exist\./;

/** The count of missing suppliers in the server's sentence, or null when it says something else. */
export function missingSupplierCount(message: string | null): number | null {
  const match = message ? SUPPLIERS_MISSING.exec(message) : null;
  return match ? Number(match[1]) : null;
}

/* ---- Failures ---- */

type ErrorBody = { message?: unknown; code?: unknown; error?: unknown };

export type BudgetFileFailure =
  | { kind: 'running' }
  | { kind: 'busy'; seconds: number | null }
  | { kind: 'tooLarge' }
  | { kind: 'stale' }
  | { kind: 'forbidden' }
  /** A refusal for the person's data access (403 `DATA_ACCESS_LIMITED`), by the server's sentence. */
  | { kind: 'dataAccess'; text: string }
  | { kind: 'message'; text: string }
  | { kind: 'unknown' };

function textOf(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(textOf).filter(Boolean).join(' ');
  return '';
}

async function errorBody(error: unknown): Promise<{ status: number; body: ErrorBody; retryAfter: string }> {
  const response = (error as { response?: { status?: number; data?: unknown; headers?: Record<string, string> } })?.response;
  let data = response?.data;
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    const text = await data.text();
    try {
      data = JSON.parse(text) as ErrorBody;
    } catch {
      data = {};
    }
  }
  const headers = response?.headers ?? {};
  const retryAfter = headers['retry-after'] ?? headers['Retry-After'] ?? '';
  const body = data && typeof data === 'object' ? (data as ErrorBody) : {};
  return { status: response?.status ?? 0, body, retryAfter: String(retryAfter) };
}

/** A failed export, preflight or load, as one of the plain messages the dialogs show. */
export async function budgetFileFailure(error: unknown): Promise<BudgetFileFailure> {
  const { status, body, retryAfter } = await errorBody(error);
  const code = textOf(body.code);
  const message = textOf(body.message);
  if (status === 413) return { kind: 'tooLarge' };
  if (code === 'operation_running') return { kind: 'running' };
  if (status === 503 || code === 'busy' || code === 'retry') {
    const seconds = Number(retryAfter);
    return { kind: 'busy', seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null };
  }
  if (status === 409 && message === STALE_SENTENCE) return { kind: 'stale' };
  if (status === 403 && code === 'DATA_ACCESS_LIMITED') return { kind: 'dataAccess', text: message };
  if (status === 401 || status === 403) return { kind: 'forbidden' };
  // A 400, 404, 409 or 422 carries a sentence written for the user (a frozen year, a missing file).
  if (message && status >= 400 && status < 500) return { kind: 'message', text: message };
  return { kind: 'unknown' };
}

/* ---- Requests ---- */

export function filenameFromDisposition(disposition: string | undefined, fallback: string): string {
  if (!disposition) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (star?.[1]) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      // fall through to the plain name
    }
  }
  const match = /filename="?([^";]+)"?/i.exec(disposition);
  return match?.[1] || fallback;
}

export function saveBlob(filename: string, data: BlobPart): void {
  const blob = data instanceof Blob ? data : new Blob([data], { type: 'text/csv;charset=utf-8' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export type ExportOptions = {
  language: BudgetFileLanguage;
  amountYears: number[];
  columns: string[];
  detail: 'yearly' | 'months';
  all: boolean;
  format?: ExportFormat;
};

/**
 * The list's query plus the export's own options, in the list's order.
 * `all` makes the server drop filters, search and status (ended lines included).
 */
export function exportParams(list: BudgetListState | null, options: ExportOptions): Record<string, string> {
  const params: Record<string, string> = {
    language: options.language,
    amountYears: options.amountYears.join(','),
    columns: options.columns.join(','),
    detail: options.detail,
  };
  if (options.format) params.format = options.format;
  if (list?.sort) params.sort = list.sort;
  if (options.all) {
    params.all = 'true';
    return params;
  }
  if (list) {
    if (list.q) params.q = list.q;
    if (list.filters) params.filters = list.filters;
    Object.assign(params, statusScopeParams(list.statusScope));
  }
  return params;
}

export async function exportBudgetFile(
  scope: BudgetFileExportScope,
  list: BudgetListState | null,
  options: ExportOptions,
): Promise<AxiosResponse<Blob>> {
  const params = exportParams(list, options);
  const sent = options.all ? params : await withListContext(budgetListEndpoint(scope), params);
  return api.get<Blob>(`${scope === 'all' ? '/budget-lines/budget-file' : budgetFileBase(scope)}/export`, { params: sent, responseType: 'blob' });
}

export type CheckOptions = {
  language: BudgetFileLanguage;
  dateOrder: DateReading | null;
  decimalMark: AmountReading | null;
  createSuppliers: boolean;
};

function checkParams(options: CheckOptions): Record<string, string> {
  const params: Record<string, string> = {
    language: options.language,
    createSuppliers: options.createSuppliers ? 'true' : 'false',
  };
  if (options.dateOrder) params.dateOrder = options.dateOrder;
  if (options.decimalMark) params.decimalMark = options.decimalMark;
  return params;
}

export function isBudgetFileReport(value: unknown): value is BudgetFileReport {
  return !!value && typeof value === 'object' && Array.isArray((value as BudgetFileReport).fileErrors);
}

export async function preflightBudgetFile(scope: BudgetFileScope, file: File, options: CheckOptions): Promise<BudgetFileReport> {
  const body = new FormData();
  body.append('file', file);
  const response = await api.post(`${budgetFileBase(scope)}/preflight`, body, { params: checkParams(options) });
  if (!isBudgetFileReport(response.data)) throw new Error('Unexpected preflight answer.');
  return response.data;
}

/** The load. A file that is not ready comes back as a report, with nothing written. */
export async function loadBudgetFile(
  scope: BudgetFileScope,
  file: File,
  snapshot: BudgetFileReport['snapshot'],
  options: CheckOptions,
): Promise<BudgetFileLoad | BudgetFileReport> {
  const body = new FormData();
  body.append('file', file);
  body.append('snapshot', JSON.stringify(snapshot));
  const response = await api.post(`${budgetFileBase(scope)}/import`, body, { params: checkParams(options) });
  return response.data as BudgetFileLoad | BudgetFileReport;
}
