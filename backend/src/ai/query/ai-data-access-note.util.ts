import { isLimitedTransaction } from '../../data-access/line-write-checks';
import type { AiExecutionContextWithManager } from '../ai.types';
import type { AiQueryEntityType } from './ai-filter.types';

/**
 * The families data-scoped access narrows: budget lines, contracts, and the tasks of both; the
 * chargeback reports, computed from the budget lines the person reads.
 */
const DATA_ACCESS_SCOPED_FAMILIES = new Set<AiQueryEntityType>(['budget_lines', 'contracts', 'tasks', 'chargeback', 'chargeback_lines']);

export const DATA_ACCESS_LIMITED_NOTE =
  'This person has limited data access: the records, counts and totals cover only what their access lets them see, '
  + 'not the whole workspace. Say "within your access" with any count or total from this result, and never call it the workspace total '
  + 'or say it equals the total of the workspace: the workspace total is not readable here.';

/**
 * Whether a list or an aggregate of the family is narrowed by the person's data access (a
 * limited transaction, `data-access.ts`): said in the result, so the answer never presents a
 * visible total as the workspace's.
 */
export async function aiDataAccessNote(
  context: AiExecutionContextWithManager,
  entityType: AiQueryEntityType,
): Promise<{ data_access: 'limited'; data_access_note: string } | null> {
  if (!DATA_ACCESS_SCOPED_FAMILIES.has(entityType)) return null;
  if (!(await isLimitedTransaction(context.manager))) return null;
  return { data_access: 'limited', data_access_note: DATA_ACCESS_LIMITED_NOTE };
}

/**
 * The families a person in limited access reads whole, as their screen, whose detail counts budget
 * lines through the lines' access rules: Master data › Cost centers (the lines that use a node).
 * Their lists and aggregates count records, never narrowed: only the detail says so.
 */
const DATA_ACCESS_SCOPED_COUNT_FAMILIES = new Set<AiQueryEntityType>(['cost_centers']);

export const DATA_ACCESS_LIMITED_COUNTS_NOTE =
  'This person has limited data access: they read every record of this family, as the screen, but the budget line counts '
  + '(opex_count, capex_count) cover only the lines their access lets them see. Say "within your access" with those counts, '
  + 'and never call them the workspace total.';

/** Whether the line counts of a record's detail are narrowed by the person's data access, said in the result. */
export async function aiDataAccessCountsNote(
  context: AiExecutionContextWithManager,
  entityType: AiQueryEntityType,
): Promise<{ data_access: 'limited'; data_access_note: string } | null> {
  if (!DATA_ACCESS_SCOPED_COUNT_FAMILIES.has(entityType)) return null;
  if (!(await isLimitedTransaction(context.manager))) return null;
  return { data_access: 'limited', data_access_note: DATA_ACCESS_LIMITED_COUNTS_NOTE };
}
