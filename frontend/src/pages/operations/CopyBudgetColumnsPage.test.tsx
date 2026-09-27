import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
// The grid lists its rows with the flag the page computed for each.
vi.mock('ag-grid-react', () => ({
  AgGridReact: ({ rowData }: { rowData: Array<{ id: string; product_name: string; willBeSkipped?: boolean; previewValue?: number }> }) => (
    <ul>
      {rowData.map((r) => (
        <li key={r.id} data-preview={r.previewValue ?? ''}>{`${r.product_name}${r.willBeSkipped ? ' (skipped)' : ''}`}</li>
      ))}
    </ul>
  ),
}));
const readable = new Set(['opex', 'capex']);
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string) => readable.has(resource) }),
}));
vi.mock('../../components/AgGridBox', () => ({ default: ({ children }: { children?: React.ReactNode }) => <div>{children}</div> }));
vi.mock('../../components/reports/ReportLayout', () => ({
  default: ({ filters, actions, children }: { filters?: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode }) => (
    <div>{filters}{actions}{children}</div>
  ),
  ReportFilter: ({ label, children }: { label: string; children: React.ReactNode }) => <label>{label}{children}</label>,
  reportFilterMenuProps: {},
  reportFilterSelectSx: {},
}));
vi.mock('../../components/design', () => ({
  useKanapDialogs: () => ({ alert: vi.fn(async () => undefined) }),
}));
vi.mock('../../hooks/useFreezeState', () => {
  const slot = { frozen: false };
  const scope = { budget: slot, revision: slot, forecast: slot, actual: slot, landing: slot };
  return { useFreezeState: () => ({ data: { summary: { scopes: { opex: scope, capex: scope } } }, isLoading: false }) };
});

const summaryRow = (name: 'product_name' | 'description', label: string) => ({
  id: `${label}-1`,
  [name]: label,
  versions: { [`y${new Date().getFullYear()}`]: { totals: { budget: 12000, revision: 0, follow_up: 0, landing: 0 } } },
});
const opexHook = vi.fn();
const capexHook = vi.fn();
vi.mock('../reports/useOpexSummary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../reports/useOpexSummary')>()),
  useOpexSummaryAll: (years: number[], options?: { enabled?: boolean }) => opexHook(years, options),
}));
vi.mock('../reports/useCapexSummary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../reports/useCapexSummary')>()),
  useCapexSummaryAll: (years: number[], options?: { enabled?: boolean }) => capexHook(years, options),
}));

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
import CopyBudgetColumnsPage from './CopyBudgetColumnsPage';
import { DEFAULT_BUDGET_COLUMNS } from '../../services/budgetColumns';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <CopyBudgetColumnsPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('CopyBudgetColumnsPage', () => {
  beforeEach(() => {
    columnsSetting.current = DEFAULT_BUDGET_COLUMNS;
    readable.clear();
    readable.add('opex');
    readable.add('capex');
    post.mockReset();
    post.mockResolvedValue({ data: { success: true, dryRun: true, summary: { totalItems: 1, processed: 1, skipped: 0, errors: 0 }, results: [] } });
    opexHook.mockReset();
    capexHook.mockReset();
    opexHook.mockReturnValue({ data: [summaryRow('product_name', 'Licences')], isLoading: false });
    capexHook.mockReturnValue({ data: [summaryRow('description', 'Servers')], isLoading: false });
  });

  it('copies OPEX columns by default', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'operations.copyBudgetColumns.dryRun' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/spend-items/budget-operations/copy-column');
  });

  it('the CAPEX switch reads CAPEX lines and posts to the CAPEX route', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    await waitFor(() => expect(capexHook).toHaveBeenLastCalledWith(expect.any(Array), { enabled: true }));
    expect(opexHook).toHaveBeenLastCalledWith(expect.any(Array), { enabled: false });

    fireEvent.click(screen.getByRole('button', { name: 'operations.copyBudgetColumns.dryRun' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/capex-items/budget-operations/copy-column');
    expect(post.mock.calls[0][1]).toMatchObject({ sourceColumn: 'budget', destinationColumn: 'budget', dryRun: true });
  });

  it('marks skipped items from the dry run flag, not from totals', async () => {
    // Totals say the source is empty (+500 / -500); the server still copies it.
    post.mockResolvedValueOnce({ data: {
      success: true, dryRun: true, summary: { totalItems: 1, processed: 1, skipped: 0, errors: 0 },
      results: [{ itemId: 'Licences-1', itemName: 'Licences', sourceValue: 0, currentDestinationValue: 0, newValue: 0, skipped: false }],
    } });
    opexHook.mockReturnValue({ data: [{ ...summaryRow('product_name', 'Licences'), versions: {} }], isLoading: false });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'operations.copyBudgetColumns.dryRun' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'operations.copyBudgetColumns.copyData' })).toBeEnabled());
    expect(screen.getByText('Licences')).toBeInTheDocument();
    expect(screen.queryByText('Licences (skipped)')).not.toBeInTheDocument();

    // A destination the server refuses to overwrite, although its total is zero.
    post.mockResolvedValueOnce({ data: {
      success: true, dryRun: true, summary: { totalItems: 1, processed: 0, skipped: 1, errors: 0 },
      results: [{ itemId: 'Licences-1', itemName: 'Licences', sourceValue: 0, currentDestinationValue: 0, newValue: 0, skipped: true }],
    } });
    fireEvent.click(screen.getByRole('button', { name: 'operations.copyBudgetColumns.dryRun' }));
    expect(await screen.findByText('Licences (skipped)')).toBeInTheDocument();
  });

  it('drops the dry run when a copy parameter changes', async () => {
    renderPage();
    const copy = () => screen.getByRole('button', { name: 'operations.copyBudgetColumns.copyData' });
    fireEvent.click(screen.getByRole('button', { name: 'operations.copyBudgetColumns.dryRun' }));
    await waitFor(() => expect(copy()).toBeEnabled());

    fireEvent.change(screen.getByRole('spinbutton', { name: 'operations.copyBudgetColumns.percentageIncrease' }), { target: { value: '5' } });
    await waitFor(() => expect(copy()).toBeDisabled());

    fireEvent.click(screen.getByRole('button', { name: 'operations.copyBudgetColumns.dryRun' }));
    await waitFor(() => expect(copy()).toBeEnabled());
    fireEvent.click(screen.getByRole('checkbox'));
    await waitFor(() => expect(copy()).toBeDisabled());
  });

  it('opens on CAPEX for a user who can read CAPEX only', async () => {
    readable.delete('opex');
    renderPage();
    expect(screen.getByRole('tab', { name: 'operations.scope.opex' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'operations.copyBudgetColumns.dryRun' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/capex-items/budget-operations/copy-column');
  });

  it('a row the dry run did not answer shows as skipped and keeps its destination value', async () => {
    const year = new Date().getFullYear();
    opexHook.mockReturnValue({
      data: [
        summaryRow('product_name', 'Licences'),
        // Disabled item: the server leaves it out of the dry run.
        { id: 'Hosting-1', product_name: 'Hosting', versions: { [`y${year + 1}`]: { totals: { budget: 700, revision: 0, follow_up: 0, landing: 0 } } } },
      ],
      isLoading: false,
    });
    post.mockResolvedValueOnce({ data: {
      success: true, dryRun: true, summary: { totalItems: 1, processed: 1, skipped: 0, errors: 0 },
      results: [{ itemId: 'Licences-1', itemName: 'Licences', sourceValue: 12000, currentDestinationValue: 0, newValue: 12000, skipped: false }],
    } });
    renderPage();
    expect(screen.getByText('Hosting')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'operations.copyBudgetColumns.dryRun' }));
    const hosting = await screen.findByText('Hosting (skipped)');
    expect(hosting).toHaveAttribute('data-preview', '700');
    expect(screen.getByText('Licences')).toHaveAttribute('data-preview', '12000');
  });

  it('copies from the default column of Y to the default column of Y+1', async () => {
    columnsSetting.current = { ...DEFAULT_BUDGET_COLUMNS, default_column: 'committed' };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'operations.copyBudgetColumns.dryRun' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const Y = new Date().getFullYear();
    expect(post.mock.calls[0][1]).toMatchObject({ sourceYear: Y, sourceColumn: 'revision', destinationYear: Y + 1, destinationColumn: 'revision' });
  });

  it('offers the shown columns, Forecast included when it is shown, and copies into it', async () => {
    const options = async (index: number) => {
      fireEvent.mouseDown(screen.getAllByRole('combobox')[index]);
      const items = (await screen.findAllByRole('option')).map((o) => o.textContent);
      fireEvent.keyDown(screen.getAllByRole('listbox')[0], { key: 'Escape' });
      return items;
    };
    const { unmount } = renderPage();
    // Source year, source column, destination year, destination column.
    expect(await options(1)).toEqual([
      'ops:operations.budgetColumns.budget', 'ops:operations.budgetColumns.revision',
      'ops:operations.budgetColumns.followUp', 'ops:operations.budgetColumns.landing',
    ]);
    unmount();

    columnsSetting.current = {
      ...DEFAULT_BUDGET_COLUMNS,
      enabled: { ...DEFAULT_BUDGET_COLUMNS.enabled, forecast: true },
      labels: { ...DEFAULT_BUDGET_COLUMNS.labels, forecast: 'A2' },
    };
    renderPage();
    expect(await options(3)).toContain('A2');
    fireEvent.mouseDown(screen.getAllByRole('combobox')[3]);
    fireEvent.click(await screen.findByRole('option', { name: 'A2' }));
    fireEvent.click(screen.getByRole('button', { name: 'operations.copyBudgetColumns.dryRun' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1]).toMatchObject({ sourceColumn: 'budget', destinationColumn: 'forecast' });
  });
});
