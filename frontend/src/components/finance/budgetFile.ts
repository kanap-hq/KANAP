import type { QueryClient } from '@tanstack/react-query';
import type { AxiosResponse } from 'axios';
import api from '../../api';
import { PRODUCT_NAME } from '../../config/product';
import { withListContext } from '../../lib/listContext';
import { statusScopeParams } from '../../utils/statusScopeParams';
import type { AmountReading, DateReading, ScreenLanguage } from '../csv/readings';
import type { ExportFormat } from '../csv/exportFormat';
import type { CsvImportRefusedProposal } from '../csv/csv.types';

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

/**
 * A sentence of the check: `code` is its key in the `errors` namespace, with the values it names
 * (`params`); `message` is the server's English text, shown when there is no code.
 */
export type BudgetFileSentence = { message: string; code?: string; params?: Record<string, string | number> };

/**
 * A choice of the person on a check: a match undone (the value is then created, or refused), or the
 * "Create missing suppliers" option. Sent as the `choices` form field, a JSON list, to the preflight
 * and to the load; and in `{ choices }` to the import card's choice route.
 */
export type BudgetFileChoice =
  | { kind: 'unmatch'; column: string; value: string }
  | { kind: 'create_suppliers'; value: boolean }
  /**
   * A row that looks like a stored line (lot I2 of 26.11.9): `line` is the row's line in the person's
   * file; "Ignore" is the default and is sent only to override a choice for all rows. `item` and
   * `state` for "Update": the line's number and its `target.state` from the report.
   */
  | { kind: 'lookalike'; line: number; action: 'ignore' | 'create' }
  | { kind: 'lookalike'; line: number; action: 'update'; item: number; state?: string }
  /**
   * Every row that looks like a stored line; a choice for one row wins. `targets`: the report's
   * `lookalikes.targets`, the line each row looked like at the check shown. The check gives this
   * choice back, `ignore` when the person chose nothing: a row keeps its target, so a row left out
   * stays left out and a line changed since is refused.
   */
  | { kind: 'lookalikes'; action: 'ignore' | 'create' | 'update'; targets?: Record<string, BudgetFileLookalikeTarget> };

/** The line a row looks like, and its state at the check. */
export type BudgetFileLookalikeTarget = { item: number; state: string };

/** A row to create that looks like a stored line the person reads (lot I2 of 26.11.9). */
export type BudgetFileLookalike = {
  line: number;
  nature: BudgetFileScope;
  name: string;
  /** The line it looks like: its number, reference (`BL-n`), title and state at the check. */
  target: { item: number; ref: string; name: string; state: string };
  /** Absent when the row keeps a line it no longer looks like (the line changed since the check). */
  reason?: 'title_supplier' | 'amounts' | 'close_title';
  outcome: 'ignored' | 'created' | 'updated';
  /** "Update" is offered only when true. */
  updatable: boolean;
  /** For an update: the fields it changes. */
  fields?: string[];
};

/** The matching of a check: `lines` are the lines of the person's file, the first 20; `count` all of them. */
export type BudgetFileMatching = {
  /** Values matched to an existing value beyond case; every one can be undone. */
  matches: Array<{
    column: string;
    /** The dimension's name for an `analytics:` column; null for the supplier and the unnamed default dimension. */
    name: string | null;
    value: string;
    target: string;
    origin: 'server' | 'model';
    reason: 'accents' | 'translation' | 'model' | 'version';
    lines: number[];
    count: number;
    undoable: true;
  }>;
  /** Kad's proposals the check refused: no such value (`missing`) or a disabled one. */
  refusedProposals: CsvImportRefusedProposal[];
  /** Values nothing matched (unknown companies included), with up to three closest names of the workspace's list. */
  candidates: Array<{
    column: string;
    name: string | null;
    value: string;
    outcome: 'create' | 'refused';
    lines: number[];
    count: number;
    candidates: Array<{ name: string; score: number }>;
  }>;
  /** The choices the check followed. */
  choices: BudgetFileChoice[];
  /** The "Create missing suppliers" box: shown when `allowed`, `value` the one followed. */
  createSuppliers: { allowed: boolean; value: boolean };
};

export type BudgetFileReport = {
  ok: boolean;
  notices: { dates: string | null; amounts: string | null };
  fileErrors: string[];
  headerErrors: string[];
  errors: Array<{ line: number; column: string | null } & BudgetFileSentence>;
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
    /** New rows that look like an earlier row of the file (`BUDGET_FILE_LOOKS_LIKE_ROW`): the first 20. Created. */
    duplicates: Array<{ line: number } & BudgetFileSentence>;
    /** How many there are in all (absent from a report of before 26.11.8). */
    duplicatesCount?: number;
    ignoredColumns: string[];
    supplierNames: Array<{ line: number } & BudgetFileSentence>;
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
    /** Consistency warnings of the lines written (amount, dates, currency), the first 20; `code` names the sentence in `errors`. */
    consistency?: Array<{ line: number } & BudgetFileSentence>;
    consistencyCount?: number;
  };
  /** The rows that look like a stored line, the first 200, and what the check does with them (lot I2 of 26.11.9). */
  lookalikes?: {
    lines: BudgetFileLookalike[];
    /** Every row's target, by its line in the file, beyond the 200 listed: what "Update all" sends. */
    targets: Record<string, BudgetFileLookalikeTarget>;
    count: number;
    ignored: number;
    created: number;
    updated: number;
  };
  creates: {
    /** Unknown values the load will create; `name` is the dimension's name (null for the unnamed default dimension). */
    dimensionValues: Array<{ dimension: string; name?: string | null; names: string[] }>;
    /** Unknown values of a closed list, refused to a limited person (their rows are errors too). Limited only. */
    refusedDimensionValues?: Array<{ dimension: string; name?: string | null; names: string[] }>;
    suppliers: Array<{ name: string; erpId: string | null }>;
  };
  /** What the check matched before creating, and what it could not (absent when the file was refused before its rows). */
  matching?: BudgetFileMatching;
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
  /** The rows left out because they look like a stored line. */
  skipped?: number;
};

/* ---- Server sentences the dialog shows ---- */

/** `budget-file/import-file.ts` PREFLIGHT_STALE. */
export const STALE_SENTENCE = 'Some lines changed since the preflight. Run the preflight again.';
/** `budget-file/columns.ts`, the one message of a file in an old layout. */
export const OLD_LAYOUT_SENTENCE = `This file comes from an earlier version of ${PRODUCT_NAME}. Export a fresh file from this list, copy your changes into it, and import it again.`;
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
  /** The person's choices (matches undone): the load sends the list of the check it follows. */
  choices?: BudgetFileChoice[];
};

/** The file and the choices, in the form's body: a choice names values of the file, never in the address. */
function checkBody(file: File, options: CheckOptions): FormData {
  const body = new FormData();
  body.append('file', file);
  if (options.choices?.length) body.append('choices', JSON.stringify(options.choices));
  return body;
}

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
  const body = checkBody(file, options);
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
  const body = checkBody(file, options);
  body.append('snapshot', JSON.stringify(snapshot));
  const response = await api.post(`${budgetFileBase(scope)}/import`, body, { params: checkParams(options) });
  return response.data as BudgetFileLoad | BudgetFileReport;
}
