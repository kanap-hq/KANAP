import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The column chooser's search box: it filters the list by the label shown, folded like every other
 * search box of the app, and toggling a column keeps working while the list is filtered. Hiding a
 * column also drops its filter: AG Grid keeps filtering on a hidden column.
 *
 * The grid itself is not rendered (jsdom has no layout): the fake API answers what the chooser
 * reads and writes, visibility, the column state and the filter model.
 */

const { gridApi, gridProps, hiddenColumns, filterModel } = vi.hoisted(() => {
  const hidden = new Set<string>();
  const model = { filters: {} as Record<string, unknown> };
  return {
    hiddenColumns: hidden,
    filterModel: model,
    gridProps: { current: null as any },
    gridApi: {
      setColumnsVisible: vi.fn((fields: string[], visible: boolean) => {
        for (const field of fields) {
          if (visible) hidden.delete(field);
          else hidden.add(field);
        }
      }),
      getColumnState: vi.fn(() => Array.from(hidden, (colId) => ({ colId, hide: true }))),
      purgeInfiniteCache: vi.fn(),
      // Filters are keyed by column id while the chooser names a column by its field or id.
      getColumn: vi.fn((key: string) => ({ getColId: () => key })),
      getFilterModel: vi.fn(() => ({ ...model.filters })),
      setFilterModel: vi.fn((next: Record<string, unknown>) => { model.filters = { ...next }; }),
    },
  };
});

vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string, opts?: Record<string, unknown>) => (opts && Object.keys(opts).length
      ? `${key}(${Object.values(opts).join(',')})`
      : key),
    i18n: { language: 'en', resolvedLanguage: 'en', getResourceBundle: () => ({}) },
  };
  return { useTranslation: () => translation };
});
vi.mock('ag-grid-react', async () => {
  const { useEffect } = await import('react');
  return {
    AgGridReact: (props: any) => {
      gridProps.current = props;
      useEffect(() => { props.onGridReady?.({ api: gridApi }); });
      return null;
    },
  };
});
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [], total: 0 } })) } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ profile: null }) }));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'test' }) }));
vi.mock('../config/ThemeContext', () => ({ useThemeMode: () => ({ resolvedMode: 'light' }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));

import ServerDataGrid from './ServerDataGrid';

const SEARCH = 'common:columnChooser.searchPlaceholder';
const NO_MATCH = 'common:columnChooser.noMatch';
const CLEAR = 'common:columnChooser.clearSearch';

/** The columns the chooser lists: none of them renders a cell, so only their names matter. */
type ChooserRow = {
  id: string;
  name: string;
  notes: string;
  budget_y: number;
  budget_fte: number;
  remuneration: string;
  oeuvre: string;
  internal_code: string;
};

/** Opens the chooser of a grid with one hidden column, a required one, and accents. */
function renderChooser() {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  render(
    <MemoryRouter>
      <ServerDataGrid<ChooserRow>
        columns={[
          { field: 'name', headerName: 'Name', required: true },
          { field: 'notes', headerName: 'Notes' },
          { field: 'budget_y', headerName: 'Budget Y (2026)' },
          { field: 'budget_fte', headerName: 'Budget FTE (2026)', defaultHidden: true },
          { field: 'remuneration', headerName: 'Rémunération' },
          { field: 'oeuvre', headerName: 'Œuvre' },
          { field: 'internal_code' },
        ]}
        endpoint="/things"
        queryKey="things"
      />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'common:buttons.chooseColumns' }));
}

const searchBox = () => screen.getByPlaceholderText(SEARCH) as HTMLInputElement;

describe('ServerDataGrid column chooser search', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // One column hidden, so ticking one has something to change.
    hiddenColumns.clear();
    hiddenColumns.add('budget_fte');
    filterModel.filters = {};
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('lists every column before anything is typed', () => {
    renderChooser();
    expect(screen.getAllByRole('checkbox')).toHaveLength(7);
    expect(screen.queryByText(NO_MATCH)).toBeNull();
  });

  it('filters the list to the columns whose label holds the typed text', () => {
    renderChooser();

    fireEvent.change(searchBox(), { target: { value: 'Budget' } });

    expect(screen.getByRole('checkbox', { name: 'Budget Y (2026)' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'Budget FTE (2026)' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Notes' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'internal_code' })).toBeNull();
  });

  it('ignores case, accents and ligatures, like every other search box', () => {
    renderChooser();

    fireEvent.change(searchBox(), { target: { value: 'RÉMUNÉRATION' } });
    expect(screen.getByRole('checkbox', { name: 'Rémunération' })).toBeInTheDocument();

    fireEvent.change(searchBox(), { target: { value: 'oeuvre' } });
    expect(screen.getByRole('checkbox', { name: 'Œuvre' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Rémunération' })).toBeNull();
  });

  it('matches the field of a column that has no header name', () => {
    renderChooser();

    fireEvent.change(searchBox(), { target: { value: 'internal' } });

    expect(screen.getByRole('checkbox', { name: 'internal_code' })).toBeInTheDocument();
  });

  it('keeps the required mark on a required column, and it stays untickable', () => {
    renderChooser();

    fireEvent.change(searchBox(), { target: { value: 'Name' } });

    expect(screen.getByRole('checkbox', { name: /Name/ })).toBeDisabled();
    expect(screen.getByText('common:labels.requiredTag')).toBeInTheDocument();
  });

  it('says so when nothing matches, and the clear button brings the whole list back', () => {
    renderChooser();

    fireEvent.change(searchBox(), { target: { value: 'nothing matches this' } });

    expect(screen.getByText(NO_MATCH)).toBeInTheDocument();
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    // Reset and Done stay reachable while the list is filtered away.
    expect(screen.getByRole('button', { name: 'common:buttons.reset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common:buttons.done' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: CLEAR }));

    expect(searchBox()).toHaveValue('');
    expect(screen.queryByText(NO_MATCH)).toBeNull();
    expect(screen.getAllByRole('checkbox')).toHaveLength(7);
  });

  it('starts unfiltered on every opening', () => {
    renderChooser();
    fireEvent.change(searchBox(), { target: { value: 'Budget' } });

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.done' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.chooseColumns' }));

    expect(searchBox()).toHaveValue('');
    expect(screen.getAllByRole('checkbox')).toHaveLength(7);
  });

  it('ticks a column while the list is filtered, and keeps the filter', () => {
    renderChooser();
    fireEvent.change(searchBox(), { target: { value: 'Budget FTE' } });

    const fte = screen.getByRole('checkbox', { name: 'Budget FTE (2026)' });
    expect(fte).not.toBeChecked();
    fireEvent.click(fte);

    expect(gridApi.setColumnsVisible).toHaveBeenCalledWith(['budget_fte'], true);
    expect(fte).toBeChecked();
    expect(searchBox()).toHaveValue('Budget FTE');
    expect(screen.queryByRole('checkbox', { name: 'Notes' })).toBeNull();
  });

  it('unchecking a filtered column drops its filter from the model', () => {
    renderChooser();
    filterModel.filters = {
      notes: { filterType: 'text', type: 'contains', filter: 'abc' },
      budget_y: { filterType: 'text', type: 'contains', filter: '10' },
    };

    fireEvent.click(screen.getByRole('checkbox', { name: 'Notes' }));

    expect(gridApi.setFilterModel).toHaveBeenCalledTimes(1);
    expect(gridApi.setFilterModel).toHaveBeenCalledWith({ budget_y: { filterType: 'text', type: 'contains', filter: '10' } });
  });

  it('unchecking a column that has no filter leaves the model alone', () => {
    renderChooser();
    filterModel.filters = { notes: { filterType: 'text', type: 'contains', filter: 'abc' } };

    fireEvent.click(screen.getByRole('checkbox', { name: 'Budget Y (2026)' }));

    expect(gridApi.setFilterModel).not.toHaveBeenCalled();
  });

  it('checking a column never touches the model', () => {
    renderChooser();
    filterModel.filters = { notes: { filterType: 'text', type: 'contains', filter: 'abc' } };

    fireEvent.click(screen.getByRole('checkbox', { name: 'Budget FTE (2026)' }));

    expect(gridApi.setFilterModel).not.toHaveBeenCalled();
    expect(gridApi.getFilterModel).not.toHaveBeenCalled();
  });

  it('renders the grid so a header dragged out of it does not hide its column', () => {
    renderChooser();

    expect(gridProps.current.suppressDragLeaveHidesColumns).toBe(true);
  });
});
