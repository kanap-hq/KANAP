import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string, opts?: {column: string; nature: string}) => key === 'operations.freeze.cell' ? `${opts?.column}, ${opts?.nature}` : key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const auth = vi.hoisted(() => ({ admin: true }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => auth.admin }) }));
vi.mock('../../components/PageHeader', () => ({ default: () => null }));

// Freeze state of the selected year: the columns frozen for OPEX.
const frozenOpex = vi.hoisted(() => ({ columns: [] as string[] }));
vi.mock('../../hooks/useFreezeState', () => {
  const slot = (frozen: boolean) => ({ frozen, frozenAt: null, frozenBy: null });
  const scope = (frozen: string[]) => Object.fromEntries(['budget', 'revision', 'forecast', 'actual', 'landing'].map((c) => [c, slot(frozen.includes(c))]));
  return {
    useFreezeState: () => ({
      data: { summary: { scopes: { opex: scope(frozenOpex.columns), capex: scope([]), companies: slot(false), departments: slot(false) } } },
      isLoading: false,
      isFetching: false,
      error: null,
    }),
  };
});

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
import BudgetFreezePage from './BudgetFreezePage';
import { DEFAULT_BUDGET_COLUMNS } from '../../services/budgetColumns';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <BudgetFreezePage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const row = (label: string) => within(screen.getByRole('rowheader', { name: label }).closest('tr')!);
const cell = (label: string, nature: string, rowName = label) => row(rowName).getByRole('button', { name: `${label}, ${nature}` });
const FORECAST = 'ops:operations.budgetColumns.forecast';
const HIDDEN_FORECAST = `${FORECAST}operations.freeze.hidden`;

describe('BudgetFreezePage', () => {
  beforeEach(() => {
    columnsSetting.current = { ...DEFAULT_BUDGET_COLUMNS, labels: { ...DEFAULT_BUDGET_COLUMNS.labels, planned: 'A0' } };
    frozenOpex.columns = [];
    auth.admin = true;
    post.mockReset();
    post.mockResolvedValue({ data: { year: 2026, entries: [], summary: { year: 2026, scopes: {} } } });
  });

  it('shows every named column with one state toggle per nature, including hidden columns', () => {
    frozenOpex.columns = ['forecast'];
    renderPage();
    expect(screen.getAllByRole('columnheader').map((el) => el.textContent)).toEqual([
      'operations.freeze.column', 'budget.opex', 'budget.capex', '',
    ]);
    expect(screen.getAllByRole('rowheader')).toHaveLength(5);
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0);
    expect(screen.getAllByText('operations.freeze.hidden')).toHaveLength(1);
    const forecastOpex = cell(FORECAST, 'budget.opex', HIDDEN_FORECAST);
    expect(forecastOpex).toHaveAttribute('aria-pressed', 'true');
    expect(forecastOpex).toHaveTextContent('operations.freeze.frozen');
    expect(cell(FORECAST, 'budget.capex', HIDDEN_FORECAST)).toHaveTextContent('operations.freeze.open');
    expect(screen.queryByRole('button', { name: 'operations.freeze.freezeData' })).toBeNull();
  });

  it('freezes one open cell with one request and one entry', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: '2027' }));
    fireEvent.click(cell('A0', 'budget.capex'));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/freeze-states/freeze', { year: 2027, scopes: [{ scope: 'capex', columns: ['budget'] }] });
  });

  it('unfreezes one frozen cell with one request and one entry', async () => {
    frozenOpex.columns = ['forecast'];
    renderPage();
    fireEvent.click(cell(FORECAST, 'budget.opex', HIDDEN_FORECAST));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/freeze-states/unfreeze', { year: new Date().getFullYear(), scopes: [{ scope: 'opex', columns: ['forecast'] }] });
  });

  it('disables the cell while its request runs', async () => {
    let resolve: (value: unknown) => void = () => {};
    post.mockReturnValue(new Promise((r) => { resolve = r; }));
    renderPage();
    fireEvent.click(cell('A0', 'budget.opex'));
    await waitFor(() => expect(cell('A0', 'budget.opex')).toBeDisabled());
    expect(cell('A0', 'budget.capex')).not.toBeDisabled();
    resolve({ data: { year: 2026, entries: [], summary: { year: 2026, scopes: {} } } });
    await waitFor(() => expect(cell('A0', 'budget.opex')).not.toBeDisabled());
  });

  it('freezes both natures of a row with one request, sending only the open one', async () => {
    frozenOpex.columns = ['budget'];
    renderPage();
    expect(row('A0').queryByRole('button', { name: 'operations.freeze.unfreezeBoth' })).toBeNull();
    fireEvent.click(row('A0').getByRole('button', { name: 'operations.freeze.freezeBoth' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/freeze-states/freeze', { year: new Date().getFullYear(), scopes: [
      { scope: 'capex', columns: ['budget'] },
    ] });
  });

  it('freezes two open natures of a row with one request and two entries', async () => {
    renderPage();
    fireEvent.click(row('A0').getByRole('button', { name: 'operations.freeze.freezeBoth' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/freeze-states/freeze', { year: new Date().getFullYear(), scopes: [
      { scope: 'opex', columns: ['budget'] }, { scope: 'capex', columns: ['budget'] },
    ] });
  });

  it('lets a reader see the states without toggling them', () => {
    auth.admin = false;
    frozenOpex.columns = ['budget'];
    renderPage();
    expect(screen.getByText('operations.budgetAdminOnly')).toBeInTheDocument();
    expect(within(screen.getByRole('table')).queryAllByRole('button')).toHaveLength(0);
    expect(screen.getByLabelText('A0, budget.opex: operations.freeze.frozen')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('A0, budget.capex: operations.freeze.open'));
    expect(post).not.toHaveBeenCalled();
  });

  it('handles a failed request without an unhandled rejection', async () => {
    post.mockRejectedValue(new Error('offline'));
    renderPage();
    fireEvent.click(cell('A0', 'budget.opex'));
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
    expect(cell('A0', 'budget.opex')).not.toBeDisabled();
  });
});
