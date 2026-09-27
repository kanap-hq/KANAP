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
vi.mock('ag-grid-react', () => ({
  AgGridReact: ({ rowData, columnDefs }: { rowData: Array<{ itemId: string; itemName: string }>; columnDefs: Array<{ headerName?: string }> }) => (
    <div>
      <ul>{columnDefs.map((c) => <li key={c.headerName}>{c.headerName}</li>)}</ul>
      <ul>{rowData.map((r) => <li key={r.itemId}>{r.itemName}</li>)}</ul>
    </div>
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
}));
vi.mock('../../components/design', () => ({
  useKanapDialogs: () => ({ alert: vi.fn(async () => undefined) }),
}));
vi.mock('../../services/allocationRules', () => ({
  fetchAllocationRule: vi.fn(async () => ({ mode: 'method', method: 'headcount' })),
}));

import api from '../../api';
import CopyAllocationsPage from './CopyAllocationsPage';

const post = (api as unknown as { post: ReturnType<typeof vi.fn> }).post;

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <CopyAllocationsPage />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const dryRunResponse = {
  data: {
    success: true,
    dryRun: true,
    summary: { totalItems: 1, processed: 1, skipped: 0, errors: 0 },
    results: [{
      itemId: 'i-1', itemName: 'Servers', sourceMethod: 'headcount', sourceMethodLabel: 'Headcount',
      destinationMethod: null, destinationMethodLabel: '', resultMethod: 'headcount', resultMethodLabel: 'Headcount',
      sourceAllocationsCount: 0, destinationAllocationsCount: 0, action: 'copy',
    }],
  },
};

describe('CopyAllocationsPage', () => {
  beforeEach(() => {
    readable.clear();
    readable.add('opex');
    readable.add('capex');
    post.mockReset();
    post.mockResolvedValue(dryRunResponse);
  });

  it('copies OPEX allocations by default', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'operations.copyAllocations.dryRun' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/spend-items/budget-operations/copy-allocations');
  });

  it('the CAPEX switch posts to the CAPEX route', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('tab', { name: 'operations.scope.capex' }));
    fireEvent.click(screen.getByRole('button', { name: 'operations.copyAllocations.dryRun' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/capex-items/budget-operations/copy-allocations');
    expect(post.mock.calls[0][1]).toMatchObject({ dryRun: true });
  });

  it('opens on CAPEX for a user who cannot read OPEX', async () => {
    readable.delete('opex');
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'operations.copyAllocations.dryRun' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0][0]).toBe('/capex-items/budget-operations/copy-allocations');
  });

  it('labels the preview from the locale files', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'operations.copyAllocations.dryRun' }));
    expect(await screen.findByText('Servers')).toBeInTheDocument();
    expect(screen.getByText('operations.copyAllocations.preview')).toBeInTheDocument();
    expect(screen.getByText('operations.copyAllocations.sourceLabel')).toBeInTheDocument();
    expect(screen.getByText('operations.copyAllocations.destinationLabel')).toBeInTheDocument();
  });
});
