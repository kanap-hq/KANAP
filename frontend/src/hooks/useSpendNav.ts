import { ModuleItemNavParams, ModuleItemNavResult } from './useModuleItemNav';
import { useBudgetItemNav } from './useBudgetItemNav';
import { spendDetailQuery, budgetNeighborDetailQuery } from './budgetItemDetailQuery';

export type SpendNavParams = ModuleItemNavParams;

/**
 * Spend/OPEX item navigation (previous / next in the list, `summary/neighbors`). `id` is the route
 * id; prevId/nextId are OPX-N references, so the workspace navigates straight to the friendly URL.
 */
export function useSpendNav(params: SpendNavParams, unified = false): ModuleItemNavResult {
  return useBudgetItemNav(params, {
    nature: 'opex',
    kind: unified ? 'budget' : 'opex',
    endpoint: unified ? '/budget-lines/summary/neighbors' : '/spend-items/summary/neighbors',
    queryKey: unified ? 'budget-lines-summary-neighbors' : 'spend-items-summary-neighbors',
    detailQuery: unified ? budgetNeighborDetailQuery : spendDetailQuery,
  });
}
