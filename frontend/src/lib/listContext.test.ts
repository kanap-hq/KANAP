import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));

import api from '../api';
import {
  cachedListContext,
  cachedListContextId,
  carryListFilters,
  compactListSearch,
  compactListSearchCached,
  expandListSearch,
  filtersNeedContext,
  LIST_CONTEXT_INLINE_LIMIT,
  listFiltersOf,
  listKeyOf,
  loadListContext,
  resetListContextCache,
  saveListContext,
  setListFiltersParam,
  withListContext,
} from './listContext';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

/** "Every supplier but one": about 31 KB once in a URL. */
const SUPPLIERS = Array.from({ length: 1152 }, (_, i) => `Fournisseur ${String(i).padStart(4, '0')} SAS`);
const BIG = { supplier_name: { filterType: 'set', values: SUPPLIERS } };
const BIG_TEXT = JSON.stringify(BIG);
const SMALL = { currency: { filterType: 'set', values: ['EUR'] } };
const ID = 'Abc_def-ghijklmnopqrst';

describe('list contexts (filters too long for a URL)', () => {
  beforeEach(() => {
    resetListContextCache();
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.post.mockResolvedValue({ data: { id: ID } });
    mocked.get.mockResolvedValue({ data: { id: ID, list: 'spend-items', state: { filters: BIG } } });
  });

  it('names a list by its endpoint without the request segments', () => {
    expect(listKeyOf('/spend-items/summary')).toBe('spend-items');
    expect(listKeyOf('/spend-items/summary/filter-values')).toBe('spend-items');
    expect(listKeyOf('/spend-items/summary/neighbors')).toBe('spend-items');
    expect(listKeyOf('/capex-items/summary/totals')).toBe('capex-items');
    expect(listKeyOf('/portfolio/projects/ids')).toBe('portfolio/projects');
    expect(listKeyOf('/portfolio/requests/filter-values')).toBe('portfolio/requests');
    expect(listKeyOf('/applications?x=1')).toBe('applications');
  });

  it('keeps filters inline up to 1,500 URL characters', () => {
    expect(LIST_CONTEXT_INLINE_LIMIT).toBe(1500);
    expect(encodeURIComponent(BIG_TEXT).length).toBeGreaterThan(30_000);
    expect(filtersNeedContext(BIG_TEXT)).toBe(true);
    expect(filtersNeedContext(BIG)).toBe(true);
    expect(filtersNeedContext(SMALL)).toBe(false);
    expect(filtersNeedContext('')).toBe(false);
    expect(filtersNeedContext(null)).toBe(false);
    // Exactly at the limit: inline; one character more: a context.
    const at = (n: number) => JSON.stringify({ a: { filterType: 'text', filter: 'x'.repeat(n) } });
    const base = encodeURIComponent(at(0)).length;
    expect(filtersNeedContext(at(LIST_CONTEXT_INLINE_LIMIT - base))).toBe(false);
    expect(filtersNeedContext(at(LIST_CONTEXT_INLINE_LIMIT - base + 1))).toBe(true);
  });

  it('API calls: short filters go inline, long ones as ctx, saved once per tab', async () => {
    const short = { page: 1, filters: JSON.stringify(SMALL), sort: 'a:ASC' };
    expect(await withListContext('/spend-items/summary', short)).toBe(short);
    expect(await withListContext('/spend-items/summary', { page: 1 })).toEqual({ page: 1 });
    expect(mocked.post).not.toHaveBeenCalled();

    const [a, b] = await Promise.all([
      withListContext('/spend-items/summary', { page: 1, sort: 'a:ASC', filters: BIG_TEXT }),
      withListContext('/spend-items/summary/totals', { amounts: 'yBudget', filters: BIG_TEXT }),
    ]);
    expect(a).toEqual({ page: 1, sort: 'a:ASC', ctx: ID });
    expect(b).toEqual({ amounts: 'yBudget', ctx: ID });
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(mocked.post).toHaveBeenCalledWith('/list-contexts', { list: 'spend-items', state: { filters: BIG } });
    // Same filters, keys in another order: the same saved state.
    const reordered = JSON.stringify({ supplier_name: { values: SUPPLIERS, filterType: 'set' } });
    expect(await withListContext('/spend-items/summary/ids', { filters: reordered })).toEqual({ ctx: ID });
    expect(mocked.post).toHaveBeenCalledTimes(1);
    // Another list: saved apart.
    await withListContext('/capex-items/summary', { filters: BIG_TEXT });
    expect(mocked.post).toHaveBeenCalledTimes(2);
    expect(mocked.post.mock.calls[1][1].list).toBe('capex-items');
  });

  it('URLs: long filters as ctx once saved in the tab, inline until then', async () => {
    const sp = new URLSearchParams('sort=a:ASC&ctx=stale');
    setListFiltersParam(sp, '/spend-items/summary', BIG);
    expect(sp.get('filters')).toBe(BIG_TEXT);
    expect(sp.get('ctx')).toBeNull();
    await saveListContext('/spend-items/summary', BIG);
    setListFiltersParam(sp, '/spend-items/summary', BIG);
    expect(sp.get('ctx')).toBe(ID);
    expect(sp.get('filters')).toBeNull();
    expect(sp.toString().length).toBeLessThan(80);
    setListFiltersParam(sp, '/spend-items/summary', SMALL);
    expect(sp.get('filters')).toBe(JSON.stringify(SMALL));
    expect(sp.get('ctx')).toBeNull();
    setListFiltersParam(sp, '/spend-items/summary', {});
    expect(sp.get('filters')).toBeNull();
    expect(sp.get('ctx')).toBeNull();
    expect(cachedListContextId('/spend-items/summary/ids', BIG_TEXT)).toBe(ID);
  });

  it('reads a saved context once per tab, and knows its filters afterwards', async () => {
    expect(cachedListContext(ID)).toBeUndefined();
    const [first, second] = await Promise.all([loadListContext(ID), loadListContext(ID)]);
    expect(first).toEqual({ list: 'spend-items', filters: BIG });
    expect(second).toBe(first);
    expect(mocked.get).toHaveBeenCalledTimes(1);
    expect(mocked.get).toHaveBeenCalledWith(`/list-contexts/${ID}`);
    expect(cachedListContextId('/spend-items/summary', BIG)).toBe(ID);
    expect(listFiltersOf(new URLSearchParams(`ctx=${ID}`))).toBe(BIG_TEXT);
    expect(listFiltersOf(new URLSearchParams('filters=%7B%7D&ctx=x'))).toBe('{}');
  });

  it('expands and compacts a page URL', async () => {
    const expanded = new URLSearchParams(await expandListSearch(`sort=a:ASC&ctx=${ID}`));
    expect(expanded.get('filters')).toBe(BIG_TEXT);
    expect(expanded.get('ctx')).toBeNull();
    expect(expanded.get('sort')).toBe('a:ASC');
    const compact = new URLSearchParams(await compactListSearch(expanded.toString(), '/spend-items/summary'));
    expect(compact.get('ctx')).toBe(ID);
    expect(compact.get('filters')).toBeNull();
    expect(mocked.post).not.toHaveBeenCalled();
    expect(compactListSearchCached(expanded.toString(), '/spend-items/summary')).toBe(compact.toString());
    // A purged context: the list opens without those filters.
    mocked.get.mockRejectedValueOnce(new Error('404'));
    expect(await expandListSearch('sort=a:ASC&ctx=GoneGoneGoneGoneGone_x')).toBe('sort=a%3AASC');
  });

  it('a workspace link carries the filters or the ctx standing for them', () => {
    const target = new URLSearchParams('sort=a:ASC');
    carryListFilters(target, new URLSearchParams(`ctx=${ID}`));
    expect(target.get('ctx')).toBe(ID);
    const inline = new URLSearchParams();
    carryListFilters(inline, new URLSearchParams(`filters=${encodeURIComponent(JSON.stringify(SMALL))}&ctx=${ID}`));
    expect(inline.get('filters')).toBe(JSON.stringify(SMALL));
    expect(inline.get('ctx')).toBeNull();
  });
});
