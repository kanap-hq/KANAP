import type { AiExecutionContextWithManager } from '../ai.types';

/** Catalog entries the template description lists for a column, and dimension values the model reads with a value to create. */
export const DESCRIBED_CATALOG_ENTRIES = 60;

/**
 * The enabled values of each dimension, by its budget file column (`analytics:<code>`), the first
 * ones: the model proposes them for the values of the file the workspace names otherwise (a
 * translation, a synonym). Lists of the workspace, readable by anyone who imports a budget file.
 * The template describes them, and the check gives them again with each dimension value it would create.
 */
export async function enabledDimensionValues(context: AiExecutionContextWithManager): Promise<Map<string, string[]>> {
  const rows: Array<{ code: string; name: string }> = await context.manager.query(
    `SELECT ax.code, c.name
       FROM analytics_categories c
       JOIN analytics_axes ax ON ax.tenant_id = c.tenant_id AND ax.id = c.axis_id
      WHERE c.tenant_id = $1 AND (c.disabled_at IS NULL OR c.disabled_at > now())
      ORDER BY ax.code, c.sort_order, lower(c.name), c.id`,
    [context.tenantId],
  );
  const byColumn = new Map<string, string[]>();
  for (const row of rows) {
    const list = byColumn.get(`analytics:${row.code}`) ?? [];
    if (list.length < DESCRIBED_CATALOG_ENTRIES) list.push(row.name);
    byColumn.set(`analytics:${row.code}`, list);
  }
  return byColumn;
}
