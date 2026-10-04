import { parse } from 'csv-parse';
import { denormalizeCsvFormulaValue } from '../csv/csv-export.service';
import { parseCsvAmount, resolveAmountConvention } from './amount';
import { parseCsvDateCell, resolveDateOrder } from './date';
import { CsvDecodeError, decodeCsv } from './decode';
import { classifyHeaders, validateSchema } from './headers';
import {
  CSV_ROW_CAP,
  CsvAmountReading,
  CsvColumn,
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

const SEPARATORS: readonly CsvSeparator[] = [',', ';', '\t'];

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
  if (text.trim() === '') return baseResult(decoded.encoding, null, ['The file is empty.']);

  const opened = firstRecord(text);
  if (opened.error) return baseResult(decoded.encoding, null, [opened.error]);
  if (!opened.record) return baseResult(decoded.encoding, null, ['The file is empty.']);
  const separator = chooseSeparator(opened.record);
  if (!separator) return baseResult(decoded.encoding, null, ['The separator could not be read from the header.']);

  const parsed = await parseRecords(text, separator);
  if (parsed.capped) {
    return baseResult(decoded.encoding, separator, [`This file has more than ${CSV_ROW_CAP.toLocaleString('en-US')} rows.`]);
  }
  if (parsed.error) return baseResult(decoded.encoding, separator, [parsed.error]);
  if (parsed.rows.length === 0) return baseResult(decoded.encoding, separator, ['The file is empty.']);

  const headerRow = parsed.rows[0];
  // `name;notes;` is a trailing delimiter, not an empty column.
  const headerCells = withoutTrailingBlanks(headerRow.cells);
  if (headerCells.length === 0) return baseResult(decoded.encoding, separator, ['The file is empty.']);
  const classified = classifyHeaders(headerCells, schema);
  const built = buildRows(parsed.rows.slice(1), classified.slots, schema);
  return {
    encoding: decoded.encoding,
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
  data: readonly RawRow[],
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
  for (const row of data) {
    if (hintIndex >= 0 && conventionHint) {
      const language = conventionHint.languageOf(row.cells[hintIndex] ?? '');
      if (language !== null) hintLanguages.add(language);
    }
    for (const index of dateIndexes) {
      const cell = row.cells[index] ?? '';
      if (cell !== '') samples.push(cell);
    }
    for (const index of amountIndexes) {
      const cell = row.cells[index] ?? '';
      if (cell !== '') amountSamples.push(cell);
    }
  }
  const hint = hintLanguages.size === 1 ? [...hintLanguages][0] : undefined;
  const decision = resolveDateOrder(samples, schema.language, schema.dateOrder, hint);
  const amountsDecision = resolveAmountConvention(amountSamples, schema.language, hint);
  const rows = data.map((row) =>
    buildRow(row, slots, schema, decision.order, decision.error !== null, amountsDecision.decimal, amountsDecision.error !== null),
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
  row: RawRow,
  slots: readonly (CsvColumn | null)[],
  schema: CsvReadSchema,
  order: CsvReadSchema['dateOrder'] | null,
  datesBlocked: boolean,
  amountConvention: ',' | '.' | null,
  amountsBlocked: boolean,
): CsvDataRow {
  const cells: Record<string, string> = {};
  const amounts: CsvDataRow['amounts'] = {};
  const dates: CsvDataRow['dates'] = {};
  const errors: CsvDataRow['errors'] = [];
  if (hasExtra(row.cells, slots.length)) {
    errors.push({ column: null, message: 'This row has more cells than the header.' });
  }
  slots.forEach((slot, index) => {
    if (!slot) return;
    const value = index < row.cells.length ? row.cells[index] : '';
    cells[slot.id] = value;
    if (slot.kind === 'amount') {
      const parsed = parseCsvAmount(value, amountConvention ?? undefined);
      amounts[slot.id] = parsed;
      if (parsed.kind === 'invalid' && !amountsBlocked) {
        errors.push({ column: slot.id, message: `Invalid amount '${value}'.` });
      }
      return;
    }
    if (slot.kind === 'field' && schema.dateFields?.includes(slot.id)) {
      const parsed = parseCsvDateCell(value, order ?? null);
      if (parsed.ok) dates[slot.id] = parsed.value;
      else if ('clear' in parsed && parsed.clear) dates[slot.id] = { kind: 'clear' };
      else if (!parsed.blank && !datesBlocked) {
        errors.push({ column: slot.id, message: `Invalid date '${value}'.` });
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

function hasExtra(cells: readonly string[], width: number): boolean {
  for (let i = width; i < cells.length; i += 1) {
    if (cells[i] !== '') return true;
  }
  return false;
}
