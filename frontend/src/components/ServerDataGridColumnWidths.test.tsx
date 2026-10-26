import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushAgGridTimers } from '../test/agGridTimers';

/*
 * Column widths with the real AG Grid. A page hands new column definitions whenever its labels or
 * the data they depend on change; AG Grid then applies `width` and `flex` again to the columns it
 * has, so the grid hands them as initial values: a width set by hand stays. Reset columns gives
 * every column its declared width and a flex column its flex.
 */

vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string) => key,
    i18n: { language: 'en', resolvedLanguage: 'en', getResourceBundle: () => ({}) },
  };
  return { useTranslation: () => translation };
});
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [], total: 0 } })) } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'u-1' } }) }));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'test' }) }));
vi.mock('../config/ThemeContext', () => ({ useThemeMode: () => ({ resolvedMode: 'light' }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));

import ServerDataGrid, { type EnhancedColDef } from './ServerDataGrid';

type Row = { id: string; name: string; code: string; notes: string; created_at?: string };

/** New column objects on every call, as a page's `useMemo` gives after a change of its inputs. */
const columns = (): EnhancedColDef<Row>[] => [
  { field: 'name', headerName: 'Name', flex: 1 },
  { field: 'code', headerName: 'Code', width: 120 },
  { field: 'notes', headerName: 'Notes' },
];

function Grid({ cols, onApi }: { cols: EnhancedColDef<Row>[]; onApi: (api: any) => void }) {
  return (
    <MemoryRouter>
      <ServerDataGrid<Row> columns={cols} endpoint="/things" queryKey="things" columnPreferencesKey="things" onGridApiReady={onApi} />
    </MemoryRouter>
  );
}

const stateOf = (api: any, colId: string) => api.getColumnState().find((col: any) => col.colId === colId);

describe('ServerDataGrid column widths', () => {
  let view: ReturnType<typeof render> | null = null;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
  });
  afterEach(async () => {
    view?.unmount();
    view = null;
    await flushAgGridTimers();
    vi.unstubAllGlobals();
  });

  async function renderGrid() {
    let gridApi: any = null;
    const onApi = (api: any) => { gridApi = api; };
    view = render(<Grid cols={columns()} onApi={onApi} />);
    await waitFor(() => expect(gridApi).not.toBeNull());
    return { api: () => gridApi, rerender: () => view!.rerender(<Grid cols={columns()} onApi={onApi} />) };
  }

  it('starts a flex column flexing, above its minimum, and the others at their declared width', async () => {
    const grid = await renderGrid();

    expect(stateOf(grid.api(), 'name').flex).toBe(1);
    expect(grid.api().getColumn('name').getMinWidth()).toBe(160);
    expect(stateOf(grid.api(), 'code')).toMatchObject({ width: 120, flex: null });
    expect(stateOf(grid.api(), 'notes')).toMatchObject({ width: 200, flex: null });
  });

  it('keeps the widths set by hand when the page hands new column definitions', async () => {
    const grid = await renderGrid();
    // A resize by hand: AG Grid drops the flex of the column the user drags.
    act(() => {
      grid.api().applyColumnState({ state: [{ colId: 'name', width: 300, flex: null }, { colId: 'code', width: 250 }, { colId: 'notes', width: 90 }] });
    });

    grid.rerender();

    expect(stateOf(grid.api(), 'name')).toMatchObject({ width: 300, flex: null });
    expect(stateOf(grid.api(), 'code')).toMatchObject({ width: 250, flex: null });
    expect(stateOf(grid.api(), 'notes')).toMatchObject({ width: 90, flex: null });
  });

  it('Reset columns gives a flex column its flex and the others their declared width', async () => {
    const grid = await renderGrid();
    act(() => {
      grid.api().applyColumnState({ state: [{ colId: 'name', width: 300, flex: null }, { colId: 'code', width: 250 }, { colId: 'notes', width: 90 }] });
    });

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.resetColumns' }));

    expect(stateOf(grid.api(), 'name').flex).toBe(1);
    expect(stateOf(grid.api(), 'code')).toMatchObject({ width: 120, flex: null });
    expect(stateOf(grid.api(), 'notes')).toMatchObject({ width: 200, flex: null });
  });
});

describe('ServerDataGrid optional columns', () => {
  let view: ReturnType<typeof render> | null = null;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
  });
  afterEach(async () => {
    view?.unmount();
    view = null;
    await flushAgGridTimers();
    vi.unstubAllGlobals();
  });

  const optionalColumns = (): EnhancedColDef<Row>[] => [
    { field: 'name', headerName: 'Name', width: 160 },
    { field: 'notes', headerName: 'Notes', width: 140, defaultHidden: true, initialHide: true },
  ];

  it('keeps a shown optional column shown when the page hands new column definitions, and reset hides it again', async () => {
    let gridApi: any = null;
    const onApi = (api: any) => { gridApi = api; };
    view = render(
      <MemoryRouter>
        <ServerDataGrid<Row> columns={optionalColumns()} endpoint="/things" queryKey="things" columnPreferencesKey="optional" onGridApiReady={onApi} />
      </MemoryRouter>,
    );
    await waitFor(() => expect(gridApi).not.toBeNull());
    expect(stateOf(gridApi, 'notes').hide).toBe(true);

    act(() => { gridApi.setColumnsVisible(['notes'], true); });
    expect(stateOf(gridApi, 'notes').hide).toBe(false);

    view.rerender(
      <MemoryRouter>
        <ServerDataGrid<Row> columns={optionalColumns()} endpoint="/things" queryKey="things" columnPreferencesKey="optional" onGridApiReady={onApi} />
      </MemoryRouter>,
    );
    expect(stateOf(gridApi, 'notes').hide).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.resetColumns' }));
    expect(stateOf(gridApi, 'notes').hide).toBe(true);
  });
});

describe('ServerDataGrid layout version', () => {
  let view: ReturnType<typeof render> | null = null;

  beforeEach(() => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
  });
  afterEach(async () => {
    view?.unmount();
    view = null;
    await flushAgGridTimers();
    vi.unstubAllGlobals();
  });

  const columns = (): EnhancedColDef<Row>[] => [
    { field: 'name', headerName: 'Name', width: 180 },
    { field: 'created_at', headerName: 'Created on', width: 160 },
  ];

  async function renderVersioned() {
    let gridApi: any = null;
    view = render(
      <MemoryRouter>
        <ServerDataGrid<Row>
          columns={columns()}
          endpoint="/things"
          queryKey="things"
          columnPreferencesKey="versioned"
          columnLayoutVersion={1}
          onGridApiReady={(api) => { gridApi = api; }}
        />
      </MemoryRouter>,
    );
    await waitFor(() => expect(gridApi).not.toBeNull());
    return gridApi;
  }

  it('drops a layout saved before the version and returns the default widths', async () => {
    localStorage.setItem('grid-columns:test:u-1:versioned', JSON.stringify([
      { colId: 'name', width: 900 },
      { colId: 'created_at', width: 40 },
    ]));
    const api = await renderVersioned();
    expect(stateOf(api, 'created_at').width).toBe(160);
    expect(stateOf(api, 'name').width).toBe(180);
    const stored = localStorage.getItem('grid-columns:test:u-1:versioned');
    expect(stored == null || JSON.parse(stored).v === 1).toBe(true);
    expect(stored == null || JSON.parse(stored).columns.find((col: { colId: string }) => col.colId === 'created_at').width === 160).toBe(true);
  });

  it('keeps a layout of the current version', async () => {
    localStorage.setItem('grid-columns:test:u-1:versioned', JSON.stringify({
      v: 1,
      columns: [
        { colId: 'name', width: 220, hide: false },
        { colId: 'created_at', width: 180, hide: false },
      ],
    }));
    const api = await renderVersioned();
    expect(stateOf(api, 'created_at').width).toBe(180);
    expect(stateOf(api, 'name').width).toBe(220);
  });
});
