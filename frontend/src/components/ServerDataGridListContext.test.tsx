import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real AG Grid: how the shared grid sends a large list state (`ctx`), restores one from its URL,
// and sends the page parameters that follow its columns.
vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en', getResourceBundle: () => ({}) },
  };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'u-1' } }) }));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'test' }) }));
vi.mock('../config/ThemeContext', () => ({ useThemeMode: () => ({ resolvedMode: 'light' }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));

import api from '../api';
import ServerDataGrid from './ServerDataGrid';
import { resetListContextCache } from '../lib/listContext';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };
type Config = { params: Record<string, string>; signal?: AbortSignal };

const ID = 'Ctx_abcdefghijklmnopqr';
// A text model the size of "every supplier but one" (the set filter case runs on the OPEX page spec).
const BIG = { supplier: { filterType: 'text', type: 'notContains', filter: 'Fournisseur SAS '.repeat(1900) } };

const page = () => ({ data: { items: [{ id: 'a', name: 'A', fte_x: 1 }], total: 1, page: 1, limit: 50 } });
const notFound = () => Object.assign(new Error('Request failed with status code 400'), {
  response: { status: 400, data: { code: 'list_context_not_found', message: 'The saved list filters of this link are no longer available.' } },
});
// The address the grid writes (history replace), as a reload would read it.
const address = vi.hoisted(() => ({ search: '' }));
function LocationProbe() {
  address.search = useLocation().search;
  return null;
}
const rowCalls = () => mocked.get.mock.calls.filter(([url]) => url === '/things');
const paramsOf = (call: unknown[]) => (call[1] as Config).params;

function Grid(props: { url?: string; onGridApiReady?: (api: any) => void; pageParams?: (state: any[]) => Record<string, string | undefined>; context?: boolean; endpoint?: string }) {
  return (
    <MemoryRouter initialEntries={[props.url ?? '/things']}>
      <ServerDataGrid<{ id: string; name: string }>
        columns={[
          { field: 'name', headerName: 'Name' },
          { field: 'supplier', headerName: 'Supplier' },
          { field: 'fte_x', headerName: 'FTE', hide: true } as any,
        ]}
        endpoint={props.endpoint ?? '/things'}
        queryKey="things"
        defaultSort={{ field: 'name', direction: 'ASC' }}
        onGridApiReady={props.onGridApiReady}
        pageParams={props.pageParams}
        setFilterExcludeMode={props.context}
      />
      <LocationProbe />
    </MemoryRouter>
  );
}

describe('ServerDataGrid list contexts and page parameters', () => {
  beforeEach(() => {
    resetListContextCache();
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.post.mockResolvedValue({ data: { id: ID } });
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/list-contexts/${ID}`) return { data: { id: ID, list: 'things', state: { filters: BIG } } };
      return page();
    });
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a 31 KB filter goes as ctx (saved once), a short one inline', async () => {
    expect(encodeURIComponent(JSON.stringify(BIG)).length).toBeGreaterThan(30_000);
    let gridApi: any = null;
    render(<Grid onGridApiReady={(a) => { gridApi = a; }} />);
    await waitFor(() => expect(rowCalls()).toHaveLength(1));
    await act(async () => { gridApi.setFilterModel({ name: { filterType: 'text', type: 'contains', filter: 'fr' } }); });
    await waitFor(() => expect(rowCalls()).toHaveLength(2));
    expect(paramsOf(rowCalls()[1]).filters).toBe(JSON.stringify({ name: { filterType: 'text', type: 'contains', filter: 'fr' } }));
    expect(paramsOf(rowCalls()[1]).ctx).toBeUndefined();

    await act(async () => { gridApi.setFilterModel(BIG); });
    await waitFor(() => expect(rowCalls()).toHaveLength(3));
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(mocked.post).toHaveBeenCalledWith('/list-contexts', { list: 'things', state: { filters: BIG } });
    const sent = paramsOf(rowCalls()[2]);
    expect(sent.ctx).toBe(ID);
    expect(sent.filters).toBeUndefined();
    expect(sent.sort).toBe('name:ASC');
    expect(new URLSearchParams(sent).toString().length).toBeLessThan(200);
  });

  it('restores a context from its URL before the first page (a reload, a link in a new tab)', async () => {
    let gridApi: any = null;
    render(<Grid url={`/things?sort=name:DESC&ctx=${ID}`} onGridApiReady={(a) => { gridApi = a; }} />);
    await waitFor(() => expect(rowCalls()).toHaveLength(1));
    // One page, filtered from the start, the context read once and not saved again.
    expect(mocked.get.mock.calls.filter(([url]) => url === `/list-contexts/${ID}`)).toHaveLength(1);
    expect(paramsOf(rowCalls()[0])).toMatchObject({ ctx: ID, sort: 'name:DESC' });
    expect(paramsOf(rowCalls()[0]).filters).toBeUndefined();
    expect(mocked.post).not.toHaveBeenCalled();
    expect(gridApi.getFilterModel()).toEqual(BIG);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(rowCalls()).toHaveLength(1);
  });

  it('ignores a context saved for another list', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/list-contexts/${ID}`) return { data: { id: ID, list: 'other-things', state: { filters: BIG } } };
      return page();
    });
    let gridApi: any = null;
    render(<Grid url={`/things?ctx=${ID}`} onGridApiReady={(a) => { gridApi = a; }} />);
    await waitFor(() => expect(rowCalls()).toHaveLength(1));
    expect(paramsOf(rowCalls()[0]).ctx).toBeUndefined();
    expect(gridApi.getFilterModel()).toEqual({});
  });

  it('a purged context: the list opens unfiltered, one line says so, the address drops it', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url.startsWith('/list-contexts/')) throw Object.assign(notFound(), { response: { status: 404, data: { code: 'list_context_not_found' } } });
      return page();
    });
    let gridApi: any = null;
    render(<Grid url={`/things?sort=name:DESC&ctx=${ID}`} onGridApiReady={(a) => { gridApi = a; }} />);
    await waitFor(() => expect(rowCalls()).toHaveLength(1));
    expect(paramsOf(rowCalls()[0]).ctx).toBeUndefined();
    expect(paramsOf(rowCalls()[0]).filters).toBeUndefined();
    expect(await screen.findByText('common:filters.linkFiltersLost')).toBeInTheDocument();
    await waitFor(() => expect(new URLSearchParams(address.search).get('ctx')).toBeNull());
    expect(new URLSearchParams(address.search).get('sort')).toBe('name:DESC');
    // The next filter change ends the notice.
    await act(async () => { gridApi.setFilterModel({ name: { filterType: 'text', type: 'contains', filter: 'a' } }); });
    await waitFor(() => expect(screen.queryByText('common:filters.linkFiltersLost')).toBeNull());
  });

  it('a context of another error (a network failure) shows no notice', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url.startsWith('/list-contexts/')) throw Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' });
      return page();
    });
    render(<Grid url={`/things?ctx=${ID}`} />);
    await waitFor(() => expect(rowCalls()).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(screen.queryByText('common:filters.linkFiltersLost')).toBeNull();
  });

  it('the address follows the filters: change them twice, reload, the second ones are back', async () => {
    let gridApi: any = null;
    const { unmount } = render(<Grid url="/things?sort=name:DESC" onGridApiReady={(a) => { gridApi = a; }} />);
    await waitFor(() => expect(rowCalls()).toHaveLength(1));
    const first = { name: { filterType: 'text', type: 'contains', filter: 'first' } };
    const second = { name: { filterType: 'text', type: 'contains', filter: 'second' } };
    await act(async () => { gridApi.setFilterModel(first); });
    await waitFor(() => expect(new URLSearchParams(address.search).get('filters')).toBe(JSON.stringify(first)));
    await act(async () => { gridApi.setFilterModel(second); });
    await waitFor(() => expect(new URLSearchParams(address.search).get('filters')).toBe(JSON.stringify(second)));
    expect(new URLSearchParams(address.search).get('sort')).toBe('name:DESC');
    // Filters too long for an address: ctx once saved, no inline copy.
    await act(async () => { gridApi.setFilterModel(BIG); });
    await waitFor(() => expect(new URLSearchParams(address.search).get('ctx')).toBe(ID));
    expect(new URLSearchParams(address.search).get('filters')).toBeNull();
    // Back to the second filter, then a reload of that address.
    await act(async () => { gridApi.setFilterModel(second); });
    await waitFor(() => expect(new URLSearchParams(address.search).get('filters')).toBe(JSON.stringify(second)));
    expect(new URLSearchParams(address.search).get('ctx')).toBeNull();
    const reloaded = address.search;
    unmount();
    mocked.get.mockClear();
    gridApi = null;
    render(<Grid url={`/things${reloaded}`} onGridApiReady={(a) => { gridApi = a; }} />);
    await waitFor(() => expect(rowCalls()).toHaveLength(1));
    expect(paramsOf(rowCalls()[0]).filters).toBe(JSON.stringify(second));
    expect(gridApi.getFilterModel()).toEqual(second);
    // Cleared: the address carries no filters.
    await act(async () => { gridApi.setFilterModel(null); });
    await waitFor(() => expect(new URLSearchParams(address.search).get('filters')).toBeNull());
  });

  it('a request error shows its translated message, not the transport text', async () => {
    mocked.get.mockImplementation(async () => { throw notFound(); });
    render(<Grid />);
    expect(await screen.findByText('errors:list_context_not_found')).toBeInTheDocument();
    expect(screen.queryByText('Request failed with status code 400')).toBeNull();
  });

  it('page parameters follow the columns: the first page has them, showing a column they read reloads once', async () => {
    let gridApi: any = null;
    const pageParams = (state: any[]) => ({
      shape: 'grid',
      fte: state.filter((c) => c.colId?.startsWith('fte_') && !c.hide).map((c) => c.colId).join(','),
    });
    render(<Grid pageParams={pageParams} onGridApiReady={(a) => { gridApi = a; }} />);
    await waitFor(() => expect(rowCalls()).toHaveLength(1));
    expect(paramsOf(rowCalls()[0]).shape).toBe('grid');
    expect(paramsOf(rowCalls()[0]).fte).toBeUndefined();
    await act(async () => { gridApi.setColumnsVisible(['fte_x'], true); });
    await waitFor(() => expect(rowCalls()).toHaveLength(2));
    expect(paramsOf(rowCalls()[1])).toMatchObject({ shape: 'grid', fte: 'fte_x' });
    // A column the parameters do not read: no reload.
    await act(async () => { gridApi.setColumnsVisible(['supplier'], false); });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(rowCalls()).toHaveLength(2);
    // Hidden again: one more reload, without fte.
    await act(async () => { gridApi.setColumnsVisible(['fte_x'], false); });
    await waitFor(() => expect(rowCalls()).toHaveLength(3));
    expect(paramsOf(rowCalls()[2]).fte).toBeUndefined();
  });

  it('hands the exclude-mode opt-in to the set filters through the grid context, off by default', async () => {
    let gridApi: any = null;
    const { unmount } = render(<Grid onGridApiReady={(a) => { gridApi = a; }} />);
    await waitFor(() => expect(gridApi).not.toBeNull());
    expect(gridApi.getGridOption('context').setFilterExcludeMode).toBe(false);
    unmount();
    gridApi = null;
    render(<Grid context onGridApiReady={(a) => { gridApi = a; }} />);
    await waitFor(() => expect(gridApi).not.toBeNull());
    expect(gridApi.getGridOption('context').setFilterExcludeMode).toBe(true);
  });
});
