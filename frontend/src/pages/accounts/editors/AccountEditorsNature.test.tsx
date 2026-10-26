import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

// One stable `t` (a new one per render would loop the effects).
const stableT = vi.hoisted(() => (key: string) => key);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));

import api from '../../../api';
import { accountFormSchema } from '../../forms/AccountForm';
import enMasterData from '../../../locales/en/master-data.json';
import frMasterData from '../../../locales/fr/master-data.json';
import deMasterData from '../../../locales/de/master-data.json';
import esMasterData from '../../../locales/es/master-data.json';
import AccountCreateEditor, { type AccountCreateEditorHandle } from './AccountCreateEditor';
import AccountOverviewEditor, { type AccountOverviewEditorHandle } from './AccountOverviewEditor';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
};

const BASE = '/admin/coa-templates/tpl-1/accounts';
const TEMPLATE_ACCOUNT = {
  account_number: 2050,
  account_name: 'Software licences',
  native_name: null,
  description: null,
  consolidation_account_number: 1200,
  consolidation_account_name: 'Software',
  consolidation_account_description: null,
  nature: 'capex',
  status: 'enabled',
  disabled_at: null,
  coa_id: 'coa-1',
};
const CHARTS = [{ id: 'coa-1', code: 'IFRS', name: 'Group chart' }];

function wrap(node: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>{node}</ThemeProvider>
    </QueryClientProvider>,
  );
}

/** The "Used for" select of the legacy admin form (a labelled MUI select). */
const natureSelect = () => screen.getByRole('combobox', { name: 'accounts.fields.nature' });

/** A required MUI label keeps its asterisk in the accessible name, so match the key as a prefix. */
const labelled = (key: string) => screen.getByLabelText(new RegExp(`^${key.replace(/\./g, '\\.')}`));

const chartSelect = () => screen.getByRole('combobox', { name: /^accounts\.fields\.chartOfAccounts/ });

async function pickNature(label: string) {
  fireEvent.mouseDown(natureSelect());
  fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: label }));
}

describe('account form schema: Used for', () => {
  const base = { account_number: 1, account_name: 'Cash', status: 'enabled' };

  it('reads an empty choice as null (OPEX and CAPEX) and keeps opex or capex', () => {
    expect(accountFormSchema.parse({ ...base, nature: '' }).nature).toBeNull();
    expect(accountFormSchema.parse({ ...base }).nature).toBeNull();
    expect(accountFormSchema.parse({ ...base, nature: 'opex' }).nature).toBe('opex');
    expect(accountFormSchema.parse({ ...base, nature: 'capex' }).nature).toBe('capex');
  });

  it('refuses any other value', () => {
    expect(accountFormSchema.safeParse({ ...base, nature: 'both' }).success).toBe(false);
  });
});

describe('account form schema: account numbers', () => {
  const base = { account_name: 'Maintenance', status: 'enabled' };

  it('accepts numbers of up to 15 digits', () => {
    const parsed = accountFormSchema.parse({ ...base, account_number: 615630000012, consolidation_account_number: '999999999999999' });
    expect(parsed.account_number).toBe(615630000012);
    expect(parsed.consolidation_account_number).toBe(999999999999999);
  });

  it('refuses longer numbers and a consolidation number below 1', () => {
    expect(accountFormSchema.safeParse({ ...base, account_number: 6156300000123456 }).success).toBe(false);
    expect(accountFormSchema.safeParse({ ...base, account_number: 6156100, consolidation_account_number: 6156300000123456 }).success).toBe(false);
    expect(accountFormSchema.safeParse({ ...base, account_number: 6156100, consolidation_account_number: 0 }).success).toBe(false);
  });
});

describe('platform admin template account editors: Used for', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `${BASE}/2050`) return { data: TEMPLATE_ACCOUNT };
      if (url === '/chart-of-accounts') return { data: { items: CHARTS } };
      return { data: {} };
    });
    mocked.patch.mockResolvedValue({ data: {} });
    mocked.post.mockResolvedValue({ data: { account_number: 6100 } });
  });

  it('shows the stored choice and saves a change with the row', async () => {
    const ref = React.createRef<AccountOverviewEditorHandle>();
    wrap(<AccountOverviewEditor ref={ref} id="2050" basePath={BASE} />);
    await waitFor(() => expect(natureSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.capex'));
    await pickNature('master-data:shared.lineTypeUsage.both');
    await ref.current!.save().catch(() => undefined);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith(`${BASE}/2050`, expect.objectContaining({
      account_number: 2050, nature: null,
    })));
  });

  it('keeps the stored choice on a save that does not touch it', async () => {
    const ref = React.createRef<AccountOverviewEditorHandle>();
    wrap(<AccountOverviewEditor ref={ref} id="2050" basePath={BASE} />);
    await waitFor(() => expect(natureSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.capex'));
    await ref.current!.save().catch(() => undefined);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith(`${BASE}/2050`, expect.objectContaining({ nature: 'capex' })));
  });

  it('sends the status alone when switched off, for the server to date it', async () => {
    const ref = React.createRef<AccountOverviewEditorHandle>();
    wrap(<AccountOverviewEditor ref={ref} id="2050" basePath={BASE} />);
    await waitFor(() => expect(natureSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.capex'));
    fireEvent.click(screen.getByRole('checkbox', { name: 'statuses.enabled' }));
    await ref.current!.save().catch(() => undefined);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalled());
    const [, body] = mocked.patch.mock.calls[0];
    expect(body.status).toBe('disabled');
    expect(body).not.toHaveProperty('disabled_at');
  });

  it('leaves the status and a future end of validity out of a save that does not touch them', async () => {
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `${BASE}/2050`) return { data: { ...TEMPLATE_ACCOUNT, disabled_at: '2031-10-16T14:37:12.000Z' } };
      if (url === '/chart-of-accounts') return { data: { items: CHARTS } };
      return { data: {} };
    });
    const ref = React.createRef<AccountOverviewEditorHandle>();
    wrap(<AccountOverviewEditor ref={ref} id="2050" basePath={BASE} />);
    await waitFor(() => expect(natureSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.capex'));
    await pickNature('master-data:shared.lineTypeUsage.both');
    await ref.current!.save().catch(() => undefined);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalled());
    const [, body] = mocked.patch.mock.calls[0];
    expect(body.nature).toBeNull();
    expect(body).not.toHaveProperty('status');
    expect(body).not.toHaveProperty('disabled_at');
  });

  it('creates a template account with its choice', async () => {
    // The editor preselects the chart named in the address.
    window.history.replaceState(null, '', '/?selected=coa-1');
    const ref = React.createRef<AccountCreateEditorHandle>();
    wrap(<AccountCreateEditor ref={ref} basePath={BASE} />);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/chart-of-accounts', expect.anything()));
    // OPEX and CAPEX until a choice is made.
    expect(natureSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.both');
    fireEvent.change(labelled('accounts.fields.accountNumber'), { target: { value: '6100' } });
    fireEvent.change(labelled('accounts.fields.accountName'), { target: { value: 'Software subscriptions' } });
    await pickNature('master-data:shared.lineTypeUsage.opex');
    await ref.current!.save().catch(() => undefined);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(BASE, expect.objectContaining({
      account_number: 6100, account_name: 'Software subscriptions', nature: 'opex',
    })));
  });
});

const CHART_REQUIRED_KEY = 'master-data:formSchemas.account.chartOfAccountsRequired';

describe('account editors: chart of accounts is required', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `${BASE}/2050`) return { data: { ...TEMPLATE_ACCOUNT, coa_id: '' } };
      if (url === '/chart-of-accounts') return { data: { items: CHARTS } };
      return { data: {} };
    });
    mocked.patch.mockResolvedValue({ data: {} });
    mocked.post.mockResolvedValue({ data: { account_number: 6100 } });
  });

  it('keeps the message in the locale files, in each language', () => {
    expect(enMasterData.formSchemas.account.chartOfAccountsRequired).toBe('Chart of accounts is required');
    expect(frMasterData.formSchemas.account.chartOfAccountsRequired).toBe('Le plan comptable est requis');
    expect(deMasterData.formSchemas.account.chartOfAccountsRequired).toBe('Kontenplan ist erforderlich');
    expect(esMasterData.formSchemas.account.chartOfAccountsRequired).toBe('El plan de cuentas es obligatorio');
  });

  it('shows the locale message when a new account has no chart', async () => {
    const ref = React.createRef<AccountCreateEditorHandle>();
    wrap(<AccountCreateEditor ref={ref} basePath={BASE} />);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/chart-of-accounts', expect.anything()));
    fireEvent.change(labelled('accounts.fields.accountNumber'), { target: { value: '6100' } });
    fireEvent.change(labelled('accounts.fields.accountName'), { target: { value: 'Cash' } });
    await ref.current!.save().catch(() => undefined);
    expect(await screen.findByText(CHART_REQUIRED_KEY)).toBeInTheDocument();
    expect(screen.queryByText('Chart of Accounts is required')).not.toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('shows the locale message when an existing account has no chart', async () => {
    const ref = React.createRef<AccountOverviewEditorHandle>();
    wrap(<AccountOverviewEditor ref={ref} id="2050" basePath={BASE} />);
    await waitFor(() => expect(natureSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.capex'));
    await ref.current!.save().catch(() => undefined);
    expect(await screen.findByText(CHART_REQUIRED_KEY)).toBeInTheDocument();
    expect(screen.queryByText('Chart of Accounts is required')).not.toBeInTheDocument();
    expect(mocked.patch).not.toHaveBeenCalled();
  });
});

/** Labels the two platform editors used to hard-code in English. */
const HARD_CODED_LABELS = [
  'Chart of Accounts',
  'Account Number',
  'Account Name',
  'Native Name (local language)',
  'Consolidation Account Number',
  'Consolidation Account Name',
  'Consolidation Account Description',
  'Select a CoA',
  'Loading…',
];

const FIELD_LABELS = {
  en: {
    chartOfAccounts: 'Chart of accounts',
    accountNumber: 'Account number',
    accountName: 'Account name',
    nativeName: 'Native name (local language)',
    description: 'Description',
    consolidationAccountNumber: 'Consolidation account number',
    consolidationAccountName: 'Consolidation account name',
    consolidationAccountDescription: 'Consolidation account description',
    selectChart: 'Select a chart of accounts',
  },
  fr: {
    chartOfAccounts: 'Plan comptable',
    accountNumber: 'Numéro de compte',
    accountName: 'Nom du compte',
    nativeName: 'Nom local (langue locale)',
    description: 'Description',
    consolidationAccountNumber: 'Numéro de compte de consolidation',
    consolidationAccountName: 'Nom du compte de consolidation',
    consolidationAccountDescription: 'Description du compte de consolidation',
    selectChart: 'Choisissez un plan comptable',
  },
  de: {
    chartOfAccounts: 'Kontenplan',
    accountNumber: 'Kontonummer',
    accountName: 'Kontoname',
    nativeName: 'Lokaler Name (Landessprache)',
    description: 'Beschreibung',
    consolidationAccountNumber: 'Konsolidierungskontonummer',
    consolidationAccountName: 'Konsolidierungskontoname',
    consolidationAccountDescription: 'Beschreibung des Konsolidierungskontos',
    selectChart: 'Wählen Sie einen Kontenplan',
  },
  es: {
    chartOfAccounts: 'Plan de cuentas',
    accountNumber: 'Número de cuenta',
    accountName: 'Nombre de la cuenta',
    nativeName: 'Nombre local (idioma local)',
    description: 'Descripción',
    consolidationAccountNumber: 'Número de cuenta de consolidación',
    consolidationAccountName: 'Nombre de la cuenta de consolidación',
    consolidationAccountDescription: 'Descripción de la cuenta de consolidación',
    selectChart: 'Elija un plan de cuentas',
  },
} as const;

function expectNoHardCodedLabel() {
  for (const label of HARD_CODED_LABELS) {
    expect(screen.queryByText(label)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(label)).not.toBeInTheDocument();
  }
}

describe('platform admin template account editors: labels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.history.replaceState(null, '', '/');
    mocked.get.mockImplementation(async (url: string) => {
      if (url === `${BASE}/2050`) return { data: TEMPLATE_ACCOUNT };
      if (url === '/chart-of-accounts') return { data: { items: CHARTS } };
      return { data: {} };
    });
  });

  it('keeps the labels in the locale files, in each language', () => {
    const packs = { en: enMasterData, fr: frMasterData, de: deMasterData, es: esMasterData };
    for (const code of ['en', 'fr', 'de', 'es'] as const) {
      expect(packs[code].accounts.fields).toMatchObject(FIELD_LABELS[code]);
    }
  });

  it('shows locale keys on a new account, with no English label left', async () => {
    wrap(<AccountCreateEditor basePath={BASE} />);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/chart-of-accounts', expect.anything()));
    fireEvent.mouseDown(chartSelect());
    expect(await screen.findByRole('option', { name: 'accounts.fields.selectChart' })).toBeInTheDocument();
    expect(labelled('accounts.fields.accountNumber')).toBeInTheDocument();
    expect(labelled('accounts.fields.accountName')).toBeInTheDocument();
    expect(labelled('accounts.fields.nativeName')).toBeInTheDocument();
    expect(labelled('accounts.fields.description')).toBeInTheDocument();
    expect(labelled('accounts.fields.consolidationAccountNumber')).toBeInTheDocument();
    expect(labelled('accounts.fields.consolidationAccountName')).toBeInTheDocument();
    expect(labelled('accounts.fields.consolidationAccountDescription')).toBeInTheDocument();
    expectNoHardCodedLabel();
  });

  it('shows the same keys on an existing account', async () => {
    wrap(<AccountOverviewEditor id="2050" basePath={BASE} />);
    await waitFor(() => expect(natureSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.capex'));
    expect(chartSelect()).toHaveTextContent('IFRS · Group chart');
    expect(labelled('accounts.fields.accountNumber')).toHaveValue(2050);
    expect(labelled('accounts.fields.accountName')).toHaveValue('Software licences');
    expect(labelled('accounts.fields.consolidationAccountNumber')).toHaveValue(1200);
    expect(labelled('accounts.fields.consolidationAccountName')).toHaveValue('Software');
    fireEvent.mouseDown(chartSelect());
    expect(within(await screen.findByRole('listbox')).getByRole('option', { name: 'accounts.fields.selectChart' })).toBeInTheDocument();
    expectNoHardCodedLabel();
  });
});
