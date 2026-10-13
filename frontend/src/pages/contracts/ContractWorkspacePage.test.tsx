import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

const navigateMock = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ canEdit: true }));
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
  useAuth: () => ({ hasLevel: () => auth.canEdit, profile: { id: 'user-1', first_name: 'Ada', last_name: 'Admin' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'fromage' }) }));
vi.mock('../../hooks/useContractNav', () => ({
  useContractNav: () => ({ ids: ['c-1', 'c-2'], index: 0, total: 2, hasPrev: false, hasNext: true, prevId: null, nextId: 'c-2' }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: vi.fn() }) }));
vi.mock('../../components/MarkdownEditor', () => ({
  default: ({ value, onChange }: { value: string; onChange: (next: string) => void }) => (
    <textarea aria-label="markdown-editor" value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

import api from '../../api';
import ContractWorkspacePage from './ContractWorkspacePage';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
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
    </QueryClientProvider>,
  );
}

describe('ContractWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.canEdit = true;
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
      if (url === '/contracts/c-1/applications') return { data: { items: [{ id: 'app-1', name: 'SAP S/4HANA' }] } };
      if (url === '/contracts/c-1/assets') return { data: { items: [{ id: 'as-1', name: 'sap-prd-db01' }] } };
      if (url === '/contracts/c-1/contacts') return { data: [] };
      if (url === '/budget-columns') {
        return { data: { labels: { planned: null, committed: 'Revised', forecast: null, actual: null, expected_landing: null }, enabled: { planned: true, committed: true, forecast: false, actual: true, expected_landing: true }, group_spread: {}, default_column: 'planned' } };
      }
      if (url === '/contracts/c-1/budget') return { data: coverage(options?.params) };
      if (url === '/currency/settings') return { data: { reportingCurrency: 'EUR', defaultSpendCurrency: 'EUR', defaultCapexCurrency: 'EUR', allowedCurrencies: ['EUR', 'USD'] } };
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (_url: string, body: Record<string, unknown>) => ({ data: { ...CONTRACT, ...body } }));
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
    expect(screen.getByRole('button', { name: 'share.sendLink' })).toBeInTheDocument();
    // The status reads as on the budget lines.
    expect(screen.getAllByText('opex.status.enabled').length).toBeGreaterThan(0);
    // The parties from the detail, in the header.
    expect(screen.getAllByText('SAP').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Fromage & Co SA').length).toBeGreaterThan(0);
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

  it('shows the lines without amounts to a user who cannot read the budget', async () => {
    auth.canEdit = false;
    renderAt('/ops/contracts/c-1/budget');
    expect(await screen.findByText('BL-2')).toBeInTheDocument();
    expect(screen.queryByText(/contracts\.budget\.total/)).toBeNull();
    expect(screen.queryByText('contracts.budget.coverage.title')).toBeNull();
    expect(mocked.get.mock.calls.some(([url]) => url === '/contracts/c-1/budget')).toBe(false);
  });

  it('shows the relations aligned on the other pages, attachments as a list with a button', async () => {
    renderAt('/ops/contracts/c-1/relations');
    expect(await screen.findByText('SAP S/4HANA')).toBeInTheDocument();
    expect(await screen.findByText('sap-prd-db01')).toBeInTheDocument();
    expect(screen.getByText('contract.pdf')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'contracts.relations.addFiles' })).toBeInTheDocument();
    expect(screen.getByText('Vendor portal')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'contacts.syncFromSupplier' })).toBeInTheDocument();
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
