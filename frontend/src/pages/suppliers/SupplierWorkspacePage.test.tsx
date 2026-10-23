import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

const navigateMock = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ canEdit: true, canAdmin: true }));
// A stable `t`: a new one on each render would loop the effects.
const t = vi.hoisted(() => (key: string, options?: Record<string, unknown>) => (
  options?.role ? `${key}:${String(options.role)}` : key
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
  useAuth: () => ({
    hasLevel: (_resource: string, level: string) => (level === 'admin' ? auth.canAdmin : auth.canEdit),
    profile: { id: 'user-1' },
  }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../hooks/useSupplierNav', () => ({
  useSupplierNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
// The contact picker searches the API: a stub picks a contact.
vi.mock('../../components/fields/ContactSelect', () => ({
  default: React.forwardRef<HTMLInputElement, { label?: string; onChange: (v: string | null) => void }>(
    function ContactSelectStub(props, ref) {
      return (
        <div>
          <input ref={ref} aria-label={props.label} readOnly />
          <button type="button" onClick={() => props.onChange('c-9')}>pick contact</button>
        </div>
      );
    },
  ),
}));

import api from '../../api';
import SupplierWorkspacePage from './SupplierWorkspacePage';

const mocked = api as unknown as {
  get: ReturnType<typeof vi.fn>;
  post: ReturnType<typeof vi.fn>;
  patch: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const SUPPLIER = {
  id: 's-1',
  name: 'Acme Software',
  erp_supplier_id: 'SUP-001',
  notes: 'Net 30',
  status: 'enabled',
  disabled_at: null,
};

const LINKS = [
  {
    id: 'l-1',
    supplier_id: 's-1',
    contact_id: 'c-1',
    role: 'commercial',
    is_primary: true,
    contact: { id: 'c-1', first_name: 'Alex', last_name: 'Martin', email: 'alex@example.com' },
  },
  {
    id: 'l-2',
    supplier_id: 's-1',
    contact_id: 'c-2',
    role: 'support',
    is_primary: false,
    contact: { id: 'c-2', first_name: null, last_name: null, email: 'help@example.com' },
  },
];

let stored: Record<string, unknown>;

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <LocationProbe />
            <Routes>
              <Route path="/master-data/suppliers/:id" element={<SupplierWorkspacePage />} />
              <Route path="/master-data/suppliers/:id/:tab" element={<SupplierWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const lastPatch = () => mocked.patch.mock.calls[mocked.patch.mock.calls.length - 1];
const duplicate = { response: { status: 409, data: { code: 'duplicate', message: 'duplicate key' } } };

describe('SupplierWorkspacePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    auth.canEdit = true;
    auth.canAdmin = true;
    stored = { ...SUPPLIER };
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/suppliers/s-1') return { data: stored };
      if (url === '/suppliers/s-1/contacts') return { data: LINKS };
      if (url.endsWith('/usages')) return { data: { total: 0, groups: [] } };
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (_url: string, body: Record<string, unknown>) => {
      stored = { ...stored, ...body };
      return { data: stored };
    });
    mocked.post.mockResolvedValue({ data: {} });
    mocked.delete.mockResolvedValue({ data: {} });
  });

  it('shows the name as title, the ERP ID as reference, the status and no save button', async () => {
    renderAt('/master-data/suppliers/s-1/overview');
    expect(await screen.findByText('Acme Software')).toBeInTheDocument();
    expect(screen.getByText('SUP-001')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'suppliers.status.enabled' })).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /2/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /save/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /reset/i })).toBeNull();
  });

  it('shows no reference for a supplier without an ERP ID', async () => {
    stored = { ...SUPPLIER, erp_supplier_id: null };
    renderAt('/master-data/suppliers/s-1/overview');
    await screen.findByText('Acme Software');
    expect(screen.queryByText('SUP-001')).toBeNull();
    expect(screen.queryByText('s-1')).toBeNull();
  });

  it('saves the name edited in the title when focus leaves it', async () => {
    renderAt('/master-data/suppliers/s-1/overview');
    fireEvent.click(await screen.findByText('Acme Software'));
    const input = screen.getByLabelText('suppliers.fields.name');
    fireEvent.change(input, { target: { value: 'Acme Software Ltd' } });
    fireEvent.blur(input);
    await waitFor(() => expect(lastPatch()).toEqual(['/suppliers/s-1', { name: 'Acme Software Ltd' }]));
    expect(await screen.findByText('Acme Software Ltd')).toBeInTheDocument();
  });

  it('keeps an empty name in the title with its error and saves nothing', async () => {
    renderAt('/master-data/suppliers/s-1/overview');
    fireEvent.click(await screen.findByText('Acme Software'));
    const input = screen.getByLabelText('suppliers.fields.name');
    fireEvent.change(input, { target: { value: '  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('suppliers.messages.nameRequired')).toBeInTheDocument();
    expect(screen.getByLabelText('suppliers.fields.name')).toHaveAttribute('aria-invalid', 'true');
    fireEvent.blur(input);
    expect(mocked.patch).not.toHaveBeenCalled();
    // Escape gives the stored name back.
    fireEvent.keyDown(screen.getByLabelText('suppliers.fields.name'), { key: 'Escape' });
    expect(screen.getByText('Acme Software')).toBeInTheDocument();
    expect(screen.queryByText('suppliers.messages.nameRequired')).toBeNull();
  });

  it('shows a name another supplier has under the title', async () => {
    mocked.patch.mockRejectedValueOnce(duplicate);
    renderAt('/master-data/suppliers/s-1/overview');
    fireEvent.click(await screen.findByText('Acme Software'));
    const input = screen.getByLabelText('suppliers.fields.name');
    fireEvent.change(input, { target: { value: 'Globex' } });
    fireEvent.blur(input);
    expect(await screen.findByText('suppliers.messages.nameTaken')).toBeInTheDocument();
    // The stored name comes back.
    expect(await screen.findByText('Acme Software')).toBeInTheDocument();
  });

  it('saves the ERP ID on blur, and sends nothing when it is unchanged', async () => {
    renderAt('/master-data/suppliers/s-1/overview');
    const erp = await screen.findByLabelText('suppliers.fields.erpSupplierId');
    await waitFor(() => expect(erp).toHaveValue('SUP-001'));
    fireEvent.focus(erp);
    fireEvent.blur(erp);
    expect(mocked.patch).not.toHaveBeenCalled();
    fireEvent.focus(erp);
    fireEvent.change(erp, { target: { value: ' SUP-100 ' } });
    fireEvent.blur(erp);
    await waitFor(() => expect(lastPatch()).toEqual(['/suppliers/s-1', { erp_supplier_id: 'SUP-100' }]));
    fireEvent.focus(erp);
    fireEvent.change(erp, { target: { value: '' } });
    fireEvent.blur(erp);
    await waitFor(() => expect(lastPatch()).toEqual(['/suppliers/s-1', { erp_supplier_id: null }]));
  });

  it('shows a refused save under its field', async () => {
    mocked.patch.mockRejectedValueOnce({ response: { status: 400, data: { message: 'erp_supplier_id must be a string' } } });
    renderAt('/master-data/suppliers/s-1/overview');
    const erp = await screen.findByLabelText('suppliers.fields.erpSupplierId');
    await waitFor(() => expect(erp).toHaveValue('SUP-001'));
    fireEvent.focus(erp);
    fireEvent.change(erp, { target: { value: 'SUP-2' } });
    fireEvent.blur(erp);
    expect(await screen.findByText('erp_supplier_id must be a string')).toBeInTheDocument();
    expect(screen.queryByText('common:status.saved')).toBeNull();
  });

  it('saves the notes after a pause in typing, and at once when focus leaves them', async () => {
    renderAt('/master-data/suppliers/s-1/overview');
    const notes = await screen.findByLabelText('suppliers.fields.notes');
    await waitFor(() => expect(notes).toHaveValue('Net 30'));
    fireEvent.focus(notes);
    fireEvent.change(notes, { target: { value: 'Net 45' } });
    expect(mocked.patch).not.toHaveBeenCalled();
    await waitFor(() => expect(lastPatch()).toEqual(['/suppliers/s-1', { notes: 'Net 45' }]), { timeout: 2000 });
    fireEvent.change(notes, { target: { value: 'Net 60' } });
    fireEvent.blur(notes);
    await waitFor(() => expect(lastPatch()).toEqual(['/suppliers/s-1', { notes: 'Net 60' }]));
  });

  it('confirms a saved note with Saved', async () => {
    renderAt('/master-data/suppliers/s-1/overview');
    const notes = await screen.findByLabelText('suppliers.fields.notes');
    await waitFor(() => expect(notes).toHaveValue('Net 30'));
    fireEvent.focus(notes);
    fireEvent.change(notes, { target: { value: 'Net 45' } });
    expect(await screen.findByText('common:status.saving')).toBeInTheDocument();
    fireEvent.blur(notes);
    await waitFor(() => expect(lastPatch()).toEqual(['/suppliers/s-1', { notes: 'Net 45' }]));
    expect(await screen.findByText('common:status.saved')).toBeInTheDocument();
  });

  it('confirms a field saved at once with Saved', async () => {
    renderAt('/master-data/suppliers/s-1/overview');
    const erp = await screen.findByLabelText('suppliers.fields.erpSupplierId');
    await waitFor(() => expect(erp).toHaveValue('SUP-001'));
    fireEvent.focus(erp);
    fireEvent.change(erp, { target: { value: 'SUP-100' } });
    fireEvent.blur(erp);
    await waitFor(() => expect(lastPatch()).toEqual(['/suppliers/s-1', { erp_supplier_id: 'SUP-100' }]));
    expect(await screen.findByText('common:status.saved')).toBeInTheDocument();
  });

  it('saves the status from the metadata menu', async () => {
    renderAt('/master-data/suppliers/s-1/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'suppliers.status.enabled' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'suppliers.status.disabled' }));
    await waitFor(() => expect(lastPatch()).toEqual(['/suppliers/s-1', { status: 'disabled' }]));
    fireEvent.click(await screen.findByRole('button', { name: 'suppliers.status.disabled' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'suppliers.status.enabled' }));
    await waitFor(() => expect(lastPatch()).toEqual(['/suppliers/s-1', { status: 'enabled', disabled_at: null }]));
  });

  it('disables now from the properties switch with the status alone', async () => {
    renderAt('/master-data/suppliers/s-1/overview');
    await screen.findByText('Acme Software');
    fireEvent.click(screen.getByRole('checkbox', { name: 'statuses.enabled' }));
    // The server sets the end of validity from its own clock.
    await waitFor(() => expect(lastPatch()).toEqual(['/suppliers/s-1', { status: 'disabled' }]));
  });

  it('saves an end of validity typed in the properties', async () => {
    renderAt('/master-data/suppliers/s-1/overview');
    await screen.findByText('Acme Software');
    const date = screen.getByPlaceholderText('labels.datePlaceholder');
    fireEvent.focus(date);
    fireEvent.change(date, { target: { value: '31/12/2099' } });
    await waitFor(() => expect(mocked.patch).toHaveBeenCalled());
    const [url, body] = lastPatch();
    expect(url).toBe('/suppliers/s-1');
    expect(body.status).toBe('enabled');
    expect(String(body.disabled_at)).toMatch(/^2099-12-31T|^2100-01-01T/);
  });

  it('shows the page read-only without manager access', async () => {
    auth.canEdit = false;
    renderAt('/master-data/suppliers/s-1/overview');
    const erp = await screen.findByLabelText('suppliers.fields.erpSupplierId');
    expect(erp).toBeDisabled();
    expect(screen.getByLabelText('suppliers.fields.notes')).toBeDisabled();
    fireEvent.click(screen.getByText('Acme Software'));
    expect(screen.queryByLabelText('suppliers.fields.name')).toBeNull();
  });

  it('lists the contacts by type with names only, each opening its contact', async () => {
    renderAt('/master-data/suppliers/s-1/contacts');
    const commercial = await screen.findByRole('region', { name: 'contacts.roles.commercial' });
    const alex = await within(commercial).findByRole('link', { name: 'Alex Martin' });
    expect(alex).toHaveAttribute('href', '/master-data/contacts/c-1/overview');
    expect(screen.queryByText('alex@example.com')).toBeNull();
    // A contact with no name shows its email in place of a name.
    const support = screen.getByRole('region', { name: 'contacts.roles.support' });
    expect(within(support).getByRole('link', { name: 'help@example.com' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'contacts.roles.technical' })).getByText('suppliers.contacts.noContacts')).toBeInTheDocument();
  });

  it('opens the contact create form with the supplier, the type and the way back', async () => {
    renderAt('/master-data/suppliers/s-1/contacts');
    const technical = await screen.findByRole('region', { name: 'contacts.roles.technical' });
    const create = within(technical).getByRole('link', { name: 'suppliers.contacts.create' });
    const href = new URL(create.getAttribute('href') as string, 'http://localhost');
    expect(href.pathname).toBe('/master-data/contacts/new');
    expect(href.searchParams.get('supplier_id')).toBe('s-1');
    expect(href.searchParams.get('supplier_role')).toBe('technical');
    expect(href.searchParams.get('returnTo')).toBe('/master-data/suppliers/s-1/contacts');
  });

  it('adds an existing contact under a type and removes a link', async () => {
    renderAt('/master-data/suppliers/s-1/contacts');
    const technical = await screen.findByRole('region', { name: 'contacts.roles.technical' });
    fireEvent.click(within(technical).getByRole('button', { name: 'suppliers.contacts.addExisting' }));
    expect(within(technical).getByLabelText('suppliers.contacts.selectContact:contacts.roles.technical')).toHaveFocus();
    fireEvent.click(within(technical).getByRole('button', { name: 'pick contact' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/suppliers/s-1/contacts', { contactId: 'c-9', role: 'technical' }));

    const commercial = screen.getByRole('region', { name: 'contacts.roles.commercial' });
    fireEvent.click(within(commercial).getByRole('button', { name: 'suppliers.contacts.removeLink' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/suppliers/s-1/contacts/l-1'));
  });

  it('opens from the addresses other pages link to', async () => {
    renderAt('/master-data/suppliers/s-1?sort=name%3AASC');
    expect(await screen.findByText('Acme Software')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/master-data/suppliers/s-1/overview?sort=name%3AASC');
  });

  it('sends an unknown tab to the overview', async () => {
    renderAt('/master-data/suppliers/s-1/details');
    expect(await screen.findByText('Acme Software')).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveTextContent('/master-data/suppliers/s-1/overview');
  });

  it('closes to the list with its sort, filters and scope', async () => {
    renderAt('/master-data/suppliers/s-1/overview?sort=name%3ADESC&q=ac&scope=all&other=x');
    await screen.findByText('Acme Software');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/suppliers?sort=name%3ADESC&q=ac&scope=all'));
  });

  it('hides delete from someone who is not a suppliers admin', async () => {
    auth.canAdmin = false;
    renderAt('/master-data/suppliers/s-1/overview');
    await screen.findByText('Acme Software');
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
  });

  it('refuses to delete a supplier that is in use, and offers no confirmation', async () => {
    mocked.post.mockResolvedValue({
      data: { refused: [{ id: 's-1', name: 'Acme Software', code: 'SUPPLIER_IN_USE', usages: [{ type: 'contracts', total: 2 }] }] },
    });
    renderAt('/master-data/suppliers/s-1/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(mocked.post).toHaveBeenCalledWith('/suppliers/delete-check', { ids: ['s-1'] });
    expect(within(dialog).getByText('errors:SUPPLIER_IN_USE')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('button').map((button) => button.textContent).filter(Boolean)).toEqual(['buttons.close']);
    fireEvent.click(within(dialog).getByRole('button', { name: 'buttons.close' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it('deletes a supplier nothing uses, then returns to the list', async () => {
    mocked.post.mockResolvedValue({ data: { refused: [] } });
    renderAt('/master-data/suppliers/s-1/overview?sort=name%3ADESC');
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('common:delete.cannotUndo')).toBeInTheDocument();
    const loadsBefore = mocked.get.mock.calls.filter(([url]) => url === '/suppliers/s-1').length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/suppliers/s-1'));
    expect(navigateMock).toHaveBeenCalledWith('/master-data/suppliers?sort=name%3ADESC');
    expect(mocked.get.mock.calls.filter(([url]) => url === '/suppliers/s-1')).toHaveLength(loadsBefore);
  });

  it('creates a supplier and opens it with the list parameters', async () => {
    mocked.post.mockResolvedValueOnce({ data: { ...SUPPLIER, id: 's-new' } });
    renderAt('/master-data/suppliers/new/overview?sort=name%3AASC');
    fireEvent.change(screen.getByLabelText('suppliers.fields.name'), { target: { value: ' Initech ' } });
    fireEvent.change(screen.getByLabelText('suppliers.fields.erpSupplierId'), { target: { value: 'SUP-077' } });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/suppliers', {
      name: 'Initech',
      erp_supplier_id: 'SUP-077',
      notes: null,
      status: 'enabled',
      disabled_at: null,
    }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/suppliers/s-new/overview?sort=name%3AASC'));
  });

  it('shows the errors of the create form on the name field', async () => {
    renderAt('/master-data/suppliers/new/overview');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('suppliers.messages.nameRequired')).toBeInTheDocument();
    expect(screen.getByLabelText('suppliers.fields.name')).toHaveFocus();
    expect(mocked.post).not.toHaveBeenCalled();

    mocked.post.mockRejectedValueOnce(duplicate);
    fireEvent.change(screen.getByLabelText('suppliers.fields.name'), { target: { value: 'Acme Software' } });
    expect(screen.queryByText('suppliers.messages.nameRequired')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('suppliers.messages.nameTaken')).toBeInTheDocument();
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('moves through the create form with Tab up to Create', async () => {
    const user = userEvent.setup();
    renderAt('/master-data/suppliers/new/overview');
    const name = screen.getByLabelText('suppliers.fields.name');
    name.focus();
    const expectNext = async (element: HTMLElement) => {
      await user.tab();
      expect(document.activeElement).toBe(element);
    };
    await expectNext(screen.getByLabelText('suppliers.fields.erpSupplierId'));
    await expectNext(screen.getByLabelText('suppliers.fields.notes'));
    // Create sits in the title row, above the fields, as on every create page of the shell.
    await expectNext(document.body);
    await expectNext(within(screen.getByRole('banner')).getByRole('button', { name: 'suppliers.title' }));
    await expectNext(screen.getByRole('button', { name: 'common:buttons.create' }));
    await expectNext(screen.getByRole('button', { name: 'common:buttons.close' }));
    // The tab bar (the contacts tab waits for the supplier), then the first field again.
    await expectNext(screen.getByRole('tab', { name: 'shared.labels.overview' }));
    await expectNext(name);
  });
});

describe('SupplierWorkspacePage: used by', () => {
  const USAGES = {
    total: 3,
    groups: [
      {
        type: 'budget_lines',
        total: 2,
        items: [
          { id: 'b-1', reference: 'BL-12', name: 'Office 365', nature: 'opex', status: 'enabled', active: true },
          { id: 'b-2', reference: 'BL-40', name: 'Servers', nature: 'capex', status: 'enabled', active: true },
        ],
      },
      { type: 'contracts', total: 1, items: [{ id: 'k-1', reference: null, name: 'Enterprise agreement', status: 'enabled', active: true }] },
    ],
  };

  beforeEach(() => {
    vi.clearAllMocks();
    auth.canEdit = true;
    auth.canAdmin = true;
    stored = { ...SUPPLIER };
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/suppliers/s-1') return { data: stored };
      if (url === '/suppliers/s-1/contacts') return { data: LINKS };
      if (url === '/suppliers/s-1/usages') return { data: USAGES };
      return { data: { items: [] } };
    });
  });

  it('shows the uses under the notes of the overview, each opening its page', async () => {
    renderAt('/master-data/suppliers/s-1/overview');
    const section = await screen.findByRole('region', { name: 'shared.usages.title' });
    expect(await within(section).findByRole('link', { name: /Office 365/ })).toHaveAttribute('href', '/ops/budget/BL-12');
    expect(within(section).getByRole('link', { name: /Servers/ })).toHaveAttribute('href', '/ops/budget/BL-40');
    expect(within(section).getByRole('link', { name: /Enterprise agreement/ })).toHaveAttribute('href', '/ops/contracts/k-1');
    // Under the notes, and no tab of its own.
    const notes = screen.getByText('suppliers.fields.notes');
    expect(notes.compareDocumentPosition(section) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.queryByRole('tab', { name: 'shared.usages.title' })).toBeNull();
  });

  it('scrolls to the section from the header count', async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    renderAt('/master-data/suppliers/s-1/overview');
    await screen.findByRole('region', { name: 'shared.usages.title' });
    fireEvent.click(await screen.findByRole('button', { name: /shared\.usages\.title.*3/ }));
    expect(scroll).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    expect(navigateMock).not.toHaveBeenCalled();
  });

  it('opens the overview from the Contacts tab, then scrolls to the section', async () => {
    renderAt('/master-data/suppliers/s-1/contacts');
    fireEvent.click(await screen.findByRole('button', { name: /shared\.usages\.title.*3/ }));
    await waitFor(() => expect(navigateMock).toHaveBeenCalledWith('/master-data/suppliers/s-1/overview'));
  });

  it('sends the former Used by tab address to the overview', async () => {
    renderAt('/master-data/suppliers/s-1/usages');
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/master-data/suppliers/s-1/overview'));
  });
});
