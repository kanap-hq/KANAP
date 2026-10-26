import { BadRequestException } from '@nestjs/common';
import { CsvLanguage, formatCsvAmount, formatCsvDate, formatCsvEndOfValidity, writeCsv } from '../../common/csv-sheet';
import { ExportFileFormat, writeXlsx, XLSX_CONTENT_TYPE, XlsxCell } from '../../common/xlsx';
import { assertBudgetYearsWithinBounds } from '../budget-list/budget-list.service';
import { exportHeaders, FILE_COLUMNS, isFileColumn, measureOfColumn } from './columns';
import { formatToken } from './token';
import { moneyText } from './interpret';
import { AmountMeasure } from '../amounts-write.util';
import { BudgetFileDetail, lineRef, StoredLine, StoredVersion } from './types';
import type { FileDimension } from './load';

const FILE_QUERY = new Set(['amountyears', 'columns', 'detail', 'language', 'all', 'dateorder', 'createsuppliers', 'format']);

/**
 * The list query, without the budget-file parameters.
 * `all` drops filters, search and status. Ended lines are included: the ids
 * endpoint's fallback is the Enabled lines, and a status set of both values is
 * discarded before that fallback, so "every status" is `includeDisabled`.
 */
export function exportListQuery(query: Record<string, unknown>, all: boolean): Record<string, unknown> {
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(query)) {
    if (FILE_QUERY.has(key.toLowerCase())) continue;
    next[key] = value;
  }
  if (all) {
    delete next.filters;
    delete next.q;
    delete next.ctx;
    for (const key of Object.keys(next)) {
      const folded = key.toLowerCase();
      if (folded === 'status' || folded === 'includedisabled') delete next[key];
    }
    next.includeDisabled = '1';
  }
  return next;
}

export function parseDetail(raw: unknown): BudgetFileDetail {
  if (raw == null || raw === '' || raw === 'yearly') return 'yearly';
  if (raw === 'months') return 'months';
  throw new BadRequestException('detail must be yearly or months.');
}

/** Shown columns when the query names none. At least one. Order is the file order. */
export function parseFileColumns(raw: unknown, shown: readonly string[]): string[] {
  const text = asText(raw);
  const wanted = text === '' ? shown : text.split(',').map((part) => part.trim().toLowerCase()).filter(Boolean);
  if (text !== '') {
    const unknown = wanted.find((column) => !isFileColumn(column));
    if (unknown) {
      throw new BadRequestException(`Unknown column '${unknown}'. Use budget, revision, forecast, actual or landing.`);
    }
  }
  const columns = FILE_COLUMNS.filter((column) => wanted.includes(column));
  if (columns.length === 0) throw new BadRequestException('Choose at least one column.');
  return [...columns];
}

/** Default is the current year, the year before and the year after. */
export function parseAmountYears(raw: unknown, currentYear: number): number[] {
  const text = asText(raw);
  const years = text === ''
    ? [currentYear - 1, currentYear, currentYear + 1]
    : text.split(',').map((part) => part.trim()).filter(Boolean).map((part) => Number(part));
  if (years.some((year) => !Number.isInteger(year))) {
    throw new BadRequestException('amountYears must be a list of years, for example 2026,2027.');
  }
  const unique = [...new Set(years)].sort((a, b) => a - b);
  if (unique.length === 0) throw new BadRequestException('amountYears must name a year.');
  assertBudgetYearsWithinBounds(unique, currentYear);
  return unique;
}

export function shownFileColumns(enabled: Record<AmountMeasure, boolean>): string[] {
  return FILE_COLUMNS.filter((column) => enabled[measureOfColumn(column)]);
}

/**
 * The file of some lines: one row per line, with its `nature` and its `BL-n` number. Every enabled
 * dimension is a column; a line's cell is left empty on a dimension of the other nature (a value
 * it keeps there would be refused on the way back).
 *
 * The cells are typed (the xlsx writer's): amounts as decimal text, days as days, the rest as text
 * (numbers, codes with leading zeros, the token). An amount with no stored month is empty, never 0.
 * The CSV writes them the language's way (`budgetCsvRows`).
 */
export function buildBudgetExport(input: {
  language: CsvLanguage;
  years: readonly number[];
  columns: readonly string[];
  detail: BudgetFileDetail;
  lines: readonly StoredLine[];
  dimensions: readonly FileDimension[];
}): { headers: string[]; rows: XlsxCell[][] } {
  const headers = exportHeaders(input.dimensions.map((dimension) => dimension.code), input.years, input.columns, input.detail);
  const rows = input.lines.map((line) => exportRow(input, line, headers));
  return { headers, rows };
}

function exportRow(
  input: {
    language: CsvLanguage;
    years: readonly number[];
    columns: readonly string[];
    detail: BudgetFileDetail;
    dimensions: readonly FileDimension[];
  },
  line: StoredLine,
  headers: readonly string[],
): XlsxCell[] {
  const values = new Map<string, XlsxCell>();
  values.set('nature', line.nature);
  values.set('item_number', lineRef(line.itemNumber));
  values.set('name', line.name ?? '');
  values.set('description', line.description ?? '');
  values.set('company_name', line.companyName ?? '');
  values.set('supplier_name', line.supplierName ?? '');
  values.set('supplier_erp_id', line.supplierErpId ?? '');
  values.set('account_number', line.accountNumber ?? '');
  values.set('cost_center_code', line.costCenterCode ?? '');
  values.set('cost_center_path', line.costCenterPath ?? '');
  values.set('run_build', line.runBuild ?? '');
  for (const dimension of input.dimensions) {
    const applies = !dimension.appliesTo || dimension.appliesTo === line.nature;
    values.set(`analytics:${dimension.code}`, applies ? line.analytics[dimension.code] ?? '' : '');
  }
  values.set('owner_it_email', line.ownerItEmail ?? '');
  values.set('owner_business_email', line.ownerBusinessEmail ?? '');
  values.set('project', line.projectNumber == null ? '' : `PRJ-${line.projectNumber}`);
  values.set('currency', (line.currency ?? '').trim());
  values.set('effective_start', line.effectiveStart ? { kind: 'date', iso: line.effectiveStart } : null);
  values.set('end_of_validity', endOfValidityCell(line.endOfValidity));
  values.set('notes', line.notes ?? '');
  const tokenYears: Array<{ year: number; rev: number }> = [];
  for (const year of input.years) {
    const version = line.versions.find((item) => item.year === year);
    if (version) tokenYears.push({ year, rev: version.budgetRev });
    for (const column of input.columns) {
      writeAmount(values, version, column, year, input.detail);
    }
  }
  values.set('kanap_token', formatToken(line.rowVersion, tokenYears, input.language));
  return headers.map((header) => values.get(header) ?? '');
}

function writeAmount(
  values: Map<string, XlsxCell>,
  version: StoredVersion | undefined,
  column: string,
  year: number,
  detail: BudgetFileDetail,
): void {
  const measure = measureOfColumn(column);
  if (detail === 'yearly') {
    const months = version?.months[measure] ?? [];
    const any = months.some((month) => month.cents !== null);
    values.set(`${column}_${year}`, any ? { kind: 'amount', value: moneyText(yearTotal(months)) } : null);
    return;
  }
  for (let month = 1; month <= 12; month += 1) {
    const cents = version?.months[measure][month - 1]?.cents ?? null;
    const id = `${column}_${year}_${String(month).padStart(2, '0')}`;
    values.set(id, cents == null ? null : { kind: 'amount', value: moneyText(cents) });
  }
}

function yearTotal(months: Array<{ cents: bigint | null }>): bigint {
  return months.reduce((sum, month) => sum + (month.cents ?? 0n), 0n);
}

/** An end of validity is written as its calendar day (`formatCsvEndOfValidity`). */
export const formatEnd = formatCsvEndOfValidity;

/** The day `formatCsvEndOfValidity` writes: the UTC day of the stored instant. Empty when there is none. */
function endOfValidityCell(iso: string | null): XlsxCell {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return { kind: 'date', iso: date.toISOString().slice(0, 10) };
}

/** The rows of the export as the CSV writes them: amounts with the language's decimal mark, days in its order. */
export function budgetCsvRows(rows: readonly (readonly XlsxCell[])[], language: CsvLanguage): string[][] {
  return rows.map((row) => row.map((cell) => budgetCsvCell(cell, language)));
}

function budgetCsvCell(cell: XlsxCell, language: CsvLanguage): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string') return cell;
  if (cell.kind === 'amount') return formatCsvAmount(cell.value, language);
  if (cell.kind === 'date') return formatCsvDate(cell.iso, language);
  return String(cell.value);
}

function asText(raw: unknown): string {
  if (Array.isArray(raw)) return raw.map((part) => String(part)).join(',');
  return raw == null ? '' : String(raw);
}

/** One file for both natures since lot C1b, whatever list it is exported from. */
export const BUDGET_FILE_NAME = 'budget.csv';
export const BUDGET_XLSX_FILE_NAME = 'budget.xlsx';

/** The file of `buildBudgetExport`: the CSV, or a workbook of one sheet named `budget`. */
export function writeBudgetFile(
  built: { headers: readonly string[]; rows: readonly (readonly XlsxCell[])[] },
  language: CsvLanguage,
  format: ExportFileFormat,
): { filename: string; contentType: string; content: string | Buffer } {
  if (format === 'xlsx') {
    return {
      filename: BUDGET_XLSX_FILE_NAME,
      contentType: XLSX_CONTENT_TYPE,
      content: writeXlsx({ language, sheets: [{ name: 'budget', headers: built.headers, rows: built.rows, header: 'styled' }] }),
    };
  }
  return {
    filename: BUDGET_FILE_NAME,
    contentType: 'text/csv; charset=utf-8',
    content: writeCsv({ language, headers: built.headers, rows: budgetCsvRows(built.rows, language) }),
  };
}
