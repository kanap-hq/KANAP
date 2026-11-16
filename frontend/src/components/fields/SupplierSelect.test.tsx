import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string, options?: { name?: string }) => (options?.name ? `${key}:${options.name}` : key) }),
}));
vi.mock('../../api', () => ({ default: { get: apiGet, post: apiPost } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));

import SupplierSelect from './SupplierSelect';

// The supplier picker (lot R3 of 26.11.9): a typed `SUP-12` is sent to the lookup, which finds that
// supplier exactly; each option shows its reference as its hint, beside the ERP ID, as the budget
// line picker shows `BL-n`; a supplier created from the picker comes back with its number.

const ACME = { id: 's-12', item_number: 12, name: 'Acme', erp_supplier_id: 'F10001', status: 'enabled' };

function Controlled({ onChange }: { onChange: (value: string | null) => void }) {
  const [value, setValue] = React.useState<string | null>(null);
  return <SupplierSelect label="Supplier" value={value} onChange={(next) => { setValue(next); onChange(next); }} />;
}

function renderSelect(onChange = vi.fn()) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <Controlled onChange={onChange} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return onChange;
}

describe('SupplierSelect', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiPost.mockReset();
    apiGet.mockImplementation(async (url: string, config?: { params?: { q?: string; ids?: string } }) => {
      if (url !== '/suppliers/lookup') throw new Error(`unexpected ${url}`);
      const q = config?.params?.q ?? '';
      return { data: { items: !q || q.toUpperCase() === 'SUP-12' ? [ACME] : [], has_more: false } };
    });
  });
  afterEach(cleanup);

  it('sends a typed SUP-n to the lookup and shows the reference of each option', async () => {
    renderSelect();
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'sup-12' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/suppliers/lookup', expect.objectContaining({ params: expect.objectContaining({ q: 'sup-12' }) })));
    const option = await screen.findByRole('option', { name: /Acme/ });
    expect(within(option).getByText('SUP-12')).toBeTruthy();
    expect(within(option).getByText('F10001')).toBeTruthy();
  });

  it('keeps the number of a supplier created from the picker and shows it as the others', async () => {
    apiPost.mockResolvedValue({ data: { id: 's-13', item_number: 13, name: 'Brand new', erp_supplier_id: null, status: 'enabled', disabled_at: null, notes: null } });
    const onChange = renderSelect();
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'Brand new' } });
    fireEvent.click(await screen.findByRole('option', { name: /suppliers\.createOption:Brand new/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('s-13'));
    expect(apiPost).toHaveBeenCalledWith('/suppliers', expect.objectContaining({ name: 'Brand new' }));
    await waitFor(() => expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('Brand new'));
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    const created = await screen.findByRole('option', { name: /Brand new/ });
    expect(within(created).getByText('SUP-13')).toBeTruthy();
  });

  // A record page gives the chosen supplier from its detail (`references.supplier` of a budget
  // line): that label wins over the lookup's, so it must carry the reference too.
  it('shows the reference of the chosen supplier the record page gives, as the other options', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={createAppTheme('light')}>
          <SupplierSelect label="Supplier" value="s-12" onChange={vi.fn()} selectedOption={{ ...ACME }} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    const input = screen.getByRole('combobox');
    expect((input as HTMLInputElement).value).toBe('Acme');
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'SUP-12' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/suppliers/lookup', expect.objectContaining({ params: expect.objectContaining({ q: 'SUP-12' }) })));
    const option = await screen.findByRole('option', { name: /Acme/ });
    expect(within(option).getByText('SUP-12')).toBeTruthy();
    expect(within(option).getByText('F10001')).toBeTruthy();
  });
});
