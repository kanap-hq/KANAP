import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { NotifyProvider } from '../../components/notify/NotifyProvider';

// A stable `t`: a new one on each render would loop the effects.
const t = vi.hoisted(() => (key: string) => key);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../components/fields/ContactSelect', () => ({ default: () => null }));

import api from '../../api';
import SupplierContactsTab from './SupplierContactsTab';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const LINK = {
  id: 'l-1',
  supplier_id: 's-1',
  contact_id: 'c-1',
  role: 'commercial',
  is_primary: true,
  contact: { id: 'c-1', first_name: 'Alex', last_name: 'Martin', email: 'alex@acme.test' },
};

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <NotifyProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <SupplierContactsTab supplierId="s-1" canManage />
          </MemoryRouter>
        </QueryClientProvider>
      </NotifyProvider>
    </ThemeProvider>,
  );
}

describe('SupplierContactsTab', () => {
  let links: Array<typeof LINK>;

  beforeEach(() => {
    links = [LINK];
    mocked.get.mockReset().mockImplementation(async () => ({ data: links }));
    mocked.delete.mockReset().mockImplementation(async () => { links = []; return { data: {} }; });
    mocked.post.mockReset().mockImplementation(async () => { links = [{ ...LINK, id: 'l-2' }]; return { data: {} }; });
  });

  it('says the contact stays in Contacts once its link is removed, and undoes it', async () => {
    renderTab();
    const commercial = await screen.findByRole('region', { name: 'contacts.roles.commercial' });
    fireEvent.click(await within(commercial).findByRole('button', { name: 'suppliers.contacts.removeLink' }));

    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/suppliers/s-1/contacts/l-1'));
    expect(await screen.findByText('suppliers.contacts.linkRemoved')).toBeInTheDocument();
    expect(within(commercial).queryByText('Alex Martin')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'buttons.undo' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(
      '/suppliers/s-1/contacts',
      { contactId: 'c-1', role: 'commercial', isPrimary: true },
    ));
    expect(await within(commercial).findByText('Alex Martin')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('suppliers.contacts.linkRemoved')).not.toBeInTheDocument());
  });

  it('says nothing was removed when the removal fails', async () => {
    mocked.delete.mockReset().mockRejectedValue({ response: { status: 500, data: {} } });
    renderTab();
    const commercial = await screen.findByRole('region', { name: 'contacts.roles.commercial' });
    fireEvent.click(await within(commercial).findByRole('button', { name: 'suppliers.contacts.removeLink' }));
    expect(await screen.findByText('suppliers.contacts.saveFailed')).toBeInTheDocument();
    expect(screen.queryByText('suppliers.contacts.linkRemoved')).not.toBeInTheDocument();
  });
});
