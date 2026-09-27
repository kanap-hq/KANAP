import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key);
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn() } }));
const readable: Record<string, boolean> = { opex: true, capex: true };
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string) => readable[resource] ?? true }),
}));
vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
  const state = await import('./budgetColumnsTestState');
  return { ...actual, useBudgetColumns: () => state.mockedBudgetColumns(actual.resolveBudgetColumns) };
});
vi.mock('../../components/reports/ReportLayout', () => ({
  default: ({ title, subtitle, filters, children }: { title: string; subtitle?: React.ReactNode; filters?: React.ReactNode; children?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      <p data-testid="subtitle">{subtitle}</p>
      <div data-testid="filters">{filters}</div>
      {children}
    </div>
  ),
}));
vi.mock('../../components/reports/ChartCard', () => ({
  default: React.forwardRef(({ options }: { options: { title?: { text?: string } } }, _ref) => (
    <div data-testid="chart-title">{options?.title?.text}</div>
  )),
}));
vi.mock('../../components/reports/ReportGrid', () => ({
  default: ({ rowData }: { rowData: Array<{ id?: string; name?: string; group?: string }> }) => (
    <ul data-testid="grid">{rowData.map((r, i) => <li key={r.id ?? i}>{r.name ?? r.group}</li>)}</ul>
  ),
}));

import api from '../../api';
import { setBudgetColumns } from './budgetColumnsTestState';
import TopOpexReport from './TopOpexReport';
import OpexDeltaReport from './OpexDeltaReport';
import ConsolidationReport from './ConsolidationReport';
import AnalyticsCategoryReport from './AnalyticsCategoryReport';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const Y = new Date().getFullYear();

/** A year slot whose reporting block also carries the currency and rate keys the summary sends. */
function slot(year: number, budget: number) {
  const columns = { budget, revision: 0, forecast: 0, follow_up: 0, landing: 0 };
  return {
    year,
    totals: columns,
    reporting: { ...columns, currency: 'X', reporting_currency: 'X', fx_rate: 1, fx_source: 'manual', fx_rate_set_id: null },
  };
}

const opexRows = [
  { id: 'o1', product_name: 'Opex line', account_display: '1 - Account', versions: { yMinus1: slot(Y - 1, 100), y: slot(Y, 150) } },
];
const capexRows = [
  { id: 'c1', description: 'Capex growth', account_display: '1 - Account', versions: { yMinus1: slot(Y - 1, 50), y: slot(Y, 300) } },
  { id: 'c2', description: 'Capex cut', versions: { yMinus1: slot(Y - 1, 400), y: slot(Y, 100) } },
];

function renderReport(element: React.ReactElement, path = '/report') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const calledUrls = () => get.mock.calls.map(([url]) => url as string);

beforeEach(() => {
  setBudgetColumns();
  readable.opex = true;
  readable.capex = true;
  get.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url === '/spend-items/summary') return { data: { items: opexRows, total: opexRows.length } };
    if (url === '/capex-items/summary') return { data: { items: capexRows, total: capexRows.length } };
    return { data: { items: [], total: 0 } };
  });
});

describe('Top items report', () => {
  it('opens on OPEX and switches to CAPEX: CAPEX data, names from the description, type in the titles', async () => {
    renderReport(<TopOpexReport />);
    expect(await screen.findByText('Opex line')).toBeInTheDocument();
    expect(calledUrls()).not.toContain('/capex-items/summary');

    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));

    expect(await screen.findByText('Capex growth')).toBeInTheDocument();
    expect(within(screen.getByTestId('grid')).getByText('Capex cut')).toBeInTheDocument();
    expect(calledUrls()).toContain('/capex-items/summary');
    expect(screen.getByTestId('subtitle').textContent).toContain('"type":"operations.scope.capex"');
    expect(screen.getByTestId('chart-title').textContent).toContain('"type":"operations.scope.capex"');
  });

  it('opens on CAPEX from ?scope=capex', async () => {
    renderReport(<TopOpexReport />, '/report?scope=capex');
    expect(await screen.findByText('Capex growth')).toBeInTheDocument();
    expect(calledUrls()).not.toContain('/spend-items/summary');
    expect(screen.getByRole('tab', { name: 'operations.scope.capex' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe('Top increase / decrease report', () => {
  it('offers only the shown budget columns in the metric pickers, fixed order, no currency or rate keys', async () => {
    renderReport(<OpexDeltaReport />);
    await waitFor(() => expect(screen.getByTestId('grid').textContent).toContain('Opex line'));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'reports.filters.sourceMetric' }));
    const options = within(await screen.findByRole('listbox')).getAllByRole('option').map((o) => o.textContent);
    expect(options).toEqual([
      'ops:operations.budgetColumns.budget',
      'ops:operations.budgetColumns.revision',
      'ops:operations.budgetColumns.followUp',
      'ops:operations.budgetColumns.landing',
    ]);
  });

  it('on CAPEX lists the CAPEX increases by description with the type in the titles', async () => {
    renderReport(<OpexDeltaReport />, '/report?scope=capex');
    await waitFor(() => expect(screen.getByTestId('grid').textContent).toContain('Capex growth'));
    expect(screen.getByTestId('grid').textContent).not.toContain('Capex cut');
    expect(calledUrls()).not.toContain('/spend-items/summary');
    expect(screen.getByTestId('subtitle').textContent).toContain('"type":"operations.scope.capex"');
    expect(screen.getByTestId('chart-title').textContent).toContain('"type":"operations.scope.capex"');

    fireEvent.click(screen.getByRole('tab', { name: 'reports.opexDelta.decreases' }));
    await waitFor(() => expect(screen.getByTestId('grid').textContent).toContain('Capex cut'));
    expect(screen.getByTestId('grid').textContent).not.toContain('Capex growth');
  });
});

describe.each([
  ['Consolidation', ConsolidationReport],
  ['Analytics', AnalyticsCategoryReport],
])('%s report', (_name, Report) => {
  it('switches to CAPEX data with the type in the subtitle and chart title', async () => {
    renderReport(<Report />);
    await waitFor(() => expect(calledUrls()).toContain('/spend-items/summary'));
    expect(screen.getByTestId('chart-title').textContent).toContain('"type":"operations.scope.opex"');

    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));

    await waitFor(() => expect(calledUrls()).toContain('/capex-items/summary'));
    await waitFor(() => expect(screen.getByTestId('chart-title').textContent).toContain('"type":"operations.scope.capex"'));
    expect(screen.getByTestId('subtitle').textContent).toContain('"type":"operations.scope.capex"');
  });

  it('opens on CAPEX from ?scope=capex', async () => {
    renderReport(<Report />, '/report?scope=capex');
    await waitFor(() => expect(calledUrls()).toContain('/capex-items/summary'));
    expect(calledUrls()).not.toContain('/spend-items/summary');
  });
});

describe('Report type from the address', () => {
  it('falls back to OPEX when ?scope=capex names a type the user cannot read', async () => {
    readable.capex = false;
    renderReport(<TopOpexReport />, '/report?scope=capex');
    expect(await screen.findByText('Opex line')).toBeInTheDocument();
    expect(calledUrls()).not.toContain('/capex-items/summary');
    expect(screen.getByRole('tab', { name: 'operations.scope.opex' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'operations.scope.capex' })).toBeDisabled();
  });

  it('falls back to the default type for an unknown ?scope=', async () => {
    renderReport(<OpexDeltaReport />, '/report?scope=assets');
    await waitFor(() => expect(screen.getByTestId('grid').textContent).toContain('Opex line'));
    expect(calledUrls()).not.toContain('/capex-items/summary');
    expect(screen.getByRole('tab', { name: 'operations.scope.opex' })).toHaveAttribute('aria-selected', 'true');
  });
});

describe.each([
  ['Top items', TopOpexReport],
  ['Top increase / decrease', OpexDeltaReport],
])('%s exclusions', (_name, Report) => {
  async function exclude(label: string, option: string) {
    const input = screen.getByRole('combobox', { name: label });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: option }));
    fireEvent.keyDown(input, { key: 'Escape' });
  }

  it('drops the item and account exclusions when the type changes', async () => {
    renderReport(<Report />);
    await waitFor(() => expect(screen.getByTestId('grid').textContent).toContain('Opex line'));
    await exclude('reports.filters.excludeItems', 'Opex line');
    await exclude('reports.filters.excludeAccounts', '1 - Account');
    const filters = screen.getByTestId('filters');
    expect(filters.textContent).toContain('reports.filters.itemSelected {"count":1}');
    expect(filters.textContent).toContain('reports.filters.accountSelected {"count":1}');

    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));

    await waitFor(() => expect(screen.getByTestId('grid').textContent).toContain('Capex growth'));
    expect(filters.textContent).not.toContain('reports.filters.itemSelected');
    expect(filters.textContent).not.toContain('reports.filters.accountSelected');
  });
});
