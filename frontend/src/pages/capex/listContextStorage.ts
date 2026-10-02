export type CapexListContextSnapshot = {
  sort: string;
  q: string;
  filters: string;
  /**
   * Status scope of the list the user navigated from. The grid holds it in local state,
   * so without persisting it here the item page cannot tell prev/next which scope to walk
   * and the item page falls back to the endpoint default (enabled only).
   */
  statusScope?: string;
  /**
   * Filters too long for a URL, saved as a list context: `filters` is then empty and this id
   * stands for them (lib/listContext.ts).
   */
  ctx?: string;
};

const STORAGE_KEY = 'capex-list-context';

function isCapexListContextSnapshot(value: any): value is CapexListContextSnapshot {
  return value && typeof value === 'object'
    && typeof value.sort === 'string'
    && typeof value.q === 'string'
    && typeof value.filters === 'string'
    // Optional: snapshots written before this field existed stay valid.
    && (value.statusScope === undefined || typeof value.statusScope === 'string')
    && (value.ctx === undefined || typeof value.ctx === 'string');
}

export function readStoredCapexListContext(): CapexListContextSnapshot | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!isCapexListContextSnapshot(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredCapexListContext(snapshot: CapexListContextSnapshot): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore storage errors (quota, disabled storage, etc.)
  }
}
