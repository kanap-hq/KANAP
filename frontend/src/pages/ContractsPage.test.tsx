import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { createAppTheme } from '../config/ThemeContext';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), delete: vi.fn() }));
// One `t` for every render (a new one each time would loop effects); options are spelled out.
const i18n = vi.hoisted(() => ({
  t: (key: string, opts?: Record<string, unknown>) => (opts ? `${key} ${JSON.stringify(opts)}` : key),
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: i18n.t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
const auth = vi.hoisted(() => ({ budget: true, limited: false }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string) => resource !== 'budget' || auth.budget,
    profile: { id: 'user-1' },
    dataAccess: auth.limited ? { available: true, mode: 'limited', nodes: [], modules: ['contracts'] } : null,
  }),
}));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'fromage' }) }));
vi.mock('../services/budgetColumns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/budgetColumns')>();
  return {
    ...actual,
    // The tenant names its first column and hides the third: the list offers the shown ones by name.
    getBudgetColumns: async () => ({ ...actual.DEFAULT_BUDGET_COLUMNS, labels: { ...actual.DEFAULT_BUDGET_COLUMNS.labels, planned: 'Initial' } }),
  };
});
vi.mock('../components/PageHeader', () => ({ default: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div> }));
const download = vi.hoisted(() => ({ blob: vi.fn() }));
vi.mock('../utils/downloadBlob', () => ({ downloadBlob: download.blob, extractFilenameFromDisposition: () => null }));
const csvDialogs = vi.hoisted(() => ({ export: null as null | Record<string, any>, import: null as null | Record<string, any> }));
vi.mock('../components/csv/CsvExportDialog', () => ({
  default: (props: Record<string, any>) => { csvDialogs.export = props; return null; },
}));
vi.mock('../components/csv/CsvImportDialog', () => ({
  default: (props: Record<string, any>) => { csvDialogs.import = props; return null; },
}));
vi.mock('../api', () => ({ default: { get: api.get, post: api.post, delete: api.delete } }));
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
import ContractsPage, { budgetQuickFilterOf, daysFromToday, isToDecideOnly } from './ContractsPage';

type Col = {
  field?: string;
  colId?: string;
  headerName?: string;
  width?: number;
  filter?: unknown;
  sortable?: boolean;
  defaultHidden?: boolean;
  floatingFilterComponent?: unknown;
  filterParams?: { values?: unknown };
  valueFormatter?: (params: any) => string;
  valueGetter?: (params: any) => unknown;
  cellRenderer?: (params: any) => React.ReactElement | null;
};

const NEXT_YEAR = new Date().getFullYear() + 1;

const TOTALS = {
  count: 18,
  yearly_amount: 3_833_400,
  reporting_currency: 'EUR',
  fx_year: 2026,
  excluded: [{ currency: 'GBP', count: 1 }],
  to_decide_count: 4,
  // The tenant's window comes with the totals (not the default of 90 days).
  decision_window_days: 45,
  budget: {
    year: NEXT_YEAR,
    column: 'planned',
    reporting_currency: 'EUR',
    committed: 2_993_754,
    linked: 1_200_000,
    gap: -1_793_754,
    excluded: [{ currency: 'USD', count: 1 }],
    no_line_count: 3,
    under_count: 2,
    years: [NEXT_YEAR - 2, NEXT_YEAR - 1, NEXT_YEAR, NEXT_YEAR + 1],
  },
};

/** A localStorage for the tests (jsdom has none here). */
function stubStorage(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  const storage = {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
  };
  Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  return store;
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/ops/contracts']}>
          <ContractsPage />
        </MemoryRouter>
      </ThemeProvider>
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
    auth.budget = true;
    auth.limited = false;
    stubStorage();
    api.get.mockReset();
    api.get.mockResolvedValue({ data: TOTALS });
    api.post.mockReset();
    api.delete.mockReset();
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

  it('offers a hidden cost centre column and the without-cost-centre filter', () => {
    renderPage();
    const costCenter = column('cost_center_id');
    expect(costCenter.headerName).toBe('contracts.columns.costCenter');
    expect(costCenter.defaultHidden).toBe(true);
    expect(costCenter.filterParams?.values).toEqual([{ value: null, label: 'contracts.list.withoutCostCenter' }]);
    expect(costCenter.valueGetter?.({ data: { cost_center_name: 'INF-FR' } })).toBe('INF-FR');
    expect(costCenter.valueGetter?.({ data: {} })).toBe('');
    expect(within(screen.getByTestId('toolbar')).getByRole('button', { name: 'contracts.list.withoutCostCenter' })).toBeInTheDocument();
  });

  it('hides the import and the settings from a limited person but keeps the export', () => {
    auth.limited = true;
    renderPage();
    expect(screen.queryByRole('button', { name: 'contracts.importCsv' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'contracts.renewal.settings.button' })).toBeNull();
    expect(screen.getByRole('button', { name: 'common:export.button' })).toBeInTheDocument();
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
    expect(column('next_due_date').width).toBe(360);
    const due = isoDaysFromToday(19);
    const deadline = isoDaysFromToday(40);
    const termEnd = isoDaysFromToday(130);
    // A contract that stops: the next due date is its end, even when a notice deadline is also known.
    const stopping = renderCell('next_due_date', {
      id: 'c-1',
      next_due_date: due,
      current_term_end: due,
      next_cancellation_deadline: deadline,
      term_state: 'to_decide',
      auto_renewal: false,
      notice_period_months: 3,
    });
    expect(within(stopping.container).getByText(/contracts\.deadlines\.endsOn \{"date":/)).toBeInTheDocument();
    expect(within(stopping.container).queryByText(/contracts\.deadlines\.cancelUntil/)).toBeNull();
    expect(within(stopping.container).getByText(/contracts\.list\.dueIn \{"count":19\}/)).toBeInTheDocument();
    expect(stopping.container.querySelector('span')?.getAttribute('title')).toMatch(/contracts\.deadlines\.endsOn/);
    expect(stopping.container.querySelector('span')?.getAttribute('title')).toMatch(/contracts\.list\.dueIn \{"count":19\}/);
    // A tacit renewal with a notice period: the next due date is the cancellation deadline, before the term ends.
    const renewing = renderCell('next_due_date', {
      id: 'c-renew',
      next_due_date: deadline,
      next_cancellation_deadline: deadline,
      current_term_end: termEnd,
      term_state: 'to_decide',
      auto_renewal: true,
      notice_period_months: 3,
    });
    expect(within(renewing.container).getByText(/contracts\.deadlines\.cancelUntil \{"date":/)).toBeInTheDocument();
    expect(within(renewing.container).queryByText(/contracts\.deadlines\.endsOn/)).toBeNull();
    expect(within(renewing.container).getByText(/contracts\.list\.dueIn \{"count":40\}/)).toBeInTheDocument();
    // No notice: the deadline is the term end, so the cell names the end.
    const noNotice = renderCell('next_due_date', {
      id: 'c-same',
      next_due_date: due,
      next_cancellation_deadline: due,
      current_term_end: due,
      term_state: 'in_progress',
      auto_renewal: true,
      notice_period_months: 0,
    });
    expect(within(noNotice.container).getByText(/contracts\.deadlines\.endsOn \{"date":/)).toBeInTheDocument();
    expect(within(noNotice.container).queryByText(/contracts\.deadlines\.cancelUntil/)).toBeNull();
    const today = renderCell('next_due_date', {
      id: 'c-today',
      next_due_date: isoDaysFromToday(0),
      current_term_end: isoDaysFromToday(0),
      term_state: 'ending',
    });
    expect(within(today.container).getByText(/contracts\.list\.dueToday/)).toBeInTheDocument();
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
      budget_year: String(NEXT_YEAR),
      budget_column: 'planned',
      filters: JSON.stringify({ name: { filterType: 'text', type: 'contains', filter: 'sap' } }),
    });
    const [row] = grid.props!.pinnedBottomRowData;
    expect(row.name).toBe('contracts.list.total {"count":18}');
    const { container: notes } = render(<>{grid.props!.footer}</>);
    expect(notes).toHaveTextContent('contracts.list.totalExcluded {"count":1,"currency":"GBP"}');
    expect(notes).toHaveTextContent(`contracts.list.committedExcluded {"count":1,"currency":"USD","year":${NEXT_YEAR}}`);
    expect(within(notes).getByText(/contracts\.list\.committedExcluded/)).toHaveStyle({
      whiteSpace: 'normal',
      overflowWrap: 'anywhere',
    });
    const amount = column('yearly_amount_at_signature');
    expect(amount.valueFormatter?.({ value: row.yearly_amount_at_signature, data: row, node: { rowPinned: 'bottom' } })).toBe('3 833 400 EUR');
    expect(amount.valueFormatter?.({ value: 120000, data: { currency: 'USD' }, node: {} })).toBe('120 000');
    expect(column('auto_renewal').valueFormatter?.({ value: undefined, data: row, node: { rowPinned: 'bottom' } })).toBe('');
  });

  it('toggles the "to decide" quick filter on the state column, with the count and the window from the server', async () => {
    renderPage();
    const setFilterModel = vi.fn();
    let model: Record<string, unknown> = { name: { filterType: 'text', type: 'contains', filter: 'a' } };
    act(() => {
      grid.props?.onGridApiReady({ getFilterModel: () => model, setFilterModel });
    });
    report(model);
    const toggle = await screen.findByRole('button', { name: /contracts\.list\.toDecide \{"days":45,"count":4\}/ });
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

  it('adds the budget columns of next year on the default column, sent with every request', async () => {
    renderPage();
    await waitFor(() => expect(grid.props?.extraParams).toEqual({ budget_year: String(NEXT_YEAR), budget_column: 'planned' }));
    const committed = column('budget_committed') as Col & { headerName?: string; filter?: unknown };
    expect(committed.headerName).toBe(`contracts.columns.committed {"year":${NEXT_YEAR}}`);
    expect(committed.filter).toBe('agNumberColumnFilter');
    expect((column('budget_linked') as Col & { headerName?: string }).headerName).toBe(`contracts.columns.budgetLinked {"year":${NEXT_YEAR}}`);
    expect(column('budget_gap').filter).toBe('agNumberColumnFilter');
    const state = column('budget_state');
    expect(state.defaultHidden).toBe(true);
    expect(state.filter).toBe(CheckboxSetFilter);
    expect((state.filterParams?.values as Array<{ value: string }>).map((v) => v.value)).toEqual([
      'covered', 'under', 'over', 'no_line', 'no_commitment', 'not_started',
    ]);
    // The workspace link carries them, so prev / next walks the same order.
    act(() => {
      grid.props?.onQueryStateChange({ sort: 'budget_gap:ASC', q: '', filterModel: {}, statusScope: 'enabled' });
    });
    const { container } = render(<MemoryRouter>{column('name').cellRenderer!({ value: 'SAP', data: { id: 'c-1', name: 'SAP' } })}</MemoryRouter>);
    const params = new URLSearchParams((container.querySelector('a')?.getAttribute('href') ?? '').split('?')[1]);
    expect([params.get('sort'), params.get('budget_year'), params.get('budget_column')]).toEqual(['budget_gap:ASC', String(NEXT_YEAR), 'planned']);
  });

  it('shows the gap with its sign, the contracts without a line or past their end, and a missing rate', () => {
    renderPage();
    renderCell('budget_gap', { id: 'c-1', budget_gap: -1400, budget_state: 'under', budget_linked: 1000 });
    expect(screen.getByText('\u22121 400')).toBeInTheDocument();
    renderCell('budget_gap', { id: 'c-2', budget_gap: 200, budget_state: 'over', budget_linked: 1200 });
    expect(screen.getByText('+200')).toBeInTheDocument();
    renderCell('budget_gap', { id: 'c-3', budget_gap: -500, budget_state: 'no_line', budget_linked: 0 });
    expect(screen.getByText('contracts.list.gapNoLine')).toBeInTheDocument();
    renderCell('budget_gap', { id: 'c-4', budget_gap: 85000, budget_state: 'over', budget_linked: 85000, term_state: 'expired' });
    expect(screen.getByText('contracts.list.gapExpired')).toBeInTheDocument();
    renderCell('budget_committed', { id: 'c-5', budget_committed: null, budget_linked: 0, currency: 'GBP' });
    expect(screen.getByText('contracts.budget.noRate {"currency":"GBP"}')).toBeInTheDocument();
    renderCell('budget_state', { id: 'c-6', budget_state: 'under' });
    expect(screen.getByText('contracts.budget.states.under')).toBeInTheDocument();
  });

  it('marks a linked amount that leaves out a line without a rate, with no state, and names those lines under the totals', async () => {
    renderPage();
    report();
    await waitFor(() => expect(grid.props?.pinnedBottomRowData).toHaveLength(1));
    expect(grid.props!.pinnedBottomRowData[0].name).toBe('contracts.list.total {"count":18}');
    render(<>{grid.props!.footer}</>);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();

    const Linked = column('budget_linked').cellRenderer as unknown as React.ComponentType<any>;
    const markName = `contracts.budget.linkedFxMissing {"year":${NEXT_YEAR}}`;
    render(<Linked data={{ id: 'c-1', budget_linked: 1000, budget_linked_fx_missing: true, budget_gap: null, budget_state: null }} year={NEXT_YEAR} />);
    expect(screen.getByText('1 000')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: markName })).toBeInTheDocument();
    render(<Linked data={{ id: 'c-2', budget_linked: 500, budget_gap: 0, budget_state: 'covered' }} year={NEXT_YEAR} />);
    expect(screen.getAllByRole('img', { name: markName })).toHaveLength(1);
    const { container: state } = renderCell('budget_state', { id: 'c-1', budget_state: null, budget_linked_fx_missing: true });
    expect(state.textContent).toBe('');

    api.get.mockResolvedValue({ data: { ...TOTALS, budget: { ...TOTALS.budget, linked_fx_missing: [{ currency: 'GBP', year: NEXT_YEAR, lines: 1 }] } } });
    report({ name: { filterType: 'text', type: 'contains', filter: 'SAP' } });
    await waitFor(() => {
      const children = React.Children.toArray(grid.props?.footer?.props?.children);
      expect(children).toHaveLength(2);
    });
    render(<MemoryRouter>{grid.props!.footer}</MemoryRouter>);
    const notice = screen.getByRole('status');
    expect(notice).toHaveTextContent('ops:shared.fxMissing.excluding');
    expect(notice).toHaveTextContent('GBP');
    expect(notice).toHaveStyle({ maxWidth: '100%' });
    expect(within(notice).getByText(/ops:shared.fxMissing.excluding/)).toHaveStyle({
      whiteSpace: 'normal',
      overflowWrap: 'anywhere',
    });
    expect(grid.props!.pinnedBottomRowData[0].name).not.toContain('committedExcluded');
    expect(screen.getAllByText(/contracts\.list\.committedExcluded/).length).toBeGreaterThan(0);
  });

  it('sums the budget columns in the totals row', async () => {
    renderPage();
    report();
    await waitFor(() => expect(grid.props?.pinnedBottomRowData).toHaveLength(1));
    const [row] = grid.props!.pinnedBottomRowData;
    expect([row.budget_committed, row.budget_linked, row.budget_gap]).toEqual([2_993_754, 1_200_000, -1_793_754]);
    const pinned = { node: { rowPinned: 'bottom' }, data: row };
    expect(column('budget_committed').valueFormatter?.({ ...pinned, value: row.budget_committed })).toBe('2 993 754');
    expect(column('budget_gap').valueFormatter?.({ ...pinned, value: row.budget_gap })).toBe('\u22121 793 754');
  });

  it('toggles the "no budget line" and "under-budgeted" quick filters on the budget state, one at a time', async () => {
    renderPage();
    const setFilterModel = vi.fn();
    let model: Record<string, unknown> = {};
    act(() => {
      grid.props?.onGridApiReady({ getFilterModel: () => model, setFilterModel });
    });
    report(model);
    const noLine = await screen.findByRole('button', { name: 'contracts.list.noBudgetLine {"count":3}' });
    const under = screen.getByRole('button', { name: 'contracts.list.underBudgeted {"count":2}' });
    fireEvent.click(noLine);
    expect(setFilterModel).toHaveBeenLastCalledWith({ budget_state: { filterType: 'set', values: ['no_line'] } });
    model = { budget_state: { filterType: 'set', values: ['no_line'] } };
    report(model);
    await waitFor(() => expect(screen.getByRole('button', { name: /contracts\.list\.noBudgetLine/ })).toHaveAttribute('aria-pressed', 'true'));
    fireEvent.click(under);
    expect(setFilterModel).toHaveBeenLastCalledWith({ budget_state: { filterType: 'set', values: ['under'] } });
    fireEvent.click(screen.getByRole('button', { name: /contracts\.list\.noBudgetLine/ }));
    expect(setFilterModel).toHaveBeenLastCalledWith({});
    expect(budgetQuickFilterOf({ budget_state: { filterType: 'set', values: ['under', 'no_line'] } })).toBeNull();
    expect(budgetQuickFilterOf({ budget_state: { filterType: 'set', values: ['covered'] } })).toBeNull();
  });

  it('keeps the year and column per user, shared with the contract page', async () => {
    const store = stubStorage({ 'kanap-contract-budget:fromage:user-1': JSON.stringify({ year: NEXT_YEAR - 1, column: 'actual' }) });
    renderPage();
    await waitFor(() => expect(grid.props?.extraParams).toEqual({ budget_year: String(NEXT_YEAR - 1), budget_column: 'actual' }));
    report();
    // The years the server offers, by name the columns the tenant shows.
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'contracts.list.budgetYear' }));
    fireEvent.click(await screen.findByRole('option', { name: String(NEXT_YEAR + 1) }));
    await waitFor(() => expect(grid.props?.extraParams).toEqual({ budget_year: String(NEXT_YEAR + 1), budget_column: 'actual' }));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'contracts.budget.column' }));
    expect(await screen.findByRole('option', { name: 'Initial' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'ops:operations.budgetColumns.forecast' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'Initial' }));
    await waitFor(() => expect(grid.props?.extraParams).toEqual({ budget_year: String(NEXT_YEAR + 1), budget_column: 'planned' }));
    expect(JSON.parse(store.get('kanap-contract-budget:fromage:user-1')!)).toEqual({ year: NEXT_YEAR + 1, column: 'planned' });
  });

  it('shows the compliance summary, sorted and filtered on the server', () => {
    renderPage();
    const compliance = column('compliance_state');
    expect(compliance.defaultHidden).toBeFalsy();
    expect(compliance.sortable).not.toBe(false);
    expect(compliance.filter).toBe(CheckboxSetFilter);
    expect(compliance.filterParams?.values).toEqual(['missing', 'to_check', 'complete', 'none'].map((value) => ({ value, label: `contracts.compliance.summary.states.${value}` })));
    expect(compliance.valueGetter?.({ data: { compliance: { state: 'complete' } }, node: {} })).toBe('complete');
    renderCell('compliance_state', { id: 'c-1', compliance: { expected: 5, missing: 2, to_check: 1, state: 'missing' } });
    expect(screen.getByText(/contracts\.compliance\.summary\.missing \{"count":2\}/)).toBeInTheDocument();
    expect(screen.getByText(/contracts\.compliance\.summary\.toCheck \{"count":1\}/)).toBeInTheDocument();
    renderCell('compliance_state', { id: 'c-2', compliance: { expected: 0, missing: 0, to_check: 0, state: 'none' } });
    expect(screen.getByText('contracts.compliance.summary.none')).toBeInTheDocument();
  });

  it('reads and writes the contracts file in the screen language, as the other master-data files', () => {
    renderPage();
    expect(csvDialogs.export).toMatchObject({ endpoint: '/contracts', flexibleFormat: true });
    expect(csvDialogs.import).toMatchObject({ endpoint: '/contracts', flexibleFormat: true });
  });

  it('exports the register of the contracts the list shows, in its order and the screen language, CSV or Excel', async () => {
    renderPage();
    const filters = { compliance_state: { filterType: 'set', values: ['missing'] } };
    report(filters);
    act(() => {
      grid.props?.onListRequestChange?.({ params: { sort: 'name:DESC', page: 1, limit: 50 }, total: 3 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'contracts.compliance.exportRegister' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'ops:reports.shared.exportXlsx' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/contracts/compliance-register/export', expect.objectContaining({
      language: 'en',
      format: 'xlsx',
      sort: 'name:DESC',
      filters: JSON.stringify(filters),
      budget_year: String(NEXT_YEAR),
    })));
    fireEvent.click(screen.getByRole('button', { name: 'contracts.compliance.exportRegister' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'ops:reports.shared.exportCsv' }));
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/contracts/compliance-register/export', expect.objectContaining({ format: 'csv', sort: 'name:DESC' })));
    await waitFor(() => expect(download.blob).toHaveBeenCalledWith(expect.any(Blob), 'contract-compliance-register.csv'));
  });

  const IMPACT = { contracts: 0, budget_lines: 0, applications: 0, assets: 0, contacts: 0, tasks: 0, links: 0, attachments: 0, blocked: 0, recorded_requirements: 0, refused: [] };
  const AUDITED = { id: 'c-3', name: 'Audited', code: 'CONTRACT_HAS_COMPLIANCE_RECORDS', usages: [{ type: 'compliance_requirements', total: 1 }] };

  it('deletes the selected contracts after a confirmation that counts what they are linked to', async () => {
    api.post.mockResolvedValue({ data: { ...IMPACT, contracts: 2, budget_lines: 3, assets: 1, attachments: 2 } });
    api.delete.mockResolvedValue({ data: { deleted: ['c-1', 'c-2'], failed: [] } });
    renderPage();
    expect(grid.props?.enableRowSelection).toBe(true);
    const button = screen.getByRole('button', { name: /buttons\.deleteSelected/ });
    expect(button).toBeDisabled();

    act(() => { grid.props?.onSelectionChanged([{ id: 'c-2', name: 'Oracle' }, { id: 'c-1', name: 'SAP' }]); });
    // Asked on click, not on every selection change.
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(button);
    await waitFor(() => expect(api.post).toHaveBeenCalledWith('/contracts/delete-impact', { ids: ['c-2', 'c-1'] }));

    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('contracts.delete.toDelete {"count":2}');
    expect(dialog).toHaveTextContent('contracts.delete.detached');
    expect(dialog).toHaveTextContent('contracts.delete.removed');
    fireEvent.click(within(dialog).getByRole('button', { name: 'contracts.delete.confirmAnyway' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/contracts/bulk', { data: { ids: ['c-2', 'c-1'] } }));
  });

  it('says what happens to contracts linked to nothing, in place of the generic warning', async () => {
    api.post.mockResolvedValue({ data: { ...IMPACT, contracts: 1 } });
    renderPage();
    act(() => { grid.props?.onSelectionChanged([{ id: 'c-1', name: 'SAP' }]); });
    fireEvent.click(screen.getByRole('button', { name: /buttons\.deleteSelected/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('contracts.delete.nothingLinked {"count":1}');
    expect(dialog).not.toHaveTextContent('delete.warningMessage');
    expect(within(dialog).getByRole('button', { name: 'buttons.delete' })).toBeInTheDocument();
  });

  it('names the contract it keeps for its recorded requirements and deletes only the other', async () => {
    api.post.mockResolvedValue({ data: { ...IMPACT, contracts: 1, blocked: 1, recorded_requirements: 1, refused: [AUDITED] } });
    api.delete.mockResolvedValue({ data: { deleted: ['c-1'], failed: [] } });
    renderPage();
    act(() => { grid.props?.onSelectionChanged([{ id: 'c-1', name: 'SAP' }, { id: 'c-3', name: 'Audited' }]); });
    fireEvent.click(screen.getByRole('button', { name: /buttons\.deleteSelected/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('delete.deleteSelectedTitle {"count":2}');
    expect(dialog).toHaveTextContent('contracts.delete.toDelete {"count":1}');
    expect(dialog).toHaveTextContent('contracts.delete.kept {"count":1}');
    expect(within(screen.getByTestId('delete-kept')).getByText('Audited')).toBeInTheDocument();
    expect(screen.getByTestId('delete-kept')).toHaveTextContent('common:delete.usages.compliance_requirements');
    fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.delete' }));
    await waitFor(() => expect(api.delete).toHaveBeenCalledWith('/contracts/bulk', { data: { ids: ['c-1'] } }));
  });

  it('shows the refusal, with Close only, for a single contract with recorded requirements', async () => {
    api.post.mockResolvedValue({ data: { ...IMPACT, blocked: 1, recorded_requirements: 1, refused: [AUDITED] } });
    renderPage();
    act(() => { grid.props?.onSelectionChanged([{ id: 'c-3', name: 'Audited' }]); });
    fireEvent.click(screen.getByRole('button', { name: /buttons\.deleteSelected/ }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('errors:CONTRACT_HAS_COMPLIANCE_RECORDS');
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent).filter(Boolean)).toEqual(['buttons.close']);
    expect(api.delete).not.toHaveBeenCalled();
  });

  it('shows no budget figure to a user who cannot read the budget', () => {
    auth.budget = false;
    renderPage();
    expect(grid.props?.extraParams).toEqual({});
    expect(columns().some((c) => (c.field ?? '').startsWith('budget_'))).toBe(false);
    expect(screen.queryByRole('button', { name: /contracts\.list\.noBudgetLine/ })).toBeNull();
    expect(screen.queryByRole('combobox', { name: 'contracts.list.budgetYear' })).toBeNull();
  });
});
