import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

// A stable `t`: a new one on each render would loop the effects.
const t = vi.hoisted(() => (key: string, options?: Record<string, unknown>) => (
  options?.total != null ? `${key}:${String(options.shown)}/${String(options.total)}` : key
));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn() } }));

import api from '../../api';
import RecordUsagesTab, { type Usages } from './RecordUsagesTab';

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

function renderTab(owner: 'suppliers' | 'contacts' = 'contacts') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={createAppTheme('dark')}>
        <MemoryRouter>
          <RecordUsagesTab owner={owner} id="x-1" />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('RecordUsagesTab', () => {
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

  it('says when a group shows part of its objects', async () => {
    renderTab();
    expect(await screen.findByText('shared.usages.partial:2/52')).toBeInTheDocument();
    expect(screen.getByText('shared.usages.partial:1/2')).toBeInTheDocument();
  });

  it('says so in one line when nothing uses the record', async () => {
    mocked.get.mockResolvedValue({ data: { total: 0, groups: [] } });
    renderTab('suppliers');
    expect(await screen.findByText('shared.usages.emptySupplier')).toBeInTheDocument();
    expect(mocked.get).toHaveBeenCalledWith('/suppliers/x-1/usages');
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('shows an error when the list cannot load', async () => {
    mocked.get.mockRejectedValue(new Error('boom'));
    renderTab();
    expect(await screen.findByText('shared.usages.loadFailed')).toBeInTheDocument();
  });
});
