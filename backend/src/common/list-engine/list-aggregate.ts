import { BadRequestException } from '@nestjs/common';
import type { FieldSql, ListConfig, ListState } from './list-engine.types';
import type { SqlStatement } from './sql-statement';
import { buildCore, fieldOf } from './list-sql-builder';
import { divRoundHalfAway, ICU_COLLATION, jsCents, sqlLiteral, sumJsCents } from './sql-fragments';

/**
 * `aggregate(spec)` of the list engine: the lines of a list state (the same
 * filtered core as the page: tenant, lifecycle scope, column filters, quick
 * search) grouped by fields of the list's config, with measures on its money
 * and FTE fields, an optional condition on the groups, ordered, optionally
 * cut to a top N with the rest as one "others" row, and the total of every
 * line of the state. One statement.
 *
 * Measures, exact like the list's footer totals:
 * - money (`FieldKind` `money`, converted cents): each line's amount is
 *   converted to the cent on its own (the list's FX rule); `sum` adds the
 *   cents exactly, `avg` divides that sum by the group's line count, rounded
 *   once half away from zero to the cent, `min` and `max` pick a line. A
 *   money value is never blank: every line of the group counts. `minus`
 *   subtracts another money field line by line (a variance between two
 *   columns or years, in cents); `part` keeps the positive or the negative
 *   part of each line's value (`max(x, 0)`, `min(x, 0)`: the gross increases
 *   and decreases of a variance).
 * - FTE (`fte`, a numeric, null when unknown): `sum`, `min`, `max` of the
 *   lines that have one, `avg` their mean rounded once half away from zero to
 *   2 decimals; `unknown` counts the lines without one; with none, the value
 *   is null. `minus` subtracts another FTE field line by line (never an
 *   amount): a line has a value when either side has one, the unknown side
 *   counting as 0 (sums of declared FTE), and none when both are unknown;
 *   `part` keeps the positive or the negative part of a line's value. The
 *   unit stays FTE (a `having` bound is compared as is).
 *
 * Group keys are text: a text-like field's value with '' read as null (a
 * multi-valued field, such as the linked projects, groups under its joined
 * text, `a, b`), an integer's digits, a day's `YYYY-MM-DD`. A key the list
 * does not know groups every line under null, as every engine path reads it.
 * Grouping by `id` gives one group per line (a top N of lines).
 *
 * Every group carries `count`, its line count. Order terms: the count; a
 * measure's value (no value last, whatever the direction, unless `nulls`
 * says otherwise); a key in the field's own sort order (a ranked enum, such
 * as the CAPEX priority, in its business order; numbers as numbers; text in
 * the ICU order; blanks where PostgreSQL puts them unless `nulls` says
 * otherwise). Any order then ends with every key's text in the ICU order,
 * blanks first, so it is total; the default order is the count, largest
 * first, then that tie-break. `having` keeps the groups whose measures pass
 * it, compared exactly with the bound as written (before the order and the
 * limit); the total always covers every line of the state.
 */

export type AggregateFn = 'sum' | 'min' | 'max' | 'avg';

export interface AggregateMeasureSpec {
  /** The measure's name in the result (never in the SQL). */
  id: string;
  fn: AggregateFn;
  /** A money or FTE field of the list. */
  field: string;
  /** Another field of the same kind (money from money, FTE from FTE) subtracted from `field` on each line. */
  minus?: string;
  /** The positive or the negative part of each line's value (money or FTE). */
  part?: 'positive' | 'negative';
}

export interface AggregateOrderSpec {
  /** The group's line count, a measure (`id`) or a group key (`index` in `groupBy`). */
  by: 'count' | 'measure' | 'key';
  id?: string;
  index?: number;
  dir: 'ASC' | 'DESC';
  /**
   * Where null values go. Default: last for a measure (a group without a
   * value, in either direction); PostgreSQL's default for a key (last
   * ascending, first descending).
   */
  nulls?: 'FIRST' | 'LAST';
}

/**
 * A condition on a group's measure, in the measure's unit (an amount, an
 * FTE), compared exactly with the number as written (`1697476.995` is not
 * rounded to the cent). A null value never passes.
 */
export interface AggregateHavingSpec {
  measure: string;
  op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'ne';
  value: number;
}

export interface AggregateSpec {
  /** Fields of the list to group by, in order; none: one group of every line. */
  groupBy: string[];
  measures: AggregateMeasureSpec[];
  /** Groups kept, every condition applying (the total still covers every line). */
  having?: AggregateHavingSpec[];
  /** At most 10 terms. Default: count descending; every order ends with each key's text ascending, blanks first. */
  order?: AggregateOrderSpec[];
  /** Keep the first `limit` groups of the order (a top N). */
  limit?: number;
  /** With `limit`: the groups past it as one more row, so the groups and the others add up to the kept groups. */
  others?: boolean;
}

/**
 * `measures` caps a spec without keys (one group: the reports' trends read up to 25 sums);
 * `groupedMeasures` caps a spec with keys. Each measure costs per group, and a key can give one
 * group per line (`id`, but also a name, a note or a combination of fields): 5,000 groups × 60
 * measures took 1 to 2 s and answered 3 to 6 MB. A grouped report reads at most 5 measures, the AI
 * one.
 */
export const AGGREGATE_LIMITS = { groupBy: 6, measures: 60, groupedMeasures: 8, having: 10, order: 10, limit: 10_000 } as const;

const FUNCTIONS: ReadonlySet<string> = new Set(['sum', 'min', 'max', 'avg']);
const HAVING_OPS: Record<AggregateHavingSpec['op'], string> = { gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=', ne: '<>' };
const MEASURE_ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;

/**
 * A measure compiled for one statement. `line` is its value on one line:
 * - `money`: a plain money field, float8 cents as the field holds them
 *   (summed by `sumJsCents`, the cents of the lowest and highest read by
 *   `jsCents`: the fast path of the footer totals);
 * - `cents`: a variance or a part, exact integer cents as a numeric;
 * - `fte`: a numeric or null.
 */
interface CompiledMeasure {
  spec: AggregateMeasureSpec;
  unit: 'money' | 'cents' | 'fte';
  line: string;
  fields: FieldSql[];
}

function fail(message: string): never {
  throw new BadRequestException(`Aggregate: ${message}`);
}

/** Checks the shape of a spec (fields are checked against the list when compiled). */
export function validateAggregateSpec(spec: AggregateSpec): void {
  if (!spec || typeof spec !== 'object') fail('a spec is required.');
  if (!Array.isArray(spec.groupBy) || spec.groupBy.some((key) => typeof key !== 'string' || !key)) fail('groupBy must be a list of field keys.');
  if (spec.groupBy.length > AGGREGATE_LIMITS.groupBy) fail(`at most ${AGGREGATE_LIMITS.groupBy} group fields.`);
  if (!Array.isArray(spec.measures)) fail('measures must be a list.');
  if (spec.measures.length > AGGREGATE_LIMITS.measures) fail(`at most ${AGGREGATE_LIMITS.measures} measures.`);
  if (spec.groupBy.length > 0 && spec.measures.length > AGGREGATE_LIMITS.groupedMeasures) {
    fail(`at most ${AGGREGATE_LIMITS.groupedMeasures} measures with group keys (${AGGREGATE_LIMITS.measures} without).`);
  }
  const ids = new Set<string>();
  for (const measure of spec.measures) {
    if (!measure || typeof measure.id !== 'string' || !MEASURE_ID.test(measure.id)) fail(`invalid measure id ${JSON.stringify(measure?.id)}.`);
    if (ids.has(measure.id)) fail(`measure id ${measure.id} is used twice.`);
    ids.add(measure.id);
    if (!FUNCTIONS.has(measure.fn)) fail(`unknown function ${JSON.stringify(measure.fn)} (sum, min, max or avg).`);
    if (typeof measure.field !== 'string' || !measure.field) fail(`measure ${measure.id} needs a field.`);
    if (measure.minus != null && (typeof measure.minus !== 'string' || !measure.minus)) fail(`measure ${measure.id}: minus names a field.`);
    if (measure.part != null && measure.part !== 'positive' && measure.part !== 'negative') fail(`measure ${measure.id}: part is positive or negative.`);
  }
  if (spec.having != null && !Array.isArray(spec.having)) fail('having must be a list.');
  if ((spec.having ?? []).length > AGGREGATE_LIMITS.having) fail(`at most ${AGGREGATE_LIMITS.having} conditions.`);
  for (const having of spec.having ?? []) {
    if (!having || !ids.has(String(having.measure))) fail(`no measure ${JSON.stringify(having?.measure)} for a condition.`);
    if (!Object.prototype.hasOwnProperty.call(HAVING_OPS, having.op)) fail(`unknown condition ${JSON.stringify(having.op)}.`);
    if (typeof having.value !== 'number' || !Number.isFinite(having.value)) fail('a condition compares with a finite number.');
  }
  if (spec.order != null && !Array.isArray(spec.order)) fail('order must be a list.');
  if ((spec.order ?? []).length > AGGREGATE_LIMITS.order) fail(`at most ${AGGREGATE_LIMITS.order} order terms.`);
  for (const order of spec.order ?? []) {
    if (!order || !['count', 'measure', 'key'].includes(order.by)) fail('an order is by count, measure or key.');
    if (order.dir !== 'ASC' && order.dir !== 'DESC') fail('an order direction is ASC or DESC.');
    if (order.nulls != null && order.nulls !== 'FIRST' && order.nulls !== 'LAST') fail('nulls go FIRST or LAST.');
    if (order.by === 'measure' && !ids.has(String(order.id))) fail(`no measure ${JSON.stringify(order.id)} to order by.`);
    if (order.by === 'key' && !(Number.isInteger(order.index) && order.index! >= 0 && order.index! < spec.groupBy.length)) {
      fail(`no group key ${JSON.stringify(order.index)} to order by.`);
    }
  }
  if (spec.limit != null && !(Number.isInteger(spec.limit) && spec.limit >= 1 && spec.limit <= AGGREGATE_LIMITS.limit)) {
    fail(`limit must be an integer from 1 to ${AGGREGATE_LIMITS.limit}.`);
  }
  if (spec.others && spec.limit == null) fail('others needs a limit.');
}

/** The text a group key reads for a field; refuses the kinds a group cannot read (amounts, timestamps). */
function groupKeySql(key: string, field: FieldSql): string {
  switch (field.kind) {
    case 'text':
    case 'enum':
    case 'uuid':
    case 'multi':
      return `NULLIF((${field.sql})::text, '')`;
    case 'int':
      return `(${field.sql})::text`;
    case 'day':
      return `to_char(${field.sql}, 'YYYY-MM-DD')`;
    case 'unknown':
      return 'NULL::text';
    default:
      return fail(`${key} (${field.kind}) cannot group lines.`);
  }
}

/** The tie-break of a group key column: its text in the ICU order (numbers as numbers). */
function keyTextOrderSql(column: string, field: FieldSql): string {
  return field.kind === 'int' ? `(${column})::numeric` : `${column} COLLATE ${ICU_COLLATION}`;
}

/**
 * An explicit order by a group key: the field's own sort order, as the list
 * sorts it. A ranked enum (status, run or build, the CAPEX priority,
 * investment and PPE types) in its rank, a value outside the rank as blank;
 * otherwise the text order of the tie-break.
 */
function keyOrderSql(column: string, field: FieldSql): string {
  if (field.kind === 'enum' && field.rank) {
    return `(CASE ${column} ${field.rank.map((value, i) => `WHEN ${sqlLiteral(value)} THEN ${i}`).join(' ')} END)`;
  }
  return keyTextOrderSql(column, field);
}

function compileMeasure(stmt: SqlStatement, config: ListConfig, spec: AggregateMeasureSpec): CompiledMeasure {
  const field = fieldOf(stmt, config, spec.field);
  if (field.kind === 'fte') {
    if (spec.minus == null && spec.part == null) return { spec, unit: 'fte', line: field.sql, fields: [field] };
    const fields = [field];
    // A line has a value when either side has one; an unknown side counts as 0 against a known one.
    let known = `${field.sql} IS NOT NULL`;
    let value = field.sql;
    if (spec.minus != null) {
      const other = fieldOf(stmt, config, spec.minus);
      if (other.kind !== 'fte') fail(`${spec.minus} is not an FTE field (an FTE subtracts an FTE).`);
      fields.push(other);
      known = `${known} OR ${other.sql} IS NOT NULL`;
      value = `(coalesce(${field.sql}, 0) - coalesce(${other.sql}, 0))`;
    }
    // `greatest` and `least` skip a null: the part applies to a known value only.
    if (spec.part === 'positive') value = `greatest(${value}, 0)`;
    else if (spec.part === 'negative') value = `least(${value}, 0)`;
    return { spec, unit: 'fte', line: `(CASE WHEN ${known} THEN ${value} END)`, fields };
  }
  if (field.kind !== 'money') fail(`${spec.field} is not an amount or an FTE field.`);
  if (spec.minus == null && spec.part == null) return { spec, unit: 'money', line: field.sql, fields: [field] };
  const fields = [field];
  let cents = jsCents(field.sql);
  if (spec.minus != null) {
    const other = fieldOf(stmt, config, spec.minus);
    if (other.kind !== 'money') fail(`${spec.minus} is not an amount field.`);
    fields.push(other);
    cents = `(${cents} - ${jsCents(other.sql)})`;
  }
  if (spec.part === 'positive') cents = `greatest(${cents}, 0)`;
  else if (spec.part === 'negative') cents = `least(${cents}, 0)`;
  return { spec, unit: 'cents', line: cents, fields };
}

/**
 * The per-group columns a measure keeps (sum, count of values, lowest and
 * highest), so groups combine into the others row and the total, and the
 * measure's value from them.
 */
function measureParts(m: CompiledMeasure, i: number, v: string): string[] {
  const sum = m.unit === 'money' ? sumJsCents(v) : `sum(${v})`;
  return [`${sum} AS s${i}`, `count(${v}) AS c${i}`, `min(${v}) AS lo${i}`, `max(${v}) AS hi${i}`];
}

/** The parts of several rows combined (the others row, the total). */
function combinedParts(i: number, from: string): string[] {
  return [`sum(${from}.s${i}) AS s${i}`, `sum(${from}.c${i}) AS c${i}`, `min(${from}.lo${i}) AS lo${i}`, `max(${from}.hi${i}) AS hi${i}`];
}

/**
 * A measure's value from its parts, exact: money in integer cents (a scale-0
 * numeric), FTE as a numeric. Null without a value (FTE), or for the lowest,
 * highest or mean of no line.
 */
function measureValue(m: CompiledMeasure, i: number, from: string): string {
  const s = `${from}.s${i}`;
  const c = `${from}.c${i}`;
  const lo = `${from}.lo${i}`;
  const hi = `${from}.hi${i}`;
  switch (m.spec.fn) {
    case 'sum':
      return m.unit === 'fte' ? `(CASE WHEN ${c} > 0 THEN ${s} END)` : `coalesce(${s}, 0)`;
    case 'avg':
      return m.unit === 'fte'
        ? `(CASE WHEN ${c} > 0 THEN trim_scale(${divRoundHalfAway(`(${s} * 100)`, c)} / 100) END)`
        : `(CASE WHEN ${c} > 0 THEN ${divRoundHalfAway(s, c)} END)`;
    case 'min':
      return m.unit === 'money' ? jsCents(lo) : lo;
    case 'max':
    default:
      return m.unit === 'money' ? jsCents(hi) : hi;
  }
}

/**
 * A condition's bound in the measure's unit, exact: the number as JavaScript
 * writes it (`String(value)`, a shortest decimal, exponent included), read as
 * a numeric; an amount's bound times 100 against the integer cents. A bound
 * between two cents is kept as is, never rounded: `gt 1697476.995` keeps a
 * group of 1,697,477.00 and `lte` drops it.
 */
function havingBound(stmt: SqlStatement, m: CompiledMeasure, value: number): string {
  const bound = stmt.bind(String(value), 'numeric');
  return m.unit === 'fte' ? bound : `(${bound} * 100)`;
}

/**
 * The aggregate statement. Rows: `part` (`g` a group, `o` the others, `t`
 * the total, in that order), `rn` (the group's rank), `k0…` the keys as text,
 * `n` the line count, per measure `m<i>` its value as exact text (money in
 * cents) and `u<i>` the lines without a value, and `gc` the number of groups
 * kept (on the total row).
 */
export function aggregateSql(stmt: SqlStatement, config: ListConfig, state: ListState, spec: AggregateSpec): string {
  validateAggregateSpec(spec);
  const keys = spec.groupBy.map((key) => ({ key, field: fieldOf(stmt, config, key) }));
  const keyColumns = keys.map((k, i) => `${groupKeySql(k.key, k.field)} AS k${i}`);
  const measures = spec.measures.map((measure) => compileMeasure(stmt, config, measure));
  const core = buildCore(stmt, config, state, { fields: [...keys.map((k) => k.field), ...measures.flatMap((m) => m.fields)] });
  const measureIndex = (id: string) => measures.findIndex((m) => m.spec.id === id);

  const kList = keys.map((_, i) => `k${i}`);
  // No key and no measure: an empty select list (PostgreSQL takes it), one row per line to count.
  const lines = `SELECT ${[...keyColumns, ...measures.map((m, i) => `${m.line} AS v${i}`)].join(', ')}
${core.from}
${core.where}`;
  const groups = `SELECT ${[...kList, 'count(*) AS n', ...measures.flatMap((m, i) => measureParts(m, i, `agg_lines.v${i}`))].join(', ')}
FROM agg_lines
${kList.length ? `GROUP BY ${kList.join(', ')}\n` : ''}HAVING count(*) > 0`;
  const conditions = (spec.having ?? []).map((having) => {
    const i = measureIndex(having.measure);
    return `(${measureValue(measures[i], i, 'g')}) ${HAVING_OPS[having.op]} ${havingBound(stmt, measures[i], having.value)}`;
  });

  const orderTerms = (spec.order?.length ? spec.order : [{ by: 'count', dir: 'DESC' } as AggregateOrderSpec]).map((order) => {
    const nulls = order.nulls ? ` NULLS ${order.nulls}` : '';
    if (order.by === 'count') return `g.n ${order.dir}${nulls}`;
    if (order.by === 'key') return `${keyOrderSql(`g.k${order.index}`, keys[order.index!].field)} ${order.dir}${nulls}`;
    const i = measureIndex(order.id!);
    // A group without a value goes last in either direction unless asked otherwise.
    return `${measureValue(measures[i], i, 'g')} ${order.dir} NULLS ${order.nulls ?? 'LAST'}`;
  });
  // Every key's text last, so the order is total (groups are unique on their keys).
  keys.forEach((k, i) => orderTerms.push(`${keyTextOrderSql(`g.k${i}`, k.field)} ASC NULLS FIRST`));
  const ranked = `SELECT g.*, row_number() OVER (ORDER BY ${orderTerms.join(', ')}) AS rn
FROM agg_groups g${conditions.length ? `\nWHERE ${conditions.join(' AND ')}` : ''}`;

  const values = (from: string) => measures.flatMap((m, i) => [
    `(${measureValue(m, i, from)})::text AS m${i}`,
    `(${from}.n - coalesce(${from}.c${i}, 0))::int AS u${i}`,
  ]);
  const nullKeys = kList.map((k) => `NULL::text AS ${k}`);
  const limit = spec.limit != null ? stmt.bind(spec.limit, 'int') : null;
  const combined = (from: string, where = '') => `SELECT ${['coalesce(sum(r.n), 0)::bigint AS n', ...measures.flatMap((_, i) => combinedParts(i, 'r'))].join(', ')} FROM ${from} r${where}`;

  const parts = [
    `SELECT ${["'g' AS part", 'x.rn', ...kList.map((k) => `x.${k}`), 'x.n', ...values('x'), 'NULL::bigint AS gc'].join(', ')} FROM agg_ranked x${limit ? ` WHERE x.rn <= ${limit}` : ''}`,
  ];
  if (limit && spec.others) {
    parts.push(`SELECT ${["'o' AS part", 'NULL::bigint AS rn', ...nullKeys, 'x.n', ...values('x'), 'NULL::bigint AS gc'].join(', ')} FROM (${combined('agg_ranked', ` WHERE r.rn > ${limit}`)}) x WHERE x.n > 0`);
  }
  parts.push(`SELECT ${["'t' AS part", 'NULL::bigint AS rn', ...nullKeys, 'x.n', ...values('x'), '(SELECT count(*) FROM agg_ranked) AS gc'].join(', ')} FROM (${combined('agg_groups')}) x`);

  return `${stmt.withClause([['agg_lines', lines], ['agg_groups', groups], ['agg_ranked', ranked]])}${parts.map((p) => `(${p})`).join('\nUNION ALL\n')}
ORDER BY 1, 2`;
}
