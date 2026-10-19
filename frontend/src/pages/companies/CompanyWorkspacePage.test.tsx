import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const navigateMock = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ canEdit: true }));
const i18nLanguage = vi.hoisted(() => ({ current: 'en' }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: {
      get language() { return i18nLanguage.current; },
      get resolvedLanguage() { return i18nLanguage.current; },
    },
  }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => auth.canEdit, profile: { id: 'user-1' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../hooks/useCompanyNav', () => ({
  useCompanyNav: () => ({ ids: [], index: 0, total: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../../hooks/useFreezeState', () => ({
  useFreezeState: () => ({ data: undefined, isLoading: false }),
}));

import api from '../../api';
import frMasterData from '../../locales/fr/master-data.json';
import deMasterData from '../../locales/de/master-data.json';
import esMasterData from '../../locales/es/master-data.json';
import enMasterData from '../../locales/en/master-data.json';
import CompanyWorkspacePage from './CompanyWorkspacePage';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
};

const COMPANY = {
  id: 'co-1',
  name: 'Acme France',
  coa_id: 'coa-fr',
  country_iso: 'FR',
  base_currency: 'EUR',
  city: 'Paris',
  address1: '12 rue Principale',
  address2: null,
  postal_code: '75001',
  state: null,
  reg_number: null,
  vat_number: null,
  notes: 'Main entity',
  status: 'enabled',
  disabled_at: null,
};

const COAS = [
  { id: 'coa-fr', code: 'COA-FR', name: 'French chart', country_iso: 'FR', scope: 'COUNTRY', is_default: true, is_global_default: false },
  { id: 'coa-de', code: 'COA-DE', name: 'German chart', country_iso: 'DE', scope: 'COUNTRY', is_default: true, is_global_default: false },
  { id: 'coa-global', code: 'COA-GL', name: 'Group chart', country_iso: null, scope: 'GLOBAL', is_default: false, is_global_default: true },
];

const Y = new Date().getFullYear();
const metrics: Record<number, Record<string, unknown> | null> = {
  [Y]: { headcount: 50, it_users: 10, turnover: '12.500' },
  [Y + 1]: null,
};

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>
          <Link to="/master-data/companies/co-2/overview">go to co-2</Link>
          <Routes>
            <Route path="/master-data/companies/:id/:tab" element={<CompanyWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

async function pickOption(label: string, typed: string, option: string) {
  const input = await screen.findByLabelText(label);
  fireEvent.change(input, { target: { value: typed } });
  fireEvent.click(await screen.findByRole('option', { name: option }));
}

describe('CompanyWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    i18nLanguage.current = 'en';
    auth.canEdit = true;
    mocked.get.mockImplementation(async (url: string, config?: { params?: { year?: number } }) => {
      if (url === '/companies/co-1') return { data: COMPANY };
      if (url === '/companies/co-2') return { data: { ...COMPANY, id: 'co-2', name: 'Acme Germany', address1: 'Hauptstrasse 1' } };
      if (url === '/chart-of-accounts') return { data: { items: COAS } };
      if (url === '/company-metrics/co-1') return { data: metrics[config?.params?.year ?? 0] ?? null };
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (url: string, body: Record<string, unknown>) => (
      url.startsWith('/companies/') ? { data: { ...COMPANY, ...body } } : { data: body }
    ));
  });

  it('has no save or reset button and translated tabs', async () => {
    renderAt('/master-data/companies/co-1/overview');
    await screen.findByText('Acme France');
    expect(screen.queryByRole('button', { name: 'common:buttons.saveChanges' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'common:buttons.reset' })).toBeNull();
    expect(screen.getByRole('tab', { name: 'shared.labels.overview' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'shared.labels.details' })).toBeInTheDocument();
  });

  it('shows the status in the header and saves it from the metadata menu, as a supplier', async () => {
    renderAt('/master-data/companies/co-1/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'companies.status.enabled' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'companies.status.disabled' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenLastCalledWith('/companies/co-1', { status: 'disabled' }));
    fireEvent.click(await screen.findByRole('button', { name: 'companies.status.disabled' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'companies.status.enabled' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenLastCalledWith('/companies/co-1', { status: 'enabled', disabled_at: null }));
  });

  it('shows a read-only user the status without a menu', async () => {
    auth.canEdit = false;
    renderAt('/master-data/companies/co-1/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'companies.status.enabled' }));
    expect(screen.queryByRole('menuitem', { name: 'companies.status.disabled' })).toBeNull();
  });

  it('saves a name change on blur', async () => {
    renderAt('/master-data/companies/co-1/overview');
    fireEvent.click(await screen.findByText('Acme France'));
    const input = screen.getByDisplayValue('Acme France');
    fireEvent.change(input, { target: { value: 'Acme France SAS' } });
    expect(mocked.patch).not.toHaveBeenCalled();
    fireEvent.blur(input);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/companies/co-1', { name: 'Acme France SAS' }));
  });

  it('shows a refused name under the name', async () => {
    mocked.patch.mockRejectedValueOnce({ response: { data: { message: 'Name refused.' } } });
    renderAt('/master-data/companies/co-1/overview');
    fireEvent.click(await screen.findByText('Acme France'));
    const input = screen.getByDisplayValue('Acme France');
    fireEvent.change(input, { target: { value: 'Other' } });
    fireEvent.blur(input);
    expect(await screen.findByText('Name refused.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('says another company has the name, under the name, on a 409 duplicate', async () => {
    mocked.patch.mockRejectedValueOnce({ response: { status: 409, data: { code: 'duplicate', message: 'Another company already has this name.' } } });
    renderAt('/master-data/companies/co-1/overview');
    fireEvent.click(await screen.findByText('Acme France'));
    const input = screen.getByDisplayValue('Acme France');
    fireEvent.change(input, { target: { value: 'acme germany' } });
    fireEvent.blur(input);
    expect(await screen.findByText('companies.messages.nameTaken')).toBeInTheDocument();
    // The stored name stays.
    expect(screen.getByText('Acme France')).toBeInTheDocument();
  });

  it('saves an address field on blur, and nothing when it is unchanged', async () => {
    renderAt('/master-data/companies/co-1/overview');
    const city = await screen.findByLabelText('companies.fields.city');
    await waitFor(() => expect(city).toHaveValue('Paris'));
    fireEvent.blur(city);
    fireEvent.change(city, { target: { value: ' Lyon ' } });
    fireEvent.blur(city);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/companies/co-1', { city: 'Lyon' }));
    const address2 = screen.getByLabelText('companies.fields.address2');
    fireEvent.change(address2, { target: { value: 'Building B' } });
    fireEvent.blur(address2);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/companies/co-1', { address2: 'Building B' }));
    expect(mocked.patch).toHaveBeenCalledTimes(2);
  });

  it('refuses an empty city without a request', async () => {
    renderAt('/master-data/companies/co-1/overview');
    const city = await screen.findByLabelText('companies.fields.city');
    await waitFor(() => expect(city).toHaveValue('Paris'));
    fireEvent.change(city, { target: { value: '  ' } });
    fireEvent.blur(city);
    expect(await screen.findByText('companies.messages.cityRequired')).toBeInTheDocument();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('shows a refusal under the field the body names', async () => {
    mocked.patch.mockRejectedValueOnce({ response: { data: { message: 'VAT number refused.', field: 'vat_number' } } });
    renderAt('/master-data/companies/co-1/overview');
    const notes = await screen.findByLabelText('companies.fields.notes');
    fireEvent.change(notes, { target: { value: 'Holding' } });
    fireEvent.blur(notes);
    expect(await screen.findByText('VAT number refused.')).toBeInTheDocument();
    expect(screen.getByLabelText('companies.fields.vatNumber')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('companies.fields.notes')).toHaveAttribute('aria-invalid', 'false');
  });

  it('sends the new country default chart with a country change', async () => {
    renderAt('/master-data/companies/co-1/overview');
    await screen.findByText('Acme France');
    await waitFor(() => expect(screen.getByLabelText('companies.fields.chartOfAccounts')).toHaveValue('COA-FR · French chart'));
    await pickOption('companies.fields.country', 'Germ', 'Germany (DE)');
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/companies/co-1', { country_iso: 'DE', coa_id: 'coa-de' }));
  });

  it('keeps a global chart when the country changes', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/companies/co-1') return { data: { ...COMPANY, coa_id: 'coa-global' } };
      if (url === '/chart-of-accounts') return { data: { items: COAS } };
      return { data: { items: [] } };
    });
    renderAt('/master-data/companies/co-1/overview');
    await waitFor(() => expect(screen.getByLabelText('companies.fields.chartOfAccounts')).toHaveValue('COA-GL · Group chart'));
    await pickOption('companies.fields.country', 'Germ', 'Germany (DE)');
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/companies/co-1', { country_iso: 'DE' }));
  });

  it('saves a currency change on change', async () => {
    renderAt('/master-data/companies/co-1/overview');
    await screen.findByText('Acme France');
    await pickOption('companies.fields.baseCurrency', 'US Dollar', 'USD · US Dollar');
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/companies/co-1', { base_currency: 'USD' }));
  });

  it('shows read-only users disabled fields and no title edit', async () => {
    auth.canEdit = false;
    renderAt('/master-data/companies/co-1/overview');
    const city = await screen.findByLabelText('companies.fields.city');
    expect(city).toBeDisabled();
    expect(screen.getByLabelText('companies.fields.notes')).toBeDisabled();
    expect(screen.getByLabelText('companies.fields.country')).toBeDisabled();
    fireEvent.click(screen.getByText('Acme France'));
    expect(screen.queryByDisplayValue('Acme France')).toBeNull();
  });

  it('drops a late refusal from the company the user has left', async () => {
    let fail: (reason: unknown) => void = () => undefined;
    mocked.patch.mockImplementationOnce(() => new Promise((_resolve, reject) => { fail = reject; }));
    renderAt('/master-data/companies/co-1/overview');
    const address1 = await screen.findByLabelText('companies.fields.address1');
    fireEvent.change(address1, { target: { value: '1 Avenue' } });
    fireEvent.blur(address1);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('link', { name: 'go to co-2' }));
    await waitFor(() => expect(screen.getByLabelText('companies.fields.address1')).toHaveValue('Hauptstrasse 1'));
    fail({ response: { data: { message: 'Address refused.' } } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText('Address refused.')).toBeNull();
  });

  it('validates and creates with an explicit button, the chart preselected from the country', async () => {
    mocked.post.mockResolvedValue({ data: { ...COMPANY, id: 'co-new' } });
    renderAt('/master-data/companies/new/overview?year=2026');
    expect(screen.queryByRole('complementary')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('companies.messages.nameRequired')).toBeInTheDocument();
    expect(screen.getByText('companies.messages.countryRequired')).toBeInTheDocument();
    expect(screen.getByText('companies.messages.currencyRequired')).toBeInTheDocument();
    expect(screen.getByText('companies.messages.cityRequired')).toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();

    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/chart-of-accounts', expect.anything()));
    fireEvent.change(screen.getByLabelText('companies.fields.name'), { target: { value: 'Acme Germany' } });
    await pickOption('companies.fields.country', 'Germ', 'Germany (DE)');
    await waitFor(() => expect(screen.getByLabelText('companies.fields.chartOfAccounts')).toHaveValue('COA-DE · German chart'));
    await pickOption('companies.fields.baseCurrency', 'Euro', 'EUR · Euro');
    fireEvent.change(screen.getByLabelText('companies.fields.city'), { target: { value: 'Berlin' } });
    fireEvent.change(screen.getByLabelText('companies.fields.vatNumber'), { target: { value: 'DE123' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/companies', {
      name: 'Acme Germany',
      coa_id: 'coa-de',
      country_iso: 'DE',
      city: 'Berlin',
      postal_code: null,
      address1: null,
      address2: null,
      reg_number: null,
      vat_number: 'DE123',
      state: null,
      base_currency: 'EUR',
      status: 'enabled',
      disabled_at: null,
      notes: null,
    }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/companies/co-new/overview?year=2026'));
  });

  it('says another company has the name, under the name field, when a create is refused as a duplicate', async () => {
    mocked.post.mockRejectedValueOnce({ response: { status: 409, data: { code: 'duplicate', message: 'Another company already has this name.' } } });
    renderAt('/master-data/companies/new/overview');
    fireEvent.change(screen.getByLabelText('companies.fields.name'), { target: { value: 'acme' } });
    await pickOption('companies.fields.country', 'Fran', 'France (FR)');
    await pickOption('companies.fields.baseCurrency', 'Euro', 'EUR · Euro');
    fireEvent.change(screen.getByLabelText('companies.fields.city'), { target: { value: 'Paris' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('companies.messages.nameTaken')).toBeInTheDocument();
    expect(screen.getByLabelText('companies.fields.name')).toHaveAttribute('aria-invalid', 'true');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('shows a create refusal under the field the body names', async () => {
    mocked.post.mockRejectedValueOnce({ response: { data: { message: 'Name already used.', field: 'name' } } });
    renderAt('/master-data/companies/new/overview');
    fireEvent.change(screen.getByLabelText('companies.fields.name'), { target: { value: 'Acme' } });
    await pickOption('companies.fields.country', 'Fran', 'France (FR)');
    await pickOption('companies.fields.baseCurrency', 'Euro', 'EUR · Euro');
    fireEvent.change(screen.getByLabelText('companies.fields.city'), { target: { value: 'Paris' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('Name already used.')).toBeInTheDocument();
    expect(screen.getByLabelText('companies.fields.name')).toHaveAttribute('aria-invalid', 'true');
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('shows a comma in the turnover example for French, German and Spanish', () => {
    expect(frMasterData.companies.placeholders.turnover).toBe('ex. 12,5');
    expect(deMasterData.companies.placeholders.turnover).toBe('z. B. 12,5');
    expect(esMasterData.companies.placeholders.turnover).toBe('p. ej., 12,5');
    expect(enMasterData.companies.placeholders.turnover).toBe('e.g., 12.5');
  });

  it('reads a comma as the decimal mark when the application is in French', async () => {
    i18nLanguage.current = 'fr';
    renderAt(`/master-data/companies/co-1/details?year=${Y}`);
    const turnover = await screen.findByLabelText('companies.fields.turnover');
    await waitFor(() => expect(turnover).toHaveValue('12,5'));
    expect(turnover).toHaveAttribute('inputmode', 'decimal');
    expect(turnover).not.toHaveAttribute('type', 'number');
    fireEvent.change(turnover, { target: { value: '8,25' } });
    fireEvent.blur(turnover);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith(
      '/company-metrics/co-1', { headcount: 50, it_users: 10, turnover: 8.25 }, { params: { year: Y } },
    ));
  });

  it('saves each metric for the selected year with the stored values of the others', async () => {
    renderAt(`/master-data/companies/co-1/details?year=${Y}`);
    const headcount = await screen.findByLabelText('companies.fields.headcount');
    await waitFor(() => expect(headcount).toHaveValue('50'));
    expect(screen.getByLabelText('companies.fields.turnover')).toHaveValue('12.5');
    fireEvent.change(headcount, { target: { value: '55' } });
    fireEvent.blur(headcount);
    const itUsers = screen.getByLabelText('companies.fields.itUsers');
    fireEvent.change(itUsers, { target: { value: '' } });
    fireEvent.blur(itUsers);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(2));
    expect(mocked.patch).toHaveBeenNthCalledWith(1,
      '/company-metrics/co-1', { headcount: 55, it_users: 10, turnover: 12.5 }, { params: { year: Y } });
    // The second write starts from what the first stored, never from the headcount it replaced.
    expect(mocked.patch).toHaveBeenNthCalledWith(2,
      '/company-metrics/co-1', { headcount: 55, it_users: null, turnover: 12.5 }, { params: { year: Y } });
  });

  it('starts a year without metrics with a zero headcount and empty optional values', async () => {
    renderAt(`/master-data/companies/co-1/details?year=${Y + 1}`);
    const headcount = await screen.findByLabelText('companies.fields.headcount');
    await waitFor(() => expect(headcount).toHaveValue('0'));
    const turnover = screen.getByLabelText('companies.fields.turnover');
    expect(turnover).toHaveValue('');
    fireEvent.change(turnover, { target: { value: '3.25' } });
    fireEvent.blur(turnover);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith(
      '/company-metrics/co-1', { headcount: 0, it_users: null, turnover: 3.25 }, { params: { year: Y + 1 } },
    ));
  });

  it('says what a valid metric is in plain words', async () => {
    renderAt(`/master-data/companies/co-1/details?year=${Y}`);
    const headcount = await screen.findByLabelText('companies.fields.headcount');
    await waitFor(() => expect(headcount).toHaveValue('50'));
    fireEvent.change(headcount, { target: { value: '' } });
    fireEvent.blur(headcount);
    expect(await screen.findByText('companies.messages.headcountInvalid')).toBeInTheDocument();
    const turnover = screen.getByLabelText('companies.fields.turnover');
    fireEvent.change(turnover, { target: { value: '1.2345' } });
    fireEvent.blur(turnover);
    expect(await screen.findByText('companies.messages.turnoverInvalid')).toBeInTheDocument();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('switches year while a metric save is still running', async () => {
    let finish: (value: unknown) => void = () => undefined;
    mocked.patch.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    renderAt(`/master-data/companies/co-1/details?year=${Y}`);
    const headcount = await screen.findByLabelText('companies.fields.headcount');
    await waitFor(() => expect(headcount).toHaveValue('50'));
    fireEvent.change(headcount, { target: { value: '60' } });
    fireEvent.blur(headcount);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('tab', { name: String(Y + 1) }));
    await waitFor(() => expect(screen.getByLabelText('companies.fields.headcount')).toHaveValue('0'));
    expect(screen.getByLabelText('companies.fields.headcount')).not.toBeDisabled();
    finish({ data: { headcount: 60, it_users: 10, turnover: '12.5' } });
  });
});
