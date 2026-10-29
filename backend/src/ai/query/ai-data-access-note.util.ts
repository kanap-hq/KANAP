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
