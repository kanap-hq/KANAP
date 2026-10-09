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

  it('creates a template account with its choice', async () => {
    // The editor preselects the chart named in the address.
    window.history.replaceState(null, '', '/?selected=coa-1');
    const ref = React.createRef<AccountCreateEditorHandle>();
    wrap(<AccountCreateEditor ref={ref} basePath={BASE} />);
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/chart-of-accounts', expect.anything()));
    // OPEX and CAPEX until a choice is made.
    expect(natureSelect()).toHaveTextContent('master-data:shared.lineTypeUsage.both');
    fireEvent.change(screen.getByLabelText(/^Account Number/), { target: { value: '6100' } });
    fireEvent.change(screen.getByLabelText(/^Account Name/), { target: { value: 'Software subscriptions' } });
    await pickNature('master-data:shared.lineTypeUsage.opex');
    await ref.current!.save().catch(() => undefined);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(BASE, expect.objectContaining({
      account_number: 6100, account_name: 'Software subscriptions', nature: 'opex',
    })));
  });
});
