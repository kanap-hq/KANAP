import type { EntityManager } from 'typeorm';

/**
 * Kad's reads of the portfolio classification (source, category, stream) of requests, projects and
 * tasks (lot I7a of 26.12.1): the names on a record's detail, and the values a record's picker offers.
 */

/** The families whose records carry a source, a category and a stream. */
export const AI_PORTFOLIO_CLASSIFIED_TYPES: ReadonlySet<string> = new Set(['requests', 'projects', 'tasks']);

/**
 * The names of a request's or a project's source, category and stream: the record's read leaves them
 * as ids, which the list names (`include=classification`). One read, in the tenant.
 */
export async function withClassificationNames<T extends Record<string, any> | null | undefined>(
  manager: EntityManager,
  tenantId: string,
  row: T,
): Promise<T> {
  if (!row) return row;
  const [names] = await manager.query(
    `SELECT (SELECT name FROM portfolio_sources WHERE tenant_id = $1 AND id = $2::uuid) AS source_name,
            (SELECT name FROM portfolio_categories WHERE tenant_id = $1 AND id = $3::uuid) AS category_name,
            (SELECT name FROM portfolio_streams WHERE tenant_id = $1 AND id = $4::uuid) AS stream_name`,
    [tenantId, row.source_id ?? null, row.category_id ?? null, row.stream_id ?? null],
  );
  return { ...row, ...(names ?? {}) };
}

/**
 * The source, category and stream values of requests, projects and tasks: the ones records carry,
 * and every active one the portfolio settings offer, as a record's picker offers them to whoever
 * reads the family. A value no record carries yet is still one Kad can set by its name (the write
 * reads a stream in the record's category); an inactive one appears only while a record carries it.
 * `raw` holds the carried values by grid field; `grids` the grid fields asked.
 */
export async function addOfferedClassification(
  manager: EntityManager,
  tenantId: string,
  raw: Record<string, Array<string | boolean | null>>,
  grids: ReadonlyMap<string, unknown>,
): Promise<void> {
  const tables: Record<string, string> = { source_name: 'portfolio_sources', category_name: 'portfolio_categories', stream_name: 'portfolio_streams' };
  for (const [grid, table] of Object.entries(tables)) {
    if (!grids.has(grid)) continue;
    const offered: Array<{ name: string }> = await manager.query(
      `SELECT DISTINCT name FROM ${table} WHERE tenant_id = $1 AND is_active`,
      [tenantId],
    );
    const carried = raw[grid] ?? [];
    const names = new Set(carried.filter((value): value is string => typeof value === 'string'));
    for (const row of offered) names.add(row.name);
    raw[grid] = [...[...names].sort((left, right) => left.localeCompare(right)), ...(carried.includes(null) ? [null] : [])];
  }
}
