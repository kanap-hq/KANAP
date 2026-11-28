import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../api', () => ({ default: { get: apiGet } }));

import CompanySelect, { type CompanyOption } from './CompanySelect';

// The company picker (issue 1851): a typed COMP-n is sent to the lookup, which finds that company
// exactly; each option shows its reference as a hint. The value once chosen stays the name.

const FROMAGE = { id: 'c-3', item_number: 3, name: 'Fromage & Co SA' };

function Controlled({ onChange, selectedOption }: { onChange?: (value: string | null) => void; selectedOption?: CompanyOption | null }) {
  const [value, setValue] = React.useState<string | null>(selectedOption?.id ?? null);
  return (
    <CompanySelect
      label="Company"
      value={value}
      selectedOption={selectedOption}
      onChange={(next) => { setValue(next); onChange?.(next); }}
    />
  );
}

function renderSelect(props: { onChange?: (value: string | null) => void; selectedOption?: CompanyOption | null } = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <Controlled {...props} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('CompanySelect', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string, config?: { params?: { q?: string } }) => {
      if (url !== '/companies/lookup') throw new Error(`unexpected ${url}`);
      const q = config?.params?.q ?? '';
      return { data: { items: !q || q.toUpperCase() === 'COMP-3' ? [FROMAGE] : [], has_more: false } };
    });
  });
  afterEach(cleanup);

  it('sends a typed COMP-n to the lookup and shows the reference beside the name', async () => {
    const onChange = vi.fn();
    renderSelect({ onChange });
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'comp-3' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/companies/lookup', expect.objectContaining({ params: expect.objectContaining({ q: 'comp-3' }) })));
    const option = await screen.findByRole('option', { name: /Fromage & Co SA/ });
    expect(within(option).getByText('COMP-3')).toBeTruthy();
    fireEvent.click(option);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('c-3'));
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('Fromage & Co SA');
  });

  it('shows the reference of the company the record page gives, and the field stays the name', async () => {
    renderSelect({ selectedOption: FROMAGE });
    const input = screen.getByRole('combobox');
    expect((input as HTMLInputElement).value).toBe('Fromage & Co SA');
    fireEvent.mouseDown(input);
    const option = await screen.findByRole('option', { name: /Fromage & Co SA/ });
    expect(within(option).getByText('COMP-3')).toBeTruthy();
    expect((input as HTMLInputElement).value).toBe('Fromage & Co SA');
  });

  it('still lists a company given without a number', async () => {
    renderSelect({ selectedOption: { id: 'c-9', item_number: null, name: 'Kaasmeester BV' } });
    const input = screen.getByRole('combobox');
    expect((input as HTMLInputElement).value).toBe('Kaasmeester BV');
    fireEvent.mouseDown(input);
    const option = await screen.findByRole('option', { name: 'Kaasmeester BV' });
    expect(within(option).queryByText(/COMP-/)).toBeNull();
  });
});
