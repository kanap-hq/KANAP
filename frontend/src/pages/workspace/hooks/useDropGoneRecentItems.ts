import { useQuery } from '@tanstack/react-query';
import api from '../../../api';
import { forgetRecentlyViewed } from '../../../lib/recentViews';
import type { RecentItem } from './useRecentlyViewed';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Records found in this session: not asked about again (a delete drops them through `api.ts`). */
const foundAlive = new Set<string>();

/**
 * Checks the shown "Recently viewed" entries in one call and drops those whose record no longer
 * exists: deleted with another record (a contract's tasks) or elsewhere, so no entry opens on a
 * missing record. A failed check changes nothing; a 4xx is not asked again (`retryQuery`).
 */
export function useDropGoneRecentItems(items: readonly RecentItem[]) {
  const checked = items
    .filter((item) => UUID_RE.test(item.id) && !foundAlive.has(item.id.toLowerCase()))
    .map(({ type, id }) => ({ type, id }));
  const key = checked.map((item) => `${item.type}:${item.id.toLowerCase()}`).sort();
  useQuery({
    queryKey: ['recent-items-existing', key],
    enabled: checked.length > 0,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      let existing: unknown;
      try {
        existing = (await api.post('/dashboard/recent-items/existing', { items: checked }))?.data?.existing;
      } catch {
        return [];
      }
      // No usable answer: the list stays as it is.
      if (!Array.isArray(existing)) return [];
      const alive = new Set(existing.map((item: { id?: unknown }) => String(item?.id ?? '').toLowerCase()));
      alive.forEach((id) => foundAlive.add(id));
      const gone = checked.filter((item) => !alive.has(item.id.toLowerCase())).map((item) => item.id);
      forgetRecentlyViewed(gone);
      return gone;
    },
  });
}
