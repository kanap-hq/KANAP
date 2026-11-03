import { useModuleItemNav, ModuleItemNavParams, ModuleItemNavResult } from './useModuleItemNav';

export type BusinessProcessNavParams = ModuleItemNavParams;

/**
 * Business process item navigation hook.
 * Thin wrapper around useModuleItemNav for backward compatibility.
 */
export function useBusinessProcessNav(params: BusinessProcessNavParams): ModuleItemNavResult {
  return useModuleItemNav(params, {
    endpoint: '/business-processes/ids',
    queryKey: 'business-processes-ids',
    defaultSort: 'path:ASC',
  });
}

