import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string, opts?: {column: string; nature: string}) => key === 'operations.freeze.selectCell' ? `${opts?.column}: ${opts?.nature}` : key, i18n: { language: 'en', resolvedLanguage: 'en' } };
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
const box = (label: string, nature: string) => row(label).getByRole('checkbox', { name: `${label}: ${nature}` });

describe('BudgetFreezePage', () => {
  beforeEach(() => {
    columnsSetting.current = { ...DEFAULT_BUDGET_COLUMNS, labels: { ...DEFAULT_BUDGET_COLUMNS.labels, planned: 'A0' } };
    frozenOpex.columns = [];
    auth.admin = true;
    post.mockReset();
    post.mockResolvedValue({ data: { year: 2026, entries: [], summary: { year: 2026, scopes: {} } } });
  });

  it('shows every named column in a side-by-side nature matrix, including hidden columns', () => {
    renderPage();
    expect(screen.getAllByRole('columnheader').map((el) => el.textContent)).toEqual([
      'operations.freeze.column', 'budget.opex', 'budget.capex', 'operations.freeze.both',
    ]);
    expect(screen.getAllByRole('rowheader')).toHaveLength(5);
    expect(screen.getAllByRole('checkbox')).toHaveLength(15);
    expect(screen.getAllByText('operations.freeze.hidden')).toHaveLength(1);
    expect(row('ops:operations.budgetColumns.forecastoperations.freeze.hidden').getAllByLabelText('operations.freeze.editable')).toHaveLength(2);
  });

  it('Both checks OPEX and CAPEX and freezes 2027 Budget in one call with two entries', async () => {
    renderPage();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'operations.freeze.year' }));
    fireEvent.click(screen.getByRole('option', { name: '2027' }));
    fireEvent.click(box('A0', 'operations.freeze.both'));
    expect(box('A0', 'budget.opex')).toBeChecked();
    expect(box('A0', 'budget.capex')).toBeChecked();
    fireEvent.click(screen.getByRole('button', { name: 'operations.freeze.freezeData' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/freeze-states/freeze', { year: 2027, scopes: [
      { scope: 'opex', columns: ['budget'] }, { scope: 'capex', columns: ['budget'] },
    ] });
  });

  it('Both reflects partial selection and clears both cells on a second click', () => {
    renderPage();
    fireEvent.click(box('A0', 'budget.opex'));
    expect(box('A0', 'operations.freeze.both')).toHaveAttribute('data-indeterminate', 'true');
    fireEvent.click(box('A0', 'operations.freeze.both'));
    expect(box('A0', 'budget.capex')).toBeChecked();
    fireEvent.click(box('A0', 'operations.freeze.both'));
    expect(box('A0', 'budget.opex')).not.toBeChecked();
    expect(box('A0', 'budget.capex')).not.toBeChecked();
    expect(screen.getByRole('button', { name: 'operations.freeze.freezeData' })).toBeDisabled();
  });

  it('unfreezes selected hidden and visible columns in one call', async () => {
    frozenOpex.columns = ['forecast'];
    renderPage();
    const hiddenRow = row('ops:operations.budgetColumns.forecastoperations.freeze.hidden');
    expect(hiddenRow.getByLabelText('operations.freeze.frozen')).toBeInTheDocument();
    fireEvent.click(hiddenRow.getByRole('checkbox', { name: 'ops:operations.budgetColumns.forecast: budget.opex' }));
    fireEvent.click(box('A0', 'budget.capex'));
    fireEvent.click(screen.getByRole('button', { name: 'operations.freeze.unfreezeData' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith('/freeze-states/unfreeze', { year: new Date().getFullYear(), scopes: [
      { scope: 'opex', columns: ['forecast'] }, { scope: 'capex', columns: ['budget'] },
    ] });
  });

  it('keeps the budget_ops admin permission on all controls', () => {
    auth.admin = false;
    renderPage();
    expect(screen.getByText('operations.budgetAdminOnly')).toBeInTheDocument();
    for (const checkbox of screen.getAllByRole('checkbox')) expect(checkbox).toBeDisabled();
    expect(screen.getByRole('button', { name: 'operations.freeze.freezeData' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'operations.freeze.unfreezeData' })).toBeDisabled();
  });

  it('handles a failed mutation without an unhandled rejection', async () => {
    post.mockRejectedValue(new Error('offline'));
    renderPage();
    fireEvent.click(box('A0', 'budget.opex'));
    fireEvent.click(screen.getByRole('button', { name: 'operations.freeze.freezeData' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('offline');
  });
});
