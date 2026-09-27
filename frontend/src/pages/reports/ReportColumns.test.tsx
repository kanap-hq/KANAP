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
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
  const state = await import('./budgetColumnsTestState');
  return { ...actual, useBudgetColumns: () => state.mockedBudgetColumns(actual.resolveBudgetColumns) };
});
const chart = vi.hoisted(() => ({ options: null as any }));
vi.mock('../../components/reports/ReportLayout', () => ({
  default: ({ title, subtitle, filters, actions, children }: { title: string; subtitle?: React.ReactNode; filters?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode }) => (
    <div>
      <h1>{title}</h1>
      <p data-testid="subtitle">{subtitle}</p>
      <div data-testid="filters">{filters}</div>
      <div data-testid="actions">{actions}</div>
      {children}
    </div>
  ),
}));
vi.mock('../../components/reports/ChartCard', () => ({
  default: React.forwardRef(({ options }: { options: { title?: { text?: string } } | null }, _ref) => {
    chart.options = options;
    return <div data-testid="chart-title">{options?.title?.text}</div>;
  }),
}));
vi.mock('../../components/reports/ReportGrid', () => ({
  default: ({ rowData }: { rowData?: Array<{ name?: string; value?: number }> }) => (
    <ul data-testid="grid">{(rowData ?? []).map((r, i) => <li key={i}>{`${r.name ?? ''}: ${r.value ?? ''}`}</li>)}</ul>
  ),
}));
vi.mock('../../components/fields/CompanySelect', () => ({
  default: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onChange('co-1')}>pick company</button>
  ),
}));

import api from '../../api';
import { setBudgetColumns } from './budgetColumnsTestState';
import TopOpexReport from './TopOpexReport';
import OpexDeltaReport from './OpexDeltaReport';
import ConsolidationReport from './ConsolidationReport';
import AnalyticsCategoryReport from './AnalyticsCategoryReport';
import ComparisonReport from './ComparisonReport';
import CapexBudgetTrendReport from './CapexBudgetTrendReport';
import BudgetColumnsCompareReport from './BudgetColumnsCompareReport';
import GlobalChargebackReport from './GlobalChargebackReport';
import CompanyChargebackReport from './CompanyChargebackReport';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const Y = new Date().getFullYear();

const ALL_SHOWN = { planned: true, committed: true, forecast: true, actual: true, expected_landing: true };
const TENANT_NAMES = { planned: 'A0', committed: 'A1', forecast: 'A2', actual: 'A3', expected_landing: 'Réel' };

/** The milestone setting: five renamed columns, all shown, column 3 the default. */
function renamedColumns(patch: Record<string, unknown> = {}) {
  setBudgetColumns({ labels: TENANT_NAMES, enabled: ALL_SHOWN, default_column: 'forecast', ...patch });
}

function slot(year: number, amounts: Record<string, number>) {
  const columns = { budget: 0, revision: 0, forecast: 0, follow_up: 0, landing: 0, ...amounts };
  return { year, totals: columns, reporting: { ...columns, currency: 'X', reporting_currency: 'X' } };
}

const rows = [
  { id: 'o1', product_name: 'Opex line', versions: { yMinus1: slot(Y - 1, { forecast: 100 }), y: slot(Y, { forecast: 150 }) } },
];

function renderReport(element: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (node: React.ReactElement) => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/report']}>{node}</MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>
  );
  const view = render(tree(element));
  // A new element: the mocked setting is not a subscription, so the report must be asked to render again.
  return { ...view, rerenderReport: () => view.rerender(tree(React.cloneElement(element))) };
}

async function optionsOf(name: string, index = 0) {
  fireEvent.mouseDown(screen.getAllByRole('combobox', { name })[index]);
  const listbox = await screen.findByRole('listbox');
  const options = within(listbox).getAllByRole('option').map((o) => o.textContent);
  fireEvent.keyDown(listbox, { key: 'Escape' });
  return options;
}

const combo = (name: string, index = 0) => screen.getAllByRole('combobox', { name })[index];

beforeEach(() => {
  setBudgetColumns();
  get.mockReset();
  get.mockImplementation(async (url: string) => {
    if (url.endsWith('/summary')) return { data: { items: rows, total: rows.length } };
    return { data: { items: [], total: 0 } };
  });
});

describe.each([
  ['Top items', TopOpexReport],
  ['Consolidation', ConsolidationReport],
  ['Analytics', AnalyticsCategoryReport],
])('%s report column picker', (_name, Report) => {
  it('lists the shown columns with tenant names and preselects the default column', async () => {
    renamedColumns();
    renderReport(<Report />);
    await waitFor(() => expect(combo('reports.filters.metric').textContent).toBe('A2'));
    expect(await optionsOf('reports.filters.metric')).toEqual(['A0', 'A1', 'A2', 'A3', 'Réel']);
  });

  it('does not offer a hidden column (Forecast is hidden by default)', async () => {
    renderReport(<Report />);
    expect(combo('reports.filters.metric').textContent).toBe('ops:operations.budgetColumns.budget');
    expect(await optionsOf('reports.filters.metric')).toEqual([
      'ops:operations.budgetColumns.budget',
      'ops:operations.budgetColumns.revision',
      'ops:operations.budgetColumns.followUp',
      'ops:operations.budgetColumns.landing',
    ]);
  });
});

describe('Top items report', () => {
  it('reads the amounts and names the chart after the picked column', async () => {
    renamedColumns();
    renderReport(<TopOpexReport />);
    await waitFor(() => expect(screen.getByTestId('chart-title').textContent).toContain('"metric":"A2"'));
    // Column 3 of Y holds 150; column 1 holds nothing.
    await waitFor(() => expect(screen.getByTestId('grid').textContent).toBe('Opex line: 150'));
  });

  it('falls back to the default column when the picked one gets hidden', async () => {
    renamedColumns();
    const { rerenderReport } = renderReport(<TopOpexReport />);
    fireEvent.mouseDown(combo('reports.filters.metric'));
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'A3' }));
    await waitFor(() => expect(combo('reports.filters.metric').textContent).toBe('A3'));

    renamedColumns({ enabled: { ...ALL_SHOWN, actual: false } });
    rerenderReport();
    await waitFor(() => expect(combo('reports.filters.metric').textContent).toBe('A2'));
  });
});

describe('Top increase / decrease report', () => {
  it('compares the default column of Y-1 with the default column of Y', async () => {
    renamedColumns();
    renderReport(<OpexDeltaReport />);
    await waitFor(() => expect(combo('reports.filters.sourceYear').textContent).toBe(String(Y - 1)));
    expect(combo('reports.filters.sourceMetric').textContent).toBe('A2');
    expect(combo('reports.filters.destinationYear').textContent).toBe(String(Y));
    expect(combo('reports.filters.destinationMetric').textContent).toBe('A2');
    expect(await optionsOf('reports.filters.destinationMetric')).toEqual(['A0', 'A1', 'A2', 'A3', 'Réel']);
  });
});

describe.each([
  ['OPEX trend', ComparisonReport],
  ['CAPEX trend', CapexBudgetTrendReport],
])('%s report', (_name, Report) => {
  it('starts on the default column and the last shown column', async () => {
    renderReport(<Report />);
    expect(combo('reports.filters.metrics').textContent).toBe('ops:operations.budgetColumns.budget, ops:operations.budgetColumns.landing');
  });

  it('follows the tenant setting: names, default pair and shown columns only', async () => {
    renamedColumns({ enabled: { ...ALL_SHOWN, committed: false } });
    renderReport(<Report />);
    expect(combo('reports.filters.metrics').textContent).toBe('A2, Réel');
    expect(await optionsOf('reports.filters.metrics')).toEqual(['A0', 'A2', 'A3', 'Réel']);
  });

  it('keeps one column when the last one is only the default', async () => {
    renamedColumns({ default_column: 'expected_landing' });
    renderReport(<Report />);
    expect(combo('reports.filters.metrics').textContent).toBe('Réel');
  });
});

describe('Budget column comparison report', () => {
  it('starts on the default column of Y and Y+1, adds the default column of Y, offers the shown columns', async () => {
    renamedColumns();
    renderReport(<BudgetColumnsCompareReport />);
    expect(screen.getAllByRole('combobox', { name: 'reports.filters.column' }).map((c) => c.textContent)).toEqual(['A2', 'A2']);
    expect(screen.getAllByRole('combobox', { name: 'reports.filters.year' }).map((c) => c.textContent)).toEqual([String(Y), String(Y + 1)]);

    fireEvent.click(screen.getByRole('button', { name: 'reports.budgetColumnsCompare.addSelection' }));
    expect(screen.getAllByRole('combobox', { name: 'reports.filters.column' }).map((c) => c.textContent)).toEqual(['A2', 'A2', 'A2']);
    expect(await optionsOf('reports.filters.column')).toEqual(['A0', 'A1', 'A2', 'A3', 'Réel']);
  });

  it('names the item type through the translations', () => {
    renderReport(<BudgetColumnsCompareReport />);
    expect(combo('reports.filters.itemType').textContent).toBe('operations.scope.opex');
  });
});

const chargebackCalls = (url: string) => get.mock.calls.filter(([called]) => called === url).map(([, config]) => config?.params ?? {});

describe('Global chargeback report', () => {
  it('waits for the setting, then sends the default column and offers the shown ones', async () => {
    // Not loaded yet: the hook holds the product defaults (the patch is ignored), and Run waits too.
    setBudgetColumns({ labels: TENANT_NAMES, enabled: ALL_SHOWN, default_column: 'forecast' }, false);
    const { rerenderReport } = renderReport(<GlobalChargebackReport />);
    expect(within(screen.getByTestId('actions')).getByRole('button', { name: 'reports.shared.run' })).toBeDisabled();
    expect(screen.getByText('reports.shared.loadingReport')).toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId('actions')).getByRole('button', { name: 'reports.shared.run' }));
    expect(chargebackCalls('/reports/chargeback/global')).toEqual([]);

    renamedColumns();
    rerenderReport();
    await waitFor(() => expect(chargebackCalls('/reports/chargeback/global')).toEqual([{ year: Y, metric: 'forecast' }]));
    expect(combo('reports.filters.column').textContent).toBe('A2');
    expect(await optionsOf('reports.filters.column')).toEqual(['A0', 'A1', 'A2', 'A3', 'Réel']);
  });
});

describe('Company chargeback report', () => {
  it('sends the default column once a company is chosen and offers the shown columns', async () => {
    setBudgetColumns({ labels: TENANT_NAMES, default_column: 'actual' });
    renderReport(<CompanyChargebackReport />);
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    await waitFor(() => expect(chargebackCalls('/reports/chargeback/company')).toEqual([{ companyId: 'co-1', year: Y, metric: 'follow_up' }]));
    expect(combo('reports.filters.column').textContent).toBe('A3');
    expect(await optionsOf('reports.filters.column')).toEqual(['A0', 'A1', 'A3', 'Réel']);
  });
});

describe('Chart tooltips', () => {
  it('escape the item name the chart puts in the tooltip title', async () => {
    const tagged = [{ id: 'o9', product_name: '<b>Bold</b> & co', versions: { y: slot(Y, { budget: 90 }) } }];
    get.mockImplementation(async (url: string) => (url.endsWith('/summary') ? { data: { items: tagged, total: 1 } } : { data: { items: [], total: 0 } }));
    renderReport(<TopOpexReport />);
    await waitFor(() => expect(screen.getByTestId('grid').textContent).toContain('90'));
    const pie = chart.options.series[0];
    const tooltip = pie.tooltip.renderer({ datum: { name: '<b>Bold</b> & co', value: 90 }, angleKey: 'value' });
    expect(tooltip.title).toBe('&lt;b&gt;Bold&lt;/b&gt; &amp; co');
  });
});
