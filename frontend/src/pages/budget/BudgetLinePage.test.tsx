import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate, type NavigateFunction } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('react-i18next', async () => {
  const React = await import('react');
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  // `Trans` (the lineage of a line, lot M): its key, then its link holding the reference.
  const Trans = ({ i18nKey, values, components }: { i18nKey: string; values?: Record<string, unknown>; components?: { link?: React.ReactElement } }) => (
    <span>{i18nKey} {components?.link ? React.cloneElement(components.link, {}, String(values?.reference ?? '')) : null}</span>
  );
  return { useTranslation: () => translation, Trans };
});
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
// A limited data access that allows company-1 only through a cost center (null: unscoped, no filter).
const placement = vi.hoisted(() => ({ centreOnly: false }));
vi.mock('../../hooks/usePlacementOptions', () => ({
  useLinePlacementFilter: (companyId: string | null) => (placement.centreOnly && companyId === 'company-1'
    ? { companyIds: new Set(['company-1']), isCostCenterAllowed: () => true, costCenterRequired: true }
    : null),
}));
// The page asks before leaving with changes it could not save.
const dialogs = vi.hoisted(() => ({ confirm: vi.fn(async () => true), alert: vi.fn(async () => undefined), prompt: vi.fn(async () => null) }));
vi.mock('../../components/design', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/design')>()),
  useKanapDialogs: () => dialogs,
}));
const nav = vi.hoisted(() => ({ result: null as any, unified: false, calls: [] as Array<{ sort?: string | null; filters?: string | null; enabled?: boolean }> }));
vi.mock('../../hooks/useBudgetLineNav', () => ({
  useBudgetLineNav: (params: { sort?: string | null; filters?: string | null; enabled?: boolean }, _nature: string, unified = false) => {
    nav.unified = unified;
    nav.calls.push(params);
    return nav.result ?? { index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null };
  },
}));
vi.mock('../../hooks/useCurrencySettings', () => ({ default: () => ({ data: { defaultSpendCurrency: 'EUR' } }) }));
// The signed-in user: a conflict with their own change from another window is said so.
// May the user change lines (the required dimensions asked before leaving, lot D2).
const auth = vi.hoisted(() => ({ canEdit: true, admin: true, limited: false }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'me' },
    dataAccess: auth.limited ? { available: true, mode: 'limited' as const, nodes: [], modules: ['budget'] } : null,
    hasLevel: (_resource: string, level: string) => {
      if (!auth.canEdit) return false;
      if (level === 'admin') return auth.admin;
      return true;
    },
  }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: vi.fn() }) }));
vi.mock('../../utils/workspaceTabCounts', () => ({ fetchBudgetRelationsCount: vi.fn(async () => 0) }));
vi.mock('../portfolio/workspace/PortfolioDetailWorkspaceShell', () => ({
  default: ({ properties, actions, children, onTitleSave, onBack, onTabChange, metadata, itemReference, backLabel, nav: navigation, canEditTitle }: {
    canEditTitle?: boolean; itemReference?: string | null; backLabel?: string; properties?: React.ReactNode; actions?: React.ReactNode; children?: React.ReactNode; onTitleSave: (v: string) => void;
    onBack?: () => void; onTabChange?: (tab: string) => void; metadata?: React.ReactNode; nav?: { onNext?: () => void };
  }) => (
    <div data-testid="workspace-shell" data-can-edit-title={String(!!canEditTitle)}>
      <span data-testid="line-reference">{itemReference}</span><span>{backLabel}</span>
      <button type="button" onClick={() => onTitleSave('Monitoring')}>set title</button>
      <button type="button" onClick={() => onBack?.()}>back to list</button>
      <button type="button" onClick={() => onBack?.()}>close workspace</button>
      <button type="button" onClick={() => onTabChange?.('budget')}>budget tab</button>
      <button type="button" onClick={() => onTabChange?.('overview')}>overview tab</button>
      <button type="button" onClick={() => navigation?.onNext?.()}>next budget line</button>
      {metadata}{actions}{properties}{children}
    </div>
  ),
}));
// The drawer stands in for the pickers: each button sets one field.
vi.mock('./workspace/BudgetPropertiesDrawer', async () => {
  // The real cost center hook, called as the drawer calls it: a tree request would show in the API calls.
  const { useCostCenterNode } = await import('../../hooks/useCostCenterTree');
  return { default: (props: {
    costCenterId?: string;
    nature: string; onNatureChange: (v: string) => void; onChangeType?: () => void;
    mode: string; payingCompanyId: string; companyFollowsCostCenter?: boolean; accountId: string; onPayingCompanyChange: (v: string) => void;
    onAccountChange: (v: string) => void; onSupplierChange: (v: string) => void; onCostCenterChange: (v: string, node: { id: string; company_id: string | null } | null) => void;
    onRunBuildChange: (v: string) => void; analyticsValues: Record<string, string | null>;
    onAnalyticsValueChange: (axisId: string, v: string | null) => void; onDisabledAtChange?: (v: string | null) => void;
    references?: unknown; analyticsOptions?: unknown; disabled?: boolean;
  }) => {
    useCostCenterNode(props.costCenterId || null, ((props as { references?: { cost_center?: unknown } }).references?.cost_center ?? null) as never);
    return (
    <div
      data-cost-center={props.costCenterId}
      data-disabled={String(!!props.disabled)}
      data-mode={props.mode} data-company={props.payingCompanyId} data-account={props.accountId}
      data-company-follows={String(!!props.companyFollowsCostCenter)}
      data-analytics={JSON.stringify(props.analyticsValues)}
      data-references={JSON.stringify(props.references ?? null)}
      data-analytics-options={JSON.stringify(props.analyticsOptions ?? null)}
    >
      {props.mode === 'create' ? (
        <select aria-label="budget.type" value={props.nature} onChange={(e) => props.onNatureChange(e.target.value)}>
          <option value="opex">OPEX</option><option value="capex">CAPEX</option>
        </select>
      ) : <span data-testid="line-type">{props.nature}</span>}
      {props.onChangeType && <button type="button" onClick={props.onChangeType}>budget.changeType</button>}
      <button type="button" onClick={() => props.onPayingCompanyChange('company-1')}>pick company</button>
      <button type="button" onClick={() => props.onPayingCompanyChange('company-2')}>pick other company</button>
      <button type="button" onClick={() => props.onPayingCompanyChange('')}>clear company</button>
      <button type="button" onClick={() => props.onAccountChange('account-1')}>pick account</button>
      <button type="button" onClick={() => props.onAccountChange('account-other')}>pick account of another chart</button>
      <button type="button" onClick={() => props.onSupplierChange('')}>clear supplier</button>
      <button type="button" onClick={() => props.onSupplierChange('supplier-gone')}>pick deleted supplier</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-default', 'value-disabled')}>pick disabled value</button>
      <button type="button" onClick={() => props.onDisabledAtChange?.('2026-12-31T10:00:00.000Z')}>end on 31 December</button>
      <button type="button" onClick={() => props.onDisabledAtChange?.(null)}>clear end of validity</button>
      <button type="button" onClick={() => props.onCostCenterChange('cc-2', { id: 'cc-2', company_id: 'company-2' })}>pick cost center</button>
      <button type="button" onClick={() => props.onCostCenterChange('cc-3', { id: 'cc-3', company_id: 'company-3' })}>pick third cost center</button>
      <button type="button" onClick={() => props.onCostCenterChange('', null)}>clear cost center</button>
      <button type="button" onClick={() => props.onRunBuildChange('build')}>pick build</button>
      <button type="button" onClick={() => props.onRunBuildChange('')}>clear run or build</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-default', 'value-1')}>pick default value</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-default', null)}>clear default value</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-nature', 'value-2')}>pick nature value</button>
      <button type="button" onClick={() => props.onAnalyticsValueChange('axis-nature', null)}>clear nature value</button>
    </div>
    );
  } };
});
vi.mock('./workspace/BudgetMetadataBar', async () => {
  const { useCostCenterNode } = await import('../../hooks/useCostCenterTree');
  return {
    default: ({ onStatusChange, costCenterId, costCenter, lineRef, disabled }: {
      onStatusChange: (status: string) => void; costCenterId?: string | null; costCenter?: { id: string } | null; lineRef?: string | null; disabled?: boolean;
    }) => {
      // The budget holder's read, as the bar makes it.
      useCostCenterNode(costCenterId ?? null, (costCenter ?? null) as never);
      return (
        <>
          <span data-testid="metadata-line-ref" data-line-ref={lineRef ?? ''} />
          <button type="button" data-disabled={String(!!disabled)} onClick={() => onStatusChange('disabled')}>disable line</button>
          <button type="button" data-disabled={String(!!disabled)} onClick={() => onStatusChange('enabled')}>enable line</button>
        </>
      );    },
  };
});
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
// The Budget tab stands in with its handle and the line's held choices (lot 3D): « budget refused »
// leaves the Budget column waiting for a choice. It reports the version counter it loaded (lot 3G).
const budgetStandIn = vi.hoisted(() => ({ rev: 3, reloads: 0, typed: false, failReload: false }));
vi.mock('../../components/finance/BudgetTab', async () => {
  const React = await import('react');
  type Held = { current: { lineId: string; labels: string[] } | null };
  const BudgetTabStandIn = React.forwardRef(({ id, year, held, onBudgetRev, lineEditable }: { id: string; year: number; held?: Held; onBudgetRev?: (year: number, rev: number | null) => void; lineEditable?: boolean }, ref) => {
    const waiting = React.useRef<string[]>(held?.current?.lineId === id ? held.current.labels : []);
    const [, redraw] = React.useState(0);
    React.useEffect(() => {
      if (held?.current?.lineId === id) held.current = null;
      onBudgetRev?.(year, budgetStandIn.rev);
      return () => {
        if (held && waiting.current.length > 0) held.current = { lineId: id, labels: waiting.current } as never;
      };
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    React.useImperativeHandle(ref, () => ({
      flush: async (options?: { ignoreHeld?: boolean }) => !!options?.ignoreHeld || waiting.current.length === 0,
      isDirty: () => waiting.current.length > 0,
      waitingColumns: () => waiting.current,
      isSaving: () => false,
      hasPending: () => waiting.current.length > 0 || budgetStandIn.typed,
      discard: () => { waiting.current = []; },
      reloadFromServer: async () => {
        if (budgetStandIn.failReload) throw new Error('offline');
        budgetStandIn.reloads += 1;
      },
    }));
    return (
      <div data-testid="budget-tab" data-line-editable={String(lineEditable)}>
        <span data-testid="budget-waiting">{waiting.current.join(',')}</span>
        <button type="button" onClick={() => { waiting.current = ['Budget']; redraw((n) => n + 1); }}>budget refused</button>
        <button type="button" onClick={() => { budgetStandIn.typed = true; }}>budget typed</button>
      </div>
    );
  });
  return { default: BudgetTabStandIn };
});
vi.mock('../../components/finance/AllocationsTab', () => ({ default: () => null }));
vi.mock('./workspace/BudgetLineRelationsTab', () => ({
  default: (p: { lineEditable?: boolean }) => <div data-testid="relations-tab" data-line-editable={String(p.lineEditable)} />,
}));
vi.mock('../../components/EntityTasksPanel', () => ({
  default: ({ disabled }: { disabled?: boolean }) => <div data-testid="tasks-panel" data-disabled={String(!!disabled)} />,
}));// The change type dialog (lot M) stands in: open, it says for which line, and « confirm type change »
// answers as the server does for a change in place.
vi.mock('../../components/finance/ChangeTypeDialog', () => ({
  default: ({ open, nature, lineId, onChanged }: { open: boolean; nature: string; lineId: string; onChanged: (result: unknown) => void }) => (open ? (
    <div data-testid="change-type-dialog" data-nature={nature} data-line={lineId}>
      <button type="button" onClick={() => onChanged({ id: lineId, reference: 'BL-7', nature: otherNature() })}>confirm type change</button>
    </div>
  ) : null),
}));

import api from '../../api';
import BudgetLinePage from './BudgetLinePage';
import BudgetLineRoute from './BudgetLineRoute';
import { BUDGET_NATURE_CONFIG } from './natureConfig';

let nature: 'opex' | 'capex' = 'opex';
const otherNature = () => BUDGET_NATURE_CONFIG[nature].otherNature;
const legacyPrefix = () => BUDGET_NATURE_CONFIG[nature].legacyPrefix;
import { resetSharedPatchBuffers } from '../../hooks/patchBuffer';
import { confirmLeave } from '../../hooks/leaveGuard';
import { fetchBudgetRelationsCount } from '../../utils/workspaceTabCounts';
import { DEFAULT_BUDGET_COLUMNS } from '../../services/budgetColumns';
import { resetListContextCache } from '../../lib/listContext';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn>; patch: ReturnType<typeof vi.fn>; delete: ReturnType<typeof vi.fn>;
};

const charts = vi.hoisted(() => ({ company2: 'coa-b' }));

const ITEM_ID = '11111111-2222-3333-4444-555555555555';

/**
 * The clock of the specs that say who changed what and when: the day of their `changed_at`
 * (12:02 to 12:03 UTC), so the message reads « at HH:MM » whatever day and time zone they run in.
 */
const CHANGES_DAY = new Date('2026-10-02T12:04:00.000Z');

// The edits a page keeps for the session (lot 3C review): each test starts without any.
beforeEach(() => {
  resetSharedPatchBuffers();
  nav.result = null;
  nav.unified = false;
  auth.canEdit = true;
  auth.admin = true;
  auth.limited = false;
});

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

/** Stands for the CAPEX workspace: shows the path a change of type opened. */
function CapexPageProbe() {
  const { pathname } = useLocation();
  return <div data-testid="capex-page" data-path={pathname} />;
}

function CreateTargetProbe() {
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  return <div data-testid="create-target" data-path={pathname} data-search={search}>
    <button onClick={() => navigate(-1)}>browser back</button>
  </div>;
}

/** Dashboard and list keys a saved line must drop. The tiles keep these for minutes. */
const DASHBOARD_QUERY_KEYS = [
  ['budget-lines-summary', 'dashboard', 'snapshot'],
  ['budget-lines-summary', 'dashboard', 'recent-updates'],
  ['budget-lines-summary', 'dashboard', 'top-items', 'all', 2026, 'budget', 5],
  ['spend-items-summary', 'aggregate'],
  ['capex-items-summary', 'aggregate'],
] as const;

function seedDashboard(queryClient: QueryClient) {
  for (const key of DASHBOARD_QUERY_KEYS) queryClient.setQueryData([...key], { seeded: true });
}

async function expectDashboardInvalidated(queryClient: QueryClient) {
  await waitFor(() => {
    for (const key of DASHBOARD_QUERY_KEYS) expect(queryClient.getQueryState([...key])?.isInvalidated).toBe(true);
  });
}

// The routers here render like the app's (`useTransitions={false}` in main.tsx).
function renderAt(path: string, previous?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={previous ? [previous, path] : [path]} useTransitions={false}>
          <Routes>
            <Route path={`/ops/budget/:ref/:tab`} element={<BudgetLinePage nature={nature} />} />
            <Route path="/ops/budget" element={<ListPageProbe />} />
            <Route path="/ops/opex" element={<ListPageProbe />} />
            <Route path="/ops/budget/BL-7/:tab" element={<CapexPageProbe />} />
            <Route path="/ops/budget/BL-12/:tab" element={<CapexPageProbe />} />
            <Route path="/ops/budget/BL-9/:tab" element={<CapexPageProbe />} />
            <Route path={`/ops/budget/new`} element={<CreateTargetProbe />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient };
}

describe.each(['opex', 'capex'] as const)('BudgetLinePage %s', (lineNature) => {
  beforeEach(() => { nature = lineNature; });
describe('BudgetLinePage create', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    mocked.get.mockResolvedValue({ data: {} });
    mocked.post.mockResolvedValue({ data: { id: 'new-id' } });
  });

  it('refreshes the dashboard tiles after creating a line', async () => {
    const { queryClient } = renderAt(`/ops/budget/new/overview`);
    seedDashboard(queryClient);
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    await expectDashboardInvalidated(queryClient);
  });

  it('creates a line without a supplier and sends none', async () => {
    renderAt(`/ops/budget/new/overview`);
    expect(document.querySelector('[data-mode="create"]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][0]).toBe('/budget-lines');
    expect(mocked.post.mock.calls[0][1]).toMatchObject({
      product_name: 'Monitoring',
      supplier_id: null,
      paying_company_id: 'company-1',
      account_id: 'account-1',
    });
  });

  it('fills an empty paying company from the picked cost center and sends both new fields', async () => {
    renderAt(`/ops/budget/new/overview`);
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
    renderAt(`/ops/budget/new/overview`);
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
    renderAt(`/ops/budget/new/overview`);
    const drawer = () => document.querySelector('[data-mode="create"]');
    fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
    expect(drawer()).toHaveAttribute('data-company', 'company-2');
    // While the company follows, the cost center list is not narrowed to it.
    expect(drawer()).toHaveAttribute('data-company-follows', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'pick third cost center' }));
    expect(drawer()).toHaveAttribute('data-company', 'company-3');
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    expect(drawer()).toHaveAttribute('data-company-follows', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
    expect(drawer()).toHaveAttribute('data-company', 'company-3');
  });

  it('empties a cost center of another company when the user picks a company', async () => {
    const node = (id: string, company: string) => ({
      id, code: id.toUpperCase(), name: id, kind: 'cost_center', parent_id: null, company_id: company, company_name: company,
      owner_user_id: null, owner_name: null, status: 'enabled', disabled_at: null, sort_order: 0, depth: 0, path: id, path_ids: [id],
    });
    mocked.get.mockImplementation(async (url: string) => (url === '/cost-centers/tree'
      ? { data: { items: [node('cc-2', 'company-2'), node('cc-3', 'company-3')] } }
      : { data: {} }));
    renderAt(`/ops/budget/new/overview`);
    const drawer = () => document.querySelector('[data-mode="create"]');
    fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
    expect(drawer()).toHaveAttribute('data-company', 'company-2');
    // The tree names the cost center's company once it has loaded.
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/cost-centers/tree'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    fireEvent.click(screen.getByRole('button', { name: 'pick other company' }));
    expect(drawer()).toHaveAttribute('data-cost-center', 'cc-2');
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    expect(drawer()).toHaveAttribute('data-company', 'company-1');
    expect(drawer()).toHaveAttribute('data-cost-center', '');
  });

  it('stops following the cost center once the user picks a company', async () => {
    renderAt(`/ops/budget/new/overview`);
    const drawer = () => document.querySelector('[data-mode="create"]');
    fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    expect(drawer()).toHaveAttribute('data-company-follows', 'false');
    fireEvent.click(screen.getByRole('button', { name: 'pick third cost center' }));
    expect(drawer()).toHaveAttribute('data-company', 'company-1');
  });

  it('sends the value of each dimension given one, and never the old single field', async () => {
    renderAt(`/ops/budget/new/overview`);
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

  it('never sends a value on a dimension for CAPEX lines only', async () => {
    mocked.get.mockImplementation(async (url: string) => (url === '/analytics-axes'
      ? { data: { items: [
        { id: 'axis-default', code: 'default', name: null, description: null, sort_order: 0, is_default: true, applies_to: null, status: 'enabled', disabled_at: null },
        { id: 'axis-nature', code: 'nature', name: 'Nature', description: null, sort_order: 1, is_default: false, applies_to: lineNature === 'opex' ? 'capex' : 'opex', status: 'enabled', disabled_at: null },
      ] } }
      : { data: {} }));
    renderAt(`/ops/budget/new/overview`);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/analytics-axes'));
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick default value' }));
    // Picked before the dimension became CAPEX only: no longer shown, so not sent.
    fireEvent.click(screen.getByRole('button', { name: 'pick nature value' }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][1].analytics_values).toEqual({ 'axis-default': 'value-1' });
  });

  it('sends an empty map when no dimension has a value', async () => {
    renderAt(`/ops/budget/new/overview`);
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][1].analytics_values).toEqual({});
  });

  it('refuses to create a line without a value on a dimension required for OPEX lines, and only those', async () => {
    mocked.get.mockImplementation(async (url: string) => (url === '/analytics-axes'
      ? { data: { items: [
        { id: 'axis-default', code: 'default', name: null, description: null, sort_order: 0, is_default: true, applies_to: null, required: false, status: 'enabled', disabled_at: null },
        { id: 'axis-nature', code: 'nature', name: 'Nature', description: null, sort_order: 1, is_default: false, applies_to: null, required: true, status: 'enabled', disabled_at: null },
        // Required, but for CAPEX lines only, or disabled: not checked here.
        { id: 'axis-other', code: 'other', name: 'Other', description: null, sort_order: 2, is_default: false, applies_to: lineNature === 'opex' ? 'capex' : 'opex', required: true, status: 'enabled', disabled_at: null },
        { id: 'axis-old', code: 'old', name: 'Old', description: null, sort_order: 3, is_default: false, applies_to: null, required: true, status: 'disabled', disabled_at: '2020-01-01T00:00:00.000Z' },
      ] } }
      : { data: {} }));
    renderAt(`/ops/budget/new/overview`);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/analytics-axes'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('opex.editor.dimensionRequired')).toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'pick nature value' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][1].analytics_values).toEqual({ 'axis-nature': 'value-2' });
  });

  it('refuses to create a line without a title, with the title message for both types', async () => {
    renderAt(`/ops/budget/new/overview`);
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('opex.editor.productNameRequired')).toBeInTheDocument();
    expect(screen.queryByText('capex.editor.descriptionRequired')).not.toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('refuses to create a line without a cost center when the access allows its company only through one', async () => {
    placement.centreOnly = true;
    try {
      renderAt(`/ops/budget/new/overview`);
      fireEvent.click(screen.getByRole('button', { name: 'set title' }));
      fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
      fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
      fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
      expect(await screen.findByText('opex.editor.dimensionRequired')).toBeInTheDocument();
      expect(mocked.post).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'pick cost center' }));
      fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
      await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
      expect(mocked.post.mock.calls[0][1]).toMatchObject({ paying_company_id: 'company-1', cost_center_id: 'cc-2' });
    } finally {
      placement.centreOnly = false;
    }
  });

  it('refuses to create a line without an account', async () => {
    renderAt(`/ops/budget/new/overview`);
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('opex.editor.accountRequired')).toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();
  });
});

// Charts of accounts: the account and the first company on one, the second company on another.


describe('BudgetLinePage edit', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    charts.company2 = 'coa-b';
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/budget-lines/${ITEM_ID}`) {
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

  it('gives the owner pickers the line ref in edit mode', async () => {
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await waitFor(() => expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-account', 'account-1'));
    expect(screen.getByTestId('metadata-line-ref')).toHaveAttribute('data-line-ref', ITEM_ID);
  });

  it('refreshes the dashboard tiles after a saved field', async () => {
    const { queryClient } = renderAt(`/ops/budget/${ITEM_ID}/overview`);
    seedDashboard(queryClient);
    await clickOnceLoaded('pick other company');
    await expectDashboardInvalidated(queryClient);
  });

  it('clears the account in the same write when the new company uses another chart', async () => {
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await clickOnceLoaded('pick other company');
    expect(mocked.patch).toHaveBeenCalledTimes(1);
    // Each field with the value the screen showed before (its base, lot 3C).
    expect(mocked.patch).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}`, {
      paying_company_id: 'company-2', account_id: null, base: { paying_company_id: 'company-1', account_id: 'account-1' },
    });
    // The Account row now asks for an account on the new chart.
    expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-account', '');
  });

  it("drops a cost center of another company in the same write as the new company", async () => {
    charts.company2 = 'coa-a';
    const base = {
      id: ITEM_ID, item_number: 7, product_name: 'Monitoring', supplier_id: 'supplier-1', notes: 'Renewal',
      paying_company_id: 'company-1', account_id: 'account-1', currency: 'EUR', effective_start: '2026-01-01',
    };
    const center = (company: string) => ({
      id: 'cc-1', code: 'CC-1', name: 'Centre', kind: 'cost_center', status: 'enabled',
      company_id: company, company_name: company, owner_user_id: null, owner_name: null,
    });
    const withCenter = (company: string) => async (url: string) => (url === `/budget-lines/${ITEM_ID}`
      ? { data: { ...base, cost_center_id: 'cc-1', references: { cost_center: center(company) } } }
      : url === '/companies/company-2' ? { data: { id: 'company-2', coa_id: 'coa-a' } }
        : url === '/accounts/account-1' ? { data: { id: 'account-1', coa_id: 'coa-a' } } : { data: {} });

    mocked.get.mockImplementation(withCenter('company-1'));
    const { unmount } = renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await clickOnceLoaded('pick other company');
    expect(mocked.patch).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}`, {
      paying_company_id: 'company-2', cost_center_id: null, base: { paying_company_id: 'company-1', cost_center_id: 'cc-1' },
    });
    unmount();

    // The new company's own cost center stays.
    mocked.patch.mockClear();
    mocked.get.mockImplementation(withCenter('company-2'));
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await clickOnceLoaded('pick other company');
    expect(mocked.patch).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}`, { paying_company_id: 'company-2', base: { paying_company_id: 'company-1' } });
  });

  it('keeps the account when the new company uses the same chart', async () => {
    charts.company2 = 'coa-a';
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await clickOnceLoaded('pick other company');
    expect(mocked.patch).toHaveBeenCalledTimes(1);
    expect(mocked.patch).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}`, { paying_company_id: 'company-2', base: { paying_company_id: 'company-1' } });
  });

  it('shows the refusal of an account kept for CAPEX lines', async () => {
    const message = 'This account is for CAPEX lines only. Choose an account for OPEX lines.';
    mocked.patch.mockRejectedValueOnce(Object.assign(new Error('HTTP 400'), { response: { status: 400, headers: {}, data: { message } } }));
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await clickOnceLoaded('pick account of another chart');
    expect(mocked.patch).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}`, { account_id: 'account-other', base: { account_id: 'account-1' } });
    expect(await screen.findByText(message)).toBeInTheDocument();
  });

  it('saves cleared notes as null after the typing pause', async () => {
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    const notes = await screen.findByDisplayValue('Renewal');
    // The debounced write goes through flushPending, which normalises like the immediate one.
    await waitFor(() => {
      fireEvent.change(notes, { target: { value: '' } });
      expect(notes).toHaveValue('');
    });
    await waitFor(() => expect(mocked.patch).toHaveBeenCalled(), { timeout: 3000 });
    expect(mocked.patch).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}`, { notes: null, base: { notes: 'Renewal' } });
  });

  it('clears the supplier as null, not as an empty string', async () => {
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}`, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    // The form shows the line (the click below starts from what the screen shows: its base).
    await waitFor(() => expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-account', 'account-1'));
    // Writes wait for the line to load; retry the click until one goes through.
    await waitFor(() => {
      fireEvent.click(screen.getByRole('button', { name: 'clear supplier' }));
      expect(mocked.patch).toHaveBeenCalled();
    });
    expect(mocked.patch.mock.calls[0][1]).toEqual({ supplier_id: null, base: { supplier_id: 'supplier-1' } });
  });

  it('patches the cost center and run or build, as null when cleared', async () => {
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}`, expect.objectContaining({ signal: expect.any(AbortSignal) })));
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

// A budget reader (budget right at reader level): the line reads, nothing on the page writes.
describe('BudgetLinePage for a budget reader', () => {
  beforeEach(() => {
    auth.canEdit = false;
    mocked.get.mockReset();
    mocked.patch.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/budget-lines/${ITEM_ID}`) {
        return {
          data: {
            id: ITEM_ID, item_number: 7, product_name: 'Monitoring', supplier_id: 'supplier-1', description: 'Probes', notes: 'Renewal',
            paying_company_id: 'company-1', account_id: 'account-1', currency: 'EUR', effective_start: '2026-01-01',
          },
        };
      }
      return { data: {} };
    });
    mocked.patch.mockResolvedValue({ data: {} });
  });
  afterEach(() => { auth.canEdit = true; });

  it('shows every field of the overview read only and offers no title edit or change of type', async () => {
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    expect(await screen.findByDisplayValue('Probes')).toBeDisabled();
    expect(screen.getByDisplayValue('Renewal')).toBeDisabled();
    expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByRole('button', { name: 'disable line' })).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByTestId('workspace-shell')).toHaveAttribute('data-can-edit-title', 'false');
    expect(screen.queryByRole('button', { name: 'budget.changeType' })).not.toBeInTheDocument();
    // Tasks follow the tasks right, held at reader level by this role too.
    expect(screen.getByTestId('tasks-panel')).toHaveAttribute('data-disabled', 'true');
  });

  it('sends nothing when a control reaches the page anyway', async () => {
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await screen.findByDisplayValue('Probes');
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick other company' }));
    fireEvent.click(screen.getByRole('button', { name: 'disable line' }));
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(screen.queryByText('Forbidden resource')).not.toBeInTheDocument();
  });

  it('a member keeps the fields editable', async () => {
    auth.canEdit = true;
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    expect(await screen.findByDisplayValue('Probes')).toBeEnabled();
    expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-disabled', 'false');
    expect(screen.getByTestId('workspace-shell')).toHaveAttribute('data-can-edit-title', 'true');
  });
});

// A member whose data access leaves the line read only (`editable: false`, lot 3 of data-scoped access).
describe('BudgetLinePage for a line read only in the data access', () => {
  const detail = (extra: Record<string, unknown>) => ({
    id: ITEM_ID, item_number: 7, product_name: 'Monitoring', supplier_id: 'supplier-1', description: 'Probes', notes: 'Renewal',
    paying_company_id: 'company-1', account_id: 'account-1', currency: 'EUR', effective_start: '2026-01-01', ...extra,
  });
  beforeEach(() => {
    auth.canEdit = true;
    mocked.get.mockReset();
    mocked.patch.mockReset();
    mocked.patch.mockResolvedValue({ data: {} });
  });
  const answer = (extra: Record<string, unknown>) => mocked.get.mockImplementation(async (url: string) => (
    url === `/budget-lines/${ITEM_ID}` ? { data: detail(extra) } : { data: {} }
  ));

  it('shows the line with no edit command and says it is read only in the access', async () => {
    answer({ editable: false });
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    expect(await screen.findByDisplayValue('Probes')).toBeDisabled();
    expect(screen.getByDisplayValue('Renewal')).toBeDisabled();
    expect(document.querySelector('[data-mode="edit"]')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByTestId('workspace-shell')).toHaveAttribute('data-can-edit-title', 'false');
    expect(screen.queryByRole('button', { name: 'budget.changeType' })).not.toBeInTheDocument();
    expect(screen.getByTestId('tasks-panel')).toHaveAttribute('data-disabled', 'true');
    expect(screen.getByTestId('line-read-only')).toHaveTextContent('budget.readOnlyInYourAccess');
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    await new Promise((resolve) => { setTimeout(resolve, 50); });
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('passes the read-only state to the Budget and Relations tabs', async () => {
    answer({ editable: false });
    renderAt(`/ops/budget/${ITEM_ID}/budget`);
    expect(await screen.findByTestId('budget-tab')).toHaveAttribute('data-line-editable', 'false');
    cleanup();
    renderAt(`/ops/budget/${ITEM_ID}/relations`);
    expect(await screen.findByTestId('relations-tab')).toHaveAttribute('data-line-editable', 'false');
  });

  it('keeps today\'s screen for an unscoped person (no editable field) and an editable line', async () => {
    for (const extra of [{}, { editable: true }]) {
      answer(extra);
      renderAt(`/ops/budget/${ITEM_ID}/overview`);
      expect(await screen.findByDisplayValue('Probes')).toBeEnabled();
      expect(screen.getByTestId('workspace-shell')).toHaveAttribute('data-can-edit-title', 'true');
      expect(screen.queryByTestId('line-read-only')).not.toBeInTheDocument();
      cleanup();
    }
  });
});

describe('BudgetLinePage picker labels from the detail', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/budget-lines/${ITEM_ID}`) {
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
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await waitFor(() => expect(document.querySelector('[data-mode="edit"]')?.getAttribute('data-references')).toContain('Société Test'));
    const drawer = document.querySelector('[data-mode="edit"]')!;
    expect(JSON.parse(drawer.getAttribute('data-references')!).account.account_number).toBe(6110);
    expect(JSON.parse(drawer.getAttribute('data-analytics-options')!)).toEqual({ 'axis-default': { id: 'value-1', name: 'Licences' } });
    const urls = mocked.get.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => /^\/(suppliers|companies|accounts|users)\b/.test(url))).toEqual([]);
  });
});

describe('BudgetLinePage first wave', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    vi.mocked(fetchBudgetRelationsCount).mockClear();
  });

  it("asks for the Relations badge with the route's reference, with the detail, not after it", async () => {
    let answerDetail: () => void = () => undefined;
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/budget-lines/${legacyPrefix()}-7`) {
        await new Promise<void>((resolve) => { answerDetail = resolve; });
        return { data: { id: ITEM_ID, item_number: 7, product_name: 'Monitoring', currency: 'EUR', effective_start: '2026-01-01' } };
      }
      return { data: {} };
    });
    renderAt(`/ops/budget/${legacyPrefix()}-7/overview`);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith(`/budget-lines/${legacyPrefix()}-7`, expect.objectContaining({ signal: expect.any(AbortSignal) })));
    // The detail is not answered yet: the badge's request is already out.
    await waitFor(() => expect(fetchBudgetRelationsCount).toHaveBeenCalledWith(BUDGET_NATURE_CONFIG[nature], `${legacyPrefix()}-7`, expect.any(AbortSignal)));
    await act(async () => { answerDetail(); });
  });
});

describe('BudgetLinePage notes typed during a save', () => {
  // What the server holds; a PATCH applies to it only when the test resolves it.
  const server: Record<string, unknown> = {};
  const saves: Array<() => void> = [];

  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    saves.length = 0;
    Object.assign(server, { notes: 'Renewal', account_id: 'account-1' });
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/budget-lines/${ITEM_ID}`) {
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
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
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
    await waitFor(() => expect(mocked.get.mock.calls.filter(([u]) => u === `/budget-lines/${ITEM_ID}`).length).toBeGreaterThanOrEqual(3));
    expect(notes).toHaveValue('Renewal AB');
  });
});

describe('BudgetLinePage analytics dimensions', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/budget-lines/${ITEM_ID}`) {
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
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
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

describe('BudgetLinePage list context', () => {
  beforeEach(() => {
    nav.calls = [];
    window.sessionStorage.clear();
    mocked.get.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/budget-columns') return { data: DEFAULT_BUDGET_COLUMNS };
      if (url === `/budget-lines/${ITEM_ID}`) return { data: { id: ITEM_ID, item_number: 7, product_name: 'Monitoring', currency: 'EUR' } };
      return { data: {} };
    });
  });

  it('a unified list context enables mixed navigation and opens a CAPEX neighbour with the list state', async () => {
    nav.result = { index: 0, total: 2, hasPrev: false, hasNext: true, prevId: null, nextId: 'BL-12', nextPath: `/ops/budget/BL-12` };
    renderAt(`/ops/budget/${ITEM_ID}/overview?list=budget&sort=product_name:ASC`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    expect(nav.unified).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'next budget line' }));
    const page = await screen.findByTestId('capex-page');
    expect(page.getAttribute('data-path')).toBe(`/ops/budget/BL-12/overview`);
  });

  it('sends prev/next no sort for the default one, and keeps a sort the user picked', async () => {
    window.sessionStorage.setItem('budget-list-context', JSON.stringify({ sort: 'yBudget:DESC', q: '', filters: '', statusScope: 'enabled' }));
    const first = renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    expect(nav.calls.filter((c) => c.enabled).every((c) => (c.sort ?? null) === null)).toBe(true);
    first.unmount();

    nav.calls = [];
    window.sessionStorage.setItem('budget-list-context', JSON.stringify({ sort: 'yRevision:ASC', q: '', filters: '', statusScope: 'enabled' }));
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    expect(nav.calls.filter((c) => c.enabled).every((c) => c.sort === 'yRevision:ASC')).toBe(true);
  });

  it('walks prev/next like the list: a sort or filter on a hidden column falls back', async () => {
    const filters = JSON.stringify({ yForecast: { filterType: 'number', type: 'greaterThan', filter: 1 }, yBudget: { filterType: 'number', type: 'greaterThan', filter: 2 } });
    renderAt(`/ops/budget/${ITEM_ID}/overview?list=budget&sort=yForecast:ASC&filters=${encodeURIComponent(filters)}`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    const ready = nav.calls.filter((c) => c.enabled);
    for (const call of ready) {
      // No sort: prev/next uses the current default sort.
      expect(call.sort ?? null).toBeNull();
      expect(JSON.parse(call.filters ?? '{}')).toEqual({ yBudget: { filterType: 'number', type: 'greaterThan', filter: 2 } });
    }
    // The stored list context gets the same, once the setting is known.
    const stored = JSON.parse(window.sessionStorage.getItem('budget-list-context') ?? '{}');
    expect(stored.sort).toBe('');
    expect(stored.filters).not.toContain('yForecast');
  });

  it('opened from a list a report link opened (`from=report`): walks its scope and filters, leaves the stored context alone, goes back to that view', async () => {
    const own = { sort: '', q: '', filters: JSON.stringify({ supplier_name: { filterType: 'set', values: ['Alpha'] } }), statusScope: 'enabled' };
    window.sessionStorage.setItem('budget-list-context', JSON.stringify(own));
    const filters = JSON.stringify({ has_fte: { filterType: 'set', values: ['yes'] } });
    renderAt(`/ops/budget/${ITEM_ID}/overview?${new URLSearchParams({ filters, statusScope: 'all', from: 'report' })}`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    for (const call of nav.calls.filter((c) => c.enabled) as Array<{ filters?: string | null; statusScope?: string }>) {
      expect(call.statusScope).toBe('all');
      expect(JSON.parse(call.filters ?? '{}')).toEqual(JSON.parse(filters));
    }
    expect(JSON.parse(window.sessionStorage.getItem('budget-list-context') ?? '{}')).toEqual(own);
    fireEvent.click(screen.getByRole('button', { name: 'back to list' }));
    const search = new URLSearchParams((await screen.findByTestId('list-page')).getAttribute('data-search') ?? '');
    expect(search.get('from')).toBe('report');
    expect(search.get('statusScope')).toBe('all');
    expect(search.get('filters')).toBe(filters);
    expect(JSON.parse(window.sessionStorage.getItem('budget-list-context') ?? '{}')).toEqual(own);
  });
});

describe('BudgetLinePage list context too long for a URL (ctx)', () => {
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
      if (url === `/list-contexts/${CTX}`) return { data: { id: CTX, list: 'budget-lines', state: { filters: BIG } } };
      if (url === `/budget-lines/${ITEM_ID}`) return { data: { id: ITEM_ID, item_number: 7, product_name: 'Monitoring', currency: 'EUR' } };
      return { data: {} };
    });
  });

  it('a link opened in a new tab: reads the saved filters, walks prev/next with them, goes back to the list with ctx', async () => {
    renderAt(`/ops/budget/${ITEM_ID}/overview?sort=product_name:ASC&ctx=${CTX}`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    // Not enabled before the saved filters are read: prev/next never walks the unfiltered list.
    for (const call of nav.calls.filter((c) => c.enabled)) expect(JSON.parse(call.filters ?? '{}')).toEqual(BIG);
    expect(mocked.get.mock.calls.filter(([url]) => url === `/list-contexts/${CTX}`)).toHaveLength(1);
    expect(mocked.post).not.toHaveBeenCalled();
    // The stored list context keeps the id, not 31 KB.
    await waitFor(() => expect(JSON.parse(window.sessionStorage.getItem('budget-list-context') ?? '{}')).toMatchObject({ filters: '', ctx: CTX }));
    fireEvent.click(screen.getByRole('button', { name: 'back to list' }));
    const list = await screen.findByTestId('list-page');
    const search = new URLSearchParams(list.getAttribute('data-search') ?? '');
    expect(search.get('ctx')).toBe(CTX);
    expect(search.get('filters')).toBeNull();
    expect(search.get('sort')).toBe('product_name:ASC');
  });
});

describe('BudgetLinePage list context and dimensions', () => {
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
      if (url === `/budget-lines/${ITEM_ID}`) return { data: { id: ITEM_ID, item_number: 7, product_name: 'Line', currency: 'EUR' } };
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
    window.sessionStorage.setItem('budget-list-context', JSON.stringify({
      sort: `analytics_${OLD}:ASC`, q: '', filters: JSON.stringify(filters), statusScope: 'enabled',
    }));
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    // Never enabled before the dimensions are known.
    for (const call of nav.calls.filter((c) => c.enabled)) {
      expect(call.sort ?? null).toBeNull();
      expect(JSON.parse(call.filters ?? '{}')).toEqual(kept);
    }
    const stored = JSON.parse(window.sessionStorage.getItem('budget-list-context') ?? '{}');
    expect(stored.sort).toBe('');
    expect(JSON.parse(stored.filters)).toEqual(kept);
  });

  it('walks prev/next like the list: a sort or filter on a former CAPEX criterion falls back', async () => {
    const kept = { [`analytics_${NATURE}`]: { filterType: 'set', values: ['Licences'] } };
    const filters = {
      ...kept,
      priority: { filterType: 'set', values: ['high'] },
      ppe_type: { filterType: 'set', values: ['hardware'] },
    };
    window.sessionStorage.setItem('budget-list-context', JSON.stringify({
      sort: 'priority:ASC', q: '', filters: JSON.stringify(filters), statusScope: 'enabled',
    }));
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    for (const call of nav.calls.filter((c) => c.enabled)) {
      expect(call.sort ?? null).toBeNull();
      expect(JSON.parse(call.filters ?? '{}')).toEqual(kept);
    }
    // The stored list context is written back without them.
    const stored = JSON.parse(window.sessionStorage.getItem('budget-list-context') ?? '{}');
    expect(stored.sort).toBe('');
    expect(JSON.parse(stored.filters)).toEqual(kept);
  });

  it('keeps a sort on an enabled dimension', async () => {
    window.sessionStorage.setItem('budget-list-context', JSON.stringify({
      sort: `analytics_${NATURE}:DESC`, q: '', filters: '', statusScope: 'enabled',
    }));
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await waitFor(() => expect(nav.calls.some((c) => c.enabled)).toBe(true));
    expect(nav.calls.filter((c) => c.enabled).every((c) => c.sort === `analytics_${NATURE}:DESC`)).toBe(true);
  });
});

/** An API error as axios rejects it. */
function apiError(status: number, code: string) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status, data: { code, message: code }, headers: {} } });
}

describe('BudgetLinePage autosave across lines, refusals and a busy server', () => {
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
      if (url === `/budget-lines/${LINE_A}`) return { data: line(LINE_A, 1, 'Line A') };
      if (url === `/budget-lines/${LINE_B}`) return { data: line(LINE_B, 2, 'Line B') };
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
          <MemoryRouter initialEntries={[path]} useTransitions={false}>
            <NavigateProbe />
            <Routes>
              <Route path={`/ops/budget/:ref/:tab`} element={<BudgetLinePage nature={nature} />} />
              <Route path="/ops/budget" element={<div>opex list</div>} />
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
      if (url === `/budget-lines/${LINE_A}` && 'description' in patch) throw apiError(409, 'duplicate');
      return { data: {} };
    });
    const router = renderLines(`/ops/budget/${LINE_A}/overview`);
    await typeInto('Line A stored', 'X');
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // Refused for good: the message shows and the stored text is back.
    expect(await screen.findByText('errors:duplicate')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Line A stored')).toBeInTheDocument();

    act(() => { router.navigate(`/ops/budget/${LINE_B}/overview`); });
    await typeInto('Line B notes', 'Line B notes, edited');
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(mocked.patch.mock.calls).toEqual([
      [`/budget-lines/${LINE_A}`, { description: 'X', base: { description: 'Line A stored' } }],
      [`/budget-lines/${LINE_B}`, { notes: 'Line B notes, edited', base: { notes: 'Line B notes' } }],
    ]);
  });

  it('sends a busy edit of line A to line A, never to line B, once the server answers', async () => {
    let busy = true;
    mocked.patch.mockImplementation(async () => {
      if (busy) throw apiError(503, 'busy');
      return { data: {} };
    });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const router = renderLines(`/ops/budget/${LINE_A}/overview`);
    await typeInto('Line A notes', 'A edited');
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1), { timeout: 3000 });
    // Three retries by itself, then kept and shown as not saved yet.
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });
    expect(mocked.patch).toHaveBeenCalledTimes(4);
    expect(await screen.findByText('errors:notSavedYet')).toBeInTheDocument();

    // The user goes to line B another way (no flush): the edit for A stays bound to A.
    busy = false;
    act(() => { router.navigate(`/ops/budget/${LINE_B}/overview`); });
    await typeInto('Line B notes', 'B edited');
    await waitFor(() => expect(mocked.patch.mock.calls.filter(([url]) => url === `/budget-lines/${LINE_B}`)).toHaveLength(1), { timeout: 3000 });
    const sent = mocked.patch.mock.calls.slice(4);
    expect(sent).toContainEqual([`/budget-lines/${LINE_A}`, { notes: 'A edited', base: { notes: 'Line A notes' } }]);
    expect(sent).toContainEqual([`/budget-lines/${LINE_B}`, { notes: 'B edited', base: { notes: 'Line B notes' } }]);
    expect(sent).toHaveLength(2);
  });

  it('asks before leaving while the server keeps the edit busy, then drops it for good', async () => {
    mocked.patch.mockRejectedValue(apiError(503, 'busy'));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderLines(`/ops/budget/${LINE_A}/overview`);
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

describe('BudgetLinePage edit conflicts (lot 3C)', () => {
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
    vi.setSystemTime(CHANGES_DAY);
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
          <MemoryRouter initialEntries={[path]} useTransitions={false}>
            <NavigateProbe />
            <LocationProbe />
            <Routes>
              <Route path={`/ops/budget/:ref/:tab`} element={<BudgetLinePage nature={nature} />} />
              <Route path="/ops/budget" element={<div>opex list</div>} />
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
    const router = renderLines(`/ops/budget/${LINE_A}/overview`);
    await screen.findByDisplayValue('Line A notes');
    stored[LINE_A].notes = 'Notes from Marie';
    const notes = await typeInto('Line A notes', 'My notes');
    await screen.findByTestId('edit-conflict-notes', undefined, { timeout: 3000 });
    expect(mocked.patch.mock.calls[0]).toEqual([`/budget-lines/${LINE_A}`, { notes: 'My notes', base: { notes: 'Line A notes' } }]);
    return { router, notes };
  }

  const path = () => screen.getByTestId('location').getAttribute('data-path');

  it('shows the conflict, keeps the user\'s text through the reload, and applies it over theirs on request', async () => {
    const { notes } = await conflictOnNotes();
    // The line reloads (Marie's notes are stored), the box keeps the user's text.
    await waitFor(() => expect(mocked.get.mock.calls.filter(([url]) => url === `/budget-lines/${LINE_A}`).length).toBeGreaterThanOrEqual(2));
    expect(notes).toHaveValue('My notes');
    expect(screen.queryByText('opex.editor.failedToSave')).toBeNull();
    expect(mocked.patch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'editConflict.applyMine: opex.fields.notes' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    expect(mocked.patch.mock.calls[1]).toEqual([`/budget-lines/${LINE_A}`, { notes: 'My notes', base: { notes: 'Notes from Marie' } }]);
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
    renderLines(`/ops/budget/${LINE_A}/overview`);
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
    renderLines(`/ops/budget/${LINE_A}/overview`);
    await screen.findByDisplayValue('Line A notes');
    // Another window disabled the line meanwhile (its own clock's now).
    stored[LINE_A].disabled_at = '2026-10-02T12:00:00.000Z';
    fireEvent.click(screen.getByRole('button', { name: 'disable line' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    expect(mocked.patch.mock.calls[0][1]).toEqual({ status: 'disabled' });
    await settleSaves();
    expect(screen.queryByTestId('edit-conflict-disabled_at')).toBeNull();
  });

  it('choosing the status shown sends nothing and keeps a future end of validity; disabling sends the status alone', async () => {
    stored[LINE_A].disabled_at = '2031-10-16T14:37:12.000Z';
    renderLines(`/ops/budget/${LINE_A}/overview`);
    await screen.findByDisplayValue('Line A notes');
    fireEvent.click(screen.getByRole('button', { name: 'enable line' }));
    await settleSaves();
    expect(mocked.patch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'disable line' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    expect(mocked.patch.mock.calls[0][1]).toEqual({ status: 'disabled' });
  });

  it('an end of validity set to what the line already has sends nothing', async () => {
    renderLines(`/ops/budget/${LINE_A}/overview`);
    await screen.findByDisplayValue('Line A notes');
    fireEvent.click(screen.getByRole('button', { name: 'clear end of validity' }));
    await settleSaves();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('two ends of validity on the same day show their time', async () => {
    renderLines(`/ops/budget/${LINE_A}/overview`);
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
    await waitFor(() => expect(path()).toBe(`/ops/budget/${LINE_A}/budget`));
    expect(dialogs.confirm).not.toHaveBeenCalled();
    expect(screen.getByTestId('edit-conflict-notes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'overview tab' }));
    await waitFor(() => expect(path()).toBe(`/ops/budget/${LINE_A}/overview`));
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
    renderLines(`/ops/budget/${LINE_A}/budget`);
    fireEvent.click(await screen.findByRole('button', { name: 'budget refused' }));

    // Another tab of the line: no question, the choice is kept for the line.
    fireEvent.click(screen.getByRole('button', { name: 'overview tab' }));
    await waitFor(() => expect(path()).toBe(`/ops/budget/${LINE_A}/overview`));
    expect(dialogs.confirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'budget tab' }));
    expect(await screen.findByTestId('budget-waiting')).toHaveTextContent('Budget');
    fireEvent.click(screen.getByRole('button', { name: 'overview tab' }));
    await waitFor(() => expect(path()).toBe(`/ops/budget/${LINE_A}/overview`));

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
    act(() => { router.navigate('/ops/budget'); });
    expect(await screen.findByText('opex list')).toBeInTheDocument();
    expect(dialogs.confirm).not.toHaveBeenCalled();
    act(() => { router.navigate(`/ops/budget/${LINE_A}/overview`); });
    expect(await screen.findByTestId('edit-conflict-notes')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('My notes')).toBeInTheDocument();
    await settleSaves();
    expect(mocked.patch).toHaveBeenCalledTimes(1);
  });

  it('a save answered with a conflict once the page went is kept for the next visit', async () => {
    const router = renderLines(`/ops/budget/${LINE_A}/overview`);
    await screen.findByDisplayValue('Line A notes');
    stored[LINE_A].notes = 'Notes from Marie';
    await typeInto('Line A notes', 'Typed before leaving');
    // Gone before the typing pause: the page sends the text as it unmounts, the answer is a 409.
    act(() => { router.navigate('/ops/budget'); });
    expect(await screen.findByText('opex list')).toBeInTheDocument();
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    await settleSaves();
    act(() => { router.navigate(`/ops/budget/${LINE_A}/overview`); });
    expect(await screen.findByTestId('edit-conflict-notes')).toBeInTheDocument();
    expect(await screen.findByDisplayValue('Typed before leaving')).toBeInTheDocument();
  });

  it('never carries a conflict of line A to line B, names line A there, and opens it without a question', async () => {
    const { router } = await conflictOnNotes();
    // Another way to line B (no flush): no banner there, B's edit goes to B alone.
    act(() => { router.navigate(`/ops/budget/${LINE_B}/overview`); });
    await typeInto('Line B notes', 'B edited');
    expect(screen.queryByTestId('edit-conflict-notes')).toBeNull();
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2), { timeout: 3000 });
    expect(mocked.patch.mock.calls[1]).toEqual([`/budget-lines/${LINE_B}`, { notes: 'B edited', base: { notes: 'Line B notes' } }]);
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
      renderLines(`/ops/budget/${LINE_A}/overview`);
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

describe('BudgetLinePage others\' changes (lot 3G)', () => {
  const LINE = 'aaaaaaaa-0000-4000-8000-0000000000a1';
  const YEAR = new Date().getFullYear();
  // What the server holds: the line with its counter, who wrote it, and the year's version counter.
  let stored: Record<string, unknown> = {};
  let author: { id: string; name: string } | null = null;
  let budgetRev = 3;
  const MARIE = { id: 'marie', name: 'Marie Dupont' };
  /** Someone else's write: the counter moves, the meta names them. */
  const othersWrite = (fields: Record<string, unknown>, by: { id: string; name: string } | null = MARIE) => {
    Object.assign(stored, fields, { row_version: Number(stored.row_version) + 1 });
    author = by;
  };
  const detailReads = () => mocked.get.mock.calls.filter(([url]) => url === `/budget-lines/${LINE}`).length;
  const metaReads = () => mocked.get.mock.calls.filter(([url]) => url === `${BUDGET_NATURE_CONFIG[nature].itemsApi}/${LINE}/meta`).length;

  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    dialogs.confirm.mockReset();
    budgetStandIn.rev = 3;
    budgetStandIn.reloads = 0;
    budgetStandIn.typed = false;
    budgetStandIn.failReload = false;
    budgetRev = 3;
    author = null;
    stored = {
      id: LINE, item_number: 1, product_name: 'Line A', notes: 'Start', description: 'About', supplier_id: 'supplier-1',
      currency: 'EUR', effective_start: '2026-01-01', paying_company_id: 'company-1', account_id: 'account-1', row_version: 5,
    };
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/budget-lines/${LINE}`) return { data: { ...stored } };
      if (url === `${BUDGET_NATURE_CONFIG[nature].itemsApi}/${LINE}/meta`) {
        return {
          data: {
            id: LINE, row_version: stored.row_version, changed_by: author, changed_at: '2026-10-02T12:02:00.000Z',
            versions: [{ id: 'v1', budget_year: YEAR, budget_rev: budgetRev, changed_by: MARIE, changed_at: '2026-10-02T12:03:00.000Z' }],
          },
        };
      }
      return { data: {} };
    });
    // A save the server compares with the stored value (lot 3C), and answers with the counter it left.
    mocked.patch.mockImplementation(async (_url: string, body: Record<string, unknown>) => {
      const { base = {}, ...patch } = body as { base?: Record<string, unknown> } & Record<string, unknown>;
      const conflicts = Object.keys(patch)
        .filter((field) => field in base && base[field] !== (stored[field] ?? null) && patch[field] !== (stored[field] ?? null))
        .map((field) => ({
          field, base: base[field], current: stored[field] ?? null, mine: patch[field], labels: { base: null, current: null, mine: null },
          changed_by: MARIE, changed_at: '2026-10-02T12:02:00.000Z',
        }));
      if (conflicts.length > 0) {
        throw Object.assign(new Error('HTTP 409'), { response: { status: 409, headers: {}, data: { code: 'edit_conflict', conflicts, row_version: stored.row_version } } });
      }
      Object.assign(stored, patch, { row_version: Number(stored.row_version) + 1 });
      author = { id: 'me', name: 'Me' };
      return { data: { ...stored } };
    });
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(CHANGES_DAY);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /** The poll's tick: the tab becomes visible again, the meta is read at once. */
  async function poll() {
    const before = metaReads();
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(metaReads()).toBe(before + 1));
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
  }
  async function settleSaves() {
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
  }
  async function typeInto(currentValue: string, value: string) {
    const field = await screen.findByDisplayValue(currentValue);
    await waitFor(() => {
      fireEvent.change(field, { target: { value } });
      expect(field).toHaveValue(value);
    });
    return field;
  }

  it('reads the meta every 30 seconds while the line is shown', async () => {
    renderAt(`/ops/budget/${LINE}/overview`);
    await screen.findByDisplayValue('Start');
    expect(metaReads()).toBe(0);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    await waitFor(() => expect(metaReads()).toBe(1));
  });

  it('idle: someone else\'s change is shown in place, with who changed it', async () => {
    renderAt(`/ops/budget/${LINE}/overview`);
    const notes = await screen.findByDisplayValue('Start');
    othersWrite({ notes: 'Notes from Marie' });
    const reads = detailReads();
    await poll();
    await waitFor(() => expect(notes).toHaveValue('Notes from Marie'));
    expect(detailReads()).toBe(reads + 1);
    expect(screen.getByTestId('others-changes-notice')).toHaveTextContent('othersChanges.changedByAt');
    expect(screen.queryByTestId('others-changes-outdated')).toBeNull();
  });

  it('the page\'s own saves say nothing', async () => {
    renderAt(`/ops/budget/${LINE}/overview`);
    await typeInto('Start', 'My notes');
    await settleSaves();
    expect(mocked.patch).toHaveBeenCalledTimes(1);
    expect(stored.row_version).toBe(6);
    const reads = detailReads();
    await poll();
    expect(detailReads()).toBe(reads);
    expect(screen.queryByTestId('others-changes-notice')).toBeNull();
    expect(screen.queryByTestId('others-changes-outdated')).toBeNull();
  });

  it('the user\'s own change in another window says so', async () => {
    renderAt(`/ops/budget/${LINE}/overview`);
    await screen.findByDisplayValue('Start');
    othersWrite({ notes: 'From my other window' }, { id: 'me', name: 'Me' });
    await poll();
    expect(await screen.findByTestId('others-changes-notice')).toHaveTextContent('othersChanges.changedByYouAt');
  });

  it('typing in a field: nothing is refreshed, the badge shows; Reload shows the change and keeps the text typed', async () => {
    renderAt(`/ops/budget/${LINE}/overview`);
    const description = await screen.findByDisplayValue('About');
    description.focus();
    othersWrite({ notes: 'Notes from Marie' });
    const reads = detailReads();
    await poll();
    expect(await screen.findByTestId('others-changes-outdated')).toHaveTextContent('othersChanges.badge');
    expect(detailReads()).toBe(reads);
    expect(screen.getByDisplayValue('Start')).toBeInTheDocument();

    // The user types on, then reloads: Marie's notes show, the text typed stays.
    fireEvent.change(description, { target: { value: 'About, typed' } });
    fireEvent.click(screen.getByRole('button', { name: 'othersChanges.reload' }));
    await waitFor(() => expect(screen.getByDisplayValue('Notes from Marie')).toBeInTheDocument());
    expect(description).toHaveValue('About, typed');
    expect(screen.queryByTestId('others-changes-outdated')).toBeNull();
    expect(screen.getByTestId('others-changes-notice')).toHaveTextContent('othersChanges.changedByAt');
    // Then it is saved, from the value the user started from: it meets the conflict check if needed.
    await settleSaves();
    expect(mocked.patch.mock.calls[mocked.patch.mock.calls.length - 1]?.[1]).toEqual({ description: 'About, typed', base: { description: 'About' } });
  });

  it('a choice waiting: no mark beside its banner, nothing refreshed; once the choice is made, the change is said', async () => {
    renderAt(`/ops/budget/${LINE}/overview`);
    await screen.findByDisplayValue('Start');
    stored.notes = 'Notes from Marie';
    const notes = await typeInto('Start', 'My notes');
    await screen.findByTestId('edit-conflict-notes', undefined, { timeout: 3000 });
    (document.activeElement as HTMLElement | null)?.blur();
    await settleSaves();
    othersWrite({ supplier_id: 'supplier-2' });
    const reads = detailReads();
    await poll();
    // The banner already says someone else changed the line: no mark beside it, and nothing moves.
    expect(screen.queryByTestId('others-changes-outdated')).toBeNull();
    expect(detailReads()).toBe(reads);
    expect(notes).toHaveValue('My notes');
    expect(mocked.patch).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'editConflict.keepTheirs: opex.fields.notes' }));
    // The focus went back to the notes (lot 3C): the user leaves them.
    (document.activeElement as HTMLElement | null)?.blur();
    await poll();
    expect(await screen.findByTestId('others-changes-notice')).toHaveTextContent('othersChanges.changedByAt');
    expect(screen.queryByTestId('others-changes-outdated')).toBeNull();
  });

  it('Budget tab: the year\'s version moved, the tab reloads in place; a cell typed gets the badge; a column waiting for a choice gets neither', async () => {
    renderAt(`/ops/budget/${LINE}/budget`);
    await waitFor(() => expect(screen.getByTestId('budget-waiting')).toBeInTheDocument());
    budgetRev = 4;
    await poll();
    await waitFor(() => expect(budgetStandIn.reloads).toBe(1));
    expect(await screen.findByTestId('others-changes-notice')).toHaveTextContent('othersChanges.changedByAt');

    fireEvent.click(screen.getByRole('button', { name: 'budget typed' }));
    budgetRev = 5;
    await poll();
    expect(await screen.findByTestId('others-changes-outdated')).toBeInTheDocument();
    expect(budgetStandIn.reloads).toBe(1);
    fireEvent.click(screen.getByRole('button', { name: 'othersChanges.reload' }));
    await waitFor(() => expect(budgetStandIn.reloads).toBe(2));
    await waitFor(() => expect(screen.queryByTestId('others-changes-outdated')).toBeNull());

    // The column's conflict banner already says it: no mark, nothing reloaded.
    fireEvent.click(screen.getByRole('button', { name: 'budget refused' }));
    budgetRev = 6;
    await poll();
    expect(screen.queryByTestId('others-changes-outdated')).toBeNull();
    expect(budgetStandIn.reloads).toBe(2);
    expect(screen.getByTestId('budget-waiting')).toHaveTextContent('Budget');
  });

  it('a reload that fails is not counted as shown: the badge stays, and the next read tries again', async () => {
    renderAt(`/ops/budget/${LINE}/budget`);
    await waitFor(() => expect(screen.getByTestId('budget-waiting')).toBeInTheDocument());
    budgetStandIn.failReload = true;
    budgetRev = 4;
    await poll();
    expect(screen.queryByTestId('others-changes-notice')).toBeNull();
    budgetStandIn.failReload = false;
    await poll();
    await waitFor(() => expect(budgetStandIn.reloads).toBe(1));
    expect(await screen.findByTestId('others-changes-notice')).toHaveTextContent('othersChanges.changedByAt');
  });

  it('a detail that cannot be read again is not counted as shown', async () => {
    renderAt(`/ops/budget/${LINE}/overview`);
    const notes = await screen.findByDisplayValue('Start');
    othersWrite({ notes: 'Notes from Marie' });
    const served = mocked.get.getMockImplementation()! as (...args: any[]) => any;
    mocked.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === `/budget-lines/${LINE}`) throw Object.assign(new Error('HTTP 503'), { response: { status: 503, headers: {}, data: { code: 'busy' } } });
      return served(url, config);
    });
    await poll();
    expect(screen.queryByTestId('others-changes-notice')).toBeNull();
    mocked.get.mockImplementation(served);
    await poll();
    await waitFor(() => expect(notes).toHaveValue('Notes from Marie'));
    expect(screen.getByTestId('others-changes-notice')).toHaveTextContent('othersChanges.changedByAt');
  });

  it('a line deleted elsewhere says so, and is not read again', async () => {
    renderAt(`/ops/budget/${LINE}/overview`);
    await screen.findByDisplayValue('Start');
    const served = mocked.get.getMockImplementation()! as (...args: any[]) => any;
    mocked.get.mockImplementation(async (url: string, config?: unknown) => {
      if (url === `${BUDGET_NATURE_CONFIG[nature].itemsApi}/${LINE}/meta`) throw Object.assign(new Error('HTTP 404'), { response: { status: 404, headers: {}, data: {} } });
      return served(url, config);
    });
    await poll();
    expect(await screen.findByTestId('others-changes-gone')).toHaveTextContent('othersChanges.deleted');
    const reads = metaReads();
    await act(async () => { await vi.advanceTimersByTimeAsync(65_000); });
    expect(metaReads()).toBe(reads);
  });

  it('back on a line kept from an earlier visit: the counter is the one read again, so an older change is not said', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const ui = (path: string) => (
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter initialEntries={[path]} useTransitions={false}>
            <Routes>
              <Route path={`/ops/budget/:ref/:tab`} element={<BudgetLinePage nature={nature} />} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>
    );
    const first = render(ui(`/ops/budget/${LINE}/overview`));
    await screen.findByDisplayValue('Start');
    first.unmount();
    // Marie changes the line while it is closed; the copy kept goes stale.
    othersWrite({ notes: 'Notes from Marie' });
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    render(ui(`/ops/budget/${LINE}/overview`));
    await screen.findByDisplayValue('Notes from Marie');
    await poll();
    expect(screen.queryByTestId('others-changes-notice')).toBeNull();
  });

  it('back on the window, a stale line is read again only when nothing is pending', async () => {
    renderAt(`/ops/budget/${LINE}/overview`);
    const notes = await screen.findByDisplayValue('Start');
    await act(async () => { await vi.advanceTimersByTimeAsync(31_000); });
    othersWrite({ notes: 'Notes from Marie' });
    await poll();
    await waitFor(() => expect(notes).toHaveValue('Notes from Marie'));
    // The focus refetch or the poll's refresh: either way, said once.
    expect(screen.getByTestId('others-changes-notice')).toHaveTextContent('othersChanges.changedByAt');
  });
});


describe('BudgetLinePage cost center across lines', () => {
  const LINE_A = 'aaaaaaaa-0000-4000-8000-0000000000c1';
  const LINE_B = 'bbbbbbbb-0000-4000-8000-0000000000c2';
  // Each line names its cost center in the detail (`references.cost_center`).
  const ref = (id: string, code: string) => ({
    id, code, name: `Centre ${code}`, kind: 'cost_center', status: 'enabled',
    company_id: 'company-1', company_name: 'Company', owner_user_id: 'user-1', owner_name: 'Ada Holder',
  });
  const line = (id: string, n: number, costCenter: { id: string; code: string }) => ({
    id, item_number: n, product_name: `Line ${n}`, description: '', notes: '',
    currency: 'EUR', effective_start: '2026-01-01', paying_company_id: 'company-1', account_id: 'account-1',
    cost_center_id: costCenter.id, references: { cost_center: costCenter },
  });

  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `/budget-lines/${LINE_A}`) return { data: line(LINE_A, 1, ref('cc-a', 'CC-A')) };
      if (url === `/budget-lines/${LINE_B}`) return { data: line(LINE_B, 2, ref('cc-b', 'CC-B')) };
      return { data: {} };
    });
  });

  it('opens line A then line B, each with its own cost center, without loading the tree', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const router: { navigate: NavigateFunction | null } = { navigate: null };
    function NavigateProbe() {
      router.navigate = useNavigate();
      return null;
    }
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter initialEntries={[`/ops/budget/${LINE_A}/overview`]} useTransitions={false}>
            <NavigateProbe />
            <Routes>
              <Route path={`/ops/budget/:ref/:tab`} element={<BudgetLinePage nature={nature} />} />
            </Routes>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    const shown = (id: string) => document.querySelector(`[data-mode="edit"][data-cost-center="${id}"]`);
    await waitFor(() => expect(shown('cc-a')).not.toBeNull());
    act(() => { router.navigate!(`/ops/budget/${LINE_B}/overview`); });
    await waitFor(() => expect(shown('cc-b')).not.toBeNull());
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)); });
    expect(mocked.get.mock.calls.filter(([url]) => String(url).startsWith('/cost-centers'))).toEqual([]);
  });
});

describe('BudgetLinePage required dimensions before leaving (lot D2)', () => {
  const AXES = [
    { id: 'axis-default', code: 'default', name: null, description: null, sort_order: 0, is_default: true, applies_to: null, required: false, status: 'enabled', disabled_at: null },
    { id: 'axis-nature', code: 'nature', name: 'Nature', description: null, sort_order: 1, is_default: false, applies_to: null, required: true, status: 'enabled', disabled_at: null },
    // Required for CAPEX lines only, or disabled: never asked here.
    { id: 'axis-other', code: 'other', name: 'Other', description: null, sort_order: 2, is_default: false, applies_to: lineNature === 'opex' ? 'capex' : 'opex', required: true, status: 'enabled', disabled_at: null },
    { id: 'axis-old', code: 'old', name: 'Old', description: null, sort_order: 3, is_default: false, applies_to: null, required: true, status: 'disabled', disabled_at: '2020-01-01T00:00:00.000Z' },
  ];

  beforeEach(() => {
    auth.canEdit = true;
    mocked.get.mockReset();
    mocked.patch.mockReset();
    dialogs.confirm.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/analytics-axes') return { data: { items: AXES } };
      if (url === `/budget-lines/${ITEM_ID}`) {
        return {
          data: {
            id: ITEM_ID, item_number: 7, product_name: 'Monitoring', currency: 'EUR', effective_start: '2026-01-01',
            paying_company_id: 'company-1', account_id: 'account-1', analytics_values: [], notes: 'Monitoring notes',
          },
        };
      }
      return { data: {} };
    });
    mocked.patch.mockResolvedValue({ data: {} });
  });
  afterEach(() => {
    auth.canEdit = true;
    vi.useRealTimers();
  });

  async function openLine() {
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await waitFor(() => expect(document.querySelector('[data-mode="edit"]')).not.toBeNull());
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/analytics-axes'));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  }

  it('asks after a change when a required dimension is empty: Stay keeps the line, Leave anyway leaves', async () => {
    await openLine();
    fireEvent.click(screen.getByRole('button', { name: 'pick build' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    expect(await screen.findByText(`${nature}.editor.requiredLeaveMessage`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: `${nature}.editor.requiredLeaveStay` }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.queryByTestId('list-page')).not.toBeInTheDocument();
    // The unsaved-work question is not the one asked.
    expect(dialogs.confirm).not.toHaveBeenCalled();

    // The back link asks the same; the app's links ask through the leave guard.
    fireEvent.click(screen.getByRole('button', { name: 'back to list' }));
    fireEvent.click(await screen.findByRole('button', { name: `${nature}.editor.requiredLeaveConfirm` }));
    expect(await screen.findByTestId('list-page')).toBeInTheDocument();
  });

  it('asks one question per move: leaving without saving drops the edits and does not ask about the dimension', async () => {
    await openLine();
    mocked.patch.mockRejectedValue(apiError(503, 'busy'));
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const notes = await screen.findByDisplayValue('Monitoring notes');
    fireEvent.change(notes, { target: { value: 'never saved' } });
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1), { timeout: 3000 });
    await act(async () => { await vi.advanceTimersByTimeAsync(8_000); });

    dialogs.confirm.mockResolvedValueOnce(true);
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    expect(await screen.findByTestId('list-page')).toBeInTheDocument();
    expect(dialogs.confirm).toHaveBeenCalledTimes(1);
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'common:autosave.leaveTitle' }));
    expect(screen.queryByText(`${nature}.editor.requiredLeaveMessage`)).not.toBeInTheDocument();
  });

  it('asks through the leave guard of the app\'s links', async () => {
    await openLine();
    fireEvent.click(screen.getByRole('button', { name: 'pick build' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    let left: Promise<boolean> | null = null;
    act(() => { left = confirmLeave(); });
    fireEvent.click(await screen.findByRole('button', { name: `${nature}.editor.requiredLeaveConfirm` }));
    await expect(left).resolves.toBe(true);
  });

  it('never asks without a change', async () => {
    await openLine();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    expect(await screen.findByTestId('list-page')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('never asks once the required value is picked', async () => {
    await openLine();
    fireEvent.click(screen.getByRole('button', { name: 'pick nature value' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    expect(await screen.findByTestId('list-page')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('never asks a user who cannot edit the line', async () => {
    auth.canEdit = false;
    await openLine();
    // Read only for them: the pick sends nothing.
    fireEvent.click(screen.getByRole('button', { name: 'pick build' }));
    expect(mocked.patch).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    expect(await screen.findByTestId('list-page')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('BudgetLinePage change type (lot M)', () => {
  let detail: Record<string, unknown>;
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.patch.mockReset();
    auth.canEdit = true;
    detail = {
      id: ITEM_ID, item_number: 7, product_name: 'Monitoring', notes: 'Renewal', row_version: 3,
      paying_company_id: 'company-1', account_id: 'account-1', currency: 'EUR', effective_start: '2026-01-01',
    };
    mocked.get.mockImplementation(async (url: string) => (url === `/budget-lines/${ITEM_ID}` ? { data: detail } : { data: {} }));
    mocked.patch.mockResolvedValue({ data: { row_version: 4 } });
  });
  afterEach(() => { auth.canEdit = true; });

  it('Change type in the properties opens the change of type; once changed, the line opens in its new type', async () => {
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await screen.findByDisplayValue('Renewal');
    fireEvent.click(screen.getByRole('button', { name: 'budget.changeType' }));
    const dialog = await screen.findByTestId('change-type-dialog');
    expect(dialog).toHaveAttribute('data-nature', nature);
    expect(dialog).toHaveAttribute('data-line', ITEM_ID);
    fireEvent.click(screen.getByRole('button', { name: 'confirm type change' }));
    expect(await screen.findByTestId('capex-page')).toHaveAttribute('data-path', `/ops/budget/BL-7/overview`);
  });

  it('saves the notes still typed before the dialog reads the line', async () => {
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    const notes = await screen.findByDisplayValue('Renewal');
    fireEvent.change(notes, { target: { value: 'Renewal in March' } });
    fireEvent.click(screen.getByRole('button', { name: 'budget.changeType' }));
    await screen.findByTestId('change-type-dialog');
    expect(mocked.patch).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}`, { notes: 'Renewal in March', base: { notes: 'Renewal' } });
  });

  it('is not offered without the budget member level', async () => {
    auth.canEdit = false;
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    await screen.findByDisplayValue('Renewal');
    expect(screen.queryByRole('button', { name: 'budget.changeType' })).toBeNull();
  });

  it('names the line that replaces this one; it opens in its own type', async () => {
    detail = { ...detail, lineage: { predecessor: null, successor: { id: 'line-2', reference: 'BL-9', nature: otherNature(), from_year: 2026 } } };
    renderAt(`/ops/budget/${ITEM_ID}/overview`);
    expect(await screen.findByText(/shared\.lineage\.replacedBy/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'BL-9' }));
    expect(await screen.findByTestId('capex-page')).toHaveAttribute('data-path', `/ops/budget/BL-9/overview`);
  });
});

describe('native contract and Type', () => {
  let stored: Record<string, unknown>;
  beforeEach(() => {
    auth.canEdit = true;
    mocked.get.mockReset(); mocked.patch.mockReset(); mocked.post.mockReset();
    stored = { id: ITEM_ID, item_number: 127, nature, product_name: 'Investment', description: 'Long description', notes: 'Private notes', currency: 'EUR' };
    mocked.get.mockImplementation(async (url: string) => {
      if (url.startsWith('/budget-lines/')) return { data: stored };
      return { data: {} };
    });
    mocked.patch.mockImplementation(async (_url, body) => { stored = { ...stored, ...body }; return { data: stored }; });
  });

  it.each(['BL-127', '127', 'legacy', ITEM_ID])('reads the native detail by %s and displays its BL reference', async (input) => {
    const ref = input === 'legacy' ? `${legacyPrefix()}-7` : input;
    renderAt(`/ops/budget/${ref}/overview`);
    await screen.findByDisplayValue('Long description');
    expect(mocked.get).toHaveBeenCalledWith(`/budget-lines/${ref}`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(screen.getByTestId('line-reference')).toHaveTextContent('BL-127');
    expect(screen.getByText('budget.title')).toBeInTheDocument();
    expect(document.title).toBe('BL-127 · Investment | KANAP');
    expect(mocked.get.mock.calls.some(([url]) => url === `${BUDGET_NATURE_CONFIG[nature].itemsApi}/${ref}`)).toBe(false);
  });

  it('saves title, description and notes under their native keys and reloads them', async () => {
    const view = renderAt(`/ops/budget/BL-127/overview`);
    await screen.findByDisplayValue('Long description');
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}`, { product_name: 'Monitoring', base: { product_name: 'Investment' } }));
    fireEvent.change(screen.getByDisplayValue('Long description'), { target: { value: 'Description kept' } });
    fireEvent.change(screen.getByDisplayValue('Private notes'), { target: { value: 'Notes kept' } });
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}`, expect.objectContaining({ description: 'Description kept', notes: 'Notes kept' })));
    expect(mocked.patch.mock.calls.every(([url]) => url === `/budget-lines/${ITEM_ID}`)).toBe(true);
    view.unmount();
    renderAt(`/ops/budget/BL-127/overview`);
    await screen.findByDisplayValue('Description kept');
    expect(screen.getByDisplayValue('Notes kept')).toBeInTheDocument();
  });

  it('offers the same change-type action in the drawer and the menu', async () => {
    renderAt(`/ops/budget/BL-127/overview`);
    await screen.findByDisplayValue('Long description');
    expect(screen.getByTestId('line-type')).toHaveTextContent(nature);
    fireEvent.click(screen.getByRole('button', { name: 'budget.changeType' }));
    expect(await screen.findByTestId('change-type-dialog')).toHaveAttribute('data-nature', nature);
  });

  it('hides the drawer change-type action without the member permission', async () => {
    auth.canEdit = false;
    renderAt(`/ops/budget/BL-127/overview`);
    await screen.findByDisplayValue('Long description');
    expect(screen.queryByRole('button', { name: 'budget.changeType' })).not.toBeInTheDocument();
  });

  it('defaults the create Type to the route and changes it with the query preserved', async () => {
    renderAt(`/ops/budget/new/overview?list=budget&year=2027&sort=product_name:ASC`, '/ops/budget?origin=history');
    expect(screen.getByRole('combobox', { name: 'budget.type' })).toHaveValue(nature);
    fireEvent.change(screen.getByRole('combobox', { name: 'budget.type' }), { target: { value: otherNature() } });
    const target = await screen.findByTestId('create-target');
    expect(target).toHaveAttribute('data-path', `/ops/budget/new`);
    expect(new URLSearchParams(target.getAttribute('data-search') ?? '').get('nature')).toBe(otherNature());
    const search = new URLSearchParams(target.getAttribute('data-search') ?? '');
    expect(search.get('year')).toBe('2027'); expect(search.get('list')).toBe('budget'); expect(search.get('sort')).toBe('product_name:ASC');
    fireEvent.click(screen.getByRole('button', { name: 'browser back' }));
    const list = await screen.findByTestId('list-page');
    expect(new URLSearchParams(list.getAttribute('data-search') ?? '').get('origin')).toBe('history');
  });

  it('creates through the native API with the route nature and all three texts', async () => {
    mocked.post.mockResolvedValue({ data: { id: 'new-id' } });
    renderAt(`/ops/budget/new/overview`);
    fireEvent.click(screen.getByRole('button', { name: 'set title' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick company' }));
    fireEvent.click(screen.getByRole('button', { name: 'pick account' }));
    const texts = screen.getAllByRole('textbox');
    fireEvent.change(texts[0], { target: { value: 'Created description' } });
    fireEvent.change(texts[1], { target: { value: 'Created notes' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/budget-lines', expect.objectContaining({ nature, product_name: 'Monitoring', description: 'Created description', notes: 'Created notes' })));
  });

  it('removes the internal list marker when returning to the budget list', async () => {
    renderAt(`/ops/budget/BL-127/overview?list=budget&year=2027`);
    await screen.findByDisplayValue('Long description');
    fireEvent.click(screen.getByRole('button', { name: 'back to list' }));
    const list = await screen.findByTestId('list-page');
    expect(new URLSearchParams(list.getAttribute('data-search') ?? '').has('list')).toBe(false);
  });
});

// The workspace as the app mounts it: the route reads the line's type, then the page shows the line.
describe('BudgetLinePage type changed in place', () => {
  let stored: Record<string, unknown>;
  beforeEach(() => {
    auth.canEdit = true;
    mocked.get.mockReset(); mocked.patch.mockReset(); mocked.post.mockReset();
    stored = {
      id: ITEM_ID, item_number: 7, nature, product_name: 'Monitoring', notes: 'Renewal', row_version: 3,
      paying_company_id: 'company-1', account_id: `account-${nature}`, currency: 'EUR', effective_start: '2026-01-01',
    };
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/budget-lines/resolve/BL-7') return { data: { id: stored.id, nature: stored.nature, reference: 'BL-7' } };
      if (url === '/budget-lines/BL-7') return { data: stored };
      return { data: {} };
    });
  });

  it('shows the new type and the fields that follow it once the change ends, without a reload', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter initialEntries={['/ops/budget/BL-7/overview']} useTransitions={false}>
            <React.Suspense fallback={null}>
              <Routes>
                <Route path="/ops/budget/:ref/:tab" element={<BudgetLineRoute />} />
              </Routes>
            </React.Suspense>
          </MemoryRouter>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await screen.findByDisplayValue('Renewal');
    expect(screen.getByTestId('line-type')).toHaveTextContent(nature);
    fireEvent.click(screen.getByRole('button', { name: 'budget.changeType' }));
    await screen.findByTestId('change-type-dialog');
    // The server changed the line in place: same id and reference, the other type and an account of that type.
    const target = otherNature();
    stored = { ...stored, nature: target, account_id: `account-${target}`, row_version: 4 };
    fireEvent.click(screen.getByRole('button', { name: 'confirm type change' }));
    await waitFor(() => expect(screen.getByTestId('line-type')).toHaveTextContent(target));
    await waitFor(() => expect(screen.getByTestId('line-type').parentElement).toHaveAttribute('data-account', `account-${target}`));
    expect(screen.queryByTestId('change-type-dialog')).not.toBeInTheDocument();
  });
});

describe('BudgetLinePage delete', () => {
  const line = {
    id: ITEM_ID, item_number: 7, product_name: 'Monitoring', supplier_id: 'supplier-1', notes: 'Renewal',
    paying_company_id: 'company-1', account_id: 'account-1', currency: 'EUR', effective_start: '2026-01-01',
  };

  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    mocked.delete.mockReset();
    dialogs.confirm.mockReset();
    dialogs.confirm.mockResolvedValue(true);
    dialogs.alert.mockReset();
    dialogs.alert.mockResolvedValue(undefined);
    mocked.get.mockImplementation(async (url: string) => (
      url === `/budget-lines/${ITEM_ID}` ? { data: line } : { data: {} }
    ));
    mocked.post.mockResolvedValue({ data: { refused: [] } });
    mocked.delete.mockResolvedValue({ data: { deleted: [ITEM_ID], failed: [] } });
    mocked.patch.mockResolvedValue({ data: {} });
  });

  async function openLine() {
    const view = renderAt(`/ops/budget/${ITEM_ID}/overview?q=monitor&list=budget`);
    await screen.findByDisplayValue('Renewal');
    return view;
  }

  it('hides the icon without budget admin', async () => {
    auth.admin = false;
    await openLine();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).not.toBeInTheDocument();
    expect(screen.getByDisplayValue('Renewal')).toBeEnabled();
  });

  it('hides the icon when data access is limited', async () => {
    auth.limited = true;
    await openLine();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).not.toBeInTheDocument();
  });

  it('hides the icon on a new line', () => {
    renderAt('/ops/budget/new/overview');
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).not.toBeInTheDocument();
  });

  it('shows the refusal for a frozen line and does not delete it', async () => {
    mocked.post.mockImplementation(async (url: string) => (
      url === '/budget-lines/delete-check'
        ? { data: { refused: [{ id: ITEM_ID, code: 'BUDGET_LINE_FROZEN', usages: [], params: { column: 'Budget', year: 2026 }, reason: 'English' }] } }
        : { data: {} }
    ));
    await openLine();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({
      title: 'common:delete.recordTitle',
      message: 'errors:BUDGET_LINE_FROZEN',
    })));
    expect(mocked.post).toHaveBeenCalledWith('/budget-lines/delete-check', { ids: [ITEM_ID] });
    expect(mocked.delete).not.toHaveBeenCalled();
    expect(dialogs.confirm).not.toHaveBeenCalled();
    expect(screen.queryByTestId('list-page')).not.toBeInTheDocument();
  });

  it('shows the refusal when the delete itself keeps a frozen line', async () => {
    mocked.delete.mockResolvedValue({
      data: {
        deleted: [],
        failed: [{ id: ITEM_ID, name: 'Monitoring', code: 'BUDGET_LINE_FROZEN', reason: 'English', params: { column: 'Budget', year: 2026 } }],
      },
    });
    await openLine();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(dialogs.alert).toHaveBeenCalledWith(expect.objectContaining({
      message: 'errors:BUDGET_LINE_FROZEN',
    })));
    expect(mocked.delete).toHaveBeenCalledWith('/budget-lines/bulk', { data: { ids: [ITEM_ID] } });
    expect(screen.queryByTestId('list-page')).not.toBeInTheDocument();
  });

  it('deletes the line through the bulk route, drops a pending edit and returns to the list', async () => {
    const { queryClient } = await openLine();
    seedDashboard(queryClient);
    fireEvent.change(screen.getByDisplayValue('Renewal'), { target: { value: 'not saved' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    const list = await screen.findByTestId('list-page');
    expect(mocked.post).toHaveBeenCalledWith('/budget-lines/delete-check', { ids: [ITEM_ID] });
    expect(dialogs.confirm).toHaveBeenCalledWith(expect.objectContaining({
      title: 'common:delete.recordTitle',
      message: 'common:delete.cannotUndo',
      confirmLabel: 'common:buttons.delete',
      intent: 'danger',
    }));
    expect(dialogs.confirm).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'common:autosave.leaveTitle' }));
    expect(mocked.delete).toHaveBeenCalledWith('/budget-lines/bulk', { data: { ids: [ITEM_ID] } });
    const search = new URLSearchParams(list.getAttribute('data-search') ?? '');
    expect(search.get('q')).toBe('monitor');
    expect(search.has('list')).toBe(false);
    expect(mocked.patch).not.toHaveBeenCalled();
    await expectDashboardInvalidated(queryClient);
    await act(async () => { await new Promise((resolve) => { setTimeout(resolve, 900); }); });
    expect(mocked.patch).not.toHaveBeenCalled();
  });
});

});
