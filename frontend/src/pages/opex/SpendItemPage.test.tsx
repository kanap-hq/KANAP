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
vi.mock('../../hooks/useSpendNav', () => ({
  useSpendNav: (params: { sort?: string | null; filters?: string | null; enabled?: boolean }) => {
    nav.calls.push(params);
    return { index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null };
  },
}));
vi.mock('../../hooks/useCurrencySettings', () => ({ default: () => ({ data: { defaultSpendCurrency: 'EUR' } }) }));
// The signed-in user: a conflict with their own change from another window is said so.
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ profile: { id: 'me' } }) }));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: vi.fn() }) }));
vi.mock('../../utils/workspaceTabCounts', () => ({ fetchSpendRelationsCount: vi.fn(async () => 0) }));
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: ({ properties, actions, children, onTitleSave, onBack, onTabChange, metadata }: {
    properties?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; onTitleSave: (v: string) => void;
    onBack?: () => void; onTabChange?: (tab: string) => void; metadata?: React.ReactNode;
  }) => (
    <div>
      <button type="button" onClick={() => onTitleSave('Monitoring')}>set title</button>
      <button type="button" onClick={() => onBack?.()}>back to list</button>
      <button type="button" onClick={() => onBack?.()}>close workspace</button>
      <button type="button" onClick={() => onTabChange?.('budget')}>budget tab</button>
      <button type="button" onClick={() => onTabChange?.('overview')}>overview tab</button>
      {metadata}{actions}{properties}{children}
    </div>
  ),
}));
// The drawer stands in for the pickers: each button sets one field.
vi.mock('./workspace/SpendPropertiesDrawer', () => ({
  default: (props: {
    mode: string; payingCompanyId: string; accountId: string; onPayingCompanyChange: (v: string) => void;
    onAccountChange: (v: string) => void; onSupplierChange: (v: string) => void; onCostCenterChange: (v: string) => void;
    onRunBuildChange: (v: string) => void; analyticsValues: Record<string, string | null>;
    onAnalyticsValueChange: (axisId: string, v: string | null) => void; onDisabledAtChange?: (v: string | null) => void;
    references?: unknown; analyticsOptions?: unknown;
  }) => (
    <div
      data-mode={props.mode} data-company={props.payingCompanyId} data-account={props.accountId}
      data-analytics={JSON.stringify(props.analyticsValues)}
      data-references={JSON.stringify(props.references ?? null)}
      data-analytics-options={JSON.stringify(props.analyticsOptions ?? null)}
    >
      <button type="button" onClick={() => props.onPayingCompanyChange('company-1')}>pick company</button>
      <button type="button" onClick={() => props.onPayingCompanyChange('company-2')}>pick other company</button>
      <button type="button" onClick={() => props.onPayingCompanyChange('')}>clear company</button>
      <button type="button" onClick={() => props.onAccountChange('account-1')}>pick account</button>
      <button type="button" onClick={() => props.onAccountChange('account-other')}>pick account of another chart</button>
      <button type="button" onClick={() => props.onSupplierChange('')}>clear supplier</button>
      <button type="button" onClick={() => props.onSupplierChange('supplier-gone')}>pick deleted supplier</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-default', 'value-disabled')}>pick disabled value</button>
      <button type="button" onClick={() => props.onDisabledAtChange?.('2026-12-31T10:00:00.000Z')}>end on 31 December</button>
      <button type="button" onClick={() => props.onCostCenterChange('cc-2')}>pick cost center</button>
      <button type="button" onClick={() => props.onCostCenterChange('cc-3')}>pick third cost center</button>
      <button type="button" onClick={() => props.onCostCenterChange('')}>clear cost center</button>
      <button type="button" onClick={() => props.onRunBuildChange('build')}>pick build</button>
      <button type="button" onClick={() => props.onRunBuildChange('')}>clear run or build</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-default', 'value-1')}>pick default value</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-default', null)}>clear default value</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-nature', 'value-2')}>pick nature value</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-nature', null)}>clear nature value</button>
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
vi.mock('./workspace/SpendMetadataBar', () => ({
  default: ({ onStatusChange }: { onStatusChange: (status: string) => void }) => (
    <button type="button" onClick={() => onStatusChange('disabled')}>disable line</button>
  ),
}));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
// The Budget tab stands in with its handle and the line's held choices (lot 3D): « budget refused »
// leaves the Budget column waiting for a choice.
vi.mock('../../components/finance/BudgetTab', async () => {
  const React = await import('react');
  type Held = { current: { lineId: string; labels: string[] } | null };
  const BudgetTabStandIn = React.forwardRef(({ id, held }: { id: string; held?: Held }, ref) => {
    const waiting = React.useRef<string[]>(held?.current?.lineId === id ? held.current.labels : []);
    const [, redraw] = React.useState(0);
    React.useEffect(() => {
      if (held?.current?.lineId === id) held.current = null;
      return () => {
        if (held && waiting.current.length > 0) held.current = { lineId: id, labels: waiting.current } as never;
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    React.useImperativeHandle(ref, () => ({
      flush: async (options?: { ignoreHeld?: boolean }) => !!options?.ignoreHeld || waiting.current.length === 0,
      isDirty: () => waiting.current.length > 0,
      waitingColumns: () => waiting.current,
    }));
    return (
      <div>
        <span data-testid="budget-waiting">{waiting.current.join(',')}</span>
        <button type="button" onClick={() => { waiting.current = ['Budget']; redraw((n) => n + 1); }}>budget refused</button>
      </div>
    );
  });
  return { default: BudgetTabStandIn };
});
vi.mock('../../components/finance/AllocationsTab', () => ({ default: () => null }));
vi.mock('./editors/RelationsPanel', () => ({ default: () => null }));
vi.mock('../../components/EntityTasksPanel', () => ({ default: () => null }));

import api from '../../api';
import SpendItemPage from './SpendItemPage';
import { resetSharedPatchBuffers } from '../../hooks/patchBuffer';
import { confirmLeave } from '../../hooks/leaveGuard';
import { fetchSpendRelationsCount } from '../../utils/workspaceTabCounts';
import { DEFAULT_BUDGET_COLUMNS } from '../../services/budgetColumns';
import { resetListContextCache } from '../../lib/listContext';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn>;
};

const ITEM_ID = '11111111-2222-3333-4444-555555555555';

// The edits a page keeps for the session (lot 3C review): each test starts without any.
beforeEach(() => resetSharedPatchBuffers());

/**
 * The PATCH bodies without their `base` (lot 3C), checking that each base
 * names exactly the fields of its body (the status follows the end of
 * validity and has none).
 */
function patchedFields(): Array<Record<string, unknown>> {
  return mocked.patch.mock.calls.map(([, body]) => {
    const { base, ...fields } = body as Record<string, unknown>;
    expect(Object.keys(base as object).sort()).toEqual(Object.keys(fields).filter((key) => key !== 'status').sort());
    return fields;
  });
}

/** Stands for the list page: shows the URL the workspace went back to. */
function ListPageProbe() {
  const { search } = useLocation();
  return <div data-testid="list-page" data-search={search} />;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/ops/opex/:id/:tab" element={<SpendItemPage />} />
            <Route path="/ops/opex" element={<ListPageProbe />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('SpendItemPage create', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    mocked.get.mockResolvedValue({ data: {} });
    mocked.post.mockResolvedValue({ data: { id: 'new-id' } });
  });

  it('creates a line without a supplier and sends none', async () => {
    renderAt('/ops/opex/new/overview');
    expect(document.querySelector('[data-mode="create"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][0]).toBe('/spend-items');
    expect(mocked.post.mock.calls[0][1]).toMatchObject({
      product_name: 'Monitoring',
      supplier_id: null,
      paying_company_id: 'company-1',
      account_id: 'account-1',
    });
  });

  it('fills an empty paying company from the picked cost center and sends both new fields', async () => {
    renderAt('/ops/opex/new/overview');
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
    expect(document.querySelector('[data-mode="create"]')).toHaveAttribute('data-company', 'company-2');
    fireEvent.click(screen.getByRole('button', { name: 'pick build' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][1]).toMatchObject({
      paying_company_id: 'company-2',
      cost_center_id: 'cc-2',
      run_build: 'build',
    });
  });

  it('keeps a paying company picked first, and sends no cost center or run or build when none is picked', async () => {
    renderAt('/ops/opex/new/overview');
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
    expect(document.querySelector('[data-mode="create"]')).toHaveAttribute('data-company', 'company-1');
    fireEvent.click(screen.getByRole('button', { name: 'clear cost center' }));
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][1]).toMatchObject({ paying_company_id: 'company-1', cost_center_id: null, run_build: null });
  });

  it('lets a company filled from the cost center follow the next cost center, until an account is picked', async () => {
    renderAt('/ops/opex/new/overview');
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
    renderAt('/ops/opex/new/overview');
    const drawer = () => document.querySelector('[data-mode="create"]');
    fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick third cost center' }));
    expect(drawer()).toHaveAttribute('data-company', 'company-1');
  });

  it('sends the value of each dimension given one, and never the old single field', async () => {
    renderAt('/ops/opex/new/overview');
    const drawer = () => document.querySelector('[data-mode="create"]');
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick default value' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick nature value' }));
    // A value on one dimension keeps the other.
    expect(JSON.parse(drawer()!.getAttribute('data-analytics')!)).toEqual({ 'axis-default': 'value-1', 'axis-nature': 'value-2' });
    fireEvent.click(screen.getByRole('button', { name: 'clear nature value' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    const payload = mocked.post.mock.calls[0][1];
    expect(payload.analytics_values).toEqual({ 'axis-default': 'value-1' });
    expect(payload).not.toHaveProperty('analytics_category_id');
  });

  it('sends an empty map when no dimension has a value', async () => {
    renderAt('/ops/opex/new/overview');
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][1].analytics_values).toEqual({});
  });

  it('refuses to create a line without an account', async () => {
    renderAt('/ops/opex/new/overview');
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('opex.editor.accountRequired')).toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();
  });
});

// Charts of accounts: the account and the first company on one, the second company on another.
const charts = vi.hoisted(() => ({ company2: 'coa-b' }));

describe('SpendItemPage edit', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    charts.company2 = 'coa-b';
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/spend-items/${ITEM_ID}`) {
        return {
          data: {
            id: ITEM_ID, item_number: 7, product_name: 'Monitoring', supplier_id: 'supplier-1', notes: 'Renewal',
            paying_company_id: 'company-1', account_id: 'account-1', currency: 'EUR', effective_start: '2026-01-01',
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
    renderAt(`/ops/opex/${ITEM_ID}/overview`);
    await clickOnceLoaded('pick other company');
    expect(mocked.patch).toHaveBeenCalledTimes(1);
    // Each field with the value the screen showed before (its base, lot 3C).
    expect(mocked.patch).toHaveBeenCalledWith(`/spend-items/${ITEM_ID}`, {
      paying_company_id: 'company-2', account_id: null, base: { paying_company_id: 'company-1', account_id: 'account-1' },
    });
    // The Account row now asks for an account on the new chart.
    expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-account', '');
  });

  it('keeps the account when the new company uses the same chart', async () => {
    charts.company2 = 'coa-a';
    renderAt(`/ops/opex/${ITEM_ID}/overview`);
    await clickOnceLoaded('pick other company');
    expect(mocked.patch).toHaveBeenCalledTimes(1);
    expect(mocked.patch).toHaveBeenCalledWith(`/spend-items/${ITEM_ID}`, { paying_company_id: 'company-2', base: { paying_company_id: 'company-1' } });
  });

  it('saves cleared notes as null after the typing pause', async () => {
    renderAt(`/ops/opex/${ITEM_ID}/overview`);
    const notes = await screen.findByDisplayValue('Renewal');
    // The debounced write goes through flushPending, which normalises like the immediate one.
    await waitFor(() => {
      fireEvent.change(notes, { target: { value: '' } });
      expect(notes).toHaveValue('');
    });
    await waitFor(() => expect(mocked.patch).toHaveBeenCalled(), { timeout: 3000 });
    expect(mocked.patch).toHaveBeenCalledWith(`/spend-items/${ITEM_ID}`, { notes: null, base: { notes: 'Renewal' } });
  });

  it('clears the supplier as null, not as an empty string', async () => {
    renderAt(`/ops/opex/${ITEM_ID}/overview`);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith(`/spend-items/${ITEM_ID}`, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    // Writes wait for the line to load; retry the click until one goes through.
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'clear supplier' }));
      expect(mocked.patch).toHaveBeenCalled();
    });
    expect(mocked.patch.mock.calls[0][1]).toEqual({ supplier_id: null, base: { supplier_id: 'supplier-1' } });
  });

  it('patches the cost center and run or build, as null when cleared', async () => {
    renderAt(`/ops/opex/${ITEM_ID}/overview`);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith(`/spend-items/${ITEM_ID}`, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    await waitFor(() => expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-account', 'account-1'));
    // One pick at a time (picks made while a save runs go together in the next one).
    const picks = ['pick cost center', 'clear cost center', 'pick build', 'clear run or build'];
    for (const [index, name] of picks.entries()) {
      fireEvent.click(screen.getByRole('button', { name }));
      await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(index + 1));
    }
    expect(patchedFields()).toEqual([
      { cost_center_id: 'cc-2' },
      { cost_center_id: null },
      { run_build: 'build' },
      { run_build: null },
    ]);
  });
});

describe('SpendItemPage picker labels from the detail', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/spend-items/${ITEM_ID}`) {
        return {
          data: {
            id: ITEM_ID, item_number: 7, product_name: 'Monitoring', supplier_id: 'supplier-1', currency: 'EUR',
            paying_company_id: 'company-1', account_id: 'account-1', effective_start: '2026-01-01',
            analytics_values: [{ axis_id: 'axis-default', axis_code: 'default', axis_name: null, is_default: true, category_id: 'value-1', category_name: 'Licences' }],
            references: {
              supplier: { id: 'supplier-1', name: 'Société Test', erp_supplier_id: null, status: 'enabled' },
              paying_company: { id: 'company-1', name: 'Company One' },
              account: { id: 'account-1', account_number: 6110, account_name: 'Software', description: null, coa_id: 'coa-a' },
              owner_it: null,
              owner_business: null,
            },
          },
        };
      }
      return { data: {} };
    });
  });

  it("hands the detail's labels to the pickers, which then read no list", async () => {
    renderAt(`/ops/opex/${ITEM_ID}/overview`);
    await waitFor(() => expect(document.querySelector('[data-mode="edit"]')?.getAttribute('data-references')).toContain('Société Test'));
    const drawer = document.querySelector('[data-mode="edit"]')!;
    expect(JSON.parse(drawer.getAttribute('data-references')!).account.account_number).toBe(6110);
    expect(JSON.parse(drawer.getAttribute('data-analytics-options')!)).toEqual({ 'axis-default': { id: 'value-1', name: 'Licences' } });
    const urls = mocked.get.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => /^\/(suppliers|companies|accounts|users)\b/.test(url))).toEqual([]);
  });
});

describe('SpendItemPage first wave', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    vi.mocked(fetchSpendRelationsCount).mockClear();
  });

  it("asks for the Relations badge with the route's reference, with the detail, not after it", async () => {
    let answerDetail: () => void = () => undefined;
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/spend-items/OPX-7') {
        await new Promise<void>((resolve) => { answerDetail = resolve; });
        return { data: { id: ITEM_ID, item_number: 7, product_name: 'Monitoring', currency: 'EUR', effective_start: '2026-01-01' } };
      }
      return { data: {} };
    });
    renderAt('/ops/opex/OPX-7/overview');
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/spend-items/OPX-7', expect.objectContaining({ signal: expect.any(AbortSignal) })));
    // The detail is not answered yet: the badge's request is already out.
    await waitFor(() => expect(fetchSpendRelationsCount).toHaveBeenCalledWith('OPX-7', expect.any(AbortSignal)));
    await act(async () => { answerDetail(); });
  });
});

describe('SpendItemPage notes typed during a save', () => {
  // What the server holds; a PATCH applies to it only when the test resolves it.
  const server: Record<string, unknown> = {};
  const saves: Array<() => void> = [];

  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    saves.length = 0;
    Object.assign(server, { notes: 'Renewal', account_id: 'account-1' });
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/spend-items/${ITEM_ID}`) {
        return { data: { id: ITEM_ID, item_number: 7, product_name: 'Monitoring', currency: 'EUR', effective_start: '2026-01-01', paying_company_id: 'company-1', ...server } };
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
    renderAt(`/ops/opex/${ITEM_ID}/overview`);
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
    await waitFor(() => expect(mocked.get.mock.calls.filter(([u]) => u === `/spend-items/${ITEM_ID}`).length).toBeGreaterThanOrEqual(3));
    expect(notes).toHaveValue('Renewal AB');
  });
});

describe('SpendItemPage analytics dimensions', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/spend-items/${ITEM_ID}`) {
        return {
          data: {
            id: ITEM_ID, item_number: 7, product_name: 'Monitoring', currency: 'EUR', effective_start: '2026-01-01',
            paying_company_id: 'company-1', account_id: 'account-1',
            analytics_values: [{
              axis_id: 'axis-default', axis_code: 'default', axis_name: null, is_default: true,
              category_id: 'value-1', category_name: 'Licences',
            }],
            analytics_category_id: 'value-1', analytics_category_name: 'Licences',
          },
        };
      }
      return { data: {} };
    });
    mocked.patch.mockResolvedValue({ data: {} });
  });

  it('patches one dimension at a time, as null when cleared, and keeps the others on screen', async () => {
    renderAt(`/ops/opex/${ITEM_ID}/overview`);
    const drawer = () => document.querySelector('[data-mode="edit"]');
    // The drawer reads the line's values from the detail's list, by dimension.
    await waitFor(() => expect(drawer()).toHaveAttribute('data-analytics', JSON.stringify({ 'axis-default': 'value-1' })));
    fireEvent.click(screen.getByRole('button', { name: 'pick nature value' }));
    expect(JSON.parse(drawer()!.getAttribute('data-analytics')!)).toEqual({ 'axis-default': 'value-1', 'axis-nature': 'value-2' });
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'clear default value' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    // Only the changed dimension is sent, never the old single field.
    expect(mocked.patch.mock.calls.map((call) => call[1])).toEqual([
      { analytics_values: { 'axis-nature': 'value-2' }, base: { analytics_values: { 'axis-nature': null } } },
      { analytics_values: { 'axis-default': null }, base: { analytics_values: { 'axis-default': 'value-1' } } },
    ]);
  });
});

describe('SpendItemPage list context', () => {
  beforeEach(() => {
    nav.calls = [];
    window.sessionStorage.clear();
    mocked.get.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/budget-columns') return { data: DEFAULT_BUDGET_COLUMNS };
      if (url === `/spend-items/${ITEM_ID}`) return { data: { id: ITEM_ID, item_number: 7, product_name: 'Monitoring', currency: 'EUR' } };
      return { data: {} };
    });
  });

  it('sends prev/next no sort for the default one, and keeps a sort the user picked', async () => {
    window.sessionStorage.setItem('opex-list-context', JSON.stringify({ sort: 'yBudget:DESC', q: '', filters: '', statusScope: 'enabled' }));
    const first = renderAt(`/ops/opex/${ITEM_ID}/overview`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    expect(nav.calls.filter((c) => c.enabled).every((c) => (c.sort ?? null) === null)).toBe(true);
    first.unmount();

    nav.calls = [];
    window.sessionStorage.setItem('opex-list-context', JSON.stringify({ sort: 'yRevision:ASC', q: '', filters: '', statusScope: 'enabled' }));
    renderAt(`/ops/opex/${ITEM_ID}/overview`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    expect(nav.calls.filter((c) => c.enabled).every((c) => c.sort === 'yRevision:ASC')).toBe(true);
  });

  it('walks prev/next like the list: a sort or filter on a hidden column falls back', async () => {
    const filters = JSON.stringify({ yForecast: { filterType: 'number', type: 'greaterThan', filter: 1 }, yBudget: { filterType: 'number', type: 'greaterThan', filter: 2 } });
    renderAt(`/ops/opex/${ITEM_ID}/overview?sort=yForecast:ASC&filters=${encodeURIComponent(filters)}`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    const ready = nav.calls.filter((c) => c.enabled);
    for (const call of ready) {
      // No sort: prev/next uses the current default sort.
      expect(call.sort ?? null).toBeNull();
      expect(JSON.parse(call.filters ?? '{}')).toEqual({ yBudget: { filterType: 'number', type: 'greaterThan', filter: 2 } });
    }
    // The stored list context gets the same, once the setting is known.
    const stored = JSON.parse(window.sessionStorage.getItem('opex-list-context') ?? '{}');
    expect(stored.sort).toBe('');
    expect(stored.filters).not.toContain('yForecast');
  });
});

describe('SpendItemPage list context too long for a URL (ctx)', () => {
  const CTX = 'Opx_allButOne_0123456';
  const BIG = { supplier_name: { filterType: 'set', values: Array.from({ length: 1152 }, (_, i) => `Fournisseur ${i} Société Générale`) } };

  beforeEach(() => {
    nav.calls = [];
    window.sessionStorage.clear();
    resetListContextCache();
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/budget-columns') return { data: DEFAULT_BUDGET_COLUMNS };
      if (url === `/list-contexts/${CTX}`) return { data: { id: CTX, list: 'spend-items', state: { filters: BIG } } };
      if (url === `/spend-items/${ITEM_ID}`) return { data: { id: ITEM_ID, item_number: 7, product_name: 'Monitoring', currency: 'EUR' } };
      return { data: {} };
    });
  });

  it('a link opened in a new tab: reads the saved filters, walks prev/next with them, goes back to the list with ctx', async () => {
    renderAt(`/ops/opex/${ITEM_ID}/overview?sort=product_name:ASC&ctx=${CTX}`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    // Not enabled before the saved filters are read: prev/next never walks the unfiltered list.
    for (const call of nav.calls.filter((c) => c.enabled)) expect(JSON.parse(call.filters ?? '{}')).toEqual(BIG);
    expect(mocked.get.mock.calls.filter(([url]) => url === `/list-contexts/${CTX}`)).toHaveLength(1);
    expect(mocked.post).not.toHaveBeenCalled();
    // The stored list context keeps the id, not 31 KB.
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem('opex-list-context') ?? '{}')).toMatchObject({ filters: '', ctx: CTX }));
    fireEvent.click(screen.getByRole('button', { name: 'back to list' }));
    const list = await screen.findByTestId('list-page');
    const search = new URLSearchParams(list.getAttribute('data-search') ?? '');
    expect(search.get('ctx')).toBe(CTX);
    expect(search.get('filters')).toBeNull();
    expect(search.get('sort')).toBe('product_name:ASC');
  });
});

describe('SpendItemPage list context and dimensions', () => {
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
      if (url === `/spend-items/${ITEM_ID}`) return { data: { id: ITEM_ID, item_number: 7, product_name: 'Line', currency: 'EUR' } };
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
    window.sessionStorage.setItem('opex-list-context', JSON.stringify({
      sort: `analytics_${OLD}:ASC`, q: '', filters: JSON.stringify(filters), statusScope: 'enabled',
    }));
    renderAt(`/ops/opex/${ITEM_ID}/overview`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    // Never enabled before the dimensions are known.
    for (const call of nav.calls.filter((c) => c.enabled)) {
      expect(call.sort ?? null).toBeNull();
      expect(JSON.parse(call.filters ?? '{}')).toEqual(kept);
    }
    const stored = JSON.parse(window.sessionStorage.getItem('opex-list-context') ?? '{}');
    expect(stored.sort).toBe('');
    expect(JSON.parse(stored.filters)).toEqual(kept);
  });

  it('keeps a sort on an enabled dimension', async () => {
    window.sessionStorage.setItem('opex-list-context', JSON.stringify({
      sort: `analytics_${NATURE}:DESC`, q: '', filters: '', statusScope: 'enabled',
    }));
    renderAt(`/ops/opex/${ITEM_ID}/overview`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    expect(nav.calls.filter((c) => c.enabled).every((c) => c.sort === `analytics_${NATURE}:DESC`)).toBe(true);
  });
});

/** An API error as axios rejects it. */
function apiError(status: number, code: string) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { code, message: code }, headers: {} } });
}

describe('SpendItemPage autosave across lines, refusals and a busy server', () => {
  const LINE_A = 'aaaaaaaa-0000-4000-8000-000000000001';
  const LINE_B = 'bbbbbbbb-0000-4000-8000-000000000002';
  const line = (id: string, n: number, name: string) => ({
    id, item_number: n, product_name: name, description: `${name} stored`, notes: `${name} notes`,
    currency: 'EUR', effective_start: '2026-01-01', paying_company_id: 'company-1', account_id: 'account-1',
  });

  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    dialogs.confirm.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/spend-items/${LINE_A}`) return { data: line(LINE_A, 1, 'Line A') };
      if (url === `/spend-items/${LINE_B}`) return { data: line(LINE_B, 2, 'Line B') };
      return { data: {} };
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The page, and a navigate function for the test: the route changes, the page instance stays. */
  function renderLines(path: string) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router: { navigate: NavigateFunction | null } = { navigate: null };
    function NavigateProbe() {
      router.navigate = useNavigate();
      return null;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter initialEntries={[path]}>
            <NavigateProbe />
            <Routes>
              <Route path="/ops/opex/:id/:tab" element={<SpendItemPage />} />
              <Route path="/ops/opex" element={<div>opex list</div>} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    return { navigate: (to: string) => router.navigate!(to) };
  }

  async function typeInto(currentValue: string, value: string) {
    const field = await screen.findByDisplayValue(currentValue);
    // Writes wait for the line to load; retry the change until it sticks.
    await waitFor(() => {
      fireEvent.change(field, { target: { value } });
      expect(field).toHaveValue(value);
    });
    return field;
  }

  it('never sends a description refused on line A to line B, and shows A\'s stored text again', async () => {
    mocked.patch.mockImplementation(async (url: string, patch: Record<string, unknown>) => {
      if (url === `/spend-items/${LINE_A}` && 'description' in patch) throw apiError(409, 'duplicate');
      return { data: {} };
    });
    const router = renderLines(`/ops/opex/${LINE_A}/overview`);
    await typeInto('Line A stored', 'X');
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // Refused for good: the message shows and the stored text is back.
    expect(await screen.findByText('errors:duplicate')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Line A stored')).toBeInTheDocument();

    act(() => { router.navigate(`/ops/opex/${LINE_B}/overview`); });
    await typeInto('Line B notes', 'Line B notes, edited');
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(mocked.patch.mock.calls).toEqual([
      [`/spend-items/${LINE_A}`, { description: 'X', base: { description: 'Line A stored' } }],
      [`/spend-items/${LINE_B}`, { notes: 'Line B notes, edited', base: { notes: 'Line B notes' } }],
    ]);
  });

  it('sends a busy edit of line A to line A, never to line B, once the server answers', async () => {
    let busy = true;
    mocked.patch.mockImplementation(async () => {
      if (busy) throw apiError(503, 'busy');
      return { data: {} };
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const router = renderLines(`/ops/opex/${LINE_A}/overview`);
    await typeInto('Line A notes', 'A edited');
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // Three retries by itself, then kept and shown as not saved yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(mocked.patch).toHaveBeenCalledTimes(4);
    expect(await screen.findByText('errors:notSavedYet')).toBeInTheDocument();

    // The user goes to line B another way (no flush): the edit for A stays bound to A.
    busy = false;
    act(() => { router.navigate(`/ops/opex/${LINE_B}/overview`); });
    await typeInto('Line B notes', 'B edited');
    await waitFor(() => expect(mocked.patch.mock.calls.filter(([url]) => url === `/spend-items/${LINE_B}`)).toHaveLength(1), { timeout: 3000 });
    const sent = mocked.patch.mock.calls.slice(4);
    expect(sent).toContainEqual([`/spend-items/${LINE_A}`, { notes: 'A edited', base: { notes: 'Line A notes' } }]);
    expect(sent).toContainEqual([`/spend-items/${LINE_B}`, { notes: 'B edited', base: { notes: 'Line B notes' } }]);
    expect(sent).toHaveLength(2);
  });

  it('asks before leaving while the server keeps the edit busy, then drops it for good', async () => {
    mocked.patch.mockRejectedValue(apiError(503, 'busy'));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderLines(`/ops/opex/${LINE_A}/overview`);
    await typeInto('Line A notes', 'never saved');
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(mocked.patch).toHaveBeenCalledTimes(4);

    // "Stay": one more attempt, no retry storm, the edit is still on screen.
    dialogs.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'close workspace' }));
    await waitFor(() => expect(dialogs.confirm).toHaveBeenCalledTimes(1));
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'common:autosave.leaveTitle', intent: 'danger' }));
    expect(mocked.patch).toHaveBeenCalledTimes(5);
    expect(screen.queryByText('opex list')).toBeNull();
    expect(screen.getByDisplayValue('never saved')).toBeInTheDocument();

    // "Leave without saving": the page goes, and the dropped edit is never sent again.
    dialogs.confirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'close workspace' }));
    expect(await screen.findByText('opex list')).toBeInTheDocument();
    expect(mocked.patch).toHaveBeenCalledTimes(6);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(mocked.patch).toHaveBeenCalledTimes(6);
  });
});

describe('SpendItemPage edit conflicts (lot 3C)', () => {
  const LINE_A = 'aaaaaaaa-0000-4000-8000-0000000000a1';
  const LINE_B = 'bbbbbbbb-0000-4000-8000-0000000000b2';
  // What the server holds, per line. A PATCH is checked first (400, as resolveItemWrite), then
  // compared: a field whose base is stale for a value someone else wrote answers 409.
  const stored: Record<string, Record<string, unknown>> = {};
  const line = (id: string, n: number, name: string) => ({
    id, item_number: n, product_name: name, notes: `${name} notes`, supplier_id: 'supplier-1',
    currency: 'EUR', effective_start: '2026-01-01', paying_company_id: 'company-1', account_id: 'account-1',
    cost_center_id: null as string | null,
  });
  const idOf = (url: string) => url.split('/').pop() as string;
  // Who wrote the stored value, for the 409.
  let author = { id: 'marie', name: 'Marie Dupont' };
  // Refused for good whatever the base, as the server checks a request before comparing it.
  const refusalOf = (patch: Record<string, unknown>): string | null => {
    if ('paying_company_id' in patch && !patch.paying_company_id) return 'Paying company is required.';
    if (patch.supplier_id === 'supplier-gone') return 'Supplier not found.';
    if (patch.cost_center_id === 'cc-2') return 'This cost center is disabled.';
    if ((patch.analytics_values as Record<string, unknown> | undefined)?.['axis-default'] === 'value-disabled') return 'This analytics value is disabled.';
    if (patch.account_id === 'account-other') return 'Selected account does not belong to the paying company\'s Chart of Accounts';
    return null;
  };

  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    dialogs.confirm.mockReset();
    author = { id: 'marie', name: 'Marie Dupont' };
    stored[LINE_A] = line(LINE_A, 1, 'Line A');
    stored[LINE_B] = line(LINE_B, 2, 'Line B');
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/companies/company-2') return { data: { id: 'company-2', coa_id: 'coa-b' } };
      if (url === '/accounts/account-1') return { data: { id: 'account-1', coa_id: 'coa-a' } };
      return stored[idOf(url)] ? { data: { ...stored[idOf(url)] } } : { data: {} };
    });
    mocked.patch.mockImplementation(async (url: string, body: Record<string, unknown>) => {
      const target = stored[idOf(url)];
      const { base = {}, ...patch } = body as { base?: Record<string, unknown> } & Record<string, unknown>;
      const refusal = refusalOf(patch);
      if (refusal) throw Object.assign(new Error('HTTP 400'), { response: { status: 400, headers: {}, data: { message: refusal } } });
      const now = (field: string) => target[field] ?? null;
      const conflicts = Object.keys(patch)
        .filter((field) => field in base && base[field] !== now(field) && patch[field] !== now(field))
        .map((field) => ({
          field, base: base[field], current: now(field), mine: patch[field],
          labels: { base: null, current: null, mine: null },
          changed_by: author, changed_at: '2026-10-02T12:02:00.000Z',
        }));
      if (conflicts.length > 0) {
        throw Object.assign(new Error('HTTP 409'), { response: { status: 409, headers: {}, data: { code: 'edit_conflict', conflicts, row_version: 3 } } });
      }
      Object.assign(target, patch);
      return { data: {} };
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Beyond the typing pause and any retry: whatever the page would still send is sent. */
  async function settleSaves() {
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  }

  function LocationProbe() {
    const { pathname } = useLocation();
    return <div data-testid="location" data-path={pathname} />;
  }

  function renderLines(path: string) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router: { navigate: NavigateFunction | null } = { navigate: null };
    function NavigateProbe() {
      router.navigate = useNavigate();
      return null;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter initialEntries={[path]}>
            <NavigateProbe />
            <LocationProbe />
            <Routes>
              <Route path="/ops/opex/:id/:tab" element={<SpendItemPage />} />
              <Route path="/ops/opex" element={<div>opex list</div>} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    return { navigate: (to: string) => router.navigate!(to) };
  }

  async function typeInto(currentValue: string, value: string) {
    const field = await screen.findByDisplayValue(currentValue);
    await waitFor(() => {
      fireEvent.change(field, { target: { value } });
      expect(field).toHaveValue(value);
    });
    return field;
  }

  /** Marie saved other notes on line A after the screen read them; the user's notes are refused. */
  async function conflictOnNotes() {
    const router = renderLines(`/ops/opex/${LINE_A}/overview`);
    await screen.findByDisplayValue('Line A notes');
    stored[LINE_A].notes = 'Notes from Marie';
    const notes = await typeInto('Line A notes', 'My notes');
    await screen.findByTestId('edit-conflict-notes', undefined, { timeout: 3000 });
    expect(mocked.patch.mock.calls[0]).toEqual([`/spend-items/${LINE_A}`, { notes: 'My notes', base: { notes: 'Line A notes' } }]);
    return { router, notes };
  }

  const path = () => screen.getByTestId('location').getAttribute('data-path');

  it('shows the conflict, keeps the user\'s text through the reload, and applies it over theirs on request', async () => {
    const { notes } = await conflictOnNotes();
    // The line reloads (Marie's notes are stored), the box keeps the user's text.
    await waitFor(() => expect(mocked.get.mock.calls.filter(([url]) => url === `/spend-items/${LINE_A}`).length).toBeGreaterThanOrEqual(2));
    expect(notes).toHaveValue('My notes');
    expect(screen.queryByText('opex.editor.failedToSave')).toBeNull();
    expect(mocked.patch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'editConflict.applyMine: opex.fields.notes' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    expect(mocked.patch.mock.calls[1]).toEqual([`/spend-items/${LINE_A}`, { notes: 'My notes', base: { notes: 'Notes from Marie' } }]);
    await waitFor(() => expect(screen.queryByTestId('edit-conflict-notes')).toBeNull());
    expect(stored[LINE_A].notes).toBe('My notes');
    // The focus goes back to the field, not to the page's body.
    expect(document.activeElement).toBe(notes);
  });

  it('keeping their value shows theirs at once and sends nothing', async () => {
    const { notes } = await conflictOnNotes();
    fireEvent.click(screen.getByRole('button', { name: 'editConflict.keepTheirs: opex.fields.notes' }));
    // From the answer, before any reload.
    expect(notes).toHaveValue('Notes from Marie');
    expect(screen.queryByTestId('edit-conflict-notes')).toBeNull();
    await settleSaves();
    expect(mocked.patch).toHaveBeenCalledTimes(1);
    expect(stored[LINE_A].notes).toBe('Notes from Marie');
  });

  it('text typed again in a waiting field joins it: the banner shows it as the user\'s value, nothing is sent', async () => {
    const { notes } = await conflictOnNotes();
    fireEvent.change(notes, { target: { value: 'My notes, longer' } });
    // Nothing is said to be saving or saved: it waits for the choice.
    expect(screen.queryByText('common:status.saving')).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(screen.queryByText('common:status.saved')).toBeNull();
    await settleSaves();
    expect(mocked.patch).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('edit-conflict-notes')).toHaveTextContent('My notes, longer');
    fireEvent.click(screen.getByRole('button', { name: 'editConflict.applyMine: opex.fields.notes' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    expect(mocked.patch.mock.calls[1][1]).toEqual({ notes: 'My notes, longer', base: { notes: 'Notes from Marie' } });
  });

  // B1 of the review: a field waiting for a choice is never sent with a later edit of the line,
  // which the server could refuse for good (it checks a request before comparing it).
  it.each([
    ['clear company', { paying_company_id: null }, 'Paying company is required.'],
    ['pick deleted supplier', { supplier_id: 'supplier-gone' }, 'Supplier not found.'],
    ['pick cost center', { cost_center_id: 'cc-2' }, 'This cost center is disabled.'],
    ['pick disabled value', { analytics_values: { 'axis-default': 'value-disabled' } }, 'This analytics value is disabled.'],
    ['pick account of another chart', { account_id: 'account-other' }, 'Selected account does not belong to the paying company\'s Chart of Accounts'],
  ])('a choice waiting on the notes survives a refused edit of the line (%s)', async (button, sent, message) => {
    const { notes } = await conflictOnNotes();
    fireEvent.click(screen.getByRole('button', { name: button }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    // The refused field goes alone.
    const { base, ...fields } = mocked.patch.mock.calls[1][1] as Record<string, unknown>;
    expect(fields).toEqual(sent);
    expect(Object.keys(base as object)).toEqual(Object.keys(sent));
    expect(await screen.findByText(message)).toBeInTheDocument();
    // The choice is still asked, with the user's text.
    expect(screen.getByTestId('edit-conflict-notes')).toBeInTheDocument();
    expect(notes).toHaveValue('My notes');
    await settleSaves();
    expect(mocked.patch).toHaveBeenCalledTimes(2);

    fireEvent.click(screen.getByRole('button', { name: 'editConflict.applyMine: opex.fields.notes' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(3));
    expect(mocked.patch.mock.calls[2][1]).toEqual({ notes: 'My notes', base: { notes: 'Notes from Marie' } });
    expect(stored[LINE_A].notes).toBe('My notes');
  });

  it('a pick goes after the text still waiting for its typing pause, each in its own request', async () => {
    renderLines(`/ops/opex/${LINE_A}/overview`);
    await typeInto('Line A notes', 'Typed just before');
    // Picked before the pause ends: the server refuses the cost center.
    fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    expect(mocked.patch.mock.calls.map(([, body]) => body)).toEqual([
      { notes: 'Typed just before', base: { notes: 'Line A notes' } },
      { cost_center_id: 'cc-2', base: { cost_center_id: null } },
    ]);
    expect(await screen.findByText('This cost center is disabled.')).toBeInTheDocument();
    // One refusal never drops the other edit.
    expect(stored[LINE_A].notes).toBe('Typed just before');
  });

  it('disabling a line with no end of validity sends the status alone: two windows doing it are no conflict', async () => {
    renderLines(`/ops/opex/${LINE_A}/overview`);
    await screen.findByDisplayValue('Line A notes');
    // Another window disabled the line meanwhile (its own clock's now).
    stored[LINE_A].disabled_at = '2026-10-02T12:00:00.000Z';
    fireEvent.click(screen.getByRole('button', { name: 'disable line' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    expect(mocked.patch.mock.calls[0][1]).toEqual({ status: 'disabled' });
    await settleSaves();
    expect(screen.queryByTestId('edit-conflict-disabled_at')).toBeNull();
  });

  it('two ends of validity on the same day show their time', async () => {
    renderLines(`/ops/opex/${LINE_A}/overview`);
    await screen.findByDisplayValue('Line A notes');
    stored[LINE_A].disabled_at = '2026-12-31T16:00:00.000Z';
    fireEvent.click(screen.getByRole('button', { name: 'end on 31 December' }));
    const row = await screen.findByTestId('edit-conflict-disabled_at');
    expect(row.textContent).toMatch(/31 Dec 2026, \d\d:\d\d.*31 Dec 2026, \d\d:\d\d/);
  });

  it('a change of the user\'s own, from another window, is said so', async () => {
    author = { id: 'me', name: 'Me Myself' };
    await conflictOnNotes();
    expect(screen.getByTestId('edit-conflict-notes')).toHaveTextContent(/common:editConflict\.changedByYou(At|On)/);
    expect(screen.getByTestId('edit-conflict-notes')).not.toHaveTextContent('Me Myself');
  });

  it('a tab change keeps the choice: no question, the banner and the text stay', async () => {
    const { notes } = await conflictOnNotes();
    fireEvent.click(screen.getByRole('button', { name: 'budget tab' }));
    await waitFor(() => expect(path()).toBe(`/ops/opex/${LINE_A}/budget`));
    expect(dialogs.confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('edit-conflict-notes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'overview tab' }));
    await waitFor(() => expect(path()).toBe(`/ops/opex/${LINE_A}/overview`));
    expect(await screen.findByDisplayValue('My notes')).toBeInTheDocument();
    expect(notes).toBeDefined();
  });

  it('asks before leaving with a conflict not decided, then drops the user\'s value', async () => {
    await conflictOnNotes();
    dialogs.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'close workspace' }));
    await waitFor(() => expect(dialogs.confirm).toHaveBeenCalledTimes(1));
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'common:autosave.leaveTitle', message: 'common:autosave.leaveConflictMessage',
    }));
    expect(screen.queryByText('opex list')).toBeNull();
    expect(screen.getByTestId('edit-conflict-notes')).toBeInTheDocument();

    dialogs.confirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'close workspace' }));
    expect(await screen.findByText('opex list')).toBeInTheDocument();
    await settleSaves();
    expect(mocked.patch).toHaveBeenCalledTimes(1);
    expect(stored[LINE_A].notes).toBe('Notes from Marie');
  });

  it('a budget column waiting for a choice: a tab change keeps it, leaving the line names it, then drops it', async () => {
    renderLines(`/ops/opex/${LINE_A}/budget`);
    fireEvent.click(await screen.findByRole('button', { name: 'budget refused' }));

    // Another tab of the line: no question, the choice is kept for the line.
    fireEvent.click(screen.getByRole('button', { name: 'overview tab' }));
    await waitFor(() => expect(path()).toBe(`/ops/opex/${LINE_A}/overview`));
    expect(dialogs.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'budget tab' }));
    expect(await screen.findByTestId('budget-waiting')).toHaveTextContent('Budget');
    fireEvent.click(screen.getByRole('button', { name: 'overview tab' }));
    await waitFor(() => expect(path()).toBe(`/ops/opex/${LINE_A}/overview`));

    // Leaving the line, from another tab: the warning names the column waiting.
    dialogs.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: 'close workspace' }));
    await waitFor(() => expect(dialogs.confirm).toHaveBeenCalledTimes(1));
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'common:autosave.leaveTitle', message: 'common:autosave.leaveColumnsMessage',
    }));
    expect(screen.queryByText('opex list')).toBeNull();

    // The app's links ask the same; leaving drops the choice with the line.
    dialogs.confirm.mockResolvedValueOnce(true);
    let left = false;
    await act(async () => { left = await confirmLeave(); });
    expect(left).toBe(true);
    expect(dialogs.confirm).toHaveBeenLastCalledWith(expect.objectContaining({ message: 'common:autosave.leaveColumnsMessage' }));
  });

  it('a link of the app asks the page first (the layout\'s guard), with the same question', async () => {
    await conflictOnNotes();
    dialogs.confirm.mockResolvedValueOnce(false);
    let leave: boolean | undefined;
    await act(async () => { leave = await confirmLeave(); });
    expect(leave).toBe(false);
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'common:autosave.leaveConflictMessage' }));
    expect(screen.getByTestId('edit-conflict-notes')).toBeInTheDocument();
  });

  it('a line left another way keeps its choice for the session: back on it, the banner and the text are there', async () => {
    const { router } = await conflictOnNotes();
    // The browser's back button: no question, the page goes.
    act(() => { router.navigate('/ops/opex'); });
    expect(await screen.findByText('opex list')).toBeInTheDocument();
    expect(dialogs.confirm).not.toHaveBeenCalled();
    act(() => { router.navigate(`/ops/opex/${LINE_A}/overview`); });
    expect(await screen.findByTestId('edit-conflict-notes')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('My notes')).toBeInTheDocument();
    await settleSaves();
    expect(mocked.patch).toHaveBeenCalledTimes(1);
  });

  it('a save answered with a conflict once the page went is kept for the next visit', async () => {
    const router = renderLines(`/ops/opex/${LINE_A}/overview`);
    await screen.findByDisplayValue('Line A notes');
    stored[LINE_A].notes = 'Notes from Marie';
    await typeInto('Line A notes', 'Typed before leaving');
    // Gone before the typing pause: the page sends the text as it unmounts, the answer is a 409.
    act(() => { router.navigate('/ops/opex'); });
    expect(await screen.findByText('opex list')).toBeInTheDocument();
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    await settleSaves();
    act(() => { router.navigate(`/ops/opex/${LINE_A}/overview`); });
    expect(await screen.findByTestId('edit-conflict-notes')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Typed before leaving')).toBeInTheDocument();
  });

  it('never carries a conflict of line A to line B, names line A there, and opens it without a question', async () => {
    const { router } = await conflictOnNotes();
    // Another way to line B (no flush): no banner there, B's edit goes to B alone.
    act(() => { router.navigate(`/ops/opex/${LINE_B}/overview`); });
    await typeInto('Line B notes', 'B edited');
    expect(screen.queryByTestId('edit-conflict-notes')).toBeNull();
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(mocked.patch.mock.calls[1]).toEqual([`/spend-items/${LINE_B}`, { notes: 'B edited', base: { notes: 'Line B notes' } }]);
    expect(stored[LINE_A].notes).toBe('Notes from Marie');
    // Line A's waiting choice is named here, and leaving says which line it is on.
    expect(screen.getByTestId('edit-conflict-elsewhere')).toHaveTextContent('editConflict.elsewhere');
    dialogs.confirm.mockResolvedValueOnce(false);
    await act(async () => { await confirmLeave(); });
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ message: 'common:autosave.leaveConflictOtherMessage' }));

    // Its link opens line A without a question; the choice is still asked, with the user's text.
    fireEvent.click(screen.getByRole('button', { name: 'editConflict.open' }));
    expect(await screen.findByTestId('edit-conflict-notes')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('My notes')).toBeInTheDocument();
    expect(dialogs.confirm).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('edit-conflict-elsewhere')).toBeNull();
  });

  describe('a company and its account', () => {
    /** Someone else saves `theirs` after the screen read the line, then the user picks a company on another chart (the account is cleared with it). */
    async function pickOtherCompany(theirs: Record<string, unknown>) {
      renderLines(`/ops/opex/${LINE_A}/overview`);
      await waitFor(() => expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-account', 'account-1'));
      Object.assign(stored[LINE_A], theirs);
      fireEvent.click(screen.getByRole('button', { name: 'pick other company' }));
      await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
      expect(mocked.patch.mock.calls[0][1]).toEqual({
        paying_company_id: 'company-2', account_id: null, base: { paying_company_id: 'company-1', account_id: 'account-1' },
      });
    }
    const drawer = () => document.querySelector('[data-mode="edit"]');

    it('both changed by someone else: keeping their value of one keeps both, nothing is sent', async () => {
      await pickOtherCompany({ paying_company_id: 'company-3', account_id: 'account-3' });
      await screen.findByTestId('edit-conflict-account_id');
      expect(screen.getByTestId('edit-conflict-paying_company_id')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'editConflict.keepTheirs: opex.fields.payingCompany' }));
      expect(screen.queryByTestId('edit-conflict-account_id')).toBeNull();
      expect(screen.queryByTestId('edit-conflict-paying_company_id')).toBeNull();
      expect(drawer()).toHaveAttribute('data-company', 'company-3');
      expect(drawer()).toHaveAttribute('data-account', 'account-3');
      await settleSaves();
      expect(mocked.patch).toHaveBeenCalledTimes(1);
    });

    it('only the account changed: keeping their account drops the user\'s company too (no refusal follows)', async () => {
      await pickOtherCompany({ account_id: 'account-3' });
      await screen.findByTestId('edit-conflict-account_id');
      expect(screen.queryByTestId('edit-conflict-paying_company_id')).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'editConflict.keepTheirs: opex.fields.account' }));
      expect(drawer()).toHaveAttribute('data-account', 'account-3');
      await waitFor(() => expect(drawer()).toHaveAttribute('data-company', 'company-1'));
      await settleSaves();
      expect(mocked.patch).toHaveBeenCalledTimes(1);
      expect(stored[LINE_A]).toMatchObject({ paying_company_id: 'company-1', account_id: 'account-3' });
    });

    it('only the account changed: applying the user\'s value sends the company with the cleared account', async () => {
      await pickOtherCompany({ account_id: 'account-3' });
      await screen.findByTestId('edit-conflict-account_id');
      fireEvent.click(screen.getByRole('button', { name: 'editConflict.applyMine: opex.fields.account' }));
      await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
      expect(mocked.patch.mock.calls[1][1]).toEqual({
        paying_company_id: 'company-2', account_id: null, base: { paying_company_id: 'company-1', account_id: 'account-3' },
      });
      expect(stored[LINE_A]).toMatchObject({ paying_company_id: 'company-2', account_id: null });
    });
  });
});
