import { ModuleItemNavParams, ModuleItemNavResult } from './useModuleItemNav';
import { useBudgetItemIdsNav, useBudgetItemNav } from './useBudgetItemNav';
import { capexDetailQuery } from './budgetItemDetailQuery';
import { CAPEX_LIST_ON_ENGINE } from '../pages/capex/capexListEngine';

export type CapexNavParams = ModuleItemNavParams;

/**
 * CAPEX item navigation. `id` is the route id or reference; prevId/nextId are CPX-N references. On
 * the SQL list engine (CAPEX_LIST_ON_ENGINE) the server answers where the line stands
 * (`summary/neighbors`, previous and next prefetched); until then from the list's ordered ids
 * (`summary/ids`, one request per list state): the in-memory list would build every line again
 * for each step and each prefetch.
 */
export function useCapexNav(params: CapexNavParams): ModuleItemNavResult {
  const onEngine = CAPEX_LIST_ON_ENGINE;
  const enabled = params.enabled ?? true;
  const fromNeighbors = useBudgetItemNav({ ...params, enabled: enabled && onEngine }, {
    kind: 'capex',
    endpoint: '/capex-items/summary/neighbors',
    queryKey: 'capex-items-summary-neighbors',
    detailQuery: capexDetailQuery,
  });
  const fromIds = useBudgetItemIdsNav({ ...params, enabled: enabled && !onEngine }, {
    kind: 'capex',
    endpoint: '/capex-items/summary/ids',
    queryKey: 'capex-items-summary-ids',
  });
  return onEngine ? fromNeighbors : fromIds;
}
