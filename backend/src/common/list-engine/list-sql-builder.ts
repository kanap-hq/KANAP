import type { FieldSql, ListConfig, ListState } from './list-engine.types';
import type { SqlStatement } from './sql-statement';
import { compileFieldFilter } from './list-filter-compiler';
import { textSortKey, timestampSortKey } from './sql-fragments';

/**
 * Assembles one list statement from a config and a request state. Every
 * purpose (page, ids, neighbors, filter values, totals) reads the same
 * filtered core: tenant, lifecycle scope, column filters, quick search.
 */

export interface CoreParts {
  /** `FROM … JOIN …` (joins of the filters, the sort and `extraJoins`). */
  from: string;
  /** `WHERE …`. */
  where: string;
}

export interface CoreOptions {
  /** A field whose own column filter is left out (filter values). */
  omitFilter?: string;
  /** Include the sort key's joins. */
  withSort?: boolean;
  /** More fields whose joins the projection needs. */
  fields?: FieldSql[];
}

/** The field a key compiles to, once per statement. */
export function fieldOf(stmt: SqlStatement, config: ListConfig, key: string): FieldSql {
  const cached = stmt.fieldCache.get(key);
  if (cached) return cached;
  const field = config.field(stmt, key);
  stmt.fieldCache.set(key, field);
  return field;
}

export function buildCore(stmt: SqlStatement, config: ListConfig, state: ListState, options: CoreOptions = {}): CoreParts {
  const predicates: string[] = [config.tenantWhere(stmt)];
  const joinKeys = new Set<string>();
  const scope = config.scopeWhere(stmt, state.scope, state.filters);
  if (scope) predicates.push(scope);
  for (const [key, model] of Object.entries(state.filters)) {
    if (config.scopeFields.includes(key) || key === options.omitFilter) continue;
    const field = fieldOf(stmt, config, key);
    const predicate = compileFieldFilter(stmt, field, model);
    if (predicate === 'TRUE') continue;
    field.joins.forEach((join) => joinKeys.add(join));
    predicates.push(predicate);
  }
  if (state.q) predicates.push(config.quickSearch(stmt, state.q));
  if (options.withSort) fieldOf(stmt, config, state.sort.field).joins.forEach((join) => joinKeys.add(join));
  for (const field of options.fields ?? []) field.joins.forEach((join) => joinKeys.add(join));
  return {
    from: `FROM ${config.from}\n${stmt.joinSql(joinKeys)}`,
    where: `WHERE ${predicates.map((p) => `(${p})`).join('\n  AND ')}`,
  };
}

/** The sort key of a field: blanks last ascending (PostgreSQL's default null placement), ranks for ordered enums. */
export function sortKey(field: FieldSql): string {
  switch (field.kind) {
    case 'enum':
      if (field.rank) {
        return `(CASE ${field.sql} ${field.rank.map((value, i) => `WHEN '${value.replace(/'/g, "''")}' THEN ${i}`).join(' ')} END)`;
      }
      return textSortKey(field.sql);
    case 'text':
    case 'uuid':
    case 'multi':
      return textSortKey(field.sql);
    case 'ts':
      return timestampSortKey(field.sql);
    case 'unknown':
      return 'NULL::int';
    default:
      return `(${field.sql})`;
  }
}

/** `ORDER BY` of the list: the sort key, then the tie-break (newest first). */
export function orderBy(stmt: SqlStatement, config: ListConfig, state: ListState): string {
  const field = fieldOf(stmt, config, state.sort.field);
  return `ORDER BY ${sortKey(field)} ${state.sort.direction === 'ASC' ? 'ASC' : 'DESC'}, ${config.tieBreak.join(', ')}`;
}

/** One page of ids with the count of the whole list (`count(*) OVER ()`). */
export function pageSql(stmt: SqlStatement, config: ListConfig, state: ListState, extraColumns: Array<{ name: string; field: FieldSql }> = []): string {
  const core = buildCore(stmt, config, state, { withSort: true, fields: extraColumns.map((c) => c.field) });
  const extra = extraColumns.map((c) => `, ${c.field.sql} AS ${c.name}`).join('');
  return `${stmt.withClause()}SELECT ${config.alias}.id, count(*) OVER () AS total${extra}
${core.from}
${core.where}
${orderBy(stmt, config, state)}
LIMIT ${stmt.bind(state.limit, 'int')} OFFSET ${stmt.bind(state.skip, 'int')}`;
}

/** The count of the list (a page past the end returns no row to read it from). */
export function countSql(stmt: SqlStatement, config: ListConfig, state: ListState): string {
  const core = buildCore(stmt, config, state);
  return `${stmt.withClause()}SELECT count(*) AS total
${core.from}
${core.where}`;
}

/** Every id of the list, in order, with `columns` of the main table. */
export function idsSql(stmt: SqlStatement, config: ListConfig, state: ListState, columns: string[]): string {
  const core = buildCore(stmt, config, state, { withSort: true });
  return `${stmt.withClause()}SELECT ${columns.map((c) => `${config.alias}.${c}`).join(', ')}
${core.from}
${core.where}
${orderBy(stmt, config, state)}`;
}

/** The position of one id in the list and its neighbours. */
export function neighborsSql(stmt: SqlStatement, config: ListConfig, state: ListState, id: string, columns: string[]): string {
  const core = buildCore(stmt, config, state, { withSort: true });
  const order = orderBy(stmt, config, state).replace(/^ORDER BY /, '');
  const me = stmt.bind(id, 'uuid');
  const cols = columns.map((c) => `${config.alias}.${c}`).join(', ');
  return `${stmt.withClause([['ordered', `SELECT ${cols}, row_number() OVER (ORDER BY ${order}) AS n, count(*) OVER () AS total
${core.from}
${core.where}`]])}SELECT o.*, (SELECT n FROM ordered WHERE id = ${me}) AS me
FROM ordered o
WHERE o.n BETWEEN (SELECT n FROM ordered WHERE id = ${me}) - 1 AND (SELECT n FROM ordered WHERE id = ${me}) + 1
   OR o.n = 1`;
}

/**
 * The distinct values of each field under every other filter of the state
 * (a field's own filter never narrows its own list). One statement; a
 * `multi` field lists each name, and null for a line without any.
 */
export function filterValuesSql(stmt: SqlStatement, config: ListConfig, state: ListState, keys: string[]): string {
  const parts = keys.map((key, index) => {
    const field = fieldOf(stmt, config, key);
    const core = buildCore(stmt, config, state, { omitFilter: key, fields: [field] });
    if (field.names) {
      return `SELECT DISTINCT ${index} AS f, NULLIF(x.name, '') AS v
${core.from}
CROSS JOIN LATERAL unnest(CASE WHEN cardinality(${field.names}) > 0 THEN ${field.names} ELSE ARRAY[NULL::text] END) AS x(name)
${core.where}`;
    }
    const value = field.kind === 'unknown' ? 'NULL::text' : `NULLIF((${field.sql})::text, '')`;
    return `SELECT DISTINCT ${index} AS f, ${value} AS v
${core.from}
${core.where}`;
  });
  return `${stmt.withClause()}${parts.map((p) => `(${p})`).join('\nUNION ALL\n')}`;
}
