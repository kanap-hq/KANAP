import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

// The company page opens by its reference (`COMP-5`, lot R2 of 26.11.9): a legacy address moves to
// it without a second read, a save shows on the page at that address, the neighbours open by theirs.

const stableT = vi.hoisted(() => (key: string) => key);
const navArgs = vi.hoisted(() => ({ ids: [] as Array<string | undefined> }));
const access = vi.hoisted(() => ({ admin: false }));
const addToRecent = vi.hoisted(() => vi.fn());

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' }, dataAccess: null }),
}));
vi.mock('../../auth/dataAccess', () => ({ useDataAccessAdmin: () => access.admin }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../hooks/useCompanyNav', () => ({
  useCompanyNav: ({ id }: { id?: string }) => {
    navArgs.ids.push(id);
    return { ids: ['co-4', 'co-5', 'co-6'], index: 1, total: 3, hasPrev: true, hasNext: true, prevId: 'COMP-4', nextId: 'COMP-6' };
  },
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({
  useRecentlyViewed: () => ({ items: [], addToRecent, clearRecent: vi.fn() }),
}));
vi.mock('./CompanyMetricsTab', () => ({ default: () => <div>metrics tab</div> }));
vi.mock('./CompanyAccessTab', () => ({ default: () => <div>access tab</div> }));

import api from '../../api';
import CompanyWorkspacePage from './CompanyWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

const COMPANY = {
  id: 'co-5', item_number: 5, name: 'Acme France', coa_id: null, country_iso: 'FR', base_currency: 'EUR', city: 'Paris',
  address1: null, address2: null, postal_code: null, state: null, reg_number: null, vat_number: null, notes: null,
  status: 'enabled', disabled_at: null,
};

/** The server reads the company by its uuid or its reference, in any case; anything else is a 404. */
let server: typeof COMPANY;
const companyReads = () => mocked.get.mock.calls.filter(([url]) => String(url).startsWith('/companies/'));

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
              <Route path="/master-data/companies" element={<div>list</div>} />
              <Route path="/master-data/companies/:id/:tab" element={<CompanyWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByTestId('where').textContent;

describe('CompanyWorkspacePage by reference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navArgs.ids = [];
    access.admin = false;
    server = { ...COMPANY };
    mocked.get.mockImplementation(async (url: string) => {
      if (['/companies/co-5', '/companies/COMP-5', '/companies/comp-5'].includes(url)) return { data: server };
      if (url.startsWith('/companies/')) throw Object.assign(new Error('Not found'), { response: { status: 404 } });
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (_url: string, body: object) => {
      server = { ...server, ...body };
      return { data: server };
    });
  });

  it('moves a uuid address to the reference, tab and list context kept, with one read', async () => {
    renderAt('/master-data/companies/co-5/details?sort=name%3AASC&q=acme');
    await waitFor(() => expect(where()).toBe('/master-data/companies/COMP-5/details?sort=name%3AASC&q=acme'));
    await screen.findByText('metrics tab');
    expect(companyReads().map(([url]) => url)).toEqual(['/companies/co-5']);
    expect(screen.getByText('COMP-5')).toBeInTheDocument();
    await waitFor(() => expect(addToRecent).toHaveBeenCalledWith('company', 'co-5', 'Acme France', 'COMP-5'));
  });

  it('writes a lower-case reference as the company has it', async () => {
    renderAt('/master-data/companies/comp-5/overview');
    await waitFor(() => expect(where()).toBe('/master-data/companies/COMP-5/overview'));
    expect(companyReads().map(([url]) => url)).toEqual(['/companies/comp-5']);
  });

  it('keeps the Access tab through the move', async () => {
    access.admin = true;
    renderAt('/master-data/companies/co-5/access');
    await waitFor(() => expect(where()).toBe('/master-data/companies/COMP-5/access'));
    expect(await screen.findByText('access tab')).toBeInTheDocument();
  });

  it('shows a save on the page at the reference address, without reading the company again', async () => {
    renderAt('/master-data/companies/co-5/overview');
    await waitFor(() => expect(where()).toBe('/master-data/companies/COMP-5/overview'));
    const city = await screen.findByLabelText('companies.fields.city');
    fireEvent.change(city, { target: { value: 'Lyon' } });
    fireEvent.blur(city);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/companies/co-5', { city: 'Lyon' }));
    // The answer lands under the page's own entry: the drawer's status follows a status change too.
    fireEvent.click(await screen.findByRole('button', { name: 'companies.status.enabled' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'companies.status.disabled' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/companies/co-5', { status: 'disabled' }));
    expect(await screen.findByRole('button', { name: 'companies.status.disabled' })).toBeInTheDocument();
    expect((screen.getByLabelText('companies.fields.city') as HTMLInputElement).value).toBe('Lyon');
    expect(companyReads()).toHaveLength(1);
  });

  it('finds its place in the list by its uuid and opens a neighbour by its reference', async () => {
    renderAt('/master-data/companies/COMP-5/overview?sort=name%3AASC');
    await screen.findByText('COMP-5');
    expect(navArgs.ids).toContain('co-5');
    expect(navArgs.ids).not.toContain('COMP-5');
    fireEvent.click(screen.getByRole('button', { name: 'companies.next' }));
    await waitFor(() => expect(where()).toBe('/master-data/companies/COMP-6/overview?sort=name%3AASC'));
  });

  it('shows an unknown reference, or an unknown uuid, as the not found page', async () => {
    for (const address of ['COMP-999', '00000000-0000-4000-8000-000000000999']) {
      const view = renderAt(`/master-data/companies/${address}/overview`);
      expect(await screen.findByText('companies.notFound')).toBeInTheDocument();
      expect(screen.queryByText('companies.loadError')).toBeNull();
      // No empty record frame: no tabs, no header actions; a way back to the list.
      expect(screen.queryByRole('tab', { name: 'shared.labels.overview' })).toBeNull();
      expect(screen.queryByRole('button', { name: 'common:buttons.close' })).toBeNull();
      expect(where()).toBe(`/master-data/companies/${address}/overview`);
      expect(screen.queryByText(address, { selector: ':not([data-testid="where"])' })).toBeNull();
      expect(mocked.get.mock.calls.filter(([url]) => /^\/companies\/[^/]+\/./.test(String(url)))).toEqual([]);
      fireEvent.click(screen.getByRole('link', { name: 'shared.backToList' }));
      await waitFor(() => expect(where()).toBe('/master-data/companies'));
      view.unmount();
    }
  });

  it('keeps the load message, in the record frame, for any other failure', async () => {
    const answer = mocked.get.getMockImplementation() as (url: string) => Promise<unknown>;
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/companies/COMP-7') throw Object.assign(new Error('Server error'), { response: { status: 500 } });
      return answer(url);
    });
    renderAt('/master-data/companies/COMP-7/overview');
    expect(await screen.findByText('companies.loadError')).toBeInTheDocument();
    expect(screen.queryByText('companies.notFound')).toBeNull();
    expect(screen.getByRole('tab', { name: 'shared.labels.overview' })).toBeInTheDocument();
  });

  it('does not read the company again once deleted from its reference address', async () => {
    mocked.post.mockResolvedValue({ data: { refused: [] } });
    mocked.delete.mockResolvedValue({ data: {} });
    renderAt('/master-data/companies/COMP-5/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    const dialog = await screen.findByRole('dialog');
    const readsBefore = companyReads().length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/companies/co-5'));
    await waitFor(() => expect(where()).toBe('/master-data/companies'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(companyReads()).toHaveLength(readsBefore);
  });

  it('copies the reference from the header', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAt('/master-data/companies/COMP-5/overview');
    fireEvent.click(await screen.findByText('COMP-5'));
    expect(writeText).toHaveBeenCalledWith('COMP-5');
  });
});
