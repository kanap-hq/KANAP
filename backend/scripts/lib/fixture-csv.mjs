// CSV reading for the Fromage & Co fixture (backend/fixtures/fromage-co), with
// the uniform year shift applied at load time.
//
// The dataset is written for DATASET_YEAR. Loading it for another year moves
// every date by the same number of years: each `YYYY-MM-DD` in a cell (a whole
// cell or a date inside a text), each value of a column named `year`, and each
// header ending in `_YYYY` (the metric columns of 01-companies.csv,
// `headcount_2025` ...). Everything else is kept byte for byte, so a shift of
// zero gives the file unchanged. A 29 February moved to a common year becomes
// the 28th.

/** The year the fixture files are written for. */
export const DATASET_YEAR = 2026;

const DATE_IN_TEXT = /(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g;
const HEADER_YEAR = /_(\d{4})(\s*"?\s*)$/;
const YEAR_VALUE = /^(\s*"?\s*)(\d{4})(\s*"?\s*)$/;

function isLeap(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year, month) {
  return [31, isLeap(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

function pad(value, width) {
  return String(value).padStart(width, '0');
}

/** `YYYY-MM-DD` moved by `years`, or null when the value is not a real date. */
export function shiftIsoDate(value, years) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? ''));
  if (!match) return null;
  const [year, month, day] = match.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) return null;
  const target = year + years;
  const targetDay = Math.min(day, daysInMonth(target, month));
  return `${pad(target, 4)}-${pad(month, 2)}-${pad(targetDay, 2)}`;
}

function normalizeValue(value) {
  if (value == null) return '';
  return String(value).trim();
}

/** The fields of a CSV text with their raw spans: `{ start, end, row, col }`. */
function fieldSpans(content, delimiter) {
  const fields = [];
  let row = 0;
  let col = 0;
  let start = 0;
  let inQuotes = false;
  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    if (ch === '"') {
      if (inQuotes && content[i + 1] === '"') i += 1;
      else inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;
    if (ch === delimiter) {
      fields.push({ start, end: i, row, col });
      col += 1;
      start = i + 1;
      continue;
    }
    if (ch === '\n' || ch === '\r') {
      fields.push({ start, end: i, row, col });
      if (ch === '\r' && content[i + 1] === '\n') i += 1;
      row += 1;
      col = 0;
      start = i + 1;
    }
  }
  fields.push({ start, end: content.length, row, col });
  return fields;
}

/** The raw text of a field without its quotes (`""` read as `"`). */
function unquote(raw) {
  return raw.replace(/"("?)/g, '$1');
}

/**
 * A fixture CSV text with every date and year moved by `years` (see the top of
 * this file). Only the digits of the moved values change.
 */
export function shiftCsvText(content, years, delimiter = ';') {
  if (!Number.isInteger(years)) throw new Error(`years must be an integer (got ${years}).`);
  const fields = fieldSpans(content, delimiter);
  const rowHasContent = new Map();
  for (const field of fields) {
    if (field.end > field.start) rowHasContent.set(field.row, true);
  }
  const headerRow = fields.find((field) => rowHasContent.get(field.row))?.row;
  const headers = fields
    .filter((field) => field.row === headerRow)
    .map((field) => normalizeValue(unquote(content.slice(field.start, field.end))).toLowerCase());

  // Only plausible years move: a code that happens to end in four digits is left alone.
  const shiftYear = (digits) => (Number(digits) >= 1900 && Number(digits) < 2200 ? pad(Number(digits) + years, 4) : digits);
  let out = '';
  let cursor = 0;
  for (const field of fields) {
    const raw = content.slice(field.start, field.end);
    let next = raw;
    if (field.row === headerRow) {
      next = raw.replace(HEADER_YEAR, (_, year, rest) => `_${shiftYear(year)}${rest}`);
    } else if (headers[field.col] === 'year') {
      next = raw.replace(YEAR_VALUE, (_, before, year, after) => `${before}${shiftYear(year)}${after}`);
    } else {
      next = raw.replace(DATE_IN_TEXT, (date) => shiftIsoDate(date, years) ?? date);
    }
    out += content.slice(cursor, field.start) + next;
    cursor = field.end;
  }
  return out + content.slice(cursor);
}

/** Rows of a `;` CSV as objects keyed by the trimmed headers; blank rows are skipped. */
export function parseCsv(content, delimiter = ';') {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < content.length; i += 1) {
    const ch = content[i];
    const next = content[i + 1];

    if (ch === '"') {
      if (inQuotes && next === '"') {
        field += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (!inQuotes && ch === delimiter) {
      row.push(field);
      field = '';
      continue;
    }

    if (!inQuotes && (ch === '\n' || ch === '\r')) {
      if (ch === '\r' && next === '\n') i += 1;
      row.push(field);
      if (row.some((v) => v.length > 0)) rows.push(row);
      row = [];
      field = '';
      continue;
    }

    field += ch;
  }

  row.push(field);
  if (row.some((v) => v.length > 0)) rows.push(row);

  if (rows.length === 0) return [];
  const headers = rows[0].map((h) => normalizeValue(h));
  return rows.slice(1).map((values) => {
    const out = {};
    for (let i = 0; i < headers.length; i += 1) {
      out[headers[i]] = normalizeValue(values[i] ?? '');
    }
    return out;
  });
}
