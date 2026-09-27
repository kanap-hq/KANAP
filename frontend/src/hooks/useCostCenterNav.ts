import { useModuleItemNav, ModuleItemNavParams, ModuleItemNavResult } from './useModuleItemNav';

/** Prev/next through the cost centers list, in the list's sort, filters and status scope. */
export function useCostCenterNav(params: ModuleItemNavParams): ModuleItemNavResult {
  return useModuleItemNav(params, {
    endpoint: '/cost-centers/ids',
    queryKey: 'cost-centers-ids',
    defaultSort: 'path:ASC',
  });
}
