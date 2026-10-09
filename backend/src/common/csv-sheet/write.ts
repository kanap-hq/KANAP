import { neutralizeCsvFormulaValue } from '../csv/csv-export.service';
import { csvProfile } from './language';
import { CsvLanguage } from './types';

export interface CsvWriteRequest {
  language: CsvLanguage;
  headers: readonly string[];
  /** One array per row, in the same order as `headers`. */
  rows: readonly (readonly string[])[];
}

/**
 * UTF-8 text with a BOM, the language's separator, and a formula guard.
 * A plain negative amount is left as a number. Zero rows still write the header.
 */
export function writeCsv(request: CsvWriteRequest): string {
  return writeCsvHeader(request.language, request.headers) + writeCsvRows(request);
}

/**
 * The start of a file written in parts: the BOM and the header line. The rows follow with
 * `writeCsvRows`; together they are the text `writeCsv` writes.
 */
export function writeCsvHeader(language: CsvLanguage, headers: readonly string[]): string {
  const separator = csvProfile(language).separator;
  return `\uFEFF${headers.map((cell) => quoteCell(cell, separator)).join(separator)}\n`;
}

/** Rows of a file written in parts (after `writeCsvHeader`): one line each, ending with a line break. */
export function writeCsvRows(request: CsvWriteRequest): string {
  const separator = csvProfile(request.language).separator;
  let text = '';
  for (const row of request.rows) {
    if (row.length !== request.headers.length) {
      throw new Error(`A row has ${row.length} cells for ${request.headers.length} headers.`);
    }
    text += `${row.map((cell) => quoteCell(cell, separator)).join(separator)}\n`;
  }
  return text;
}

function quoteCell(value: string, separator: string): string {
  const text = neutralizeCsvFormulaValue(value);
  if (text.includes('"') || text.includes(separator) || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
