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
vi.mock('../reports/useOpexSummary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../reports/useOpexSummary')>()),
  useOpexSummaryAll: () => ({ data: [], isLoading: false }),
}));
vi.mock('../reports/useCapexSummary', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../reports/useCapexSummary')>()),
  useCapexSummaryAll: () => ({ data: capexRows.current, isLoading: false }),
}));

import api from '../../api';
import BudgetColumnResetPage from './BudgetColumnResetPage';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

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
    post.mockReset();
    confirm.mockClear();
    capexRows.current = [serversRow];
  });

  it('clears the CAPEX column after confirmation and reports the result with plural forms', async () => {
    post.mockResolvedValue({ data: { success: true, summary: { totalItems: 3, cleared: 1, skipped: 2, errors: 0 } } });
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    fireEvent.click(await screen.findByRole('button', { name: 'operations.columnReset.clearColumn' }));

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ intent: 'danger' }));
    expect(post.mock.calls[0][0]).toBe('/capex-items/budget-operations/clear-column');
    expect(await screen.findByText('operations.columnReset.clearDone:1 operations.results.skipped:2')).toBeInTheDocument();
  });

  it('does nothing when the confirmation is cancelled', async () => {
    confirm.mockResolvedValueOnce(false);
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    fireEvent.click(await screen.findByRole('button', { name: 'operations.columnReset.clearColumn' }));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(post).not.toHaveBeenCalled();
  });

  it('still clears a column without amounts, saying only its periods go', async () => {
    capexRows.current = [{ id: 'c-2', description: 'Storage', versions: {} }];
    post.mockResolvedValue({ data: { success: true, summary: { totalItems: 1, cleared: 1, skipped: 0, errors: 0 } } });
    const { container } = renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    const clear = await screen.findByRole('button', { name: 'operations.columnReset.clearColumn' });
    expect(clear).toBeEnabled();
    fireEvent.click(clear);

    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    const { message } = confirm.mock.calls[0][0];
    const { getByText } = render(<>{message}</>, { container: container.appendChild(document.createElement('div')) });
    expect(getByText('operations.columnReset.confirmPeriodsOnly')).toBeInTheDocument();
  });
});
