import '../../i18n';
import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { NotifyProvider } from '../../components/notify/NotifyProvider';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));

import api from '../../api';
import SupplierContactsTab from './SupplierContactsTab';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn>; post: ReturnType<typeof vi.fn> };

// Lot A1 of 26.11.9: the contact created from the picker of a supplier's Contacts tab belongs to
// that supplier, with the type of the section it was added in.
describe('SupplierContactsTab creating a contact from the picker', () => {
  beforeEach(() => {
    mocked.get.mockReset().mockImplementation(async (url: string) => {
      if (url === '/contacts') return { data: { items: [] } };
      if (url === '/suppliers/s-1/contacts') return { data: [] };
      throw new Error(`unexpected ${url}`);
    });
    mocked.post.mockReset().mockImplementation(async (url: string) => {
      if (url === '/contacts') {
        return { data: { id: 'c-9', item_number: 9, first_name: null, last_name: 'Zed', job_title: null, email: 'zed@acme.test', active: true, supplier_id: 's-1', supplier_role: 'technical' } };
      }
      return { data: {} };
    });
  });

  it('creates the contact on the supplier with the section type, then links it there', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
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
    const technical = await screen.findByRole('region', { name: 'Technical' });
    fireEvent.click(within(technical).getByRole('button', { name: 'Add existing' }));
    const picker = await within(technical).findByRole('combobox');
    fireEvent.mouseDown(picker);
    fireEvent.change(picker, { target: { value: 'Zed' } });
    fireEvent.click(await screen.findByRole('option', { name: /Create contact "Zed"/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email' }), { target: { value: 'zed@acme.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contacts', {
      email: 'zed@acme.test', first_name: null, last_name: 'Zed', job_title: null, supplier_id: 's-1', supplier_role: 'technical',
    }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/suppliers/s-1/contacts', { contactId: 'c-9', role: 'technical' }));
  });
});
