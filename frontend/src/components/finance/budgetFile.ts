import type { AxiosResponse } from 'axios';
import api from '../../api';
import { withListContext } from '../../lib/listContext';
import { statusScopeParams } from '../../utils/statusScopeParams';
import type { AmountReading, DateReading, ScreenLanguage } from '../csv/readings';

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
 * (`/spend-items/budget-file/*`, `/capex-items/budget-file/*`). Contract:
 * planning/sfr/briefs/csv-c2.md.
 */

export type BudgetFileScope = 'opex' | 'capex';

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
export function budgetListEndpoint(scope: BudgetFileScope): string {
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
  };
  creates: {
    dimensionValues: Array<{ dimension: string; names: string[] }>;
    suppliers: Array<{ name: string; erpId: string | null }>;
  };
  supplierMessage: string | null;
  snapshot: { lines: unknown[] };
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
  scope: BudgetFileScope,
  list: BudgetListState | null,
  options: ExportOptions,
): Promise<AxiosResponse<Blob>> {
  const params = exportParams(list, options);
  const sent = options.all ? params : await withListContext(budgetListEndpoint(scope), params);
  return api.get<Blob>(`${budgetFileBase(scope)}/export`, { params: sent, responseType: 'blob' });
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
