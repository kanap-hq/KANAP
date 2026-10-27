import { formatCsvAmount } from '../csv-sheet/amount';
import { formatCsvDate } from '../csv-sheet/date';
import { csvProfile } from '../csv-sheet/language';
import { formatCsvPercent } from '../csv-sheet/percent';
import type { CsvLanguage } from '../csv-sheet/types';
import { writeCsv } from '../csv-sheet/write';
import type { ExportFileFormat } from '../xlsx/format';
import { writeTextXlsxStream, writeXlsx, XLSX_CONTENT_TYPE } from '../xlsx/write';
import type { XlsxCell } from '../xlsx/write';
import { CSV_CONTENT_TYPE } from './csv-export.service';

/**
 * The list exports that build their rows themselves (the master-data files, data access, the
 * technology link files): typed cells, written as the CSV they always were or as one styled sheet.
 *
 * A cell is the xlsx writer's (`XlsxCell`): text (codes, account numbers, references, emails, yes or
 * no, statuses), `number` (counts, years, days), `amount` (a decimal as exact text), `date` (a day).
 * The CSV writes each one as the exports wrote it before the Excel export: amounts with the
 * language's decimal mark (`formatCsvAmount`), days the language's way (`formatCsvDate`), numbers as
 * their plain text, text as is.
 */
export type ListExportCell = XlsxCell;

export interface ListExportFile<F extends ExportFileFormat = ExportFileFormat> {
  /** The CSV file name, `.xlsx` for a workbook. */
  filename: string;
  contentType: string;
  /** The CSV text (with BOM), or the workbook. */
  content: F extends 'xlsx' ? Buffer : F extends 'csv' ? string : string | Buffer;
  /** Data rows in the file. */
  rows: number;
}

export interface ListExportRequest<F extends ExportFileFormat> {
  format: F;
  language: CsvLanguage;
  /** The CSV file name (`suppliers.csv`); the workbook takes the same name with `.xlsx`. */
  filename: string;
  /** The list's name in each language: the sheet of the workbook (31 characters at most). */
  sheetNames: Record<CsvLanguage, string>;
  headers: readonly string[];
  rows: readonly (readonly ListExportCell[])[];
}

/** The file of a list export: the CSV, or a workbook of one styled sheet with the same columns. */
export function writeListExport<F extends ExportFileFormat>(request: ListExportRequest<F>): ListExportFile<F> {
  const rows = request.rows.length;
  if (request.format === 'xlsx') {
    const content = writeXlsx({
      language: request.language,
      sheets: [{ name: request.sheetNames[request.language], headers: request.headers, rows: request.rows, header: 'styled' }],
    });
    return { filename: request.filename.replace(/\.csv$/i, '') + '.xlsx', contentType: XLSX_CONTENT_TYPE, content, rows } as ListExportFile<F>;
  }
  const content = writeCsv({
    language: request.language,
    headers: request.headers,
    rows: request.rows.map((row) => row.map((cell) => listCsvText(cell, request.language))),
  });
  return { filename: request.filename, contentType: CSV_CONTENT_TYPE, content, rows } as ListExportFile<F>;
}

/** A workbook of one styled sheet whose text rows are read as they arrive (the audit log export). */
export interface ListExportStreamRequest {
  language: CsvLanguage;
  /** The CSV file name; the workbook takes it with `.xlsx`. */
  filename: string;
  /** The list's name in each language: the sheet of the workbook. */
  sheetNames: Record<CsvLanguage, string>;
  headers: readonly string[];
  /** The rows, read once in order; only text cells. */
  rows: AsyncIterable<readonly (string | null | undefined)[]>;
  /** A size hint for the workbook buffer; the row count written in the file is the rows actually read. */
  rowCountHint?: number;
  /** The archive timestamp, for a reproducible file; now when omitted. */
  modifiedAt?: Date;
}

/**
 * The workbook of a streamed list export, written as its rows arrive: the same bytes as `writeListExport`
 * with the same rows, without holding them as an array (the audit log, up to 100,000 rows).
 */
export async function writeListExportStream(request: ListExportStreamRequest): Promise<ListExportFile<'xlsx'>> {
  let rows = 0;
  async function* counted(): AsyncGenerator<readonly (string | null | undefined)[]> {
    for await (const row of request.rows) {
      rows += 1;
      yield row;
    }
  }
  const content = await writeTextXlsxStream({
    language: request.language,
    sheetName: request.sheetNames[request.language],
    headers: request.headers,
    rows: counted(),
    rowCountHint: request.rowCountHint,
    modifiedAt: request.modifiedAt,
  });
  return {
    filename: request.filename.replace(/\.csv$/i, '') + '.xlsx',
    contentType: XLSX_CONTENT_TYPE,
    content,
    rows,
  };
}

/** One cell as the CSV writes it. */
export function listCsvText(cell: ListExportCell, language: CsvLanguage): string {
  if (cell === null || cell === undefined) return '';
  if (typeof cell === 'string') return cell;
  switch (cell.kind) {
    case 'amount':
      return formatCsvAmount(cell.value, language);
    case 'date':
      return formatCsvDate(cell.iso, language);
    case 'percent':
      return formatCsvPercent(cell.value, language);
    case 'number': {
      if (cell.decimals !== 2) return String(cell.value);
      const text = cell.value.toFixed(2);
      return csvProfile(language).decimal === ',' ? text.replace('.', ',') : text;
    }
    default:
      throw new Error('Unknown list export cell.');
  }
}

/** A decimal stored as text or numeric (`1250.50`), exact; empty when there is none. */
export function amountCell(value: unknown): ListExportCell {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text === '' ? null : { kind: 'amount', value: text };
}

/**
 * A count, a year, a number of days. A stored text that is not the plain text of its number
 * (`20.50`, `007`) stays text, so the CSV writes it unchanged.
 */
export function numberCell(value: unknown): ListExportCell {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? { kind: 'number', value } : String(value);
  const text = String(value);
  const number = Number(text);
  return text.trim() !== '' && Number.isFinite(number) && String(number) === text ? { kind: 'number', value: number } : text;
}

/** A calendar day, `YYYY-MM-DD`; empty when there is none. */
export function dayCell(iso: string | null | undefined): ListExportCell {
  return iso ? { kind: 'date', iso } : null;
}

/**
 * An end of validity, as `endOfValidityCell` writes it: a bare `YYYY-MM-DD` is that day, an
 * instant its UTC day; empty when there is none or it cannot be read.
 */
export function endOfValidityDay(value: Date | string | null | undefined): ListExportCell {
  if (value == null) return null;
  const text = value instanceof Date ? value.toISOString() : String(value).trim();
  if (text === '') return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return { kind: 'date', iso: text };
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return null;
  return { kind: 'date', iso: date.toISOString().slice(0, 10) };
}

/**
 * A cell the CSV writes as plain text whatever the language (`9.8`, `2026-03-01`), typed for the
 * workbook: `number`, a number when the text is one; `date`, a day when the text is `YYYY-MM-DD`.
 * Anything else stays the text; empty is an empty cell.
 */
export function typedTextCell(text: string, kind: 'number' | 'date'): ListExportCell {
  if (text === '') return null;
  if (kind === 'date') return /^\d{4}-\d{2}-\d{2}$/.test(text) ? { kind: 'date', iso: text } : text;
  const number = Number(text);
  return text.trim() !== '' && Number.isFinite(number) ? { kind: 'number', value: number } : text;
}

/**
 * The rows of an export whose CSV cells are text: as they are for the CSV, and for the workbook
 * with the columns of `kinds` (0-based) typed by `typedTextCell`.
 */
export function typedTextRows(
  format: ExportFileFormat,
  rows: readonly (readonly string[])[],
  kinds: Readonly<Record<number, 'number' | 'date'>>,
): ListExportCell[][] {
  if (format !== 'xlsx') return rows.map((row) => [...row]);
  return rows.map((row) => row.map((text, index) => (kinds[index] ? typedTextCell(text, kinds[index]) : text)));
}
