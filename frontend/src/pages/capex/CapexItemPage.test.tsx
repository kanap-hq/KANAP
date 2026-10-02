import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
// The page asks before leaving with changes it could not save.
const dialogs = vi.hoisted(() => ({ confirm: vi.fn(async () => true), alert: vi.fn(async () => undefined), prompt: vi.fn(async () => null) }));
vi.mock('../../components/design', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/design')>()),
  useKanapDialogs: () => dialogs,
}));
const nav = vi.hoisted(() => ({ calls: [] as Array<{ sort?: string | null; filters?: string | null; enabled?: boolean }> }));
vi.mock('../../hooks/useCapexNav', () => ({
  useCapexNav: (params: { sort?: string | null; filters?: string | null; enabled?: boolean }) => {
    nav.calls.push(params);
    return { index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null };
  },
}));
vi.mock('../../hooks/useCurrencySettings', () => ({ default: () => ({ data: { defaultCapexCurrency: 'EUR' } }) }));
// The signed-in user: a conflict with their own change from another window is said so.
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me' } }) }));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: vi.fn() }) }));
vi.mock('../../utils/workspaceTabCounts', () => ({ fetchCapexRelationsCount: vi.fn(async () => 0) }));
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: ({ properties, actions, children, onTitleSave, onTabChange, metadata }: {
    properties?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; onTitleSave: (v: string) => void;
    onTabChange?: (tab: string) => void; metadata?: React.ReactNode;
  }) => (
    <div>
      <button type="button" onClick={() => onTitleSave('New servers')}>set title</button>
      <button type="button" onClick={() => onTabChange?.('allocations')}>allocations tab</button>
      {metadata}{actions}{properties}{children}
    </div>
  ),
}));
// The drawer stands in for the pickers: each button sets one create field.
vi.mock('./workspace/CapexPropertiesDrawer', () => ({
  default: (props: {
    mode: string; payingCompanyId: string; accountId: string; onPayingCompanyChange: (v: string) => void;
    onAccountChange: (v: string) => void; onAnalyticsValueChange: (axisId: string, v: string | null) => void;
    onCostCenterChange: (v: string, node: { id: string; company_id: string | null } | null) => void; onRunBuildChange: (v: string) => void;
    analyticsValues: Record<string, string | null>;
  }) => (
    <div
      data-mode={props.mode} data-company={props.payingCompanyId} data-account={props.accountId}
      data-analytics={JSON.stringify(props.analyticsValues)}
    >
      <button type="button" onClick={() => props.onPayingCompanyChange('company-1')}>pick company</button>
      <button type="button" onClick={() => props.onPayingCompanyChange('company-2')}>pick other company</button>
      <button type="button" onClick={() => props.onPayingCompanyChange('')}>clear company</button>
      <button type="button" onClick={() => props.onAccountChange('account-1')}>pick account</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-default', 'category-1')}>pick category</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-default', null)}>clear category</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-nature', 'category-2')}>pick nature value</button>
      <button type="button" onClick={() => props.onCostCenterChange('cc-2', { id: 'cc-2', company_id: 'company-2' })}>pick cost center</button>
      <button type="button" onClick={() => props.onCostCenterChange('cc-3', { id: 'cc-3', company_id: 'company-3' })}>pick third cost center</button>
      <button type="button" onClick={() => props.onCostCenterChange('', null)}>clear cost center</button>
      <button type="button" onClick={() => props.onRunBuildChange('run')}>pick run</button>
      <button type="button" onClick={() => props.onRunBuildChange('')}>clear run or build</button>
    </div>
  ),
}));
vi.mock('./workspace/CapexMetadataBar', () => ({
  default: ({ onStatusChange }: { onStatusChange: (status: string) => void }) => (
    <button type="button" onClick={() => onStatusChange('disabled')}>disable line</button>
  ),
}));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/finance/BudgetTab', () => ({ default: () => null }));
// The Allocations tab stands in with its handle and the line's held choice (lot 3E).
vi.mock('../../components/finance/AllocationsTab', async () => {
  const React = await import('react');
  type Held = { current: { lineId: string } | null };
  const AllocationsTabStandIn = React.forwardRef(({ id, held }: { id: string; held?: Held }, ref) => {
    const waiting = React.useRef(held?.current?.lineId === id);
    const [, redraw] = React.useState(0);
    React.useEffect(() => {
      if (held?.current?.lineId === id) held.current = null;
      return () => {
        if (held && waiting.current) held.current = { lineId: id } as never;
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    React.useImperativeHandle(ref, () => ({
      flush: async (options?: { ignoreHeld?: boolean }) => !!options?.ignoreHeld || !waiting.current,
      isDirty: () => waiting.current,
      hasWaitingChoice: () => waiting.current,
    }));
    return <button type="button" onClick={() => { waiting.current = true; redraw((n) => n + 1); }}>allocation refused</button>;
  });
  return { default: AllocationsTabStandIn };
});
vi.mock('./editors/RelationsPanel', () => ({ default: () => null }));
vi.mock('../../components/EntityTasksPanel', () => ({ default: () => null }));

import api from '../../api';
import CapexItemPage from './CapexItemPage';
import { resetSharedPatchBuffers } from '../../hooks/patchBuffer';
import { confirmLeave } from '../../hooks/leaveGuard';
import { DEFAULT_BUDGET_COLUMNS } from '../../services/budgetColumns';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn>;
};

const ITEM_ID = '11111111-2222-3333-4444-555555555555';

// The edits a page keeps for the session (lot 3C review): each test starts without any.
beforeEach(() => resetSharedPatchBuffers());

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
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/capex-items/new-id', expect.objectContaining({ signal: expect.any(AbortSignal) })));
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
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/capex-items/new-id', expect.objectContaining({ signal: expect.any(AbortSignal) })));
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
    // Each field with the value the screen showed before (its base, lot 3C).
    expect(mocked.patch).toHaveBeenCalledWith(`/capex-items/${ITEM_ID}`, {
      paying_company_id: 'company-2', account_id: null, base: { paying_company_id: 'company-1', account_id: 'account-1' },
    });
    // The Account row now asks for an account on the new chart.
    expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-account', '');
  });

  it('keeps the account when the new company uses the same chart', async () => {
    charts.company2 = 'coa-a';
    renderAt(`/ops/capex/${ITEM_ID}/overview`);
    await clickOnceLoaded('pick other company');
    expect(mocked.patch).toHaveBeenCalledTimes(1);
    expect(mocked.patch).toHaveBeenCalledWith(`/capex-items/${ITEM_ID}`, { paying_company_id: 'company-2', base: { paying_company_id: 'company-1' } });
  });

  it('patches the cost center and run or build, as null when cleared', async () => {
    renderAt(`/ops/capex/${ITEM_ID}/overview`);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith(`/capex-items/${ITEM_ID}`, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    await waitFor(() => expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-account', 'account-1'));
    // One pick at a time (picks made while a save runs go together in the next one).
    const picks = ['clear cost center', 'clear run or build', 'pick run'];
    for (const [index, name] of picks.entries()) {
      fireEvent.click(screen.getByRole('button', { name }));
      await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(index + 1));
    }
    expect(mocked.patch.mock.calls.map((call) => {
      const { base: _base, ...fields } = call[1];
      return fields;
    })).toEqual([
      { cost_center_id: null },
      { run_build: null },
      { run_build: 'run' },
    ]);
    // The first two started from the stored values.
    expect(mocked.patch.mock.calls[0][1].base).toEqual({ cost_center_id: 'cc-2' });
    expect(mocked.patch.mock.calls[1][1].base).toEqual({ run_build: 'build' });
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
    // Started from the text being saved: once that save lands, it is the stored one.
    expect(mocked.patch.mock.calls[1][1]).toEqual({ notes: 'Renewal AB', base: { notes: 'Renewal A' } });
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
      { analytics_values: { 'axis-nature': 'category-2' }, base: { analytics_values: { 'axis-nature': null } } },
      { analytics_values: { 'axis-default': null }, base: { analytics_values: { 'axis-default': 'category-1' } } },
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

/** An API error as axios rejects it. */
function apiError(status: number, code: string) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { code, message: code }, headers: {} } });
}

describe('CapexItemPage autosave across lines', () => {
  const LINE_A = 'aaaaaaaa-0000-4000-8000-00000000000a';
  const LINE_B = 'bbbbbbbb-0000-4000-8000-00000000000b';
  const line = (id: string, n: number, name: string) => ({
    id, item_number: n, description: name, notes: `${name} notes`, currency: 'EUR', effective_start: '2026-01-01',
    paying_company_id: 'company-1', account_id: 'account-1', ppe_type: 'hardware', investment_type: 'replacement', priority: 'medium',
  });
  let busy = true;

  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    busy = true;
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/capex-items/${LINE_A}`) return { data: line(LINE_A, 1, 'Line A') };
      if (url === `/capex-items/${LINE_B}`) return { data: line(LINE_B, 2, 'Line B') };
      return { data: {} };
    });
    mocked.patch.mockImplementation(async () => {
      if (busy) throw apiError(503, 'busy');
      return { data: {} };
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps a busy note of line A for line A: it is neither lost nor sent to line B', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router: { navigate: NavigateFunction | null } = { navigate: null };
    function NavigateProbe() {
      router.navigate = useNavigate();
      return null;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter initialEntries={[`/ops/capex/${LINE_A}/overview`]}>
            <NavigateProbe />
            <Routes><Route path="/ops/capex/:id/:tab" element={<CapexItemPage />} /></Routes>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    const notesA = await screen.findByDisplayValue('Line A notes');
    await waitFor(() => {
      fireEvent.change(notesA, { target: { value: 'A edited' } });
      expect(notesA).toHaveValue('A edited');
    });
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(mocked.patch).toHaveBeenCalledTimes(4);

    busy = false;
    act(() => { router.navigate!(`/ops/capex/${LINE_B}/overview`); });
    const notesB = await screen.findByDisplayValue('Line B notes');
    fireEvent.change(notesB, { target: { value: 'B edited' } });
    await waitFor(() => expect(mocked.patch.mock.calls.some(([url]) => url === `/capex-items/${LINE_B}`)).toBe(true), { timeout: 3000 });
    const sent = mocked.patch.mock.calls.slice(4);
    expect(sent).toContainEqual([`/capex-items/${LINE_A}`, { notes: 'A edited', base: { notes: 'Line A notes' } }]);
    expect(sent).toContainEqual([`/capex-items/${LINE_B}`, { notes: 'B edited', base: { notes: 'Line B notes' } }]);
    expect(sent).toHaveLength(2);
  });
});

describe('CapexItemPage edit conflicts (lot 3C)', () => {
  // What the server holds; Marie moves the line to another cost center after the screen read it.
  const stored: Record<string, unknown> = {};

  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    dialogs.confirm.mockReset();
    for (const key of Object.keys(stored)) delete stored[key];
    Object.assign(stored, {
      id: ITEM_ID, item_number: 7, description: 'New servers', paying_company_id: 'company-1', account_id: 'account-1',
      currency: 'EUR', effective_start: '2026-01-01', cost_center_id: 'cc-2', run_build: 'build', notes: 'Start',
    });
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/companies/company-2') return { data: { id: 'company-2', coa_id: 'coa-b' } };
      if (url === '/accounts/account-1') return { data: { id: 'account-1', coa_id: 'coa-a' } };
      return url === `/capex-items/${ITEM_ID}` ? { data: { ...stored } } : { data: {} };
    });
    mocked.patch.mockImplementation(async (_url: string, body: Record<string, unknown>) => {
      const { base = {}, ...patch } = body as { base?: Record<string, unknown> } & Record<string, unknown>;
      // Checked before it is compared, as resolveItemWrite.
      if ('paying_company_id' in patch && !patch.paying_company_id) {
        throw Object.assign(new Error('HTTP 400'), { response: { status: 400, headers: {}, data: { message: 'Paying company is required.' } } });
      }
      const conflicts = Object.keys(patch)
        .filter((field) => field in base && base[field] !== (stored[field] ?? null) && patch[field] !== (stored[field] ?? null))
        .map((field) => ({
          field, base: base[field], current: stored[field] ?? null, mine: patch[field],
          labels: { base: 'CC-2 · cc-2', current: 'CC-9 · Marie\'s', mine: null },
          changed_by: { id: 'marie', name: 'Marie Dupont' }, changed_at: '2026-10-02T12:02:00.000Z',
        }));
      if (conflicts.length > 0) {
        throw Object.assign(new Error('HTTP 409'), { response: { status: 409, headers: {}, data: { code: 'edit_conflict', conflicts, row_version: 3 } } });
      }
      Object.assign(stored, patch);
      return { data: {} };
    });
  });

  it('a picker saved at once: the conflict shows the names, and the user\'s choice is applied over theirs', async () => {
    renderAt(`/ops/capex/${ITEM_ID}/overview`);
    await waitFor(() => expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-account', 'account-1'));
    stored.cost_center_id = 'cc-9';
    fireEvent.click(screen.getByRole('button', { name: 'clear cost center' }));
    const row = await screen.findByTestId('edit-conflict-cost_center_id');
    expect(mocked.patch.mock.calls[0][1]).toEqual({ cost_center_id: null, base: { cost_center_id: 'cc-2' } });
    expect(row).toHaveTextContent('CC-9 · Marie\'s');
    expect(row).toHaveTextContent('editConflict.empty');

    fireEvent.click(screen.getByRole('button', { name: 'editConflict.applyMine: capex.fields.costCenter' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    expect(mocked.patch.mock.calls[1][1]).toEqual({ cost_center_id: null, base: { cost_center_id: 'cc-9' } });
    await waitFor(() => expect(screen.queryByTestId('edit-conflict-cost_center_id')).toBeNull());
    expect(stored.cost_center_id).toBeNull();
  });

  function LocationProbe() {
    return <div data-testid="location" data-path={useLocation().pathname} />;
  }

  function renderLine() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter initialEntries={[`/ops/capex/${ITEM_ID}/overview`]}>
            <LocationProbe />
            <Routes><Route path="/ops/capex/:id/:tab" element={<CapexItemPage />} /></Routes>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
  }

  /** Marie changed the notes after the screen read them; the user's notes wait for a choice. */
  async function conflictOnNotes() {
    renderLine();
    const notes = await screen.findByDisplayValue('Start');
    stored.notes = 'Notes from Marie';
    await waitFor(() => {
      fireEvent.change(notes, { target: { value: 'My notes' } });
      expect(notes).toHaveValue('My notes');
    });
    await screen.findByTestId('edit-conflict-notes', undefined, { timeout: 3000 });
    return notes;
  }

  it('a choice waiting on the notes survives a refused edit of the line (B1 of the review)', async () => {
    const notes = await conflictOnNotes();
    fireEvent.click(screen.getByRole('button', { name: 'clear company' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    expect(mocked.patch.mock.calls[1][1]).toEqual({ paying_company_id: null, base: { paying_company_id: 'company-1' } });
    expect(await screen.findByText('Paying company is required.')).toBeInTheDocument();
    expect(screen.getByTestId('edit-conflict-notes')).toBeInTheDocument();
    expect(notes).toHaveValue('My notes');
    fireEvent.click(screen.getByRole('button', { name: 'editConflict.applyMine: capex.fields.notes' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(3));
    expect(mocked.patch.mock.calls[2][1]).toEqual({ notes: 'My notes', base: { notes: 'Notes from Marie' } });
    expect(stored.notes).toBe('My notes');
    expect(document.activeElement).toBe(notes);
  });

  it('a tab change keeps the choice without a question', async () => {
    await conflictOnNotes();
    fireEvent.click(screen.getByRole('button', { name: 'allocations tab' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveAttribute('data-path', `/ops/capex/${ITEM_ID}/allocations`));
    expect(dialogs.confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('edit-conflict-notes')).toBeInTheDocument();
  });

  it('only the account changed: keeping their account drops the user\'s company too, nothing is sent', async () => {
    renderLine();
    await waitFor(() => expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-account', 'account-1'));
    stored.account_id = 'account-3';
    fireEvent.click(screen.getByRole('button', { name: 'pick other company' }));
    await screen.findByTestId('edit-conflict-account_id');
    expect(mocked.patch.mock.calls[0][1]).toEqual({
      paying_company_id: 'company-2', account_id: null, base: { paying_company_id: 'company-1', account_id: 'account-1' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'editConflict.keepTheirs: capex.fields.account' }));
    const drawer = document.querySelector('[data-mode="edit"]');
    expect(drawer).toHaveAttribute('data-account', 'account-3');
    expect(drawer).toHaveAttribute('data-company', 'company-1');
    expect(screen.queryByTestId('edit-conflict-account_id')).toBeNull();
    // Nothing left to send: no save is even scheduled.
    expect(screen.queryByText('common:status.saving')).toBeNull();
    expect(mocked.patch).toHaveBeenCalledTimes(1);
  });

  it('disabling a line with no end of validity sends the status alone', async () => {
    renderLine();
    await screen.findByDisplayValue('Start');
    fireEvent.click(screen.getByRole('button', { name: 'disable line' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    expect(mocked.patch.mock.calls[0][1]).toEqual({ status: 'disabled' });
  });

  it('another field of the line saved by someone else is no conflict', async () => {
    renderAt(`/ops/capex/${ITEM_ID}/overview`);
    await waitFor(() => expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-account', 'account-1'));
    stored.notes = 'Notes from Marie';
    fireEvent.click(screen.getByRole('button', { name: 'clear cost center' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(stored.cost_center_id).toBeNull());
    expect(screen.queryByTestId('edit-conflict-cost_center_id')).toBeNull();
    expect(stored.notes).toBe('Notes from Marie');
  });

  it('an allocation waiting for a choice: leaving the line names it in the warning', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter initialEntries={[`/ops/capex/${ITEM_ID}/allocations`]}>
            <Routes><Route path="/ops/capex/:id/:tab" element={<CapexItemPage />} /></Routes>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'allocation refused' }));
    dialogs.confirm.mockResolvedValueOnce(false);
    let left = true;
    await act(async () => { left = await confirmLeave(); });
    expect(left).toBe(false);
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'common:autosave.leaveTitle', message: 'common:autosave.leaveAllocationMessage',
    }));
  });
});
