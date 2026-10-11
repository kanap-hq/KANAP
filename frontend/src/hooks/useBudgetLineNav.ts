import type { LineType } from '../constants/lineTypeUsage';
import type { ModuleItemNavParams, ModuleItemNavResult } from './useModuleItemNav';
import { useBudgetItemNav } from './useBudgetItemNav';
import { budgetLineDetailQuery } from './budgetItemDetailQuery';
import { BUDGET_NATURE_CONFIG } from '../pages/budget/natureConfig';

/** Mixed-list navigation uses BL neighbours; older contexts keep their nature's list. */
export function useBudgetLineNav(params: ModuleItemNavParams, nature: LineType, unified = false): ModuleItemNavResult {
  const config = BUDGET_NATURE_CONFIG[nature];
  return useBudgetItemNav(params, {
    nature,
    kind: unified ? 'budget' : nature,
    endpoint: unified ? '/budget-lines/summary/neighbors' : config.navEndpoint,
    queryKey: unified ? 'budget-lines-summary-neighbors' : config.navQueryKey,
    detailQuery: budgetLineDetailQuery,
  });
}
