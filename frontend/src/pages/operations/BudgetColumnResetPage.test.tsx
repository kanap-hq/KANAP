import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
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
vi.mock('ag-grid-react', () => ({ AgGridReact: () => null }));
vi.mock('../../components/AgGridBox', () => ({ default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../components/reports/ReportLayout', () => ({
  default: ({ filters, actions, children }: { filters?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) => (
    <div>{filters}{actions}{children}</div>
  ),
  ReportFilter: ({ label, children }: { label: string; children: React.ReactNode }) => <label>{label}{children}</label>,
  reportFilterMenuProps: {},
  reportFilterSelectSx: {},
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true }),
}));
const confirm = vi.fn(async (_options: { message: React.ReactNode; intent?: string }) => true);
vi.mock('../../components/design', () => ({
  useKanapDialogs: () => ({ confirm }),
}));
vi.mock('../../hooks/useFreezeState', () => {
  const slot = { frozen: false };
  const scope = { budget: slot, revision: slot, forecast: slot, actual: slot, landing: slot };
  return { useFreezeState: () => ({ data: { summary: { scopes: { opex: scope, capex: scope } } }, isLoading: false }) };
});
const serversRow = { id: 'c-1', description: 'Servers', versions: { [`y${new Date().getFullYear()}`]: { totals: { budget: 5000, revision: 0, follow_up: 0, landing: 0 } } } };
const capexRows = { current: [serversRow] as unknown[] };

// The tenant's column settings, set per test.
const columnsSetting = vi.hoisted(() => ({ current: null as unknown }));
vi.mock('../../hooks/useBudgetColumns', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../hooks/useBudgetColumns')>();
  let cache: { settings: unknown; value: ReturnType<typeof mod.resolveBudgetColumns> } | null = null;
  const t = ((key: string) => key) as unknown as Parameters<typeof mod.resolveBudgetColumns>[1];
  return {
    ...mod,
    useBudgetColumns: () => {
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
    post.mockReset();
    operation.mockReset();
    post.mockImplementation(async (url: string, body: any) => {
      if (url === '/capex-items/summary/aggregate') return { data: fakeAggregate(capexRows.current as any[], body) };
      if (url === '/spend-items/summary/aggregate') return { data: fakeAggregate([], body) };
      return operation(url, body);
    });
    confirm.mockClear();
    capexRows.current = [serversRow];
  });

  it('clears the CAPEX column after confirmation and reports the result with plural forms', async () => {
    operation.mockResolvedValue({ data: { success: true, summary: { totalItems: 3, cleared: 1, skipped: 2, errors: 0 } } });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    await chooseColumn('ops:operations.budgetColumns.budget');
    fireEvent.click(await screen.findByRole('button', { name: 'operations.columnReset.clearColumn' }));

    await waitFor(() => expect(operation).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ intent: 'danger' }));
    expect(operation.mock.calls[0][1]).toMatchObject({ column: 'budget' });
    expect(operation.mock.calls[0][0]).toBe('/capex-items/budget-operations/clear-column');
    expect(await screen.findByText('operations.columnReset.clearDone:1 operations.results.skipped:2')).toBeInTheDocument();
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
    expect(screen.queryByText('operations.columnReset.dataPreview')).not.toBeInTheDocument();
    await chooseColumn('ops:operations.budgetColumns.landing');
    await waitFor(() => expect(screen.getByRole('button', { name: 'operations.columnReset.clearColumn' })).toBeEnabled());
    expect(screen.queryByText('operations.columnReset.chooseColumnFirst')).not.toBeInTheDocument();
    expect(screen.getByText('operations.columnReset.dataPreview')).toBeInTheDocument();
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
