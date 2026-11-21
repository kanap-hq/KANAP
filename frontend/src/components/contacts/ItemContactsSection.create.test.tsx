import '../../i18n';
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));

import ItemContactsSection from './ItemContactsSection';

const mocked = vi.mocked(api);

// Lot A1 of 26.11.9: a contact created from the picker of a contract's Relations tab is the one
// picked, so choosing its role links it to the contract (the contract is never left).
describe('ItemContactsSection with the real contact picker', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/contacts') return { data: { items: [] } } as never;
      if (url === '/contracts/ct-1/contacts') return { data: [] } as never;
      throw new Error(`unexpected ${url}`);
    });
    mocked.post.mockImplementation((async (url: string) => {
      if (url === '/contacts') {
        return { data: { id: 'c-9', item_number: 9, first_name: null, last_name: 'Zed', job_title: null, email: 'zed@acme.test', active: true, supplier_id: null, supplier_role: null } };
      }
      return { data: {} };
    }) as never);
  });

  it('links the contact created from the picker to the contract', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={client}>
          <MemoryRouter>
            <ItemContactsSection itemType="contracts" itemId="ct-1" canManage />
          </MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    const picker = screen.getByRole('combobox');
    fireEvent.mouseDown(picker);
    fireEvent.change(picker, { target: { value: 'Zed' } });
    fireEvent.click(await screen.findByRole('option', { name: /Create contact "Zed"/ }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email' }), { target: { value: 'zed@acme.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contacts', expect.objectContaining({ email: 'zed@acme.test', last_name: 'Zed' })));
    // The contact is picked: the role of the link is asked next, and choosing it links the contact.
    const role = await screen.findAllByRole('combobox');
    fireEvent.mouseDown(role[role.length - 1]);
    fireEvent.click(await screen.findByRole('option', { name: 'Technical' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contracts/ct-1/contacts', { contactId: 'c-9', role: 'technical' }));
  });
});
