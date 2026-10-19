/**
 * The "Recently viewed" lists live in the browser (`pages/workspace/hooks/useRecentlyViewed.ts`),
 * one per workspace and user. A record deleted, or that its own address no longer finds, leaves
 * them: the API client reports such answers (`recentIdsGone`, called from `api.ts`), and the open
 * lists reload on `RECENT_VIEWS_CHANGED`. Ids are UUIDs, unique across record types.
 */

export const RECENT_VIEWS_PREFIX = 'kanap-recent-views:';
export const RECENT_VIEWS_CHANGED = 'kanap-recent-views-changed';

/** The API addresses of the record types the lists hold (`RecentEntityType`). */
const RECORD_BASES = [
  'portfolio/projects',
  'portfolio/requests',
  'applications',
  'assets',
  'interfaces',
  'connections',
  'contracts',
  'tasks',
  'spend-items',
  'capex-items',
  'budget-lines',
  'incidents',
  'locations',
  'knowledge',
  'companies',
].join('|');
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
// The whole path: a child address (`/knowledge/:id/tasks/:taskId`) unlinks, it deletes nothing.
const ONE_RECORD = new RegExp(`^/(?:${RECORD_BASES})/(${UUID})$`, 'i');
const BULK = new RegExp(`^/(?:${RECORD_BASES})/bulk$`, 'i');

export type ApiAnswer = { method?: string; url?: string; status?: number; data?: unknown };

/** The records an API answer says are gone: deleted (one or in bulk), or not found at their own address. */
export function recentIdsGone({ method, url, status, data }: ApiAnswer): string[] {
  if (!url || status === undefined) return [];
  // Relative to the API (`/contracts/:id`), or absolute with its origin and `/api`.
  const path = url.split(/[?#]/)[0].replace(/^https?:\/\/[^/]+/i, '').replace(/^\/api(?=\/)/, '');
  const verb = (method || 'get').toLowerCase();
  if (verb === 'delete' && status >= 200 && status < 300) {
    const one = path.match(ONE_RECORD);
    if (one) return [one[1].toLowerCase()];
    if (BULK.test(path)) {
      const deleted = (data as { deleted?: unknown } | null | undefined)?.deleted;
      return Array.isArray(deleted) ? deleted.filter((id): id is string => typeof id === 'string') : [];
    }
    return [];
  }
  if (verb === 'get' && status === 404) {
    const one = path.match(ONE_RECORD);
    return one ? [one[1].toLowerCase()] : [];
  }
  return [];
}

/** Drops these records from every stored list of this browser, then tells the open lists. */
export function forgetRecentlyViewed(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const gone = new Set(ids.map((id) => id.toLowerCase()));
  try {
    const storage = window.localStorage;
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (key?.startsWith(RECENT_VIEWS_PREFIX)) keys.push(key);
    }
    let changed = false;
    for (const key of keys) {
      const items = JSON.parse(storage.getItem(key) || '[]') as Array<{ id?: string }>;
      if (!Array.isArray(items)) continue;
      const kept = items.filter((item) => !gone.has(String(item?.id ?? '').toLowerCase()));
      if (kept.length !== items.length) {
        storage.setItem(key, JSON.stringify(kept));
        changed = true;
      }
    }
    if (changed) window.dispatchEvent(new Event(RECENT_VIEWS_CHANGED));
  } catch {
    // No storage, or an unreadable list: nothing to forget.
  }
}
