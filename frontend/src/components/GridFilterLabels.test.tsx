import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => {
  const translation = {
    t: (key: string, opts?: Record<string, unknown>) => (opts && Object.keys(opts).length
      ? `${key}(${Object.values(opts).join(',')})`
      : key),
    i18n: { language: 'en', resolvedLanguage: 'en', getResourceBundle: () => ({}) },
  };
  return { useTranslation: () => translation };
});
vi.mock('ag-grid-react', () => ({ AgGridReact: () => null }));
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [], total: 0 } })) } }));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ profile: null }) }));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'test' }) }));
vi.mock('../config/ThemeContext', () => ({ useThemeMode: () => ({ resolvedMode: 'light' }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));

import ServerDataGrid from './ServerDataGrid';
import CheckboxSetFloatingFilter from './CheckboxSetFloatingFilter';
import ClearableColumnFloatingFilter from './ClearableColumnFloatingFilter';

describe('ServerDataGrid column chooser', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows its title, the required mark and its buttons translated', () => {
    // jsdom has no ResizeObserver; the grid only uses it to size itself.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    render(
      <MemoryRouter>
        <ServerDataGrid<{ id: string; name: string; notes: string }>
          columns={[{ field: 'name', headerName: 'Name', required: true }, { field: 'notes', headerName: 'Notes' }]}
          endpoint="/things"
          queryKey="things"
        />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.chooseColumns' }));
    expect(screen.getAllByText('common:buttons.chooseColumns')).toHaveLength(2);
    expect(screen.getByText('common:labels.requiredTag')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common:buttons.reset' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common:buttons.done' })).toBeInTheDocument();
    expect(screen.queryByText('Choose Columns')).toBeNull();
  });
});

describe('floating filters', () => {
  function gridApi(model: Record<string, unknown>) {
    return { getFilterModel: () => model, addEventListener: vi.fn(), removeEventListener: vi.fn(), setFilterModel: vi.fn() };
  }

  it('names the checkbox filter state in the user language', () => {
    const ref = React.createRef<any>();
    const props = { api: gridApi({}), column: { getColId: () => 'status' }, showParentFilter: vi.fn() } as any;
    render(<CheckboxSetFloatingFilter ref={ref} {...props} />);
    expect(screen.getByRole('button', { name: 'labels.all' })).toBeInTheDocument();

    act(() => { ref.current.onParentModelChanged({ filterType: 'set', values: ['enabled', 'disabled'] }); });
    expect(screen.getByRole('button', { name: 'filters.selectedCount(2)' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'filters.clearFilter' })).toBeInTheDocument();

    act(() => { ref.current.onParentModelChanged({ filterType: 'set', values: [] }); });
    expect(screen.getByRole('button', { name: 'labels.none' })).toBeInTheDocument();
  });

  it('translates the text filter placeholder and labels', () => {
    const props = {
      api: gridApi({}),
      column: { getColDef: () => ({ headerName: 'Name', field: 'name' }), getColId: () => 'name' },
    } as any;
    const { container } = render(<ClearableColumnFloatingFilter {...props} />);
    const input = screen.getByPlaceholderText('filters.columnPlaceholder');
    expect(input).toHaveAttribute('aria-label', 'filters.filterColumn(Name)');
    // The clear button stays in the layout, hidden until there is a value.
    expect(container.querySelector('button[aria-label="filters.clearFilter"]')).not.toBeNull();
  });
});
