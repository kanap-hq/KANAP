import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design';
import api from '../../../api';
import TechnologyRelationsTab, { technologyRelationsCount, type TechnologyRelationsData } from './TechnologyRelationsTab';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };
// The caller's level per module; `infrastructure` member by default.
const auth = { levels: {} as Record<string, string> };
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string, level: string) => (RANK[auth.levels[resource] ?? 'member'] ?? 0) >= RANK[level] }),
}));
vi.mock('../../../hooks/useBudgetColumns', () => ({ default: () => ({ label: (key: string) => `column:${key}` }) }));
vi.mock('../../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: { vulnerabilityFeed: true } } }) }));

const mocked = vi.mocked(api);

function relations(overrides: Partial<TechnologyRelationsData> = {}): TechnologyRelationsData {
  return {
    year: 2026,
    budget_column: { key: 'budget', label: 'Budget' },
    budget_lines: [
      { id: 'bl-1', item_number: 12, nature: 'opex', product_name: 'Licences SQL Server', supplier_name: 'Microsoft', amount: 42000, currency: 'EUR', status: 'enabled' },
    ],
    contracts: [
      { id: 'ct-1', name: 'Enterprise agreement', supplier_name: 'Microsoft', end_date: '2027-06-30', yearly_amount: 90000, currency: 'EUR', auto_renewal: true, in_renewal_window: false, status: 'enabled' },
    ],
    projects: [{ id: 'prj-7', item_number: 7, name: 'Migration SQL 2022', status: 'in_progress', planned_end: '2026-12-01' }],
    incidents: [
      { id: 'inc-1', item_number: 4, title: 'Log shipping stopped', status: 'open', severity: 'high', detected_at: '2026-09-01' },
      { id: 'inc-2', item_number: 2, title: 'Cluster failover', status: 'closed', severity: 'medium', detected_at: '2026-03-01' },
    ],
    documents: [{ id: 'doc-1', original_filename: 'runbook.pdf', mime_type: 'application/pdf', size: 2048, uploaded_at: '2026-10-01T10:00:00Z' }],
    links: [{ id: 'lnk-1', description: 'Lifecycle policy', url: 'https://learn.microsoft.com/lifecycle', created_at: '2026-10-01T10:00:00Z' }],
    ...overrides,
  };
}

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderTab(data: TechnologyRelationsData) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/technologies/tec-1/relations') return { data } as never;
    if (url === '/technologies/tec-1/links') return { data: data.links } as never;
    if (url === '/technologies/tec-1/attachments') return { data: data.documents } as never;
    if (url === '/contracts/lookup') return { data: { items: [{ id: 'ct-1', name: 'Enterprise agreement' }, { id: 'ct-2', name: 'Premier support' }] } } as never;
    if (url === '/incidents') {
      return { data: { items: [
        { id: 'inc-9', item_number: 9, title: 'Disk full', status: 'in_progress' },
        { id: 'inc-8', item_number: 8, title: 'Old outage', status: 'closed' },
      ] } } as never;
    }
    throw new Error(`unexpected GET ${url}`);
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={['/it/technologies/TEC-1/relations']}>
            <Routes>
              <Route path="*" element={<><TechnologyRelationsTab id="tec-1" /><Location /></>} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
  mocked.patch.mockReset();
  mocked.delete.mockReset();
  auth.levels = {};
});

describe('TechnologyRelationsTab', () => {
  it('shows every section the caller reads, with references, totals of the year and the documents and links', async () => {
    renderTab(relations());
    await screen.findByText('Migration SQL 2022');
    expect(screen.getByText('BL-12')).toBeTruthy();
    expect(screen.getByText('column:budget 2026 (EUR)')).toBeTruthy();
    expect(screen.getByText('INC-4')).toBeTruthy();
    const files = screen.getByRole('region', { name: 'linksAndFiles.title' });
    expect(within(files).getByText('runbook.pdf')).toBeTruthy();
    expect(within(files).getByText('Lifecycle policy')).toBeTruthy();
    expect(within(files).getByText('learn.microsoft.com')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'pages.vulnerabilities.section.title' })).toBeNull();
  });

  it('opens the object when a row is clicked', async () => {
    renderTab(relations());
    fireEvent.click(await screen.findByText('Migration SQL 2022'));
    expect(screen.getByTestId('location').textContent).toBe('/portfolio/projects/PRJ-7');
  });

  it('leaves out the sections whose module the caller cannot read', async () => {
    renderTab(relations({ budget_lines: null, incidents: null }));
    await screen.findByText('Migration SQL 2022');
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.budgetLines' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'components.incidentRelations.title' })).toBeNull();
    expect(screen.getByRole('region', { name: 'workspace.application.relations.sections.contracts' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'pages.vulnerabilities.section.title' })).toBeNull();
  });

  it('links a contract from a server search, without the linked ones, and saves it at once', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    renderTab(relations());
    await screen.findByText('Enterprise agreement');
    const section = screen.getByRole('region', { name: 'workspace.application.relations.sections.contracts' });
    fireEvent.click(within(section).getByText('workspace.application.relations.add'));
    const option = await screen.findByRole('option', { name: /Premier support/ });
    expect(screen.queryByRole('option', { name: /Enterprise agreement/ })).toBeNull();
    fireEvent.click(option);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/technologies/tec-1/relations/contracts', { id: 'ct-2' }));
  });

  it('unlinks a row at once and brings it back with a message when the server refuses', async () => {
    mocked.delete.mockRejectedValue({ response: { status: 500, data: { message: 'Server down' } } });
    renderTab(relations());
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=Migration SQL 2022)' }));
    expect(mocked.delete).toHaveBeenCalledWith('/technologies/tec-1/relations/projects/prj-7');
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByText('Migration SQL 2022')).toBeTruthy();
  });

  it('offers open incidents only and keeps a closed incident linked', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    renderTab(relations());
    await screen.findByText('Log shipping stopped');
    const section = screen.getByRole('region', { name: 'components.incidentRelations.title' });
    expect(within(section).getByRole('button', { name: 'workspace.application.relations.remove(name=Log shipping stopped)' })).toBeTruthy();
    expect(within(section).queryByRole('button', { name: 'workspace.application.relations.remove(name=Cluster failover)' })).toBeNull();
    fireEvent.click(within(section).getByText('workspace.application.relations.add'));
    const option = await screen.findByRole('option', { name: /Disk full/ });
    expect(screen.queryByRole('option', { name: /Old outage/ })).toBeNull();
    fireEvent.click(option);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/technologies/tec-1/relations/incidents', { id: 'inc-9' }));
  });

  it('leaves the incidents read-only without the right to edit incidents', async () => {
    auth.levels = { incidents: 'reader' };
    renderTab(relations());
    await screen.findByText('Log shipping stopped');
    const section = screen.getByRole('region', { name: 'components.incidentRelations.title' });
    expect(within(section).queryByText('workspace.application.relations.add')).toBeNull();
    expect(within(section).queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    const contracts = screen.getByRole('region', { name: 'workspace.application.relations.sections.contracts' });
    expect(within(contracts).getByText('workspace.application.relations.add')).toBeTruthy();
  });

  it('gives readers the tables and the navigation only', async () => {
    auth.levels = { infrastructure: 'reader' };
    renderTab(relations());
    await screen.findByText('Migration SQL 2022');
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.editLink/ })).toBeNull();
  });

  it('adds a web link from its dialog and removes one at once', async () => {
    mocked.post.mockResolvedValue({ data: { id: 'lnk-2' } } as never);
    mocked.delete.mockResolvedValue({ data: { ok: true } } as never);
    renderTab(relations());
    await screen.findByText('Lifecycle policy');
    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.addLink' }));
    fireEvent.change(await screen.findByLabelText('linksAndFiles.columns.name'), { target: { value: 'Release notes' } });
    fireEvent.change(screen.getByLabelText('linksAndFiles.url'), { target: { value: ' https://example.test/notes ' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.add' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/technologies/tec-1/links', { url: 'https://example.test/notes', description: 'Release notes' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.removeNamed(name=Lifecycle policy)' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/technologies/tec-1/links/lnk-1'));
  });

  it('edits a web link in the same dialog, filled with the link', async () => {
    mocked.patch.mockResolvedValue({ data: { id: 'lnk-1' } } as never);
    renderTab(relations());
    fireEvent.click(await screen.findByRole('button', { name: 'linksAndFiles.editLinkNamed(name=Lifecycle policy)' }));
    expect(await screen.findByText('linksAndFiles.editLink')).toBeTruthy();
    const name = screen.getByLabelText('linksAndFiles.columns.name');
    expect(name).toHaveProperty('value', 'Lifecycle policy');
    fireEvent.change(name, { target: { value: 'Support policy' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/technologies/tec-1/links/lnk-1', { url: 'https://learn.microsoft.com/lifecycle', description: 'Support policy' }));
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('opens a web link at an absolute http or https address, as the other lists of websites', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    renderTab(relations({ links: [
      { id: 'lnk-1', description: 'VMware support', url: 'www.vmware.com/support', created_at: '2026-10-01T10:00:00Z' },
      { id: 'lnk-2', description: 'Script', url: 'javascript:alert(document.domain)', created_at: '2026-10-01T10:00:00Z' },
    ] }));
    fireEvent.click(await screen.findByText('VMware support'));
    expect(open).toHaveBeenCalledWith('https://www.vmware.com/support', '_blank', 'noopener,noreferrer');
    fireEvent.click(screen.getByText('Script'));
    expect(open).toHaveBeenCalledWith('https://javascript:alert(document.domain)', '_blank', 'noopener,noreferrer');
  });

  it('deletes a document after a confirmation', async () => {
    mocked.delete.mockResolvedValue({ data: { ok: true } } as never);
    renderTab(relations());
    fireEvent.click(await screen.findByRole('button', { name: 'linksAndFiles.removeFileNamed(name=runbook.pdf)' }));
    expect(mocked.delete).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/technologies/attachments/doc-1'));
  });

  it('counts the rows of the visible sections for the tab badge', () => {
    expect(technologyRelationsCount(undefined)).toBeUndefined();
    expect(technologyRelationsCount(relations())).toBe(7);
    expect(technologyRelationsCount(relations({ budget_lines: null, incidents: null, links: [] }))).toBe(3);
  });
});
