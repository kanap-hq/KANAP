import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

// The supplier page opens by its reference (`SUP-12`, lot R3 of 26.11.9): a legacy address moves to
// it without a second read and without mounting the page again; the header shows and copies the
// reference (the ERP ID stays a property); a save shows at that address; the neighbours open by theirs.

const stableT = vi.hoisted(() => (key: string) => key);
const navArgs = vi.hoisted(() => ({ ids: [] as Array<string | undefined> }));
const addToRecent = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' }, dataAccess: null }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../hooks/useSupplierNav', () => ({
  useSupplierNav: ({ id }: { id?: string }) => {
    navArgs.ids.push(id);
    return { ids: ['s-11', 's-12', 's-13'], index: 1, total: 3, hasPrev: true, hasNext: true, prevId: 'SUP-11', nextId: 'SUP-13' };
  },
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({
  useRecentlyViewed: () => ({ items: [], addToRecent, clearRecent: vi.fn() }),
}));

import api from '../../api';
import SupplierWorkspacePage from './SupplierWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

const SUPPLIER = { id: 's-12', item_number: 12, name: 'Acme', erp_supplier_id: 'F10001', notes: null, status: 'enabled', disabled_at: null };

/** The server reads the supplier by its uuid or its reference, in any case; anything else is a 404. */
let server: typeof SUPPLIER;
const reads = (path: string) => mocked.get.mock.calls.filter(([url]) => url === path);
const supplierReads = () => mocked.get.mock.calls.filter(([url]) => /^\/suppliers\/[^/]+$/.test(String(url)));

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
              <Route path="/master-data/suppliers" element={<div>list</div>} />
              <Route path="/master-data/suppliers/:id/:tab" element={<SupplierWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByTestId('where').textContent;

describe('SupplierWorkspacePage by reference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navArgs.ids = [];
    server = { ...SUPPLIER };
    mocked.get.mockImplementation(async (url: string) => {
      if (['/suppliers/s-12', '/suppliers/SUP-12', '/suppliers/sup-12'].includes(url)) return { data: server };
      if (url === '/suppliers/s-12/contacts') return { data: [] };
      if (url === '/suppliers/s-12/usages') return { data: { total: 0, groups: [] } };
      if (/^\/suppliers\/[^/]+$/.test(url)) throw Object.assign(new Error('Not found'), { response: { status: 404 } });
      if (url.startsWith('/suppliers/')) throw new Error(`unexpected ${url}`);
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (_url: string, body: object) => {
      server = { ...server, ...body };
      return { data: server };
    });
  });

  it('moves a uuid address to the reference, tab and list context kept, with one read and one mount', async () => {
    renderAt('/master-data/suppliers/s-12/contacts?sort=name%3AASC&q=acme');
    await waitFor(() => expect(where()).toBe('/master-data/suppliers/SUP-12/contacts?sort=name%3AASC&q=acme'));
    await waitFor(() => expect(reads('/suppliers/s-12/usages')).toHaveLength(1));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(supplierReads().map(([url]) => url)).toEqual(['/suppliers/s-12']);
    // The child routes read by the uuid; a page mounted again would read them again.
    expect(reads('/suppliers/s-12/usages')).toHaveLength(1);
    expect(reads('/suppliers/s-12/contacts')).toHaveLength(1);
    await waitFor(() => expect(addToRecent).toHaveBeenCalledWith('supplier', 's-12', 'Acme', 'SUP-12'));
  });

  it('writes a lower-case reference as the supplier has it', async () => {
    renderAt('/master-data/suppliers/sup-12/overview');
    await waitFor(() => expect(where()).toBe('/master-data/suppliers/SUP-12/overview'));
    expect(supplierReads().map(([url]) => url)).toEqual(['/suppliers/sup-12']);
  });

  it('shows and copies the reference in the header, and the ERP ID only in the properties', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAt('/master-data/suppliers/SUP-12/overview');
    fireEvent.click(await screen.findByText('SUP-12'));
    expect(writeText).toHaveBeenCalledWith('SUP-12');
    expect(screen.queryByText('F10001')).toBeNull();
    expect(screen.getByLabelText('suppliers.fields.erpSupplierId')).toHaveValue('F10001');
  });

  it('shows a save on the page at the reference address, without reading the supplier again', async () => {
    renderAt('/master-data/suppliers/s-12/overview');
    await waitFor(() => expect(where()).toBe('/master-data/suppliers/SUP-12/overview'));
    const erp = await screen.findByLabelText('suppliers.fields.erpSupplierId');
    fireEvent.focus(erp);
    fireEvent.change(erp, { target: { value: 'F20002' } });
    fireEvent.blur(erp);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/suppliers/s-12', { erp_supplier_id: 'F20002' }));
    fireEvent.click(await screen.findByRole('button', { name: 'suppliers.status.enabled' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'suppliers.status.disabled' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/suppliers/s-12', { status: 'disabled' }));
    expect(await screen.findByRole('button', { name: 'suppliers.status.disabled' })).toBeInTheDocument();
    expect(screen.getByLabelText('suppliers.fields.erpSupplierId')).toHaveValue('F20002');
    expect(supplierReads()).toHaveLength(1);
  });

  it('finds its place in the list by its uuid and opens a neighbour by its reference', async () => {
    renderAt('/master-data/suppliers/SUP-12/overview?sort=name%3AASC');
    await screen.findByText('SUP-12');
    expect(navArgs.ids).toContain('s-12');
    expect(navArgs.ids).not.toContain('SUP-12');
    fireEvent.click(screen.getByRole('button', { name: 'suppliers.next' }));
    await waitFor(() => expect(where()).toBe('/master-data/suppliers/SUP-13/overview?sort=name%3AASC'));
  });

  it('shows an unknown reference as an unknown uuid', async () => {
    renderAt('/master-data/suppliers/SUP-999/overview');
    expect(await screen.findByText('suppliers.loadError')).toBeInTheDocument();
    expect(where()).toBe('/master-data/suppliers/SUP-999/overview');
  });

  it('does not read the supplier again once deleted from its reference address', async () => {
    mocked.post.mockResolvedValue({ data: { refused: [] } });
    mocked.delete.mockResolvedValue({ data: {} });
    renderAt('/master-data/suppliers/SUP-12/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    const dialog = await screen.findByRole('dialog');
    const readsBefore = supplierReads().length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/suppliers/s-12'));
    await waitFor(() => expect(where()).toBe('/master-data/suppliers'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(supplierReads()).toHaveLength(readsBefore);
  });
});
