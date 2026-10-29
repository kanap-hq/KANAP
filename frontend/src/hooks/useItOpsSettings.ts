import { useQuery } from '@tanstack/react-query';
import { fetchItOpsSettings } from '../services/itOpsSettings';

/** `enabled: false` reads the cached settings without fetching them (a screen that needs them only sometimes). */
export function useItOpsSettings(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: ['it-ops-settings'],
    queryFn: fetchItOpsSettings,
    staleTime: 5 * 60 * 1000,
    enabled: options.enabled ?? true,
  });
}

export default useItOpsSettings;

