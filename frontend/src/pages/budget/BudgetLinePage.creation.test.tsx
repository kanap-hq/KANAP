import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import NavigationTracker, { resetNavigationTracker } from '../../components/navigation/NavigationTracker';
import { resetCreationStore } from '../../components/workspace/creation/creationStore';
import { resetSharedPatchBuffers } from '../../hooks/patchBuffer';
import api from '../../api';
import BudgetLineRoute from './BudgetLineRoute';

// Creation at the title (lot 1c): the title creates the line with its defaults, every tab opens,
// and Create checks the fields the line needs before it closes it; Cancel deletes it. Leaving the
// line otherwise asks while a field is missing. A person with limited access places it first.

const translation = {
  t: (key: string, opts?: unknown) => {
    const values = opts && typeof opts === 'object' ? opts as Record<string, unknown> : null;
    const args = values ? Object.entries(values).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({
  useTranslation: () => translation,
  Trans: ({ i18nKey }: { i18nKey: string }) => <span>{i18nKey}</span>,
  initReactI18next: { type: '3rdParty', init: () => undefined },
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const access = vi.hoisted(() => ({ limited: false, admin: false, start: { ready: true, companyId: null as string | null, needsChoice: false } }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'me' },
    dataAccess: access.limited ? { available: true, mode: 'limited' as const, nodes: [], modules: ['budget'] } : null,
    hasLevel: (_resource: string, level: string) => access.admin || level !== 'admin',
  }),
}));
vi.mock('../../hooks/usePlacementOptions', () => ({
  useLinePlacementFilter: () => null,
  useLinePlacementDefault: () => access.start,
}));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../hooks/useBudgetLineNav', () => ({
  useBudgetLineNav: () => ({ index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../../hooks/useCurrencySettings', () => ({ default: () => ({ data: { defaultSpendCurrency: 'CHF' }, isLoading: false }) }));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('../../utils/workspaceTabCounts', () => ({ fetchBudgetRelationsCount: vi.fn(async () => 0) }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/EntityTasksPanel', () => ({ default: () => null }));
vi.mock('../../components/finance/BudgetTab', () => ({ default: () => <div data-testid="budget-tab" /> }));
vi.mock('../../components/finance/AllocationsTab', () => ({ default: () => null }));
vi.mock('./workspace/BudgetLineRelationsTab', () => ({ default: () => null }));
vi.mock('../../components/history/RecordHistoryTab', () => ({ default: () => null }));
vi.mock('./workspace/BudgetMetadataBar', () => ({ default: () => <span data-testid="metadata" /> }));
// The pickers: a plain field named by its label, which gives the typed id.
const pickers = vi.hoisted(() => ({
  picker: ({ label, value, onChange, disabled }: { label: string; value?: string | null; onChange: (v: string | null, node?: unknown) => void; disabled?: boolean }) => (
    <input aria-label={label} value={value ?? ''} disabled={disabled} onChange={(event) => onChange(event.target.value || null, null)} />
  ),
}));
vi.mock('../../components/fields/SupplierSelect', () => ({ default: pickers.picker }));
vi.mock('../../components/fields/CompanySelect', () => ({ default: pickers.picker }));
vi.mock('../../components/fields/AccountSelect', () => ({ default: pickers.picker }));
vi.mock('../../components/fields/CostCenterSelect', () => ({ default: pickers.picker }));
vi.mock('../../components/fields/AnalyticsCategorySelect', () => ({ default: pickers.picker }));
vi.mock('../../components/fields/UserSelect', () => ({ default: () => null }));

const mocked = vi.mocked(api);
const TITLE = 'common:buttons.editTitle';
const ITEM_ID = '11111111-2222-3333-4444-555555555555';
const TODAY = new Date().toISOString().slice(0, 10);
const created = {
  id: ITEM_ID, item_number: 12, reference: 'BL-12', nature: 'opex', product_name: 'Monitoring', currency: 'CHF',
  effective_start: TODAY, paying_company_id: null, account_id: null, editable: true, creation_token: 'token-1',
};

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function StartPage() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/ops/budget/new/overview?nature=opex')}>new line</button>;
}

type Options = {
  changes?: { fields: number; children: Record<string, number> };
  incomplete?: string[];
  line?: Record<string, unknown>;
};

function renderPage(entries: string[], options: Options = {}) {
  const changes = options.changes ?? { fields: 0, children: {} };
  const { creation_token: _token, ...detail } = created;
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/analytics-axes') return { data: { items: [] } } as never;
    if (url === '/budget-lines/BL-12' || url === `/budget-lines/${ITEM_ID}`) return { data: { ...detail, ...options.line } } as never;
    if (url === '/budget-lines/resolve/BL-12') return { data: { id: ITEM_ID, nature: 'opex', reference: 'BL-12' } } as never;
    if (url === `/budget-lines/${ITEM_ID}/creation`) return { data: { changes } } as never;
    return { data: {} } as never;
  });
  mocked.post.mockImplementation(async (url: string) => {
    if (url === '/budget-lines/creation') return { data: created } as never;
    if (url === `/budget-lines/${ITEM_ID}/creation/complete`) {
      if (options.incomplete) {
        throw { response: { status: 400, data: { code: 'CREATION_INCOMPLETE', message: 'Missing', params: { fields: options.incomplete } } } };
      }
      return { data: { complete: true } } as never;
    }
    return { data: {} } as never;
  });
  mocked.patch.mockResolvedValue({ data: {} } as never);
  mocked.delete.mockResolvedValue({ data: undefined } as never);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={entries}>
            <NavigationTracker />
            <Location />
            <React.Suspense fallback={null}>
              <Routes>
                <Route path="/start" element={<StartPage />} />
                <Route path="/ops/budget" element={<div data-testid="budget-list" />} />
                <Route path="/ops/budget/:ref/:tab" element={<BudgetLineRoute />} />
              </Routes>
            </React.Suspense>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function location() {
  return screen.getByTestId('location').textContent;
}

async function startNewLine() {
  renderPage(['/start']);
  fireEvent.click(await screen.findByRole('button', { name: 'new line' }));
  return screen.findByRole('textbox', { name: TITLE });
}

async function commitTitle() {
  const input = await screen.findByRole('textbox', { name: TITLE });
  fireEvent.change(input, { target: { value: 'Monitoring' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

async function createMonitoring() {
  await commitTitle();
  await waitFor(() => expect(location()).toBe('/ops/budget/BL-12/overview'));
  await screen.findByRole('button', { name: TITLE });
}

describe('Budget line creation at the title', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetCreationStore();
    resetNavigationTracker();
    resetSharedPatchBuffers();
    access.limited = false;
    access.admin = false;
    access.start = { ready: true, companyId: null, needsChoice: false };
  });

  it('opens with the title to type and the line to come dimmed, with Create and Cancel', async () => {
    const input = await startNewLine();
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('placeholder', 'opex.workspace.newSpendItem');
    expect(screen.getByRole('button', { name: 'common:buttons.create' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.close' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'opex.tabs.budget' })).toBeDisabled();
    const previews = screen.getAllByTestId('creation-preview');
    expect(previews.length).toBeGreaterThanOrEqual(3);
    for (const preview of previews) {
      expect(preview).toHaveAttribute('inert');
      expect(within(preview).queryAllByRole('textbox')).toHaveLength(0);
    }
    // Nothing read or written for a line that does not exist yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const urls = mocked.get.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => /undefined|null|\/\/|\/budget-lines\/new\b/.test(url))).toEqual([]);
    expect(mocked.post).not.toHaveBeenCalled();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('shows the error under the empty title on Create, nothing created', async () => {
    await startNewLine();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('common:creation.titleRequired')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('textbox', { name: TITLE })).toHaveFocus());
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('creates the line from its title with the defaults, then opens every tab', async () => {
    await startNewLine();
    await createMonitoring();
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(mocked.post).toHaveBeenCalledWith('/budget-lines/creation', {
      nature: 'opex', product_name: 'Monitoring', currency: 'CHF', effective_start: TODAY,
    });
    for (const tab of screen.getAllByRole('tab')) expect(tab).not.toBeDisabled();
    expect(screen.queryByTestId('creation-preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'common:buttons.create' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.close' })).toBeNull();
    // The type comes from the new page's address: no change while it is being created.
    expect(screen.queryByRole('button', { name: 'budget.changeType' })).toBeNull();
  });

  it('names the missing fields on Create, marks them and stays on the line', async () => {
    renderPage(['/start'], { incomplete: ['paying_company', 'account'] });
    fireEvent.click(await screen.findByRole('button', { name: 'new line' }));
    await createMonitoring();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('budget.creation.missing(fields=opex.fields.payingCompany, opex.fields.account)')).toBeTruthy();
    expect(mocked.post).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}/creation/complete`, { token: 'token-1' });
    expect(location()).toBe('/ops/budget/BL-12/overview');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'opex.fields.payingCompany' })).toHaveFocus());
  });

  it('keeps and closes a complete line on Create, back where the creation started', async () => {
    await startNewLine();
    await createMonitoring();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it('deletes a line with only its title on Cancel, without asking', async () => {
    await startNewLine();
    await createMonitoring();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.cancel' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.get).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}/creation`, { params: { token: 'token-1' } });
    expect(mocked.delete).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}/creation`, { data: { token: 'token-1' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before cancelling a line that holds amounts', async () => {
    renderPage(['/ops/budget/new/overview?nature=opex'], { changes: { fields: 1, children: { version: 1, amounts: 2 } } });
    await createMonitoring();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.cancel' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/common:creation\.confirmMessage/).textContent).toContain(
      'changes=common:creation.changes.fields(count=1), common:creation.changes.versions(count=1), common:creation.changes.amounts(count=2)',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}/creation`, { data: { token: 'token-1' } }));
  });

  it('asks before leaving a line being created that lacks a field: complete it, or delete it', async () => {
    await startNewLine();
    await createMonitoring();
    // The back arrow: the line lacks its paying company and its account.
    fireEvent.click(screen.getByRole('button', { name: 'budget.title' }));
    let dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('ops:budget.creation.missing(fields=opex.fields.payingCompany, opex.fields.account)')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'ops:budget.creation.leaveComplete' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(location()).toBe('/ops/budget/BL-12/overview');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'opex.fields.payingCompany' })).toHaveFocus());

    fireEvent.click(screen.getByRole('button', { name: 'budget.title' }));
    dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'ops:budget.creation.leaveDelete' }));
    await waitFor(() => expect(location()).toBe('/ops/budget'));
    expect(mocked.delete).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}/creation`, { data: { token: 'token-1' } });
  });

  it('shows what a line left incomplete lacks, and asks before it is left', async () => {
    renderPage(['/ops/budget/BL-12/overview']);
    expect(await screen.findByTestId('line-incomplete')).toHaveTextContent('budget.creation.missing(fields=opex.fields.payingCompany, opex.fields.account)');
    // Not being created: the close button, no Create or Cancel.
    expect(screen.getByRole('button', { name: 'common:buttons.close' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.create' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'ops:budget.creation.leaveAnyway' }));
    await waitFor(() => expect(location()).toBe('/ops/budget'));
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it('shows no Delete beside Cancel while the line is being created, and Delete once it is left', async () => {
    access.admin = true;
    await startNewLine();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
    await createMonitoring();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
    cleanup();
    renderPage(['/ops/budget/BL-12/overview'], { line: { paying_company_id: 'company-1', account_id: 'account-1' } });
    await screen.findByRole('button', { name: TITLE });
    expect(screen.getByRole('button', { name: 'common:buttons.delete' })).toBeTruthy();
  });

  it('says nothing on a line that has its company', async () => {
    renderPage(['/ops/budget/BL-12/overview'], { line: { paying_company_id: 'company-1', account_id: 'account-1' } });
    await screen.findByRole('button', { name: TITLE });
    expect(screen.queryByTestId('line-incomplete')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    await waitFor(() => expect(location()).toBe('/ops/budget'));
  });

  it('fills the one company a limited access allows', async () => {
    access.limited = true;
    access.start = { ready: true, companyId: 'company-1', needsChoice: false };
    await startNewLine();
    await createMonitoring();
    expect(mocked.post.mock.calls[0][1]).toMatchObject({ paying_company_id: 'company-1' });
  });

  it('asks a limited person for the place before the title creates the line', async () => {
    access.limited = true;
    access.start = { ready: true, companyId: null, needsChoice: true };
    await startNewLine();
    await commitTitle();
    expect(await screen.findByText('budget.creation.placeFirst')).toBeTruthy();
    expect(mocked.post).not.toHaveBeenCalled();
    // The place is live on the new page.
    const company = screen.getByRole('textbox', { name: 'opex.fields.payingCompany' });
    expect(company.closest('[data-testid="creation-preview"]')).toBeNull();
    fireEvent.change(company, { target: { value: 'company-2' } });
    await waitFor(() => expect(location()).toBe('/ops/budget/BL-12/overview'));
    expect(mocked.post.mock.calls[0][1]).toMatchObject({ paying_company_id: 'company-2', cost_center_id: null });
  });

  it('takes Ctrl+S as Create on the new page: the empty title is asked for', async () => {
    const input = await startNewLine();
    fireEvent.keyDown(input, { key: 's', ctrlKey: true });
    expect(await screen.findByText('common:creation.titleRequired')).toBeTruthy();
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('leaves the new page on Escape in the empty title, to where it started', async () => {
    const input = await startNewLine();
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.post).not.toHaveBeenCalled();
  });
});
