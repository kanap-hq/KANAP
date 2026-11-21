import '../../i18n';
import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';

const hasLevel = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel }) }));

import ItemContactsSection from './ItemContactsSection';

const mocked = vi.mocked(api);

const CONTACTS = [
  { id: 'c-1', item_number: 1, first_name: 'Anna', last_name: 'Berg', job_title: null, email: 'anna@acme.test', active: true, supplier_id: 's-1', supplier_name: 'Acme' },
  { id: 'c-2', item_number: 2, first_name: null, last_name: null, job_title: null, email: 'desk@acme.test', active: true, supplier_id: null, supplier_name: null },
];

function renderSection(itemType: 'contracts' | 'spend-items', itemId: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <ItemContactsSection itemType={itemType} itemId={itemId} canManage />
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const optionTexts = () => screen.getAllByRole('option').map((option) => option.textContent);

// Lot A1 of 26.11.9: Add opens the list of contacts anchored to the button, as the Technologies
// section does; the list ends with "create"; the role is asked next, in the same place.
describe.each([
  ['contracts', 'ct-1'],
  ['spend-items', 'line-1'],
] as const)('ItemContactsSection (%s): add a contact', (itemType, itemId) => {
  beforeEach(() => {
    mocked.get.mockReset();
    mocked.post.mockReset();
    hasLevel.mockReset();
    hasLevel.mockReturnValue(true);
    mocked.get.mockImplementation((async (url: string, config?: { params?: { q?: string } }) => {
      if (url === '/contacts') {
        const q = (config?.params?.q ?? '').toLowerCase();
        return { data: { items: CONTACTS.filter((c) => !q || `${c.first_name ?? ''} ${c.last_name ?? ''} ${c.email}`.toLowerCase().includes(q)) } };
      }
      if (url === `/${itemType}/${itemId}/contacts`) return { data: [] };
      throw new Error(`unexpected ${url}`);
    }) as never);
    mocked.post.mockImplementation((async (url: string) => {
      if (url === '/contacts') {
        return { data: { id: 'c-9', item_number: 9, first_name: null, last_name: 'Zed', job_title: 'Buyer', email: 'zed@acme.test', active: true, supplier_id: null, supplier_role: null } };
      }
      return { data: {} };
    }) as never);
  });

  it('opens the list of contacts with nothing typed: reference, name, supplier, then the option to create', async () => {
    renderSection(itemType, itemId);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await waitFor(() => expect(optionTexts()).toEqual(['CTCT-1Anna BergAcme', 'CTCT-2desk@acme.test', '+ New contact']));
    expect(mocked.get).toHaveBeenCalledWith('/contacts', expect.objectContaining({ params: { limit: 20, q: '' } }));
    // The list sits in the popover; the old row under the table (a field, then a role select) is gone.
    expect(screen.getByRole('combobox', { name: 'Select contact' }).closest('.MuiPopover-paper')).not.toBeNull();
    expect(screen.queryByText('Role…')).toBeNull();
  });

  it('links the contact chosen with the role chosen next', async () => {
    renderSection(itemType, itemId);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    fireEvent.click(await screen.findByRole('option', { name: /Anna Berg/ }));
    const roles = await screen.findByRole('menu', { name: 'Role' });
    expect(screen.getByText('Anna Berg')).toBeInTheDocument();
    expect(within(roles).getAllByRole('menuitem').map((item) => item.textContent)).toEqual(['Commercial', 'Technical', 'Support', 'Other']);
    fireEvent.click(within(roles).getByRole('menuitem', { name: 'Support' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(`/${itemType}/${itemId}/contacts`, { contactId: 'c-1', role: 'support' }));
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
  });

  it('links nothing when Escape closes the role step', async () => {
    renderSection(itemType, itemId);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    fireEvent.click(await screen.findByRole('option', { name: /Anna Berg/ }));
    const roles = await screen.findByRole('menu', { name: 'Role' });
    fireEvent.keyDown(roles, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('creates a contact from the typed name, with its job title, then links it with the role chosen', async () => {
    renderSection(itemType, itemId);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Select contact' }), { target: { value: 'Zed' } });
    fireEvent.click(await screen.findByRole('option', { name: '+ Create contact "Zed"' }));
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email' }), { target: { value: 'zed@acme.test' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Job title' }), { target: { value: 'Buyer' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/contacts', expect.objectContaining({ email: 'zed@acme.test', last_name: 'Zed', job_title: 'Buyer' })));
    const roles = await screen.findByRole('menu', { name: 'Role' });
    fireEvent.click(within(roles).getByRole('menuitem', { name: 'Technical' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(`/${itemType}/${itemId}/contacts`, { contactId: 'c-9', role: 'technical' }));
  });

  it('creates a contact from the list with nothing typed: the dialog opens empty', async () => {
    renderSection(itemType, itemId);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    fireEvent.click(await screen.findByRole('option', { name: '+ New contact' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('textbox', { name: 'First name' })).toHaveValue('');
    expect(within(dialog).getByRole('textbox', { name: 'Last name' })).toHaveValue('');
  });

  it('goes to the end with the keyboard alone: Add, type, arrow down, Enter, arrow down, Enter', async () => {
    renderSection(itemType, itemId);
    const add = await screen.findByRole('button', { name: 'Add' });
    fireEvent.click(add);
    const field = screen.getByRole('combobox', { name: 'Select contact' });
    fireEvent.change(field, { target: { value: 'anna' } });
    await waitFor(() => expect(optionTexts()).toEqual(['CTCT-1Anna BergAcme', '+ Create contact "anna"']));
    fireEvent.keyDown(field, { key: 'ArrowDown' });
    await act(async () => { fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' }); });
    await screen.findByRole('menu', { name: 'Role' });
    await waitFor(() => expect(screen.getByRole('menu', { name: 'Role' })).toHaveFocus());
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'ArrowDown' });
    expect(screen.getByRole('menuitem', { name: 'Commercial' })).toHaveFocus();
    await act(async () => { fireEvent.keyDown(document.activeElement as HTMLElement, { key: 'Enter' }); });
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(`/${itemType}/${itemId}/contacts`, { contactId: 'c-1', role: 'commercial' }));
  });

  it('offers no creation to a person who may not create contacts', async () => {
    hasLevel.mockReturnValue(false);
    renderSection(itemType, itemId);
    fireEvent.click(await screen.findByRole('button', { name: 'Add' }));
    await waitFor(() => expect(optionTexts()).toEqual(['CTCT-1Anna BergAcme', 'CTCT-2desk@acme.test']));
    expect(hasLevel).toHaveBeenCalledWith('contacts', 'member');
  });
});
