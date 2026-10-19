import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forgetRecentlyViewed, recentIdsGone, RECENT_VIEWS_CHANGED } from './recentViews';
import { retryQuery } from './queryClient';

const A = '0b8e1c52-7a51-4c2e-9d3f-2f1f6a0c1a11';
const B = '5d3c7b21-1f0a-4e6b-8c2d-7e9a0b1c2d33';

function stubStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    key: (index: number) => Array.from(values.keys())[index] ?? null,
    get length() { return values.size; },
  });
  return values;
}

describe('recentIdsGone', () => {
  it('names the record a delete removed', () => {
    expect(recentIdsGone({ method: 'delete', url: `/contracts/${A}`, status: 200 })).toEqual([A]);
    expect(recentIdsGone({ method: 'delete', url: `/companies/${A}`, status: 200 })).toEqual([A]);
    expect(recentIdsGone({ method: 'delete', url: `/portfolio/requests/${A}?x=1`, status: 204 })).toEqual([A]);
    expect(recentIdsGone({ method: 'delete', url: `http://localhost:8080/api/assets/${A}`, status: 200 })).toEqual([A]);
  });

  it('names the records a bulk delete removed, not the ones it refused', () => {
    expect(recentIdsGone({ method: 'delete', url: '/contracts/bulk', status: 200, data: { deleted: [A], failed: [{ id: B }] } })).toEqual([A]);
    expect(recentIdsGone({ method: 'delete', url: '/companies/bulk', status: 200, data: { deleted: [A, B] } })).toEqual([A, B]);
  });

  it('names a record its own address no longer finds', () => {
    expect(recentIdsGone({ method: 'get', url: `/contracts/${A}`, status: 404 })).toEqual([A]);
    expect(recentIdsGone({ method: 'get', url: `/knowledge/${A}`, status: 404 })).toEqual([A]);
    expect(recentIdsGone({ method: 'get', url: `/companies/${A}`, status: 404 })).toEqual([A]);
  });

  it('leaves the rest alone', () => {
    // A link removed, a dependency on another project, a child address, another answer.
    expect(recentIdsGone({ method: 'delete', url: `/contracts/${A}/links/${B}`, status: 200 })).toEqual([]);
    expect(recentIdsGone({ method: 'delete', url: `/knowledge/${A}/tasks/${B}`, status: 200 })).toEqual([]);
    expect(recentIdsGone({ method: 'delete', url: `/document-tasks/${B}`, status: 200 })).toEqual([]);
    expect(recentIdsGone({ method: 'delete', url: `/portfolio/projects/${A}/dependencies/project/${B}`, status: 200 })).toEqual([]);
    expect(recentIdsGone({ method: 'get', url: `/contracts/${A}/tasks`, status: 404 })).toEqual([]);
    expect(recentIdsGone({ method: 'get', url: `/contracts/${A}`, status: 403 })).toEqual([]);
    expect(recentIdsGone({ method: 'get', url: `/suppliers/${A}`, status: 404 })).toEqual([]);
    expect(recentIdsGone({ method: 'patch', url: `/contracts/${A}`, status: 404 })).toEqual([]);
  });
});

describe('forgetRecentlyViewed', () => {
  beforeEach(() => vi.unstubAllGlobals());

  it('drops the entries of every stored list and tells the open lists', () => {
    const values = stubStorage({
      'kanap-recent-views:fromage:u1': JSON.stringify([{ type: 'contract', id: A, label: 'Gone', viewedAt: 2 }, { type: 'asset', id: B, label: 'Kept', viewedAt: 1 }]),
      'kanap-recent-views:fromage:u2': JSON.stringify([{ type: 'contract', id: A, label: 'Gone', viewedAt: 2 }]),
      'other-key': 'untouched',
    });
    const heard = vi.fn();
    window.addEventListener(RECENT_VIEWS_CHANGED, heard);
    forgetRecentlyViewed([A]);
    window.removeEventListener(RECENT_VIEWS_CHANGED, heard);
    expect(JSON.parse(values.get('kanap-recent-views:fromage:u1')!).map((i: { id: string }) => i.id)).toEqual([B]);
    expect(JSON.parse(values.get('kanap-recent-views:fromage:u2')!)).toEqual([]);
    expect(values.get('other-key')).toBe('untouched');
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('does nothing without storage', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => forgetRecentlyViewed([A])).not.toThrow();
  });
});

describe('retryQuery', () => {
  it('asks again after a network or server failure, not after a refusal or a missing record', () => {
    expect(retryQuery(0, new Error('Network Error'))).toBe(true);
    expect(retryQuery(1, { response: { status: 503 } })).toBe(true);
    expect(retryQuery(2, { response: { status: 503 } })).toBe(false);
    expect(retryQuery(0, { response: { status: 404 } })).toBe(false);
    expect(retryQuery(0, { response: { status: 403 } })).toBe(false);
    expect(retryQuery(0, { response: { status: 429 } })).toBe(true);
  });
});
