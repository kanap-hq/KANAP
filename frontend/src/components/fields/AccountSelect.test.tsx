import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('react-i18next', () => {
  const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
  return { useTranslation: () => translation };
});
vi.mock('../../api', () => ({ default: { get: vi.fn() } }));

import api from '../../api';
import AccountSelect from './AccountSelect';

const apiGet = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

// One chart: an account for OPEX lines only, one for CAPEX lines only, one for both.
const ACCOUNTS = [
  { id: 'acc-opex', account_number: 6100, account_name: 'Software subscriptions', nature: 'opex' },
  { id: 'acc-capex', account_number: 2050, account_name: 'Software licences', nature: 'capex' },
  { id: 'acc-both', account_number: 6200, account_name: 'Consulting', nature: null },
];

type Call = { url: string; params: Record<string, unknown> };
let calls: Call[];

/** The lookup as the server answers it: `nature` keeps the accounts of that kind and those for both; `ids` ignores it. */
function serveLookup() {
  apiGet.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
    const params = config?.params ?? {};
    calls.push({ url, params });
    if (url !== '/accounts/lookup') throw new Error(`unexpected ${url}`);
    if (params.ids) {
      const ids = String(params.ids).split(',');
      return { data: { items: ACCOUNTS.filter((a) => ids.includes(a.id)), has_more: false } };
    }
    const items = ACCOUNTS.filter((a) => !params.nature || a.nature == null || a.nature === params.nature);
    return { data: { items, has_more: false } };
  });
}

function renderSelect(props: Partial<React.ComponentProps<typeof AccountSelect>> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <AccountSelect label="" value={null} onChange={() => undefined} companyId="company-1" {...props} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function openList() {
  const input = screen.getByRole('combobox');
  act(() => { input.focus(); });
  fireEvent.mouseDown(input);
}

describe('AccountSelect nature', () => {
  beforeEach(() => {
    calls = [];
    apiGet.mockReset();
    serveLookup();
  });

  it('asks the lookup for the accounts of the line kind only', async () => {
    renderSelect({ nature: 'capex' });
    openList();
    expect(await screen.findByText('[2050] Software licences')).toBeInTheDocument();
    expect(screen.getByText('[6200] Consulting')).toBeInTheDocument();
    expect(screen.queryByText('[6100] Software subscriptions')).not.toBeInTheDocument();
    const search = calls.find((call) => !call.params.ids);
    expect(search?.params).toEqual(expect.objectContaining({ companyId: 'company-1', nature: 'capex' }));
  });

  it('still shows a stored account of the other kind, read by id without the nature', async () => {
    renderSelect({ nature: 'capex', value: 'acc-opex' });
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('[6100] Software subscriptions'));
    const hydration = calls.find((call) => call.params.ids);
    expect(hydration?.params).toEqual({ ids: 'acc-opex' });
  });

  it('sends no nature when the caller gives none', async () => {
    renderSelect();
    openList();
    expect(await screen.findByText('[6100] Software subscriptions')).toBeInTheDocument();
    const search = calls.find((call) => !call.params.ids);
    expect(search?.params).not.toHaveProperty('nature');
  });
});
