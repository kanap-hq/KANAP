import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const api = vi.hoisted(() => ({ get: vi.fn() }));
// One `t` for every render (a new one each time would loop effects); options are spelled out.
const i18n = vi.hoisted(() => ({
  t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: i18n.t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../components/PageHeader', () => ({ default: () => null }));
vi.mock('../components/csv/CsvExportDialog', () => ({ default: () => null }));
vi.mock('../components/csv/CsvImportDialog', () => ({ default: () => null }));
vi.mock('../lib/listContext', () => ({
  getWithListContext: (endpoint: string, params: Record<string, unknown>) => api.get(endpoint, params),
}));
vi.mock('../components/ServerDataGrid', () => ({
  DATE_COLUMN_FILTER: { filter: 'agDateColumnFilter' },
  default: (props: Record<string, any>) => {
    grid.props = props;
    return <div data-testid="toolbar">{props.toolbarExtras}</div>;
  },
}));

import CheckboxSetFilter from '../components/CheckboxSetFilter';
import CheckboxSetFloatingFilter from '../components/CheckboxSetFloatingFilter';
import ContractsPage, { daysFromToday, isToDecideOnly } from './ContractsPage';

type Col = {
  field?: string;
  colId?: string;
  filter?: unknown;
  sortable?: boolean;
  defaultHidden?: boolean;
  floatingFilterComponent?: unknown;
  filterParams?: { values?: unknown };
  valueFormatter?: (params: any) => string;
  valueGetter?: (params: any) => unknown;
  cellRenderer?: (params: any) => React.ReactElement | null;
};

const TOTALS = {
  count: 18,
  yearly_amount: 3_833_400,
  reporting_currency: 'EUR',
  fx_year: 2026,
  excluded: [{ currency: 'GBP', count: 1 }],
  to_decide_count: 4,
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/ops/contracts']}>
        <ContractsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The grid reports its request, as it does once ready and on every search, filter or scope change. */
function report(filterModel: Record<string, unknown> = {}, statusScope = 'enabled') {
  act(() => {
    grid.props?.onQueryStateChange({ sort: 'next_due_date:ASC', q: '', filterModel, statusScope });
  });
}

const columns = () => grid.props?.columns as Col[];
const column = (field: string) => columns().find((c) => c.field === field || c.colId === field)!;

function renderCell(field: string, data: Record<string, unknown>) {
  const Cell = column(field).cellRenderer as unknown as React.ComponentType<any>;
  return render(<MemoryRouter><Cell data={data} value={data[field]} /></MemoryRouter>);
}

const isoDaysFromToday = (days: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + days)).toISOString().slice(0, 10);
};

describe('ContractsPage', () => {
  beforeEach(() => {
    grid.props = null;
    api.get.mockReset();
    api.get.mockResolvedValue({ data: TOTALS });
  });

  it('shows a status column with a checkbox filter and translated cells', () => {
    renderPage();
    const status = column('status');
    expect(status.filter).toBe(CheckboxSetFilter);
    expect(status.floatingFilterComponent).toBe(CheckboxSetFloatingFilter);
    expect(status.filterParams?.values).toEqual([
      { value: 'enabled', label: 'common:statuses.enabled' },
      { value: 'disabled', label: 'common:statuses.disabled' },
    ]);
    expect(status.valueFormatter?.({ value: 'disabled' })).toBe('common:statuses.disabled');
  });

  it('lists active contracts by default and offers the other scopes', () => {
    renderPage();
    expect(grid.props?.statusScopeConfig).toEqual({ defaultScope: 'enabled' });
  });

  it('carries the grid scope into the workspace link, so prev/next walks the same contracts', () => {
    renderPage();
    act(() => {
      grid.props?.onQueryStateChange({ sort: 'name:ASC', q: '', filterModel: {}, statusScope: 'all' });
    });
    const { container } = render(
      <MemoryRouter>
        {column('name').cellRenderer!({ value: 'Expired contract', data: { id: 'c-1', name: 'Expired contract' } })}
      </MemoryRouter>,
    );
    const href = container.querySelector('a')?.getAttribute('href') ?? '';
    expect(href.startsWith('/ops/contracts/c-1/overview?')).toBe(true);
    const params = new URLSearchParams(href.split('?')[1]);
    expect(params.get('scope')).toBe('all');
    expect(params.get('sort')).toBe('name:ASC');
  });

  it('sorts on the next due date and keeps the term details in the column chooser', () => {
    renderPage();
    expect(grid.props?.defaultSort).toEqual({ field: 'next_due_date', direction: 'ASC' });
    const hidden = columns().filter((c) => c.defaultHidden).map((c) => c.field ?? c.colId);
    for (const field of ['start_date', 'duration_months', 'auto_renewal', 'notice_period_months', 'billing_frequency']) {
      expect(hidden).toContain(field);
    }
    for (const field of ['name', 'supplier_name', 'company_name', 'next_due_date', 'term_state', 'yearly_amount_at_signature', 'linked_lines_count', 'status']) {
      expect(hidden).not.toContain(field);
    }
    expect(column('linked_lines_count').valueGetter?.({ data: { linked_lines_count: 3 }, node: {} })).toBe(3);
  });

  it('shows the next due date with the days left, and the end of an ended contract', () => {
    renderPage();
    const due = isoDaysFromToday(19);
    renderCell('next_due_date', { id: 'c-1', next_due_date: due, term_state: 'to_decide' });
    expect(screen.getByText(/contracts\.list\.dueIn \{"count":19\}/)).toBeInTheDocument();
    renderCell('next_due_date', { id: 'c-2', next_due_date: null, term_state: 'expired', current_term_end: '2026-05-31' });
    expect(screen.getByText('31 May 2026')).toBeInTheDocument();
    expect(daysFromToday(isoDaysFromToday(-3))).toBe(-3);
  });

  it('shows the state as a dot and a label, the renewal date for a renewed contract, with a state filter', () => {
    renderPage();
    const state = column('term_state');
    expect(state.filter).toBe(CheckboxSetFilter);
    expect(state.sortable).toBe(false);
    expect((state.filterParams?.values as Array<{ value: string }>).map((v) => v.value)).toEqual([
      'to_decide', 'in_progress', 'renewed', 'ending', 'expired',
    ]);
    renderCell('term_state', { id: 'c-1', term_state: 'to_decide' });
    expect(screen.getByText('contracts.list.states.to_decide')).toBeInTheDocument();
    renderCell('term_state', { id: 'c-2', term_state: 'renewed', current_term_end: '2026-12-31' });
    expect(screen.getByText('contracts.list.states.renewedOn {"date":"1 Jan 2027"}')).toBeInTheDocument();
  });

  it('adds a totals row for the request the grid shows, naming the currencies without a rate', async () => {
    renderPage();
    report({ name: { filterType: 'text', type: 'contains', filter: 'sap' } }, 'all');
    await waitFor(() => expect(grid.props?.pinnedBottomRowData).toHaveLength(1));
    expect(api.get).toHaveBeenCalledWith('/contracts/totals', {
      includeDisabled: '1',
      filters: JSON.stringify({ name: { filterType: 'text', type: 'contains', filter: 'sap' } }),
    });
    const [row] = grid.props!.pinnedBottomRowData;
    expect(row.name).toBe('contracts.list.total {"count":18} · contracts.list.totalExcluded {"count":1,"currency":"GBP"}');
    const amount = column('yearly_amount_at_signature');
    expect(amount.valueFormatter?.({ value: row.yearly_amount_at_signature, data: row, node: { rowPinned: 'bottom' } })).toBe('3 833 400 EUR');
    expect(amount.valueFormatter?.({ value: 120000, data: { currency: 'USD' }, node: {} })).toBe('120 000');
    expect(column('auto_renewal').valueFormatter?.({ value: undefined, data: row, node: { rowPinned: 'bottom' } })).toBe('');
  });

  it('toggles the "to decide" quick filter on the state column, with the count from the server', async () => {
    renderPage();
    const setFilterModel = vi.fn();
    let model: Record<string, unknown> = { name: { filterType: 'text', type: 'contains', filter: 'a' } };
    act(() => {
      grid.props?.onGridApiReady({ getFilterModel: () => model, setFilterModel });
    });
    report(model);
    const toggle = await screen.findByRole('button', { name: /contracts\.list\.toDecide \{"days":90,"count":4\}/ });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(toggle);
    expect(setFilterModel).toHaveBeenLastCalledWith({ ...model, term_state: { filterType: 'set', values: ['to_decide'] } });

    model = { ...model, term_state: { filterType: 'set', values: ['to_decide'] } };
    report(model);
    await waitFor(() => expect(screen.getByRole('button', { name: /contracts\.list\.toDecide/ })).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(screen.getByRole('button', { name: /contracts\.list\.toDecide/ }));
    expect(setFilterModel).toHaveBeenLastCalledWith({ name: { filterType: 'text', type: 'contains', filter: 'a' } });
  });

  it('reads the quick filter as on only when the state filter keeps "to decide" alone', () => {
    expect(isToDecideOnly({ term_state: { filterType: 'set', values: ['to_decide'] } })).toBe(true);
    expect(isToDecideOnly({ term_state: { filterType: 'set', values: ['to_decide', 'expired'] } })).toBe(false);
    expect(isToDecideOnly({ term_state: { filterType: 'set', values: ['to_decide'], mode: 'exclude' } })).toBe(false);
    expect(isToDecideOnly(null)).toBe(false);
  });
});
