import type { LifecycleScope } from '../status';
import type { Sort } from '../pagination';
import type { SqlStatement } from './sql-statement';

/**
 * What a field is to the engine. The kind fixes how its value is filtered,
 * sorted, searched and listed (see `list-filter-compiler.ts`):
 * - `text`, `enum`, `uuid`: text values (`enum` may carry a rank order);
 * - `multi`: several names per line plus their joined text (`a, b`);
 * - `int`: an integer; `money`: converted cents (a float8 holding an integer, as JavaScript holds them); `fte`: a numeric;
 * - `day`: a `date`; `ts`: a `timestamptz`;
 * - `unknown`: a key the rows do not hold, read as null.
 */
export type FieldKind = 'text' | 'enum' | 'uuid' | 'multi' | 'int' | 'money' | 'fte' | 'day' | 'ts' | 'unknown';

/** One field compiled for one statement. */
export interface FieldSql {
  kind: FieldKind;
  /** The value: text for text kinds (the joined text for `multi`), float8 cents for money, numeric for fte, date, timestamptz, integer. */
  sql: string;
  /** Joins (keys registered on the statement) the value needs. */
  joins: string[];
  /** `enum`: the sort order of the values; other values sort as blank. */
  rank?: readonly string[];
  /** `multi`: a `text[]` of the line's names (null or empty when none). */
  names?: string;
  /** Text filter candidates besides the value itself (`opx-N` for the item number): positive operators need any, negative ones every. */
  textCandidates?: (valueText: string) => string[];
}

/** A list's declaration: everything the generic engine needs to build a statement. */
export interface ListConfig {
  /** `FROM` source with its alias, e.g. `spend_items i`. */
  from: string;
  /** Alias of the main table. */
  alias: string;
  /** The tenant predicate, always explicit besides RLS. */
  tenantWhere(stmt: SqlStatement): string;
  /** The order after the sort key: `i.created_at DESC, i.id DESC`. */
  tieBreak: string[];
  /** The lifecycle predicate (scope, and the column filters of `scopeFields`); null for none. */
  scopeWhere(stmt: SqlStatement, scope: LifecycleScope, filters: Record<string, any>): string | null;
  /** Compiles one field for the statement (registering its joins and CTEs); unknown keys give kind `unknown`. */
  field(stmt: SqlStatement, key: string): FieldSql;
  /** Fields whose column filter the engine never applies as a column filter (handled by `scopeWhere`). */
  scopeFields: readonly string[];
  /** The quick search predicate for a trimmed, non-empty needle. */
  quickSearch(stmt: SqlStatement, q: string): string;
  /**
   * The select expression of a column the id and neighbour statements return (`<expr> AS <column>`);
   * absent: the main table's column of that name.
   */
  selectColumn?(column: string): string;
}

/** A parsed list request, common to every list endpoint. */
export interface ListState {
  page: number;
  limit: number;
  skip: number;
  sort: Sort;
  /** Trimmed; undefined when empty. */
  q?: string;
  /** Column filters, the status column filter taken out. */
  filters: Record<string, any>;
  /** Resolved lifecycle scope (status, "all", endpoint default). */
  scope: LifecycleScope;
}
