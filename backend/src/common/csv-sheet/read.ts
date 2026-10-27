import { BadRequestException } from '@nestjs/common';
import { parse } from 'csv-parse';
import { Features } from '../../config/features';
import { denormalizeCsvFormulaValue } from '../csv/csv-export.service';
import { Decimal } from '../decimal';
import {
  hasOldExcelSignature,
  hasZipSignature,
  readXlsxGrid,
  XlsxReadCell,
  XlsxReadError,
  XlsxReadErrorCode,
} from '../xlsx/read';
import { parseCsvAmount, resolveAmountConvention } from './amount';
import { parseCsvDateCell, resolveDateOrder } from './date';
import { csvProfile } from './language';
import { CsvDecodeError, decodeCsv } from './decode';
import { classifyHeaders, validateSchema } from './headers';
import {
  CSV_ROW_CAP,
  CsvAmountReading,
  CsvColumn,
  CsvParsedAmount,
  CsvDataRow,
  CsvDateReading,
  CsvLanguage,
  CsvReadResult,
  CsvReadSchema,
  CsvSeparator,
} from './types';

interface RawRow {
  line: number;
  cells: string[];
}

/**
 * One cell of a sheet: a CSV file gives text cells, an .xlsx file typed ones. Text is already cleaned
 * (trimmed, formula guard undone).
 */
export type SheetCell = XlsxReadCell;

/** A row of a sheet, with the physical line (CSV) or the spreadsheet row (.xlsx) it starts on. */
interface GridRow {
  line: number;
  cells: SheetCell[];
}

/** `readCsv`'s result, with the format read and, for an .xlsx file, the sheet read. */
export interface SheetReadResult extends CsvReadResult {
  format: 'csv' | 'xlsx';
  /** The sheet read: the first worksheet of the workbook. */
  sheetName?: string;
  /** Sheets of the workbook: more than one means the others were not read. */
  sheetCount?: number;
  /** The code of an .xlsx refusal, whose sentence is `fileErrors[0]`. */
  fileErrorCode?: XlsxReadErrorCode;
}

const SEPARATORS: readonly CsvSeparator[] = [',', ';', '\t'];

/** The refusal of a file with no header, translated by the interface as `CSV_FILE_EMPTY`. */
export const CSV_FILE_EMPTY_MESSAGE = 'The file is empty.';

const rowCapMessage = (): string => `This file has more than ${CSV_ROW_CAP.toLocaleString('en-US')} rows.`;

/**
 * Rows the .xlsx reader counts and this layer then skips as blank (a row of cells holding only spaces),
 * above the header or among the data rows. The reader stops past the row cap, the header and this
 * margin; the exact cap is counted here, on rows that are not blank.
 */
export const XLSX_BLANK_ROW_MARGIN = 100;

/**
 * Read one spreadsheet file. Parsing is a stream and stops once the row cap
 * is passed. The rows are returned because a preflight needs every one of
 * them, and the cap is what bounds that.
 *
 * `headerErrors` and `fileErrors` refuse the file. Rows are still returned
 * when the headers parsed, so one pass can list every row error. A file that
 * cannot be split, or that is over the cap, comes back with no rows.
 */
export async function readCsv(input: Buffer | string, schema: CsvReadSchema): Promise<CsvReadResult> {
  validateSchema(schema);
  const decoded = decodeInput(input);
  if (decoded.error) return baseResult(decoded.encoding, null, [decoded.error]);
  const text = normalizeNewlines(stripBom(decoded.text));
  if (text.trim() === '') return baseResult(decoded.encoding, null, [CSV_FILE_EMPTY_MESSAGE]);

  const opened = firstRecord(text);
  if (opened.error) return baseResult(decoded.encoding, null, [opened.error]);
  if (!opened.record) return baseResult(decoded.encoding, null, [CSV_FILE_EMPTY_MESSAGE]);
  const separator = chooseSeparator(opened.record);
  if (!separator) return baseResult(decoded.encoding, null, ['The separator could not be read from the header.']);

  const parsed = await parseRecords(text, separator);
  if (parsed.capped) {
    return baseResult(decoded.encoding, separator, [rowCapMessage()]);
  }
  if (parsed.error) return baseResult(decoded.encoding, separator, [parsed.error]);
  const rows = parsed.rows.map((row) => ({ line: row.line, cells: row.cells.map(textCell) }));
  return readGrid(rows, schema, decoded.encoding, separator);
}

/**
 * Read a spreadsheet file, CSV or .xlsx, told apart by content: a ZIP archive is an .xlsx workbook
 * (the old .xls format is refused with its own sentence), anything else is CSV. The result is
 * `readCsv`'s, plus the format. In an .xlsx file only the first worksheet is read; number and date
 * cells are read as they are typed, outside the date-order and decimal-mark settlement, which only
 * concerns text cells.
 */
export async function readSheet(input: Buffer, schema: CsvReadSchema): Promise<SheetReadResult> {
  // With the imports in CSV only (`IMPORT_XLSX` off), a workbook meets the CSV decoder and its sentence.
  if (!isWorkbookBytes(input)) return { ...(await readCsv(input, schema)), format: 'csv' };
  validateSchema(schema);
  let grid: ReturnType<typeof readXlsxGrid>;
  try {
    grid = readXlsxGrid(input, { maxValueRows: CSV_ROW_CAP + 1 + XLSX_BLANK_ROW_MARGIN });
  } catch (error) {
    if (!(error instanceof XlsxReadError)) throw error;
    // Past the row cap: the CSV file's refusal, word for word.
    if (error.limit === 'maxValueRows') return { ...baseResult('utf-8', null, [rowCapMessage()]), format: 'xlsx' };
    return { ...baseResult('utf-8', null, [error.message]), format: 'xlsx', fileErrorCode: error.code };
  }
  const sheet = { format: 'xlsx' as const, sheetName: grid.sheetName, sheetCount: grid.sheetCount };
  const rows: GridRow[] = [];
  let dataRows = 0;
  for (let index = 0; index < grid.rows.length; index += 1) {
    const cells = grid.rows[index].map((cell) => (cell.kind === 'text' ? textCell(cleanCell(cell.value)) : cell));
    if (cells.every(isBlank)) continue;
    if (rows.length > 0) {
      dataRows += 1;
      if (dataRows > CSV_ROW_CAP) return { ...baseResult('utf-8', null, [rowCapMessage()]), ...sheet };
    }
    rows.push({ line: index + 1, cells });
  }
  return { ...readGrid(rows, schema, 'utf-8', null), ...sheet };
}

/** A workbook to read as one: a ZIP or OLE file while the imports read workbooks (`IMPORT_XLSX`). */
function isWorkbookBytes(input: Buffer): boolean {
  return Features.IMPORT_XLSX && (hasZipSignature(input) || hasOldExcelSignature(input));
}

/** The text of an import file, CSV or converted from the first sheet of an .xlsx workbook. */
export interface ImportFileText {
  /** CSV text: the file's own, decoded, or the sheet's cells written with `;`. */
  text: string;
  format: 'csv' | 'xlsx';
  /** The sheet read: the first worksheet of the workbook. */
  sheetName?: string;
  /** Sheets of the workbook: more than one means the others were not read. */
  sheetCount?: number;
}

/**
 * The text of an import file, for the importers that parse CSV text themselves (fast-csv). A CSV file
 * is decoded as `decodeCsv` does, with its refusals (`CsvDecodeError`). An .xlsx workbook, while the
 * imports read them, becomes the CSV text of its first worksheet, one line per spreadsheet row and
 * `;` between cells: a text cell as it is (the importer trims it and undoes the formula guard, as for
 * a CSV file), a number in plain decimal notation with a point, a date as its ISO day, followed by its
 * time (`2026-06-02 07:52:00`) when the cell has one: the time Excel shows, with no zone, which the
 * importer reads as it reads the same text in a CSV file. Its refusals
 * are 400s with their `XLSX_*` code; a sheet past the import's row cap gets the CSV row-cap sentence.
 */
export function readImportText(input: Buffer): ImportFileText {
  if (!isWorkbookBytes(input)) return { text: decodeCsv(input).text, format: 'csv' };
  let grid: ReturnType<typeof readXlsxGrid>;
  try {
    grid = readXlsxGrid(input, { maxValueRows: CSV_ROW_CAP + 1 + XLSX_BLANK_ROW_MARGIN });
  } catch (error) {
    if (!(error instanceof XlsxReadError)) throw error;
    if (error.limit === 'maxValueRows') throw new BadRequestException(rowCapMessage());
    throw new BadRequestException({ message: error.message, code: error.code });
  }
  const text = grid.rows.map((row) => row.map((cell) => csvTextCell(importCellText(cell))).join(';')).join('\n');
  return { text, format: 'xlsx', sheetName: grid.sheetName, sheetCount: grid.sheetCount };
}

/** The text of a cell for the import text: `sheetCellText`, with the time of a date-time cell. */
function importCellText(cell: SheetCell): string {
  return cell.kind === 'date' && cell.time ? `${cell.iso} ${cell.time}` : sheetCellText(cell);
}

/** A cell of CSV text: quoted when it holds a separator, a quote, a line break or edge spaces. */
function csvTextCell(value: string): string {
  return /[",;\t\r\n]|^\s|\s$/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** Header detection, matching, settlement and row building, on rows that are not blank. */
function readGrid(
  rows: readonly GridRow[],
  schema: CsvReadSchema,
  encoding: 'utf-8' | 'windows-1252',
  separator: CsvSeparator | null,
): CsvReadResult {
  if (rows.length === 0) return baseResult(encoding, separator, [CSV_FILE_EMPTY_MESSAGE]);

  const headerRow = rows[0];
  // `name;notes;` is a trailing delimiter, not an empty column.
  const headerCells = withoutTrailingBlanks(headerRow.cells.map(sheetCellText));
  if (headerCells.length === 0) return baseResult(encoding, separator, [CSV_FILE_EMPTY_MESSAGE]);
  const classified = classifyHeaders(headerCells, schema);
  const built = buildRows(rows.slice(1), classified.slots, schema);
  return {
    encoding,
    separator,
    headerLine: headerRow.line,
    rawHeaders: headerCells,
    columns: classified.columns,
    ignoredColumns: classified.ignoredColumns,
    headerErrors: classified.headerErrors,
    fileErrors: built.fileErrors,
    rows: built.rows,
    dates: built.dates,
    amounts: built.amounts,
  };
}

function textCell(value: string): SheetCell {
  return { kind: 'text', value };
}

function isBlank(cell: SheetCell): boolean {
  return cell.kind === 'empty' || (cell.kind === 'text' && cell.value === '');
}

/**
 * The text of a cell, as a CSV file would hold it: a number in plain decimal notation without float
 * noise (`1100`, `0.001`), a date as its ISO day (the shared layer's date columns hold days only).
 */
export function sheetCellText(cell: SheetCell): string {
  switch (cell.kind) {
    case 'text':
      return cell.value;
    case 'number':
      return typedNumberText(cell.value);
    case 'date':
      return cell.iso;
    default:
      return '';
  }
}

const NUMBER_LITERAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

function significantDigits(digits: string): number {
  return digits.replace(/^0+/, '').replace(/0+$/, '').length;
}

/**
 * The value of a number cell (`<v>` text such as `1100`, `-0.5`, `1.5E-3`) in plain decimal notation,
 * trailing zeros dropped. Excel writes some values with 17 significant digits (`2.4300000000000002`
 * for 2.43): when the shortest form of the same double has 15 digits or fewer (Excel's precision),
 * that form is taken. Any other text is kept exactly. Text that is not a number is returned as is.
 */
export function typedNumberText(raw: string): string {
  const text = raw.trim();
  const match = NUMBER_LITERAL.exec(text);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) return text;
  if (significantDigits(`${match[2]}${match[3] ?? ''}`) >= 16) {
    const shortest = String(Number(text));
    const short = NUMBER_LITERAL.exec(shortest);
    if (short && Number.isFinite(Number(text)) && significantDigits(`${short[2]}${short[3] ?? ''}`) <= 15) {
      return plainDecimal(short);
    }
  }
  return plainDecimal(match);
}

function plainDecimal(match: RegExpExecArray): string {
  const [, sign, intDigits, fracDigits = '', exponentText] = match;
  const exponent = exponentText === undefined ? 0 : Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 400) return match[0];
  const digits = `${intDigits}${fracDigits}`;
  const point = intDigits.length + exponent;
  let whole: string;
  let fraction: string;
  if (point <= 0) {
    whole = '';
    fraction = `${'0'.repeat(-point)}${digits}`;
  } else if (point >= digits.length) {
    whole = `${digits}${'0'.repeat(point - digits.length)}`;
    fraction = '';
  } else {
    whole = digits.slice(0, point);
    fraction = digits.slice(point);
  }
  whole = whole.replace(/^0+/, '') || '0';
  fraction = fraction.replace(/0+$/, '');
  const body = fraction ? `${whole}.${fraction}` : whole;
  return sign === '-' && body !== '0' ? `-${body}` : body;
}

/** A number cell in an amount column: that amount, from its decimal text, with the CSV bounds. */
function typedAmount(raw: string): CsvParsedAmount {
  const text = typedNumberText(raw);
  const match = /^-?(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match || match[1].length > 20 || (match[2] ?? '').length > 20) return { kind: 'invalid' };
  try {
    return { kind: 'value', decimal: Decimal.from(text) };
  } catch {
    return { kind: 'invalid' };
  }
}

function decodeInput(input: Buffer | string): { encoding: 'utf-8' | 'windows-1252'; text: string; error: string | null } {
  if (typeof input === 'string') return { encoding: 'utf-8', text: input, error: null };
  try {
    const decoded = decodeCsv(input);
    return { encoding: decoded.encoding, text: decoded.text, error: null };
  } catch (err) {
    const message = err instanceof CsvDecodeError ? err.message : 'This file could not be read as CSV.';
    return { encoding: 'utf-8', text: '', error: message };
  }
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** A CRLF is one line. csv-parse counts a CR inside a quoted cell as its own line. */
function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function baseResult(
  encoding: 'utf-8' | 'windows-1252',
  separator: CsvSeparator | null,
  fileErrors: string[],
): CsvReadResult {
  return {
    encoding,
    separator,
    headerLine: null,
    rawHeaders: [],
    columns: [],
    ignoredColumns: [],
    headerErrors: [],
    fileErrors,
    rows: [],
    dates: null,
    amounts: null,
  };
}

function cleanCell(value: string): string {
  return denormalizeCsvFormulaValue(value.trim().replace(/^\uFEFF/, ''));
}

function firstRecord(text: string): { record: string | null; error: string | null } {
  let i = 0;
  while (i < text.length) {
    while (i < text.length && (text[i] === '\n' || text[i] === '\r')) {
      if (text[i] === '\r' && text[i + 1] === '\n') i += 2;
      else i += 1;
    }
    if (i >= text.length) return { record: null, error: null };

    let record = '';
    let inQuotes = false;
    while (i < text.length) {
      const ch = text[i];
      if (inQuotes) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            record += '""';
            i += 2;
            continue;
          }
          inQuotes = false;
        }
        record += ch;
        i += 1;
        continue;
      }
      if (ch === '"') {
        inQuotes = true;
        record += ch;
        i += 1;
        continue;
      }
      if (ch === '\n' || ch === '\r') break;
      record += ch;
      i += 1;
    }
    if (inQuotes) {
      return { record: null, error: 'This file could not be read as CSV. A quoted cell is not closed.' };
    }
    if (text[i] === '\r') {
      i += 1;
      if (text[i] === '\n') i += 1;
    } else if (text[i] === '\n') i += 1;
    // A line of spaces is not the header. Keep going. trim() covers nbsp.
    if (record.trim() !== '') return { record, error: null };
  }
  return { record: null, error: null };
}

/**
 * The separator of a file's text, read from its header line as `readCsv` reads it: null when
 * the header shows none for sure (a tie), ',' for a header of one column.
 */
export function csvSeparatorOf(text: string): CsvSeparator | null {
  const opened = firstRecord(normalizeNewlines(stripBom(text)));
  return opened.record ? chooseSeparator(opened.record) : null;
}

function chooseSeparator(record: string): CsvSeparator | null {
  const counts = new Map<CsvSeparator, number>(SEPARATORS.map((separator) => [separator, 0]));
  let inQuotes = false;
  for (let i = 0; i < record.length; i += 1) {
    const ch = record[i];
    if (ch === '"') {
      if (inQuotes && record[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === ',' || ch === ';' || ch === '\t') counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let best: CsvSeparator | null = null;
  let bestCount = 0;
  let tie = false;
  for (const separator of SEPARATORS) {
    const count = counts.get(separator) ?? 0;
    if (count === 0 || count < bestCount) continue;
    if (count === bestCount) tie = true;
    else {
      best = separator;
      bestCount = count;
      tie = false;
    }
  }
  if (tie) return null;
  return best ?? ',';
}

function parseRecords(
  text: string,
  separator: CsvSeparator,
): Promise<{ rows: RawRow[]; error: string | null; capped: boolean }> {
  return new Promise((resolve) => {
    const rows: RawRow[] = [];
    let settled = false;
    let previousLines = 0;
    let dataRows = 0;
    let capped = false;
    const finish = (error: string | null) => {
      if (settled) return;
      settled = true;
      resolve({ rows: capped ? [] : rows, error, capped });
    };
    const parser = parse({ delimiter: separator, relax_column_count: true, info: true, bom: true });
    parser.on('data', (row: { record: unknown[]; info: { lines: number } }) => {
      if (settled) return;
      const start = previousLines + 1;
      previousLines = row.info.lines;
      const cells = row.record.map((value) => cleanCell(String(value ?? '')));
      if (cells.every((cell) => cell === '')) return;
      if (rows.length > 0) {
        dataRows += 1;
        if (dataRows > CSV_ROW_CAP) {
          capped = true;
          parser.destroy();
          finish(null);
          return;
        }
      }
      rows.push({ line: start, cells });
    });
    parser.on('error', (err: { code?: string }) => {
      if (capped) {
        finish(null);
        return;
      }
      const quote = err.code === 'CSV_QUOTE_NOT_CLOSED';
      finish(quote ? 'This file could not be read as CSV. A quoted cell is not closed.' : 'This file could not be read as CSV.');
    });
    parser.on('end', () => finish(null));
    parser.write(text);
    parser.end();
  });
}

function buildRows(
  data: readonly GridRow[],
  slots: readonly (CsvColumn | null)[],
  schema: CsvReadSchema,
): { rows: CsvDataRow[]; fileErrors: string[]; dates: CsvDateReading | null; amounts: CsvAmountReading | null } {
  const dateIndexes: number[] = [];
  const amountIndexes: number[] = [];
  slots.forEach((slot, index) => {
    if (slot?.kind === 'field' && schema.dateFields?.includes(slot.id)) dateIndexes.push(index);
    if (slot?.kind === 'amount') amountIndexes.push(index);
  });
  const conventionHint = schema.conventionHint;
  const hintIndex = conventionHint
    ? slots.findIndex((slot) => slot?.kind === 'field' && slot.id === conventionHint.field)
    : -1;
  const hintLanguages = new Set<CsvLanguage>();
  const samples: string[] = [];
  const amountSamples: string[] = [];
  // Only text cells settle the date order and the decimal mark: typed cells are read as they are.
  const textOf = (cell: SheetCell | undefined): string => (cell?.kind === 'text' ? cell.value : '');
  for (const row of data) {
    if (hintIndex >= 0 && conventionHint) {
      const language = conventionHint.languageOf(row.cells[hintIndex] ? sheetCellText(row.cells[hintIndex]) : '');
      if (language !== null) hintLanguages.add(language);
    }
    for (const index of dateIndexes) {
      const cell = textOf(row.cells[index]);
      if (cell !== '') samples.push(cell);
    }
    for (const index of amountIndexes) {
      const cell = textOf(row.cells[index]);
      if (cell !== '') amountSamples.push(cell);
    }
  }
  const hint = hintLanguages.size === 1 ? [...hintLanguages][0] : undefined;
  const decision = resolveDateOrder(samples, schema.language, schema.dateOrder, hint);
  const amountsDecision = resolveAmountConvention(amountSamples, schema.language, schema.decimalMark, hint);
  // A number cell in a text column is written as the file's own CSV would write it: with the decimal
  // mark of the language the file records (the budget file's token); when it records none, the mark of
  // the import's language if the schema asks for it, a point otherwise.
  const textDecimal = hint ? csvProfile(hint).decimal : schema.typedNumbersInLanguage ? csvProfile(schema.language).decimal : '.';
  const rows = data.map((row) =>
    buildRow(row, slots, schema, decision.order, decision.error !== null, amountsDecision.decimal, amountsDecision.error !== null, textDecimal),
  );
  const dates: CsvDateReading | null =
    decision.error || decision.order === null
      ? null
      : { order: decision.order, settledByFile: decision.settledByFile, notice: decision.notice };
  const amounts: CsvAmountReading | null =
    amountsDecision.error || !amountsDecision.ambiguous || amountsDecision.decimal === null
      ? null
      : { decimal: amountsDecision.decimal, settledByFile: amountsDecision.settledByFile, notice: amountsDecision.notice };
  const fileErrors = [decision.error, amountsDecision.error].filter((error): error is string => error !== null);
  return { rows, fileErrors, dates, amounts };
}

function buildRow(
  row: GridRow,
  slots: readonly (CsvColumn | null)[],
  schema: CsvReadSchema,
  order: CsvReadSchema['dateOrder'] | null,
  datesBlocked: boolean,
  amountConvention: ',' | '.' | null,
  amountsBlocked: boolean,
  textDecimal: ',' | '.',
): CsvDataRow {
  const cells: Record<string, string> = {};
  const amounts: CsvDataRow['amounts'] = {};
  const dates: CsvDataRow['dates'] = {};
  const errors: CsvDataRow['errors'] = [];
  if (hasExtra(row.cells, slots.length)) {
    errors.push({ column: null, message: 'This row has more cells than the header.', code: 'CSV_ROW_TOO_MANY_CELLS' });
  }
  slots.forEach((slot, index) => {
    if (!slot) return;
    const cell: SheetCell = index < row.cells.length ? row.cells[index] : { kind: 'empty' };
    const value = sheetCellText(cell);
    const dateField = slot.kind === 'field' && !!schema.dateFields?.includes(slot.id);
    cells[slot.id] = cell.kind === 'number' && slot.kind !== 'amount' && !dateField && textDecimal === ',' ? value.replace('.', ',') : value;
    if (slot.kind === 'amount') {
      const typed = cell.kind === 'number';
      const parsed = typed ? typedAmount(cell.value) : parseCsvAmount(value, amountConvention ?? undefined);
      amounts[slot.id] = parsed;
      if (parsed.kind === 'invalid' && (typed || !amountsBlocked)) {
        errors.push({ column: slot.id, message: `Invalid amount '${value}'.`, code: 'CSV_NUMBER_INVALID', params: { value } });
      }
      return;
    }
    if (dateField) {
      if (cell.kind === 'date') {
        dates[slot.id] = { kind: 'date', isoDate: cell.iso, time: null };
        return;
      }
      const parsed = parseCsvDateCell(value, order ?? null);
      if (parsed.ok) dates[slot.id] = parsed.value;
      else if ('clear' in parsed && parsed.clear) dates[slot.id] = { kind: 'clear' };
      else if (!parsed.blank && !datesBlocked) {
        errors.push({ column: slot.id, message: `Invalid date '${value}'.`, code: 'CSV_DATE_INVALID', params: { value } });
      }
    }
  });
  return { line: row.line, cells, amounts, dates, errors };
}

function withoutTrailingBlanks(cells: readonly string[]): string[] {
  let end = cells.length;
  while (end > 0 && cells[end - 1] === '') end -= 1;
  return cells.slice(0, end);
}

function hasExtra(cells: readonly SheetCell[], width: number): boolean {
  for (let i = width; i < cells.length; i += 1) {
    if (!isBlank(cells[i])) return true;
  }
  return false;
}
