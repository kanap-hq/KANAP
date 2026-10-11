import { ModuleItemNavParams, ModuleItemNavResult } from './useModuleItemNav';
import { useBudgetItemNav } from './useBudgetItemNav';
import { capexDetailQuery, budgetNeighborDetailQuery } from './budgetItemDetailQuery';

export type CapexNavParams = ModuleItemNavParams;

/**
 * CAPEX item navigation (previous / next in the list, `summary/neighbors`, the lines next door
 * prefetched). `id` is the route id or reference; prevId/nextId are CPX-N references.
 */
export function useCapexNav(params: CapexNavParams, unified = false): ModuleItemNavResult {
  return useBudgetItemNav(params, {
    nature: 'capex',
    kind: unified ? 'budget' : 'capex',
    endpoint: unified ? '/budget-lines/summary/neighbors' : '/capex-items/summary/neighbors',
    queryKey: unified ? 'budget-lines-summary-neighbors' : 'capex-items-summary-neighbors',
    detailQuery: unified ? budgetNeighborDetailQuery : capexDetailQuery,
  });
}
