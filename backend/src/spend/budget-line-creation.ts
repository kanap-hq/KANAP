import { EntityManager } from 'typeorm';
import { isLimitedTransaction } from '../data-access/line-write-checks';
import { readSuccessor } from './budget-line-lineage';

/**
 * A budget line created from the screen's draft (lot L3a): the page writes it complete, with
 * `POST /budget-lines` (company, account, required dimensions: `item-write.util.ts`), once its title
 * and its starred fields are given. The route hands its creator the creation token of
 * `common/creation`, which opens the preflight and "Cancel" (`GET` and `DELETE :id/creation`) for
 * the creator, on that line only, while nobody else has written on it and no line continues it
 * (403 `CREATION_CANCEL_EXPIRED` otherwise).
 */

/**
 * The family of the creation token of a budget line (`common/creation/creation-routes.ts`): its table
 * in the history inventory. The routes check the token, and "Cancel"
 * (`BudgetLinesService.cancelCreation`) checks it again itself before its delete window.
 */
export const BUDGET_LINE_CREATION = 'spend_items';

/**
 * Whether another line continues this one (`spend_items.predecessor_id`, a type change): "Cancel"
 * stops then, as its delete would unlink it. A successor the person cannot read counts too
 * (`data_access_reference`, which names it without reading it).
 */
export async function hasSuccessorLine(manager: EntityManager, tenantId: string, lineId: string): Promise<boolean> {
  if (await readSuccessor(manager, tenantId, lineId)) return true;
  if (!(await isLimitedTransaction(manager))) return false;
  const [row]: Array<{ reference: string | null }> = await manager.query(`SELECT data_access_reference('line_successor', $1) AS reference`, [lineId]);
  return !!row?.reference;
}
