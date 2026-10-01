import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real AG Grid (reactive custom components) through ServerDataGrid: how the column filters
// follow the models the grid hands them.
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
import CheckboxSetFilter from './CheckboxSetFilter';
import CheckboxSetFloatingFilter from './CheckboxSetFloatingFilter';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const VALUES = ['Alpha', 'Bravo', 'Charlie'];
const quiet = (ms = 400) => act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });

type GridProps = {
  onGridApiReady?: (api: any) => void;
  initialFilterModel?: any;
  getValues?: (ctx: unknown) => Promise<Array<{ value: string }>>;
  refreshKey?: number;
  queryClient: QueryClient;
};

function Grid({ queryClient, getValues, ...props }: GridProps) {
  return (
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <ServerDataGrid<{ id: string; name: string; other: string; status: string }>
          columns={[
            { field: 'name', headerName: 'Name' },
            { field: 'other', headerName: 'Other' },
            {
              field: 'status',
              headerName: 'Status',
              filter: CheckboxSetFilter,
              floatingFilterComponent: CheckboxSetFloatingFilter,
              filterParams: getValues
                ? { getValues, searchable: false }
                : { values: VALUES.map((value) => ({ value })), searchable: false },
            } as any,
          ]}
          endpoint="/things"
          queryKey="things"
          defaultSort={{ field: 'name', direction: 'ASC' }}
          {...props}
        />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

function floatingFilterCell(colId: string): HTMLElement {
  const index = document.querySelector(`.ag-header-cell[col-id="${colId}"]`)!.getAttribute('aria-colindex');
  return document.querySelector(`.ag-floating-filter[aria-colindex="${index}"]`) as HTMLElement;
}

function checkbox(label: string): HTMLInputElement | null {
  const el = Array.from(document.querySelectorAll('.ag-popup label')).find((l) => l.textContent === label);
  return (el?.querySelector('input') as HTMLInputElement) ?? null;
}

const checked = () => VALUES.map((value) => `${value}=${checkbox(value)?.checked}`).join(' ');

async function openStatusFilter() {
  fireEvent.click(floatingFilterCell('status').querySelector('button')!);
  await waitFor(() => expect(checkbox('Bravo')).not.toBeNull());
}

async function closeStatusFilter() {
  // AG Grid listens for a click outside the popup from the tick after it opened.
  await quiet(20);
  fireEvent.mouseDown(document.body);
  await waitFor(() => expect(document.querySelector('.ag-popup label')).toBeNull());
}

async function mount(props: Omit<GridProps, 'queryClient' | 'onGridApiReady'> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let gridApi: any = null;
  const view = render(<Grid queryClient={queryClient} onGridApiReady={(a) => { gridApi = a; }} {...props} />);
  await waitFor(() => expect(gridApi).not.toBeNull());
  await waitFor(() => expect(get).toHaveBeenCalled());
  await quiet();
  const rerender = (next: Omit<GridProps, 'queryClient'>) => view.rerender(
    <Grid queryClient={queryClient} onGridApiReady={(a) => { gridApi = a; }} {...props} {...next} />,
  );
  return { api: () => gridApi, rerender };
}

describe('ServerDataGrid column filters follow the grid model', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(async () => ({ data: { items: [{ id: '1', name: 'one', other: 'x', status: 'Alpha' }], total: 1 } }));
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  const layoutPopups = () => {
    // jsdom lays nothing out: AG Grid closes a popup whose anchor has an empty box.
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({ top: 10, left: 10, right: 110, bottom: 30, width: 100, height: 20, x: 10, y: 10, toJSON: () => ({}) } as DOMRect);
  };

  it('set filter: after the column cross, every box is ticked again and the next click starts from all values', async () => {
    const grid = await mount();
    layoutPopups();
    await openStatusFilter();
    fireEvent.click(checkbox('Bravo')!);
    await waitFor(() => expect(grid.api().getFilterModel()).toEqual({ status: { filterType: 'set', values: ['Alpha', 'Charlie'] } }));
    await closeStatusFilter();

    fireEvent.click(floatingFilterCell('status').querySelector('button[aria-label="filters.clearFilter"]')!);
    await waitFor(() => expect(grid.api().getFilterModel()).toEqual({}));
    await openStatusFilter();
    expect(checked()).toBe('Alpha=true Bravo=true Charlie=true');

    fireEvent.click(checkbox('Charlie')!);
    await waitFor(() => expect(grid.api().getFilterModel()).toEqual({ status: { filterType: 'set', values: ['Alpha', 'Bravo'] } }));
  }, 30_000);

  it('set filter: a reset of every filter ticks every box again', async () => {
    const grid = await mount();
    layoutPopups();
    await openStatusFilter();
    fireEvent.click(checkbox('Bravo')!);
    await waitFor(() => expect(grid.api().getFilterModel().status).toBeDefined());
    await closeStatusFilter();
    await act(async () => { grid.api().setFilterModel({}); });
    await openStatusFilter();
    expect(checked()).toBe('Alpha=true Bravo=true Charlie=true');
  }, 30_000);

  it('set filter: after a refresh (a delete, an import) the next opening asks the values again', async () => {
    const getValues = vi.fn(async () => VALUES.map((value) => ({ value })));
    const grid = await mount({ getValues, refreshKey: 0 });
    layoutPopups();
    await openStatusFilter();
    expect(getValues).toHaveBeenCalledTimes(1);
    await closeStatusFilter();

    // Opened again on the same list: the values are still fresh.
    await openStatusFilter();
    await quiet(50);
    expect(getValues).toHaveBeenCalledTimes(1);
    await closeStatusFilter();

    grid.rerender({ getValues, refreshKey: 1 });
    await openStatusFilter();
    await waitFor(() => expect(getValues).toHaveBeenCalledTimes(2));
  }, 30_000);

  it('text box: shows the model the list starts with, and its cross', async () => {
    await mount({ initialFilterModel: { name: { filterType: 'text', type: 'contains', filter: 'abc' } } });
    const cell = floatingFilterCell('name');
    expect((cell.querySelector('input') as HTMLInputElement).value).toBe('abc');
    const cross = cell.querySelector('button[aria-label="filters.clearFilter"]') as HTMLElement;
    expect(getComputedStyle(cross).visibility).toBe('visible');
  }, 30_000);

  it('text box: shows a model set from outside, and an empty box after a reset', async () => {
    const grid = await mount();
    const input = floatingFilterCell('name').querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('');
    await act(async () => { grid.api().setFilterModel({ name: { filterType: 'text', type: 'contains', filter: 'xyz' } }); });
    await waitFor(() => expect(input.value).toBe('xyz'));
    await act(async () => { grid.api().setFilterModel({}); });
    await waitFor(() => expect(input.value).toBe(''));
  }, 30_000);

  it('text box: text being typed is not overwritten by another column change, and keeps its spaces once applied', async () => {
    const grid = await mount({ initialFilterModel: { name: { filterType: 'text', type: 'contains', filter: 'abc' } } });
    const input = floatingFilterCell('name').querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'abcd' } });
    await act(async () => {
      grid.api().setFilterModel({ ...grid.api().getFilterModel(), other: { filterType: 'text', type: 'contains', filter: 'x' } });
    });
    expect(input.value).toBe('abcd');
    await waitFor(() => expect(grid.api().getFilterModel().name).toMatchObject({ filter: 'abcd' }));
    expect(input.value).toBe('abcd');

    // Applied trimmed, the text in the box keeps its trailing space for the next word.
    fireEvent.change(input, { target: { value: 'abcd ' } });
    await quiet();
    expect(grid.api().getFilterModel().name).toMatchObject({ filter: 'abcd' });
    expect(input.value).toBe('abcd ');
  }, 30_000);

  it('text box: the cross keeps the focus in the box, so the typed text is not applied before the clear', async () => {
    const grid = await mount();
    const cell = floatingFilterCell('name');
    const input = cell.querySelector('input') as HTMLInputElement;
    const changes = vi.fn();
    grid.api().addEventListener('filterChanged', changes);
    fireEvent.change(input, { target: { value: 'abc' } });
    const cross = cell.querySelector('button[aria-label="filters.clearFilter"]') as HTMLElement;
    // Default prevented: the box does not lose the focus (no blur, no apply).
    expect(fireEvent.mouseDown(cross)).toBe(false);
    fireEvent.click(cross);
    await quiet();
    expect(changes).not.toHaveBeenCalled();
    expect(input.value).toBe('');
    expect(grid.api().getFilterModel()).toEqual({});
  }, 30_000);
});
