import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const apiGet = vi.hoisted(() => vi.fn());
const apiPost = vi.hoisted(() => vi.fn());
const hasLevel = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { name?: string }) => (options?.name ? `${key}:${options.name}` : key),
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));
vi.mock('../../api', () => ({ default: { get: apiGet, post: apiPost } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel }) }));

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
    apiPost.mockReset();
    hasLevel.mockReset();
    hasLevel.mockReturnValue(true);
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
    await waitFor(() => expect(optionTexts()).toEqual(['Anna Berg', 'desk@acme.test', 'master-data:contacts.newContactOption']));
    expect(screen.getByText('Acme')).toBeTruthy();
    expect(screen.queryByText(/anna\.berg@acme\.test/)).toBeNull();
  });

  // Lot R3 of 26.11.9: the list's quick search finds a typed CTCT-n exactly; the option shows it.
  it('sends a typed CTCT-n to the search and shows the reference of each option', async () => {
    apiGet.mockImplementation(async (url: string, config?: { params?: { q?: string } }) => {
      if (url !== '/contacts') throw new Error(`unexpected ${url}`);
      const q = config?.params?.q ?? '';
      return { data: { items: q.toUpperCase() === 'CTCT-4' ? [{ ...CONTACTS[0], item_number: 4 }] : [] } };
    });
    renderSelect();
    const input = screen.getByRole('combobox');
    fireEvent.mouseDown(input);
    fireEvent.change(input, { target: { value: 'ctct-4' } });
    await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/contacts', { params: { limit: 20, q: 'ctct-4' } }));
    const option = await screen.findByRole('option', { name: /Anna Berg/ });
    expect(option.textContent).toBe('Anna BergCTCT-4');
  });

  it('names the supplier on the same line when the list is not grouped', async () => {
    renderSelect({ groupByCompany: false });
    fireEvent.mouseDown(screen.getByRole('combobox'));
    await waitFor(() => expect(optionTexts()).toEqual(['Anna Berg (Acme)', 'desk@acme.test (Acme)', 'master-data:contacts.newContactOption']));
  });

  it('shows the chosen contact as its name and supplier, without its email', async () => {
    renderSelect({ value: 'c-1' });
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveValue('Anna Berg (Acme)'));
  });

  // Lot A1 of 26.11.9: the list takes the density of the Relations "Add" picker.
  it('draws 32 px rows and compact 12 px group headings', async () => {
    renderSelect();
    fireEvent.mouseDown(screen.getByRole('combobox'));
    const option = await screen.findByRole('option', { name: 'Anna Berg' });
    expect(getComputedStyle(option).minHeight).toBe('32px');
    expect(getComputedStyle(option).fontSize).toBe('13px');
    const create = screen.getByRole('option', { name: 'master-data:contacts.newContactOption' });
    expect(getComputedStyle(create).minHeight).toBe('32px');
    expect(getComputedStyle(create).paddingLeft).toBe(getComputedStyle(option).paddingLeft);
    const heading = screen.getByText('Acme');
    expect(getComputedStyle(heading).fontSize).toBe('12px');
    expect(heading.className).not.toMatch(/MuiListSubheader/);
  });

  describe('creating a contact from the list', () => {
    const NEW_CONTACT = { id: 'c-9', item_number: 9, first_name: 'Zed', last_name: null, job_title: null, email: 'zed@acme.test', active: true, supplier_id: null, supplier_name: null };

    const typeInto = (text: string) => {
      const input = screen.getByRole('combobox');
      fireEvent.mouseDown(input);
      fireEvent.change(input, { target: { value: text } });
    };
    const noMatch = () => apiGet.mockImplementation(async (url: string) => {
      if (url === '/contacts') return { data: { items: [] } };
      throw new Error(`unexpected ${url}`);
    });
    const openDialogFor = async (text: string) => {
      noMatch();
      typeInto(text);
      fireEvent.click(await screen.findByRole('option', { name: `master-data:contacts.createOption:${text}` }));
      return screen.findByRole('dialog');
    };
    const fill = (label: string, value: string) => fireEvent.change(screen.getByRole('textbox', { name: label }), { target: { value } });

    it('offers to create the typed name to a person who may, on an empty list as on a list of other matches', async () => {
      renderSelect();
      noMatch();
      typeInto('Zed');
      expect(await screen.findByRole('option', { name: 'master-data:contacts.createOption:Zed' })).toBeTruthy();
      cleanup();
      apiGet.mockImplementation(async () => ({ data: { items: CONTACTS } }));
      renderSelect();
      typeInto('Zed');
      expect(await screen.findByRole('option', { name: 'master-data:contacts.createOption:Zed' })).toBeTruthy();
      expect(optionTexts()).toEqual(['Anna Berg', 'desk@acme.test', 'master-data:contacts.createOption:Zed']);
    });

    // Lot A1 of 26.11.9 (Fried, 21/11): the option closes the list before anything is typed too.
    it('ends the list with the option to create a contact with nothing typed, on a list of matches and on an empty one', async () => {
      renderSelect();
      fireEvent.mouseDown(screen.getByRole('combobox'));
      await waitFor(() => expect(optionTexts()).toEqual(['Anna Berg', 'desk@acme.test', 'master-data:contacts.newContactOption']));
      cleanup();
      noMatch();
      renderSelect();
      fireEvent.mouseDown(screen.getByRole('combobox'));
      await waitFor(() => expect(optionTexts()).toEqual(['master-data:contacts.newContactOption']));
    });

    it('opens an empty dialog from that option, the cursor in the first name', async () => {
      renderSelect();
      fireEvent.mouseDown(screen.getByRole('combobox'));
      fireEvent.click(await screen.findByRole('option', { name: 'master-data:contacts.newContactOption' }));
      await screen.findByRole('dialog');
      const first = screen.getByRole('textbox', { name: 'master-data:contacts.fields.firstName' });
      expect(first).toHaveValue('');
      expect(screen.getByRole('textbox', { name: 'master-data:contacts.fields.lastName' })).toHaveValue('');
      expect(screen.getByRole('textbox', { name: 'master-data:contacts.fields.email' })).toHaveValue('');
      await waitFor(() => expect(first).toHaveFocus());
    });

    it('offers no creation with nothing typed to a person who may not create', async () => {
      hasLevel.mockReturnValue(false);
      renderSelect();
      fireEvent.mouseDown(screen.getByRole('combobox'));
      await waitFor(() => expect(optionTexts()).toEqual(['Anna Berg', 'desk@acme.test']));
    });

    it('does not offer it when a contact already has exactly that name', async () => {
      renderSelect();
      typeInto('anna berg');
      await waitFor(() => expect(optionTexts()).toEqual(['Anna Berg', 'desk@acme.test']));
    });

    it('does not offer it when a contact has that name typed last name first', async () => {
      renderSelect();
      typeInto('berg  anna');
      await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/contacts', { params: { limit: 20, q: 'berg  anna' } }));
      await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
      expect(screen.queryByRole('option', { name: /createOption/ })).toBeNull();
    });

    it('does not offer it for a typed reference, which names a contact and never one to create', async () => {
      renderSelect();
      typeInto('ctct-99');
      await waitFor(() => expect(apiGet).toHaveBeenCalledWith('/contacts', { params: { limit: 20, q: 'ctct-99' } }));
      await waitFor(() => expect(screen.queryByRole('progressbar')).toBeNull());
      expect(screen.queryByRole('option', { name: 'master-data:contacts.createOption:ctct-99' })).toBeNull();
    });

    it('offers no creation without the right, and says whom to ask on an empty list', async () => {
      hasLevel.mockReturnValue(false);
      renderSelect();
      noMatch();
      typeInto('Zed');
      expect(await screen.findByText('master-data:contacts.noContactAskAdmin')).toBeTruthy();
      expect(screen.queryByRole('option')).toBeNull();
      expect(hasLevel).toHaveBeenCalledWith('contacts', 'member');
    });

    it('offers no creation to a field that is disabled', async () => {
      renderSelect({ disabled: true });
      expect(screen.getByRole('combobox')).toBeDisabled();
      expect(screen.queryByRole('option')).toBeNull();
    });

    it('opens a dialog with the typed text split at the first space, and the last name alone for one word', async () => {
      renderSelect();
      await openDialogFor('Jean de la Tour');
      expect(screen.getByRole('textbox', { name: 'master-data:contacts.fields.firstName' })).toHaveValue('Jean');
      expect(screen.getByRole('textbox', { name: 'master-data:contacts.fields.lastName' })).toHaveValue('de la Tour');
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      cleanup();
      renderSelect();
      await openDialogFor('Zed');
      expect(screen.getByRole('textbox', { name: 'master-data:contacts.fields.firstName' })).toHaveValue('');
      expect(screen.getByRole('textbox', { name: 'master-data:contacts.fields.lastName' })).toHaveValue('Zed');
    });

    it('writes the contact and hands it to the field as if picked from the list', async () => {
      apiPost.mockResolvedValue({ data: NEW_CONTACT });
      const onChange = vi.fn();
      const onContactChange = vi.fn();
      renderSelect({ onChange, onContactChange });
      await openDialogFor('Zed');
      fill('master-data:contacts.fields.email', ' Zed@Acme.test ');
      fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
      await waitFor(() => expect(onChange).toHaveBeenCalledWith('c-9'));
      expect(apiPost).toHaveBeenCalledWith('/contacts', {
        email: 'Zed@Acme.test', first_name: null, last_name: 'Zed', job_title: null, supplier_id: null, supplier_role: null,
      });
      expect(onContactChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'c-9' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    });

    it('says an email already used under the email and keeps the dialog open', async () => {
      apiPost.mockRejectedValue({ response: { status: 400, data: { message: 'A contact with this email already exists' } } });
      const onChange = vi.fn();
      renderSelect({ onChange });
      await openDialogFor('Zed');
      fill('master-data:contacts.fields.email', 'zed@acme.test');
      fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
      expect(await screen.findByText('master-data:contacts.messages.emailTaken')).toBeTruthy();
      expect(screen.getByRole('dialog')).toBeTruthy();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('says an empty or malformed email under the email, and writes nothing', async () => {
      renderSelect();
      await openDialogFor('Zed');
      fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
      expect(await screen.findByText('master-data:contacts.messages.emailRequired')).toBeTruthy();
      fill('master-data:contacts.fields.email', 'zed at acme');
      fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
      expect(await screen.findByText('master-data:contacts.messages.emailInvalid')).toBeTruthy();
      expect(screen.queryByText('master-data:contacts.messages.emailRequired')).toBeNull();
      expect(apiPost).not.toHaveBeenCalled();
      expect(screen.getByRole('dialog')).toBeTruthy();
    });

    it('closes on Escape and on Cancel with an entry in progress, and writes nothing', async () => {
      const onChange = vi.fn();
      renderSelect({ onChange });
      await openDialogFor('Zed');
      fill('master-data:contacts.fields.email', 'zed@acme.test');
      fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      typeInto('Zed');
      fireEvent.click(await screen.findByRole('option', { name: 'master-data:contacts.createOption:Zed' }));
      fill('master-data:contacts.fields.email', 'zed@acme.test');
      fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
      expect(apiPost).not.toHaveBeenCalled();
      expect(onChange).not.toHaveBeenCalled();
    });

    it('gives the contact its supplier and type when the field is for a supplier', async () => {
      apiPost.mockResolvedValue({ data: { ...NEW_CONTACT, supplier_id: 's-1', supplier_role: 'technical' } });
      renderSelect({ createSupplier: { id: 's-1', role: 'technical' } });
      await openDialogFor('Zed');
      expect(screen.queryByRole('combobox', { name: 'contacts.fields.contactType' })).toBeNull();
      fill('master-data:contacts.fields.email', 'zed@acme.test');
      fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
      await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/contacts', expect.objectContaining({ supplier_id: 's-1', supplier_role: 'technical' })));
    });

    it('asks for the contact type when a supplier is given without one, commercial first', async () => {
      apiPost.mockResolvedValue({ data: { ...NEW_CONTACT, supplier_id: 's-1', supplier_role: 'commercial' } });
      renderSelect({ createSupplier: { id: 's-1' } });
      await openDialogFor('Zed');
      expect(screen.getByRole('combobox', { name: 'contacts.fields.contactType' })).toBeTruthy();
      fill('master-data:contacts.fields.email', 'zed@acme.test');
      fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
      await waitFor(() => expect(apiPost).toHaveBeenCalledWith('/contacts', expect.objectContaining({ supplier_id: 's-1', supplier_role: 'commercial' })));
    });
  });
});
