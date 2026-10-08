import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useTenant } from '../tenant/TenantContext';

type Scope = 'my' | 'team' | 'all';

// A user with no stored choice starts on every item they may see: a new user is rarely involved in
// anything yet, so "My ..." used to open on an empty list. The API still limits "All" to their rights.
const DEFAULT_SCOPE: Scope = 'all';

function getStorageKey(tenantSlug: string, userId: string, pageKey: string): string {
  return `kanap-grid-scope:${tenantSlug}:${userId}:${pageKey}`;
}

/**
 * Persists the grid scope filter preference (my / team / all) per tenant and user.
 *
 * Priority: URL param > localStorage > default ('all'). Only an explicit choice is stored, so a user
 * who picked "My ..." keeps it.
 */
export function useGridScopePreference(
  pageKey: string,
  urlScope: string | null,
): [Scope, (scope: Scope) => void] {
  const { profile } = useAuth();
  const { tenantSlug } = useTenant();

  const userId = profile?.id ?? 'anon';
  const tenantId = tenantSlug ?? 'unknown';
  const storageKey = getStorageKey(tenantId, userId, pageKey);

  const readStored = useCallback((): Scope | null => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw === 'my' || raw === 'team' || raw === 'all') return raw;
    } catch { /* ignore */ }
    return null;
  }, [storageKey]);

  const [scope, setScopeState] = useState<Scope>(() => {
    if (urlScope === 'my' || urlScope === 'team' || urlScope === 'all') return urlScope;
    return readStored() ?? DEFAULT_SCOPE;
  });

  // Follow the URL when it carries a scope (deep links from the home tiles), otherwise reload the
  // stored preference when tenant/user changes. Running this on mount without the URL check used to
  // overwrite the URL scope with the stored one, so `?taskScope=my` never applied.
  useEffect(() => {
    if (urlScope === 'my' || urlScope === 'team' || urlScope === 'all') {
      setScopeState(urlScope);
      return;
    }
    setScopeState(readStored() ?? DEFAULT_SCOPE);
  }, [storageKey, urlScope, readStored]);

  const setScope = useCallback(
    (next: Scope) => {
      setScopeState(next);
      try {
        localStorage.setItem(storageKey, next);
      } catch { /* ignore */ }
    },
    [storageKey],
  );

  return [scope, setScope];
}
