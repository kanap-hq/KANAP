import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ColDef } from 'ag-grid-community';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const t = (key: string, options?: Record<string, unknown>) => (options ? `${key} ${JSON.stringify(options)}` : key);
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
  const state = await import('./budgetColumnsTestState');
  return { ...actual, useBudgetColumns: () => state.mockedBudgetColumns(actual.resolveBudgetColumns) };
});
vi.mock('../../hooks/useAnalyticsAxes', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../hooks/useAnalyticsAxes')>();
  return { ...actual, useAnalyticsAxes: () => actual.buildAnalyticsAxes([], ((key: string) => key) as never) };
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
vi.mock('../../components/reports/ChartCard', () => ({ default: React.forwardRef(() => null) }));
// The grid's item column (`name`), drawn through its own renderer, for the data rows and the pinned rows.
vi.mock('../../components/reports/ReportGrid', () => ({
  default: ({ rowData, pinnedBottomRowData, columnDefs }: { rowData?: any[]; pinnedBottomRowData?: any[]; columnDefs?: ColDef[] }) => {
    // Reports with an item column: its `name` field, else the report's own first column (chargeback).
    const columns = columnDefs ?? [];
    const col = (columns.find((column) => column.field === 'name') ?? columns[0]) as ColDef;
    const cell = (row: any, i: number) => {
      const value = row[col.field as string];
      const Renderer = col.cellRenderer as React.FC<any> | undefined;
      return (
        <li key={i}>
          {Renderer ? <Renderer value={value} data={row} colDef={col} {...(col.cellRendererParams ?? {})} /> : String(value ?? '')}
        </li>
      );
    };
    return (
      <ul data-testid={`grid-${col.field}`}>
        {(rowData ?? []).map(cell)}
        {(pinnedBottomRowData ?? []).map((row, i) => cell(row, 1000 + i))}
      </ul>
    );
  },
}));
vi.mock('../../components/fields/CompanySelect', () => ({
  default: ({ onChange }: { onChange: (id: string | null) => void }) => (
    <button type="button" onClick={() => onChange('co-1')}>pick company</button>
  ),
}));

import api from '../../api';
import { fakeAggregate } from '../../test/fakeBudgetAggregate';
import { setBudgetColumns } from './budgetColumnsTestState';
import TopOpexReport from './TopOpexReport';
import OpexDeltaReport from './OpexDeltaReport';
import CompanyChargebackReport from './CompanyChargebackReport';

const get = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;
const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
const Y = new Date().getFullYear();

function slot(year: number, budget: number) {
  const columns = { budget, revision: 0, forecast: 0, follow_up: 0, landing: 0 };
  return { year, totals: columns, reporting: { ...columns, currency: 'X', reporting_currency: 'X' } };
}

// Through the routes of one nature, `line_number` is the line's own number (BL); the CAPEX routes'
// `item_number` is the CPX number.
const opexRows = [
  { id: 'o1', item_number: 1, line_number: 1, product_name: 'Opex line', versions: { yMinus1: slot(Y - 1, 100), y: slot(Y, 150) } },
  // Not a line of the window: the table keeps the name as plain text.
  { product_name: 'No line', versions: { yMinus1: slot(Y - 1, 10), y: slot(Y, 20) } },
];
const capexRows = [
  { id: 'c1', item_number: 4, line_number: 119, description: 'Capex growth', versions: { yMinus1: slot(Y - 1, 50), y: slot(Y, 300) } },
];

function renderReport(element: React.ReactElement, path = '/report?scope=opex') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setBudgetColumns();
  get.mockReset();
  get.mockImplementation(async () => ({ data: { items: [], total: 0 } }));
  post.mockReset();
  post.mockImplementation(async (url: string, body: any) => {
    if (url === '/budget-lines/summary/aggregate') return { data: fakeAggregate([...opexRows.map((row) => ({ ...row, item_number: row.id ? 1 : null })), ...capexRows.map((row) => ({ ...row, product_name: row.description, item_number: 119 }))], body) };
    if (url === '/spend-items/summary/aggregate') return { data: fakeAggregate(opexRows as any[], body) };
    if (url === '/capex-items/summary/aggregate') return { data: fakeAggregate(capexRows as any[], body) };
    throw new Error(`unexpected POST ${url}`);
  });
});

function expectNewTabLink(grid: HTMLElement, name: string, href: string) {
  const link = within(grid).getByRole('link', { name });
  expect(link).toHaveAttribute('href', href);
  expect(link).toHaveAttribute('target', '_blank');
  expect(link).toHaveAttribute('rel', 'noopener noreferrer');
}

describe('Top items report item links', () => {
  it('links an OPEX line to its BL page in a new tab, and leaves a row without a line as text', async () => {
    renderReport(<TopOpexReport />);
    const grid = await screen.findByTestId('grid-name');
    await waitFor(() => expect(grid.textContent).toContain('Opex line'));
    expectNewTabLink(grid, 'Opex line', '/ops/budget/BL-1');
    expect(within(grid).getByText('No line').closest('a')).toBeNull();
  });

  it('links a CAPEX line to its BL page, never by its CPX number', async () => {
    renderReport(<TopOpexReport />, '/report?scope=capex');
    const grid = await screen.findByTestId('grid-name');
    await waitFor(() => expect(grid.textContent).toContain('Capex growth'));
    expectNewTabLink(grid, 'Capex growth', '/ops/budget/BL-119');
  });
});

describe('Top increase / decrease report item links', () => {
  it('links an OPEX line to its BL page in a new tab, and leaves a row without a line as text', async () => {
    renderReport(<OpexDeltaReport />);
    const grid = await screen.findByTestId('grid-name');
    await waitFor(() => expect(grid.textContent).toContain('Opex line'));
    expectNewTabLink(grid, 'Opex line', '/ops/budget/BL-1');
    expect(within(grid).getByText('No line').closest('a')).toBeNull();
  });

  it('links a CAPEX line to its BL page, never by its CPX number', async () => {
    renderReport(<OpexDeltaReport />, '/report?scope=capex');
    const grid = await screen.findByTestId('grid-name');
    await waitFor(() => expect(grid.textContent).toContain('Capex growth'));
    expectNewTabLink(grid, 'Capex growth', '/ops/budget/BL-119');
  });
});

describe('Company chargeback report item links', () => {
  it('links an OPEX and a CAPEX line, and leaves common costs and the total row as text', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/reports/chargeback/company') {
        return {
          data: {
            year: Y,
            metric: 'budget',
            total: 300,
            totalRaw: 300,
            company: { id: 'co-1', name: 'Fromage SA', total: 300, totalRaw: 300, headcount: null, itUsers: null, turnover: null, turnoverRaw: null, costPerUser: null, costPerUserRaw: null, costPerItUser: null, costPerItUserRaw: null, costVsTurnoverPct: null },
            departments: [],
            items: [
              { versionId: 'v1', itemId: 'o1', itemName: 'Opex line', itemLabel: 'Opex line', allocationMethod: 'headcount', allocationMethodLabel: 'Headcount', amount: 200, amountRaw: 200, sharePct: 66.67 },
              { versionId: 'v2', itemId: null, itemName: 'Common costs', itemLabel: 'Common costs', allocationMethod: 'default', allocationMethodLabel: 'Default', amount: 100, amountRaw: 100, sharePct: 33.33 },
              { versionId: 'v3', itemId: 'c1', itemNumber: 119, nature: 'capex', itemName: 'Capex line', itemLabel: 'Capex line', allocationMethod: 'it_users', allocationMethodLabel: 'IT users', amount: 0, amountRaw: 0, sharePct: 0 },
            ],
            itemsTotal: 300,
            itemsTotalRaw: 300,
            kpis: [],
            globalKpi: { amount: 300, amountRaw: 300, headcount: null, itUsers: null, turnover: null, turnoverRaw: null, costPerUser: null, costPerItUser: null, costVsTurnoverPct: null },
          },
        };
      }
      return { data: { items: [], total: 0 } };
    });
    renderReport(<CompanyChargebackReport />);
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    const grid = await screen.findByTestId('grid-itemLabel');
    expectNewTabLink(grid, 'Opex line', '/ops/budget/o1');
    expectNewTabLink(grid, 'Capex line', '/ops/budget/BL-119');
    expect(within(grid).getByText('Common costs').closest('a')).toBeNull();
    expect(within(grid).getByText('reports.columns.total').closest('a')).toBeNull();
    expect(within(grid).getAllByRole('link')).toHaveLength(2);
  });
});

describe('Company chargeback of a limited person', () => {
  it('names a line the person cannot read by its reference and label, without a link', async () => {
    get.mockImplementation(async (url: string) => {
      if (url === '/reports/chargeback/company') {
        return {
          data: {
            year: Y,
            metric: 'budget',
            total: 90,
            totalRaw: 90,
            company: { id: 'co-1', name: 'Fromage SA', total: 90, totalRaw: 90, headcount: null, itUsers: null, turnover: null, turnoverRaw: null, costPerUser: null, costPerUserRaw: null, costPerItUser: null, costPerItUserRaw: null, costVsTurnoverPct: null },
            departments: [],
            items: [
              { versionId: 'v1', itemId: null, itemNumber: 12, nature: 'opex', itemName: 'Hidden line', itemLabel: 'BL-12 · Hidden line', allocationMethod: 'manual_pct', allocationMethodLabel: 'Manual (%)', amount: 40, amountRaw: 40, sharePct: 44.44, readable: false, payingCompanyName: 'Fromage FR', allocationPct: 40, departments: ['Finance'] },
              { versionId: 'v2', itemId: 'o2', itemNumber: 13, nature: 'opex', itemName: 'Own line', itemLabel: 'Own line', allocationMethod: 'manual_pct', allocationMethodLabel: 'Manual (%)', amount: 50, amountRaw: 50, sharePct: 55.56, readable: true, payingCompanyName: 'Fromage SA', allocationPct: 50, departments: [] },
            ],
            itemsTotal: 90,
            itemsTotalRaw: 90,
            kpis: [],
            globalKpi: null,
            dataAccessLimited: true,
          },
        };
      }
      return { data: { items: [], total: 0 } };
    });
    renderReport(<CompanyChargebackReport />);
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    const grid = await screen.findByTestId('grid-itemLabel');
    expect(within(grid).getByText('BL-12 · Hidden line').closest('a')).toBeNull();
    expectNewTabLink(grid, 'Own line', '/ops/budget/BL-13');
    expect(within(grid).getAllByRole('link')).toHaveLength(1);
    expect(screen.queryByText('reports.companyChargeback.globalTotals')).toBeNull();
  });
});

describe.each([['Top items', TopOpexReport], ['Variation', OpexDeltaReport]])('%s All item links', (_name, Report) => {
  it('links both natures to their native BL references', async () => {
    renderReport(<Report />, '/report');
    const grid = await screen.findByTestId('grid-name');
    await waitFor(() => expect(grid.textContent).toContain('Capex growth'));
    expectNewTabLink(grid, 'Opex line', '/ops/budget/BL-1');
    expectNewTabLink(grid, 'Capex growth', '/ops/budget/BL-119');
    expect(post.mock.calls.every(([url]) => url === '/budget-lines/summary/aggregate')).toBe(true);
  });
});
