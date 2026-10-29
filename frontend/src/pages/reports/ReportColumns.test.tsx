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
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const locale = vi.hoisted(() => ({ value: 'en' }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => locale.value }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
  const state = await import('./budgetColumnsTestState');
  return { ...actual, useBudgetColumns: () => state.mockedBudgetColumns(actual.resolveBudgetColumns) };
});
// The report filter bar reads the dimensions; none here, so the analytics report groups on the default.
vi.mock('../../hooks/useAnalyticsAxes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useAnalyticsAxes')>();
  return { ...actual, useAnalyticsAxes: () => actual.buildAnalyticsAxes([], ((key: string) => key) as never) };
});
const chart = vi.hoisted(() => ({ options: null as any, columns: null as any[] | null, tableExport: null as any }));
vi.mock('../../components/reports/ReportLayout', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/reports/ReportLayout')>()),
  default: ({ title, subtitle, filters, actions, children, tableExport }: { title: string; subtitle?: React.ReactNode; filters?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; tableExport?: unknown }) => {
    chart.tableExport = tableExport ?? null;
    return (
    <div>
      <h1>{title}</h1>
      <p data-testid="subtitle">{subtitle}</p>
      <div data-testid="filters">{filters}</div>
      <div data-testid="actions">{actions}</div>
      {children}
    </div>
    );
  },
}));
vi.mock('../../components/reports/ChartCard', () => ({
  default: React.forwardRef(({ options }: { options: { title?: { text?: string } } | null }, _ref) => {
    chart.options = options;
    return <div data-testid="chart-title">{options?.title?.text}</div>;
  }),
}));
vi.mock('../../components/reports/ReportGrid', () => ({
  default: ({ rowData, columnDefs }: { rowData?: Array<{ name?: string; value?: number }>; columnDefs?: any[] }) => {
    chart.columns = columnDefs ?? null;
    return <ul data-testid="grid">{(rowData ?? []).map((r, i) => <li key={i}>{`${r.name ?? ''}: ${r.value ?? ''}`}</li>)}</ul>;
  },
}));
vi.mock('../../components/fields/CompanySelect', () => ({
  default: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onChange('co-1')}>pick company</button>
  ),
}));

import { formatPercentPoints, formatSharePercent } from '../../i18n/formatters';
import api from '../../api';
import { fakeAggregate } from '../../test/fakeBudgetAggregate';
import { setBudgetColumns } from './budgetColumnsTestState';
import TopOpexReport from './TopOpexReport';
import OpexDeltaReport from './OpexDeltaReport';
import ConsolidationReport from './ConsolidationReport';
import AnalyticsCategoryReport from './AnalyticsCategoryReport';
import ComparisonReport from './ComparisonReport';
import BudgetColumnsCompareReport from './BudgetColumnsCompareReport';
import GlobalChargebackReport from './GlobalChargebackReport';
import CompanyChargebackReport from './CompanyChargebackReport';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
/** The lines the server aggregates. */
let serverRows: unknown[] = [];
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
  locale.value = 'en';
  chart.options = null;
  chart.columns = null;
  chart.tableExport = null;
  setBudgetColumns();
  get.mockReset();
  get.mockImplementation(async () => ({ data: { items: [], total: 0 } }));
  serverRows = rows;
  post.mockReset();
  post.mockImplementation(async (_url: string, body: any) => ({ data: fakeAggregate(serverRows as any[], body) }));
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

  it('heads the table with the line reference, then the line', async () => {
    renamedColumns();
    renderReport(<TopOpexReport />);
    await waitFor(() => expect((chart.columns ?? []).slice(0, 3).map((column) => column.field)).toEqual(['reference', 'name', 'value']));
    expect(chart.columns?.[0]?.headerName).toBe('opex.columns.reference');
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
    expect(screen.getByRole('tab', { name: 'operations.scope.all' })).toHaveAttribute('aria-selected', 'true');
  });
});

const chargebackCalls = (url: string) => get.mock.calls.filter(([called]) => called === url).map(([, config]) => config?.params ?? {});

describe('Budget report table exports', () => {
  it('send the screen state to the server export', async () => {
    const comparison = renderReport(<ComparisonReport />);
    await waitFor(() => expect(chart.tableExport?.url).toBe('/reports/budget/comparison/export'));
    expect(chart.tableExport.params).toMatchObject({ scope: 'all', measure: 'amount', startYear: Y - 1, endYear: Y + 1, metrics: 'budget,landing' });
    expect(chart.tableExport.params.costCenter).toBeUndefined();
    comparison.unmount();

    const compare = renderReport(<BudgetColumnsCompareReport />);
    await waitFor(() => expect(chart.tableExport?.url).toBe('/reports/budget/columns-compare/export'));
    expect(chart.tableExport.params).toMatchObject({ scope: 'all', measure: 'amount', selections: `${Y}:budget,${Y + 1}:budget`, yearGrouping: 'false' });
    compare.unmount();

    renderReport(<TopOpexReport />);
    await waitFor(() => expect(chart.tableExport?.url).toBe('/reports/budget/top-lines/export'));
    expect(chart.tableExport.params).toMatchObject({ scope: 'all', measure: 'amount', year: Y, metric: 'budget', top: 10, excludeIds: '' });
    expect(chart.tableExport.params.excludeAccounts).toBeUndefined();
  });

  it('send the increases and decreases, consolidation and analytics state to the server export', async () => {
    const delta = renderReport(<OpexDeltaReport />);
    await waitFor(() => expect(chart.tableExport?.url).toBe('/reports/budget/increases-decreases/export'));
    expect(chart.tableExport.params).toMatchObject({
      scope: 'all', measure: 'amount', sourceYear: Y - 1, sourceMetric: 'budget', destinationYear: Y, destinationMetric: 'budget', direction: 'increase', top: 10, excludeIds: '',
    });
    fireEvent.click(screen.getByRole('tab', { name: 'reports.opexDelta.both' }));
    await waitFor(() => expect(chart.tableExport.params.direction).toBe('both'));
    delta.unmount();

    const consolidation = renderReport(<ConsolidationReport />);
    await waitFor(() => expect(chart.tableExport?.url).toBe('/reports/budget/consolidation/export'));
    expect(chart.tableExport.params).toMatchObject({ scope: 'all', measure: 'amount', startYear: Y, endYear: Y, metric: 'budget', excludeAccounts: '' });
    consolidation.unmount();

    renderReport(<AnalyticsCategoryReport />);
    await waitFor(() => expect(chart.tableExport?.url).toBe('/reports/budget/analytics/export'));
    // No dimension here: the screen groups on the default field and sends none.
    expect(chart.tableExport.params).toMatchObject({ scope: 'all', measure: 'amount', axis: null, startYear: Y, endYear: Y, metric: 'budget', excludeValues: '' });
  });
});

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
    await waitFor(() => expect(chargebackCalls('/reports/chargeback/global')).toEqual([{ year: Y, metric: 'forecast', scope: 'opex' }]));
    expect(combo('reports.filters.column').textContent).toBe('A2');
    expect(await optionsOf('reports.filters.column')).toEqual(['A0', 'A1', 'A2', 'A3', 'Réel']);
  });
});

describe('Company chargeback report', () => {
  it('sends the default column once a company is chosen and offers the shown columns', async () => {
    setBudgetColumns({ labels: TENANT_NAMES, default_column: 'actual' });
    renderReport(<CompanyChargebackReport />);
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    await waitFor(() => expect(chargebackCalls('/reports/chargeback/company')).toEqual([{ companyId: 'co-1', year: Y, metric: 'follow_up', scope: 'opex' }]));
    expect(combo('reports.filters.column').textContent).toBe('A3');
    expect(await optionsOf('reports.filters.column')).toEqual(['A0', 'A1', 'A3', 'Réel']);
  });
});

describe.each([
  ['Global chargeback', GlobalChargebackReport, '/reports/chargeback/global', false],
  ['Company chargeback', CompanyChargebackReport, '/reports/chargeback/company', true],
] as const)('%s report scope', (_name, Report, url, picksCompany) => {
  it('opens on OPEX, sends the scope chosen, and explains the CAPEX spread when CAPEX is in', async () => {
    renderReport(<Report />);
    if (picksCompany) fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    const tab = (scope: string) => screen.getByRole('tab', { name: `operations.scope.${scope}` });
    expect(tab('opex')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(['operations.scope.all', 'operations.scope.opex', 'operations.scope.capex']);
    await waitFor(() => expect(chargebackCalls(url).map((params) => params.scope)).toEqual(['opex']));
    expect(screen.queryByText('reports.shared.capexYearAmountNote')).toBeNull();

    fireEvent.click(tab('all'));
    await waitFor(() => expect(chargebackCalls(url).map((params) => params.scope)).toEqual(['opex', 'all']));
    expect(tab('all')).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('note').textContent).toBe('reports.shared.capexYearAmountNote');

    fireEvent.click(tab('capex'));
    await waitFor(() => expect(chargebackCalls(url).map((params) => params.scope)).toEqual(['opex', 'all', 'capex']));
    expect(screen.getByRole('note').textContent).toBe('reports.shared.capexYearAmountNote');

    fireEvent.click(tab('opex'));
    await waitFor(() => expect(tab('opex')).toHaveAttribute('aria-selected', 'true'));
    expect(screen.queryByText('reports.shared.capexYearAmountNote')).toBeNull();
  });
});

function shareOf(tooltip: { data: Array<{ label: string; value: string }> }): string {
  const share = tooltip.data.find((row) => row.label === 'reports.shared.share');
  if (!share) throw new Error('share row missing');
  return share.value;
}

describe('Chart tooltips', () => {
  it('escape the item name the chart puts in the tooltip title', async () => {
    const tagged = [{ id: 'o9', product_name: '<b>Bold</b> & co', versions: { y: slot(Y, { budget: 90 }) } }];
    serverRows = tagged;
    renderReport(<TopOpexReport />);
    await waitFor(() => expect(screen.getByTestId('grid').textContent).toContain('90'));
    const pie = chart.options.series[0];
    const tooltip = pie.tooltip.renderer({ datum: { name: '<b>Bold</b> & co', value: 90 }, angleKey: 'value' });
    expect(tooltip.title).toBe('&lt;b&gt;Bold&lt;/b&gt; &amp; co');
  });

  it('writes a Top items share in the interface language', async () => {
    locale.value = 'fr';
    serverRows = [
      { id: 'a', product_name: 'Small', versions: { y: slot(Y, { budget: 123 }) } },
      { id: 'b', product_name: 'Large', versions: { y: slot(Y, { budget: 877 }) } },
    ];
    renderReport(<TopOpexReport />);
    await waitFor(() => expect(screen.getByTestId('grid').textContent).toContain('123'));
    const pie = chart.options.series[0];
    const tooltip = pie.tooltip.renderer({ datum: { name: 'Small', value: 123 }, angleKey: 'value' });
    const share = shareOf(tooltip);
    expect(share).toBe(formatPercentPoints(12.3, 'fr', 1));
    expect(share).toContain('12,3');
    expect(share).not.toContain('12.3');
    // These two lines are the whole total, so the share of all lines matches the share of the pie.
    const ofAll = tooltip.data.find((row: { label: string }) => row.label === 'reports.topOpex.shareOfAllLines');
    expect(ofAll?.value).toBe(share);
  });

  it('labels a pie slice by the slices drawn and keeps the share of all lines on a second line', async () => {
    serverRows = [
      { id: 'a', product_name: 'Large', versions: { y: slot(Y, { budget: 50 }) } },
      { id: 'b', product_name: 'Mid', versions: { y: slot(Y, { budget: 30 }) } },
      { id: 'c', product_name: 'Small', versions: { y: slot(Y, { budget: 20 }) } },
    ];
    renderReport(<TopOpexReport />);
    await waitFor(() => expect(screen.getByTestId('grid').textContent).toContain('Small'));
    fireEvent.change(screen.getByRole('spinbutton', { name: 'reports.filters.topCount' }), { target: { value: '2' } });
    await waitFor(() => expect(screen.getByTestId('grid').textContent).not.toContain('Small'));

    const pie = chart.options.series[0];
    // 50 of the drawn 80 is 62.5%, so the slice reads 63%. Its share of every line (100) is 50%.
    expect(pie.sectorLabel.formatter({ datum: { value: 50 }, angleKey: 'value' })).toBe('63%');
    // 2 of the drawn 80 is 2.5%: under 3%, the slice stays blank.
    expect(pie.sectorLabel.formatter({ datum: { value: 2 }, angleKey: 'value' })).toBe('');
    // 2.4 of 80 is 3% exactly.
    expect(pie.sectorLabel.formatter({ datum: { value: 2.4 }, angleKey: 'value' })).toBe('3%');

    const tooltip = pie.tooltip.renderer({ datum: { name: 'Large', value: 50 }, angleKey: 'value' });
    expect(shareOf(tooltip)).toBe(formatPercentPoints(62.5, 'en', 1));
    const ofAll = tooltip.data.find((row: { label: string }) => row.label === 'reports.topOpex.shareOfAllLines');
    expect(ofAll?.value).toBe(formatPercentPoints(50, 'en', 1));
  });
});

describe('OPEX delta shares', () => {
  const lines = [
    { id: 'a', product_name: 'Small', versions: { yMinus1: slot(Y - 1, { budget: 1000 }), y: slot(Y, { budget: 1123 }) } },
    { id: 'b', product_name: 'Large', versions: { yMinus1: slot(Y - 1, { budget: 1000 }), y: slot(Y, { budget: 1877 }) } },
    { id: 'c', product_name: 'Down', versions: { yMinus1: slot(Y - 1, { budget: 200 }), y: slot(Y, { budget: 100 }) } },
  ];

  it('formats the column, the chart share and the summary in the interface language', async () => {
    locale.value = 'fr';
    serverRows = lines;
    renderReport(<OpexDeltaReport />);
    await waitFor(() => expect(screen.getByTestId('grid').textContent).toContain('Small'));
    const column = chart.columns?.find((col) => col.field === 'pct_increase');
    // The table holds the change as a fraction of the source (`reportTables.ts`).
    expect(column.valueFormatter({ value: 0.123 })).toBe(formatSharePercent(12.3, 'fr', 1));
    expect(column.valueFormatter({ value: 0.123 })).toContain('12,3');
    expect(column.valueFormatter({ value: null })).toBe('');
    const bar = chart.options.series[0];
    const share = shareOf(bar.tooltip.renderer({ datum: { name: 'Small', magnitude: 123, delta: 123, direction: 'increase' } }));
    expect(share).toBe(formatPercentPoints(12.3, 'fr', 1));
    expect(share).toContain('12,3');
    const coverage = screen.getByText(/reports\.opexDelta\.coveragePct/).textContent ?? '';
    expect(coverage).toContain('100,0');
    expect(coverage).not.toContain('100.0');

    fireEvent.click(screen.getByRole('tab', { name: 'reports.opexDelta.both' }));
    await waitFor(() => expect(screen.getByText(/reports\.opexDelta\.coverageSplit/)).toBeInTheDocument());
    const split = screen.getByText(/reports\.opexDelta\.coverageSplit/).textContent ?? '';
    const frenchPercent = formatPercentPoints(100, 'fr', 1);
    expect(split).toContain(frenchPercent);
    expect(split).not.toContain('100.0%');
  });
});

/** A measure field that names a budget column (`y2026Forecast`, `staff_cost_y2026Forecast`). */
const COLUMN_FIELD = /y\d{4}(Budget|Revision|Forecast|FollowUp|Landing)/;

/** Aggregates whose measures name a budget column. The filter bar's aggregates have none. */
function columnPosts() {
  return post.mock.calls.filter(([, body]) => (body?.spec?.measures ?? []).some((measure: { field?: string }) => COLUMN_FIELD.test(measure.field ?? '')));
}

function columnSuffixes(): string[] {
  return columnPosts().flatMap(([, body]) => body.spec.measures.flatMap((measure: { field?: string }) => {
    const match = COLUMN_FIELD.exec(measure.field ?? '');
    return match ? [match[1]] : [];
  }));
}

describe.each([
  ['Top items', TopOpexReport, ['Forecast']],
  ['Column comparison', BudgetColumnsCompareReport, ['Forecast']],
  ['Increases and decreases', OpexDeltaReport, ['Forecast']],
  ['Comparison', ComparisonReport, ['Forecast', 'Landing']],
  ['Consolidation', ConsolidationReport, ['Forecast']],
] as const)('%s waits for the column setting', (_name, Report, suffixes) => {
  it('sends one set of aggregates, on the tenant default', async () => {
    const tenant = { labels: TENANT_NAMES, enabled: ALL_SHOWN, default_column: 'forecast' as const };
    setBudgetColumns(tenant, false);
    const { rerenderReport } = renderReport(<Report />);
    await waitFor(() => expect(post.mock.calls.some(([, body]) => body.spec.groupBy?.[0] === 'run_build')).toBe(true));
    expect(columnPosts()).toEqual([]);

    setBudgetColumns(tenant);
    rerenderReport();
    await waitFor(() => expect(new Set(columnSuffixes())).toEqual(new Set(suffixes)));
    expect(columnPosts()).toHaveLength(1);
  });
});
