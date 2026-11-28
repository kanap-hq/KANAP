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

import DepartmentSelect from './DepartmentSelect';

// The department picker (issue 1851): a typed DEPT-n is sent to the lookup of the chosen company;
// each option shows its reference as a hint. The value once chosen stays the name.

const PAYROLL = { id: 'd-1', item_number: 1, name: 'Payroll', company_id: 'c-3' };

function renderSelect(value: string | null = null) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  function Controlled() {
    const [current, setCurrent] = React.useState<string | null>(value);
    return (
      <DepartmentSelect
        label="Department"
        companyId="c-3"
        value={current}
        onChange={(next) => { setCurrent(next); onChange(next); }}
      />
    );
  }
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <Controlled />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return onChange;
}

describe('DepartmentSelect', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string, config?: { params?: { q?: string; ids?: string; company_id?: string } }) => {
      if (url !== '/departments/lookup') throw new Error(`unexpected ${url}`);
      const q = config?.params?.q ?? '';
      const ids = config?.params?.ids ?? '';
      const match = !q || q.toUpperCase() === 'DEPT-1' || ids === 'd-1';
      return { data: { items: match ? [PAYROLL] : [], has_more: false } };
    });
  });
  afterEach(cleanup);

  it('sends a typed DEPT-n to the company lookup and shows the reference beside the name', async () => {
    const onChange = renderSelect();
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'dept-1' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/departments/lookup', expect.objectContaining({
      params: expect.objectContaining({ q: 'dept-1', company_id: 'c-3' }),
    })));
    const option = await screen.findByRole('option', { name: /Payroll/ });
    expect(within(option).getByText('DEPT-1')).toBeTruthy();
    fireEvent.click(option);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('d-1'));
    expect((screen.getByRole('combobox') as HTMLInputElement).value).toBe('Payroll');
  });

  it('shows the reference of the chosen department and keeps the name in the field', async () => {
    renderSelect('d-1');
    const input = await screen.findByDisplayValue('Payroll');
    expect((input as HTMLInputElement).value).toBe('Payroll');
    fireEvent.mouseDown(input);
    const option = await screen.findByRole('option', { name: /Payroll/ });
    expect(within(option).getByText('DEPT-1')).toBeTruthy();
  });
});
