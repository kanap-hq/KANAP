import { EntityManager } from 'typeorm';
import { BUDGET_NATURES, budgetLineReference, naturesAnd, type BudgetNature } from './budget-nature';
import { transactionDataAccessMode } from '../data-access/data-access';

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
/**
 * A line next to this one that a limited person cannot read (data-scoped access, spec §5.4
 * "Champ simple"): its reference alone, without id, type or year, so the screen shows no link.
 */
export type HiddenLineNeighbour = { id: null; reference: string; nature: null; hidden: true };
export type LineLineage = {
  predecessor: LinePredecessor | HiddenLineNeighbour | null;
  successor: LineSuccessor | (HiddenLineNeighbour & { from_year: null }) | null;
};

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

/** The reference of a lineage neighbour the person cannot read (`data_access_reference`), or null. */
async function hiddenNeighbour(
  manager: EntityManager,
  direction: 'line_predecessor' | 'line_successor',
  itemId: string,
): Promise<HiddenLineNeighbour | null> {
  const [row]: Array<{ reference: string | null }> = await manager.query(
    `SELECT data_access_reference($1, $2) AS reference`,
    [direction, itemId],
  );
  return row?.reference ? { id: null, reference: row.reference, nature: null, hidden: true } : null;
}

/**
 * Both directions for one line. Under a limited access, a neighbour the person cannot read shows
 * as its reference alone (`HiddenLineNeighbour`); an unscoped person reads both lines as before.
 */
export async function readLineLineage(manager: EntityManager, tenantId: string, itemId: string): Promise<LineLineage> {
  const [row]: Array<{ predecessor_id: string | null; id: string | null; item_number: number; nature: BudgetNature }> = await manager.query(
    `SELECT i.predecessor_id, p.id, p.item_number, p.nature
       FROM spend_items i
       LEFT JOIN spend_items p ON p.tenant_id = i.tenant_id AND p.id = i.predecessor_id${naturesAnd('p', BUDGET_NATURES)}
      WHERE i.tenant_id = $1 AND i.id = $2${naturesAnd('i', BUDGET_NATURES)}`,
    [tenantId, itemId],
  );
  const lineage: LineLineage = {
    predecessor: row?.id ? { id: row.id, reference: budgetLineReference(row.item_number), nature: row.nature } : null,
    successor: await readSuccessor(manager, tenantId, itemId),
  };
  if (row && (await transactionDataAccessMode(manager)) === 'limited') {
    if (!lineage.predecessor && row.predecessor_id) lineage.predecessor = await hiddenNeighbour(manager, 'line_predecessor', itemId);
    if (!lineage.successor) {
      const successor = await hiddenNeighbour(manager, 'line_successor', itemId);
      lineage.successor = successor ? { ...successor, from_year: null } : null;
    }
  }
  return lineage;
}
