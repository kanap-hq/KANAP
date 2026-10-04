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
  const separator = csvProfile(request.language).separator;
  const lines = [request.headers.map((cell) => quoteCell(cell, separator)).join(separator)];
  for (const row of request.rows) {
    if (row.length !== request.headers.length) {
      throw new Error(`A row has ${row.length} cells for ${request.headers.length} headers.`);
    }
    lines.push(row.map((cell) => quoteCell(cell, separator)).join(separator));
  }
  return `\uFEFF${lines.join('\n')}\n`;
}

function quoteCell(value: string, separator: string): string {
  const text = neutralizeCsvFormulaValue(value);
  if (text.includes('"') || text.includes(separator) || text.includes('\n') || text.includes('\r')) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}
