import { EntityManager } from 'typeorm';
import { lockBudgetLine as lockLine } from '../spend/budget-locks';
import { natureAnd, type BudgetNature } from '../spend/budget-nature';

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
// `nature`: an OPEX link names an OPEX line of `spend_items` (`spend/budget-nature.ts`).
const TABLES: Record<'opex' | 'capex', { table: string; itemFk: string; items: string; nature?: BudgetNature }> = {
  opex: { table: 'portfolio_project_opex', itemFk: 'opex_id', items: 'spend_items', nature: 'opex' },
  capex: { table: 'portfolio_project_capex', itemFk: 'capex_id', items: 'capex_items' },
};

export type ProjectBudgetLinkKind = keyof typeof TABLES;

/** The refusal of a project's or request's OPEX links naming no OPEX line of the tenant (the applications' message). */
export const OPEX_ITEMS_NOT_FOUND = 'One or more OPEX items were not found.';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The ids among `ids` (lower case) that name a line of the kind in the tenant: an OPEX link (of a
 * project or a request) names an OPEX line only, never a line of another nature. Not a UUID: not
 * found.
 */
export async function budgetLineIdsOfKind(manager: EntityManager, kind: ProjectBudgetLinkKind, tenantId: string, ids: Iterable<string>): Promise<Set<string>> {
  const list = Array.from(new Set(Array.from(ids).filter((id) => !!id && UUID_RE.test(id)).map((id) => id.toLowerCase())));
  if (list.length === 0) return new Set();
  const t = TABLES[kind];
  const rows: Array<{ id: string }> = await manager.query(
    `SELECT id FROM ${t.items} WHERE tenant_id = $1 AND id = ANY($2::uuid[])${natureAnd(null, t.nature)}`,
    [tenantId, list],
  );
  return new Set(rows.map((row) => row.id));
}

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

/** Inserts the links, skipping one already stored, and one whose line has another nature than the kind's. */
export async function insertProjectBudgetLinks(
  manager: EntityManager,
  kind: ProjectBudgetLinkKind,
  tenantId: string,
  links: Array<{ projectId: string; itemId: string }>,
): Promise<void> {
  if (links.length === 0) return;
  const t = TABLES[kind];
  const ofNature = t.nature
    ? `\n     WHERE EXISTS (SELECT 1 FROM ${t.items} i WHERE i.tenant_id = $1 AND i.id = l.item_id${natureAnd('i', t.nature)})`
    : '';
  await manager.query(
    `INSERT INTO ${t.table} (tenant_id, project_id, ${t.itemFk})
     SELECT $1, l.project_id, l.item_id FROM unnest($2::uuid[], $3::uuid[]) AS l(project_id, item_id)${ofNature}
     ON CONFLICT (project_id, ${t.itemFk}) DO NOTHING`,
    [tenantId, links.map((l) => l.projectId), links.map((l) => l.itemId)],
  );
}
