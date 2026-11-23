import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { fetchItOpsSettings } from '../services/itOpsSettings';

/** Same text as the throw in `useAuth` (`AuthContext.tsx`). */
const AUTH_PROVIDER_REQUIRED = 'useAuth must be used within AuthProvider';

/**
 * The settings reader level. Component tests render this hook with no `AuthProvider`:
 * `useAuth` throws there. The app always mounts the provider (`main.tsx`), so a missing
 * one is not a person who lacks the right, and the fetch stays on for those tests.
 */
function useCanReadItOpsSettings(): boolean {
  try {
    return useAuth().hasLevel('settings', 'reader');
  } catch (error) {
    if (error instanceof Error && error.message === AUTH_PROVIDER_REQUIRED) return true;
    throw error;
  }
}

/** `enabled: false` reads the cached settings without fetching them (a screen that needs them only sometimes). */
export function useItOpsSettings(options: { enabled?: boolean } = {}) {
  const canRead = useCanReadItOpsSettings();
  return useQuery({
    queryKey: ['it-ops-settings'],
    queryFn: fetchItOpsSettings,
    staleTime: 5 * 60 * 1000,
    enabled: (options.enabled ?? true) && canRead,
  });
}

export default useItOpsSettings;

