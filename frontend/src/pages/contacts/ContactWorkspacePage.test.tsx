import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const navigateMock = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ canEdit: true }));
// A stable `t`: a new one on each render would loop the effects.
const t = vi.hoisted(() => (key: string, options?: Record<string, unknown>) => (
  options?.field ? `${key}:${String(options.field)}` : key
));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('react-router-dom', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-router-dom')>()),
  useNavigate: () => navigateMock,
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => auth.canEdit, profile: { id: 'user-1' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
// The supplier picker searches the API: a stub picks a supplier or clears it.
vi.mock('../../components/fields/SupplierSelect', () => ({
  // One field in the tab order, as the real picker; the buttons only drive the tests.
  default: (props: { label?: string; value: string | null; onChange: (v: string | null) => void; disabled?: boolean }) => (
    <div data-testid="supplier-select" data-value={props.value ?? ''} data-disabled={String(!!props.disabled)}>
      <input aria-label={props.label} value={props.value ?? ''} disabled={props.disabled} readOnly />
      <button type="button" tabIndex={-1} onClick={() => props.onChange('s-2')}>pick supplier</button>
      <button type="button" tabIndex={-1} onClick={() => props.onChange(null)}>clear supplier</button>
    </div>
  ),
}));

import api from '../../api';
import ContactWorkspacePage from './ContactWorkspacePage';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
};

const CONTACT = {
  id: 'c-1',
  first_name: 'Alex',
  last_name: 'Martin',
  job_title: 'Account manager',
  email: 'alex@example.com',
  phone: '+33 123456789',
  mobile: null,
  country: null,
  notes: 'Prefers email',
  active: true,
  supplier_id: 's-1',
  supplier_role: 'commercial',
  supplier_name: 'Supplier A',
};

let stored: Record<string, unknown>;

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[path]}>
          <LocationProbe />
          <Routes>
            <Route path="/master-data/contacts/:id" element={<ContactWorkspacePage />} />
            <Route path="/master-data/contacts/:id/:tab" element={<ContactWorkspacePage />} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const lastPatch = () => mocked.patch.mock.calls[mocked.patch.mock.calls.length - 1];

describe('ContactWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.canEdit = true;
    stored = { ...CONTACT };
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/contacts/c-1') return { data: stored };
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (_url: string, body: Record<string, unknown>) => {
      const { supplier_name: _name, ...rest } = stored;
      stored = { ...stored, ...body, supplier_name: body.supplier_id === 's-2' ? 'Supplier B' : stored.supplier_name };
      return { data: { ...rest, ...body } };
    });
  });

  it('shows the name as title, the supplier as a link and no save button', async () => {
    renderAt('/master-data/contacts/c-1/overview');
    expect(await screen.findByText('Alex Martin')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Supplier A' })).toHaveAttribute('href', '/master-data/suppliers/s-1/overview');
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reset/i })).toBeNull();
  });

  it('shows the email as title when the contact has no name', async () => {
    stored = { ...CONTACT, first_name: null, last_name: null };
    renderAt('/master-data/contacts/c-1/overview');
    expect(await screen.findByText('alex@example.com', { selector: 'span' })).toBeInTheDocument();
  });

  it('saves first and last name together when focus leaves the title', async () => {
    renderAt('/master-data/contacts/c-1/overview');
    fireEvent.click(await screen.findByText('Alex Martin'));
    const first = screen.getByLabelText('contacts.fields.firstName');
    const last = screen.getByLabelText('contacts.fields.lastName');
    fireEvent.change(first, { target: { value: 'Alexandra' } });
    // Moving from one name to the other saves nothing yet.
    fireEvent.blur(first, { relatedTarget: last });
    expect(mocked.patch).not.toHaveBeenCalled();
    fireEvent.change(last, { target: { value: 'Martin Dupont' } });
    fireEvent.blur(last);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledTimes(1));
    expect(lastPatch()).toEqual(['/contacts/c-1', { email: 'alex@example.com', first_name: 'Alexandra', last_name: 'Martin Dupont' }]);
  });

  it('saves the email and the job title on blur, with nothing sent when unchanged', async () => {
    renderAt('/master-data/contacts/c-1/overview');
    const job = await screen.findByLabelText('contacts.fields.jobTitle');
    await waitFor(() => expect(job).toHaveValue('Account manager'));
    fireEvent.focus(job);
    fireEvent.blur(job);
    expect(mocked.patch).not.toHaveBeenCalled();
    fireEvent.focus(job);
    fireEvent.change(job, { target: { value: 'Sales director' } });
    fireEvent.blur(job);
    await waitFor(() => expect(lastPatch()).toEqual(['/contacts/c-1', { email: 'alex@example.com', job_title: 'Sales director' }]));

    const email = screen.getByLabelText('contacts.fields.email');
    fireEvent.focus(email);
    fireEvent.change(email, { target: { value: 'alex.martin@example.com' } });
    fireEvent.blur(email);
    await waitFor(() => expect(lastPatch()).toEqual(['/contacts/c-1', { email: 'alex.martin@example.com' }]));
  });

  it('shows an invalid email on the field and saves nothing', async () => {
    renderAt('/master-data/contacts/c-1/overview');
    const email = await screen.findByLabelText('contacts.fields.email');
    await waitFor(() => expect(email).toHaveValue('alex@example.com'));
    fireEvent.focus(email);
    fireEvent.change(email, { target: { value: 'not-an-email' } });
    fireEvent.blur(email);
    expect(await screen.findByText('master-data:contacts.messages.emailInvalid')).toBeInTheDocument();
    expect(mocked.patch).not.toHaveBeenCalled();
    expect(email).toHaveValue('not-an-email');
  });

  it('shows an email another contact has on the field', async () => {
    mocked.patch.mockRejectedValueOnce({ response: { status: 400, data: { message: 'A contact with this email already exists' } } });
    renderAt('/master-data/contacts/c-1/overview');
    const email = await screen.findByLabelText('contacts.fields.email');
    await waitFor(() => expect(email).toHaveValue('alex@example.com'));
    fireEvent.focus(email);
    fireEvent.change(email, { target: { value: 'taken@example.com' } });
    fireEvent.blur(email);
    expect(await screen.findByText('contacts.messages.emailTaken')).toBeInTheDocument();
  });

  it('refuses a phone number out of format, and saves a valid one with the country of its dial code', async () => {
    stored = { ...CONTACT, phone: null };
    renderAt('/master-data/contacts/c-1/overview');
    const phone = await screen.findByLabelText('contacts.fields.phone');
    const code = screen.getByLabelText('contacts.fields.dialCodeOf:contacts.fields.phone');
    fireEvent.focus(code);
    fireEvent.change(code, { target: { value: '+44' } });
    fireEvent.change(phone, { target: { value: '12' } });
    fireEvent.blur(phone);
    expect(await screen.findByText('master-data:contacts.messages.phoneInvalid')).toBeInTheDocument();
    expect(mocked.patch).not.toHaveBeenCalled();

    fireEvent.focus(phone);
    fireEvent.change(phone, { target: { value: '20 7946 0958' } });
    fireEvent.blur(phone);
    await waitFor(() => expect(lastPatch()).toEqual([
      '/contacts/c-1',
      { email: 'alex@example.com', phone: '+44 20 7946 0958', country: 'GB' },
    ]));
    await waitFor(() => expect(screen.queryByText('master-data:contacts.messages.phoneInvalid')).toBeNull());
  });

  it('saves the notes after a pause in typing, and at once when focus leaves them', async () => {
    renderAt('/master-data/contacts/c-1/overview');
    const notes = await screen.findByLabelText('contacts.fields.notes');
    await waitFor(() => expect(notes).toHaveValue('Prefers email'));
    fireEvent.focus(notes);
    fireEvent.change(notes, { target: { value: 'Prefers phone' } });
    expect(mocked.patch).not.toHaveBeenCalled();
    await waitFor(() => expect(lastPatch()).toEqual(['/contacts/c-1', { email: 'alex@example.com', notes: 'Prefers phone' }]), { timeout: 2000 });

    fireEvent.change(notes, { target: { value: 'Prefers phone calls' } });
    fireEvent.blur(notes);
    await waitFor(() => expect(lastPatch()).toEqual(['/contacts/c-1', { email: 'alex@example.com', notes: 'Prefers phone calls' }]));
  });

  it('saves the status and the contact type from the metadata menus', async () => {
    renderAt('/master-data/contacts/c-1/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'contacts.status.active' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'contacts.status.inactive' }));
    await waitFor(() => expect(lastPatch()).toEqual(['/contacts/c-1', { email: 'alex@example.com', active: false }]));

    fireEvent.click(screen.getByRole('button', { name: 'contacts.fields.contactType' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'contacts.roles.technical' }));
    await waitFor(() => expect(lastPatch()).toEqual([
      '/contacts/c-1',
      { email: 'alex@example.com', supplier_id: 's-1', supplier_role: 'technical' },
    ]));
  });

  it('gives a supplier chosen for a contact without one the default type, in the same save', async () => {
    stored = { ...CONTACT, supplier_id: null, supplier_role: null, supplier_name: null };
    renderAt('/master-data/contacts/c-1/overview');
    expect(await screen.findByText('contacts.metadata.supplierMissing')).toBeInTheDocument();
    // No supplier: no type to choose.
    expect(screen.queryByRole('button', { name: 'contacts.fields.contactType' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'pick supplier' }));
    await waitFor(() => expect(lastPatch()).toEqual([
      '/contacts/c-1',
      { email: 'alex@example.com', supplier_id: 's-2', supplier_role: 'commercial' },
    ]));
    expect(await screen.findByRole('link', { name: 'Supplier B' })).toBeInTheDocument();
  });

  it('keeps the type of a contact that changes supplier, and clears both together', async () => {
    stored = { ...CONTACT, supplier_role: 'support' };
    renderAt('/master-data/contacts/c-1/overview');
    await screen.findByRole('link', { name: 'Supplier A' });
    fireEvent.click(screen.getByRole('button', { name: 'pick supplier' }));
    await waitFor(() => expect(lastPatch()).toEqual([
      '/contacts/c-1',
      { email: 'alex@example.com', supplier_id: 's-2', supplier_role: 'support' },
    ]));
    fireEvent.click(screen.getByRole('button', { name: 'clear supplier' }));
    await waitFor(() => expect(lastPatch()).toEqual([
      '/contacts/c-1',
      { email: 'alex@example.com', supplier_id: null, supplier_role: null },
    ]));
  });

  it('gives the focus back to the type field of the properties after a choice, and Tab goes on to the email', async () => {
    const user = userEvent.setup();
    renderAt('/master-data/contacts/c-1/overview');
    const type = await screen.findByRole('combobox', { name: 'contacts.fields.contactType' });
    type.focus();
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'contacts.roles.support' }));
    await waitFor(() => expect(lastPatch()).toEqual([
      '/contacts/c-1',
      { email: 'alex@example.com', supplier_id: 's-1', supplier_role: 'support' },
    ]));
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('combobox', { name: 'contacts.fields.contactType' })));
    await user.tab();
    expect(document.activeElement).toBe(screen.getByLabelText('contacts.fields.email'));
  });

  it('flags a supplier stored without a type', async () => {
    stored = { ...CONTACT, supplier_role: null };
    renderAt('/master-data/contacts/c-1/overview');
    expect(await screen.findByText('contacts.metadata.typeMissing')).toBeInTheDocument();
    expect(screen.getByText('contacts.messages.typeRequired')).toBeInTheDocument();
  });

  it('shows the page read-only without manager access', async () => {
    auth.canEdit = false;
    renderAt('/master-data/contacts/c-1/overview');
    fireEvent.click(await screen.findByText('Alex Martin'));
    expect(screen.queryByLabelText('contacts.fields.firstName')).toBeNull();
    expect(screen.getByLabelText('contacts.fields.email')).toBeDisabled();
  });

  it('opens from the addresses other pages link to', async () => {
    renderAt('/master-data/contacts/c-1');
    expect(await screen.findByText('Alex Martin')).toBeInTheDocument();
  });

  it('sends a former tab address to the contact page', async () => {
    renderAt('/master-data/contacts/c-1/details?sort=last_name%3AASC');
    expect(await screen.findByText('Alex Martin')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/master-data/contacts/c-1/overview');
  });

  it('closes to the list with its sort and filters', async () => {
    renderAt('/master-data/contacts/c-1/overview?sort=last_name%3AASC&q=alex');
    await screen.findByText('Alex Martin');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/contacts?sort=last_name%3AASC&q=alex'));
  });
});

describe('ContactWorkspacePage create', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.canEdit = true;
    mocked.get.mockResolvedValue({ data: { items: [] } });
    mocked.post.mockResolvedValue({ data: { id: 'c-9' } });
  });

  it('creates a contact from a supplier with its type, then goes back to the supplier', async () => {
    renderAt('/master-data/contacts/new/overview?supplier_id=s-1&supplier_role=technical&returnTo=/master-data/suppliers/s-1/contacts');
    expect(screen.getByTestId('supplier-select')).toHaveAttribute('data-value', 's-1');
    expect(screen.getByTestId('supplier-select')).toHaveAttribute('data-disabled', 'true');
    fireEvent.change(screen.getByLabelText('contacts.fields.email'), { target: { value: 'sam@example.com' } });
    fireEvent.change(screen.getByLabelText('contacts.fields.firstName'), { target: { value: 'Sam' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][1]).toMatchObject({
      email: 'sam@example.com',
      first_name: 'Sam',
      supplier_id: 's-1',
      supplier_role: 'technical',
      active: true,
    });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/suppliers/s-1/contacts'));
  });

  it('gives a supplier chosen on the form the default type', async () => {
    renderAt('/master-data/contacts/new/overview?sort=last_name%3AASC');
    fireEvent.change(screen.getByLabelText('contacts.fields.email'), { target: { value: 'sam@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'pick supplier' }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][1]).toMatchObject({ supplier_id: 's-2', supplier_role: 'commercial' });
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/contacts?sort=last_name%3AASC'));
  });

  it('shows the errors on their fields and creates nothing', async () => {
    renderAt('/master-data/contacts/new/overview');
    fireEvent.change(screen.getByLabelText('contacts.fields.email'), { target: { value: 'sam' } });
    fireEvent.change(screen.getByLabelText('contacts.fields.mobile'), { target: { value: '12' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('master-data:contacts.messages.emailInvalid')).toBeInTheDocument();
    expect(screen.getByText('master-data:contacts.messages.phoneInvalid')).toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();
    // A corrected field loses its error at once.
    fireEvent.change(screen.getByLabelText('contacts.fields.email'), { target: { value: 'sam@example.com' } });
    expect(screen.queryByText('master-data:contacts.messages.emailInvalid')).toBeNull();
  });

  it('moves through the fields with Tab, a type chosen from its menu included, up to Create', async () => {
    const user = userEvent.setup();
    renderAt('/master-data/contacts/new/overview');
    fireEvent.click(screen.getByRole('button', { name: 'pick supplier' }));
    const firstName = screen.getByLabelText('contacts.fields.firstName');
    firstName.focus();
    const expectNext = async (element: HTMLElement) => {
      await user.tab();
      expect(document.activeElement).toBe(element);
    };
    await expectNext(screen.getByLabelText('contacts.fields.lastName'));
    await expectNext(screen.getByLabelText('contacts.fields.email'));
    await expectNext(screen.getByLabelText('contacts.fields.jobTitle'));
    await expectNext(screen.getByLabelText('contacts.fields.supplier'));
    const type = screen.getByRole('combobox', { name: 'contacts.fields.contactType' });
    await expectNext(type);
    // A choice made in the menu gives the focus back to the field, so Tab goes on from there.
    await user.keyboard('{Enter}');
    await user.click(await screen.findByRole('option', { name: 'contacts.roles.technical' }));
    await waitFor(() => expect(document.activeElement).toBe(type));
    await expectNext(screen.getByLabelText('contacts.fields.dialCodeOf:contacts.fields.phone'));
    await expectNext(screen.getByLabelText('contacts.fields.phone'));
    await expectNext(screen.getByLabelText('contacts.fields.dialCodeOf:contacts.fields.mobile'));
    await expectNext(screen.getByLabelText('contacts.fields.mobile'));
    await expectNext(screen.getByLabelText('companies.fields.country'));
    await expectNext(screen.getByLabelText('contacts.fields.notes'));
    // Create sits in the title row, above the fields, as on every create page of the shell: after
    // the last field the focus leaves the page (the browser's own controls), then starts again at
    // the top of the page: back link, Create.
    await expectNext(document.body);
    await expectNext(within(screen.getByRole('banner')).getByRole('button', { name: 'contacts.title' }));
    await expectNext(screen.getByRole('button', { name: 'common:buttons.create' }));
    await expectNext(screen.getByRole('button', { name: 'common:buttons.close' }));
    await expectNext(firstName);
  });

  it('ignores a return address outside the app', async () => {
    renderAt('/master-data/contacts/new/overview?returnTo=//example.com');
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'contacts.title' }));
    expect(navigateMock).toHaveBeenCalledWith('/master-data/contacts');
  });
});
