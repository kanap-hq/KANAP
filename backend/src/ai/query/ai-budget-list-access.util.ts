import { budgetListAccess, type BudgetListAccess } from '../../spend/budget-list/budget-list.runtime';
import type { AiPolicyService } from '../ai-policy.service';
import type { AiExecutionContextWithManager } from '../ai.types';

/**
 * What the person may read besides the budget lines, in the shape the screens pass it to the
 * list engine (`budgetListAccess` of the request's rights): built from the person's rights as the
 * policy reads them (`effectiveAccess`). Read once per tool call and passed to every engine call
 * of it. Without a policy (an executor built by hand), nothing more, as before.
 */
export async function aiBudgetListAccess(
  policy: Pick<AiPolicyService, 'effectiveAccess'> | undefined,
  context: AiExecutionContextWithManager,
): Promise<BudgetListAccess> {
  return budgetListAccess(policy ? await policy.effectiveAccess(context, context.manager) : null);
}
