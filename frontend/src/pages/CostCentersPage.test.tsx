import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

const treeState = vi.hoisted(() => ({ ready: true, nodes: [] as unknown[], isError: false }));
const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const levels = vi.hoisted(() => ({ value: 'admin' as 'reader' | 'member' | 'admin' | null }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (_resource: string, level: string) => {
      const rank: Record<string, number> = { reader: 1, member: 3, manager: 3, admin: 4 };
      return levels.value != null && rank[levels.value] >= rank[level];
    },
  }),
}));
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })) } }));
vi.mock('../hooks/useCostCenterTree', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useCostCenterTree')>();
  return {
    ...actual,
    useCostCenterTree: () => actual.buildCostCenterTree(treeState.nodes as any, treeState.ready, treeState.isError),
  };
});
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    return <div data-testid="grid" />;
  },
}));

import CostCentersPage from './CostCentersPage';

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/master-data/cost-centers']}>
          <CostCentersPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('CostCentersPage', () => {
  beforeEach(() => {
    treeState.ready = true;
    treeState.nodes = [];
    treeState.isError = false;
    levels.value = 'admin';
    grid.props = null;
  });

  it('shows the one-line explainer when the tenant has no cost center', () => {
    renderPage();
    expect(screen.getByTestId('cost-centers-empty')).toHaveTextContent('costCenters.emptyExplainer');
  });

  it('hides the explainer once the tenant has a node, and while the tree loads', () => {
    treeState.nodes = [{ id: 'it', code: 'IT', name: 'IT department', kind: 'group', parent_id: null }];
    const { unmount } = renderPage();
    expect(screen.queryByTestId('cost-centers-empty')).toBeNull();
    unmount();
    treeState.nodes = [];
    treeState.ready = false;
    renderPage();
    expect(screen.queryByTestId('cost-centers-empty')).toBeNull();
  });

  it('lists the tree through the grid, sorted by path, with the status column hidden', () => {
    renderPage();
    expect(grid.props?.endpoint).toBe('/cost-centers');
    expect(grid.props?.columnPreferencesKey).toBe('cost-centers');
    expect(grid.props?.defaultSort).toEqual({ field: 'path', direction: 'ASC' });
    const fields = (grid.props?.columns as Array<{ field: string; defaultHidden?: boolean }>).map((c) => c.field);
    expect(fields).toEqual(['code', 'name', 'kind', 'parent_name', 'company_name', 'owner_name', 'status']);
    const status = (grid.props?.columns as Array<{ field: string; defaultHidden?: boolean }>).find((c) => c.field === 'status');
    expect(status?.defaultHidden).toBe(true);
  });

  it('offers New to members and the CSV and delete actions to admins only', () => {
    levels.value = 'member';
    const { unmount } = renderPage();
    expect(screen.getByRole('button', { name: 'shared.labels.new' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'shared.labels.importCsv' })).toBeNull();
    unmount();
    levels.value = 'admin';
    renderPage();
    expect(screen.getByRole('button', { name: 'shared.labels.importCsv' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'shared.labels.exportCsv' })).toBeInTheDocument();
  });

  it('refuses readers without access', () => {
    levels.value = null;
    renderPage();
    expect(screen.queryByTestId('grid')).toBeNull();
  });

  it('does not show the explainer when the tree failed to load', () => {
    treeState.isError = true;
    renderPage();
    expect(screen.queryByTestId('cost-centers-empty')).toBeNull();
  });
});
