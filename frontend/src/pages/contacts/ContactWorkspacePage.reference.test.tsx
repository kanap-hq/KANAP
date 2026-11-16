import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

// The contact page opens by its reference (`CTCT-4`, lot R3 of 26.11.9): a legacy address moves to
// it without a second read and without mounting the page again, its way back to a supplier kept;
// the header shows and copies the reference; a save shows at that address.

const stableT = vi.hoisted(() => (key: string) => key);
const addToRecent = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' }, dataAccess: null }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({
  useRecentlyViewed: () => ({ items: [], addToRecent, clearRecent: vi.fn() }),
}));
vi.mock('../../components/fields/SupplierSelect', () => ({ default: () => <div /> }));

import api from '../../api';
import ContactWorkspacePage from './ContactWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

const CONTACT = {
  id: 'c-4', item_number: 4, first_name: 'Jean', last_name: 'Dupont', job_title: null, email: 'jean@acme.test', phone: null,
  mobile: null, country: null, notes: null, active: true, supplier_id: 's-12', supplier_role: 'commercial', supplier_name: 'Acme',
};

/** The server reads the contact by its uuid or its reference, in any case; anything else is a 404. */
let server: typeof CONTACT;
const reads = (path: string) => mocked.get.mock.calls.filter(([url]) => url === path);
const contactReads = () => mocked.get.mock.calls.filter(([url]) => /^\/contacts\/[^/]+$/.test(String(url)));

function Where() {
  const location = useLocation();
  return <div data-testid="where">{`${location.pathname}${location.search}`}</div>;
}

function renderAt(path: string) {
  // As the app's client: a read stays fresh for 30 seconds.
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <Where />
            <Routes>
              <Route path="/master-data/contacts" element={<div>list</div>} />
              <Route path="/master-data/contacts/:id" element={<ContactWorkspacePage />} />
              <Route path="/master-data/contacts/:id/:tab" element={<ContactWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByTestId('where').textContent;

describe('ContactWorkspacePage by reference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    server = { ...CONTACT };
    mocked.get.mockImplementation(async (url: string) => {
      if (['/contacts/c-4', '/contacts/CTCT-4', '/contacts/ctct-4'].includes(url)) return { data: server };
      if (url === '/contacts/c-4/usages') return { data: { total: 0, groups: [] } };
      if (/^\/contacts\/[^/]+$/.test(url)) throw Object.assign(new Error('Not found'), { response: { status: 404 } });
      if (url.startsWith('/contacts/')) throw new Error(`unexpected ${url}`);
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (_url: string, body: object) => {
      server = { ...server, ...body };
      return { data: server };
    });
  });

  it('moves a uuid address to the reference, its way back kept, with one read and one mount', async () => {
    const back = encodeURIComponent('/master-data/suppliers/SUP-12/contacts');
    renderAt(`/master-data/contacts/c-4/overview?returnTo=${back}`);
    await waitFor(() => expect(where()).toBe(`/master-data/contacts/CTCT-4/overview?returnTo=${back}`));
    await waitFor(() => expect(reads('/contacts/c-4/usages')).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(contactReads().map(([url]) => url)).toEqual(['/contacts/c-4']);
    // The usages read by the uuid; a page mounted again would read them again.
    expect(reads('/contacts/c-4/usages')).toHaveLength(1);
    await waitFor(() => expect(addToRecent).toHaveBeenCalledWith('contact', 'c-4', 'Jean Dupont', 'CTCT-4'));
  });

  it('writes a lower-case reference as the contact has it, from an address without a tab', async () => {
    renderAt('/master-data/contacts/ctct-4');
    await waitFor(() => expect(where()).toBe('/master-data/contacts/CTCT-4/overview'));
    expect(contactReads().map(([url]) => url)).toEqual(['/contacts/ctct-4']);
  });

  it('shows and copies the reference in the header', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAt('/master-data/contacts/CTCT-4/overview');
    fireEvent.click(await screen.findByText('CTCT-4'));
    expect(writeText).toHaveBeenCalledWith('CTCT-4');
  });

  it('shows a save on the page at the reference address, without reading the contact again', async () => {
    renderAt('/master-data/contacts/c-4/overview');
    await waitFor(() => expect(where()).toBe('/master-data/contacts/CTCT-4/overview'));
    const job = await screen.findByLabelText('contacts.fields.jobTitle');
    fireEvent.change(job, { target: { value: 'Buyer' } });
    fireEvent.blur(job);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contacts/c-4', { email: 'jean@acme.test', job_title: 'Buyer' }));
    fireEvent.click(await screen.findByRole('button', { name: 'contacts.status.active' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'contacts.status.inactive' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contacts/c-4', { email: 'jean@acme.test', active: false }));
    expect(await screen.findByRole('button', { name: 'contacts.status.inactive' })).toBeInTheDocument();
    expect(screen.getByLabelText('contacts.fields.jobTitle')).toHaveValue('Buyer');
  });

  it('shows an unknown reference as an unknown uuid', async () => {
    renderAt('/master-data/contacts/CTCT-999/overview');
    expect(await screen.findByText('contacts.messages.loadFailed')).toBeInTheDocument();
    expect(where()).toBe('/master-data/contacts/CTCT-999/overview');
  });

  it('does not read the contact again once deleted from its reference address', async () => {
    mocked.delete.mockResolvedValue({ data: {} });
    renderAt('/master-data/contacts/CTCT-4/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    const dialog = await screen.findByRole('dialog');
    const readsBefore = contactReads().length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/contacts/c-4'));
    await waitFor(() => expect(where()).toBe('/master-data/contacts'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(contactReads()).toHaveLength(readsBefore);
  });
});
