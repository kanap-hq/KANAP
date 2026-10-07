import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

const state = vi.hoisted(() => ({ coas: [] as any[], level: 'admin' as 'reader' | 'member' | 'admin' }));
const grid = vi.hoisted(() => ({ props: null as null | Record<string, any>, mounts: 0 }));
const manage = vi.hoisted(() => ({ open: false }));

vi.mock('../../api', () => ({
  default: {
    get: vi.fn(async (url: string) => {
      if (url === '/chart-of-accounts') return { data: { items: state.coas } };
      return { data: { items: [] } };
    }),
  },
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (_resource: string, level: string) => {
      const rank: Record<string, number> = { reader: 1, member: 3, manager: 3, admin: 4 };
      return rank[state.level] >= rank[level];
    },
  }),
}));
vi.mock('../../components/ServerDataGrid', () => ({
  default: function GridStub(props: Record<string, any>) {
    React.useEffect(() => {
      grid.mounts += 1;
    }, []);
    grid.props = props;
    return <div data-testid="grid" />;
  },
}));
vi.mock('./ManageCoAsDialog', () => ({
  default: (props: { open: boolean }) => {
    manage.open = props.open;
    return props.open ? <div data-testid="manage-dialog" /> : null;
  },
}));

import CoaPage from './CoaPage';

function chart(overrides: Record<string, unknown>) {
  return {
    id: 'x',
    code: 'X',
    name: 'X',
    country_iso: null,
    scope: 'COUNTRY',
    is_default: false,
    is_global_default: false,
    is_consolidation: false,
    companies_count: 0,
    accounts_count: 0,
    accounts_unmapped_count: 0,
    accounts_outside_count: 0,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

const FR = chart({
  id: 'fr', code: 'FR-PCG', name: 'Plan comptable général', country_iso: 'FR', is_default: true,
  accounts_count: 512, accounts_outside_count: 3, accounts_unmapped_count: 2,
});
const IFRS = chart({
  id: 'ifrs', code: 'IFRS', name: 'IFRS group accounts', scope: 'GLOBAL',
  is_global_default: true, is_consolidation: true, accounts_count: 14, accounts_unmapped_count: 14,
});
const IT = chart({ id: 'it', code: 'IT-PDC', name: 'Piano dei conti', country_iso: 'IT', is_default: true, accounts_count: 80 });

function renderPage(path = '/master-data/coa?selected=fr') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={queryClient}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <CoaPage />
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('CoaPage summary and consolidation health', () => {
  beforeEach(() => {
    state.coas = [FR, IFRS, IT];
    state.level = 'admin';
    grid.props = null;
    grid.mounts = 0;
    manage.open = false;
  });

  it('describes the selected chart and its roles in words', async () => {
    renderPage();
    const summary = await screen.findByTestId('coa-summary');
    expect(summary).toHaveTextContent('FR-PCG · 512 accounts');
    expect(summary).toHaveTextContent('Plan comptable général · France · Default for France');
    expect(screen.getByRole('button', { name: 'FR-PCG' })).toBeInTheDocument();
    expect(screen.queryByText(/★|⊕/)).not.toBeInTheDocument();
  });

  it('filters the grid on the accounts outside the consolidation chart, over every status, and resets', async () => {
    renderPage();
    const outside = await screen.findByRole('button', { name: '3 accounts point to a consolidation account missing from IFRS' });
    expect(screen.getByRole('button', { name: '2 accounts have no consolidation account' })).toBeInTheDocument();
    expect(grid.props?.extraParams).toEqual({ coaId: 'fr' });
    expect(grid.props?.statusScopeConfig).toEqual({ defaultScope: 'enabled' });
    const mountsBefore = grid.mounts;

    fireEvent.click(outside);
    await waitFor(() => expect(grid.props?.extraParams).toEqual({ coaId: 'fr', consolidationStatus: 'outside' }));
    expect(grid.props?.statusScopeConfig).toEqual({ defaultScope: 'all' });
    expect(grid.mounts).toBeGreaterThan(mountsBefore);
    expect(outside).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '2 accounts have no consolidation account' }));
    await waitFor(() => expect(grid.props?.extraParams).toEqual({ coaId: 'fr', consolidationStatus: 'unmapped' }));

    fireEvent.click(screen.getByRole('button', { name: 'Show all accounts' }));
    await waitFor(() => expect(grid.props?.extraParams).toEqual({ coaId: 'fr' }));
    expect(grid.props?.statusScopeConfig).toEqual({ defaultScope: 'enabled' });
    expect(screen.queryByRole('button', { name: 'Show all accounts' })).not.toBeInTheDocument();
  });

  it('restores the filter from the address', async () => {
    renderPage('/master-data/coa?selected=fr&consolidation=unmapped');
    await screen.findByRole('button', { name: 'Show all accounts' });
    expect(grid.props?.extraParams).toEqual({ coaId: 'fr', consolidationStatus: 'unmapped' });
  });

  it('keeps the way back when a filtered chart has nothing left to remap, and ignores the filter on the consolidation chart', async () => {
    const { unmount } = renderPage('/master-data/coa?selected=it&consolidation=outside');
    expect(await screen.findByText('All accounts map to the consolidation chart IFRS.')).toBeInTheDocument();
    expect(grid.props?.extraParams).toEqual({ coaId: 'it', consolidationStatus: 'outside' });
    fireEvent.click(screen.getByRole('button', { name: 'Show all accounts' }));
    await waitFor(() => expect(grid.props?.extraParams).toEqual({ coaId: 'it' }));
    unmount();

    renderPage('/master-data/coa?selected=ifrs&consolidation=outside');
    await screen.findByTestId('coa-summary');
    await waitFor(() => expect(grid.props?.extraParams).toEqual({ coaId: 'ifrs' }));
    expect(grid.props?.statusScopeConfig).toEqual({ defaultScope: 'enabled' });
  });

  it('shows no health line for the consolidation chart itself, and a quiet line when every account maps', async () => {
    renderPage('/master-data/coa?selected=ifrs');
    const summary = await screen.findByTestId('coa-summary');
    expect(summary).toHaveTextContent('IFRS group accounts · All countries · Default for other countries · Consolidation chart');
    expect(screen.queryByTestId('coa-consolidation-health')).not.toBeInTheDocument();
    expect(summary).not.toHaveTextContent('no consolidation account');

    fireEvent.click(screen.getByRole('button', { name: 'IT-PDC' }));
    expect(await screen.findByText('All accounts map to the consolidation chart IFRS.')).toBeInTheDocument();
  });

  it('says when the tenant has no consolidation chart and opens the manage dialog from the line', async () => {
    state.coas = [FR, { ...IFRS, is_consolidation: false }, IT];
    renderPage();
    expect(await screen.findByText(/No consolidation chart\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /point to a consolidation account/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Choose one in Manage charts.' }));
    expect(await screen.findByTestId('manage-dialog')).toBeInTheDocument();
  });

  it('flags the grid rows outside the consolidation chart next to their consolidation number', async () => {
    renderPage();
    await screen.findByTestId('coa-summary');
    await waitFor(() => expect(grid.props).not.toBeNull());
    const column = (grid.props!.columns as any[]).find((col) => col.field === 'consolidation_account_number');
    const params = (status: string) => ({
      value: 9999,
      data: { id: 'a1', account_number: 612100, consolidation_account_number: 9999, consolidation_status: status },
      colDef: column,
    });

    const { unmount } = render(<MemoryRouter>{column.cellRenderer(params('outside'))}</MemoryRouter>);
    expect(screen.getByRole('img', { name: 'Not in the consolidation chart IFRS' })).toBeInTheDocument();
    unmount();

    act(() => {
      render(<MemoryRouter>{column.cellRenderer(params('mapped'))}</MemoryRouter>);
    });
    expect(screen.queryByRole('img', { name: /Not in the consolidation chart/ })).not.toBeInTheDocument();
  });
});
