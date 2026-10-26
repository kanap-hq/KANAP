import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import SupportInfoPanel from './SupportInfoPanel';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const t = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get, post } }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('../../../components/fields/ContactSelect', () => ({ default: () => null }));
vi.mock('../../../components/fields/DateEUField', () => ({ default: () => null }));

describe('SupportInfoPanel vendor list', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/suppliers/lookup' || url === '/contracts/lookup') {
        return { data: { items: [{ id: 'v-1', name: 'Cisco' }], has_more: false } };
      }
      if (String(url).endsWith('/support-info')) return { data: { vendor_id: 'v-1' } };
      if (String(url).endsWith('/support-contacts')) return { data: [] };
      return { data: null };
    });
  });

  it('opening the vendor list does not update the panel while the autocomplete renders', async () => {
    const errors: string[] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map((arg) => String(arg)).join(' '));
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <React.StrictMode>
        <QueryClientProvider client={client}>
          <ThemeProvider theme={createAppTheme('light')}>
            <SupportInfoPanel assetId="asset-1" />
          </ThemeProvider>
        </QueryClientProvider>
      </React.StrictMode>,
    );
    const vendor = await screen.findByPlaceholderText('workspace.asset.support.searchVendors');
    await screen.findByDisplayValue('Cisco');
    vendor.focus();
    fireEvent.mouseDown(vendor);
    await screen.findByRole('option', { name: 'Cisco' });
    spy.mockRestore();
    expect(errors.filter((line) => line.includes('while rendering')).join('\n')).toBe('');
  });

  it('keeps the chosen contract, then lists only the new vendor’s contracts', async () => {
    get.mockImplementation(async (url: string, config?: { params?: Record<string, unknown> }) => {
      const params = config?.params ?? {};
      if (url === '/suppliers/lookup') {
        return { data: { items: [{ id: 'v-1', name: 'Cisco' }, { id: 'v-2', name: 'Fortinet' }], has_more: false } };
      }
      if (url === '/contracts/lookup') {
        if (params.ids) return { data: { items: [{ id: 'c-1', name: 'Cisco Care' }], has_more: false } };
        if (params.supplier_id === 'v-2') return { data: { items: [{ id: 'c-2', name: 'FortiCare' }], has_more: false } };
        return { data: { items: [{ id: 'c-1', name: 'Cisco Care' }], has_more: false } };
      }
      if (String(url).endsWith('/support-info')) return { data: { vendor_id: 'v-1', support_contract_id: 'c-1' } };
      if (String(url).endsWith('/support-contacts')) return { data: [] };
      return { data: null };
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <SupportInfoPanel assetId="asset-1" />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await screen.findByDisplayValue('Cisco Care');
    expect(get).toHaveBeenCalledWith('/contracts/lookup', expect.objectContaining({ params: expect.objectContaining({ ids: 'c-1' }) }));

    const vendor = screen.getByPlaceholderText('workspace.asset.support.searchVendors');
    vendor.focus();
    fireEvent.mouseDown(vendor);
    fireEvent.click(await screen.findByRole('option', { name: 'Fortinet' }));
    await waitFor(() => expect(screen.queryByDisplayValue('Cisco Care')).toBeNull());

    const contract = screen.getByPlaceholderText('workspace.asset.support.searchSupportContracts');
    contract.focus();
    fireEvent.mouseDown(contract);
    expect(await screen.findByRole('option', { name: 'FortiCare' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Cisco Care' })).toBeNull();
    expect(get).toHaveBeenCalledWith('/contracts/lookup', expect.objectContaining({
      params: expect.objectContaining({ supplier_id: 'v-2' }),
    }));
  });
});
