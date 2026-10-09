import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const navigateMock = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ canEdit: true }));
const EMPTY_NAV = vi.hoisted(() => ({ ids: [], index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }));
const nav = vi.hoisted(() => ({
  state: null as unknown,
  calls: [] as Array<Record<string, unknown>>,
}));
// One stable `t` (a new one per render would loop the effects); interpolated codes and counts stay visible.
const stableT = vi.hoisted(() => (key: string, options?: { code?: string; count?: number }) => {
  if (options?.code) return `${key}:${options.code}`;
  return options?.count != null ? `${key}:${options.count}` : key;
});

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => auth.canEdit, profile: { id: 'user-1' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../hooks/useAccountNav', () => ({
  useAccountNav: (params: Record<string, unknown>) => {
    nav.calls.push(params);
    return nav.state;
  },
}));

import api from '../../api';
import AccountWorkspacePage from './AccountWorkspacePage';
import { STATUS_SCOPE_PARAM } from '../../utils/statusScopeParams';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
};

const COAS = [
  { id: 'coa-fr', code: 'PCG', name: 'French chart', country_iso: 'FR', scope: 'COUNTRY', is_default: true, is_consolidation: false },
  { id: 'coa-ifrs', code: 'IFRS', name: 'Group chart', country_iso: null, scope: 'GLOBAL', is_default: false, is_global_default: true, is_consolidation: true },
];
const COAS_WITHOUT_CONSOLIDATION = COAS.map((coa) => ({ ...coa, is_consolidation: false }));

const IFRS_ACCOUNTS = [
  { id: 'i-1300', account_number: 1300, account_name: 'Impairments & write-offs', description: 'Write-downs of assets', disabled_at: null },
  { id: 'i-1400', account_number: 1400, account_name: 'Retired account', description: null, disabled_at: '2020-01-01T00:00:00.000Z' },
  { id: 'i-1200', account_number: 1200, account_name: 'Software', description: 'Intangible software', disabled_at: null },
];

const ACCOUNT = {
  id: 'acc-1',
  coa_id: 'coa-fr',
  account_number: 606100,
  account_name: 'Software subscriptions',
  native_name: 'Logiciels SaaS',
  description: 'Licences and subscriptions',
  consolidation_account_number: 1300,
  consolidation_account_name: 'Impairments & write-offs',
  consolidation_account_description: 'Write-downs of assets',
  consolidation_status: 'mapped',
  status: 'enabled',
  disabled_at: null,
};

type Routes = { account?: Record<string, unknown>; coas?: unknown[] };

/** The stored account, which the PATCH mock updates as the server would. */
const store = vi.hoisted(() => ({ account: {} as Record<string, unknown> }));

function serve({ account = ACCOUNT, coas = COAS }: Routes = {}) {
  store.account = { ...account };
  mocked.get.mockImplementation(async (url: string, config?: { params?: { coaId?: string } }) => {
    if (url === '/accounts/acc-1') return { data: store.account };
    if (url === '/accounts/acc-2') return { data: { ...ACCOUNT, id: 'acc-2', account_number: 606200, account_name: 'Cloud hosting' } };
    if (url === '/chart-of-accounts') return { data: { items: coas } };
    if (url === '/accounts' && config?.params?.coaId === 'coa-ifrs') return { data: { items: IFRS_ACCOUNTS, total: IFRS_ACCOUNTS.length } };
    return { data: { items: [] } };
  });
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>
          <Link to="/master-data/accounts/acc-2/overview">go to acc-2</Link>
          <Routes>
            <Route path="/master-data/accounts/:id/:tab" element={<AccountWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const natureSelect = () => screen.getByRole('combobox', { name: 'accounts.fields.nature' });

async function pickNature(label: string) {
  fireEvent.mouseDown(natureSelect());
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: label }));
}

const consolidationSelect = () => screen.getByRole('combobox', { name: 'accounts.fields.consolidationAccount' });

async function openConsolidation() {
  // The stored account shows once the consolidation chart's accounts are in.
  await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/accounts', expect.objectContaining({
    params: expect.objectContaining({ coaId: 'coa-ifrs', includeDisabled: 1 }),
  })));
  // The select opens once those accounts are loaded.
  await waitFor(() => expect(consolidationSelect()).not.toHaveAttribute('aria-disabled'));
  fireEvent.mouseDown(consolidationSelect());
  return screen.findByRole('listbox');
}

describe('AccountWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.canEdit = true;
    nav.state = EMPTY_NAV;
    nav.calls = [];
    serve();
    mocked.patch.mockImplementation(async (_url: string, body: Record<string, unknown>) => {
      store.account = { ...store.account, ...body };
      return { data: store.account };
    });
  });

  it('shows the account with no save or reset button', async () => {
    renderAt('/master-data/accounts/acc-1/overview');
    expect(await screen.findByText('Software subscriptions')).toBeInTheDocument();
    expect(screen.getByText('606100')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('accounts.fields.nativeName')).toHaveValue('Logiciels SaaS'));
    expect(screen.getByLabelText('accounts.fields.description')).toHaveValue('Licences and subscriptions');
    expect(screen.getByLabelText('accounts.fields.accountNumber')).toHaveValue('606100');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'accounts.fields.chartOfAccounts' })).toHaveTextContent('PCG · French chart'));
    await waitFor(() => expect(consolidationSelect()).toHaveTextContent('1300 · Impairments & write-offs'));
    expect(screen.getByTestId('consolidation-description')).toHaveTextContent('Write-downs of assets');
    expect(screen.queryByRole('button', { name: 'common:buttons.saveChanges' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'common:buttons.reset' })).toBeNull();
  });

  it('saves a name change on blur', async () => {
    renderAt('/master-data/accounts/acc-1/overview');
    fireEvent.click(await screen.findByText('Software subscriptions'));
    const input = screen.getByDisplayValue('Software subscriptions');
    fireEvent.change(input, { target: { value: 'SaaS subscriptions' } });
    expect(mocked.patch).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/accounts/acc-1', { account_name: 'SaaS subscriptions' }));
  });

  it('saves the native name and description on blur, and nothing when unchanged', async () => {
    renderAt('/master-data/accounts/acc-1/overview');
    const native = await screen.findByLabelText('accounts.fields.nativeName');
    await waitFor(() => expect(native).toHaveValue('Logiciels SaaS'));
    fireEvent.blur(native);
    fireEvent.change(native, { target: { value: ' Abonnements ' } });
    fireEvent.blur(native);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/accounts/acc-1', { native_name: 'Abonnements' }));
    const description = screen.getByLabelText('accounts.fields.description');
    fireEvent.change(description, { target: { value: '' } });
    fireEvent.blur(description);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/accounts/acc-1', { description: null }));
    expect(mocked.patch).toHaveBeenCalledTimes(2);
  });

  it('sends a field edited back to its stored value while the first save is in flight', async () => {
    let release: () => void = () => undefined;
    mocked.patch.mockImplementationOnce((_url: string, body: Record<string, unknown>) => new Promise((resolve) => {
      release = () => {
        store.account = { ...store.account, ...body };
        resolve({ data: store.account });
      };
    }));
    renderAt('/master-data/accounts/acc-1/overview');
    const native = await screen.findByLabelText('accounts.fields.nativeName');
    await waitFor(() => expect(native).toHaveValue('Logiciels SaaS'));
    fireEvent.change(native, { target: { value: 'Abonnements' } });
    fireEvent.blur(native);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    // Back to the stored value before the first save returns: the server must hear it too.
    fireEvent.change(native, { target: { value: 'Logiciels SaaS' } });
    fireEvent.blur(native);
    release();
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    expect(mocked.patch).toHaveBeenNthCalledWith(1, '/accounts/acc-1', { native_name: 'Abonnements' });
    expect(mocked.patch).toHaveBeenNthCalledWith(2, '/accounts/acc-1', { native_name: 'Logiciels SaaS' });
    await waitFor(() => expect(store.account.native_name).toBe('Logiciels SaaS'));
    // Settled, an unchanged blur sends nothing.
    fireEvent.blur(native);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mocked.patch).toHaveBeenCalledTimes(2);
  });

  it('saves a valid account number and refuses an invalid one without a request', async () => {
    renderAt('/master-data/accounts/acc-1/overview');
    const number = await screen.findByLabelText('accounts.fields.accountNumber');
    await waitFor(() => expect(number).toHaveValue('606100'));
    fireEvent.change(number, { target: { value: '60A' } });
    fireEvent.blur(number);
    expect(await screen.findByText('accounts.messages.numberInvalid')).toBeInTheDocument();
    expect(mocked.patch).not.toHaveBeenCalled();
    fireEvent.change(number, { target: { value: '606200' } });
    fireEvent.blur(number);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/accounts/acc-1', { account_number: 606200 }));
  });

  it('shows a number already used in the chart under the number field', async () => {
    mocked.patch.mockRejectedValueOnce({
      response: { status: 400, data: { message: 'An account with this number already exists in the target Chart of Accounts' } },
    });
    renderAt('/master-data/accounts/acc-1/overview');
    const number = await screen.findByLabelText('accounts.fields.accountNumber');
    await waitFor(() => expect(number).toHaveValue('606100'));
    fireEvent.change(number, { target: { value: '606200' } });
    fireEvent.blur(number);
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByLabelText('accounts.fields.accountNumber')).toHaveAttribute('aria-invalid', 'true');
    // The refused number stays in the field, to be corrected.
    expect(screen.getByLabelText('accounts.fields.accountNumber')).toHaveValue('606200');
  });

  it('moves the account to another chart on change', async () => {
    renderAt('/master-data/accounts/acc-1/overview');
    const chart = await screen.findByRole('combobox', { name: 'accounts.fields.chartOfAccounts' });
    await waitFor(() => expect(chart).toHaveTextContent('PCG · French chart'));
    fireEvent.mouseDown(chart);
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'IFRS · Group chart' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/accounts/acc-1', { coa_id: 'coa-ifrs' }));
  });

  it('saves the lifecycle from the status switch', async () => {
    renderAt('/master-data/accounts/acc-1/overview');
    await screen.findByText('Software subscriptions');
    fireEvent.click(screen.getByLabelText('statuses.enabled'));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/accounts/acc-1', expect.objectContaining({
      disabled_at: expect.any(String),
    })));
  });

  it('lists the consolidation chart accounts by number and sends only the number', async () => {
    mocked.patch.mockImplementationOnce(async (_url: string, body: Record<string, unknown>) => {
      // The server derives the name and description from the number.
      store.account = { ...store.account, ...body, consolidation_account_name: 'Software', consolidation_account_description: 'Intangible software' };
      return { data: store.account };
    });
    renderAt('/master-data/accounts/acc-1/overview');
    await screen.findByText('Software subscriptions');
    const listbox = await openConsolidation();
    const options = within(listbox).getAllByRole('option').map((option) => option.textContent);
    // "None" first, then by number; a disabled account is offered only when chosen.
    expect(options).toEqual(['accounts.consolidation.none', '1200 · Software', '1300 · Impairments & write-offs']);
    fireEvent.click(within(listbox).getByRole('option', { name: '1200 · Software' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/accounts/acc-1', { consolidation_account_number: 1200 }));
    await waitFor(() => expect(consolidationSelect()).toHaveTextContent('1200 · Software'));
    expect(screen.getByTestId('consolidation-description')).toHaveTextContent('Intangible software');
  });

  it('reads the consolidation chart again only after a write on that chart', async () => {
    const optionReads = () => mocked.get.mock.calls.filter(([url, config]) => url === '/accounts' && config?.params?.coaId === 'coa-ifrs').length;
    renderAt('/master-data/accounts/acc-1/overview');
    const native = await screen.findByLabelText('accounts.fields.nativeName');
    await waitFor(() => expect(optionReads()).toBe(1));
    fireEvent.change(native, { target: { value: 'Abonnements' } });
    fireEvent.blur(native);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    // The write refreshed the account itself, not the consolidation chart's accounts.
    await waitFor(() => expect(mocked.get.mock.calls.filter(([url]) => url === '/accounts/acc-1').length).toBe(2));
    expect(optionReads()).toBe(1);
    // The same account moved into the consolidation chart: its accounts change.
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'accounts.fields.chartOfAccounts' }));
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'IFRS · Group chart' }));
    await waitFor(() => expect(optionReads()).toBe(2));
  });

  it('keeps the consolidation account closed until the consolidation chart accounts are loaded', async () => {
    let releaseOptions: () => void = () => undefined;
    const base = mocked.get.getMockImplementation()! as (...args: any[]) => any;
    mocked.get.mockImplementation(async (url: string, config?: { params?: { coaId?: string } }) => {
      if (url === '/accounts' && config?.params?.coaId === 'coa-ifrs') {
        await new Promise<void>((resolve) => { releaseOptions = resolve; });
      }
      return base(url, config);
    });
    renderAt('/master-data/accounts/acc-1/overview');
    await screen.findByText('Software subscriptions');
    await waitFor(() => expect(consolidationSelect()).toHaveTextContent('1300 · Impairments & write-offs'));
    // Only "None" and the stored number could be offered yet: no pick may clear the mapping.
    expect(consolidationSelect()).toHaveAttribute('aria-disabled', 'true');
    releaseOptions();
    await waitFor(() => expect(consolidationSelect()).not.toHaveAttribute('aria-disabled'));
  });

  it('clears the consolidation account with "None"', async () => {
    renderAt('/master-data/accounts/acc-1/overview');
    await screen.findByText('Software subscriptions');
    const listbox = await openConsolidation();
    fireEvent.click(within(listbox).getByRole('option', { name: 'accounts.consolidation.none' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/accounts/acc-1', { consolidation_account_number: null }));
  });

  it('keeps a number missing from the consolidation chart visible, flagged, with a warning', async () => {
    serve({
      account: {
        ...ACCOUNT,
        consolidation_account_number: 9999,
        consolidation_account_name: 'Legacy group account',
        consolidation_account_description: null,
        consolidation_status: 'outside',
      },
    });
    renderAt('/master-data/accounts/acc-1/overview');
    await screen.findByText('Software subscriptions');
    await waitFor(() => expect(consolidationSelect()).toHaveTextContent('9999 · Legacy group account'));
    expect(within(consolidationSelect()).getByRole('img', { name: 'coa.outsideMarker:IFRS' })).toBeInTheDocument();
    expect(screen.getByText('accounts.consolidation.outside:IFRS')).toBeInTheDocument();
    const listbox = await openConsolidation();
    expect(within(listbox).getByRole('option', { name: /9999 · Legacy group account/ })).toBeInTheDocument();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('shows a disabled consolidation account when it is the one chosen', async () => {
    serve({
      account: { ...ACCOUNT, consolidation_account_number: 1400, consolidation_account_name: 'Retired account', consolidation_account_description: null },
    });
    renderAt('/master-data/accounts/acc-1/overview');
    await screen.findByText('Software subscriptions');
    const listbox = await openConsolidation();
    expect(within(listbox).getByRole('option', { name: /1400 · Retired account/ })).toHaveTextContent('accounts.consolidation.disabled');
    expect(screen.queryByText('accounts.consolidation.outside:IFRS')).toBeNull();
  });

  it('says where to define a consolidation chart when the tenant has none', async () => {
    // Without a consolidation chart the server gives no consolidation status.
    serve({ coas: COAS_WITHOUT_CONSOLIDATION, account: { ...ACCOUNT, consolidation_status: null } });
    renderAt('/master-data/accounts/acc-1/overview');
    const link = await screen.findByRole('link', { name: 'accounts.consolidation.noChartLink' });
    expect(link).toHaveAttribute('href', '/master-data/coa');
    expect(link.parentElement).toHaveTextContent('accounts.consolidation.noChart accounts.consolidation.noChartLink');
    expect(consolidationSelect()).toHaveAttribute('aria-disabled', 'true');
    // The stored values stay visible.
    expect(consolidationSelect()).toHaveTextContent('1300 · Impairments & write-offs');
    expect(screen.getByTestId('consolidation-description')).toHaveTextContent('Write-downs of assets');
    expect(screen.queryByText(/accounts\.consolidation\.outside/)).toBeNull();
    expect(within(consolidationSelect()).queryByRole('img')).toBeNull();
  });

  it('ignores a consolidation filter once the charts show there is no consolidation chart', async () => {
    serve({ coas: COAS_WITHOUT_CONSOLIDATION, account: { ...ACCOUNT, consolidation_status: null } });
    renderAt('/master-data/accounts/acc-1/overview?selected=coa-fr&consolidation=outside');
    await screen.findByRole('link', { name: 'accounts.consolidation.noChartLink' });
    expect(nav.calls[nav.calls.length - 1]).toEqual(expect.objectContaining({
      extraParams: { coaId: 'coa-fr', consolidationStatus: undefined },
    }));
  });

  it('shows what the account is used for and saves a new choice at once', async () => {
    renderAt('/master-data/accounts/acc-1/overview');
    await screen.findByText('Software subscriptions');
    // Null: an account for OPEX and CAPEX lines.
    expect(natureSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.both');
    await pickNature('master-data:shared.lineTypeUsage.opex');
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/accounts/acc-1', { nature: 'opex' }));
    await waitFor(() => expect(natureSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.opex'));
    await pickNature('master-data:shared.lineTypeUsage.both');
    await waitFor(() => expect(mocked.patch).toHaveBeenLastCalledWith('/accounts/acc-1', { nature: null }));
  });

  it('shows a refusal of the choice under the field', async () => {
    mocked.patch.mockRejectedValueOnce({ response: { status: 400, data: { message: 'Invalid nature.', field: 'nature' } } });
    renderAt('/master-data/accounts/acc-1/overview');
    await screen.findByText('Software subscriptions');
    await pickNature('master-data:shared.lineTypeUsage.capex');
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid nature.');
  });

  it('says how many lines of the other kind keep the account, and opens them in a new tab', async () => {
    serve({ account: { ...ACCOUNT, nature: 'opex', line_counts: { opex: 3, capex: 12 } } });
    renderAt('/master-data/accounts/acc-1/overview');
    const note = await screen.findByTestId('nature-conflict');
    expect(note).toHaveTextContent('accounts.nature.conflictCapex:12');
    const link = within(note).getByRole('link', { name: 'accounts.nature.showLines' });
    expect(link).toHaveAttribute('target', '_blank');
    const url = new URL(link.getAttribute('href') as string, 'http://kanap.test');
    // The CAPEX list on this account, every status, as a one-off view.
    expect(url.pathname).toBe('/ops/capex');
    expect(JSON.parse(url.searchParams.get('filters') as string)).toEqual({ account_id: { filterType: 'set', values: ['acc-1'] } });
    expect(url.searchParams.get(STATUS_SCOPE_PARAM)).toBe('all');
    expect(url.searchParams.get('from')).toBe('report');

    // The reverse choice: the OPEX lines keep it.
    await pickNature('master-data:shared.lineTypeUsage.capex');
    await waitFor(() => expect(screen.getByTestId('nature-conflict')).toHaveTextContent('accounts.nature.conflictOpex:3'));
    const opexLink = within(screen.getByTestId('nature-conflict')).getByRole('link', { name: 'accounts.nature.showLines' });
    expect(new URL(opexLink.getAttribute('href') as string, 'http://kanap.test').pathname).toBe('/ops/opex');

    // Both kinds allowed: no conflict left.
    await pickNature('master-data:shared.lineTypeUsage.both');
    await waitFor(() => expect(screen.queryByTestId('nature-conflict')).toBeNull());
  });

  it('says nothing when no line of the other kind uses the account', async () => {
    serve({ account: { ...ACCOUNT, nature: 'capex', line_counts: { opex: 0, capex: 4 } } });
    renderAt('/master-data/accounts/acc-1/overview');
    await screen.findByText('Software subscriptions');
    await waitFor(() => expect(natureSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.capex'));
    expect(screen.queryByTestId('nature-conflict')).toBeNull();
  });

  it('shows read-only users disabled fields and no title edit', async () => {
    auth.canEdit = false;
    renderAt('/master-data/accounts/acc-1/overview');
    const native = await screen.findByLabelText('accounts.fields.nativeName');
    expect(native).toBeDisabled();
    expect(screen.getByLabelText('accounts.fields.description')).toBeDisabled();
    expect(screen.getByLabelText('accounts.fields.accountNumber')).toBeDisabled();
    expect(screen.getByRole('combobox', { name: 'accounts.fields.chartOfAccounts' })).toHaveAttribute('aria-disabled', 'true');
    expect(consolidationSelect()).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByLabelText('statuses.enabled')).toBeDisabled();
    fireEvent.click(screen.getByText('Software subscriptions'));
    expect(screen.queryByDisplayValue('Software subscriptions')).toBeNull();
  });

  it('drops a late refusal from the account the user has left', async () => {
    let fail: (reason: unknown) => void = () => undefined;
    mocked.patch.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    renderAt('/master-data/accounts/acc-1/overview');
    const native = await screen.findByLabelText('accounts.fields.nativeName');
    await waitFor(() => expect(native).toHaveValue('Logiciels SaaS'));
    fireEvent.change(native, { target: { value: 'Autre' } });
    fireEvent.blur(native);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('link', { name: 'go to acc-2' }));
    expect(await screen.findByText('Cloud hosting')).toBeInTheDocument();
    fail({ response: { status: 400, data: { message: 'Native name refused.' } } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Native name refused.')).toBeNull();
  });

  it('walks the filtered list and goes back to it with its consolidation filter', async () => {
    nav.state = { ids: ['acc-1', 'acc-2'], index: 0, total: 2, hasPrev: false, hasNext: true, prevId: null, nextId: 'acc-2' };
    renderAt('/master-data/accounts/acc-1/overview?sort=account_number%3AASC&scope=all&selected=coa-fr&coaId=coa-fr&consolidation=unmapped');
    await screen.findByText('Software subscriptions');
    expect(nav.calls[nav.calls.length - 1]).toEqual(expect.objectContaining({
      id: 'acc-1',
      sort: 'account_number:ASC',
      statusScope: 'all',
      extraParams: { coaId: 'coa-fr', consolidationStatus: 'unmapped' },
    }));
    const context = 'sort=account_number%3AASC&scope=all&selected=coa-fr&coaId=coa-fr&consolidation=unmapped';
    fireEvent.click(screen.getByRole('button', { name: 'accounts.next' }));
    expect(navigateMock).toHaveBeenCalledWith(`/master-data/accounts/acc-2/overview?${context}`);
    fireEvent.click(screen.getByRole('button', { name: 'coa.title' }));
    expect(navigateMock).toHaveBeenCalledWith(`/master-data/coa?${context}`);
  });

  it('keeps its place in the filtered list once a fix takes the account out of it', async () => {
    nav.state = { ids: ['acc-1', 'acc-2'], index: 0, total: 2, hasPrev: false, hasNext: true, prevId: null, nextId: 'acc-2' };
    serve({ account: { ...ACCOUNT, consolidation_account_number: null, consolidation_account_name: null, consolidation_account_description: null, consolidation_status: 'unmapped' } });
    renderAt('/master-data/accounts/acc-1/overview?selected=coa-fr&consolidation=unmapped');
    await screen.findByText('Software subscriptions');
    // Mapped, the account leaves the "unmapped" list.
    nav.state = { ...EMPTY_NAV, ids: ['acc-2'] };
    const listbox = await openConsolidation();
    fireEvent.click(within(listbox).getByRole('option', { name: '1300 · Impairments & write-offs' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/accounts/acc-1', { consolidation_account_number: 1300 }));
    fireEvent.click(await screen.findByRole('button', { name: 'accounts.next' }));
    expect(navigateMock).toHaveBeenCalledWith('/master-data/accounts/acc-2/overview?selected=coa-fr&consolidation=unmapped');
  });

  it('validates and creates with an explicit action, the chart preselected from the list', async () => {
    mocked.post.mockResolvedValue({ data: { ...ACCOUNT, id: 'acc-new' } });
    renderAt('/master-data/accounts/new/overview?selected=coa-fr&coaId=coa-fr&consolidation=unmapped');
    expect(screen.queryByRole('complementary')).toBeNull();
    const chart = screen.getByRole('combobox', { name: 'accounts.fields.chartOfAccounts' });
    await waitFor(() => expect(chart).toHaveTextContent('PCG · French chart'));
    fireEvent.click(screen.getByRole('button', { name: 'accounts.actions.create' }));
    expect(await screen.findByText('accounts.messages.numberInvalid')).toBeInTheDocument();
    expect(screen.getByText('accounts.messages.nameRequired')).toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('accounts.fields.accountNumber'), { target: { value: ' 606300 ' } });
    fireEvent.change(screen.getByLabelText('accounts.fields.accountName'), { target: { value: 'Telecom' } });
    fireEvent.change(screen.getByLabelText('accounts.fields.nativeName'), { target: { value: 'Télécoms' } });
    const listbox = await openConsolidation();
    fireEvent.click(within(listbox).getByRole('option', { name: '1200 · Software' }));
    fireEvent.click(screen.getByRole('button', { name: 'accounts.actions.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/accounts', {
      coa_id: 'coa-fr',
      account_number: 606300,
      account_name: 'Telecom',
      native_name: 'Télécoms',
      description: null,
      consolidation_account_number: 1200,
      nature: null,
      status: 'enabled',
      disabled_at: null,
    }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith(
      '/master-data/accounts/acc-new/overview?selected=coa-fr&coaId=coa-fr&consolidation=unmapped',
    ));
  });

  it('shows a create refusal for a number already used under the number field', async () => {
    mocked.post.mockRejectedValueOnce({
      response: { status: 400, data: { message: 'An account with this number already exists in the selected Chart of Accounts' } },
    });
    renderAt('/master-data/accounts/new/overview?selected=coa-fr');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'accounts.fields.chartOfAccounts' })).toHaveTextContent('PCG · French chart'));
    fireEvent.change(screen.getByLabelText('accounts.fields.accountNumber'), { target: { value: '606100' } });
    fireEvent.change(screen.getByLabelText('accounts.fields.accountName'), { target: { value: 'Duplicate' } });
    fireEvent.click(screen.getByRole('button', { name: 'accounts.actions.create' }));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    expect(screen.getByLabelText('accounts.fields.accountNumber')).toHaveAttribute('aria-invalid', 'true');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('creates an account for one kind of line', async () => {
    mocked.post.mockResolvedValue({ data: { ...ACCOUNT, id: 'acc-new' } });
    renderAt('/master-data/accounts/new/overview?selected=coa-fr');
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'accounts.fields.chartOfAccounts' })).toHaveTextContent('PCG · French chart'));
    expect(natureSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.both');
    fireEvent.change(screen.getByLabelText('accounts.fields.accountNumber'), { target: { value: '218300' } });
    fireEvent.change(screen.getByLabelText('accounts.fields.accountName'), { target: { value: 'IT hardware' } });
    await pickNature('master-data:shared.lineTypeUsage.capex');
    fireEvent.click(screen.getByRole('button', { name: 'accounts.actions.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/accounts', expect.objectContaining({
      account_number: 218300, account_name: 'IT hardware', nature: 'capex',
    })));
  });

  it('asks for a chart when the list gave none', async () => {
    renderAt('/master-data/accounts/new/overview');
    fireEvent.change(screen.getByLabelText('accounts.fields.accountNumber'), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText('accounts.fields.accountName'), { target: { value: 'Cash' } });
    fireEvent.click(screen.getByRole('button', { name: 'accounts.actions.create' }));
    expect(await screen.findByText('accounts.messages.chartRequired')).toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();
  });
});
