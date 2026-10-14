import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const apiGet = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../api', () => ({ default: { get: apiGet } }));

import ContactSelect from './ContactSelect';

const CONTACTS = [
  { id: 'c-1', first_name: 'Anna', last_name: 'Berg', job_title: null, email: 'anna.berg@acme.test', active: true, supplier_id: 's-1', supplier_name: 'Acme' },
  { id: 'c-2', first_name: null, last_name: null, job_title: null, email: 'desk@acme.test', active: true, supplier_id: 's-1', supplier_name: 'Acme' },
];

function renderSelect(props: Partial<React.ComponentProps<typeof ContactSelect>> = {}) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <ContactSelect value={null} onChange={vi.fn()} {...props} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const optionTexts = () => screen.getAllByRole('option').map((option) => option.textContent);

describe('ContactSelect', () => {
  beforeEach(() => {
    apiGet.mockReset();
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/contacts') return { data: { items: CONTACTS } };
      if (url === '/contacts/c-1') return { data: CONTACTS[0] };
      throw new Error(`unexpected ${url}`);
    });
  });
  afterEach(cleanup);

  it('lists names only under their supplier, the email standing in for a contact with no name', async () => {
    renderSelect();
    fireEvent.mouseDown(screen.getByRole('combobox'));
    await waitFor(() => expect(optionTexts()).toEqual(['Anna Berg', 'desk@acme.test']));
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.queryByText(/anna\.berg@acme\.test/)).toBeNull();
  });

  it('names the supplier on the same line when the list is not grouped', async () => {
    renderSelect({ groupByCompany: false });
    fireEvent.mouseDown(screen.getByRole('combobox'));
    await waitFor(() => expect(optionTexts()).toEqual(['Anna Berg — Acme', 'desk@acme.test — Acme']));
  });

  it('shows the chosen contact as its name and supplier, without its email', async () => {
    renderSelect({ value: 'c-1' });
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('Anna Berg — Acme'));
  });
});
