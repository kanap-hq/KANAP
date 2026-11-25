import { BadRequestException } from '@nestjs/common';
import type { CsvDateOrder, CsvLanguage, DecimalMark } from '../../common/csv-sheet';
import { readImportCell } from '../../common/csv-sheet/clear';
import { classifyHeaders } from '../../common/csv-sheet/headers';
import { labelLists } from '../../common/csv-sheet/master-data';
import { looseKey } from '../../common/csv-sheet/text';
import { sheetCellText } from '../../common/csv-sheet/read';
import type { AiImportMappingPreviewDto } from '../ai.types';
import { clip, isBlank, TABLE_SUMMARY_MAX_COLUMNS, TableGrid } from '../attachments/table-attachment';
import { AI_IMPORT_CLEARING_RULE, type AiImportKey } from './ai-import-access';
import { isImportMatchedColumn } from './ai-import-targets';
import { accentFreeKey, proposalFor } from '../../common/name-matching';
import type { CsvEntityConfig } from '../../common/csv/csv-field.types';
import { numberedListColumnOf, numberedListHeader } from '../../common/csv/csv-numbered-lists';
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
  /** The titles the screen's import reads the column by, every language (`CsvReadSchema.fieldLabels`). */
  titles?: Readonly<Partial<Record<CsvLanguage, string>>>;
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
  /** The file's columns the person asked to leave aside, by header: never read by their header alone. */
  leftAside?: string[];
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
  /**
   * The model's `values` for the columns its import finds by name (`isImportMatchedColumn`: a budget
   * file's supplier, company and dimensions, an application's supplier...), which the file keeps as
   * the person wrote them. The import accepts each one only when its record exists and the person
   * reads it (lots I1 and I3 of 26.11.9).
   */
  proposals?: Record<string, Record<string, string>>;
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

function headerText(grid: TableGrid, position: number): string {
  const cell = grid.header[position - 1];
  return isBlank(cell) ? '' : sheetCellText(cell!);
}

/**
 * The template's lists written in numbered columns (`business_owner_email_1` to `_4`), as a config the
 * screen's import reads their further columns by (`numberedListColumnOf`): each list's base, and the
 * titles of its first column.
 */
function numberedListsOf(template: AiImportTemplateColumn[]): CsvEntityConfig {
  const names = new Set(template.map((column) => column.column));
  const firsts = template.filter((column) => /_1$/.test(column.column) && names.has(column.column.replace(/_1$/, '_2')));
  return {
    fields: [],
    numberedLists: firsts.map((column) => ({ base: column.column.replace(/_1$/, ''), values: () => [] })),
    headerLabels: Object.fromEntries(firsts.map((column) => [column.column, column.titles ?? {}])),
  } as unknown as CsvEntityConfig;
}

/**
 * The file's columns the screen's import would read and the model's mapping leaves out, under the
 * clearing rule (D21 of 26.11.9): a header that names a template column the mapping does not fill,
 * by its key or one of its titles, recognised as the screen's import recognises them
 * (`classifyHeaders`). Each one is read as a column of high confidence, with no value map, unless the
 * person asked to leave it aside (`leftAside`). A numbered column beyond the template's
 * (`business_owner_email_5`, `Business owner 5 email`) is read too, as the screen reads it (lot I6 of
 * 26.11.9, pass F): the template gains it, as its list's first column numbered again (`columns`).
 */
function screenNamedColumns(
  grid: TableGrid,
  template: AiImportTemplateColumn[],
  request: AiImportMappingRequest,
  language: CsvLanguage,
): { entries: AiImportColumnMappingInput[]; columns: AiImportTemplateColumn[] } {
  if (!AI_IMPORT_CLEARING_RULE.has(request.importKey as AiImportKey)) return { entries: [], columns: [] };
  const width = describedWidth(grid);
  const headers = Array.from({ length: width }, (_, index) => headerText(grid, index + 1));
  const headerKeys = new Set(headers.map(looseKey).filter((key) => key !== ''));
  const aside = new Set<string>();
  for (const name of request.leftAside ?? []) {
    const key = looseKey(String(name));
    if (!headerKeys.has(key)) {
      throw refusal(`left_aside names ${clip(String(name))}, which is not a column of the file. Name a column by its header, as the summary writes it.`);
    }
    aside.add(key);
  }
  const filled = new Set(request.columns.map((entry) => entry.column));
  const used = new Set(request.columns.map((entry) => entry.source).filter((source): source is number => typeof source === 'number'));
  const titles = Object.fromEntries(template.filter((column) => column.titles).map((column) => [column.column, column.titles!]));
  const { slots } = classifyHeaders(headers, { fields: template.map((column) => column.column), fieldLabels: labelLists(titles), language });
  const added: AiImportColumnMappingInput[] = [];
  const columns: AiImportTemplateColumn[] = [];
  const known = new Set(template.map((column) => column.column));
  const lists = numberedListsOf(template);
  slots.forEach((slot, index) => {
    const position = index + 1;
    if (used.has(position) || aside.has(looseKey(headers[index]))) return;
    if (slot?.kind === 'field') {
      if (filled.has(slot.id)) return;
      filled.add(slot.id);
      added.push({ column: slot.id, source: position, confidence: 'high' });
      return;
    }
    const numbered = headers[index] ? numberedListColumnOf(lists, headers[index]) : undefined;
    if (!numbered || known.has(numbered) || filled.has(numbered)) return;
    const base = numbered.replace(/_\d+$/, '');
    const n = Number(numbered.slice(base.length + 1));
    const first = template.find((column) => column.column === `${base}_1`)!;
    const titles = Object.fromEntries((['en', 'fr', 'de', 'es'] as const).map((lang) => [lang, numberedListHeader(lists, base, n, lang)]));
    columns.push({ ...first, column: numbered, title: numberedListHeader(lists, base, n, language), titles });
    filled.add(numbered);
    added.push({ column: numbered, source: position, confidence: 'high' });
  });
  return { entries: added, columns };
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

/**
 * A row named by its number, in the four languages (`ligne 2`, `lignes 2 et 3`, `row #2`, `Zeile Nr. 2`,
 * `fila 2`, `línea n° 2`): a word for a row followed by a number, nothing else (`2 lignes` counts rows,
 * `ligne d'en-tête` names none).
 */
const ROW_NUMBER = /(?<![\p{L}\p{N}])(?:lines?|rows?|lignes?|zeilen?|filas?|l[ií]neas?)\s*(?:(?:n[°º]|no\.|nr\.|#)\s*)?\d/iu;

/**
 * An assumption that names a row of the file (lot I6a of 26.12.1): the card leaves it out. Assumptions
 * speak of the whole file; what a row does is the check's, which the card shows. The input keeps it.
 */
export function namesARow(assumption: string): boolean {
  return ROW_NUMBER.test(assumption);
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
  const named = screenNamedColumns(grid, template, request, language);
  template = [...template, ...named.columns];
  const mappedColumns = [...request.columns, ...named.entries];
  const entries = new Map(mappedColumns.map((entry) => [entry.column, entry]));
  const mapped = template.filter((column) => entries.has(column.column));
  const sampleCount = Math.min(IMPORT_MAPPING_SAMPLE_ROWS, grid.rows.length);

  const columns: AiImportMappingPreviewDto['columns'] = [];
  const unreadValues: Record<string, string[]> = {};
  const readErrors: Record<string, AiImportColumnReadError> = {};
  const sampleRows: string[][] = Array.from({ length: sampleCount }, () => []);
  const sampleUnread: boolean[][] = Array.from({ length: sampleCount }, () => []);
  const rowLacksRequired = new Array<boolean>(grid.rows.length).fill(false);
  const fileRows: AiImportFileCell[][] = grid.rows.map(() => []);
  const proposals: Record<string, Record<string, string>> = {};

  // The person's `-` reaches every import as the clearing mark, in every kind of column: the row imports
  // and the budget file, which reads it by its own reader (lot I6 of 26.11.9, pass F).
  const clearMark = AI_IMPORT_CLEARING_RULE.has(request.importKey as AiImportKey) || request.importKey === 'budget_lines';
  for (const column of mapped) {
    const entry = entries.get(column.column)!;
    // A name of a record the model proposes (a budget file's supplier or dimension value, an
    // application's supplier...): the import matches it to an existing record, or refuses the
    // proposal; the cell keeps the person's text. "" still leaves the cell blank, and, under the
    // clearing rule, `-` clears (never a record named "-" to propose). A fixed list, a catalog, a
    // code or an e-mail reads the model's values as before.
    // In the servers' type column (D31 of 26.11.9), only a hosting word is a proposal, checked against
    // the type catalog; the column's reader never converts one, and the other values convert as in
    // any catalog column.
    const staysInCell = (to: string) => String(to).trim() === '' || (clearMark && readImportCell(String(to)).kind === 'clear');
    const hosting = column.asWritten ? new Set(column.asWritten.map(accentFreeKey)) : null;
    const proposes = ([from, to]: [string, string]) => !staysInCell(to) && (!hosting || hosting.has(accentFreeKey(from)));
    let values = entry.values;
    if (entry.source != null && values && isImportMatchedColumn(request.importKey, column.column)) {
      const proposed = Object.entries(values).filter(proposes);
      if (proposed.length > 0) proposals[column.column] = Object.fromEntries(proposed);
      values = Object.fromEntries(Object.entries(values).filter((pair) => !proposes(pair)));
    }
    const hints = { dateOrder: entry.date_order, decimalMark: entry.decimal_mark, values, clearMark };
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
      const read = reader.read(cell);
      // A value the column does not read and Kad proposes a target for: the person's text, for the check.
      const result: AiImportCellResult = read.status === 'unread' && proposalFor(proposals, column.column, read.raw) !== undefined
        ? { status: 'converted', value: read.raw }
        : read;
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

  const usedPositions = new Set(mappedColumns.map((entry) => entry.source).filter((source): source is number => typeof source === 'number'));
  const unplaced: AiImportMappingPreviewDto['unplaced'] = [];
  for (let position = 1; position <= describedWidth(grid); position += 1) {
    if (usedPositions.has(position)) continue;
    // A column with neither a header nor a value is not a column the person wrote.
    const header = headerOf(grid, position);
    if (header === null && grid.rows.every((row) => isBlank(row[position - 1]))) continue;
    unplaced.push({ position, header });
  }

  // A column the import matches without the file mapping it (an application's supplier found by its publisher).
  const matchedTitles = Object.fromEntries(template
    .filter((column) => !entries.has(column.column) && !column.asWritten && isImportMatchedColumn(request.importKey, column.column))
    .map((column) => [column.column, column.title]));
  return {
    preview: {
      import_key: request.importKey,
      filename: request.filename,
      row_count: grid.rows.length,
      columns,
      unread_values: unreadValues,
      read_errors: readErrors,
      ...(Object.keys(matchedTitles).length > 0 ? { matched_titles: matchedTitles } : {}),
      missing_required: template
        .filter((column) => column.required && !entries.has(column.column))
        .map((column) => ({ column: column.column, title: column.title })),
      unplaced,
      assumptions: request.assumptions.map(oneLine).filter((assumption) => assumption !== '' && !namesARow(assumption)),
      sample: { columns: mapped.map((column) => column.column), rows: sampleRows, unread: sampleUnread },
      rows_missing_required: rowLacksRequired.filter(Boolean).length,
    },
    file: {
      columns: mapped.map((column) => ({ column: column.column, kind: column.kind })),
      rows: fileRows,
      ...(Object.keys(proposals).length > 0 ? { proposals } : {}),
    },
  };
}

function describeAccepted(column: {
  kind: AiImportColumnKind;
  codes?: readonly string[];
  options?: readonly { code: string; label?: string | null }[];
  displayName?: (code: string) => string;
}): string {
  // A code with the name the screens show, which the model names it by.
  if (column.kind === 'codes' && column.codes?.length) {
    return ` (one of ${column.codes.map((code) => (column.displayName ? `${column.displayName(code)} (${code})` : code)).join(', ')})`;
  }
  if (column.kind === 'catalog' && column.options?.length) {
    return ` (one of ${column.options.map((option) => option.label || option.code).join(', ')})`;
  }
  return '';
}
