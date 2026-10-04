import { BadRequestException } from '@nestjs/common';
import { endOfValidityFromDate } from '../status';
import { DecimalMark } from './amount';
import { formatCsvDate, formatCsvEndOfValidity } from './date';
import { readCsv } from './read';
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

export interface MasterDataFileRead {
  /** Set when the file is refused for its headers. `rows` is then empty. */
  headerError: string | null;
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
  if (read.fileErrors.length > 0) throw new BadRequestException(read.fileErrors[0]);
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

/** The refusal these files have always written: the missing columns, then the unknown ones. */
function headerProblem(
  request: MasterDataFileRequest,
  read: { headerErrors: string[]; columns: Array<{ id: string }>; ignoredColumns: string[] },
): string | null {
  if (read.headerErrors.length > 0) return read.headerErrors.join(' ');
  const optional = new Set(request.optional ?? []);
  const present = new Set(read.columns.map((column) => column.id));
  const missing = request.fields.filter((field) => !optional.has(field) && !present.has(field));
  const extras = read.ignoredColumns;
  if (missing.length === 0 && extras.length === 0) return null;
  return `Header mismatch. Missing: ${missing.join(', ') || '-'}, Extra: ${extras.join(', ') || '-'}`;
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

/** The message `parseCsvEndOfValidity` wrote for a cell it refused, kept as is. */
export function invalidEndOfValidity(field: string, raw: string): string {
  return `Invalid ${field} '${raw}'. Use YYYY-MM-DD or a full ISO date and time.`;
}

/**
 * An end-of-validity cell for an export. A bare `YYYY-MM-DD` is the calendar
 * day it spells. A timestamp at noon UTC is the day the user picked, written
 * the language's way. Any other instant has a real time and stays ISO.
 */
export function endOfValidityCell(value: Date | string | null | undefined, language: CsvLanguage): string {
  if (value == null) return '';
  const text = value instanceof Date ? value.toISOString() : String(value).trim();
  if (text === '') return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return formatCsvDate(text, language);
  return formatCsvEndOfValidity(text, language);
}
