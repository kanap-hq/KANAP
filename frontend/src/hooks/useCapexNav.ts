import { ModuleItemNavParams, ModuleItemNavResult } from './useModuleItemNav';
import { useBudgetItemNav } from './useBudgetItemNav';
import { capexDetailQuery } from './budgetItemDetailQuery';

export type CapexNavParams = ModuleItemNavParams;

/**
 * CAPEX item navigation (previous / next in the list, `summary/neighbors`, the lines next door
 * prefetched). `id` is the route id or reference; prevId/nextId are CPX-N references.
 */
export function useCapexNav(params: CapexNavParams): ModuleItemNavResult {
  return useBudgetItemNav(params, {
    kind: 'capex',
    endpoint: '/capex-items/summary/neighbors',
    queryKey: 'capex-items-summary-neighbors',
    detailQuery: capexDetailQuery,
  });
}
