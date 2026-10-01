import { normalizeAgFilterModel } from '../ag-grid-filtering';
import type { FieldKind, FieldSql } from './list-engine.types';
import type { SqlStatement } from './sql-statement';
import { centsNumber, centsText, epochDay, fold, jsIsoString, utcDay } from './sql-fragments';

/**
 * Grid filter models compiled to SQL predicates, with the semantics of the
 * in-memory engine they replace (the oracle, `budget-summary.oracle.ts`):
 * one rule for every field, whatever its source. The decision tree follows
 * the oracle's `rowPassesFilter` step by step; the decided changes are:
 * - every condition of a combined model applies, joined by its operator;
 * - text operators fold accents and case on both sides (Q2);
 * - a set model may exclude its values (`mode: 'exclude'`, Q3);
 * - a number model only applies to number fields and a date model to date
 *   fields; elsewhere it matches no line.
 */

const COMPARISON_TYPES = new Set(['equals', 'notEqual', 'lessThan', 'lessThanOrEqual', 'greaterThan', 'greaterThanOrEqual', 'inRange']);
const NEGATIVE_TEXT_TYPES = new Set(['notEqual', 'notContains']);
const NUMBER_KINDS: ReadonlySet<FieldKind> = new Set(['int', 'money', 'fte']);
const DATE_KINDS: ReadonlySet<FieldKind> = new Set(['day', 'ts']);

export function isNumberKind(kind: FieldKind): boolean {
  return NUMBER_KINDS.has(kind);
}

export function isDateKind(kind: FieldKind): boolean {
  return DATE_KINDS.has(kind);
}

/** A combined model (`operator` + `conditions`): every condition applies. */
export function isCombinedModel(raw: any): boolean {
  return !!raw && typeof raw === 'object' && !!raw.operator && Array.isArray(raw.conditions) && raw.conditions.length > 0;
}

/** The predicate of one field's filter model; `TRUE` when the model filters nothing. */
export function compileFieldFilter(stmt: SqlStatement, field: FieldSql, raw: any): string {
  if (isCombinedModel(raw)) {
    const joiner = raw.operator === 'OR' ? ' OR ' : ' AND ';
    return `(${raw.conditions.map((condition: any) => `(${compileSingle(stmt, field, condition)})`).join(joiner)})`;
  }
  return compileSingle(stmt, field, raw);
}

function compileSingle(stmt: SqlStatement, field: FieldSql, raw: any): string {
  const model = normalizeAgFilterModel(raw);
  if (!model || typeof model !== 'object') return 'TRUE';
  const type = String(model.type ?? model.filterType ?? 'contains');

  if (type === 'set' && Array.isArray(model.values)) return compileSet(stmt, field, model);
  if (type === 'blank') return blankSql(field);
  if (type === 'notBlank') return `NOT ${blankSql(field)}`;

  if ((model.filterType === 'date' || model.dateFrom || model.dateTo) && COMPARISON_TYPES.has(type)) {
    return isDateKind(field.kind) ? compileDate(stmt, field, type, model) : 'FALSE';
  }

  const valRaw = model.filter ?? model.value ?? (Array.isArray(model.values) ? model.values[0] : undefined);
  if (valRaw == null || valRaw === '') return 'TRUE';
  const needle = String(valRaw);

  if (COMPARISON_TYPES.has(type)) {
    const explicit = model.filterType === 'number';
    if (isNumberKind(field.kind)) {
      const to = Number(model.filterTo ?? model.valueTo);
      if (explicit) return `(${field.sql} IS NOT NULL AND ${numericCompare(stmt, field, type, Number(needle), to)})`;
      // A number value with a numeric needle compares as numbers; a blank value (no number) stays on the text rule.
      if (!Number.isNaN(Number(needle))) {
        return `(CASE WHEN ${field.sql} IS NULL THEN ${textPredicate(stmt, field, type, needle)} ELSE ${numericCompare(stmt, field, type, Number(needle), to)} END)`;
      }
    } else if (explicit) {
      return 'FALSE';
    }
  }
  return textPredicate(stmt, field, type, needle);
}

/** Blank: null or '' (a money value is never blank). */
export function blankSql(field: FieldSql): string {
  switch (field.kind) {
    case 'money':
      return 'FALSE';
    case 'int':
    case 'fte':
    case 'day':
    case 'ts':
      return `(${field.sql} IS NULL)`;
    case 'unknown':
      return 'TRUE';
    default:
      return `(NULLIF(${field.sql}, '') IS NULL)`;
  }
}

/** The double a number comparison reads. */
function numericValue(field: FieldSql): string {
  return field.kind === 'money' ? centsNumber(field.sql) : `(${field.sql})::float8`;
}

function numericCompare(stmt: SqlStatement, field: FieldSql, type: string, from: number, to: number): string {
  if (!Number.isFinite(from)) return 'FALSE';
  const value = numericValue(field);
  const p = stmt.bind(String(from), 'float8');
  switch (type) {
    case 'equals': return `${value} = ${p}`;
    case 'notEqual': return `${value} <> ${p}`;
    case 'lessThan': return `${value} < ${p}`;
    case 'lessThanOrEqual': return `${value} <= ${p}`;
    case 'greaterThan': return `${value} > ${p}`;
    case 'greaterThanOrEqual': return `${value} >= ${p}`;
    case 'inRange':
      if (!Number.isFinite(to)) return 'FALSE';
      return `(${value} >= ${p} AND ${value} <= ${stmt.bind(String(to), 'float8')})`;
    default:
      return 'TRUE';
  }
}

/**
 * A calendar day as a UTC timestamp: the date part of a string as written,
 * the UTC day of a Date (the oracle's `parseDay`). Bounds are parsed here,
 * in JavaScript, exactly as the oracle parses them.
 */
export function parseDay(value: any): number | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate());
  }
  const text = String(value);
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (day) return Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]));
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

const DAY_MS = 86_400_000;

function dayValue(field: FieldSql): string {
  return epochDay(field.kind === 'ts' ? utcDay(field.sql) : `(${field.sql})::date`);
}

function compileDate(stmt: SqlStatement, field: FieldSql, type: string, model: any): string {
  const from = parseDay(model.dateFrom ?? model.filter ?? model.value);
  const to = parseDay(model.dateTo ?? model.filterTo ?? model.valueTo);
  if (from == null) return 'FALSE';
  const value = dayValue(field);
  const p = stmt.bind(from / DAY_MS, 'int');
  let compare: string;
  switch (type) {
    case 'equals': compare = `${value} = ${p}`; break;
    case 'notEqual': compare = `${value} <> ${p}`; break;
    case 'lessThan': compare = `${value} < ${p}`; break;
    case 'lessThanOrEqual': compare = `${value} <= ${p}`; break;
    case 'greaterThan': compare = `${value} > ${p}`; break;
    case 'greaterThanOrEqual': compare = `${value} >= ${p}`; break;
    case 'inRange':
      if (to == null || !Number.isFinite(to)) return 'FALSE';
      compare = `(${value} >= ${p} AND ${value} <= ${stmt.bind(to / DAY_MS, 'int')})`;
      break;
    default:
      compare = 'TRUE';
  }
  return `(${field.sql} IS NOT NULL AND ${compare})`;
}

/** `valueToString` of the oracle before folding: '' for blank, the ISO form of a timestamp, `String(v)` otherwise. */
export function textOf(field: FieldSql): string {
  switch (field.kind) {
    case 'int': return `coalesce((${field.sql})::text, '')`;
    case 'money': return centsText(field.sql);
    case 'fte': return `coalesce(trim_scale(${field.sql})::text, '')`;
    case 'day': return `coalesce(to_char(${field.sql}, 'YYYY-MM-DD'), '')`;
    case 'ts': return `coalesce(${jsIsoString(field.sql)}, '')`;
    case 'unknown': return `''`;
    default: return `coalesce(${field.sql}, '')`;
  }
}

/** One folded needle, computed once per statement (an InitPlan). */
export function foldedNeedle(stmt: SqlStatement, needle: string): string {
  return `(SELECT ${fold(stmt.bind(needle, 'text'))})`;
}

function textMatch(value: string, type: string, needle: string): string {
  switch (type) {
    case 'equals': return `${value} = ${needle}`;
    case 'notEqual': return `${value} <> ${needle}`;
    case 'startsWith': return `starts_with(${value}, ${needle})`;
    case 'endsWith': return `right(${value}, length(${needle})) = ${needle}`;
    case 'notContains': return `strpos(${value}, ${needle}) = 0`;
    case 'contains':
    default:
      return `strpos(${value}, ${needle}) > 0`;
  }
}

function textPredicate(stmt: SqlStatement, field: FieldSql, type: string, needle: string): string {
  const n = foldedNeedle(stmt, needle);
  const text = textOf(field);
  if (field.textCandidates) {
    const candidates = [text, ...field.textCandidates(text)].map((candidate) => `(${textMatch(fold(candidate), type, n)})`);
    const joined = candidates.join(NEGATIVE_TEXT_TYPES.has(type) ? ' AND ' : ' OR ');
    // A blank value has no candidates besides itself.
    return `(CASE WHEN ${blankSql(field)} THEN ${textMatch(fold(text), type, n)} ELSE (${joined}) END)`;
  }
  return `(${textMatch(fold(text), type, n)})`;
}

/** `String(value ?? '')` as a set filter compares it: exact text, case-sensitive. A timestamp never equals a listed value. */
function setText(field: FieldSql): string | null {
  switch (field.kind) {
    case 'int': return `coalesce((${field.sql})::text, '')`;
    case 'money': return centsText(field.sql);
    case 'fte': return `coalesce(trim_scale(${field.sql})::text, '')`;
    case 'day': return `coalesce(to_char(${field.sql}, 'YYYY-MM-DD'), '')`;
    case 'ts': return null;
    case 'unknown': return `''`;
    default: return `coalesce(${field.sql}, '')`;
  }
}

/**
 * A set model. Include: a listed value, or a blank line when the list holds
 * a blank marker (null, undefined or ''); `values: []` matches nothing.
 * Exclude (`mode: 'exclude'`): every value the column offers but the listed
 * ones, so a value created later shows: a single value is kept when it is
 * not listed, a line linked to several names when one of them is not listed,
 * a blank line when no blank marker is listed.
 */
function compileSet(stmt: SqlStatement, field: FieldSql, model: any): string {
  const rawValues: any[] = model.values;
  const exclude = model.mode === 'exclude';
  const values = rawValues.filter((v) => v !== null && v !== undefined && v !== '').map((v) => String(v));
  const hasNull = values.length < rawValues.length;
  const blank = blankSql(field);

  if (!exclude) {
    if (rawValues.length === 0) return 'FALSE';
    const parts: string[] = [];
    if (hasNull) parts.push(blank);
    if (values.length) {
      const list = stmt.bind(values, 'text[]');
      const text = setText(field);
      if (text) parts.push(`COALESCE(${text} = ANY(${list}), FALSE)`);
      if (field.names) parts.push(`COALESCE(EXISTS (SELECT 1 FROM unnest(${field.names}) AS n(name) WHERE n.name = ANY(${list})), FALSE)`);
    }
    return parts.length ? `(${parts.join(' OR ')})` : 'FALSE';
  }

  // Exclude.
  const keepBlank = hasNull ? 'FALSE' : 'TRUE';
  if (!values.length) return `(CASE WHEN ${blank} THEN ${keepBlank} ELSE TRUE END)`;
  const list = stmt.bind(values, 'text[]');
  let kept: string;
  if (field.names) {
    kept = `COALESCE(EXISTS (SELECT 1 FROM unnest(${field.names}) AS n(name) WHERE NOT (n.name = ANY(${list}))), FALSE)`;
  } else {
    const text = setText(field);
    kept = text ? `NOT COALESCE(${text} = ANY(${list}), FALSE)` : 'TRUE';
  }
  return `(CASE WHEN ${blank} THEN ${keepBlank} ELSE ${kept} END)`;
}
