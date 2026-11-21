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
import { formatShortDate } from '../../lib/dateFormat';
import BudgetLineRoute from './BudgetLineRoute';
import { TITLE_FIELD } from '../../test/titleField';

// Creation at the title (lot 1c): the title (or Create) creates the line with its defaults and
// every tab opens; Done checks the fields the line needs before it closes it; Cancel deletes it.
// Leaving the line otherwise asks while a field is missing. A person with limited access places it first.

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
  picker: ({ label, value, onChange, disabled, nature }: { label: string; value?: string | null; onChange: (v: string | null, node?: unknown) => void; disabled?: boolean; nature?: string }) => (
    <input aria-label={label} value={value ?? ''} disabled={disabled} data-nature={nature} onChange={(event) => onChange(event.target.value || null, null)} />
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
const YEAR_START = `${new Date().getFullYear()}-01-01`;
const created = {
  id: ITEM_ID, item_number: 12, reference: 'BL-12', nature: 'opex', product_name: 'Monitoring', currency: 'CHF',
  effective_start: YEAR_START, paying_company_id: null, account_id: null, editable: true, creation_token: 'token-1',
};

/** The effective start the dimmed draft shows, before the title creates the line. */
function draftEffectiveStart(): string {
  for (const preview of screen.getAllByTestId('creation-preview')) {
    const label = [...preview.querySelectorAll('.kanap-field-label')].find((el) => el.textContent?.startsWith('opex.fields.effectiveStart'));
    const input = label?.parentElement?.querySelector('input');
    if (input instanceof HTMLInputElement) return input.value;
  }
  throw new Error('draft effective start missing');
}

/** The label of a field of the properties panel, by its text. */
function fieldLabel(text: string): HTMLElement {
  const label = [...document.querySelectorAll<HTMLElement>('.kanap-field-label')].find((el) => el.textContent?.startsWith(text));
  if (!label) throw new Error(`no label ${text}`);
  return label;
}

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
  /** The account the type change check reads on the line (null: none). */
  checkAccount?: { id: string; fits: boolean } | null;
};

/** The line's type as the server holds it: the creation and the type change set it. */
const server = { nature: 'opex' };

function renderPage(entries: string[], options: Options = {}) {
  const changes = options.changes ?? { fields: 0, children: {} };
  const { creation_token: _token, ...detail } = created;
  server.nature = 'opex';
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/analytics-axes') return { data: { items: [] } } as never;
    if (url === '/budget-lines/BL-12' || url === `/budget-lines/${ITEM_ID}`) return { data: { ...detail, ...options.line, nature: server.nature } } as never;
    if (url === '/budget-lines/resolve/BL-12') return { data: { id: ITEM_ID, nature: server.nature, reference: 'BL-12' } } as never;
    if (url === `/budget-lines/${ITEM_ID}/creation`) return { data: { changes } } as never;
    if (url === `/spend-items/${ITEM_ID}/change-type/check` || url === `/capex-items/${ITEM_ID}/change-type/check`) {
      return { data: { id: ITEM_ID, row_version: 3, account: options.checkAccount ?? null } } as never;
    }
    return { data: {} } as never;
  });
  mocked.post.mockImplementation(async (url: string, body?: unknown) => {
    if (url === '/budget-lines/creation') {
      server.nature = (body as { nature: string }).nature;
      return { data: { ...created, nature: server.nature } } as never;
    }
    if (url === `/spend-items/${ITEM_ID}/change-type` || url === `/capex-items/${ITEM_ID}/change-type`) {
      server.nature = url.startsWith('/spend-items') ? 'capex' : 'opex';
      return { data: { id: ITEM_ID, reference: 'BL-12', nature: server.nature } } as never;
    }
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
  return screen.findByRole('textbox', { name: TITLE_FIELD });
}

async function commitTitle() {
  const input = await screen.findByRole('textbox', { name: TITLE_FIELD });
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
    // The draft starts on 1 January of the year the page shows (this year, no `?year=`).
    expect(draftEffectiveStart()).toBe(formatShortDate(YEAR_START, 'en', { year: 'always' }));
    // Nothing read or written for a line that does not exist yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const urls = mocked.get.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => /undefined|null|\/\/|\/budget-lines\/new\b/.test(url))).toEqual([]);
    expect(mocked.post).not.toHaveBeenCalled();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('starts the line on 1 January of the year in the address', async () => {
    renderPage(['/ops/budget/new/overview?nature=opex&year=2027']);
    await screen.findByRole('textbox', { name: TITLE_FIELD });
    expect(draftEffectiveStart()).toBe(formatShortDate('2027-01-01', 'en', { year: 'always' }));
    await commitTitle();
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/budget-lines/creation', {
      nature: 'opex', product_name: 'Monitoring', currency: 'CHF', effective_start: '2027-01-01',
    }));
  });

  it('shows the error under the empty title on Create, nothing created', async () => {
    await startNewLine();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('common:creation.titleRequired')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('textbox', { name: TITLE_FIELD })).toHaveFocus());
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('creates the line from its title with the defaults, then opens every tab', async () => {
    await startNewLine();
    await createMonitoring();
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(mocked.post).toHaveBeenCalledWith('/budget-lines/creation', {
      nature: 'opex', product_name: 'Monitoring', currency: 'CHF', effective_start: YEAR_START,
    });
    for (const tab of screen.getAllByRole('tab')) expect(tab).not.toBeDisabled();
    expect(screen.queryByTestId('creation-preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'common:buttons.done' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.close' })).toBeNull();
    // While it is being created, the type is a menu: no dialog to change it.
    expect(screen.getByRole('combobox', { name: 'budget.type' })).toHaveTextContent('budget.typeOpex');
    expect(screen.queryByRole('button', { name: 'budget.changeType' })).toBeNull();
  });

  it('creates a CAPEX line when CAPEX is picked before the title', async () => {
    await startNewLine();
    const type = screen.getByRole('combobox', { name: 'budget.type' });
    // Live beside the title, with the line to come dimmed.
    expect(type.closest('[data-testid="creation-preview"]')).toBeNull();
    fireEvent.mouseDown(type);
    fireEvent.click(await screen.findByRole('option', { name: 'budget.typeCapex' }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'budget.type' })).toHaveTextContent('budget.typeCapex'));
    expect(location()).toBe('/ops/budget/new/overview?nature=capex');
    const title = await screen.findByRole('textbox', { name: TITLE_FIELD });
    expect(title).toHaveAttribute('placeholder', 'capex.workspace.newCapexItem');
    await commitTitle();
    await waitFor(() => expect(location()).toBe('/ops/budget/BL-12/overview'));
    expect(mocked.post).toHaveBeenCalledWith('/budget-lines/creation', {
      nature: 'capex', product_name: 'Monitoring', currency: 'CHF', effective_start: YEAR_START,
    });
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'budget.type' })).toHaveTextContent('budget.typeCapex'));
    expect(screen.getByRole('textbox', { name: 'opex.fields.account' })).toHaveAttribute('data-nature', 'capex');
  });

  it('changes the type in place while the line is being created, and offers the accounts of the new type', async () => {
    await startNewLine();
    await createMonitoring();
    expect(screen.getByRole('textbox', { name: 'opex.fields.account' })).toHaveAttribute('data-nature', 'opex');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'budget.type' }));
    fireEvent.click(await screen.findByRole('option', { name: 'budget.typeCapex' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(`/spend-items/${ITEM_ID}/change-type`, { row_version: 3 }));
    expect(mocked.get).toHaveBeenCalledWith(`/spend-items/${ITEM_ID}/change-type/check`);
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'opex.fields.account' })).toHaveAttribute('data-nature', 'capex'));
    expect(screen.getByRole('combobox', { name: 'budget.type' })).toHaveTextContent('budget.typeCapex');
    // Still being created, on the same line, with no dialog.
    expect(location()).toBe('/ops/budget/BL-12/overview');
    expect(screen.getByRole('button', { name: 'common:buttons.done' })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it('applies in place a type picked while the title was writing the line', async () => {
    await startNewLine();
    let answer: (value: unknown) => void = () => undefined;
    const createdOpex = { data: created };
    mocked.post.mockImplementationOnce(async () => new Promise((resolve) => { answer = resolve; }) as never);
    await commitTitle();
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/budget-lines/creation', expect.objectContaining({ nature: 'opex' })));
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'budget.type' }));
    fireEvent.click(await screen.findByRole('option', { name: 'budget.typeCapex' }));
    answer(createdOpex);
    await waitFor(() => expect(location()).toBe('/ops/budget/BL-12/overview'));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(`/spend-items/${ITEM_ID}/change-type`, { row_version: 3 }));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'budget.type' })).toHaveTextContent('budget.typeCapex'));
  });

  it('keeps an account of the old type on a type change, marked until another one is picked', async () => {
    renderPage(['/ops/budget/new/overview?nature=opex'], { line: { paying_company_id: 'company-1', account_id: 'account-opex' }, checkAccount: { id: 'account-opex', fits: false } });
    await createMonitoring();
    const account = () => screen.getByRole('textbox', { name: 'opex.fields.account' });
    expect(account()).not.toHaveAttribute('aria-invalid', 'true');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'budget.type' }));
    fireEvent.click(await screen.findByRole('option', { name: 'budget.typeCapex' }));
    await waitFor(() => expect(account()).toHaveAttribute('data-nature', 'capex'));
    expect(account()).toHaveValue('account-opex');
    await waitFor(() => expect(account()).toHaveAttribute('aria-invalid', 'true'));
    fireEvent.change(account(), { target: { value: 'account-capex' } });
    await waitFor(() => expect(account()).not.toHaveAttribute('aria-invalid', 'true'));
  });

  it('marks the missing fields on Done, puts the cursor in the first one and stays on the line', async () => {
    renderPage(['/start'], { incomplete: ['paying_company', 'account'] });
    fireEvent.click(await screen.findByRole('button', { name: 'new line' }));
    await createMonitoring();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.done' }));
    const company = () => screen.getByRole('textbox', { name: 'opex.fields.payingCompany' });
    const account = () => screen.getByRole('textbox', { name: 'opex.fields.account' });
    await waitFor(() => expect(company()).toHaveFocus());
    // The screen sees what is missing: no call that the server would refuse.
    expect(mocked.post).not.toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}/creation/complete`, expect.anything());
    expect(location()).toBe('/ops/budget/BL-12/overview');
    // One signal: the labels in red and the fields invalid, no banner.
    expect(fieldLabel('opex.fields.payingCompany')).toHaveAttribute('data-missing');
    expect(fieldLabel('opex.fields.account')).toHaveAttribute('data-missing');
    expect(company()).toHaveAttribute('aria-invalid', 'true');
    expect(account()).toHaveAttribute('aria-invalid', 'true');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/budget\.creation\.missing/)).toBeNull();
    // Beyond the colour: an icon named Missing on each label, the fields said once, in screen order, by the page's one status.
    expect(screen.getAllByRole('img', { name: 'common:creation.missingMark' })).toHaveLength(2);
    await waitFor(() => expect(screen.getAllByRole('status').map((node) => node.textContent).join('')).toContain(
      'common:creation.missingFields(fields=opex.fields.payingCompany, opex.fields.account)',
    ));
    // A field given a value loses its mark; the other keeps it.
    fireEvent.change(company(), { target: { value: 'company-1' } });
    await waitFor(() => expect(fieldLabel('opex.fields.payingCompany')).not.toHaveAttribute('data-missing'));
    expect(company()).not.toHaveAttribute('aria-invalid', 'true');
    expect(fieldLabel('opex.fields.account')).toHaveAttribute('data-missing');
  });

  it('marks what only the server sees missing, the first field on screen first: the cost center sits above the account', async () => {
    // The screen sees nothing missing; the server refuses the account (another chart) and asks for
    // a cost center, which it names last although its row comes first.
    renderPage(['/start'], { incomplete: ['account', 'cost_center'], line: { paying_company_id: 'company-1', account_id: 'account-1' } });
    fireEvent.click(await screen.findByRole('button', { name: 'new line' }));
    await createMonitoring();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.done' }));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'opex.fields.costCenter' })).toHaveFocus());
    expect(mocked.post).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}/creation/complete`, { token: 'token-1' });
    expect(fieldLabel('opex.fields.account')).toHaveAttribute('data-missing');
    expect(location()).toBe('/ops/budget/BL-12/overview');
  });

  it('keeps and closes a complete line on Done, back where the creation started', async () => {
    renderPage(['/start'], { line: { paying_company_id: 'company-1', account_id: 'account-1' } });
    fireEvent.click(await screen.findByRole('button', { name: 'new line' }));
    await createMonitoring();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.done' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.post).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}/creation/complete`, { token: 'token-1' });
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it('creates the line on Create clicked just after the title, opens it with Done and the cursor in its first field', async () => {
    await startNewLine();
    const input = screen.getByRole('textbox', { name: TITLE_FIELD });
    fireEvent.change(input, { target: { value: 'Monitoring' } });
    const create = screen.getByRole('button', { name: 'common:buttons.create' });
    // In a browser the press blurs the title first, which commits it.
    fireEvent.pointerDown(create);
    create.focus();
    fireEvent.blur(input);
    fireEvent.click(create);
    await waitFor(() => expect(location()).toBe('/ops/budget/BL-12/overview'));
    expect(await screen.findByRole('button', { name: 'common:buttons.done' })).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'opex.fields.payingCompany' })).toHaveFocus());
    // No check yet: nothing marked, nothing asked of the server.
    expect(document.querySelector('[data-missing]')).toBeNull();
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });

  it('takes Ctrl+S as Done on the line being created', async () => {
    renderPage(['/start'], { line: { paying_company_id: 'company-1', account_id: 'account-1' } });
    fireEvent.click(await screen.findByRole('button', { name: 'new line' }));
    await createMonitoring();
    fireEvent.keyDown(document.body, { key: 's', ctrlKey: true });
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.post).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}/creation/complete`, { token: 'token-1' });
  });

  it('leaves the new page on one Escape with a title typed, nothing created', async () => {
    const input = await startNewLine();
    fireEvent.change(input, { target: { value: 'Monitoring' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(location()).toBe('/start'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocked.post).not.toHaveBeenCalled();
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

  it('marks what a line left incomplete lacks, and asks before it is left', async () => {
    renderPage(['/ops/budget/BL-12/overview']);
    await waitFor(() => expect(fieldLabel('opex.fields.payingCompany')).toHaveAttribute('data-missing'));
    expect(fieldLabel('opex.fields.account')).toHaveAttribute('data-missing');
    expect(screen.queryByRole('alert')).toBeNull();
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
    expect(document.querySelector('[data-missing]')).toBeNull();
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
