import { BadRequestException } from '@nestjs/common';
import type { CsvDateOrder, CsvLanguage, DecimalMark } from '../../common/csv-sheet';
import { sheetCellText } from '../../common/csv-sheet/read';
import type { AiImportMappingPreviewDto } from '../ai.types';
import { clip, isBlank, TABLE_SUMMARY_MAX_COLUMNS, TableGrid } from '../attachments/table-attachment';
import { AiImportCellResult, AiImportColumnKind, AiImportColumnReadError, AiImportColumnRule, columnReader } from './ai-import-convert';

/** The first rows the card shows: rows the model already read in the file's summary. */
export const IMPORT_MAPPING_SAMPLE_ROWS = 5;
/** Values the card lists for a column, of those the import will not read. */
export const IMPORT_MAPPING_UNREAD_EXAMPLES = 5;
const UNREAD_EXAMPLE_LENGTH = 40;

/** A column of an import's template, as the mapping converts a cell for it. */
export interface AiImportTemplateColumn extends AiImportColumnRule {
  /** The column as the template writes it and the import reads it (`go_live_date`). */
  column: string;
  /** Its title in the person's language. */
  title: string;
  required: boolean;
  /** How a catalog value is named in the person's language, by code, for the card. */
  displayName?: (code: string) => string;
}

export type AiImportConfidence = 'high' | 'medium' | 'low';

/** One template column of the mapping the model proposes. */
export interface AiImportColumnMappingInput {
  column: string;
  /** The column of the file (1-based position, as the summary numbers it). */
  source?: number | null;
  /** A value for every row, when no column of the file holds it. */
  value?: string | null;
  confidence: AiImportConfidence;
  date_order?: CsvDateOrder;
  decimal_mark?: DecimalMark;
  values?: Record<string, string>;
  note?: string | null;
}

export interface AiImportMappingRequest {
  importKey: string;
  filename: string;
  columns: AiImportColumnMappingInput[];
  assumptions: string[];
}

/**
 * A cell of the file the import reads: the value as the template holds it, or the person's own text
 * when the mapping could not read it (`unread`), which the import then refuses with its own message.
 */
export type AiImportFileCell = string | { unread: string };

/** The file the import reads: the template columns the mapping fills, one row per data row of the person's file. */
export interface AiImportFileContent {
  columns: Array<{ column: string; kind: AiImportColumnKind }>;
  rows: AiImportFileCell[][];
}

/** A conversion of the whole file: the card's preview, and the rows of the file the import reads. */
export interface AiImportMappingResult {
  preview: AiImportMappingPreviewDto;
  file: AiImportFileContent;
}

function refusal(message: string): BadRequestException {
  return new BadRequestException(message);
}

/** The file's columns the summary describes to the model: a mapping reads no other. */
function describedWidth(grid: TableGrid): number {
  return Math.min(grid.width, TABLE_SUMMARY_MAX_COLUMNS);
}

/** Checks the mapping against the template and the file before any cell is read. */
function assertMappingShape(request: AiImportMappingRequest, template: AiImportTemplateColumn[], grid: TableGrid): void {
  const known = new Set(template.map((column) => column.column));
  const seen = new Set<string>();
  const unknown = request.columns.map((entry) => entry.column).filter((name) => !known.has(name));
  if (unknown.length > 0) {
    throw refusal(
      `Unknown column${unknown.length > 1 ? 's' : ''} for this import: ${unknown.join(', ')}. `
      + `The template's columns are: ${template.map((column) => column.column).join(', ')}.`,
    );
  }
  for (const entry of request.columns) {
    if (seen.has(entry.column)) throw refusal(`The column ${entry.column} is mapped twice: map each template column once.`);
    seen.add(entry.column);
    const hasSource = entry.source !== undefined && entry.source !== null;
    const hasValue = entry.value !== undefined && entry.value !== null && String(entry.value).trim() !== '';
    if (hasSource === hasValue) {
      throw refusal(`The column ${entry.column} needs either a source column of the file or a value for every row, not both.`);
    }
    if (hasSource && (!Number.isInteger(entry.source) || entry.source! < 1 || entry.source! > describedWidth(grid))) {
      throw refusal(`The source of ${entry.column} is column ${entry.source}; the summary describes columns 1 to ${describedWidth(grid)}.`);
    }
  }
}

function readAsOf(settled: { dateOrder?: CsvDateOrder; decimalMark?: DecimalMark }): string | null {
  if (settled.dateOrder) return settled.dateOrder;
  if (settled.decimalMark) return settled.decimalMark === ',' ? 'decimal-comma' : 'decimal-point';
  return null;
}

function headerOf(grid: TableGrid, position: number): string | null {
  const cell = grid.header[position - 1];
  return isBlank(cell) ? null : clip(sheetCellText(cell!));
}

/** The model's own words on the card, on one line: the input schema bounds their length. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/** A converted value as the card writes it: a catalog entry by its name, the rest as the template holds it. */
function displayValue(column: AiImportTemplateColumn, value: string): string {
  if (!column.displayName) return value;
  return column.multi
    ? value.split(', ').map((code) => column.displayName!(code)).join(', ')
    : column.displayName(value);
}

/**
 * Converts every row of the file with the mapping, and sums it up for the preview card: per template
 * column, the values read and not read; the template's required columns nothing fills; the file's
 * columns left unused; the first rows as the template will hold them. The model's input errors (an
 * unknown column, a source outside the file, a value the column does not take) are refusals it repairs.
 */
export function buildImportMapping(
  grid: TableGrid,
  template: AiImportTemplateColumn[],
  request: AiImportMappingRequest,
  language: CsvLanguage,
): AiImportMappingResult {
  assertMappingShape(request, template, grid);
  const entries = new Map(request.columns.map((entry) => [entry.column, entry]));
  const mapped = template.filter((column) => entries.has(column.column));
  const sampleCount = Math.min(IMPORT_MAPPING_SAMPLE_ROWS, grid.rows.length);

  const columns: AiImportMappingPreviewDto['columns'] = [];
  const unreadValues: Record<string, string[]> = {};
  const readErrors: Record<string, AiImportColumnReadError> = {};
  const sampleRows: string[][] = Array.from({ length: sampleCount }, () => []);
  const sampleUnread: boolean[][] = Array.from({ length: sampleCount }, () => []);
  const rowLacksRequired = new Array<boolean>(grid.rows.length).fill(false);
  const fileRows: AiImportFileCell[][] = grid.rows.map(() => []);

  for (const column of mapped) {
    const entry = entries.get(column.column)!;
    const hints = { dateOrder: entry.date_order, decimalMark: entry.decimal_mark, values: entry.values };
    const note = entry.note ? oneLine(entry.note) || null : null;

    if (entry.source === undefined || entry.source === null) {
      // A value for every row: it must be one the column takes.
      const raw = String(entry.value).trim();
      const result = columnReader(column, [{ kind: 'text', value: raw }], hints, language).read({ kind: 'text', value: raw });
      if (result.status !== 'converted') {
        throw refusal(`The value "${clip(raw)}" given for ${column.column} is not one this column takes${describeAccepted(column)}.`);
      }
      const shown = displayValue(column, result.value);
      columns.push({
        column: column.column, title: column.title, required: column.required, kind: column.kind,
        source: null, value: shown, confidence: entry.confidence,
        filled: grid.rows.length, unread: 0, read_as: null, note,
      });
      for (let index = 0; index < sampleCount; index += 1) {
        sampleRows[index].push(shown);
        sampleUnread[index].push(false);
      }
      for (const row of fileRows) row.push(result.value);
      continue;
    }

    const position = entry.source;
    const cells = grid.rows.map((row) => row[position - 1]);
    const reader = columnReader(column, cells, hints, language);
    let filled = 0;
    let unread = 0;
    const examples: string[] = [];
    const results: AiImportCellResult[] = cells.map((cell, index) => {
      const result = reader.read(cell);
      if (result.status !== 'blank') filled += 1;
      if (result.status === 'unread') {
        unread += 1;
        const example = result.raw.length > UNREAD_EXAMPLE_LENGTH ? `${result.raw.slice(0, UNREAD_EXAMPLE_LENGTH - 1)}…` : result.raw;
        if (examples.length < IMPORT_MAPPING_UNREAD_EXAMPLES && !examples.includes(example)) examples.push(example);
      }
      if (column.required && result.status !== 'converted') rowLacksRequired[index] = true;
      fileRows[index].push(result.status === 'converted' ? result.value : result.status === 'unread' ? { unread: result.raw } : '');
      return result;
    });
    if (examples.length > 0) unreadValues[column.column] = examples;
    if (reader.error) readErrors[column.column] = reader.error;
    columns.push({
      column: column.column, title: column.title, required: column.required, kind: column.kind,
      source: { position, header: headerOf(grid, position) }, value: null, confidence: entry.confidence,
      filled, unread, read_as: reader.error ? null : readAsOf(reader.settled), note,
    });
    for (let index = 0; index < sampleCount; index += 1) {
      const result = results[index];
      sampleRows[index].push(
        result.status === 'converted' ? displayValue(column, result.value)
          : result.status === 'unread' ? clip(result.raw)
            : '',
      );
      sampleUnread[index].push(result.status === 'unread');
    }
  }

  const usedPositions = new Set(request.columns.map((entry) => entry.source).filter((source): source is number => typeof source === 'number'));
  const unplaced: AiImportMappingPreviewDto['unplaced'] = [];
  for (let position = 1; position <= describedWidth(grid); position += 1) {
    if (usedPositions.has(position)) continue;
    // A column with neither a header nor a value is not a column the person wrote.
    const header = headerOf(grid, position);
    if (header === null && grid.rows.every((row) => isBlank(row[position - 1]))) continue;
    unplaced.push({ position, header });
  }

  return {
    preview: {
      import_key: request.importKey,
      filename: request.filename,
      row_count: grid.rows.length,
      columns,
      unread_values: unreadValues,
      read_errors: readErrors,
      missing_required: template
        .filter((column) => column.required && !entries.has(column.column))
        .map((column) => ({ column: column.column, title: column.title })),
      unplaced,
      assumptions: request.assumptions.map(oneLine).filter((assumption) => assumption !== ''),
      sample: { columns: mapped.map((column) => column.column), rows: sampleRows, unread: sampleUnread },
      rows_missing_required: rowLacksRequired.filter(Boolean).length,
    },
    file: { columns: mapped.map((column) => ({ column: column.column, kind: column.kind })), rows: fileRows },
  };
}

function describeAccepted(column: { kind: AiImportColumnKind; codes?: readonly string[]; options?: readonly { code: string; label?: string | null }[] }): string {
  if (column.kind === 'codes' && column.codes?.length) return ` (one of ${column.codes.join(', ')})`;
  if (column.kind === 'catalog' && column.options?.length) {
    return ` (one of ${column.options.map((option) => option.label || option.code).join(', ')})`;
  }
  return '';
}
