import { BadRequestException } from '@nestjs/common';
import { CsvLanguage, formatCsvAmount, formatCsvDate, formatCsvEndOfValidity } from '../../common/csv-sheet';
import { assertBudgetYearsWithinBounds } from '../budget-list/budget-list.service';
import { exportHeaders, FILE_COLUMNS, isFileColumn, measureOfColumn } from './columns';
import { formatToken } from './token';
import { moneyText } from './interpret';
import { AmountMeasure } from '../amounts-write.util';
import { BudgetFileDetail, lineRef, StoredLine, StoredVersion } from './types';
import type { FileDimension } from './load';

const FILE_QUERY = new Set(['amountyears', 'columns', 'detail', 'language', 'all', 'dateorder', 'createsuppliers']);

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
 */
export function buildBudgetExport(input: {
  language: CsvLanguage;
  years: readonly number[];
  columns: readonly string[];
  detail: BudgetFileDetail;
  lines: readonly StoredLine[];
  dimensions: readonly FileDimension[];
}): { headers: string[]; rows: string[][] } {
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
): string[] {
  const values = new Map<string, string>();
  values.set('nature', line.nature);
  values.set('item_number', lineRef(line.itemNumber));
  values.set('name', line.name ?? '');
  // A CAPEX line's description is not in the file until lot U (`CAPEX_DESCRIPTION_IGNORED`).
  values.set('description', line.nature === 'capex' ? '' : line.description ?? '');
  values.set('company_name', line.companyName ?? '');
  values.set('supplier_name', line.supplierName ?? '');
  values.set('supplier_erp_id', line.supplierErpId ?? '');
  values.set('account_number', line.accountNumber ?? '');
  values.set('cost_center_code', line.costCenterCode ?? '');
  values.set('run_build', line.runBuild ?? '');
  for (const dimension of input.dimensions) {
    const applies = !dimension.appliesTo || dimension.appliesTo === line.nature;
    values.set(`analytics:${dimension.code}`, applies ? line.analytics[dimension.code] ?? '' : '');
  }
  values.set('owner_it_email', line.ownerItEmail ?? '');
  values.set('owner_business_email', line.ownerBusinessEmail ?? '');
  values.set('project', line.projectNumber == null ? '' : `PRJ-${line.projectNumber}`);
  values.set('currency', (line.currency ?? '').trim());
  values.set('effective_start', line.effectiveStart ? formatCsvDate(line.effectiveStart, input.language) : '');
  values.set('end_of_validity', formatEnd(line.endOfValidity, input.language));
  values.set('notes', line.notes ?? '');
  const tokenYears: Array<{ year: number; rev: number }> = [];
  for (const year of input.years) {
    const version = line.versions.find((item) => item.year === year);
    if (version) tokenYears.push({ year, rev: version.budgetRev });
    for (const column of input.columns) {
      writeAmount(values, version, column, year, input.detail, input.language);
    }
  }
  values.set('kanap_token', formatToken(line.rowVersion, tokenYears, input.language));
  return headers.map((header) => values.get(header) ?? '');
}

function writeAmount(
  values: Map<string, string>,
  version: StoredVersion | undefined,
  column: string,
  year: number,
  detail: BudgetFileDetail,
  language: CsvLanguage,
): void {
  const measure = measureOfColumn(column);
  if (detail === 'yearly') {
    const months = version?.months[measure] ?? [];
    const any = months.some((month) => month.cents !== null);
    values.set(`${column}_${year}`, any ? formatCsvAmount(moneyText(yearTotal(months)), language) : '');
    return;
  }
  for (let month = 1; month <= 12; month += 1) {
    const cents = version?.months[measure][month - 1]?.cents ?? null;
    const id = `${column}_${year}_${String(month).padStart(2, '0')}`;
    values.set(id, cents == null ? '' : formatCsvAmount(moneyText(cents), language));
  }
}

function yearTotal(months: Array<{ cents: bigint | null }>): bigint {
  return months.reduce((sum, month) => sum + (month.cents ?? 0n), 0n);
}

/** A noon-UTC end of validity is a calendar day. Any other instant stays ISO. */
export const formatEnd = formatCsvEndOfValidity;

function asText(raw: unknown): string {
  if (Array.isArray(raw)) return raw.map((part) => String(part)).join(',');
  return raw == null ? '' : String(raw);
}

/** One file for both natures since lot C1b, whatever list it is exported from. */
export const BUDGET_FILE_NAME = 'budget.csv';
