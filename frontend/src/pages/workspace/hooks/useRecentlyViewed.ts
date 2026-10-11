import { useCallback, useState, useEffect } from 'react';
import { useAuth } from '../../../auth/AuthContext';
import { useTenant } from '../../../tenant/TenantContext';

const MAX_ITEMS = 10;
const isBudgetLine = (type: RecentEntityType) => type === 'spend_item' || type === 'capex_item';

export type RecentEntityType =
  | 'project'
  | 'request'
  | 'application'
  | 'asset'
  | 'interface'
  | 'connection'
  | 'contract'
  | 'task'
  | 'spend_item'
  | 'capex_item'
  | 'incident'
  | 'location'
  | 'document';

export interface RecentItem {
  type: RecentEntityType;
  id: string;
  label: string;
  /** Business reference shown in mono before the label (T-4, APP-11, DOC-12). */
  ref?: string;
  viewedAt: number;
}

function getStorageKey(tenantSlug: string, userId: string): string {
  return `kanap-recent-views:${tenantSlug}:${userId}`;
}

function loadFromStorage(storageKey: string): RecentItem[] {
  try {
    const stored = localStorage.getItem(storageKey);
    const parsed = stored ? (JSON.parse(stored) as RecentItem[]) : [];
    return parsed.filter((item, index) => !parsed.slice(0, index).some((previous) =>
      previous.id === item.id && (previous.type === item.type || (isBudgetLine(previous.type) && isBudgetLine(item.type)))
    )).slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

function saveToStorage(storageKey: string, items: RecentItem[]): void {
  try {
    localStorage.setItem(storageKey, JSON.stringify(items));
  } catch {
    // localStorage full or unavailable - ignore
  }
}

export function useRecentlyViewed() {
  const { profile } = useAuth();
  const { tenantSlug } = useTenant();

  const userId = profile?.id ?? 'anon';
  const tenantId = tenantSlug ?? 'unknown';
  const storageKey = getStorageKey(tenantId, userId);

  const [items, setItems] = useState<RecentItem[]>(() => loadFromStorage(storageKey));

  // Reload items when tenant/user changes
  useEffect(() => {
    setItems(loadFromStorage(storageKey));
  }, [storageKey]);

  const addToRecent = useCallback(
    (type: RecentEntityType, id: string, label: string, ref?: string) => {
      setItems((prev) => {
        // Remove existing entry for the same item
        const filtered = prev.filter((r) => !(r.id === id && (r.type === type || (isBudgetLine(r.type) && isBudgetLine(type)))));
        // Add new entry at the beginning
        const entry: RecentItem = { type, id, label, viewedAt: Date.now(), ...(ref ? { ref } : {}) };
        const updated = [entry, ...filtered].slice(
          0,
          MAX_ITEMS,
        );
        saveToStorage(storageKey, updated);
        return updated;
      });
    },
    [storageKey],
  );

  const clearRecent = useCallback(() => {
    localStorage.removeItem(storageKey);
    setItems([]);
  }, [storageKey]);

  return { items, addToRecent, clearRecent };
}

// Mapping from entity type to route, permission resource, icon and i18n label key (common namespace)
export const ENTITY_TYPE_CONFIG: Record<
  RecentEntityType,
  { route: (id: string) => string; resource: string; icon: string; labelKey: string }
> = {
  project: {
    route: (id) => `/portfolio/projects/${id}`,
    resource: 'portfolio_projects',
    icon: 'FolderOpen',
    labelKey: 'dashboard.tiles.entityTypes.project',
  },
  request: {
    route: (id) => `/portfolio/requests/${id}`,
    resource: 'portfolio_requests',
    icon: 'Inbox',
    labelKey: 'dashboard.tiles.entityTypes.request',
  },
  application: {
    route: (id) => `/it/applications/${id}`,
    resource: 'applications',
    icon: 'Apps',
    labelKey: 'dashboard.tiles.entityTypes.application',
  },
  asset: {
    route: (id) => `/it/assets/${id}`,
    resource: 'infrastructure',
    icon: 'Storage',
    labelKey: 'dashboard.tiles.entityTypes.asset',
  },
  interface: {
    route: (id) => `/it/interfaces/${id}`,
    resource: 'applications',
    icon: 'SwapHoriz',
    labelKey: 'dashboard.tiles.entityTypes.interface',
  },
  connection: {
    route: (id) => `/it/connections/${id}`,
    resource: 'infrastructure',
    icon: 'Cable',
    labelKey: 'dashboard.tiles.entityTypes.connection',
  },
  contract: {
    route: (id) => `/ops/contracts/${id}`,
    resource: 'contracts',
    icon: 'Description',
    labelKey: 'dashboard.tiles.entityTypes.contract',
  },
  task: {
    route: (id) => `/portfolio/tasks/${id}`,
    resource: 'tasks',
    icon: 'Task',
    labelKey: 'dashboard.tiles.entityTypes.task',
  },
  spend_item: {
    route: (id) => `/ops/opex/${id}`,
    resource: 'budget',
    icon: 'Receipt',
    labelKey: 'dashboard.tiles.entityTypes.opexItem',
  },
  capex_item: {
    route: (id) => `/ops/capex/${id}`,
    resource: 'budget',
    icon: 'AccountBalance',
    labelKey: 'dashboard.tiles.entityTypes.capexItem',
  },
  incident: {
    route: (id) => `/it/incidents/${id}/overview`,
    resource: 'incidents',
    icon: 'ReportProblem',
    labelKey: 'dashboard.tiles.entityTypes.incident',
  },
  location: {
    route: (id) => `/it/locations/${id}`,
    resource: 'infrastructure',
    icon: 'Place',
    labelKey: 'dashboard.tiles.entityTypes.location',
  },
  document: {
    route: (id) => `/knowledge/${id}`,
    resource: 'knowledge',
    icon: 'Article',
    labelKey: 'dashboard.tiles.entityTypes.document',
  },
};
