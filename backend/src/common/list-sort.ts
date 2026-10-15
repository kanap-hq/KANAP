import { BadRequestException } from '@nestjs/common';
import type { EntityManager, ObjectLiteral, Repository, SelectQueryBuilder } from 'typeorm';
import type { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { checkListEngineSupport } from './list-engine/list-engine-support';
import { ICU_COLLATION } from './list-engine/sql-fragments';

/**
 * The alphabetical order of every list: a text column sorts ignoring case and accents first
 * ("Okta" before "OVHcloud", "Élodie" among the Es), as the OPEX and CAPEX lists do. In SQL it
 * is the ICU root collation (`und-x-icu`); on a PostgreSQL built without ICU, `lower()` (case
 * only). In JavaScript (lists sorted in memory) it is the same root collation through `Intl`.
 * Callers add the id as the last key, so pages and the record navigation never shift.
 *
 * One helper per way a list builds its query:
 * - raw SQL and query builders: `textSortKey(manager)` wraps a text expression;
 * - TypeORM `find` options: `sortedFindQuery` turns them into a query builder;
 * - lists sorted in memory: `compareText`.
 */

export type SortDirection = 'ASC' | 'DESC';

/** `ASC` or `DESC` from a request value; anything else is the fallback. */
export function sortDirection(raw: unknown, fallback: SortDirection = 'ASC'): SortDirection {
  const value = String(raw ?? '').toUpperCase();
  return value === 'ASC' || value === 'DESC' ? value : fallback;
}

/** Wraps a SQL text expression into its sort key. */
export type TextSortKey = (expr: string) => string;

/**
 * The sort key of a SQL text expression for this database: `(expr) COLLATE "und-x-icu"`, or
 * `lower(expr)` without ICU. The check runs once per process (`checkListEngineSupport`).
 */
export async function textSortKey(manager: EntityManager): Promise<TextSortKey> {
  const icu = await checkListEngineSupport(manager);
  return icu ? (expr) => `(${expr}) COLLATE ${ICU_COLLATION}` : (expr) => `lower(${expr})`;
}

const TEXT_COLUMN_TYPES = new Set<unknown>(['text', 'varchar', 'character varying', 'citext', 'char', 'character', String]);

/** Whether an entity column holds text (sorted alphabetically). */
export function isTextColumn(column: ColumnMetadata): boolean {
  return TEXT_COLUMN_TYPES.has(column.type);
}

/**
 * The query of a list built from TypeORM `find` options (`where` may be an OR array), in the
 * requested order: text columns alphabetically (`textSortKey`), the others as stored, then the
 * id. An unknown sort field answers 400, or falls back to `fallbackField` when one is given.
 */
export async function sortedFindQuery<T extends ObjectLiteral>(
  repo: Repository<T>,
  alias: string,
  where: any,
  sort: { field: string; direction: string },
  opts?: { fallbackField?: string; relations?: Record<string, any> },
): Promise<SelectQueryBuilder<T>> {
  let column = repo.metadata.findColumnWithPropertyName(sort.field);
  if (!column && opts?.fallbackField) column = repo.metadata.findColumnWithPropertyName(opts.fallbackField);
  if (!column) throw new BadRequestException(`Unknown sort field '${sort.field}'`);
  const direction = sortDirection(sort.direction);
  const qb = repo.createQueryBuilder(alias).setFindOptions({ where, ...(opts?.relations ? { relations: opts.relations } : {}) });
  const target = `${alias}.${column.databaseName}`;
  if (isTextColumn(column)) {
    const key = await textSortKey(repo.manager);
    qb.orderBy(key(target), direction);
  } else {
    qb.orderBy(target, direction);
  }
  return qb.addOrderBy(`${alias}.id`, 'ASC');
}

/** The output column a query builder sorts on (`orderListQuery`). */
export const LIST_SORT_KEY = 'list_sort_key';

/**
 * Orders a query builder by one list column, then by the row id: a `text` column alphabetically
 * (`textSortKey`). The key is selected under `list_sort_key` and the query orders by that name,
 * which TypeORM also carries through `skip`/`take` paging over joins (it cannot map an
 * expression there).
 */
export async function orderListQuery(
  qb: SelectQueryBuilder<any>,
  expr: string,
  direction: string,
  opts: { text: boolean; idExpr: string; nulls?: 'NULLS FIRST' | 'NULLS LAST'; thenByText?: string },
): Promise<SelectQueryBuilder<any>> {
  const manager: EntityManager = (qb as any).queryRunner?.manager ?? qb.connection.manager;
  const textKey = await textSortKey(manager);
  qb.addSelect(opts.text ? textKey(expr) : expr, LIST_SORT_KEY).orderBy(LIST_SORT_KEY, sortDirection(direction), opts.nulls);
  // A second text key for the ties (a name under a shared category), ascending.
  if (opts.thenByText) qb.addSelect(textKey(opts.thenByText), `${LIST_SORT_KEY}_2`).addOrderBy(`${LIST_SORT_KEY}_2`, 'ASC');
  return qb.addOrderBy(opts.idExpr, 'ASC');
}

const collator = new Intl.Collator('en', { usage: 'sort', sensitivity: 'base', numeric: true });

/**
 * The alphabetical order of two texts in memory: case and accents ignored, numbers in their
 * natural order ("CC2" before "CC10"), as the in-memory lists always sorted. Blanks come last.
 */
export function compareText(a: string | null | undefined, b: string | null | undefined): number {
  const left = a ?? '';
  const right = b ?? '';
  if (!left || !right) return left ? -1 : right ? 1 : 0;
  return collator.compare(left, right);
}
