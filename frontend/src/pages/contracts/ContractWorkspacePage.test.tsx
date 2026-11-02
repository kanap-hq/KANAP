import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

const navigateMock = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ canEdit: true, canAdmin: true, dataAccess: null as null | Record<string, unknown> }));
// A stable `t`: a new one per render would loop the effects that depend on it.
const i18n = vi.hoisted(() => {
  const t = (key: string, options?: unknown) => {
    const o = options && typeof options === 'object' ? options as Record<string, unknown> : null;
    return o && 'count' in o ? `${key}:${o.count}` : o && 'date' in o ? `${key}:${o.date}` : key;
  };
  return { t, i18n: { language: 'en', resolvedLanguage: 'en' } };
});

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => i18n,
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (_resource: string, level?: string) => (level === 'admin' ? auth.canAdmin : auth.canEdit),
    profile: { id: 'user-1', first_name: 'Ada', last_name: 'Admin' },
    dataAccess: auth.dataAccess,
  }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'fromage' }) }));
vi.mock('../../hooks/useContractNav', () => ({
  useContractNav: () => ({ ids: ['c-1', 'c-2'], index: 0, total: 2, hasPrev: false, hasNext: true, prevId: null, nextId: 'c-2' }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: vi.fn() }) }));
vi.mock('../../components/history/RecordHistoryTab', () => ({
  default: (props: { table: string; recordId: string }) => <div data-testid="record-history">{`${props.table}:${props.recordId}`}</div>,
}));
vi.mock('../../components/MarkdownEditor', () => ({
  default: ({ value, onChange, disabled }: { value: string; onChange: (next: string) => void; disabled?: boolean }) => (
    <textarea aria-label="markdown-editor" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} />
  ),
}));

import api from '../../api';
import ContractWorkspacePage from './ContractWorkspacePage';
import { addMonthsYmd, computeContractTerms, utcTodayYmd } from './contractTerms';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const CONTRACT = {
  id: 'c-1',
  name: 'SAP Maintenance',
  status: 'enabled',
  disabled_at: null,
  company_id: 'co-1',
  supplier_id: 'sup-1',
  owner_user_id: null,
  start_date: '2023-07-01',
  duration_months: 12,
  auto_renewal: true,
  notice_period_months: 6,
  yearly_amount_at_signature: '350000.00',
  currency: 'EUR',
  billing_frequency: 'annual',
  notes: 'Annual renewal on 1 July.',
  created_at: '2026-02-14T10:00:00.000Z',
  updated_at: '2026-10-12T10:00:00.000Z',
  supplier_name: 'SAP',
  company_name: 'Fromage & Co SA',
  owner_name: null,
  links: [{ id: 'l-1', description: 'Vendor portal', url: 'https://me.example.com' }],
  attachments: [{ id: 'a-1', original_filename: 'contract.pdf', size: 2048 }],
};

const NEXT_YEAR = new Date().getFullYear() + 1;

/** `GET /contracts/c-1/budget`: SAP against its two lines, next year's lines not budgeted yet in the second column. */
function coverage(params?: { year: number; column: string }) {
  const year = Number(params?.year ?? NEXT_YEAR);
  const column = params?.column ?? 'planned';
  const planned = column === 'planned';
  const amounts: Record<number, [number, number]> = { [NEXT_YEAR - 1]: [300000, 50000], [NEXT_YEAR]: [300000, 62000] };
  const row = (y: number) => {
    const linked = planned && amounts[y] ? amounts[y][0] + amounts[y][1] : 0;
    const state = !planned || !amounts[y] ? (y === NEXT_YEAR + 1 ? 'not_started' : 'no_line') : linked < 350000 ? 'under' : 'over';
    return { year: y, committed_local: 350000, committed: 350000, linked, gap: linked - 350000, state };
  };
  return {
    year,
    column,
    reporting_currency: 'EUR',
    currency: 'EUR',
    lines: [{ id: 'bl-2', amount: planned ? amounts[year]?.[0] ?? 0 : 0 }, { id: 'bl-9', amount: planned ? amounts[year]?.[1] ?? 0 : 0 }],
    years: [NEXT_YEAR - 1, NEXT_YEAR, NEXT_YEAR + 1].map(row),
  };
}

/** `GET /contracts/c-1/compliance`: the DPA recorded absent, the data location to check, the rest not expected. */
const REASON = { rule: 'personal_data', application: { id: 'app-1', name: 'SAP S/4HANA' }, asset: null, level: null };
const COMPLIANCE = {
  summary: { expected: 2, missing: 1, to_check: 1, state: 'missing' },
  requirements: [
    { requirement: 'gdpr_dpa', expected: true, reasons: [REASON], state: 'absent', reference: 'Annex 4', updated_at: '2026-10-12T10:00:00.000Z', updated_by: { id: 'user-1', name: 'Ada Admin' } },
    { requirement: 'data_location', expected: true, reasons: [REASON, { ...REASON, rule: 'cloud_hosting', level: { axis: 'hostingTypes', code: 'saas', label: 'SaaS' } }], state: null, reference: null, updated_at: null, updated_by: null },
    ...['reversibility', 'exit_plan', 'audit_security'].map((requirement) => ({ requirement, expected: false, reasons: [], state: null, reference: null, updated_at: null, updated_by: null })),
  ],
};

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/ops/contracts/:id/:tab" element={<><ContractWorkspacePage /><LocationProbe /></>} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
  const result = render(tree());
  return { ...result, renderAgain: () => result.rerender(tree()) };
}

describe('ContractWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.canEdit = true;
    auth.canAdmin = true;
    auth.dataAccess = null;
    try { window.localStorage?.clear?.(); } catch { /* no storage in this environment */ }
    mocked.get.mockImplementation(async (url: string, options?: { params?: { year: number; column: string } }) => {
      if (url === '/contracts/c-1') return { data: CONTRACT };
      if (url === '/contracts/c-1/relation-counts') return { data: { budget_lines: 2, relations: 5 } };
      if (url === '/contracts/c-1/tasks') {
        return {
          data: [
            { id: 't-1', item_number: 142, title: 'Decide the renewal', status: 'open', due_date: '2026-12-30', assignee_user_id: null },
            { id: 't-2', item_number: 118, title: 'Old task', status: 'done', due_date: null, assignee_user_id: null },
          ],
        };
      }
      if (url === '/contracts/c-1/budget-lines') {
        return {
          data: {
            items: [
              { id: 'bl-2', nature: 'opex', item_number: 2, product_name: 'S/4HANA maintenance', company_id: 'co-1', company_name: 'Fromage & Co SA' },
              { id: 'bl-9', nature: 'capex', item_number: 9, product_name: 'Upgrade project', company_id: null, company_name: null },
            ],
          },
        };
      }
      if (url === '/contracts/c-1/relations') {
        return {
          data: {
            applications: [{ id: 'app-1', reference: 'APP-1', name: 'SAP S/4HANA', lifecycle: 'active', business_criticality: 'high', status: 'enabled' }],
            assets: [{ id: 'as-1', reference: 'AST-1', name: 'sap-prd-db01', kind: 'physical_server', environment: 'prod', status: 'active' }],
            technologies: [],
            suggestions: [],
          },
        };
      }
      if (url === '/contracts/c-1/links') return { data: [{ id: 'l-1', description: 'Vendor portal', url: 'https://me.example.com', created_at: '2026-10-01T10:00:00.000Z' }] };
      if (url === '/contracts/c-1/attachments') return { data: [{ id: 'a-1', original_filename: 'contract.pdf', size: 2048, uploaded_at: '2026-10-01T10:00:00.000Z' }] };
      if (url === '/contracts/c-1/contacts') return { data: [] };
      if (url === '/budget-columns') {
        return { data: { labels: { planned: null, committed: 'Revised', forecast: null, actual: null, expected_landing: null }, enabled: { planned: true, committed: true, forecast: false, actual: true, expected_landing: true }, group_spread: {}, default_column: 'planned' } };
      }
      if (url === '/contracts/c-1/budget') return { data: coverage(options?.params) };
      if (url === '/contracts/c-1/compliance') return { data: COMPLIANCE };
      if (url === '/currency/settings') return { data: { reportingCurrency: 'EUR', defaultSpendCurrency: 'EUR', defaultCapexCurrency: 'EUR', allowedCurrencies: ['EUR', 'USD'] } };
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (url: string, body: Record<string, unknown>) => (
      url.includes('/compliance/')
        // The register as the API answers it: the requirement with the body recorded.
        ? { data: { ...COMPLIANCE, requirements: COMPLIANCE.requirements.map((item) => (url.endsWith(`/${item.requirement}`) ? { ...item, ...body } : item)) } }
        : { data: { ...CONTRACT, ...body } }
    ));
    mocked.post.mockImplementation(async () => ({ data: { id: 'c-new' } }));
  });

  it('shows the header, the three tabs and no save or reset button', async () => {
    renderAt('/ops/contracts/c-1/overview');
    expect(await screen.findByText('SAP Maintenance')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'contracts.tabs.overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /contracts\.tabs\.budget/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /contracts\.tabs\.relations/ })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'contracts.tabs.details' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'common:buttons.saveChanges' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'common:buttons.reset' })).toBeNull();
    expect(screen.getByRole('button', { name: 'share.share' })).toBeInTheDocument();
    // The status reads as on the budget lines.
    expect(screen.getAllByText('opex.status.enabled').length).toBeGreaterThan(0);
    // The parties from the detail, in the header.
    expect(screen.getAllByText('SAP').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fromage & Co SA').length).toBeGreaterThan(0);
  });

  it('renders the contract history on its last tab, History', async () => {
    renderAt('/ops/contracts/c-1/history');
    expect(await screen.findByTestId('record-history')).toHaveTextContent('contracts:c-1');
    const tabs = screen.getAllByRole('tab');
    expect(tabs[tabs.length - 1]).toHaveAccessibleName('contracts.tabs.history');
  });

  it('shows the History tab disabled, with no history, while the contract is created', async () => {
    renderAt('/ops/contracts/new/overview');
    const tab = await screen.findByRole('tab', { name: 'contracts.tabs.history' });
    expect(tab).toBeDisabled();
    expect(screen.queryByTestId('record-history')).toBeNull();
  });

  it('shows the deadline state, the timeline and the open tasks on the overview', async () => {
    renderAt('/ops/contracts/c-1/overview');
    const state = await screen.findByTestId('contract-deadline-state');
    expect(state.textContent).toMatch(/contracts\.deadlines\.(cancelUntil|noticePassed|endsOn|expiredOn)/);
    expect(screen.getByRole('img', { name: 'contracts.timeline.label' })).toBeInTheDocument();
    expect(await screen.findByText('Decide the renewal')).toBeInTheDocument();
    expect(screen.getByText('T-142')).toBeInTheDocument();
    // Done tasks wait behind their link.
    expect(screen.queryByText('Old task')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'portfolio:shared.entityTasksSection.showClosed:1' }));
    expect(screen.getByText('Old task')).toBeInTheDocument();
  });

  it('shows a confirmed renewal without the deadline of the term decided', async () => {
    // SAP's terms end on 30 June, 6 months after their deadline.
    const next = computeContractTerms(CONTRACT, utcTodayYmd())!.next_cancellation_deadline!;
    const termEnd = addMonthsYmd(next, 6);
    const renewal = {
      decision_window_days: 90,
      state: 'decided',
      renegotiating: false,
      term: { term_end: termEnd, deadline: next, renews_on: `${termEnd.slice(0, 4)}-07-01`, next_term_end: `${Number(termEnd.slice(0, 4)) + 1}-06-30`, days_left: 10 },
      duration_months: 12,
      decision: { decision: 'renew', reason: null, decided_at: '2026-10-12T10:00:00.000Z', decided_by_name: 'Ada Admin' },
      can_undo: true,
      task: null,
      impact: null,
    };
    const base = mocked.get.getMockImplementation() as (url: string, options?: unknown) => Promise<unknown>;
    mocked.get.mockImplementation(async (url: string, options?: unknown) => (url === '/contracts/c-1/renewal' ? { data: renewal } : base(url, options)));
    renderAt('/ops/contracts/c-1/overview');
    await waitFor(() => expect(screen.getByTestId('contract-deadline-state').textContent).toContain('contracts.deadlines.renewalConfirmed'));
    expect(screen.getByTestId('contract-deadline-state').textContent).toContain('contracts.deadlines.nextTerm');
    expect(screen.queryByText(/^contracts\.timeline\.deadline/)).toBeNull();
    expect(screen.getByText('contracts.timeline.termNext')).toBeInTheDocument();
  });

  it('asks before turning off the renewal of a contract already renewed, then shows No with the end chosen', async () => {
    // Once turned off, the API answers the contract without renewal and with its end of validity.
    let stopped = false;
    const base = mocked.get.getMockImplementation() as (url: string, options?: unknown) => Promise<unknown>;
    mocked.get.mockImplementation(async (url: string, options?: unknown) => (
      url === '/contracts/c-1' && stopped ? { data: { ...CONTRACT, auto_renewal: false, disabled_at: `${NEXT_YEAR}-06-30T12:00:00.000Z` } } : base(url, options)
    ));
    mocked.post.mockImplementation(async () => { stopped = true; return { data: { state: 'none' } }; });
    renderAt('/ops/contracts/c-1/overview');
    const choose = async () => {
      fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'contracts.fields.autoRenewal' }));
      fireEvent.click(await screen.findByRole('option', { name: 'contracts.fields.no' }));
    };
    await choose();
    const dialog = await screen.findByRole('dialog');
    // No word of a termination: the end, unless renewed, and the past terms kept.
    expect(within(dialog).getByText(/^contracts\.stopRenewal\.body:/)).toBeInTheDocument();
    expect(within(dialog).getByText('contracts.stopRenewal.hint')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(mocked.post).not.toHaveBeenCalled();

    await choose();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'contracts.stopRenewal.confirm' }));
    // Without a proposal from the API yet, the current term's end.
    const termEnd = computeContractTerms(CONTRACT, utcTodayYmd())!.current_term_end;
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts/c-1/renewal/stop', { end_date: termEnd }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocked.patch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'contracts.fields.autoRenewal' })).toHaveTextContent('contracts.fields.no'));
  });

  it('asks before turning the renewal back on when an end of validity is set, then removes it', async () => {
    let resumed = false;
    const off = { ...CONTRACT, auto_renewal: false, disabled_at: `${NEXT_YEAR}-06-30T12:00:00.000Z`, status: 'enabled' };
    const base = mocked.get.getMockImplementation() as (url: string, options?: unknown) => Promise<unknown>;
    mocked.get.mockImplementation(async (url: string, options?: unknown) => (
      url === '/contracts/c-1' ? { data: resumed ? { ...CONTRACT } : off } : base(url, options)
    ));
    mocked.post.mockImplementation(async () => { resumed = true; return { data: { state: 'none' } }; });
    renderAt('/ops/contracts/c-1/overview');
    const choose = async () => {
      fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'contracts.fields.autoRenewal' }));
      fireEvent.click(await screen.findByRole('option', { name: 'contracts.fields.yes' }));
    };
    await choose();
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('contracts.resumeRenewal.title')).toBeInTheDocument();
    expect(within(dialog).getByText(/^contracts\.resumeRenewal\.body:/)).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(mocked.post).not.toHaveBeenCalled();
    expect(screen.getByRole('combobox', { name: 'contracts.fields.autoRenewal' })).toHaveTextContent('contracts.fields.no');

    await choose();
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'contracts.resumeRenewal.confirm' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts/c-1/renewal/resume'));
    expect(mocked.patch).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'contracts.fields.autoRenewal' })).toHaveTextContent('contracts.fields.yes'));
  });

  it('keeps a future end of validity when the status shown is chosen again, and disables now alone', async () => {
    const base = mocked.get.getMockImplementation() as (url: string, options?: unknown) => Promise<unknown>;
    const ending = { ...CONTRACT, disabled_at: `${NEXT_YEAR}-06-30T14:37:12.000Z`, status: 'enabled' };
    mocked.get.mockImplementation(async (url: string, options?: unknown) => (
      url === '/contracts/c-1' ? { data: ending } : base(url, options)
    ));
    renderAt('/ops/contracts/c-1/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'opex.status.enabled' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'opex.status.enabled' }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocked.patch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'opex.status.enabled' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'opex.status.disabled' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contracts/c-1', { status: 'disabled' }));
  });

  it('turns the renewal on at once when no end of validity is set', async () => {
    const base = mocked.get.getMockImplementation() as (url: string, options?: unknown) => Promise<unknown>;
    mocked.get.mockImplementation(async (url: string, options?: unknown) => (
      url === '/contracts/c-1' ? { data: { ...CONTRACT, auto_renewal: false } } : base(url, options)
    ));
    renderAt('/ops/contracts/c-1/overview');
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'contracts.fields.autoRenewal' }));
    fireEvent.click(await screen.findByRole('option', { name: 'contracts.fields.yes' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contracts/c-1', { auto_renewal: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('turns off the renewal of a contract in its first term at once', async () => {
    const base = mocked.get.getMockImplementation() as (url: string, options?: unknown) => Promise<unknown>;
    const firstTerm = { ...CONTRACT, start_date: `${NEXT_YEAR}-01-01` };
    mocked.get.mockImplementation(async (url: string, options?: unknown) => (url === '/contracts/c-1' ? { data: firstTerm } : base(url, options)));
    renderAt('/ops/contracts/c-1/overview');
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'contracts.fields.autoRenewal' }));
    fireEvent.click(await screen.findByRole('option', { name: 'contracts.fields.no' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contracts/c-1', { auto_renewal: false }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks first in its first term too while a renewal decision is awaited', async () => {
    const base = mocked.get.getMockImplementation() as (url: string, options?: unknown) => Promise<unknown>;
    const firstTerm = { ...CONTRACT, start_date: `${NEXT_YEAR}-01-01` };
    const pending = {
      decision_window_days: 90, proposed_end_date: `${NEXT_YEAR}-12-31`, notice_period_months: 6, state: 'pending', renegotiating: false,
      term: { term_end: `${NEXT_YEAR}-12-31`, deadline: `${NEXT_YEAR}-06-30`, renews_on: `${NEXT_YEAR + 1}-01-01`, next_term_end: `${NEXT_YEAR + 1}-12-31`, days_left: 60 },
      duration_months: 12, decision: null, can_undo: false, task: null, impact: null,
    };
    mocked.get.mockImplementation(async (url: string, options?: unknown) => (
      url === '/contracts/c-1' ? { data: firstTerm } : url === '/contracts/c-1/renewal' ? { data: pending } : base(url, options)
    ));
    renderAt('/ops/contracts/c-1/overview');
    await screen.findByTestId('contract-renewal-decision');
    fireEvent.mouseDown(await screen.findByRole('combobox', { name: 'contracts.fields.autoRenewal' }));
    fireEvent.click(await screen.findByRole('option', { name: 'contracts.fields.no' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/^contracts\.stopRenewal\.body:/)).toBeInTheDocument();
    expect(within(dialog).queryByText('contracts.stopRenewal.hint')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'contracts.stopRenewal.confirm' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts/c-1/renewal/stop', { end_date: `${NEXT_YEAR}-12-31` }));
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('sends the former Details and Tasks addresses to the overview', async () => {
    renderAt('/ops/contracts/c-1/details?sort=name:ASC');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/ops/contracts/c-1/overview?sort=name:ASC'));
    renderAt('/ops/contracts/c-1/tasks');
    await waitFor(() => expect(screen.getAllByTestId('location').some((el) => el.textContent === '/ops/contracts/c-1/overview')).toBe(true));
  });

  it('saves the title on blur and a select at once, without a save button', async () => {
    renderAt('/ops/contracts/c-1/overview');
    fireEvent.click(await screen.findByText('SAP Maintenance'));
    const input = screen.getByDisplayValue('SAP Maintenance');
    fireEvent.change(input, { target: { value: 'SAP Maintenance 2027' } });
    expect(mocked.patch).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contracts/c-1', { name: 'SAP Maintenance 2027' }));

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'contracts.fields.billingFrequency' }));
    fireEvent.click(await screen.findByRole('option', { name: 'contracts.billing.quarterly' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contracts/c-1', { billing_frequency: 'quarterly' }));
  });

  it('opens a contract whose supplier is missing and repairs it with another supplier', async () => {
    const base = mocked.get.getMockImplementation() as (url: string, options?: unknown) => Promise<unknown>;
    mocked.get.mockImplementation(async (url: string, options?: { params?: Record<string, unknown> }) => {
      if (url === '/contracts/c-1') return { data: { ...CONTRACT, supplier_id: 'sup-gone', supplier_name: null } };
      if (url === '/suppliers/lookup') {
        return options?.params?.ids
          ? { data: { items: [], has_more: false } }
          : { data: { items: [{ id: 'sup-2', name: 'Acme', erp_supplier_id: null, status: 'enabled' }], has_more: false } };
      }
      return base(url, options);
    });
    renderAt('/ops/contracts/c-1/overview');
    expect((await screen.findAllByText('contracts.metadata.supplierMissing')).length).toBeGreaterThan(0);
    const supplier = screen.getByRole('combobox', { name: 'contracts.fields.supplier' });
    fireEvent.mouseDown(supplier);
    fireEvent.change(supplier, { target: { value: 'Ac' } });
    fireEvent.click(await screen.findByRole('option', { name: /Acme/ }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contracts/c-1', { supplier_id: 'sup-2' }));
  });

  it('saves a typed duration after a pause, and a decimal amount', async () => {
    renderAt('/ops/contracts/c-1/overview');
    const duration = await screen.findByLabelText('contracts.fields.durationMonths');
    await waitFor(() => expect(duration).toHaveValue('12'));
    fireEvent.focus(duration);
    fireEvent.change(duration, { target: { value: '24' } });
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contracts/c-1', { duration_months: 24 }), { timeout: 3000 });

    const amount = screen.getByLabelText('contracts.fields.yearlyAmount');
    fireEvent.focus(amount);
    fireEvent.change(amount, { target: { value: '350 000,50' } });
    fireEvent.blur(amount);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contracts/c-1', { yearly_amount_at_signature: 350000.5 }), { timeout: 3000 });
  });

  it('saves the notes after a pause once the user types, never on load', async () => {
    renderAt('/ops/contracts/c-1/overview');
    const editor = await screen.findByLabelText('markdown-editor');
    // A change the editor makes before the user touches it is not saved.
    fireEvent.change(editor, { target: { value: 'Annual renewal on 1 July.\n' } });
    fireEvent.focus(editor);
    fireEvent.change(editor, { target: { value: 'Renewal on 1 July, call the account manager.' } });
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contracts/c-1', { notes: 'Renewal on 1 July, call the account manager.' }), { timeout: 3000 });
    expect(mocked.patch).toHaveBeenCalledTimes(1);
  });

  it('never writes for a reader', async () => {
    auth.canEdit = false;
    renderAt('/ops/contracts/c-1/overview');
    await screen.findByText('SAP Maintenance');
    expect(screen.getByLabelText('contracts.fields.durationMonths')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'portfolio:shared.entityTasksSection.newTask' })).toBeNull();
  });

  it('opens a contract outside the edit scope read only, with no edit command', async () => {
    auth.dataAccess = { available: true, mode: 'limited', nodes: [], modules: ['contracts'] };
    const base = mocked.get.getMockImplementation() as (url: string, options?: unknown) => Promise<unknown>;
    mocked.get.mockImplementation(async (url: string, options?: unknown) => (
      url === '/contracts/c-1' ? { data: { ...CONTRACT, editable: false, closed_documents_count: 0 } } : base(url, options)
    ));

    const overview = renderAt('/ops/contracts/c-1/overview');
    expect(await screen.findByTestId('contract-read-only')).toHaveTextContent('contracts.readOnlyInYourAccess');
    expect(screen.getByLabelText('contracts.fields.durationMonths')).toBeDisabled();
    expect(screen.getByLabelText('markdown-editor')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'portfolio:shared.entityTasksSection.newTask' })).toBeNull();
    // Deleting is reserved to people with access to all data.
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
    overview.unmount();

    const budget = renderAt('/ops/contracts/c-1/budget');
    expect(await screen.findByText('BL-2')).toBeInTheDocument();
    expect(screen.getByLabelText('common:selects.budgetLines')).toBeDisabled();
    budget.unmount();

    renderAt('/ops/contracts/c-1/relations');
    expect(await screen.findByText('SAP S/4HANA')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'linksAndFiles.attachFile' })).toBeNull();
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
  });

  it('lists the linked budget lines of both natures from the contract route', async () => {
    renderAt('/ops/contracts/c-1/budget');
    expect(await screen.findByText('BL-2')).toBeInTheDocument();
    expect(screen.getByText('BL-9')).toBeInTheDocument();
    expect(screen.getByText('S/4HANA maintenance')).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith('/contracts/c-1/budget-lines', expect.anything());
    expect(mocked.get.mock.calls.some(([url]) => String(url).includes('capex-items'))).toBe(false);
  });

  it('adds the amounts of the chosen year and column, their total and the commitment of every year', async () => {
    renderAt('/ops/contracts/c-1/budget');
    // Next year and the default column by default.
    expect(await screen.findByText('contracts.budget.amountHeader')).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith('/contracts/c-1/budget', expect.objectContaining({ params: { year: NEXT_YEAR, column: 'planned' } }));
    expect(await screen.findByText('62 000')).toBeInTheDocument();
    expect(screen.getByText('contracts.budget.total:2').closest('tr')).toHaveTextContent('362 000');

    // The coverage section: one row per year, the chosen one marked, its state as a dot and a text.
    const table = screen.getByText('contracts.budget.coverage.columns.committed').closest('table') as HTMLElement;
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows.map((row) => row.getAttribute('aria-selected'))).toEqual(['false', 'true', 'false']);
    expect(rows[1]).toHaveTextContent(`${NEXT_YEAR}350 000362 000+12 000contracts.budget.states.over`);
    expect(rows[2]).toHaveTextContent('contracts.budget.states.not_started');
    expect(screen.getByText(/contracts\.budget\.coverage\.hint contracts\.budget\.coverage\.hintRenewal/)).toBeInTheDocument();

    // Another year from its row, another column by its name: the figures follow.
    fireEvent.click(rows[0]);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/contracts/c-1/budget', expect.objectContaining({ params: { year: NEXT_YEAR - 1, column: 'planned' } })));
    await waitFor(() => expect(screen.getByText('contracts.budget.total:2').closest('tr')).toHaveTextContent('350 000'));
    expect(screen.getByText('50 000')).toBeInTheDocument();
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'contracts.budget.column' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Revised' }));
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/contracts/c-1/budget', expect.objectContaining({ params: { year: NEXT_YEAR - 1, column: 'committed' } })));
    expect(await screen.findByText('contracts.budget.coverage.subtitle')).toBeInTheDocument();
    expect(await screen.findAllByText('contracts.budget.states.no_line')).toHaveLength(2);
  });

  it('shows a line without a rate in its own currency, leaves it out of the total and reads the year as unknown', async () => {
    const base = mocked.get.getMockImplementation() as (url: string, options?: unknown) => Promise<unknown>;
    mocked.get.mockImplementation(async (url: string, options?: { params?: { year: number; column: string } }) => {
      if (url !== '/contracts/c-1/budget') return base(url, options);
      const figures = coverage(options?.params);
      return {
        data: {
          ...figures,
          lines: [{ id: 'bl-2', amount: 300000 }, { id: 'bl-9', amount: null, fx_missing: { currency: 'GBP', amount: 55000 } }],
          lines_fx_missing: [{ currency: 'GBP', year: NEXT_YEAR, lines: 1 }],
          years: figures.years.map((row) => (row.year === NEXT_YEAR ? { ...row, linked: 300000, linked_fx_missing: true, gap: null, state: null } : row)),
        },
      };
    });
    renderAt('/ops/contracts/c-1/budget');
    const local = await screen.findByText('shared.fxMissing.localAmount');
    expect(local.closest('tr')).toHaveTextContent('BL-9');
    expect(within(local.closest('tr') as HTMLElement).getByRole('img', { name: 'shared.fxMissing.lineTooltip' })).toBeInTheDocument();
    expect(screen.getByText('contracts.budget.total:2').closest('tr')).toHaveTextContent(/300 000$/);

    const table = screen.getByText('contracts.budget.coverage.columns.committed').closest('table') as HTMLElement;
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows[1]).toHaveTextContent(`${NEXT_YEAR}350 000300 000contracts.budget.unknownFx`);
    expect(screen.getByRole('status')).toHaveTextContent('ops:shared.fxMissing.excluding:1');
  });

  it('shows a user who cannot read the budget the number of lines only, without names or amounts', async () => {
    auth.canEdit = false;
    // The server lists no line to that user and counts them (data-scoped access, spec §5.4).
    const served = mocked.get.getMockImplementation()!;
    mocked.get.mockImplementation(async (url: string, ...rest: unknown[]) => (
      url === '/contracts/c-1/budget-lines' ? { data: { items: [], hidden: 2 } } : (served as any)(url, ...rest)
    ));
    renderAt('/ops/contracts/c-1/budget');
    expect(await screen.findByText('it:workspace.application.relations.outside.count:2')).toBeInTheDocument();
    expect(screen.queryByText('BL-2')).toBeNull();
    expect(screen.queryByText(/contracts\.budget\.total/)).toBeNull();
    expect(screen.queryByText('contracts.budget.coverage.title')).toBeNull();
    expect(mocked.get.mock.calls.some(([url]) => url === '/contracts/c-1/budget')).toBe(false);
  });

  it('shows the relations aligned on the other pages, attachments as a list with a button', async () => {
    renderAt('/ops/contracts/c-1/relations');
    expect(await screen.findByText('SAP S/4HANA')).toBeInTheDocument();
    expect(await screen.findByText('sap-prd-db01')).toBeInTheDocument();
    expect(screen.getByText('contract.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'linksAndFiles.attachFile' })).toBeInTheDocument();
    expect(screen.getByText('Vendor portal')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'contacts.syncFromSupplier' })).toBeInTheDocument();
  });

  it('shows the expected requirements with their reasons, the others on demand, and the missing count on the tab', async () => {
    renderAt('/ops/contracts/c-1/compliance');
    const tab = await screen.findByRole('tab', { name: /contracts\.tabs\.compliance/ });
    await waitFor(() => expect(tab).toHaveTextContent('1'));
    expect(await screen.findByText('contracts.compliance.requirements.gdpr_dpa')).toBeInTheDocument();
    expect(screen.getByText('contracts.compliance.requirements.data_location')).toBeInTheDocument();
    expect(screen.getByText('contracts.compliance.summary.missing:1')).toBeInTheDocument();
    expect(screen.getByText('contracts.compliance.hint')).toBeInTheDocument();
    // Two reasons: the first, then how many more.
    const location = screen.getByText('contracts.compliance.requirements.data_location').closest('tr') as HTMLElement;
    expect(location).toHaveTextContent('contracts.compliance.reasons.personal_data');
    expect(location).toHaveTextContent('contracts.compliance.moreReasons:1');
    // Expected with nothing recorded: to check.
    expect(within(location).getByRole('combobox')).toHaveTextContent('contracts.compliance.states.to_check');
    // The requirements not expected wait behind their link.
    expect(screen.queryByText('contracts.compliance.requirements.exit_plan')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'contracts.compliance.showOthers:3' }));
    const exit = screen.getByText('contracts.compliance.requirements.exit_plan').closest('tr') as HTMLElement;
    expect(exit).toHaveTextContent('contracts.compliance.notExpected');
    expect(within(exit).getByRole('combobox')).toHaveTextContent('contracts.compliance.states.unset');
  });

  it('records a state at once and a reference on blur', async () => {
    renderAt('/ops/contracts/c-1/compliance');
    const location = (await screen.findByText('contracts.compliance.requirements.data_location')).closest('tr') as HTMLElement;
    fireEvent.mouseDown(within(location).getByRole('combobox'));
    fireEvent.click(await screen.findByRole('option', { name: 'contracts.compliance.states.present' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contracts/c-1/compliance/data_location', { state: 'present' }));

    const dpa = screen.getByText('contracts.compliance.requirements.gdpr_dpa').closest('tr') as HTMLElement;
    const reference = within(dpa).getByDisplayValue('Annex 4');
    fireEvent.change(reference, { target: { value: 'Annex 4, art. 12' } });
    expect(mocked.patch).toHaveBeenCalledTimes(1);
    fireEvent.blur(reference);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contracts/c-1/compliance/gdpr_dpa', { reference: 'Annex 4, art. 12' }));
    // An unchanged reference is not sent again.
    fireEvent.blur(within(dpa).getByRole('textbox'));
    expect(mocked.patch).toHaveBeenCalledTimes(2);
  });

  it('shows the register read-only to a reader', async () => {
    auth.canEdit = false;
    renderAt('/ops/contracts/c-1/compliance');
    const dpa = (await screen.findByText('contracts.compliance.requirements.gdpr_dpa')).closest('tr') as HTMLElement;
    expect(dpa).toHaveTextContent('contracts.compliance.states.absent');
    expect(dpa).toHaveTextContent('Annex 4');
    expect(within(dpa).queryByRole('combobox')).toBeNull();
    expect(within(dpa).queryByRole('textbox')).toBeNull();
  });

  it('deletes the contract after a confirmation that counts what it is linked to', async () => {
    mocked.post.mockImplementation(async (url: string) => (url === '/contracts/delete-impact'
      ? { data: { contracts: 1, budget_lines: 2, applications: 1, assets: 1, contacts: 0, tasks: 2, links: 1, attachments: 1, blocked: 0, recorded_requirements: 0, refused: [] } }
      : { data: {} }));
    mocked.delete.mockResolvedValue({ data: undefined });
    renderAt('/ops/contracts/c-1/overview?sort=name%3AASC');
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));

    const dialog = await screen.findByRole('dialog');
    expect(mocked.post).toHaveBeenCalledWith('/contracts/delete-impact', { ids: ['c-1'] });
    expect(dialog).toHaveTextContent('contracts.delete.title');
    expect(dialog).toHaveTextContent('contracts.delete.detached');
    expect(dialog).toHaveTextContent('contracts.delete.removed');
    expect(mocked.delete).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'contracts.delete.confirmAnyway' }));

    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/contracts/c-1'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/ops/contracts?sort=name%3AASC'));
  });

  it('does not load the deleted contract again after deleting it', async () => {
    mocked.post.mockResolvedValue({ data: { contracts: 1, budget_lines: 0, applications: 0, assets: 0, contacts: 0, tasks: 0, links: 0, attachments: 0, blocked: 0, recorded_requirements: 0, refused: [] } });
    mocked.delete.mockResolvedValue({ data: undefined });
    const { renderAgain } = renderAt('/ops/contracts/c-1/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    const dialog = await screen.findByRole('dialog');
    const loadsBefore = mocked.get.mock.calls.filter(([url]) => url === '/contracts/c-1').length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/contracts/c-1'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/ops/contracts'));
    // The router can keep the page on screen while the list loads: a render then must not reload it.
    renderAgain();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocked.get.mock.calls.filter(([url]) => url === '/contracts/c-1')).toHaveLength(loadsBefore);
  });

  it('keeps the contract when the confirmation is cancelled', async () => {
    mocked.post.mockResolvedValue({ data: { contracts: 1, budget_lines: 1, applications: 0, assets: 0, contacts: 0, tasks: 0, links: 0, attachments: 0, blocked: 0, recorded_requirements: 0, refused: [] } });
    renderAt('/ops/contracts/c-1/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocked.delete).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('asks before deleting a contract linked to nothing too', async () => {
    mocked.post.mockResolvedValue({ data: { contracts: 1, budget_lines: 0, applications: 0, assets: 0, contacts: 0, tasks: 0, links: 0, attachments: 0, blocked: 0, recorded_requirements: 0, refused: [] } });
    mocked.delete.mockResolvedValue({ data: undefined });
    renderAt('/ops/contracts/c-1/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('contracts.delete.nothingLinked:1');
    expect(mocked.delete).not.toHaveBeenCalled();
    // Nothing else goes: the plain "Delete", not "Delete anyway".
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/contracts/c-1'));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/ops/contracts'));
  });

  it('refuses to delete a contract with recorded compliance requirements and says why', async () => {
    mocked.post.mockResolvedValue({ data: { contracts: 0, budget_lines: 0, applications: 0, assets: 0, contacts: 0, tasks: 0, links: 0, attachments: 0, blocked: 1, recorded_requirements: 3, refused: [{ id: 'c-1', name: 'SAP Maintenance', code: 'CONTRACT_HAS_COMPLIANCE_RECORDS', usages: [{ type: 'compliance_requirements', total: 3 }] }] } });
    renderAt('/ops/contracts/c-1/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('errors:CONTRACT_HAS_COMPLIANCE_RECORDS');
    expect(dialog).not.toHaveTextContent('contracts.delete.detached');
    expect(within(dialog).queryByRole('button', { name: /confirmAnyway|common:buttons\.delete/ })).toBeNull();
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it('offers no delete to a member who is not an administrator', async () => {
    auth.canAdmin = false;
    renderAt('/ops/contracts/c-1/overview');
    expect(await screen.findByText('SAP Maintenance')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
  });

  it('creates a contract with the real fields only', async () => {
    renderAt('/ops/contracts/new/overview');
    const create = await screen.findByRole('button', { name: 'common:buttons.create' });
    fireEvent.click(create);
    expect(await screen.findByText('contracts.messages.nameRequired')).toBeInTheDocument();
    expect(screen.getByText('contracts.messages.durationRequired')).toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();
    // The other tabs wait for the contract.
    expect(screen.getByRole('tab', { name: 'contracts.tabs.budget' })).toBeDisabled();
    expect(within(document.body).queryByText('contracts.deadlines.title')).toBeNull();
  });
});
