import { looseKey, separatorNormalize } from './text';
import {
  BUDGET_YEAR_MAX,
  BUDGET_YEAR_MIN,
  CsvAmountColumn,
  CsvAmountHeader,
  CsvColumn,
  CsvReadSchema,
} from './types';

export interface ClassifiedHeaders {
  columns: CsvColumn[];
  /** One entry per header cell. Null when that cell is ignored or is a header error. */
  slots: Array<CsvColumn | null>;
  ignoredColumns: string[];
  headerErrors: string[];
}

interface AmountSplit {
  stem: string;
  year: string;
  month: string | null;
}

/**
 * Turn header cells into columns. Unknown headers are listed, not refused.
 * A header that looks like an amount column, or an `analytics:` column, and
 * does not parse, is a header error. Those checks run only when the schema
 * asked for amount columns or dimensions.
 */
export function classifyHeaders(headers: readonly string[], schema: CsvReadSchema): ClassifiedHeaders {
  const columns: CsvColumn[] = [];
  const slots: Array<CsvColumn | null> = [];
  const ignoredColumns: string[] = [];
  const headerErrors: string[] = [];
  const seenFields = new Set<string>();
  const seenAmounts = new Map<string, string>();
  const seenAnalytics = new Set<string>();
  const yearly = new Set<string>();
  const monthly = new Set<string>();

  headers.forEach((raw) => {
    const header = raw.trim().replace(/^\uFEFF/, '');
    if (header === '') {
      slots.push(null);
      headerErrors.push('A column header is empty.');
      return;
    }

    const analytics = schema.dimensions ? matchAnalytics(header, schema.dimensions) : null;
    if (analytics) {
      if (analytics.unknown) {
        slots.push(null);
        headerErrors.push(
          analytics.code === ''
            ? 'A dimension column has no code.'
            : refusedDimension(analytics.code, schema.refusedDimensions) ?? `Unknown dimension '${analytics.code}'.`,
        );
        return;
      }
      if (seenAnalytics.has(analytics.id)) {
        slots.push(null);
        headerErrors.push(`Column '${header}' appears twice.`);
        return;
      }
      seenAnalytics.add(analytics.id);
      const analyticsColumn: CsvColumn = { kind: 'analytics', id: analytics.id, header, code: analytics.schemaCode };
      slots.push(analyticsColumn);
      columns.push(analyticsColumn);
      return;
    }

    const amount = schema.amounts ? matchAmount(header, schema.amounts) : null;
    if (amount?.kind === 'error') {
      slots.push(null);
      headerErrors.push(amount.message);
      return;
    }
    if (amount?.kind === 'column') {
      const previous = seenAmounts.get(amount.column.id);
      if (previous) {
        slots.push(null);
        headerErrors.push(
          previous === header ? `Column '${header}' appears twice.` : `Column '${header}' repeats '${previous}'.`,
        );
        return;
      }
      seenAmounts.set(amount.column.id, header);
      slots.push(amount.column);
      columns.push(amount.column);
      const slot = `${amount.column.measure}:${amount.column.year}`;
      if (amount.column.month == null) yearly.add(slot);
      else monthly.add(slot);
      return;
    }

    const field = schema.fields.find((name) => looseKey(name) === looseKey(header));
    if (field) {
      if (seenFields.has(field)) {
        slots.push(null);
        headerErrors.push(`Column '${header}' appears twice.`);
        return;
      }
      seenFields.add(field);
      const fieldColumn: CsvColumn = { kind: 'field', id: field, header };
      slots.push(fieldColumn);
      columns.push(fieldColumn);
      return;
    }

    slots.push(null);
    ignoredColumns.push(header);
  });

  for (const slot of yearly) {
    if (!monthly.has(slot)) continue;
    const [measure, year] = slot.split(':');
    const column = schema.amounts?.find((item) => item.measure === measure);
    const name = column?.names[0] ?? measure;
    headerErrors.push(`A yearly total and months are both present for ${name} ${year}.`);
  }

  return { columns, slots, ignoredColumns, headerErrors };
}

/** Programmer errors in the schema, thrown before the file is read. */
export function validateSchema(schema: CsvReadSchema): void {
  const fields = new Map<string, string>();
  for (const field of schema.fields) {
    const key = looseKey(field);
    const previous = fields.get(key);
    if (previous) throw new Error(`Schema fields '${previous}' and '${field}' normalize to the same header.`);
    fields.set(key, field);
  }
  if (schema.amounts) {
    const names = new Set<string>();
    for (const column of schema.amounts) {
      if (column.names.length === 0) throw new Error('An amount column needs a name.');
      for (const name of column.names) {
        const key = looseKey(name);
        if (names.has(key)) throw new Error(`Amount name '${name}' is listed twice.`);
        names.add(key);
      }
    }
  }
  if (schema.dimensions) {
    const codes = new Set<string>();
    for (const code of schema.dimensions) {
      const key = looseKey(code);
      if (codes.has(key)) throw new Error(`Dimension '${code}' is listed twice.`);
      codes.add(key);
    }
  }
  for (const field of schema.dateFields ?? []) {
    if (!schema.fields.includes(field)) throw new Error(`Date field '${field}' is not a column.`);
  }
}

/** The schema's own refusal for a dimension code outside its list, if it has one. */
function refusedDimension(code: string, refused: Readonly<Record<string, string>> | undefined): string | null {
  if (!refused) return null;
  const key = looseKey(code);
  const found = Object.keys(refused).find((candidate) => looseKey(candidate) === key);
  return found ? refused[found] : null;
}

function matchAnalytics(
  header: string,
  dimensions: readonly string[],
): { unknown: true; code: string; id?: undefined; schemaCode?: undefined } | { unknown: false; code: string; id: string; schemaCode: string } | null {
  const match = /^analytics\s*:\s*(.*)$/i.exec(header.trim());
  if (!match) return null;
  const code = match[1].trim();
  const found = dimensions.find((dimension) => looseKey(dimension) === looseKey(code));
  if (!found) return { unknown: true, code };
  return { unknown: false, code, id: `analytics:${found}`, schemaCode: found };
}

function matchAmount(
  header: string,
  amounts: readonly CsvAmountColumn[],
): { kind: 'column'; column: CsvAmountHeader } | { kind: 'error'; message: string } | null {
  const split = splitAmount(separatorNormalize(header));
  if (!split) return null;
  const stem = stemMatch(split.stem, amounts);
  if (stem.kind === 'none') return null;

  const yearDigits = split.year.length === 4;
  const year = Number(split.year);
  const yearOk = yearDigits && year >= BUDGET_YEAR_MIN && year <= BUDGET_YEAR_MAX;
  const monthOk = split.month == null || /^(0[1-9]|1[0-2])$/.test(split.month);
  if (stem.kind === 'typo' || !yearOk || !monthOk) {
    return { kind: 'error', message: amountError(header, stem.kind === 'exact' ? stem.column.names[0] : null, split, yearOk, monthOk) };
  }
  if (stem.kind !== 'exact') return null;
  const month = split.month == null ? null : Number(split.month);
  const columnName = stem.column.names[0];
  const id = month == null ? `${columnName}_${year}` : `${columnName}_${year}_${split.month}`;
  return {
    kind: 'column',
    column: {
      kind: 'amount',
      id,
      header,
      measure: stem.column.measure,
      column: columnName,
      year,
      month,
    },
  };
}

function amountError(header: string, canonical: string | null, split: AmountSplit, yearOk: boolean, monthOk: boolean): string {
  if (!yearOk && split.year.length !== 4 && canonical) {
    return `Column '${header}' is not a valid amount column. A year has four digits, for example ${canonical}_2027.`;
  }
  if (!yearOk && split.year.length === 4) {
    return `Column '${header}' is not a valid amount column. A year is ${BUDGET_YEAR_MIN} to ${BUDGET_YEAR_MAX}.`;
  }
  if (!monthOk) return `Column '${header}' is not a valid amount column. A month is 01 to 12.`;
  return `Column '${header}' is not a valid amount column.`;
}

function splitAmount(normalized: string): AmountSplit | null {
  const withMonth = /^(.+)_(\d{2,4})_(\d{1,3})$/.exec(normalized);
  if (withMonth) return { stem: withMonth[1], year: withMonth[2], month: withMonth[3] };
  const yearOnly = /^(.+)_(\d{2,4})$/.exec(normalized);
  if (yearOnly) return { stem: yearOnly[1], year: yearOnly[2], month: null };
  return null;
}

function stemMatch(
  stem: string,
  amounts: readonly CsvAmountColumn[],
): { kind: 'exact'; column: CsvAmountColumn } | { kind: 'typo' } | { kind: 'none' } {
  const key = looseKey(stem);
  for (const column of amounts) {
    if (column.names.some((name) => looseKey(name) === key)) return { kind: 'exact', column };
  }
  for (const column of amounts) {
    if (column.names.some((name) => isOneEdit(key, looseKey(name)))) return { kind: 'typo' };
  }
  return { kind: 'none' };
}

/** One insertion, deletion, substitution, or an adjacent swap (`bugdet` for `budget`). */
function isOneEdit(a: string, b: string): boolean {
  if (a === b) return false;
  if (isAdjacentSwap(a, b)) return true;
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (longer.length - shorter.length > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < longer.length && j < shorter.length) {
    if (longer[i] === shorter[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (longer.length === shorter.length) j += 1;
    i += 1;
  }
  const leftover = longer.length - i + (shorter.length - j);
  if (leftover > 1) return false;
  if (leftover === 1) edits += 1;
  return edits === 1;
}

function isAdjacentSwap(a: string, b: string): boolean {
  if (a.length !== b.length || a.length < 2) return false;
  let i = 0;
  while (i < a.length && a[i] === b[i]) i += 1;
  if (i >= a.length - 1) return false;
  if (a[i] !== b[i + 1] || a[i + 1] !== b[i]) return false;
  for (let k = i + 2; k < a.length; k += 1) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}
