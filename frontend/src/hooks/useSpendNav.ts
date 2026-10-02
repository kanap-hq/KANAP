import { ModuleItemNavParams, ModuleItemNavResult } from './useModuleItemNav';
import { useBudgetItemNav } from './useBudgetItemNav';
import { spendDetailQuery } from './budgetItemDetailQuery';

export type SpendNavParams = ModuleItemNavParams;

/**
 * Spend/OPEX item navigation (previous / next in the list, `summary/neighbors`). `id` is the route
 * id; prevId/nextId are OPX-N references, so the workspace navigates straight to the friendly URL.
 */
export function useSpendNav(params: SpendNavParams): ModuleItemNavResult {
  return useBudgetItemNav(params, {
    kind: 'opex',
    endpoint: '/spend-items/summary/neighbors',
    queryKey: 'spend-items-summary-neighbors',
    detailQuery: spendDetailQuery,
  });
}
