import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { fetchItOpsCatalogLabels, fetchItOpsSettings } from '../services/itOpsSettings';

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

/**
 * `enabled: false` reads the cached settings without fetching them (a screen that needs them only sometimes).
 * `labelsWithoutRight`: a person without the settings right reads the catalog labels instead (every
 * signed-in member may), for the display projection; the settings editors never pass it.
 */
export function useItOpsSettings(options: { enabled?: boolean; labelsWithoutRight?: boolean } = {}) {
  const canRead = useCanReadItOpsSettings();
  const labelsOnly = !canRead && !!options.labelsWithoutRight;
  return useQuery({
    queryKey: labelsOnly ? ['it-ops-catalog-labels'] : ['it-ops-settings'],
    queryFn: labelsOnly ? fetchItOpsCatalogLabels : fetchItOpsSettings,
    staleTime: 5 * 60 * 1000,
    enabled: (options.enabled ?? true) && (canRead || labelsOnly),
  });
}

export default useItOpsSettings;

