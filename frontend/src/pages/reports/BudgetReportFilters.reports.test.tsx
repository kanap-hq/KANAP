import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { AMOUNT_COLUMNS } from '../../components/finance/amountColumns';
import type { CostCenterNode } from '../../services/costCenters';

vi.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key);
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
  const state = await import('./budgetColumnsTestState');
  return { ...actual, useBudgetColumns: () => state.mockedBudgetColumns(actual.resolveBudgetColumns) };
});
const tree = vi.hoisted(() => ({ nodes: [] as unknown[] }));
vi.mock('../../hooks/useCostCenterTree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useCostCenterTree')>();
  return { ...actual, useCostCenterTree: () => actual.buildCostCenterTree(tree.nodes as CostCenterNode[]) };
});
vi.mock('../../components/reports/ReportLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/reports/ReportLayout')>()),
  default: ({ filters, children }: { filters?: React.ReactNode; children?: React.ReactNode }) => (
    <div>
      <div data-testid="filters">{filters}</div>
      {children}
    </div>
  ),
}));
const chart = vi.hoisted(() => ({ options: null as any }));
vi.mock('../../components/reports/ChartCard', () => ({
  default: React.forwardRef(({ options }: { options: unknown }, _ref) => {
    chart.options = options;
    return null;
  }),
}));
vi.mock('../../components/reports/ReportGrid', () => ({
  default: ({ rowData }: { rowData?: unknown[] }) => <pre data-testid="grid">{JSON.stringify(rowData ?? [])}</pre>,
}));

import api from '../../api';
import { setBudgetColumns } from './budgetColumnsTestState';
import TopOpexReport from './TopOpexReport';
import OpexDeltaReport from './OpexDeltaReport';
import ComparisonReport from './ComparisonReport';
import CapexBudgetTrendReport from './CapexBudgetTrendReport';
import BudgetColumnsCompareReport from './BudgetColumnsCompareReport';
import ConsolidationReport from './ConsolidationReport';
import AnalyticsCategoryReport from './AnalyticsCategoryReport';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const Y = new Date().getFullYear();

function node(id: string, patch: Partial<CostCenterNode>): CostCenterNode {
  return {
    id, code: id.toUpperCase(), name: id, kind: 'cost_center', parent_id: null, company_id: 'co-1', company_name: 'Company',
    owner_user_id: null, owner_name: null, status: 'enabled', disabled_at: null, sort_order: 0, depth: 0, path: id, path_ids: [id],
    ...patch,
  };
}

// grp › (cc1, cc2 disabled, sub › cc3); out stands alone.
const NODES = [
  node('grp', { kind: 'group', company_id: null }),
  node('cc1', { parent_id: 'grp', depth: 1, path_ids: ['grp', 'cc1'] }),
  node('cc2', { parent_id: 'grp', depth: 1, path_ids: ['grp', 'cc2'], status: 'disabled' }),
  node('sub', { kind: 'group', company_id: null, parent_id: 'grp', depth: 1, path_ids: ['grp', 'sub'] }),
  node('cc3', { parent_id: 'sub', depth: 2, path_ids: ['grp', 'sub', 'cc3'] }),
  node('out', {}),
];

/** The same amount in every budget column, so the tests hold whatever column a report starts on. */
function slot(year: number, amount: number) {
  const columns = Object.fromEntries(AMOUNT_COLUMNS.map((column) => [column.key, amount]));
  return { year, totals: columns, reporting: { ...columns, currency: 'X', reporting_currency: 'X' } };
}

function line(id: string, costCenterId: string | null, runBuild: 'run' | 'build' | null, previous: number, current: number) {
  return {
    id,
    product_name: `Line ${id}`,
    description: `Line ${id}`,
    account_display: `Account ${id}`,
    analytics_category_id: `cat-${id}`,
    analytics_category_name: `Category ${id}`,
    cost_center_id: costCenterId,
    run_build: runBuild,
    versions: { yMinus1: slot(Y - 1, previous), y: slot(Y, current) } as Record<string, ReturnType<typeof slot>>,
  };
}

// Under grp: a, b (on a disabled cost center) and c (two levels down) = 123 in Y.
const ROWS = [
  line('a', 'cc1', 'run', 10, 100),
  line('b', 'cc2', 'build', 5, 20),
  line('c', 'cc3', null, 1, 3),
  line('d', 'out', 'run', 0, 1000),
  line('e', null, 'build', 0, 7000),
];
// Only a line outside every filter below has a Y+1 amount: the Delta year pickers must still offer it.
ROWS[4].versions.yPlus1 = slot(Y + 1, 1);

function renderReport(element: React.ReactElement, path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const gridRows = (index = 0) => JSON.parse(screen.getAllByTestId('grid')[index].textContent || '[]') as Array<Record<string, any>>;

beforeEach(() => {
  setBudgetColumns();
  tree.nodes = NODES;
  chart.options = null;
  get.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url.endsWith('/summary')) return { data: { items: ROWS, total: ROWS.length } };
    return { data: { items: [], total: 0 } };
  });
});

describe('Top items with a cost center group', () => {
  it('totals the lines of the group and every node below it, a disabled one included', async () => {
    renderReport(<TopOpexReport />, '/report?costCenter=grp');
    await waitFor(() => expect(gridRows().map((row) => [row.name, row.value])).toEqual([
      ['Line a', 100],
      ['Line b', 20],
      ['Line c', 3],
    ]));
    // The total the shares are taken on is the group's, 100 + 20 + 3.
    expect(chart.options.footnote.text).toMatch(/: 123$/);
    expect(gridRows()[0].pct_of_total).toBe(Math.round((100 / 123) * 100));
  });

  it('keeps every line when nothing is picked', async () => {
    renderReport(<TopOpexReport />, '/report');
    await waitFor(() => expect(gridRows()).toHaveLength(5));
    expect(chart.options.footnote.text).toMatch(/: 8 123$/);
  });
});

describe('Top increase / decrease with a cost center group', () => {
  it('ranks the increases of the group lines only', async () => {
    renderReport(<OpexDeltaReport />, '/report?costCenter=grp');
    await waitFor(() => expect(gridRows().map((row) => [row.name, row.delta])).toEqual([
      ['Line a', 90],
      ['Line b', 15],
      ['Line c', 2],
    ]));
  });
});

describe.each([
  ['OPEX trend', ComparisonReport],
  ['CAPEX trend', CapexBudgetTrendReport],
])('%s with run only', (_name, Report) => {
  it('sums the run lines per year', async () => {
    renderReport(<Report />, '/report?runBuild=run');
    await waitFor(() => expect(gridRows()[0]?.[String(Y)]).toBe(1100));
    expect(gridRows()[0][String(Y - 1)]).toBe(10);
  });
});

describe('Budget column comparison with a group and build only', () => {
  it('sums the build lines of the group', async () => {
    renderReport(<BudgetColumnsCompareReport />, '/report?costCenter=grp&runBuild=build');
    await waitFor(() => expect(gridRows()[0]?.total).toBe(20));
    expect(gridRows()[0].year).toBe(Y);
  });
});

describe.each([
  ['Consolidation', ConsolidationReport],
  ['Analytics', AnalyticsCategoryReport],
])('%s with lines that say neither run nor build', (_name, Report) => {
  it('groups those lines only', async () => {
    renderReport(<Report />, '/report?runBuild=none');
    await waitFor(() => expect(gridRows().map((row) => row[String(Y)])).toEqual([3]));
  });
});

/** The options an autocomplete or select offers, read and closed again. */
async function optionsOf(name: string, open: 'keyDown' | 'mouseDown') {
  const control = screen.getByRole('combobox', { name });
  if (open === 'keyDown') fireEvent.keyDown(control, { key: 'ArrowDown' });
  else fireEvent.mouseDown(control);
  const listbox = await screen.findByRole('listbox');
  const options = within(listbox).getAllByRole('option').map((option) => option.textContent);
  fireEvent.keyDown(open === 'keyDown' ? control : listbox, { key: 'Escape' });
  return options;
}

const EVERY_LINE = ['Line a', 'Line b', 'Line c', 'Line d', 'Line e'];
const EVERY_ACCOUNT = ['Account a', 'Account b', 'Account c', 'Account d', 'Account e'];

describe('Option lists under a filter', () => {
  // grp and run together keep line a only; every picker below must still list all five lines.
  const path = '/report?costCenter=grp&runBuild=run';

  it.each([
    ['Top items', TopOpexReport],
    ['Top increase / decrease', OpexDeltaReport],
  ])('%s: the item and account exclusions offer every line', async (_name, Report) => {
    renderReport(<Report />, path);
    await waitFor(() => expect(gridRows().map((row) => row.name)).toEqual(['Line a']));
    expect(await optionsOf('reports.filters.excludeItems', 'keyDown')).toEqual(EVERY_LINE);
    expect(await optionsOf('reports.filters.excludeAccounts', 'keyDown')).toEqual(EVERY_ACCOUNT);
  });

  it('Top increase / decrease: the year pickers offer the years of every line', async () => {
    renderReport(<OpexDeltaReport />, path);
    await waitFor(() => expect(gridRows().map((row) => row.name)).toEqual(['Line a']));
    const years = [String(Y - 1), String(Y), String(Y + 1)];
    expect(await optionsOf('reports.filters.sourceYear', 'mouseDown')).toEqual(years);
    expect(await optionsOf('reports.filters.destinationYear', 'mouseDown')).toEqual(years);
  });

  it('Analytics: the category exclusion offers the categories of every line', async () => {
    renderReport(<AnalyticsCategoryReport />, path);
    await waitFor(() => expect(gridRows().map((row) => row[String(Y)])).toEqual([100]));
    expect(await optionsOf('reports.filters.excludeCategories', 'keyDown')).toEqual([
      'Category a', 'Category b', 'Category c', 'Category d', 'Category e',
    ]);
  });
});
