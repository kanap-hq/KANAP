import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import enMasterData from '../../locales/en/master-data.json';

const navigateMock = vi.hoisted(() => vi.fn());

// Resolves `master-data:` keys from the English locale, so the test sees the text a user reads.
const t = vi.hoisted(() => {
  const state: { dict: Record<string, unknown> } = { dict: {} };
  const fn = (key: string) => {
    if (!key.startsWith('master-data:')) return key;
    const value = key
      .slice('master-data:'.length)
      .split('.')
      .reduce<unknown>((node, part) => (node as Record<string, unknown> | undefined)?.[part], state.dict);
    return typeof value === 'string' ? value : key;
  };
  return { fn, state };
});

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: t.fn, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
vi.mock('../../components/fields/SupplierSelect', () => ({
  default: ({ value, onChange }: { value: string | null; onChange: (v: string | null) => void }) => (
    <button type="button" onClick={() => onChange(SUPPLIER_ID)}>
      {value ? 'Microsoft' : 'Pick supplier'}
    </button>
  ),
}));

import api from '../../api';
import { KanapDialogProvider } from '../../components/design';
import ContactWorkspacePage from './ContactWorkspacePage';

const SUPPLIER_ID = '6f1d2c4e-8a3b-4c5d-9e7f-1a2b3c4d5e6f';
const CONTACT_TYPE_ERROR = 'Select a contact type for this supplier';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
};

const CONTACT = {
  id: 'contact-1',
  first_name: 'Robert',
  last_name: 'Chen',
  job_title: null,
  email: 'robert.chen@example.test',
  phone: null,
  mobile: null,
  country: null,
  supplier_id: null,
  supplier_role: null,
  notes: null,
  active: true,
};

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/master-data/contacts/:id/:tab" element={<ContactWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

async function chooseContactType(label: string) {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: /contact type/i }));
  fireEvent.click(await screen.findByRole('option', { name: label }));
}

describe('ContactWorkspacePage save', () => {
  beforeEach(() => {
    t.state.dict = enMasterData as Record<string, unknown>;
    navigateMock.mockReset();
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    mocked.get.mockResolvedValue({ data: CONTACT });
    mocked.patch.mockResolvedValue({ data: CONTACT });
    mocked.post.mockResolvedValue({ data: { id: 'contact-2' } });
  });

  it('keeps the contact open and shows the contact type error when a supplier has no type', async () => {
    renderAt('/master-data/contacts/contact-1/overview');
    await screen.findByDisplayValue('robert.chen@example.test');

    fireEvent.click(screen.getByRole('button', { name: 'Pick supplier' }));
    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    expect(await screen.findByText(CONTACT_TYPE_ERROR)).toBeInTheDocument();
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(save).toBeEnabled();
  });

  it('saves and returns to the list once the contact type is chosen', async () => {
    renderAt('/master-data/contacts/contact-1/overview');
    await screen.findByDisplayValue('robert.chen@example.test');

    fireEvent.click(screen.getByRole('button', { name: 'Pick supplier' }));
    await chooseContactType('Commercial');
    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    expect(mocked.patch.mock.calls[0][0]).toBe('/contacts/contact-1');
    expect(mocked.patch.mock.calls[0][1]).toMatchObject({ supplier_id: SUPPLIER_ID, supplier_role: 'commercial' });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/contacts'));
  });

  it('keeps the contact open when the server refuses the save, and shows its message', async () => {
    mocked.patch.mockRejectedValue({ response: { data: { message: 'Email already used' } } });
    renderAt('/master-data/contacts/contact-1/overview');
    await screen.findByDisplayValue('robert.chen@example.test');

    fireEvent.change(screen.getByLabelText(/job title/i), { target: { value: 'Account manager' } });
    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    expect(await screen.findByText('Email already used')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
    expect(save).toBeEnabled();
  });

  it('does not create a contact whose supplier has no type', async () => {
    renderAt('/master-data/contacts/new/overview');

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'new.contact@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pick supplier' }));
    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    expect(await screen.findByText(CONTACT_TYPE_ERROR)).toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('creates the contact and returns to the list once the contact type is chosen', async () => {
    renderAt('/master-data/contacts/new/overview');

    fireEvent.change(screen.getByLabelText(/email/i), { target: { value: 'new.contact@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pick supplier' }));
    await chooseContactType('Technical');
    const save = screen.getByRole('button', { name: 'Save' });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][1]).toMatchObject({
      email: 'new.contact@example.test',
      supplier_id: SUPPLIER_ID,
      supplier_role: 'technical',
    });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/contacts'));
  });
});
