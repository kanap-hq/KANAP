import { EntityManager } from 'typeorm';
import { BUDGET_NATURES, budgetLineReference, naturesAnd, type BudgetNature } from './budget-nature';

/**
 * The lines a budget line continues and is continued by (lot M, migration 1854000000000): a change
 * of type from a later year than the line's first one ends the line and creates a line of the
 * other type for the years after, which names it (`spend_items.predecessor_id`). The workspace
 * shows both directions ("Follows BL-x", "Replaced by BL-y from N"). Each read names the natures:
 * the other line may be of either type.
 */

export type LinePredecessor = { id: string; reference: string | null; nature: BudgetNature };
/** `from_year`: the year of the successor's start, the year the change took effect. */
export type LineSuccessor = LinePredecessor & { from_year: number | null };
export type LineLineage = { predecessor: LinePredecessor | null; successor: LineSuccessor | null };

/** The line that continues `itemId`, of either nature; null when none (one at most, unique index). */
export async function readSuccessor(manager: EntityManager, tenantId: string, itemId: string): Promise<LineSuccessor | null> {
  const [row]: Array<{ id: string; item_number: number; nature: BudgetNature; from_year: number | null }> = await manager.query(
    `SELECT s.id, s.item_number, s.nature, EXTRACT(YEAR FROM s.effective_start)::int AS from_year
       FROM spend_items s
      WHERE s.tenant_id = $1 AND s.predecessor_id = $2${naturesAnd('s', BUDGET_NATURES)}`,
    [tenantId, itemId],
  );
  return row ? { id: row.id, reference: budgetLineReference(row.item_number), nature: row.nature, from_year: row.from_year } : null;
}

/** Both directions for one line. */
export async function readLineLineage(manager: EntityManager, tenantId: string, itemId: string): Promise<LineLineage> {
  const [row]: Array<{ id: string; item_number: number; nature: BudgetNature }> = await manager.query(
    `SELECT p.id, p.item_number, p.nature
       FROM spend_items i
       JOIN spend_items p ON p.tenant_id = i.tenant_id AND p.id = i.predecessor_id${naturesAnd('p', BUDGET_NATURES)}
      WHERE i.tenant_id = $1 AND i.id = $2${naturesAnd('i', BUDGET_NATURES)}`,
    [tenantId, itemId],
  );
  return {
    predecessor: row ? { id: row.id, reference: budgetLineReference(row.item_number), nature: row.nature } : null,
    successor: await readSuccessor(manager, tenantId, itemId),
  };
}
