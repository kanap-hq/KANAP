import { BadRequestException } from '@nestjs/common';
import { formatCsvAmount } from '../csv-sheet/amount';
import { formatCsvDate, formatCsvDateTime, isoDateTimeInTimeZone } from '../csv-sheet/date';
import { csvProfile } from '../csv-sheet/language';
import { formatCsvPercent } from '../csv-sheet/percent';
import type { CsvLanguage } from '../csv-sheet/types';
import { writeCsv } from '../csv-sheet/write';
import type { ExportFileFormat } from '../xlsx/format';
import { writeXlsx, XLSX_CONTENT_TYPE, XlsxCell, XlsxSheet } from '../xlsx/write';
import { REPORT_EXPORT_LABELS } from './labels';

/**
 * The file of a report table export (`GET …/<report>/export?format=csv|xlsx`), the same for every report.
 *
 * A report builds a `ReportExport` from the result its screen shows (the same service call, the same
 * order): one or more tables of values, never display strings, and the parameters it applied in readable
 * words, in the language of the request. `writeReportExport` turns it into the file:
 * - xlsx: one styled sheet per table (data rows, then the footer rows in bold, outside the filter range so a
 *   sort or a filter never moves a total), then a "Parameters" sheet: the
 *   parameters, the generation date and time in the user's zone, the user's name and, for a person under
 *   data-scoped access, "Computed on your access".
 * - CSV: exactly one table (header, data rows, footer rows), in the language's separator and decimal mark.
 *   When the export has several tables, `table` (a table `key`) picks it: missing or unknown is a 400.
 * - `limited` (data-scoped access): the footer rows (grand totals) are dropped everywhere.
 * - File name `<fileBase>-<YYYY-MM-DD>.<ext>` (the day in the user's zone); a CSV of an export with several
 *   tables is `<fileBase>-<table key>-<day>.csv`. `rows` counts the data rows written, footers left out.
 *
 * Cells by column kind: `text` a string, `number` a finite number (days, FTE, counts; CSV with the
 * language's decimal mark; a column marked `decimals: 2` shows two decimals in the workbook), `amount` a dot-decimal string with two decimals (`-1234.50`; CSV with the
 * language's decimal mark), `date` an ISO day (CSV in the language's format), `percent` a fraction
 * (`0.125`; CSV `12.50%` / `12,50%`). `null` is an empty cell in every kind. A cell that does not match its
 * column throws: it is a bug of the report, not of the request.
 *
 * Controllers parse the request with `reportExportRequest` and answer with `reportExportBody`
 * (`send.ts`), which also records the format and the row count on the export's audit row.
 */

export type ReportCell = XlsxCell;
export type ReportColumnKind = 'text' | 'number' | 'amount' | 'date' | 'percent';

export interface ReportColumn {
  header: string;
  kind: ReportColumnKind;
  /** A `number` column the screen shows with two decimals (FTE, days): `0.00` in the workbook. The CSV keeps the value. */
  decimals?: 2;
}

export interface ReportTable {
  /** Stable name of the table for `table=` (`contributors`, `teams`): never translated. */
  key: string;
  /** The translated sheet name: 31 characters at most (Excel's limit), so it is never cut. */
  sheet: string;
  columns: ReportColumn[];
  rows: ReportCell[][];
  /** Total rows written after the data rows; dropped when the export is `limited`. */
  footer?: ReportCell[][];
}

export interface ReportExport {
  /** `time-logged`, `capacity-heatmap`, … */
  fileBase: string;
  tables: ReportTable[];
  /** Every parameter the export applied, `[label, value]`, in readable words of the request language. */
  parameters: Array<[string, string]>;
  /** The person is under data-scoped access: no total row, and the Parameters sheet says so. */
  limited: boolean;
}

export interface ReportExportRequest {
  format: ExportFileFormat;
  language: CsvLanguage;
  /** The user's zone: the generation time and the day of the file name. */
  timeZone: string;
  /** A table `key`: the table of a CSV, the first sheet of an xlsx. */
  table?: string;
  generatedAt: Date;
  /** The user's display name. */
  generatedBy: string;
}

export interface ReportExportFile {
  filename: string;
  contentType: string;
  body: Buffer;
  /** Data rows written (footer rows not counted), for the audit row. */
  rows: number;
  limited: boolean;
}

export const CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
/** Excel's limit for a sheet name: a longer label would be cut. */
export const REPORT_SHEET_NAME_MAX = 31;

const AMOUNT_TEXT = /^-?\d+(\.\d+)?$/;

export function writeReportExport(exp: ReportExport, request: ReportExportRequest): ReportExportFile {
  if (exp.tables.length === 0) throw new Error('report export: no table');
  const keys = new Set(exp.tables.map((table) => table.key));
  if (keys.size !== exp.tables.length) throw new Error('report export: table keys must be unique');
  for (const table of exp.tables) {
    if (table.sheet.length > REPORT_SHEET_NAME_MAX) throw new Error(`report export: the sheet "${table.sheet}" is over ${REPORT_SHEET_NAME_MAX} characters`);
  }
  if (request.table !== undefined && !keys.has(request.table)) {
    throw new BadRequestException(`table must be one of ${[...keys].join(', ')}.`);
  }
  const day = (isoDateTimeInTimeZone(request.generatedAt, request.timeZone) ?? request.generatedAt.toISOString()).slice(0, 10);
  const rowsOf = (table: ReportTable): ReportCell[][] => [...table.rows, ...(exp.limited ? [] : table.footer ?? [])];

  if (request.format === 'csv') {
    if (exp.tables.length > 1 && request.table === undefined) {
      throw new BadRequestException(`table is required for a CSV file: ${[...keys].join(', ')}.`);
    }
    const table = exp.tables.find((candidate) => candidate.key === request.table) ?? exp.tables[0];
    const language = request.language;
    const text = writeCsv({
      language,
      headers: table.columns.map((column) => column.header),
      rows: rowsOf(table).map((row, index) => csvRow(table, row, index, language)),
    });
    const name = exp.tables.length > 1 ? `${exp.fileBase}-${table.key}-${day}.csv` : `${exp.fileBase}-${day}.csv`;
    return { filename: name, contentType: CSV_CONTENT_TYPE, body: Buffer.from(text, 'utf8'), rows: table.rows.length, limited: exp.limited };
  }

  const ordered = request.table === undefined
    ? exp.tables
    : [...exp.tables.filter((table) => table.key === request.table), ...exp.tables.filter((table) => table.key !== request.table)];
  const sheets: XlsxSheet[] = ordered.map((table) => {
    rowsOf(table).forEach((row, index) => checkRow(table, row, index));
    const footer = exp.limited ? [] : table.footer ?? [];
    const shown = (row: ReportCell[]): ReportCell[] => row.map((cell, column) =>
      cell !== null && typeof cell !== 'string' && cell.kind === 'number' && table.columns[column].decimals === 2 ? { ...cell, decimals: 2 } : cell);
    return { name: table.sheet, headers: table.columns.map((column) => column.header), rows: table.rows.map(shown), footer: footer.map(shown) };
  });
  const labels = REPORT_EXPORT_LABELS[request.language];
  const zoneSuffix = request.timeZone === 'UTC' ? ' UTC' : ` (${request.timeZone})`;
  const parameterRows: XlsxCell[][] = [
    ...exp.parameters.map(([label, value]): XlsxCell[] => [label, value]),
    [labels.generatedOn, `${formatCsvDateTime(request.generatedAt, request.language, request.timeZone)}${zoneSuffix}`],
    [labels.generatedBy, request.generatedBy],
    ...(exp.limited ? [[labels.computedOnYourAccess, null] as XlsxCell[]] : []),
  ];
  sheets.push({ name: labels.parameters, headers: [labels.parameter, labels.value], rows: parameterRows });
  return {
    filename: `${exp.fileBase}-${day}.xlsx`,
    contentType: XLSX_CONTENT_TYPE,
    body: writeXlsx({ language: request.language, sheets }),
    rows: exp.tables.reduce((sum, table) => sum + table.rows.length, 0),
    limited: exp.limited,
  };
}

function checkRow(table: ReportTable, row: ReportCell[], index: number): void {
  if (row.length !== table.columns.length) {
    throw new Error(`report export: table ${table.key} row ${index + 1} has ${row.length} cells for ${table.columns.length} columns`);
  }
  row.forEach((cell, column) => {
    if (cell === null) return;
    const kind = table.columns[column].kind;
    const actual = typeof cell === 'string' ? 'text' : cell.kind;
    if (actual !== kind) {
      throw new Error(`report export: table ${table.key} row ${index + 1} column ${column + 1} is ${actual}, the column is ${kind}`);
    }
    if (actual === 'amount' && !AMOUNT_TEXT.test((cell as { value: string }).value)) {
      throw new Error(`report export: table ${table.key} row ${index + 1} column ${column + 1}: not a decimal amount`);
    }
  });
}

function csvRow(table: ReportTable, row: ReportCell[], index: number, language: CsvLanguage): string[] {
  checkRow(table, row, index);
  const decimal = csvProfile(language).decimal;
  return row.map((cell) => {
    if (cell === null) return '';
    if (typeof cell === 'string') return cell;
    switch (cell.kind) {
      case 'number':
        if (!Number.isFinite(cell.value)) throw new Error(`report export: table ${table.key} row ${index + 1}: a number cell needs a finite number`);
        return decimal === ',' ? numberText(cell.value).replace('.', ',') : numberText(cell.value);
      case 'amount':
        return formatCsvAmount(cell.value, language);
      case 'date':
        return formatCsvDate(cell.iso, language);
      case 'percent':
        return formatCsvPercent(cell.value, language);
    }
    return '';
  });
}

/** A number as plain decimal text, never in exponent form. */
function numberText(value: number): string {
  const text = String(Object.is(value, -0) ? 0 : value);
  if (!/e/i.test(text)) return text;
  return value.toFixed(12).replace(/\.?0+$/, '');
}
