import { BadRequestException } from '@nestjs/common';
import { endOfValidityFromDate } from '../status';
import { DecimalMark, ParsedAmount, parseCsvAmount, resolveAmountConvention } from './amount';
import { CLEAR_MARK, GUARDED_DASH } from './clear';
import { formatCsvDate, formatCsvEndOfValidity } from './date';
import { csvDecodeErrorCode } from './decode';
import { CSV_FILE_EMPTY_MESSAGE, readSheet } from './read';
import { CsvAmountColumn, CsvDataRow, CsvDateOrder, CsvHeaderErrorCode, CsvLanguage } from './types';
import { sameStoredValue } from './unchanged';

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
  /**
   * The titles each column is also read by (`CsvReadSchema.fieldLabels`), and the one a header
   * refusal names it by: the title in `language`, else the column.
   */
  fieldLabels?: Readonly<Record<string, Readonly<Partial<Record<CsvLanguage, string>>>>>;
  /** The decimal columns of the file, written `<name>_<year>` (`turnover_2027`). */
  amounts?: readonly CsvAmountColumn[];
  /** The columns read as dates. They must also be listed in `fields`. */
  dateFields?: readonly string[];
  /** Columns accepted when absent. Every other column, and every unknown one, is refused. */
  optional?: readonly string[];
  /**
   * The columns a row finds its record by, or creates one by: each entry is one way (`[['reference'],
   * ['name']]`). When set, the file must carry every column of one entry at least, and may leave out
   * any other column of `fields`, which the import then never writes; `optional` is not read. An
   * unknown column is refused as before. A file that carries none names the columns of the last entry.
   */
  keys?: readonly (readonly string[])[];
  /**
   * An unknown header that stays in `ignoredColumns` and does not refuse the file.
   * Any other unknown header still does.
   */
  noticeUnknown?: (header: string) => boolean;
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
  /** What still uses the record, counted per kind (`{{usages}}` in the sentence of `code`), as a refused delete gives them. */
  usages?: Array<{ type: string; total: number }>;
}

/**
 * A row of the file that updates a stored record (Q1 of 26.11.9): its line, and the record by its
 * business reference (`PRJ-4`, `SUP-3`), null when its family has none, and its name. Every row import
 * lists them, so that the check names the records it updates.
 */
export interface ImportUpdate {
  row: number;
  ref: string | null;
  name: string;
}

/** The rows that update a record an import's result lists: the first ones, as the card keeps its warnings. */
export const UPDATE_LIST_LIMIT = 20;

/** The rows that update a record, for an import's result: the first ones and their total; nothing when none. */
export function listedUpdates(updates: readonly ImportUpdate[]): { updates?: ImportUpdate[]; updatesTotal?: number } {
  return updates.length > 0 ? { updates: updates.slice(0, UPDATE_LIST_LIMIT), updatesTotal: updates.length } : {};
}

/** A record's business reference from its prefix and number (`SUP-3`), null when it has no number. */
export function numberedReference(prefix: string, itemNumber: number | string | null | undefined): string | null {
  return itemNumber === null || itemNumber === undefined || itemNumber === '' ? null : `${prefix}-${Number(itemNumber)}`;
}

/**
 * What the import of a master-data file answers, at the check (`dryRun`) and at the load, with
 * the same counts. `cleared`: the stored values the rows clear with `-` (D21 of 26.11.9), the
 * supplier contact links a `-` removes included; a `-` on a value already empty is not counted.
 * Set on a file that imports; the check says it before anything is written.
 */
export interface MasterDataImportResult {
  ok: boolean;
  dryRun: boolean;
  total: number;
  inserted: number;
  updated: number;
  unchanged?: number;
  cleared?: number;
  /** The rows written, at the load. */
  processed?: number;
  errors: ImportReportError[];
  /** Rows that import, with a note (a name matched in another case, a rename, a move). */
  warnings?: ImportReportError[];
  /** The rows that update a stored record, the first ones (`listedUpdates`), and their total; absent when none. */
  updates?: ImportUpdate[];
  updatesTotal?: number;
  /** The unknown headers the file carried, and what the shared layer noticed. */
  ignoredColumns: string[];
  notices: MasterDataFileRead['notices'];
}

export interface MasterDataFileRead {
  /** Set when the file is refused for its headers (row 0). `rows` is then empty. */
  headerError: ImportReportError | null;
  rows: CsvDataRow[];
  /** The column ids the file carried, so a caller can tell an absent column from a blank cell. */
  present: string[];
  ignoredColumns: string[];
  /** `firstSheetOnly`: an .xlsx workbook of several sheets, the name of the one read (the first). */
  notices: { dates: string | null; amounts: string | null; firstSheetOnly?: string };
}

/**
 * Read one master-data file, CSV or .xlsx (`readSheet`). A file that cannot be read at all is a 400,
 * the way every one of these importers answered for an unreadable upload. A header problem comes back
 * for the caller's own report, as it did before.
 */
export async function readMasterDataFile(request: MasterDataFileRequest): Promise<MasterDataFileRead> {
  const read = await readSheet(request.file, {
    fields: request.fields,
    fieldLabels: request.fieldLabels ? labelLists(request.fieldLabels) : undefined,
    amounts: request.amounts,
    dateFields: request.dateFields,
    language: request.language,
    dateOrder: request.dateOrder,
    decimalMark: request.decimalMark,
    typedNumbersInLanguage: true,
    keepsGuardedDash: true,
  });
  if (read.fileErrors.length > 0) {
    const code = read.fileErrorCode
      ?? csvDecodeErrorCode(read.fileErrors[0])
      ?? (read.fileErrors[0] === CSV_FILE_EMPTY_MESSAGE ? 'CSV_FILE_EMPTY' : null);
    throw new BadRequestException(code ? { message: read.fileErrors[0], code } : read.fileErrors[0]);
  }
  const notices: MasterDataFileRead['notices'] = { dates: read.dates?.notice ?? null, amounts: read.amounts?.notice ?? null };
  if (read.format === 'xlsx' && (read.sheetCount ?? 1) > 1 && read.sheetName !== undefined) notices.firstSheetOnly = read.sheetName;
  const headerError = headerProblem(request, read);
  return {
    headerError,
    rows: headerError === null ? read.rows : [],
    present: read.columns.map((column) => column.id),
    ignoredColumns: read.ignoredColumns,
    notices,
  };
}

/** The titles of each column, every language, for the reader (`CsvReadSchema.fieldLabels`). */
export function labelLists(labels: NonNullable<MasterDataFileRequest['fieldLabels']>): Record<string, string[]> {
  const lists: Record<string, string[]> = {};
  for (const [field, byLanguage] of Object.entries(labels)) {
    lists[field] = Object.values(byLanguage).filter((label): label is string => !!label);
  }
  return lists;
}

/** The refusal of a file for its headers: the missing columns (by their title in the file's language), then the unknown ones. */
function headerProblem(
  request: MasterDataFileRequest,
  read: { headerErrors: string[]; headerErrorCodes?: Array<CsvHeaderErrorCode | null>; columns: Array<{ id: string }>; ignoredColumns: string[] },
): ImportReportError | null {
  if (read.headerErrors.length > 0) {
    // Errors of one code are one sentence the interface words (the doubled columns listed by key, which
    // the screen names by their labels); any other mix keeps the reader's English sentences.
    const codes = read.headerErrorCodes ?? [];
    const first = codes[0];
    if (first && codes.length === read.headerErrors.length && codes.every((entry) => entry?.code === first.code)) {
      const columns = codes.flatMap((entry) => (entry && 'params' in entry ? [entry.params.columns] : []));
      return {
        row: 0,
        message: read.headerErrors.join(' '),
        code: first.code,
        ...(columns.length > 0 ? { params: { columns: [...new Set(columns)].join(', ') } } : {}),
      };
    }
    return { row: 0, message: read.headerErrors.join(' ') };
  }
  const optional = new Set(request.optional ?? []);
  const present = new Set(read.columns.map((column) => column.id));
  const keys = request.keys;
  const wanted = keys
    ? (keys.some((entry) => entry.every((field) => present.has(field))) ? [] : keys[keys.length - 1] ?? [])
    : request.fields.filter((field) => !optional.has(field));
  const missing = wanted
    .filter((field) => !present.has(field))
    .map((field) => request.fieldLabels?.[field]?.[request.language] ?? field);
  const notice = request.noticeUnknown;
  const extras = notice ? read.ignoredColumns.filter((header) => !notice(header)) : read.ignoredColumns;
  return headerMismatchError(missing, extras);
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

/**
 * A trimmed cell. A column the file does not carry, or an empty cell, is ''. `'-`, which these
 * files keep as written (`keepsGuardedDash`), is the text "-".
 */
export function cellOf(row: CsvDataRow, field: string): string {
  const text = (row.cells[field] ?? '').trim();
  return text === GUARDED_DASH ? CLEAR_MARK : text;
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
 * The coded row error for a refused name or code cell: empty, longer than `max`, or holding
 * control or invisible characters (the only three refusals of the field normalizers). `message`
 * is the normalizer's English sentence, kept for API clients.
 */
export function textCellError(row: number, column: string, value: string, max: number, message: string): ImportReportError {
  const text = value.trim();
  if (!text) return rowError(row, column, 'CSV_VALUE_REQUIRED', message);
  if ([...text].length > max) return rowError(row, column, 'CSV_VALUE_TOO_LONG', message, { max });
  return rowError(row, column, 'CSV_VALUE_INVISIBLE_CHARACTERS', message);
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
 * The families whose file names a record by its reference (`COMP-3`), and the parent records a
 * row can move it to. Each is the `context` of the warning's sentence (i18next): the interface
 * writes `CSV_REFERENCE_RENAMES_<family>` or `CSV_REFERENCE_MOVES_<parent>` when that key exists,
 * since a language may agree the verb or the article with the noun (« sera renommée », « de la
 * société »), and the bare code otherwise.
 */
export type ReferenceFamily = 'company' | 'department' | 'supplier' | 'contact' | 'contract';
export type ReferenceParent = 'company' | 'supplier';

/**
 * The warning of a row whose filled reference renames its record (D12 of 26.11.9): a file
 * exported from another workspace names unrelated records by the same references, so the
 * check says each name it will change. It blocks nothing. Null when the row keeps the stored
 * name, compared as the import decides that a row is unchanged (`sameStoredValue`).
 */
export function referenceRenameWarning(
  row: number,
  change: { family: ReferenceFamily; reference: string; stored: string; next: string },
): ImportReportError | null {
  if (sameStoredValue(change.stored, change.next)) return null;
  return {
    row,
    message: `${change.reference} "${change.stored}" will be renamed "${change.next}".`,
    code: 'CSV_REFERENCE_RENAMES',
    params: { reference: change.reference, stored: change.stored, name: change.next, context: change.family },
  };
}

/**
 * The warning of a row whose filled reference moves its record to another parent (a department
 * to another company, a contract or a contact to another supplier). `name` is the record's
 * stored name, `from` and `to` the names of the two parents. Null when the parent stays, by id.
 */
export function referenceMoveWarning(
  row: number,
  move: { parent: ReferenceParent; reference: string; name: string; storedParentId: string | null; nextParentId: string | null; from: string; to: string },
): ImportReportError | null {
  if (sameStoredValue(move.storedParentId, move.nextParentId)) return null;
  return {
    row,
    message: `${move.reference} "${move.name}" will move from ${move.parent} "${move.from}" to "${move.to}".`,
    code: 'CSV_REFERENCE_MOVES',
    params: { reference: move.reference, name: move.name, from: move.from, to: move.to, context: move.parent },
  };
}

/**
 * The warning of a row whose filled reference changes its contact's e-mail address (D12 of
 * 26.11.9), the contact's key when a row has no reference: like a rename, it blocks nothing. Null
 * when the row keeps the stored address. `name` is the contact's stored name, else its address.
 */
export function referenceEmailWarning(
  row: number,
  change: { reference: string; name: string; stored: string; next: string },
): ImportReportError | null {
  if (sameStoredValue(change.stored, change.next)) return null;
  return {
    row,
    message: `${change.reference} "${change.name}" will change its e-mail address: "${change.stored}" → "${change.next}".`,
    code: 'CSV_REFERENCE_EMAIL_CHANGES',
    params: { reference: change.reference, name: change.name, from: change.stored, to: change.next },
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
