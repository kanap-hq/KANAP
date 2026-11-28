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

import DepartmentMultiSelect from './DepartmentMultiSelect';

const PAYROLL = { id: 'd-5', item_number: 5, name: 'Finance', company_id: 'c-3' };

describe('DepartmentMultiSelect', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string, config?: { params?: { q?: string } }) => {
      if (url !== '/departments/lookup') throw new Error(`unexpected ${url}`);
      const q = config?.params?.q ?? '';
      return { data: { items: !q || q.toUpperCase() === 'DEPT-5' ? [PAYROLL] : [], has_more: false } };
    });
  });
  afterEach(cleanup);

  it('shows the reference in the list and the name on the chip', async () => {
    const onChange = vi.fn();
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Harness() {
      const [value, setValue] = React.useState<string[]>([]);
      return (
        <DepartmentMultiSelect
          label="Departments"
          companyId="c-3"
          value={value}
          onChange={(next) => { setValue(next); onChange(next); }}
        />
      );
    }
    render(
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={createAppTheme('light')}>
          <Harness />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'DEPT-5' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/departments/lookup', expect.objectContaining({
      params: expect.objectContaining({ q: 'DEPT-5', company_id: 'c-3' }),
    })));
    const option = await screen.findByRole('option', { name: /Finance/ });
    expect(within(option).getByText('DEPT-5')).toBeTruthy();
    fireEvent.click(option);
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(['d-5']));
    expect(screen.getByText('Finance')).toBeTruthy();
    expect(screen.queryByText('DEPT-5')).toBeNull();
  });
});
