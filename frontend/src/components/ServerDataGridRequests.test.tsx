import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real AG Grid: these specs check how the shared grid asks for its rows.
vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en', getResourceBundle: () => ({}) },
  };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'u-1' } }) }));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'test' }) }));
vi.mock('../config/ThemeContext', () => ({ useThemeMode: () => ({ resolvedMode: 'light' }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));

import api from '../api';
import ServerDataGrid from './ServerDataGrid';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 500)); });
type Config = { params: Record<string, string>; signal?: AbortSignal };

/** A request the test answers itself; like axios, it fails at once when its signal aborts (unless told to ignore it). */
function deferred({ honourAbort = true } = {}) {
  let resolve: (value: unknown) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  const request = (_url: string, config: Config) => {
    if (honourAbort) {
      config.signal?.addEventListener('abort', () => reject(Object.assign(new Error('canceled'), { name: 'CanceledError' })));
    }
    return promise;
  };
  return { request, resolve, reject };
}

const page = (names: string[]) => ({ data: { items: names.map((name) => ({ id: name, name })), total: names.length, page: 1, limit: 50 } });

function Grid(props: { refreshKey?: number; onGridApiReady?: (api: any) => void }) {
  return (
    <MemoryRouter>
      <ServerDataGrid<{ id: string; name: string }>
        columns={[{ field: 'name', headerName: 'Name' }]}
        endpoint="/things"
        queryKey="things"
        defaultSort={{ field: 'name', direction: 'ASC' }}
        {...props}
      />
    </MemoryRouter>
  );
}

describe('ServerDataGrid block requests', () => {
  beforeEach(() => {
    get.mockReset();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('a filter change aborts the page in flight, asks once with the new filter, shows no error and keeps loading', async () => {
    const first = deferred();
    get.mockImplementationOnce(first.request);
    get.mockImplementation(async () => page(['Fresh']));
    let gridApi: any = null;
    render(<Grid onGridApiReady={(a) => { gridApi = a; }} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const firstSignal = (get.mock.calls[0][1] as Config).signal!;
    expect(firstSignal.aborted).toBe(false);

    await act(async () => { gridApi.setFilterModel({ name: { filterType: 'text', type: 'contains', filter: 'fr' } }); });
    expect(await screen.findByText('Fresh')).toBeInTheDocument();
    expect(firstSignal.aborted).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
    expect(JSON.parse((get.mock.calls[1][1] as Config).params.filters)).toEqual({ name: { filterType: 'text', type: 'contains', filter: 'fr' } });
    expect(screen.queryByText('canceled')).not.toBeInTheDocument();

    // AG Grid's request slot was freed: the grid keeps loading.
    get.mockImplementation(async () => page(['Later']));
    await act(async () => { gridApi.setFilterModel({}); });
    expect(await screen.findByText('Later')).toBeInTheDocument();
  }, 20_000);

  it('drops the answer of a superseded request that arrives anyway', async () => {
    // The answer was already on its way: the abort comes too late for it.
    const first = deferred({ honourAbort: false });
    get.mockImplementationOnce(first.request);
    get.mockImplementation(async () => page(['Fresh']));
    const view = render(<Grid refreshKey={0} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const firstSignal = (get.mock.calls[0][1] as Config).signal!;

    // A refresh (a delete, an import) while the first page is in flight.
    view.rerender(<Grid refreshKey={1} />);
    expect(firstSignal.aborted).toBe(true);

    await act(async () => { first.resolve(page(['Stale'])); });
    expect(await screen.findByText('Fresh')).toBeInTheDocument();
    expect(screen.queryByText('Stale')).not.toBeInTheDocument();
    expect(get).toHaveBeenCalledTimes(2);
  }, 20_000);

  it('a sort change aborts the page in flight and asks once with the new sort', async () => {
    const first = deferred();
    get.mockImplementationOnce(first.request);
    get.mockImplementation(async () => page(['Sorted']));
    let gridApi: any = null;
    render(<Grid onGridApiReady={(a) => { gridApi = a; }} />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const firstSignal = (get.mock.calls[0][1] as Config).signal!;

    await act(async () => { gridApi.applyColumnState({ state: [{ colId: 'name', sort: 'desc' }], defaultState: { sort: null } }); });
    expect(await screen.findByText('Sorted')).toBeInTheDocument();
    expect(firstSignal.aborted).toBe(true);
    expect(get).toHaveBeenCalledTimes(2);
    expect((get.mock.calls[1][1] as Config).params.sort).toBe('name:DESC');
  }, 20_000);

  it('aborts the page in flight when the list closes', async () => {
    const first = deferred();
    get.mockImplementationOnce(first.request);
    const view = render(<Grid />);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    const signal = (get.mock.calls[0][1] as Config).signal!;
    view.unmount();
    expect(signal.aborted).toBe(true);
  }, 20_000);
});
