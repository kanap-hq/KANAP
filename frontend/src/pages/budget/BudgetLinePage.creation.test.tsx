import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { Link, MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
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

// A budget line born complete (lot L3a, decision D36): the new page is a draft whose title and
// starred fields are live, the rest dimmed; nothing is written until the title and the last starred
// field are given, then one POST /budget-lines writes it all and the page becomes the line, with
// Done and Cancel. Create on an incomplete draft marks what is missing; a refusal is said on its
// field. Leaving the draft writes nothing.

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
const access = vi.hoisted(() => ({
  limited: false,
  admin: false,
  start: { ready: true, companyId: null as string | null, needsChoice: false },
  /** The companies a limited access opens only through their cost centers. */
  centreOnly: [] as string[],
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    profile: { id: 'me' },
    dataAccess: access.limited ? { available: true, mode: 'limited' as const, nodes: [], modules: ['budget'] } : null,
    hasLevel: (_resource: string, level: string) => access.admin || level !== 'admin',
  }),
}));
vi.mock('../../hooks/usePlacementOptions', () => ({
  useLinePlacementFilter: (companyId: string | null) => (access.limited
    ? { companyIds: new Set(['company-1', 'company-2']), isCostCenterAllowed: () => true, costCenterRequired: !!companyId && access.centreOnly.includes(companyId) }
    : null),
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
// The pickers: a plain field named by its label, which gives the typed id. A cost center
// `cc-<company>` belongs to that company.
const pickers = vi.hoisted(() => ({
  picker: ({ label, value, onChange, disabled, nature }: { label: string; value?: string | null; onChange: (v: string | null, node?: unknown) => void; disabled?: boolean; nature?: string }) => (
    <input
      aria-label={label}
      value={value ?? ''}
      disabled={disabled}
      data-nature={nature}
      onChange={(event) => {
        const v = event.target.value || null;
        onChange(v, v?.startsWith('cc-') ? { id: v, company_id: v.slice(3) } : null);
      }}
    />
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
  effective_start: YEAR_START, paying_company_id: 'company-1', account_id: 'account-1', editable: true, creation_token: 'token-1',
};
/** A dimension required for CAPEX lines only, and an optional one for both. */
const MENU_AXIS = { id: 'axis-menu', code: 'menu', name: 'Menu', description: null, sort_order: 1, is_default: false, applies_to: 'capex', required: true, status: 'enabled', disabled_at: null };
/** A dimension required for both types. */
const SITE_AXIS = { id: 'axis-site', code: 'site', name: 'Site', description: null, sort_order: 0, is_default: false, applies_to: null, required: true, status: 'enabled', disabled_at: null };
const TAG_AXIS = { id: 'axis-tag', code: 'tag', name: 'Tag', description: null, sort_order: 2, is_default: false, applies_to: null, required: false, status: 'enabled', disabled_at: null };
const ACCOUNT_CHART_REFUSAL = 'Selected account does not belong to the paying company\'s Chart of Accounts';

/** The label of a field of the properties panel, by its text. */
function fieldLabel(text: string): HTMLElement {
  const label = [...document.querySelectorAll<HTMLElement>('.kanap-field-label')].find((el) => el.textContent?.startsWith(text));
  if (!label) throw new Error(`no label ${text}`);
  return label;
}

/** Whether the row of a field is dimmed and out of reach. */
function dimmed(text: string): boolean {
  return !!fieldLabel(text).closest('[data-testid="creation-preview"]');
}

/** The row of a field: its label, its control and the line under it. */
function fieldRow(text: string): HTMLElement {
  return fieldLabel(text).parentElement as HTMLElement;
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
  /** The stored line, on top of the created one. */
  line?: Record<string, unknown>;
  /** The dimensions of the tenant. */
  axes?: unknown[];
  /** The refusals of POST /budget-lines, one per call, before it writes. */
  refusals?: Array<{ status: number; data: Record<string, unknown> }>;
  /** The dimension values the lookup by ids reads (`GET /analytics-categories/lookup?ids=`). */
  values?: Array<{ id: string; axis_id: string; name: string; applies_to: 'opex' | 'capex' | null }>;
};

/** The line as the server holds it: the creation writes it, each PATCH changes it. */
const server: { line: Record<string, unknown> } = { line: {} };

/** The dimensions of a body (`{ axisId: categoryId }`) as the detail lists them. */
function valueList(values: unknown): Array<{ axis_id: string; category_id: string | null }> {
  return Object.entries((values ?? {}) as Record<string, string | null>)
    .filter(([, id]) => !!id)
    .map(([axisId, id]) => ({ axis_id: axisId, category_id: id }));
}

function renderPage(entries: string[], options: Options = {}) {
  const changes = options.changes ?? { fields: 0, children: {} };
  const refusals = [...(options.refusals ?? [])];
  const { creation_token: _token, ...detail } = created;
  server.line = { ...detail, ...options.line };
  mocked.get.mockImplementation(async (url: string, config?: { params?: unknown }) => {
    if (url === '/analytics-axes') return { data: { items: options.axes ?? [] } } as never;
    const lookupIds = (config?.params as { ids?: string } | undefined)?.ids;
    if (url === '/analytics-categories/lookup' && lookupIds) {
      const ids = lookupIds.split(',');
      return { data: { items: (options.values ?? []).filter((value) => ids.includes(value.id)), has_more: false } } as never;
    }
    if (url === '/budget-lines/BL-12' || url === `/budget-lines/${ITEM_ID}`) return { data: server.line } as never;
    if (url === '/budget-lines/resolve/BL-12') return { data: { id: ITEM_ID, nature: server.line.nature, reference: 'BL-12' } } as never;
    if (url === `/budget-lines/${ITEM_ID}/creation`) return { data: { changes } } as never;
    // Two charts: company-1 and its accounts on chart A, company-2 on chart B; `account-capex` is for CAPEX lines only.
    if (url.startsWith('/companies/')) return { data: { coa_id: url.endsWith('company-2') ? 'coa-b' : 'coa-a' } } as never;
    if (url.startsWith('/accounts/')) return { data: { coa_id: 'coa-a', nature: url.endsWith('-capex') ? 'capex' : url.endsWith('-opex') ? 'opex' : null } } as never;
    return { data: {} } as never;
  });
  mocked.post.mockImplementation(async (url: string, body?: unknown) => {
    if (url === '/budget-lines') {
      const refusal = refusals.shift();
      if (refusal) throw { response: refusal };
      const { analytics_values: values, ...fields } = body as Record<string, unknown>;
      server.line = { ...server.line, ...fields, analytics_values: valueList(values) };
      return { data: { ...server.line, creation_token: 'token-1' } } as never;
    }
    return { data: {} } as never;
  });
  mocked.patch.mockImplementation(async (_url: string, body?: unknown) => {
    const { base: _base, analytics_values: values, ...fields } = body as Record<string, unknown>;
    server.line = { ...server.line, ...fields };
    if (values) {
      const kept = (server.line.analytics_values as Array<{ axis_id: string }> | undefined ?? [])
        .filter((entry) => !(entry.axis_id in (values as object)));
      server.line.analytics_values = [...kept, ...valueList(values)];
    }
    return { data: server.line } as never;
  });
  mocked.delete.mockResolvedValue({ data: undefined } as never);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={entries}>
            <NavigationTracker />
            <Location />
            <nav><Link to="/start">menu start</Link></nav>
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

async function startNewLine(options: Options = {}) {
  renderPage(['/start'], options);
  fireEvent.click(await screen.findByRole('button', { name: 'new line' }));
  return screen.findByRole('textbox', { name: TITLE_FIELD });
}

async function giveTitle(name = 'Monitoring') {
  const input = await screen.findByRole('textbox', { name: TITLE_FIELD });
  fireEvent.change(input, { target: { value: name } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

const field = (label: string) => screen.getByRole('textbox', { name: label });

/** Gives a picker its value, as a choice in its list. */
function pick(label: string, value: string) {
  fireEvent.change(field(label), { target: { value } });
}

/** Title, company and account: the line is written. */
async function writeMonitoring() {
  await giveTitle();
  pick('opex.fields.payingCompany', 'company-1');
  await waitFor(() => expect(field('opex.fields.account')).toBeEnabled());
  pick('opex.fields.account', 'account-1');
  await waitFor(() => expect(location()).toBe('/ops/budget/BL-12/overview'));
  await screen.findByRole('button', { name: TITLE });
}

const lineWrites = () => mocked.post.mock.calls.filter(([url]) => url === '/budget-lines');

describe('Budget line born complete', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetCreationStore();
    resetNavigationTracker();
    resetSharedPatchBuffers();
    access.limited = false;
    access.admin = false;
    access.start = { ready: true, companyId: null, needsChoice: false };
    access.centreOnly = [];
  });

  it('opens with the title and the starred rows live, the rest dimmed, with Create and Cancel', async () => {
    const input = await startNewLine({ axes: [MENU_AXIS, TAG_AXIS] });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('placeholder', 'opex.workspace.newSpendItem');
    expect(screen.getByRole('button', { name: 'common:buttons.create' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.close' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'opex.tabs.budget' })).toBeDisabled();
    await screen.findByText('Tag');
    // Live, in the panel's order: the type, the cost center, the company, the account (waiting for
    // the company), the currency and the start, with their defaults.
    expect(screen.getByRole('combobox', { name: 'budget.type' }).closest('[data-testid="creation-preview"]')).toBeNull();
    for (const label of ['opex.fields.costCenter', 'opex.fields.payingCompany', 'opex.fields.account', 'opex.fields.currency', 'opex.fields.effectiveStart']) {
      expect(dimmed(label), label).toBe(false);
    }
    expect(field('opex.fields.payingCompany')).toBeEnabled();
    expect(field('opex.fields.account')).toBeDisabled();
    expect((within(fieldRow('opex.fields.currency')).getByRole('combobox') as HTMLInputElement).value).toContain('CHF');
    expect(within(fieldRow('opex.fields.effectiveStart')).getByRole('textbox')).toHaveValue(formatShortDate(YEAR_START, 'en', { year: 'always' }));
    // Dimmed, out of reach: the supplier, a dimension not required for the type, run or build, the lifecycle.
    for (const label of ['opex.fields.supplier', 'Tag', 'opex.fields.runBuild', 'opex.fields.created']) {
      expect(dimmed(label), label).toBe(true);
    }
    // Menu applies to CAPEX lines only: an OPEX line does not show it.
    expect(screen.queryByText('Menu')).toBeNull();
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
    expect(within(fieldRow('opex.fields.effectiveStart')).getByRole('textbox')).toHaveValue(formatShortDate('2027-01-01', 'en', { year: 'always' }));
    await giveTitle();
    pick('opex.fields.payingCompany', 'company-1');
    pick('opex.fields.account', 'account-1');
    await waitFor(() => expect(lineWrites()).toHaveLength(1));
    expect(lineWrites()[0][1]).toMatchObject({ effective_start: '2027-01-01' });
  });

  it('writes nothing for a title alone', async () => {
    await startNewLine();
    await giveTitle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocked.post).not.toHaveBeenCalled();
    expect(location()).toBe('/ops/budget/new/overview?nature=opex');
  });

  it('writes the line once its title, company and account are given, in one POST, then opens it with Done and Cancel', async () => {
    await startNewLine();
    await writeMonitoring();
    expect(lineWrites()).toHaveLength(1);
    expect(lineWrites()[0][1]).toEqual({
      nature: 'opex', product_name: 'Monitoring', currency: 'CHF', effective_start: YEAR_START,
      paying_company_id: 'company-1', account_id: 'account-1',
    });
    expect(mocked.patch).not.toHaveBeenCalled();
    for (const tab of screen.getAllByRole('tab')) expect(tab).not.toBeDisabled();
    expect(screen.queryByTestId('creation-preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'common:buttons.done' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    // Once written, the type changes through the usual dialog.
    expect(screen.queryByRole('combobox', { name: 'budget.type' })).toBeNull();
    expect(screen.getByRole('button', { name: 'budget.changeType' })).toBeTruthy();
  });

  it('writes a CAPEX line with the value of the dimension its type requires', async () => {
    await startNewLine({ axes: [MENU_AXIS] });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'budget.type' }));
    fireEvent.click(await screen.findByRole('option', { name: 'budget.typeCapex' }));
    await waitFor(() => expect(location()).toBe('/ops/budget/new/overview?nature=capex'));
    expect(await screen.findByRole('textbox', { name: TITLE_FIELD })).toHaveAttribute('placeholder', 'capex.workspace.newCapexItem');
    expect(dimmed('Menu')).toBe(false);
    await giveTitle('Server');
    pick('opex.fields.payingCompany', 'company-1');
    pick('opex.fields.account', 'account-1');
    expect(field('opex.fields.account')).toHaveAttribute('data-nature', 'capex');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocked.post).not.toHaveBeenCalled();
    pick('Menu', 'value-starter');
    await waitFor(() => expect(lineWrites()).toHaveLength(1));
    expect(lineWrites()[0][1]).toMatchObject({ nature: 'capex', product_name: 'Server', analytics_values: { 'axis-menu': 'value-starter' } });
  });

  it('marks what is missing on Create, calls nothing and puts the cursor in the first one', async () => {
    await startNewLine();
    await giveTitle();
    pick('opex.fields.payingCompany', 'company-1');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(field('opex.fields.account')).toHaveFocus());
    expect(mocked.post).not.toHaveBeenCalled();
    expect(fieldLabel('opex.fields.account')).toHaveAttribute('data-missing');
    expect(field('opex.fields.account')).toHaveAttribute('aria-invalid', 'true');
    expect(fieldLabel('opex.fields.payingCompany')).not.toHaveAttribute('data-missing');
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(screen.getAllByRole('status').map((node) => node.textContent).join('')).toContain(
      'common:creation.missingFields(fields=opex.fields.account)',
    ));
    // The account given, the mark goes and the line is written.
    pick('opex.fields.account', 'account-1');
    await waitFor(() => expect(location()).toBe('/ops/budget/BL-12/overview'));
    expect(lineWrites()).toHaveLength(1);
  });

  it('shows the error under the empty title on Create, nothing written', async () => {
    await startNewLine();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('common:creation.titleRequired')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('textbox', { name: TITLE_FIELD })).toHaveFocus());
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('changes the type of the draft only: an account of the other type goes, the dimensions follow the type', async () => {
    await startNewLine({ axes: [SITE_AXIS, MENU_AXIS] });
    await giveTitle();
    pick('opex.fields.payingCompany', 'company-1');
    pick('opex.fields.account', 'account-opex');
    expect(screen.queryByText('Menu')).toBeNull();
    expect(dimmed('Site')).toBe(false);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'budget.type' }));
    fireEvent.click(await screen.findByRole('option', { name: 'budget.typeCapex' }));
    // CAPEX: the account kept for OPEX lines is emptied, Menu is now asked for.
    await waitFor(() => expect(field('opex.fields.account')).toHaveValue(''));
    expect(mocked.get).toHaveBeenCalledWith('/accounts/account-opex');
    expect(field('opex.fields.account')).toHaveAttribute('data-nature', 'capex');
    expect(dimmed('Menu')).toBe(false);
    expect(field('opex.fields.payingCompany')).toHaveValue('company-1');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(fieldLabel('opex.fields.account')).toHaveAttribute('data-missing'));
    expect(fieldLabel('Site')).toHaveAttribute('data-missing');
    expect(fieldLabel('Menu')).toHaveAttribute('data-missing');
    expect(location()).toBe('/ops/budget/new/overview?nature=capex');
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('keeps an account that suits both types on a change of type', async () => {
    await startNewLine({ axes: [SITE_AXIS] });
    await giveTitle();
    pick('opex.fields.payingCompany', 'company-1');
    pick('opex.fields.account', 'account-any');
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'budget.type' }));
    fireEvent.click(await screen.findByRole('option', { name: 'budget.typeCapex' }));
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/accounts/account-any'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(field('opex.fields.account')).toHaveValue('account-any');
    pick('Site', 'site-1');
    await waitFor(() => expect(lineWrites()).toHaveLength(1));
    expect(lineWrites()[0][1]).toMatchObject({ nature: 'capex', account_id: 'account-any', analytics_values: { 'axis-site': 'site-1' } });
  });

  it('writes nothing with an account of the other type when a change of type completes the draft', async () => {
    await startNewLine({ axes: [MENU_AXIS] });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'budget.type' }));
    fireEvent.click(await screen.findByRole('option', { name: 'budget.typeCapex' }));
    await waitFor(() => expect(location()).toBe('/ops/budget/new/overview?nature=capex'));
    await giveTitle('Server');
    pick('opex.fields.payingCompany', 'company-1');
    pick('opex.fields.account', 'account-capex');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocked.post).not.toHaveBeenCalled();
    // OPEX: Menu is not asked for any more, and the account kept for CAPEX lines goes before anything is written.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'budget.type' }));
    fireEvent.click(await screen.findByRole('option', { name: 'budget.typeOpex' }));
    await waitFor(() => expect(field('opex.fields.account')).toHaveValue(''));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lineWrites()).toEqual([]);
    expect(within(fieldRow('opex.fields.account')).queryByText(/lines only/)).toBeNull();
    // An account for OPEX lines: the line is written.
    pick('opex.fields.account', 'account-opex');
    await waitFor(() => expect(lineWrites()).toHaveLength(1));
    expect(lineWrites()[0][1]).toMatchObject({ nature: 'opex', account_id: 'account-opex' });
  });

  it('writes nothing with an account of another chart when the company of a refused draft changes', async () => {
    await startNewLine({ refusals: [{ status: 400, data: { statusCode: 400, message: 'Something went wrong.' } }] });
    await giveTitle();
    pick('opex.fields.payingCompany', 'company-1');
    pick('opex.fields.account', 'account-1');
    await waitFor(() => expect(lineWrites()).toHaveLength(1));
    await screen.findByText('Something went wrong.');
    // company-2 is on another chart than account-1: the account goes before anything is written.
    pick('opex.fields.payingCompany', 'company-2');
    await waitFor(() => expect(field('opex.fields.account')).toHaveValue(''));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lineWrites()).toHaveLength(1);
  });

  it('drops a dimension value of the other type when the type changes, before anything is written', async () => {
    await startNewLine({
      axes: [SITE_AXIS, MENU_AXIS],
      values: [
        { id: 'site-capex', axis_id: 'axis-site', name: 'Plant', applies_to: 'capex' },
        { id: 'site-any', axis_id: 'axis-site', name: 'Head office', applies_to: null },
      ],
    });
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'budget.type' }));
    fireEvent.click(await screen.findByRole('option', { name: 'budget.typeCapex' }));
    await waitFor(() => expect(location()).toBe('/ops/budget/new/overview?nature=capex'));
    await giveTitle('Server');
    pick('opex.fields.payingCompany', 'company-1');
    pick('opex.fields.account', 'account-any');
    pick('Site', 'site-capex');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocked.post).not.toHaveBeenCalled();
    // OPEX: Menu is not asked for any more; the value kept for CAPEX lines goes, Site is asked for again.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'budget.type' }));
    fireEvent.click(await screen.findByRole('option', { name: 'budget.typeOpex' }));
    await waitFor(() => expect(field('Site')).toHaveValue(''));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lineWrites()).toEqual([]);
    pick('Site', 'site-any');
    await waitFor(() => expect(lineWrites()).toHaveLength(1));
    expect(lineWrites()[0][1]).toMatchObject({ nature: 'opex', account_id: 'account-any', analytics_values: { 'axis-site': 'site-any' } });
  });

  it('says a refused dimension value under its dimension', async () => {
    const refusal = 'Plant is for CAPEX lines only. Choose a value for OPEX lines.';
    await startNewLine({
      axes: [SITE_AXIS],
      values: [{ id: 'site-capex', axis_id: 'axis-site', name: 'Plant', applies_to: 'capex' }],
      refusals: [{ status: 400, data: { statusCode: 400, message: refusal } }],
    });
    await giveTitle();
    pick('opex.fields.payingCompany', 'company-1');
    pick('opex.fields.account', 'account-1');
    pick('Site', 'site-capex');
    await waitFor(() => expect(within(fieldRow('Site')).getByText(refusal)).toBeTruthy());
    expect(fieldLabel('Site')).toHaveAttribute('data-missing');
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says a refusal of the account on its field, keeps the draft and does not try it again', async () => {
    await startNewLine({ refusals: [{ status: 400, data: { statusCode: 400, message: ACCOUNT_CHART_REFUSAL } }] });
    await giveTitle();
    pick('opex.fields.payingCompany', 'company-1');
    pick('opex.fields.account', 'account-elsewhere');
    await waitFor(() => expect(within(fieldRow('opex.fields.account')).getByText(ACCOUNT_CHART_REFUSAL)).toBeTruthy());
    expect(fieldLabel('opex.fields.account')).toHaveAttribute('data-missing');
    expect(location()).toBe('/ops/budget/new/overview?nature=opex');
    expect(screen.queryByRole('alert')).toBeNull();
    // The same draft is not sent again: the title given again, a field left as it is.
    await giveTitle();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(lineWrites()).toHaveLength(1);
    // Another account: the message goes and the line is written.
    pick('opex.fields.account', 'account-1');
    await waitFor(() => expect(location()).toBe('/ops/budget/BL-12/overview'));
    expect(lineWrites()).toHaveLength(2);
  });

  it('keeps what is typed while the line is written, and saves it on the line', async () => {
    await startNewLine();
    let answer: (value: unknown) => void = () => undefined;
    mocked.post.mockImplementationOnce(async (_url: string, body?: unknown) => new Promise((resolve) => {
      answer = () => resolve({ data: { ...server.line, ...(body as object), creation_token: 'token-1' } });
    }) as never);
    await giveTitle();
    pick('opex.fields.payingCompany', 'company-1');
    pick('opex.fields.account', 'account-1');
    await waitFor(() => expect(lineWrites()).toHaveLength(1));
    pick('opex.fields.costCenter', 'cc-company-1');
    await act(async () => { answer(undefined); });
    await waitFor(() => expect(location()).toBe('/ops/budget/BL-12/overview'));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}`, { cost_center_id: 'cc-company-1' }));
    expect(field('opex.fields.costCenter')).toHaveValue('cc-company-1');
  });

  it('saves on the line a dimension changed while the line is written', async () => {
    await startNewLine({ axes: [SITE_AXIS] });
    let answer: () => void = () => undefined;
    mocked.post.mockImplementationOnce(async (_url: string, body?: unknown) => new Promise((resolve) => {
      answer = () => {
        const { analytics_values: values, ...fields } = body as Record<string, unknown>;
        server.line = { ...server.line, ...fields, analytics_values: valueList(values) };
        resolve({ data: { ...server.line, creation_token: 'token-1' } });
      };
    }) as never);
    await giveTitle();
    pick('opex.fields.payingCompany', 'company-1');
    pick('opex.fields.account', 'account-1');
    pick('Site', 'site-1');
    await waitFor(() => expect(lineWrites()).toHaveLength(1));
    expect(lineWrites()[0][1]).toMatchObject({ analytics_values: { 'axis-site': 'site-1' } });
    pick('Site', 'site-2');
    await act(async () => { answer(); });
    await waitFor(() => expect(location()).toBe('/ops/budget/BL-12/overview'));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}`, { analytics_values: { 'axis-site': 'site-2' } }));
    expect(lineWrites()).toHaveLength(1);
    await waitFor(() => expect(field('Site')).toHaveValue('site-2'));
  });

  it('holds the type while the line is written: the line keeps the type it was sent with', async () => {
    await startNewLine();
    let answer: () => void = () => undefined;
    mocked.post.mockImplementationOnce(async (_url: string, body?: unknown) => new Promise((resolve) => {
      answer = () => resolve({ data: { ...server.line, ...(body as object), creation_token: 'token-1' } });
    }) as never);
    await giveTitle();
    pick('opex.fields.payingCompany', 'company-1');
    // The menu of types is open when the last field is given.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'budget.type' }));
    const capex = await screen.findByRole('option', { name: 'budget.typeCapex' });
    // The open menu hides the page from the accessibility tree.
    fireEvent.change(screen.getByRole('textbox', { name: 'opex.fields.account', hidden: true }), { target: { value: 'account-1' } });
    await waitFor(() => expect(lineWrites()).toHaveLength(1));
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'budget.type', hidden: true })).toHaveAttribute('aria-disabled', 'true'));
    fireEvent.click(capex);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(location()).toBe('/ops/budget/new/overview?nature=opex');
    await act(async () => { answer(); });
    await waitFor(() => expect(location()).toBe('/ops/budget/BL-12/overview'));
    expect(lineWrites()[0][1]).toMatchObject({ nature: 'opex' });
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(mocked.get).not.toHaveBeenCalledWith('/accounts/account-1');
  });

  it('gives a cost center its company when the company is empty', async () => {
    await startNewLine();
    pick('opex.fields.costCenter', 'cc-company-2');
    await waitFor(() => expect(field('opex.fields.payingCompany')).toHaveValue('company-2'));
    expect(field('opex.fields.account')).toBeEnabled();
  });

  it('writes nothing when the draft is left by the menu, and asks nothing', async () => {
    await startNewLine();
    await giveTitle();
    pick('opex.fields.payingCompany', 'company-1');
    fireEvent.click(screen.getByRole('link', { name: 'menu start' }));
    await waitFor(() => expect(location()).toBe('/start'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocked.post).not.toHaveBeenCalled();
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it('leaves the new page on one Escape with a title typed, nothing written', async () => {
    const input = await startNewLine();
    fireEvent.change(input, { target: { value: 'Monitoring' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(location()).toBe('/start'));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('deletes the line on Cancel right after it is written, without asking', async () => {
    await startNewLine();
    await writeMonitoring();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.cancel' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.get).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}/creation`, { params: { token: 'token-1' } });
    expect(mocked.delete).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}/creation`, { data: { token: 'token-1' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before cancelling a line that holds amounts', async () => {
    await startNewLine({ changes: { fields: 1, children: { version: 1, amounts: 2 } } });
    await writeMonitoring();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.cancel' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/common:creation\.confirmMessage/).textContent).toContain(
      'changes=common:creation.changes.fields(count=1), common:creation.changes.versions(count=1), common:creation.changes.amounts(count=2)',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}/creation`, { data: { token: 'token-1' } }));
  });

  it('keeps and closes the line on Done, back where the creation started', async () => {
    await startNewLine();
    await writeMonitoring();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.done' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(lineWrites()).toHaveLength(1);
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it('takes Ctrl+S as Done on the line just written', async () => {
    await startNewLine();
    await writeMonitoring();
    fireEvent.keyDown(document.body, { key: 's', ctrlKey: true });
    await waitFor(() => expect(location()).toBe('/start'));
  });

  it('marks on Done a starred field emptied after the writing, and stays', async () => {
    await startNewLine();
    await writeMonitoring();
    // A company on another chart empties the account in the same write.
    pick('opex.fields.payingCompany', 'company-2');
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}`, expect.objectContaining({ paying_company_id: 'company-2', account_id: null })));
    await waitFor(() => expect(field('opex.fields.account')).toHaveValue(''));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.done' }));
    await waitFor(() => expect(field('opex.fields.account')).toHaveFocus());
    expect(fieldLabel('opex.fields.account')).toHaveAttribute('data-missing');
    expect(location()).toBe('/ops/budget/BL-12/overview');
  });

  it('creates a line from the keyboard alone: title, Tab, company, Tab, account', async () => {
    const input = await startNewLine();
    fireEvent.change(input, { target: { value: 'Monitoring' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    await waitFor(() => expect(field('opex.fields.payingCompany')).toHaveFocus());
    pick('opex.fields.payingCompany', 'company-1');
    fireEvent.keyDown(field('opex.fields.payingCompany'), { key: 'Tab' });
    await waitFor(() => expect(field('opex.fields.account')).toHaveFocus());
    pick('opex.fields.account', 'account-1');
    await waitFor(() => expect(location()).toBe('/ops/budget/BL-12/overview'));
    expect(lineWrites()).toHaveLength(1);
  });

  it('keeps the red labels of a line stored without company, editable, and leaves it without asking', async () => {
    renderPage(['/ops/budget/BL-12/overview'], { line: { paying_company_id: null, account_id: null } });
    await waitFor(() => expect(fieldLabel('opex.fields.payingCompany')).toHaveAttribute('data-missing'));
    expect(fieldLabel('opex.fields.account')).toHaveAttribute('data-missing');
    expect(field('opex.fields.payingCompany')).toBeEnabled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('button', { name: 'common:buttons.close' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.create' })).toBeNull();
    pick('opex.fields.payingCompany', 'company-1');
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith(`/budget-lines/${ITEM_ID}`, expect.objectContaining({ paying_company_id: 'company-1' })));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    await waitFor(() => expect(location()).toBe('/ops/budget'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it('shows no Delete beside Cancel while the line is being created, and Delete once it is left', async () => {
    access.admin = true;
    await startNewLine();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
    await writeMonitoring();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
    cleanup();
    renderPage(['/ops/budget/BL-12/overview']);
    await screen.findByRole('button', { name: TITLE });
    expect(screen.getByRole('button', { name: 'common:buttons.delete' })).toBeTruthy();
  });

  it('fills the one company a limited access allows', async () => {
    access.limited = true;
    access.start = { ready: true, companyId: 'company-1', needsChoice: false };
    await startNewLine();
    expect(field('opex.fields.payingCompany')).toHaveValue('company-1');
    await giveTitle();
    pick('opex.fields.account', 'account-1');
    await waitFor(() => expect(lineWrites()).toHaveLength(1));
    expect(lineWrites()[0][1]).toMatchObject({ paying_company_id: 'company-1', account_id: 'account-1' });
  });

  it('asks a limited person for a cost center when the company is open only through its cost centers', async () => {
    access.limited = true;
    access.start = { ready: true, companyId: null, needsChoice: true };
    access.centreOnly = ['company-2'];
    await startNewLine();
    await giveTitle();
    pick('opex.fields.payingCompany', 'company-2');
    pick('opex.fields.account', 'account-1');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocked.post).not.toHaveBeenCalled();
    expect(fieldLabel('opex.fields.costCenter').closest('[data-required-field]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(fieldLabel('opex.fields.costCenter')).toHaveAttribute('data-missing'));
    await waitFor(() => expect(field('opex.fields.costCenter')).toHaveFocus());
    pick('opex.fields.costCenter', 'cc-company-2');
    await waitFor(() => expect(lineWrites()).toHaveLength(1));
    expect(lineWrites()[0][1]).toMatchObject({ paying_company_id: 'company-2', cost_center_id: 'cc-company-2' });
  });

  it('says a refused place on its field', async () => {
    access.limited = true;
    access.start = { ready: true, companyId: null, needsChoice: true };
    await startNewLine({ refusals: [{ status: 403, data: { statusCode: 403, code: 'DATA_ACCESS_LIMITED', message: 'This company or cost center is not part of your access.' } }] });
    await giveTitle();
    pick('opex.fields.payingCompany', 'company-3');
    pick('opex.fields.account', 'account-1');
    await waitFor(() => expect(within(fieldRow('opex.fields.payingCompany')).getByText(/placement|not part of your access/)).toBeTruthy());
    expect(location()).toBe('/ops/budget/new/overview?nature=opex');
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
