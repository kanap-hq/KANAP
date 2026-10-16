import { BadRequestException } from '@nestjs/common';
import { endOfValidityFromDate } from '../status';
import { DecimalMark, ParsedAmount, parseCsvAmount, resolveAmountConvention } from './amount';
import { formatCsvDate, formatCsvEndOfValidity } from './date';
import { csvDecodeErrorCode } from './decode';
import { CSV_FILE_EMPTY_MESSAGE, readCsv } from './read';
import { CsvAmountColumn, CsvDataRow, CsvDateOrder, CsvLanguage } from './types';

/**
 * Reading a master-data file: companies, departments, users, suppliers,
 * accounts, cost centers, dimension values and calendars. The columns, the
 * rules and the refusals are the ones these files have always had; the
 * decoding, the separator, the date forms, the amount convention, the formula
 * guard and the physical line numbers come from the shared layer.
 */
export interface MasterDataFileRequest {
  file: Buffer;
  /** The export's columns. */
  fields: readonly string[];
  /** The decimal columns of the file, written `<name>_<year>` (`turnover_2027`). */
  amounts?: readonly CsvAmountColumn[];
  /** The columns read as dates. They must also be listed in `fields`. */
  dateFields?: readonly string[];
  /** Columns accepted when absent. Every other column, and every unknown one, is refused. */
  optional?: readonly string[];
  language: CsvLanguage;
  dateOrder?: CsvDateOrder;
  decimalMark?: DecimalMark;
}

/**
 * One problem of an import report (an error, or a warning on a row that imports). `row` 0 is
 * the header, `column` the cell's column when the problem is about one. `code` and `params`
 * let the interface translate the message; `message` stays in English for API clients.
 */
export interface ImportReportError {
  row: number;
  message: string;
  column?: string;
  code?: string;
  params?: Record<string, string | number>;
}

export interface MasterDataFileRead {
  /** Set when the file is refused for its headers (row 0). `rows` is then empty. */
  headerError: ImportReportError | null;
  rows: CsvDataRow[];
  /** The column ids the file carried, so a caller can tell an absent column from a blank cell. */
  present: string[];
  ignoredColumns: string[];
  notices: { dates: string | null; amounts: string | null };
}

/**
 * Read one master-data file. A file that cannot be read at all is a 400, the
 * way every one of these importers answered for an unreadable upload. A
 * header problem comes back for the caller's own report, as it did before.
 */
export async function readMasterDataFile(request: MasterDataFileRequest): Promise<MasterDataFileRead> {
  const read = await readCsv(request.file, {
    fields: request.fields,
    amounts: request.amounts,
    dateFields: request.dateFields,
    language: request.language,
    dateOrder: request.dateOrder,
    decimalMark: request.decimalMark,
  });
  if (read.fileErrors.length > 0) {
    const code = csvDecodeErrorCode(read.fileErrors[0])
      ?? (read.fileErrors[0] === CSV_FILE_EMPTY_MESSAGE ? 'CSV_FILE_EMPTY' : null);
    throw new BadRequestException(code ? { message: read.fileErrors[0], code } : read.fileErrors[0]);
  }
  const notices = { dates: read.dates?.notice ?? null, amounts: read.amounts?.notice ?? null };
  const headerError = headerProblem(request, read);
  return {
    headerError,
    rows: headerError === null ? read.rows : [],
    present: read.columns.map((column) => column.id),
    ignoredColumns: read.ignoredColumns,
    notices,
  };
}

/** The refusal of a file for its headers: the missing columns, then the unknown ones. */
function headerProblem(
  request: MasterDataFileRequest,
  read: { headerErrors: string[]; columns: Array<{ id: string }>; ignoredColumns: string[] },
): ImportReportError | null {
  if (read.headerErrors.length > 0) return { row: 0, message: read.headerErrors.join(' ') };
  const optional = new Set(request.optional ?? []);
  const present = new Set(read.columns.map((column) => column.id));
  const missing = request.fields.filter((field) => !optional.has(field) && !present.has(field));
  return headerMismatchError(missing, read.ignoredColumns);
}

/**
 * The header refusal every CSV import writes, or null when nothing is missing
 * or unknown. The English message names only the parts that apply
 * ("Header mismatch. Missing: a, b"); the code tells the interface which ones.
 */
export function headerMismatchError(missing: readonly string[], extras: readonly string[]): ImportReportError | null {
  if (missing.length === 0 && extras.length === 0) return null;
  const parts: string[] = [];
  if (missing.length > 0) parts.push(`Missing: ${missing.join(', ')}`);
  if (extras.length > 0) parts.push(`Extra: ${extras.join(', ')}`);
  const code = missing.length === 0
    ? 'CSV_HEADER_UNKNOWN_COLUMNS'
    : extras.length === 0 ? 'CSV_HEADER_MISSING_COLUMNS' : 'CSV_HEADER_MISMATCH';
  return {
    row: 0,
    message: `Header mismatch. ${parts.join(', ')}`,
    code,
    params: { missing: missing.join(', '), extra: extras.join(', ') },
  };
}

/** A trimmed cell. A column the file does not carry, or an empty cell, is ''. */
export function cellOf(row: CsvDataRow, field: string): string {
  return (row.cells[field] ?? '').trim();
}

/**
 * What the shared layer says is wrong with this row, named by column when it
 * knows which one. The date fields are left out: the caller reports those
 * through `endOfValidityOf`, with the message these files have always used.
 */
export function rowProblems(row: CsvDataRow, dateFields: readonly string[] = []): string[] {
  return row.errors
    .filter((error) => !(error.column !== null && dateFields.includes(error.column)))
    .map((error) => (error.column === null ? error.message : `${error.column}: ${error.message}`));
}

/**
 * `rowProblems` as report entries: each keeps the shared reader's code and column, so the import
 * dialog words it in the interface language. The English text stays for API clients.
 */
export function rowProblemErrors(row: CsvDataRow, dateFields: readonly string[] = []): ImportReportError[] {
  return row.errors
    .filter((error) => !(error.column !== null && dateFields.includes(error.column)))
    .map((error) => ({
      row: row.line,
      message: error.column === null ? error.message : `${error.column}: ${error.message}`,
      ...(error.column !== null ? { column: error.column } : {}),
      ...(error.code ? { code: error.code } : {}),
      ...(error.params ? { params: error.params } : {}),
    }));
}

/**
 * One coded row error on a column (`errors:CSV_*`, such as CSV_VALUE_REQUIRED or
 * CSV_REFERENCE_NOT_FOUND): the dialog words it in the interface language; `message` stays the
 * English text API clients have always read.
 */
export function rowError(
  row: number,
  column: string,
  code: string,
  message: string,
  params?: Record<string, string | number>,
): ImportReportError {
  return { row, column, code, message, ...(params ? { params } : {}) };
}

/**
 * An end-of-validity cell as this column stores it: a bare day at noon UTC, a
 * full timestamp kept as given, an empty cell meaning no end. `-` and
 * anything the shared layer could not read are refused, as they were before.
 */
export function endOfValidityOf(row: CsvDataRow, field: string): { value: Date | null; error: string | null } {
  const raw = cellOf(row, field);
  if (raw === '') return { value: null, error: null };
  const parsed = row.dates[field];
  if (!parsed || parsed.kind === 'clear') return { value: null, error: invalidEndOfValidity(field, raw) };
  if (parsed.kind === 'instant') return { value: new Date(parsed.iso), error: null };
  return { value: endOfValidityFromDate(parsed.isoDate), error: null };
}

/** The message these files write for a cell the shared layer could not read as a date. */
export function invalidEndOfValidity(field: string, raw: string): string {
  return `Invalid ${field} '${raw}'. Use a date such as 2027-12-31 or 31/12/2027.`;
}

/**
 * An end-of-validity cell for an export: the calendar day, the language's
 * way. A bare `YYYY-MM-DD` is the day it spells; an instant writes its UTC day
 * (`formatCsvEndOfValidity`).
 */
export function endOfValidityCell(value: Date | string | null | undefined, language: CsvLanguage): string {
  if (value == null) return '';
  const text = value instanceof Date ? value.toISOString() : String(value).trim();
  if (text === '') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return formatCsvDate(text, language);
  return formatCsvEndOfValidity(text, language);
}

/**
 * The warning of a row whose name matched a stored record written in another case ("sap" when
 * "SAP" exists): the row updates that record and the stored spelling stays. Null when the
 * spellings are the same.
 */
export function nameMatchedWarning(row: number, column: string, fileName: string, storedName: string): ImportReportError | null {
  if (fileName === storedName) return null;
  return {
    row,
    column,
    message: `'${fileName}' was matched to '${storedName}'.`,
    code: 'CSV_NAME_MATCHED_CASE',
    params: { name: fileName, stored: storedName },
  };
}

/**
 * A decimal column without a year (a contract's amount at signature), read the way the amount
 * columns are: the file's cells settle the decimal mark, then the switch, then the language. Two
 * conventions in one column are a file error; a mark the cells could not settle comes with the
 * same notice as the amount columns.
 */
export function fieldAmounts(
  rows: readonly CsvDataRow[],
  field: string,
  language: CsvLanguage,
  decimalMark?: DecimalMark,
): { error: string | null; notice: string | null; amountOf(row: CsvDataRow): ParsedAmount } {
  const decision = resolveAmountConvention(rows.map((row) => cellOf(row, field)), language, decimalMark);
  return {
    error: decision.error,
    notice: decision.notice,
    amountOf: (row) => parseCsvAmount(cellOf(row, field), decision.decimal ?? undefined),
  };
}
