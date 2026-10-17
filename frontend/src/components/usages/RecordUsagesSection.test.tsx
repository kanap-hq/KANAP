import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

// A stable `t`: a new one on each render would loop the effects.
const t = vi.hoisted(() => (key: string, options?: Record<string, unknown>) => {
  if (options?.shown != null) return `${key}:${String(options.shown)}/${String(options.total)}`;
  return options?.total != null ? `${key}:${String(options.total)}` : key;
});
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn() } }));

import api from '../../api';
import RecordUsagesSection, { type Usages } from './RecordUsagesSection';

const mocked = api as unknown as { get: ReturnType<typeof vi.fn> };

const USAGES: Usages = {
  total: 56,
  groups: [
    { type: 'suppliers', total: 1, items: [{ id: 's-1', reference: null, name: 'Microsoft', status: 'enabled', active: true, roles: ['technical'] }] },
    {
      type: 'budget_lines',
      total: 52,
      items: [
        { id: 'b-1', reference: 'BL-12', name: 'Office 365', nature: 'opex', status: 'enabled', active: true, roles: ['commercial', 'support'] },
        { id: 'b-2', reference: 'BL-40', name: 'Servers', nature: 'capex', status: 'enabled', active: false, roles: [] },
      ],
    },
    { type: 'applications', total: 1, items: [{ id: 'a-1', reference: null, name: 'Outlook', status: 'active', active: true, roles: ['Account manager'] }] },
    { type: 'projects', total: 2, items: [{ id: 'p-1', reference: 'PRJ-3', name: 'Migration', status: 'planned', active: true, roles: [] }] },
  ],
};

function renderTab(owner: 'suppliers' | 'contacts' = 'contacts', ownerName?: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('dark')}>
        <MemoryRouter>
          <RecordUsagesSection owner={owner} id="x-1" ownerName={ownerName} />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('RecordUsagesSection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.get.mockResolvedValue({ data: USAGES });
  });

  it('lists each group with its title and count, and reads the owner\'s route', async () => {
    renderTab('contacts');
    const lines = await screen.findByRole('region', { name: 'shared.usages.groups.budget_lines' });
    expect(mocked.get).toHaveBeenCalledWith('/contacts/x-1/usages');
    expect(within(lines).getByRole('heading', { name: 'shared.usages.groups.budget_lines' })).toBeInTheDocument();
    expect(within(lines).getByText('52')).toBeInTheDocument();
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual([
      'shared.usages.title',
      'shared.usages.groups.suppliers',
      'shared.usages.groups.budget_lines',
      'shared.usages.groups.applications',
      'shared.usages.groups.projects',
    ]);
  });

  it('links each row to the object\'s page, a budget line by its reference', async () => {
    renderTab();
    const line = await screen.findByRole('link', { name: /Office 365/ });
    expect(line).toHaveAttribute('href', '/ops/budget/BL-12');
    expect(within(line).getByText('BL-12')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Microsoft/ })).toHaveAttribute('href', '/master-data/suppliers/s-1/overview');
    expect(screen.getByRole('link', { name: /Outlook/ })).toHaveAttribute('href', '/it/applications/a-1');
    expect(screen.getByRole('link', { name: /Migration/ })).toHaveAttribute('href', '/portfolio/projects/p-1');
  });

  it('shows the nature, the state, the status and the roles of each row', async () => {
    renderTab();
    const office = await screen.findByRole('link', { name: /Office 365/ });
    expect(office).toHaveTextContent('shared.usages.nature.opex · contacts.roles.commercial · contacts.roles.support');
    expect(screen.getByRole('link', { name: /Servers/ })).toHaveTextContent('shared.usages.nature.capex · shared.usages.inactive');
    // Free-text roles are shown as typed; project statuses come from the portfolio labels.
    expect(screen.getByRole('link', { name: /Outlook/ })).toHaveTextContent('Account manager');
    expect(screen.getByRole('link', { name: /Migration/ })).toHaveTextContent('statuses.project.planned');
    expect(screen.getByRole('link', { name: /Microsoft/ })).toHaveTextContent('contacts.roles.technical');
  });

  it('lists the technologies a contact supports, opened by their reference, with the free-text role', async () => {
    mocked.get.mockResolvedValue({ data: {
      total: 1,
      groups: [{ type: 'technologies', total: 1, items: [{ id: 't-1', reference: 'TEC-4', name: 'SQL Server', status: 'active', active: true, roles: ['Database support'] }] }],
    } });
    renderTab('contacts');
    const group = await screen.findByRole('region', { name: 'shared.usages.groups.technologies' });
    const row = within(group).getByRole('link', { name: /SQL Server/ });
    expect(row).toHaveAttribute('href', '/it/technologies/TEC-4');
    expect(within(row).getByText('TEC-4')).toBeInTheDocument();
    expect(row).toHaveTextContent('Database support');
  });

  it('says when a group shows part of its objects', async () => {
    renderTab();
    expect(await screen.findByText('shared.usages.partial:2/52')).toBeInTheDocument();
    expect(screen.getByText('shared.usages.partial:1/2')).toBeInTheDocument();
  });

  it('links a cut group of a supplier to its list filtered on the supplier, and only a cut one', async () => {
    const usages = {
        total: 158,
        groups: [
          { type: 'budget_lines', total: 52, items: Array.from({ length: 50 }, (_, i) => ({ id: `b-${i}`, reference: `BL-${i}`, name: `Line ${i}`, nature: 'opex', status: 'enabled', active: true })) },
          { type: 'contracts', total: 50, items: Array.from({ length: 50 }, (_, i) => ({ id: `c-${i}`, reference: null, name: `Contract ${i}`, status: 'enabled', active: true })) },
          { type: 'applications', total: 3, items: [{ id: 'a-1', reference: null, name: 'Outlook', status: 'active', active: true }] },
          { type: 'assets', total: 53, items: [{ id: 's-1', reference: null, name: 'Server', status: 'active', active: true }] },
        ],
    };
    mocked.get.mockImplementation(async (url: string) => (url === '/it-ops/settings'
      ? { data: { lifecycleStates: [{ code: 'active', label: 'Active' }, { code: 'retired', label: 'Retired' }] } }
      : { data: usages }));
    renderTab('suppliers', 'Microsoft');
    const lines = await screen.findByRole('region', { name: 'shared.usages.groups.budget_lines' });
    const all = within(lines).getByRole('link', { name: 'shared.usages.showAll:52' });
    const [path, search] = all.getAttribute('href')!.split('?');
    expect(path).toBe('/ops/budget');
    const params = new URLSearchParams(search);
    expect(JSON.parse(params.get('filters')!)).toEqual({ supplier_name: { filterType: 'set', values: ['Microsoft'] } });
    expect(params.get('statusScope')).toBe('all');
    // Applications: every lifecycle state ticked, once the settings name them.
    const apps = await within(screen.getByRole('region', { name: 'shared.usages.groups.applications' })).findByRole('link', { name: 'shared.usages.showAll:3' });
    const appParams = new URLSearchParams(apps.getAttribute('href')!.split('?')[1]);
    expect(JSON.parse(appParams.get('filters')!).lifecycle).toEqual({ filterType: 'set', values: ['active', 'retired'] });
    // Exactly 50: nothing cut, no link. Assets: their list cannot filter on the supplier.
    expect(within(screen.getByRole('region', { name: 'shared.usages.groups.contracts' })).queryByRole('link', { name: /showAll/ })).toBeNull();
    const assets = screen.getByRole('region', { name: 'shared.usages.groups.assets' });
    expect(within(assets).getByText('shared.usages.partial:1/53')).toBeInTheDocument();
    expect(within(assets).queryByRole('link', { name: /showAll/ })).toBeNull();
  });

  it('gives a contact no list link: no list filters on a contact', async () => {
    renderTab('contacts', 'Robert Chen');
    expect(await screen.findByText('shared.usages.partial:2/52')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /showAll/ })).toBeNull();
  });

  it('says so in one line when nothing uses the record', async () => {
    mocked.get.mockResolvedValue({ data: { total: 0, groups: [] } });
    renderTab('suppliers');
    expect(await screen.findByText('shared.usages.emptySupplier')).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith('/suppliers/x-1/usages');
    // One line under the section title, no group.
    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual(['shared.usages.title']);
    expect(screen.getByRole('heading', { name: 'shared.usages.title' })).toBeInTheDocument();
  });

  it('shows an error when the list cannot load', async () => {
    mocked.get.mockRejectedValue(new Error('boom'));
    renderTab();
    expect(await screen.findByText('shared.usages.loadFailed')).toBeInTheDocument();
  });
});
