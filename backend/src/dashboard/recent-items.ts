import type { EntityManager } from 'typeorm';
import { BUDGET_NATURES, naturesAnd } from '../spend/budget-nature';

/**
 * The "Recently viewed" check: the entries of the list a browser keeps (`useRecentlyViewed`),
 * of which only the records that still exist in the tenant come back. A record deleted on its own
 * or with another one (a contract's tasks) then leaves the list without anyone opening it.
 * Existence only: the list holds the ids already, and an entry the user may not read is hidden by
 * the list itself.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const RECENT_ITEMS_LIMIT = 50;

/** The table of each entry type; both budget line types read `spend_items` of either nature. */
const TABLES: Record<string, { table: string; where?: string }> = {
  project: { table: 'portfolio_projects' },
  request: { table: 'portfolio_requests' },
  application: { table: 'applications' },
  asset: { table: 'assets' },
  interface: { table: 'interfaces' },
  connection: { table: 'connections' },
  contract: { table: 'contracts' },
  task: { table: 'tasks' },
  spend_item: { table: 'spend_items', where: naturesAnd(null, BUDGET_NATURES) },
  capex_item: { table: 'spend_items', where: naturesAnd(null, BUDGET_NATURES) },
  incident: { table: 'incidents' },
  location: { table: 'locations' },
  document: { table: 'documents' },
};

export type RecentItemRef = { type: string; id: string };

export async function existingRecentItems(
  manager: EntityManager,
  tenantId: string,
  items: readonly RecentItemRef[],
): Promise<{ existing: RecentItemRef[] }> {
  const byType = new Map<string, string[]>();
  for (const item of (items || []).slice(0, RECENT_ITEMS_LIMIT)) {
    const type = String(item?.type ?? '');
    const id = String(item?.id ?? '').toLowerCase();
    if (!TABLES[type] || !UUID_RE.test(id)) continue;
    byType.set(type, [...(byType.get(type) ?? []), id]);
  }
  if (byType.size === 0) return { existing: [] };
  const params: unknown[] = [tenantId];
  // One statement: a SELECT per type asked, each naming the tenant (RLS applies too).
  const selects = Array.from(byType.entries()).map(([type, ids]) => {
    params.push(ids);
    const { table, where } = TABLES[type];
    return `SELECT '${type}'::text AS type, id::text AS id FROM ${table} WHERE tenant_id = $1 AND id = ANY($${params.length}::uuid[])${where ?? ''}`;
  });
  const rows: RecentItemRef[] = await manager.query(selects.join(' UNION ALL '), params);
  return { existing: rows.map((row) => ({ type: row.type, id: row.id })) };
}
