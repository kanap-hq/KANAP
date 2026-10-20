import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real AG Grid: these specs check what the shared grid shows around its rows.
vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string, options?: { count?: number }) => (options && 'count' in options ? `${key}:${options.count}` : key),
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
import { statusColumnProps } from './grid/statusColumn';
import { flushAgGridTimers } from '../test/agGridTimers';
import { stubOffsetParent } from '../test/jsdomOffsetParent';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
type Config = { params: Record<string, string> };
type Row = { id: string; name: string; status: string };

const page = (names: string[]) => ({ data: { items: names.map((name) => ({ id: name, name, status: 'enabled' })), total: names.length, page: 1, limit: 50 } });
const t = ((key: string) => key) as any;

function Grid(props: {
  onGridApiReady?: (api: any) => void; withScope?: boolean; emptyState?: React.ReactNode; defaultFilterModel?: Record<string, unknown>;
  extraNarrows?: boolean; onResetFilters?: () => void;
}) {
  return (
    <MemoryRouter>
      <ServerDataGrid<Row>
        // Status first: jsdom has no width, and AG Grid draws only the first columns.
        columns={[
          { field: 'status', headerName: 'Status', ...statusColumnProps(t) },
          { field: 'name', headerName: 'Name' },
        ]}
        endpoint="/things"
        queryKey="things"
        defaultSort={{ field: 'name', direction: 'ASC' }}
        statusScopeConfig={props.withScope ? { defaultScope: 'enabled' } : undefined}
        onGridApiReady={props.onGridApiReady}
        emptyState={props.emptyState}
        initialState={props.defaultFilterModel ? { filter: { filterModel: props.defaultFilterModel } } : undefined}
        defaultFilterModel={props.defaultFilterModel}
        extraNarrows={props.extraNarrows}
        onResetFilters={props.onResetFilters}
      />
    </MemoryRouter>
  );
}

describe('ServerDataGrid', () => {
  beforeEach(() => {
    get.mockReset();
    stubOffsetParent();
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const stored = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
  });
  afterEach(async () => {
    await flushAgGridTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  describe('empty list', () => {
    it('says the list is empty once loaded, never while loading', async () => {
      let answer: (value: unknown) => void = () => undefined;
      get.mockImplementationOnce(() => new Promise((resolve) => { answer = resolve; }));
      const view = render(<Grid />);
      await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
      expect(screen.queryByText('common:filters.noResults')).not.toBeInTheDocument();

      await act(async () => { answer(page([])); });
      expect(await screen.findByText('common:filters.noResults')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'common:filters.clearAll' })).not.toBeInTheDocument();
      expect(screen.getByText('common:filters.resultCount:0')).toBeInTheDocument();
      view.unmount();
    }, 20_000);

    it('says the empty line of the page when nothing narrows the list, the generic one when a filter does', async () => {
      get.mockImplementation(async () => page([]));
      let gridApi: any = null;
      const view = render(<Grid emptyState={<button type="button">Create the first thing</button>} onGridApiReady={(a) => { gridApi = a; }} />);
      expect(await screen.findByRole('button', { name: 'Create the first thing' })).toBeInTheDocument();
      expect(screen.queryByText('common:filters.noResults')).not.toBeInTheDocument();

      await act(async () => { gridApi.setFilterModel({ name: { filterType: 'text', type: 'contains', filter: 'zz' } }); });
      expect(await screen.findByText('common:filters.noResultsFiltered')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Create the first thing' })).not.toBeInTheDocument();
      view.unmount();
    }, 20_000);

    it('shows nothing of the kind when the rows fail to load', async () => {
      get.mockRejectedValue(new Error('boom'));
      const view = render(<Grid />);
      expect(await screen.findByText('boom')).toBeInTheDocument();
      expect(screen.queryByText('common:filters.noResults')).not.toBeInTheDocument();
      view.unmount();
    }, 20_000);

    it('says a filter hides every row and clears the search and the filters in one click', async () => {
      get.mockImplementation(async (_url: string, config: Config) => (config.params.filters || config.params.q ? page([]) : page(['Alpha', 'Beta'])));
      let gridApi: any = null;
      const view = render(<Grid onGridApiReady={(a) => { gridApi = a; }} />);
      expect(await screen.findByText('Alpha')).toBeInTheDocument();
      expect(screen.getByText('common:filters.resultCount:2')).toBeInTheDocument();

      await act(async () => { gridApi.setFilterModel({ name: { filterType: 'text', type: 'contains', filter: 'zz' } }); });
      expect(await screen.findByText('common:filters.noResultsFiltered')).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'common:filters.clearAll' }));
      expect(await screen.findByText('Alpha')).toBeInTheDocument();
      expect(screen.queryByText('common:filters.noResultsFiltered')).not.toBeInTheDocument();
      expect(gridApi.getFilterModel()).toEqual({});
      view.unmount();
    }, 20_000);
  });

  describe('reset filters', () => {
    it('offers to reset the filters only while one narrows the list, and brings every row back', async () => {
      get.mockImplementation(async (_url: string, config: Config) => (config.params.filters ? page(['Alpha']) : page(['Alpha', 'Beta'])));
      let gridApi: any = null;
      const view = render(<Grid withScope onGridApiReady={(a) => { gridApi = a; }} />);
      expect(await screen.findByText('common:filters.resultCount:2')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'common:buttons.resetColumns' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'common:buttons.resetFilters' })).not.toBeInTheDocument();

      await act(async () => { gridApi.setFilterModel({ name: { filterType: 'text', type: 'contains', filter: 'al' } }); });
      expect(await screen.findByText('common:filters.resultCount:1')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('radio', { name: 'common:labels.all' }));
      fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.resetFilters' }));

      await waitFor(() => expect(screen.queryByRole('button', { name: 'common:buttons.resetFilters' })).not.toBeInTheDocument());
      expect(await screen.findByText('common:filters.resultCount:2')).toBeInTheDocument();
      expect(gridApi.getFilterModel()).toEqual({});
      expect(screen.getByRole('radio', { name: 'common:labels.enabled' })).toBeChecked();
      view.unmount();
    }, 20_000);

    it('goes back to the filters the page opens on, and offers nothing while they apply', async () => {
      const opening = { name: { filterType: 'text', type: 'contains', filter: 'al' } };
      get.mockImplementation(async (_url: string, config: Config) => (config.params.filters ? page(['Alpha']) : page(['Alpha', 'Beta'])));
      let gridApi: any = null;
      const view = render(<Grid defaultFilterModel={opening} onGridApiReady={(a) => { gridApi = a; }} />);
      expect(await screen.findByText('common:filters.resultCount:1')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'common:buttons.resetFilters' })).not.toBeInTheDocument();

      await act(async () => { gridApi.setFilterModel(null); });
      expect(await screen.findByText('common:filters.resultCount:2')).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.resetFilters' }));

      expect(await screen.findByText('common:filters.resultCount:1')).toBeInTheDocument();
      expect(gridApi.getFilterModel()).toEqual(opening);
      await waitFor(() => expect(screen.queryByRole('button', { name: 'common:buttons.resetFilters' })).not.toBeInTheDocument());
      view.unmount();
    }, 20_000);

    it('counts a control of the page as a filter, and hands it the reset', async () => {
      get.mockImplementation(async () => page(['Alpha']));
      const onResetFilters = vi.fn();
      const view = render(<Grid extraNarrows onResetFilters={onResetFilters} />);
      expect(await screen.findByText('common:filters.resultCount:1')).toBeInTheDocument();
      fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.resetFilters' }));
      expect(onResetFilters).toHaveBeenCalledTimes(1);
      view.unmount();
    }, 20_000);

    it('says a control of the page hides every row, and clears it with the filters', async () => {
      get.mockImplementation(async () => page([]));
      const onResetFilters = vi.fn();
      const view = render(<Grid extraNarrows onResetFilters={onResetFilters} emptyState={<span>Nothing at all</span>} />);
      expect(await screen.findByText('common:filters.noResultsFiltered')).toBeInTheDocument();
      expect(screen.queryByText('Nothing at all')).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'common:filters.clearAll' }));
      expect(onResetFilters).toHaveBeenCalledTimes(1);
      view.unmount();
    }, 20_000);
  });

  describe('status column and Show scope', () => {
    it('keeps the status column filter and the Show scope in step, both ways', async () => {
      get.mockImplementation(async () => page(['Alpha']));
      const view = render(<Grid withScope />);
      expect(await screen.findByText('Alpha')).toBeInTheDocument();
      // The status column's floating filter, found by its header's column index.
      const statusFilter = () => {
        const index = document.querySelector('.ag-header-cell[col-id="status"]')!.getAttribute('aria-colindex');
        return document.querySelector(`.ag-floating-filter[aria-colindex="${index}"]`) as HTMLElement;
      };
      await waitFor(() => expect(within(statusFilter()).getByRole('button', { name: 'common:labels.enabled' })).toBeInTheDocument());

      // Show scope → column filter.
      fireEvent.click(screen.getByRole('radio', { name: 'common:labels.disabled' }));
      await waitFor(() => expect(within(statusFilter()).getByRole('button', { name: 'common:labels.disabled' })).toBeInTheDocument());

      // Column filter → Show scope.
      fireEvent.click(within(statusFilter()).getByRole('button', { name: 'common:labels.disabled' }));
      const popup = await waitFor(() => {
        const element = document.querySelector('.ag-popup') as HTMLElement | null;
        expect(element).not.toBeNull();
        expect(within(element!).getByRole('radio', { name: 'common:labels.disabled' })).toBeChecked();
        return element!;
      });
      fireEvent.click(within(popup).getByRole('radio', { name: 'common:labels.all' }));
      await waitFor(() => {
        const toolbarAll = screen.getAllByRole('radio', { name: 'common:labels.all' }).find((radio) => !popup.contains(radio));
        expect(toolbarAll).toBeChecked();
      });
      const lastParams = () => (get.mock.calls[get.mock.calls.length - 1][1] as Config).params;
      await waitFor(() => expect(lastParams()).toEqual(expect.objectContaining({ includeDisabled: '1' })));
      expect(lastParams().filters).toBeUndefined();
      expect(within(statusFilter()).getByRole('button', { name: 'common:labels.all' })).toBeInTheDocument();

      // AG Grid listens for a click outside the popup from the tick after it opened.
      await new Promise((resolve) => { setTimeout(resolve, 20); });
      fireEvent.mouseDown(document.body);
      await waitFor(() => expect(document.querySelector('.ag-popup')).toBeNull());
      view.unmount();
    }, 20_000);
  });
});
