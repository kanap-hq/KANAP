import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const nav = vi.hoisted(() => ({ calls: [] as Array<{ sort?: string | null; filters?: string | null; enabled?: boolean }> }));
vi.mock('../../hooks/useCapexNav', () => ({
  useCapexNav: (params: { sort?: string | null; filters?: string | null; enabled?: boolean }) => {
    nav.calls.push(params);
    return { index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null };
  },
}));
vi.mock('../../hooks/useCurrencySettings', () => ({ default: () => ({ data: { defaultCapexCurrency: 'EUR' } }) }));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: vi.fn() }) }));
vi.mock('../../utils/workspaceTabCounts', () => ({ fetchCapexRelationsCount: vi.fn(async () => 0) }));
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: ({ properties, actions, children, onTitleSave }: {
    properties?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; onTitleSave: (v: string) => void;
  }) => (
    <div>
      <button type="button" onClick={() => onTitleSave('New servers')}>set title</button>
      {actions}{properties}{children}
    </div>
  ),
}));
// The drawer stands in for the pickers: each button sets one create field.
vi.mock('./workspace/CapexPropertiesDrawer', () => ({
  default: (props: {
    mode: string; payingCompanyId: string; accountId: string; onPayingCompanyChange: (v: string) => void;
    onAccountChange: (v: string) => void; onAnalyticsValueChange: (axisId: string, v: string | null) => void;
    onCostCenterChange: (v: string) => void; onRunBuildChange: (v: string) => void;
    analyticsValues: Record<string, string | null>;
  }) => (
    <div
      data-mode={props.mode} data-company={props.payingCompanyId} data-account={props.accountId}
      data-analytics={JSON.stringify(props.analyticsValues)}
    >
      <button type="button" onClick={() => props.onPayingCompanyChange('company-1')}>pick company</button>
      <button type="button" onClick={() => props.onPayingCompanyChange('company-2')}>pick other company</button>
      <button type="button" onClick={() => props.onAccountChange('account-1')}>pick account</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-default', 'category-1')}>pick category</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-default', null)}>clear category</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-nature', 'category-2')}>pick nature value</button>
      <button type="button" onClick={() => props.onCostCenterChange('cc-2')}>pick cost center</button>
      <button type="button" onClick={() => props.onCostCenterChange('cc-3')}>pick third cost center</button>
      <button type="button" onClick={() => props.onCostCenterChange('')}>clear cost center</button>
      <button type="button" onClick={() => props.onRunBuildChange('run')}>pick run</button>
      <button type="button" onClick={() => props.onRunBuildChange('')}>clear run or build</button>
    </div>
  ),
}));
// Two cost centers, in the second and the third company.
vi.mock('../../hooks/useCostCenterTree', () => {
  const node = (id: string, company_id: string) => ({
    id, code: id.toUpperCase(), name: id, kind: 'cost_center', parent_id: null, company_id,
    company_name: company_id, owner_user_id: null, owner_name: null, status: 'enabled', disabled_at: null,
    sort_order: 0, depth: 0, path: id, path_ids: [id],
  });
  const nodes = [node('cc-2', 'company-2'), node('cc-3', 'company-3')];
  const tree = { ready: true, nodes, byId: new Map(nodes.map((n) => [n.id, n])), hasAny: true, descendantIds: (id: string) => new Set([id]) };
  return { useCostCenterTree: () => tree };
});
vi.mock('./workspace/CapexMetadataBar', () => ({ default: () => null }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/finance/BudgetTab', () => ({ default: () => null }));
vi.mock('../../components/finance/AllocationsTab', () => ({ default: () => null }));
vi.mock('./editors/RelationsPanel', () => ({ default: () => null }));
vi.mock('../../components/EntityTasksPanel', () => ({ default: () => null }));

import api from '../../api';
import CapexItemPage from './CapexItemPage';
import { DEFAULT_BUDGET_COLUMNS } from '../../services/budgetColumns';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn>;
};

const ITEM_ID = '11111111-2222-3333-4444-555555555555';

function renderAt(path = '/ops/capex/new/overview') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/ops/capex/:id/:tab" element={<CapexItemPage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('CapexItemPage create', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.get.mockResolvedValue({ data: {} });
    mocked.post.mockResolvedValue({ data: { id: 'new-id' } });
  });

  it('sends the value picked for each dimension, and never the old single field', async () => {
    renderAt();
    expect(document.querySelector('[data-mode="create"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick category' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick nature value' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][0]).toBe('/capex-items');
    expect(mocked.post.mock.calls[0][1]).toMatchObject({
      description: 'New servers',
      paying_company_id: 'company-1',
      account_id: 'account-1',
      analytics_values: { 'axis-default': 'category-1', 'axis-nature': 'category-2' },
    });
    expect(mocked.post.mock.calls[0][1]).not.toHaveProperty('analytics_category_id');
    // The page moves on to the new line's workspace.
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/capex-items/new-id'));
  });

  it('sends no analytics value when none is picked', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick category' }));
    fireEvent.click(screen.getByRole('button', { name: 'clear category' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    // Supplier is optional: none picked, none sent.
    expect(mocked.post.mock.calls[0][1]).toMatchObject({ analytics_values: {}, supplier_id: null });
    // The page moves on to the new line's workspace.
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/capex-items/new-id'));
  });

  it('fills an empty paying company from the picked cost center and sends both new fields', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
    expect(document.querySelector('[data-mode="create"]')).toHaveAttribute('data-company', 'company-2');
    fireEvent.click(screen.getByRole('button', { name: 'pick run' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][1]).toMatchObject({
      paying_company_id: 'company-2',
      cost_center_id: 'cc-2',
      run_build: 'run',
    });
  });

  it('keeps a paying company picked first', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
    expect(document.querySelector('[data-mode="create"]')).toHaveAttribute('data-company', 'company-1');
  });

  it('lets a company filled from the cost center follow the next cost center, until an account is picked', async () => {
    renderAt();
    const drawer = () => document.querySelector('[data-mode="create"]');
    fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
    expect(drawer()).toHaveAttribute('data-company', 'company-2');
    fireEvent.click(screen.getByRole('button', { name: 'pick third cost center' }));
    expect(drawer()).toHaveAttribute('data-company', 'company-3');
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
    expect(drawer()).toHaveAttribute('data-company', 'company-3');
  });

  it('stops following the cost center once the user picks a company', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick third cost center' }));
    expect(document.querySelector('[data-mode="create"]')).toHaveAttribute('data-company', 'company-1');
  });

  it('refuses to create a line without an account', async () => {
    renderAt();
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('capex.editor.accountRequired')).toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();
  });
});

// Charts of accounts: the account and the first company on one, the second company on another.
const charts = vi.hoisted(() => ({ company2: 'coa-b' }));

describe('CapexItemPage edit', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    charts.company2 = 'coa-b';
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/capex-items/${ITEM_ID}`) {
        return {
          data: {
            id: ITEM_ID, item_number: 7, description: 'New servers', paying_company_id: 'company-1', account_id: 'account-1',
            currency: 'EUR', effective_start: '2026-01-01', cost_center_id: 'cc-2', run_build: 'build',
          },
        };
      }
      if (url === '/companies/company-2') return { data: { id: 'company-2', coa_id: charts.company2 } };
      if (url === '/accounts/account-1') return { data: { id: 'account-1', coa_id: 'coa-a' } };
      return { data: {} };
    });
    mocked.patch.mockResolvedValue({ data: {} });
  });

  /** Clicks once the line is on screen, then waits for the write (the charts load first). */
  async function clickOnceLoaded(name: string) {
    await waitFor(() => expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-account', 'account-1'));
    fireEvent.click(screen.getByRole('button', { name }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalled());
  }

  it('clears the account in the same write when the new company uses another chart', async () => {
    renderAt(`/ops/capex/${ITEM_ID}/overview`);
    await clickOnceLoaded('pick other company');
    expect(mocked.patch).toHaveBeenCalledTimes(1);
    expect(mocked.patch).toHaveBeenCalledWith(`/capex-items/${ITEM_ID}`, { paying_company_id: 'company-2', account_id: null });
    // The Account row now asks for an account on the new chart.
    expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-account', '');
  });

  it('keeps the account when the new company uses the same chart', async () => {
    charts.company2 = 'coa-a';
    renderAt(`/ops/capex/${ITEM_ID}/overview`);
    await clickOnceLoaded('pick other company');
    expect(mocked.patch).toHaveBeenCalledTimes(1);
    expect(mocked.patch).toHaveBeenCalledWith(`/capex-items/${ITEM_ID}`, { paying_company_id: 'company-2' });
  });

  it('patches the cost center and run or build, as null when cleared', async () => {
    renderAt(`/ops/capex/${ITEM_ID}/overview`);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith(`/capex-items/${ITEM_ID}`));
    // Writes wait for the line to load; retry the click until one goes through.
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'clear cost center' }));
      expect(mocked.patch).toHaveBeenCalled();
    });
    fireEvent.click(screen.getByRole('button', { name: 'clear run or build' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick run' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(3));
    expect(mocked.patch.mock.calls.map((call) => call[1])).toEqual([
      { cost_center_id: null },
      { run_build: null },
      { run_build: 'run' },
    ]);
  });
});

describe('CapexItemPage notes typed during a save', () => {
  // What the server holds; a PATCH applies to it only when the test resolves it.
  const server: Record<string, unknown> = {};
  const saves: Array<() => void> = [];

  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    saves.length = 0;
    Object.assign(server, { notes: 'Renewal', account_id: 'account-1' });
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/capex-items/${ITEM_ID}`) {
        return { data: { id: ITEM_ID, item_number: 7, description: 'New servers', currency: 'EUR', effective_start: '2026-01-01', paying_company_id: 'company-1', ...server } };
      }
      return { data: {} };
    });
    mocked.patch.mockImplementation((_url: string, patch: Record<string, unknown>) => new Promise((resolve) => {
      saves.push(() => {
        Object.assign(server, patch);
        resolve({ data: {} });
      });
    }));
  });

  it('keeps text typed while the save and its refetch run, and saves it next', async () => {
    renderAt(`/ops/capex/${ITEM_ID}/overview`);
    const notes = await screen.findByDisplayValue('Renewal');
    // Writes wait for the line to load; retry the change until it sticks.
    await waitFor(() => {
      fireEvent.change(notes, { target: { value: 'Renewal A' } });
      expect(notes).toHaveValue('Renewal A');
    });
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // The user keeps typing while the first save is in flight.
    fireEvent.change(notes, { target: { value: 'Renewal AB' } });
    // Another field changes on the server too, so the refetch visibly lands on screen.
    server.account_id = 'account-2';
    saves[0]();
    await waitFor(() => expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-account', 'account-2'));
    // The refetch carries the older 'Renewal A'; the newer text stays in the box.
    expect(notes).toHaveValue('Renewal AB');
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(mocked.patch.mock.calls[1][1]).toEqual({ notes: 'Renewal AB' });
    saves[1]();
    await waitFor(() => expect(mocked.get.mock.calls.filter(([u]) => u === `/capex-items/${ITEM_ID}`).length).toBeGreaterThanOrEqual(3));
    expect(notes).toHaveValue('Renewal AB');
  });
});

describe('CapexItemPage analytics dimensions', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/capex-items/${ITEM_ID}`) {
        return {
          data: {
            id: ITEM_ID, item_number: 7, description: 'New servers', paying_company_id: 'company-1', account_id: 'account-1',
            currency: 'EUR', effective_start: '2026-01-01',
            analytics_values: [{
              axis_id: 'axis-default', axis_code: 'default', axis_name: null, is_default: true,
              category_id: 'category-1', category_name: 'Licences',
            }],
            analytics_category_id: 'category-1', analytics_category_name: 'Licences',
          },
        };
      }
      return { data: {} };
    });
    mocked.patch.mockResolvedValue({ data: {} });
  });

  it('patches one dimension at a time, as null when cleared, and keeps the others on screen', async () => {
    renderAt(`/ops/capex/${ITEM_ID}/overview`);
    const drawer = () => document.querySelector('[data-mode="edit"]');
    // The drawer reads the line's values from the detail's list, by dimension.
    await waitFor(() => expect(drawer()).toHaveAttribute('data-analytics', JSON.stringify({ 'axis-default': 'category-1' })));
    fireEvent.click(screen.getByRole('button', { name: 'pick nature value' }));
    expect(JSON.parse(drawer()!.getAttribute('data-analytics')!)).toEqual({ 'axis-default': 'category-1', 'axis-nature': 'category-2' });
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'clear category' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    // Only the changed dimension is sent, never the old single field.
    expect(mocked.patch.mock.calls.map((call) => call[1])).toEqual([
      { analytics_values: { 'axis-nature': 'category-2' } },
      { analytics_values: { 'axis-default': null } },
    ]);
  });
});

describe('CapexItemPage list context and dimensions', () => {
  const NATURE = '11111111-1111-4111-8111-111111111111';
  const OLD = '22222222-2222-4222-8222-222222222222';
  const GONE = '33333333-3333-4333-8333-333333333333';
  const dimension = (id: string, name: string | null, sort_order: number, extra: Record<string, unknown> = {}) => ({
    id, code: id, name, description: null, sort_order, is_default: false, status: 'enabled', disabled_at: null, ...extra,
  });

  beforeEach(() => {
    nav.calls = [];
    window.sessionStorage.clear();
    mocked.get.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/budget-columns') return { data: DEFAULT_BUDGET_COLUMNS };
      if (url === '/analytics-axes') {
        return {
          data: {
            items: [
              dimension('44444444-4444-4444-8444-444444444444', null, 0, { is_default: true }),
              dimension(NATURE, 'Nature', 1),
              dimension(OLD, 'Old', 2, { status: 'disabled', disabled_at: '2020-01-01T00:00:00.000Z' }),
            ],
          },
        };
      }
      if (url === `/capex-items/${ITEM_ID}`) return { data: { id: ITEM_ID, item_number: 7, description: 'Line', currency: 'EUR' } };
      return { data: {} };
    });
  });

  it('walks prev/next like the list: a sort or filter on a dimension it has no column for falls back', async () => {
    const kept = { [`analytics_${NATURE}`]: { filterType: 'set', values: ['Licences'] } };
    const filters = {
      ...kept,
      [`analytics_${OLD}`]: { filterType: 'set', values: ['Hardware'] },
      [`analytics_${GONE}`]: { filterType: 'set', values: [null] },
    };
    window.sessionStorage.setItem('capex-list-context', JSON.stringify({
      sort: `analytics_${OLD}:ASC`, q: '', filters: JSON.stringify(filters), statusScope: 'enabled',
    }));
    renderAt(`/ops/capex/${ITEM_ID}/overview`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    // Never enabled before the dimensions are known.
    for (const call of nav.calls.filter((c) => c.enabled)) {
      expect(call.sort ?? null).toBeNull();
      expect(JSON.parse(call.filters ?? '{}')).toEqual(kept);
    }
    const stored = JSON.parse(window.sessionStorage.getItem('capex-list-context') ?? '{}');
    expect(stored.sort).toBe('');
    expect(JSON.parse(stored.filters)).toEqual(kept);
  });

  it('keeps a sort on an enabled dimension', async () => {
    window.sessionStorage.setItem('capex-list-context', JSON.stringify({
      sort: `analytics_${NATURE}:DESC`, q: '', filters: '', statusScope: 'enabled',
    }));
    renderAt(`/ops/capex/${ITEM_ID}/overview`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    expect(nav.calls.filter((c) => c.enabled).every((c) => c.sort === `analytics_${NATURE}:DESC`)).toBe(true);
  });
});
