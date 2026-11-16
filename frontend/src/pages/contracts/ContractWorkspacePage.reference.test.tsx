import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

// The contract page opens by its reference (`CTR-5`, lot R4 of 26.11.9): a legacy address moves to
// it without a second read, the tabs and the saves use the uuid, the neighbours open by theirs, and
// a contract the person may not read answers as one that does not exist.

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
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'fromage' }) }));
vi.mock('../../hooks/useContractNav', () => ({
  useContractNav: ({ id }: { id?: string }) => {
    navArgs.ids.push(id);
    return { ids: ['c-4', 'c-5', 'c-6'], index: 1, total: 3, hasPrev: true, hasNext: true, prevId: 'CTR-4', nextId: 'CTR-6' };
  },
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({
  useRecentlyViewed: () => ({ items: [], addToRecent, clearRecent: vi.fn() }),
}));
vi.mock('../../components/history/RecordHistoryTab', () => ({
  default: (props: { recordId: string }) => <div data-testid="record-history">{props.recordId}</div>,
}));
vi.mock('../../components/MarkdownEditor', () => ({
  default: ({ value }: { value: string }) => <textarea aria-label="markdown-editor" value={value} readOnly />,
}));

import api from '../../api';
import ContractWorkspacePage from './ContractWorkspacePage';

const mocked = api as unknown as Record<'get' | 'post' | 'patch' | 'delete', ReturnType<typeof vi.fn>>;

const CONTRACT = {
  id: 'c-5', item_number: 5, name: 'SAP Maintenance', status: 'enabled', disabled_at: null, company_id: 'co-1', supplier_id: 'sup-1',
  owner_user_id: null, start_date: '2026-01-01', duration_months: 12, auto_renewal: true, notice_period_months: 1,
  yearly_amount_at_signature: '1000.00', currency: 'EUR', billing_frequency: 'annual', notes: null,
  created_at: '2026-01-01T10:00:00.000Z', updated_at: '2026-01-01T10:00:00.000Z',
  supplier_name: 'SAP', company_name: 'Fromage & Co SA', owner_name: null,
};

/** The server reads the contract by its uuid or its reference, in any case; anything else is a 404. */
let server: typeof CONTRACT;
const contractReads = () => mocked.get.mock.calls.filter(([url]) => /^\/contracts\/[^/]+$/.test(String(url)));
const childReads = () => mocked.get.mock.calls.map(([url]) => String(url)).filter((url) => /^\/contracts\/[^/]+\/.+/.test(url));

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
              <Route path="/ops/contracts" element={<div>contracts list</div>} />
              <Route path="/ops/contracts/:id/:tab" element={<ContractWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const where = () => screen.getByTestId('where').textContent;

describe('ContractWorkspacePage by reference', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    navArgs.ids = [];
    server = { ...CONTRACT };
    mocked.get.mockImplementation(async (url: string) => {
      if (['/contracts/c-5', '/contracts/CTR-5', '/contracts/ctr-5'].includes(url)) return { data: server };
      if (url === '/contracts/c-5/relation-counts') return { data: { budget_lines: 0, relations: 0 } };
      if (/^\/contracts\/[^/]+$/.test(url)) throw Object.assign(new Error('Not found'), { response: { status: 404 } });
      if (url === '/currency/settings') return { data: { reportingCurrency: 'EUR', defaultSpendCurrency: 'EUR', defaultCapexCurrency: 'EUR', allowedCurrencies: ['EUR'] } };
      if (url.endsWith('/tasks')) return { data: [] };
      return { data: { items: [] } };
    });
    mocked.patch.mockImplementation(async (_url: string, body: object) => {
      server = { ...server, ...body };
      return { data: server };
    });
  });

  it('moves a uuid address to the reference, tab and list context kept, with one read', async () => {
    renderAt('/ops/contracts/c-5/history?sort=name%3AASC&q=sap');
    await waitFor(() => expect(where()).toBe('/ops/contracts/CTR-5/history?sort=name%3AASC&q=sap'));
    expect(await screen.findByTestId('record-history')).toHaveTextContent('c-5');
    expect(contractReads().map(([url]) => url)).toEqual(['/contracts/c-5']);
    expect(screen.getByText('CTR-5')).toBeInTheDocument();
    await waitFor(() => expect(addToRecent).toHaveBeenCalledWith('contract', 'c-5', 'SAP Maintenance', 'CTR-5'));
  });

  it('writes a lower-case reference as the contract has it', async () => {
    renderAt('/ops/contracts/ctr-5/overview');
    await waitFor(() => expect(where()).toBe('/ops/contracts/CTR-5/overview'));
    expect(contractReads().map(([url]) => url)).toEqual(['/contracts/ctr-5']);
  });

  it('reads the tabs by the uuid, never by the reference', async () => {
    renderAt('/ops/contracts/CTR-5/overview');
    await screen.findByText('CTR-5');
    await waitFor(() => expect(childReads()).toContain('/contracts/c-5/relation-counts'));
    expect(childReads().filter((url) => url.includes('CTR-5'))).toEqual([]);
  });

  it('saves on the uuid and shows the save at the reference address, without reading the contract again', async () => {
    renderAt('/ops/contracts/c-5/overview');
    await waitFor(() => expect(where()).toBe('/ops/contracts/CTR-5/overview'));
    fireEvent.click(await screen.findByRole('button', { name: 'opex.status.enabled' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'opex.status.disabled' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/contracts/c-5', { status: 'disabled' }));
    // The save refreshes the page's own entry, by the reference: one read more, at that address.
    await waitFor(() => expect(contractReads().map(([url]) => url)).toEqual(['/contracts/c-5', '/contracts/CTR-5']));
    expect(where()).toBe('/ops/contracts/CTR-5/overview');
  });

  it('finds its place in the list by its uuid and opens a neighbour by its reference', async () => {
    renderAt('/ops/contracts/CTR-5/overview?sort=name%3AASC');
    await screen.findByText('CTR-5');
    expect(navArgs.ids).toContain('c-5');
    expect(navArgs.ids).not.toContain('CTR-5');
    fireEvent.click(screen.getByRole('button', { name: 'contracts.workspace.next' }));
    await waitFor(() => expect(where()).toBe('/ops/contracts/CTR-6/overview?sort=name%3AASC'));
  });

  it('shows an unknown reference, or a contract outside the access, as an unknown uuid', async () => {
    // The API answers 404 for a contract outside the person's access, as for one that does not exist.
    renderAt('/ops/contracts/CTR-999/overview');
    expect(await screen.findByText('contracts.messages.loadFailed')).toBeInTheDocument();
    expect(where()).toBe('/ops/contracts/CTR-999/overview');
    expect(screen.queryByText('CTR-999', { selector: ':not([data-testid="where"])' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'share.share' })).toBeNull();
    expect(childReads()).toEqual([]);
  });

  it('does not read the contract again once deleted from its reference address', async () => {
    mocked.post.mockResolvedValue({ data: { contracts: 1, budget_lines: 0, applications: 0, assets: 0, contacts: 0, tasks: 0, links: 0, attachments: 0, blocked: 0, recorded_requirements: 0, refused: [] } });
    mocked.delete.mockResolvedValue({ data: {} });
    renderAt('/ops/contracts/CTR-5/overview');
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    const dialog = await screen.findByRole('dialog');
    const readsBefore = contractReads().length;
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/contracts/c-5'));
    await waitFor(() => expect(where()).toBe('/ops/contracts'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(contractReads()).toHaveLength(readsBefore);
  });

  it('sends a link that opens the contract by its reference', async () => {
    renderAt('/ops/contracts/c-5/overview');
    await waitFor(() => expect(where()).toBe('/ops/contracts/CTR-5/overview'));
    fireEvent.click(await screen.findByRole('button', { name: 'share.share' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(`${window.location.origin}/ops/contracts/CTR-5/overview`)).toBeInTheDocument();
  });

  it('copies the reference from the header', async () => {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderAt('/ops/contracts/CTR-5/overview');
    fireEvent.click(await screen.findByText('CTR-5'));
    expect(writeText).toHaveBeenCalledWith('CTR-5');
  });
});
