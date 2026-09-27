import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
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

/** The status card of a scope: its column names, in order. */
const statusCard = (title: string) => within(screen.getByText(title).parentElement as HTMLElement);

describe('BudgetFreezePage', () => {
  beforeEach(() => {
    columnsSetting.current = { ...DEFAULT_BUDGET_COLUMNS, labels: { ...DEFAULT_BUDGET_COLUMNS.labels, planned: 'A0' } };
    frozenOpex.columns = [];
    auth.admin = true;
    post.mockReset();
    post.mockResolvedValue({ data: { year: 2026, entries: [], summary: { year: 2026, scopes: {} } } });
  });

  it('lists every column with the tenant names, hidden ones marked', () => {
    renderPage();
    const opex = statusCard('operations.freeze.opexColumns');
    expect(opex.getByText('A0')).toBeInTheDocument();
    expect(opex.getByText('ops:operations.budgetColumns.forecast')).toBeInTheDocument();
    // Forecast is the one hidden column by default.
    expect(opex.getAllByText('operations.freeze.hidden')).toHaveLength(1);
    expect(statusCard('operations.freeze.capexColumns').getByText('ops:operations.budgetColumns.forecast')).toBeInTheDocument();
  });

  it('preselects every column, hidden ones included, so freezing a year freezes all five', async () => {
    renderPage();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'operations.freeze.freezeData' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1].scopes).toEqual([{ scope: 'opex', columns: ['budget', 'revision', 'forecast', 'actual', 'landing'] }]);
  });

  it('unfreezes a frozen hidden column', async () => {
    frozenOpex.columns = ['forecast'];
    renderPage();
    expect(statusCard('operations.freeze.opexColumns').getByText('operations.freeze.frozen')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('checkbox')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'operations.freeze.unfreezeData' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][1].scopes[0].columns).toContain('forecast');
  });

  it('says who can change the page, with the same words as the column settings', () => {
    auth.admin = false;
    renderPage();
    expect(screen.getByText('operations.budgetAdminOnly')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'operations.freeze.freezeData' })).toBeDisabled();
  });
});
