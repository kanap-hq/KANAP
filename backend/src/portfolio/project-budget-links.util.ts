import { EntityManager } from 'typeorm';
import { lockBudgetLine as lockLine } from '../spend/budget-locks';

/**
 * Links between projects and OPEX / CAPEX lines (portfolio_project_opex,
 * portfolio_project_capex), unique on (project_id, line). Both sides replace
 * their whole set: the line's relations panel, the project's budget tab.
 *
 * Every replacement first locks its owner row (the line, or the project), so
 * two saves of the same set take turns and the last one wins, and inserts
 * with `ON CONFLICT DO NOTHING`, so a link the other side committed meanwhile
 * is kept instead of failing the save with a unique violation (plan
 * planning/perf-scale, lot 3A, Annexe A #15).
 */
const TABLES = {
  opex: { table: 'portfolio_project_opex', itemFk: 'opex_id' },
  capex: { table: 'portfolio_project_capex', itemFk: 'capex_id' },
} as const;

export type ProjectBudgetLinkKind = keyof typeof TABLES;

/** Locks the line (FOR NO KEY UPDATE); false when it is gone. The budget lock order: `spend/budget-locks.ts`. */
export function lockBudgetLine(manager: EntityManager, kind: ProjectBudgetLinkKind, tenantId: string, itemId: string): Promise<boolean> {
  return lockLine(manager, kind, tenantId, itemId);
}

/** Locks the project (FOR NO KEY UPDATE); false when it is gone. */
export async function lockProject(manager: EntityManager, tenantId: string, projectId: string): Promise<boolean> {
  const rows = await manager.query(
    `SELECT 1 FROM portfolio_projects WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`,
    [tenantId, projectId],
  );
  return rows.length > 0;
}

/** Inserts the links, skipping one already stored. */
export async function insertProjectBudgetLinks(
  manager: EntityManager,
  kind: ProjectBudgetLinkKind,
  tenantId: string,
  links: Array<{ projectId: string; itemId: string }>,
): Promise<void> {
  if (links.length === 0) return;
  const t = TABLES[kind];
  await manager.query(
    `INSERT INTO ${t.table} (tenant_id, project_id, ${t.itemFk})
     SELECT $1, l.project_id, l.item_id FROM unnest($2::uuid[], $3::uuid[]) AS l(project_id, item_id)
     ON CONFLICT (project_id, ${t.itemFk}) DO NOTHING`,
    [tenantId, links.map((l) => l.projectId), links.map((l) => l.itemId)],
  );
}
