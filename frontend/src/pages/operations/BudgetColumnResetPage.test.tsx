import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  // Counted messages come back as `key:count` so the summary can be read.
  const t = (key: string, options?: { count?: number }) => (typeof options?.count === 'number' ? `${key}:${options.count}` : key);
  const translation = { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
// The grid draws the line cell through the page's renderer, and the type column's text; its
// sizing options are kept for the test that reads them.
const grid = vi.hoisted(() => ({ props: undefined as any }));
vi.mock('ag-grid-react', () => ({
  AgGridReact: (props: { rowData: any[]; columnDefs: any[] }) => { grid.props = props; const { rowData, columnDefs } = props; return (
    <ul>
      {rowData.map((row) => (
        <li key={row.id} data-testid={`row-${row.id}`}>
          {columnDefs.map((col, i) => {
            const Renderer = col.cellRenderer;
            const value = row[col.field];
            return Renderer
              ? <Renderer key={i} value={value} data={row} colDef={col} />
              : <span key={i} data-col={col.field}>{String(col.valueFormatter ? col.valueFormatter({ value }) : value ?? '')}</span>;
          })}
        </li>
      ))}
    </ul>
  ); },
}));
vi.mock('../../components/AgGridBox', () => ({ default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
// The server export the page offers, as the export button receives it.
const layout = vi.hoisted(() => ({ tableExport: undefined as any }));
vi.mock('../../components/reports/ReportExportButton', () => ({
  default: (props: unknown) => {
    layout.tableExport = props;
    return <button type="button">export</button>;
  },
}));
vi.mock('../../components/reports/ReportLayout', () => ({
  ReportFilter: ({ label, children }: { label: string; children: React.ReactNode }) => <div><span>{label}</span>{children}</div>,
  reportFilterMenuProps: {},
  reportFilterSelectSx: {},
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true }),
}));
const confirm = vi.fn(async (_options: { title?: string; message: React.ReactNode; intent?: string; confirmLabel?: string }) => true);
vi.mock('../../components/design', () => ({
  useKanapDialogs: () => ({ confirm }),
}));
const frozen = vi.hoisted(() => ({ capex: false }));
vi.mock('../../hooks/useFreezeState', () => {
  const scope = (value: boolean) => ({ budget: { frozen: value }, revision: { frozen: false }, forecast: { frozen: false }, actual: { frozen: false }, landing: { frozen: false } });
  return { useFreezeState: () => ({ data: { summary: { scopes: { opex: scope(false), capex: scope(frozen.capex) } } }, isLoading: false }) };
});
// Through the CAPEX routes a line's `item_number` is its CPX number; `line_number` is its own (BL).
const serversRow = { id: 'c-1', description: 'Servers', item_number: 3, line_number: 500003, versions: { [`y${new Date().getFullYear()}`]: { totals: { budget: 5000, revision: 0, follow_up: 0, landing: 0 } } } };
const capexRows = { current: [serversRow] as unknown[] };
const unifiedRows = [
  { id: 'o-1', nature: 'opex', item_number: 12, product_name: 'Licences', versions: { [`y${new Date().getFullYear()}`]: { totals: { budget: 800, revision: 0, follow_up: 0, landing: 0 } } } },
  { id: 'c-1', nature: 'capex', item_number: 500003, product_name: 'Servers', versions: serversRow.versions },
];

// The tenant's column settings, set per test.
const columnsSetting = vi.hoisted(() => ({ current: null as unknown, failed: false }));
vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
  let cache: { settings: unknown; value: ReturnType<typeof mod.resolveBudgetColumns> } | null = null;
  const t = ((key: string) => key) as unknown as Parameters<typeof mod.resolveBudgetColumns>[1];
  return {
    ...mod,
    useBudgetColumns: () => {
      if (columnsSetting.failed) return mod.resolveBudgetColumns(columnsSetting.current as never, t, true, new Error('network down'));
      if (!cache || cache.settings !== columnsSetting.current) {
        cache = { settings: columnsSetting.current, value: mod.resolveBudgetColumns(columnsSetting.current as never, t) };
      }
      return cache.value;
    },
  };
});

import api from '../../api';
import { fakeAggregate } from '../../test/fakeBudgetAggregate';
import BudgetColumnResetPage from './BudgetColumnResetPage';
import { DEFAULT_BUDGET_COLUMNS } from '../../services/budgetColumns';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;
/** The budget operation calls (the page's lines come from the aggregate route). */
const operation = vi.fn();

/** Picks a column in the column select (the second select, after the year). */
async function chooseColumn(name: string) {
  fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
  fireEvent.click(await screen.findByRole('option', { name }));
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <BudgetColumnResetPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('BudgetColumnResetPage', () => {
  beforeEach(() => {
    columnsSetting.current = DEFAULT_BUDGET_COLUMNS;
    columnsSetting.failed = false;
    post.mockReset();
    operation.mockReset();
    post.mockImplementation(async (url: string, body: any) => {
      if (url === '/capex-items/summary/aggregate') return { data: fakeAggregate(capexRows.current as any[], body) };
      if (url === '/budget-lines/summary/aggregate') return { data: fakeAggregate(unifiedRows as any[], body) };
      if (url === '/spend-items/summary/aggregate') return { data: fakeAggregate([], body) };
      return operation(url, body);
    });
    confirm.mockClear();
    capexRows.current = [serversRow];
    frozen.capex = false;
  });

  it('offers the server export of the grid once a column is chosen', async () => {
    layout.tableExport = undefined;
    renderPage();
    expect(screen.queryByRole('button', { name: 'export' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    await chooseColumn('ops:operations.budgetColumns.budget');
    await waitFor(() => expect(layout.tableExport).toMatchObject({
      url: '/budget-lines/budget-operations/clear-column/export',
      params: { scope: 'capex', year: new Date().getFullYear(), column: 'budget' },
    }));
  });

  it('clears the CAPEX column after confirmation and reports the lines cleared, not those without an amount', async () => {
    operation.mockResolvedValue({ data: { success: true, summary: { totalItems: 3, cleared: 1, skipped: 2, errors: 0 } } });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    await chooseColumn('ops:operations.budgetColumns.budget');
    fireEvent.click(await screen.findByRole('button', { name: 'operations.columnReset.clearColumn' }));

    await waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'operations.columnReset.confirmMessage',
      confirmLabel: 'operations.columnReset.clearColumn',
      intent: 'danger',
    }));
    expect(operation.mock.calls[0][1]).toEqual({ scope: 'capex', year: new Date().getFullYear(), column: 'budget' });
    expect(operation.mock.calls[0][0]).toBe('/budget-lines/budget-operations/clear-column');
    // The result is written beside the pill.
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('operations.columnReset.clearDone:1'));
    const result = screen.getByRole('status');
    expect(result).toHaveAttribute('role', 'status');
    expect(result.parentElement).toContainElement(screen.getByRole('button', { name: 'operations.columnReset.clearColumn' }));
  });

  it('says no line held an amount when the clear cleared none, without counting the lines it passed over', async () => {
    // The 2027 case: lines of the year without a version, none with an amount; the server passes over every line of the type.
    capexRows.current = [{ id: 'c-2', description: 'Storage', versions: {} }];
    operation.mockResolvedValue({ data: { success: true, summary: { totalItems: 15, cleared: 0, skipped: 15, errors: 0 } } });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    await chooseColumn('ops:operations.budgetColumns.revision');
    fireEvent.click(await screen.findByRole('button', { name: 'operations.columnReset.clearColumn' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('operations.columnReset.clearDoneNoAmount'));
    expect(screen.getByRole('status').textContent).not.toMatch(/skipped|15/);
  });

  it('gives the line name the free width of the full grid, the type and the amount keeping theirs', async () => {
    renderPage();
    await chooseColumn('ops:operations.budgetColumns.budget');
    fireEvent.click(await screen.findByRole('button', { name: 'operations.columnReset.showAllLines:2' }));
    await screen.findByTestId('row-o-1');
    const defs = Object.fromEntries(grid.props.columnDefs.map((col: any) => [col.field, col]));
    // The grid sizes its columns to its own width once it is drawn, the name taking what the others leave.
    expect(grid.props.autoSizeStrategy).toEqual({ type: 'fitGridWidth' });
    expect(defs.product_name).toMatchObject({ flex: 1 });
    expect(defs.product_name.suppressSizeToFit).toBeFalsy();
    expect(defs.nature).toMatchObject({ width: 110, suppressSizeToFit: true });
    expect(defs.currentValue).toMatchObject({ width: 200, suppressSizeToFit: true });
  });

  it('reads another operation running as a refusal beside the pill', async () => {
    operation.mockRejectedValue(Object.assign(new Error('Conflict'), {
      response: { status: 409, data: { code: 'operation_running', message: 'Another budget operation is running.' } },
    }));
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    await chooseColumn('ops:operations.budgetColumns.budget');
    fireEvent.click(await screen.findByRole('button', { name: 'operations.columnReset.clearColumn' }));
    // The result region is there from the start: wait for the refusal to be written in it.
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/operation_running|Another budget operation/));
  });

  it('shows the three numbers, the five lines with the largest amounts, the rest counted, and the consequence', async () => {
    const year = `y${new Date().getFullYear()}`;
    capexRows.current = Array.from({ length: 7 }, (_, i) => ({
      id: `c-${i}`, description: `Asset ${i}`, item_number: i + 1, line_number: 500100 + i,
      versions: { [year]: { totals: { budget: (i + 1) * 100, revision: 0, follow_up: 0, landing: 0 } } },
    }));
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    await chooseColumn('ops:operations.budgetColumns.budget');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row').slice(1, 6).map((r) => r.firstElementChild?.textContent)).toEqual(['Asset 6', 'Asset 5', 'Asset 4', 'Asset 3', 'Asset 2']);
    expect(within(table).getByText('common:operationPanel.moreLines:2')).toBeInTheDocument();
    expect(screen.getByText('operations.columnReset.totalItems')).toBeInTheDocument();
    expect(screen.getByText('operations.columnReset.itemsWithData')).toBeInTheDocument();
    expect(screen.getByText('operations.columnReset.clearWarning:7')).toBeInTheDocument();
    // The full grid, closed until asked for.
    expect(screen.queryByTestId('row-c-0')).not.toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: 'operations.columnReset.showAllLines:7' }));
    expect(screen.getByTestId('row-c-0')).toBeInTheDocument();
    expect(screen.getByText('operations.columnReset.allLinesTitle')).toBeInTheDocument();
  });

  it('puts the largest amounts first in the preview, a negative one included', async () => {
    const year = `y${new Date().getFullYear()}`;
    capexRows.current = [100, -900, 300].map((amount, i) => ({
      id: `c-${i}`, description: `Asset ${i}`, item_number: i + 1, line_number: 500200 + i,
      versions: { [year]: { totals: { budget: amount, revision: 0, follow_up: 0, landing: 0 } } },
    }));
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    await chooseColumn('ops:operations.budgetColumns.budget');
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row').slice(1, 4).map((r) => r.firstElementChild?.textContent)).toEqual(['Asset 1', 'Asset 2', 'Asset 0']);
  });

  it('offers nothing when the budget columns cannot be read', () => {
    columnsSetting.failed = true;
    renderPage();
    expect(screen.getByRole('alert')).toHaveTextContent('operations.columnReset.loadError');
    expect(screen.queryByRole('button', { name: 'operations.columnReset.clearColumn' })).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('does nothing when the confirmation is cancelled', async () => {
    confirm.mockResolvedValueOnce(false);
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    await chooseColumn('ops:operations.budgetColumns.budget');
    fireEvent.click(await screen.findByRole('button', { name: 'operations.columnReset.clearColumn' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(operation).not.toHaveBeenCalled();
  });

  it('still clears a column without amounts, saying only its periods go', async () => {
    capexRows.current = [{ id: 'c-2', description: 'Storage', versions: {} }];
    operation.mockResolvedValue({ data: { success: true, summary: { totalItems: 1, cleared: 1, skipped: 0, errors: 0 } } });
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    await chooseColumn('ops:operations.budgetColumns.revision');
    const clear = await screen.findByRole('button', { name: 'operations.columnReset.clearColumn' });
    expect(clear).toBeEnabled();
    fireEvent.click(clear);

    await waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
    const { message } = confirm.mock.calls[0][0];
    const { getByText } = render(<>{message}</>, { container: container.appendChild(document.createElement('div')) });
    expect(getByText('operations.columnReset.confirmPeriodsOnly')).toBeInTheDocument();
  });

  it('preselects no column: Clear stays off until a column is chosen', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    expect(screen.getByText('operations.columnReset.chooseColumn')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'operations.columnReset.clearColumn' })).toBeDisabled();
    // One line instead of a grid of zeros.
    expect(screen.getByText('operations.columnReset.chooseColumnFirst')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    await chooseColumn('ops:operations.budgetColumns.landing');
    await waitFor(() => expect(screen.getByRole('button', { name: 'operations.columnReset.clearColumn' })).toBeEnabled());
    expect(screen.queryByText('operations.columnReset.chooseColumnFirst')).not.toBeInTheDocument();
    // No amount in the column: one sentence, and the lines one click away.
    expect(screen.getByText('operations.columnReset.noDataInfo')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'operations.columnReset.showAllLines:1' })).toBeInTheDocument();
  });

  it('offers the shown columns only, Forecast when it is shown, and clears it', async () => {
    const listed = async () => {
      fireEvent.mouseDown(screen.getAllByRole('combobox')[1]);
      return (await screen.findAllByRole('option')).map((o) => o.textContent);
    };
    const { unmount } = renderPage();
    expect(await listed()).not.toContain('ops:operations.budgetColumns.forecast');
    unmount();

    columnsSetting.current = { ...DEFAULT_BUDGET_COLUMNS, enabled: { ...DEFAULT_BUDGET_COLUMNS.enabled, forecast: true, committed: false } };
    operation.mockResolvedValue({ data: { success: true, summary: { totalItems: 1, cleared: 1, skipped: 0, errors: 0 } } });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    expect(await listed()).toEqual([
      'ops:operations.budgetColumns.budget', 'ops:operations.budgetColumns.forecast',
      'ops:operations.budgetColumns.followUp', 'ops:operations.budgetColumns.landing',
    ]);
    fireEvent.click(await screen.findByRole('option', { name: 'ops:operations.budgetColumns.forecast' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'operations.columnReset.clearColumn' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'operations.columnReset.clearColumn' }));
    await waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
    expect(operation.mock.calls[0][1]).toMatchObject({ column: 'forecast' });
  });
});


describe('BudgetColumnResetPage on all lines', () => {
  beforeEach(() => {
    columnsSetting.current = DEFAULT_BUDGET_COLUMNS;
    post.mockReset();
    operation.mockReset();
    post.mockImplementation(async (url: string, body: any) => {
      if (url === '/budget-lines/summary/aggregate') return { data: fakeAggregate(unifiedRows as any[], body) };
      if (url === '/capex-items/summary/aggregate') return { data: fakeAggregate([serversRow] as any[], body) };
      if (url === '/spend-items/summary/aggregate') return { data: fakeAggregate([], body) };
      return operation(url, body);
    });
    confirm.mockClear();
    frozen.capex = false;
  });

  it('opens on All, offers All, OPEX and CAPEX, and clears all lines in one request', async () => {
    operation.mockResolvedValue({ data: { success: true, scope: 'all', summary: { totalItems: 2, cleared: 2, skipped: 0, errors: 0 } } });
    renderPage();
    expect(screen.getAllByRole('tab').map((tab) => tab.textContent)).toEqual(['operations.scope.all', 'operations.scope.opex', 'operations.scope.capex']);
    expect(screen.getByRole('tab', { name: 'operations.scope.all' })).toHaveAttribute('aria-selected', 'true');
    await chooseColumn('ops:operations.budgetColumns.budget');
    fireEvent.click(await screen.findByRole('button', { name: 'operations.columnReset.clearColumn' }));
    await waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
    expect(operation.mock.calls[0]).toEqual(['/budget-lines/budget-operations/clear-column', { scope: 'all', year: new Date().getFullYear(), column: 'budget' }]);
  });

  it('links each line to its BL page in a new tab and shows its type, in the full grid', async () => {
    renderPage();
    await chooseColumn('ops:operations.budgetColumns.budget');
    fireEvent.click(await screen.findByRole('button', { name: 'operations.columnReset.showAllLines:2' }));
    const licences = await screen.findByRole('link', { name: 'Licences' });
    expect(licences).toHaveAttribute('href', '/ops/budget/BL-12');
    expect(licences).toHaveAttribute('target', '_blank');
    expect(within(screen.getByTestId('row-c-1')).getByText('operations.scope.capex')).toBeInTheDocument();
  });

  it('links a CAPEX line by its own number on the CAPEX tab, never its CPX number', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    await chooseColumn('ops:operations.budgetColumns.budget');
    fireEvent.click(await screen.findByRole('button', { name: 'operations.columnReset.showAllLines:1' }));
    expect(await screen.findByRole('link', { name: 'Servers' })).toHaveAttribute('href', '/ops/budget/BL-500003');
    expect(screen.queryByText('operations.scope.capex', { selector: '[data-col="nature"]' })).toBeNull();
  });

  it('names the frozen type in All and keeps Clear off', async () => {
    frozen.capex = true;
    renderPage();
    await chooseColumn('ops:operations.budgetColumns.budget');
    expect(await screen.findByText('operations.columnReset.columnFrozenNatureError')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'operations.columnReset.clearColumn' })).toBeDisabled();
  });
});
