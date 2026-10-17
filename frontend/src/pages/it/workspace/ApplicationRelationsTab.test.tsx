import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import ApplicationRelationsTab, { type ApplicationRelationsData } from './ApplicationRelationsTab';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
const auth = { manager: true, readOnly: [] as string[] };
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: (resource: string) => auth.manager && !auth.readOnly.includes(resource) }) }));
// The localized catalogs: the families read in the user's language (B1), the code when unknown.
const families: Record<string, string> = { database: 'Base de données' };
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ labelFor: (field: string, code: string) => (field === 'technologyFamily' ? families[code] ?? code : code) }),
}));
vi.mock('../../../hooks/useBudgetColumns', () => ({ default: () => ({ label: (key: string) => `column:${key}` }) }));
vi.mock('../editors/IncidentRelationsSection', () => ({ default: () => <div data-testid="incidents" /> }));

const mocked = vi.mocked(api);

function relations(overrides: Partial<ApplicationRelationsData> = {}): ApplicationRelationsData {
  return {
    year: 2026,
    budget_column: { key: 'planned', label: 'Budget' },
    budget_lines: [
      { id: 'bl-12', item_number: 12, nature: 'opex', product_name: 'Licences Talend', supplier_name: 'Talend SAS', amount: 48000, currency: 'EUR', status: 'enabled' },
    ],
    contracts: [
      { id: 'ct-1', name: 'Maintenance Talend', supplier_name: 'Talend SAS', end_date: '2027-05-31', yearly_amount: 36000, currency: 'EUR', auto_renewal: true, in_renewal_window: false, status: 'enabled' },
    ],
    projects: [{ id: 'prj-7', item_number: 7, name: 'Migration Talend Cloud', status: 'in_progress', planned_end: '2026-11-30' }],
    requests: [{ id: 'req-23', item_number: 23, name: 'Connecteur Salesforce', status: 'approved', target_delivery_date: '2027-03-31' }],
    tasks: [{ id: 't-118', item_number: 118, title: 'Mettre à jour le connecteur', status: 'in_progress', assignee_name: 'Isabelle Moreau', due_date: '2026-10-24' }],
    technologies: [
      { id: 'tec-4', reference: 'TEC-4', name: 'Java', family: 'runtime', declared: true, hosted: false, versions: [], version_unknown: true, standard_support_end: null, via: [] },
      {
        id: 'tec-1', reference: 'TEC-1', name: 'SQL Server', family: 'database', declared: false, hosted: true, versions: ['2019'], version_unknown: false,
        standard_support_end: '2020-01-14', via: [{ asset_id: 'srv-1', asset_name: 'srv-etl-1', host_name: null }],
      },
      {
        id: 'tec-3', reference: 'TEC-3', name: 'Tomcat', family: 'middleware', declared: true, hosted: true, versions: [], version_unknown: true,
        standard_support_end: null, via: [{ asset_id: 'srv-1', asset_name: 'srv-etl-1', host_name: null }],
      },
      {
        id: 'tec-2', reference: 'TEC-2', name: 'vSphere', family: 'virtualization', declared: false, hosted: true, versions: ['8'], version_unknown: false,
        standard_support_end: '2099-10-11', via: [{ asset_id: 'srv-2', asset_name: 'srv-etl-2', host_name: 'esx-01' }],
      },
    ],
    processes: [{ id: 'bp-1', name: 'Order to cash', status: 'enabled', owner_name: 'Claire Dubois' }],
    suggestions: [
      { type: 'budget_line', id: 'bl-34', item_number: 34, name: 'Formation Talend', via: { kind: 'same_supplier', label: null } },
    ],
    also: { assets: 3, interfaces: 4, documents: 0 },
    ...overrides,
  };
}

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderTab(data: ApplicationRelationsData) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/applications/app-1/relations') return { data } as never;
    if (url === '/technologies/lookup') {
      return { data: { items: [{ id: 'tec-4', name: 'Java', reference: 'TEC-4', editor: 'Oracle' }, { id: 'tec-1', name: 'SQL Server', reference: 'TEC-1', editor: 'Microsoft' }] } } as never;
    }
    if (url === '/business-processes/lookup') return { data: { items: [{ id: 'bp-1', name: 'Order to cash' }, { id: 'bp-2', name: 'Procure to pay' }] } } as never;
    if (url === '/portfolio/projects') return { data: { items: [{ id: 'prj-9', item_number: 9, name: 'Refonte du datalake' }, { id: 'prj-7', item_number: 7, name: 'Migration Talend Cloud' }] } } as never;
    throw new Error(`unexpected GET ${url}`);
  });
  const onRelationsChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/applications/app-1/relations']}>
          <Routes>
            <Route path="*" element={<><ApplicationRelationsTab id="app-1" onRelationsChange={onRelationsChange} /><Location /></>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onRelationsChange };
}

beforeEach(() => {
  mocked.get.mockReset();
  mocked.post.mockReset();
  mocked.delete.mockReset();
  auth.manager = true;
  auth.readOnly = [];
});

describe('ApplicationRelationsTab', () => {
  it('shows one dense table per section with business references and the facts of each row', async () => {
    renderTab(relations());
    const lines = await screen.findByRole('table', { name: 'workspace.application.relations.sections.budgetLines' });
    expect(within(lines).getByText('BL-12')).toBeTruthy();
    expect(within(lines).getByText('Licences Talend')).toBeTruthy();
    expect(within(lines).getByText('ops:budget.opex')).toBeTruthy();
    expect(within(lines).getByText('48 000')).toBeTruthy();
    expect(within(lines).getByText('column:planned 2026 (EUR)')).toBeTruthy();

    const contracts = screen.getByRole('table', { name: 'workspace.application.relations.sections.contracts' });
    expect(within(contracts).getByText('36 000 EUR')).toBeTruthy();
    expect(within(contracts).getByText('workspace.application.relations.renewal.tacit')).toBeTruthy();

    expect(screen.getByText('PRJ-7')).toBeTruthy();
    expect(screen.getByText('portfolio:statuses.project.in_progress')).toBeTruthy();
    expect(screen.getByText('REQ-23')).toBeTruthy();
    expect(screen.getByText('T-118')).toBeTruthy();
    expect(screen.getByText('Isabelle Moreau')).toBeTruthy();
    expect(screen.getByTestId('incidents')).toBeTruthy();

    // Related elsewhere: assets and interfaces, no zero part.
    expect(screen.getByText('workspace.application.relations.also.assets(count=3)').getAttribute('href')).toBe('/it/applications/app-1/deployments');
    expect(screen.queryByText(/also\.documents/)).toBeNull();
  });

  it('opens the object when a row is clicked', async () => {
    renderTab(relations());
    fireEvent.click(await screen.findByText('Migration Talend Cloud'));
    expect(screen.getByTestId('location').textContent).toBe('/portfolio/projects/PRJ-7');
    fireEvent.click(screen.getByText('Maintenance Talend'));
    expect(screen.getByTestId('location').textContent).toBe('/ops/contracts/ct-1/overview');
  });

  it('hides the sections the user cannot read and the suggestions when there are none', async () => {
    renderTab(relations({ budget_lines: null, contracts: null, suggestions: [] }));
    await screen.findByText('Migration Talend Cloud');
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.budgetLines' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.contracts' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.related' })).toBeNull();
    expect(screen.getByRole('region', { name: 'workspace.application.relations.sections.projects' })).toBeTruthy();
  });

  it('adds a project from a server search, without the linked ones, and saves it at once', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    const { onRelationsChange } = renderTab(relations());
    await screen.findByText('Migration Talend Cloud');
    const section = screen.getByRole('region', { name: 'workspace.application.relations.sections.projects' });
    fireEvent.click(within(section).getByText('workspace.application.relations.add'));

    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/portfolio/projects', expect.objectContaining({
      params: { page: 1, limit: 30, sort: 'updated_at:DESC' },
    })));
    const option = await screen.findByRole('option', { name: /Refonte du datalake/ });
    expect(screen.queryByRole('option', { name: /Migration Talend Cloud/ })).toBeNull();
    fireEvent.click(option);

    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/projects', { id: 'prj-9' }));
    await waitFor(() => expect(onRelationsChange).toHaveBeenCalled());
    expect(screen.queryByRole('option')).toBeNull();
  });

  it('removes a row at once and brings it back with a message when the server refuses', async () => {
    let reject: (e: unknown) => void = () => undefined;
    mocked.delete.mockReturnValue(new Promise((_, r) => { reject = r; }) as never);
    renderTab(relations());
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=Mettre à jour le connecteur)' }));

    expect(mocked.delete).toHaveBeenCalledWith('/applications/app-1/relations/tasks/t-118');
    await waitFor(() => expect(screen.queryByText('Mettre à jour le connecteur')).toBeNull());

    reject({ response: { status: 500, data: { message: 'Server down' } } });
    expect(await screen.findByText('Mettre à jour le connecteur')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('links a suggestion to its section', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    renderTab(relations());
    const related = await screen.findByRole('region', { name: 'workspace.application.relations.sections.related' });
    expect(within(related).getByText('BL-34')).toBeTruthy();
    expect(within(related).getByText('workspace.application.relations.via.same_supplier(label=)')).toBeTruthy();
    fireEvent.click(within(related).getByRole('button', { name: 'workspace.application.relations.linkNamed(name=Formation Talend)' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/budget_lines', { id: 'bl-34' }));
  });

  it('gives readers the tables and the navigation only', async () => {
    auth.manager = false;
    renderTab(relations());
    await screen.findByText('Migration Talend Cloud');
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.linkNamed/ })).toBeNull();
  });

  it('adds a total line from two budget lines or contracts on, one per contract currency, without disabled contracts', async () => {
    renderTab(relations({
      budget_lines: [
        { id: 'bl-12', item_number: 12, nature: 'opex', product_name: 'Licences Talend', supplier_name: 'Talend SAS', amount: 48000, currency: 'EUR', status: 'enabled' },
        { id: 'bl-27', item_number: 27, nature: 'opex', product_name: 'Support Talend', supplier_name: 'Talend SAS', amount: 36000, currency: 'EUR', status: 'enabled' },
        { id: 'bl-41', item_number: 41, nature: 'capex', product_name: 'Serveurs ETL', supplier_name: null, amount: null, currency: 'EUR', status: 'enabled' },
      ],
      contracts: [
        { id: 'ct-1', name: 'Maintenance Talend', supplier_name: 'Talend SAS', end_date: '2027-05-31', yearly_amount: 36000, currency: 'EUR', auto_renewal: true, in_renewal_window: false, status: 'enabled' },
        { id: 'ct-2', name: 'Licences Talend', supplier_name: 'Talend SAS', end_date: '2026-12-14', yearly_amount: 48000, currency: 'EUR', auto_renewal: false, in_renewal_window: true, status: 'enabled' },
        { id: 'ct-3', name: 'Support US', supplier_name: 'Talend Inc', end_date: '2027-01-31', yearly_amount: 10000, currency: 'USD', auto_renewal: false, in_renewal_window: false, status: 'enabled' },
        { id: 'ct-4', name: 'Ancien contrat', supplier_name: 'Talend SAS', end_date: '2025-01-31', yearly_amount: 99000, currency: 'EUR', auto_renewal: false, in_renewal_window: false, status: 'disabled' },
      ],
    }));
    const lines = await screen.findByRole('table', { name: 'workspace.application.relations.sections.budgetLines' });
    const lineTotals = lines.querySelectorAll('tfoot tr');
    expect(lineTotals).toHaveLength(1);
    expect(lineTotals[0].textContent).toMatch(/^workspace\.application\.relations\.total84\s000$/);

    const contracts = screen.getByRole('table', { name: 'workspace.application.relations.sections.contracts' });
    const contractTotals = [...contracts.querySelectorAll('tfoot tr')].map((row) => row.textContent);
    expect(contractTotals).toHaveLength(2);
    expect(contractTotals[0]).toMatch(/84\s000 EUR$/);
    expect(contractTotals[1]).toMatch(/10\s000 USD$/);
  });

  it('shows no total line under a single row', async () => {
    renderTab(relations());
    const lines = await screen.findByRole('table', { name: 'workspace.application.relations.sections.budgetLines' });
    expect(lines.querySelector('tfoot')).toBeNull();
    expect(screen.getByRole('table', { name: 'workspace.application.relations.sections.contracts' }).querySelector('tfoot')).toBeNull();
  });

  it('gives the year of a contract end, even in the current year', async () => {
    const thisYear = new Date().getFullYear();
    renderTab(relations({
      contracts: [
        { id: 'ct-2', name: 'Licences Talend', supplier_name: 'Talend SAS', end_date: `${thisYear}-12-14`, yearly_amount: 48000, currency: 'EUR', auto_renewal: false, in_renewal_window: false, status: 'enabled' },
      ],
    }));
    const contracts = await screen.findByRole('table', { name: 'workspace.application.relations.sections.contracts' });
    expect(within(contracts).getByText(new RegExp(`14 Dec ${thisYear}`))).toBeTruthy();
  });

  it('opens the picker on the Add button and takes the first match with Enter', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    renderTab(relations());
    await screen.findByText('Migration Talend Cloud');
    const section = screen.getByRole('region', { name: 'workspace.application.relations.sections.projects' });
    const button = within(section).getByText('workspace.application.relations.add');
    fireEvent.click(button);
    expect(button.closest('button')?.getAttribute('aria-expanded')).toBe('true');
    await screen.findByRole('option', { name: /Refonte du datalake/ });
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'workspace.application.relations.search.projects' }), { key: 'Enter' });
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/projects', { id: 'prj-9' }));
  });

  it('lists each technology once, declared and hosted, with its version, servers and end of support', async () => {
    renderTab(relations());
    const table = await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    const rows = [...table.querySelectorAll('tbody tr')];
    expect(rows.map((row) => row.querySelector('td')?.textContent)).toEqual(['TEC-4', 'TEC-1', 'TEC-3', 'TEC-2']);

    const sql = within(rows[1] as HTMLElement);
    expect(sql.getByText('Base de données')).toBeTruthy();
    expect(sql.getByText('2019')).toBeTruthy();
    expect(sql.getByText('workspace.application.relations.technologyLink.hosted')).toBeTruthy();
    expect(sql.getByText('srv-etl-1')).toBeTruthy();
    // Support ended: in the attention colour; a future end is not.
    expect(getComputedStyle(sql.getByText(/2020/)).color).not.toBe(getComputedStyle(within(rows[3] as HTMLElement).getByText(/2099/)).color);

    const java = within(rows[0] as HTMLElement);
    // A family without a label shows its code.
    expect(java.getByText('runtime')).toBeTruthy();
    expect(java.getByTitle('workspace.application.relations.versionUnknown').textContent).toBe('—');
    expect(java.getByText('workspace.application.relations.technologyLink.declared')).toBeTruthy();
    expect(within(rows[2] as HTMLElement).getByText('workspace.application.relations.technologyLink.both')).toBeTruthy();
    expect(within(rows[3] as HTMLElement).getByText('workspace.application.relations.viaHost(server=srv-etl-2,host=esx-01)')).toBeTruthy();

    fireEvent.click(java.getByText('Java'));
    expect(screen.getByTestId('location').textContent).toBe('/it/technologies/TEC-4');
  });

  it('leaves the free width to the technology name (B6)', async () => {
    renderTab(relations());
    const table = await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    const widths = [...table.querySelectorAll('col')].map((col) => (col as HTMLElement).style.width);
    // Ref, name, family, version, link, servers, end of support, then the remove button.
    expect(widths[1]).toBe('');
    const fixed = widths.filter(Boolean).reduce((sum, width) => sum + parseInt(width, 10), 0);
    expect(fixed).toBeLessThanOrEqual(660);
    expect(within(table).getByTitle('Tomcat').textContent).toBe('Tomcat');
  });

  it('removes a declared technology only, and keeps it as hosted when a server carries it', async () => {
    mocked.delete.mockReturnValue(new Promise(() => undefined) as never);
    renderTab(relations());
    await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    expect(screen.queryByRole('button', { name: 'workspace.application.relations.remove(name=SQL Server)' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'workspace.application.relations.remove(name=vSphere)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.relations.remove(name=Tomcat)' }));
    expect(mocked.delete).toHaveBeenCalledWith('/applications/app-1/relations/technologies/tec-3');
    await waitFor(() => expect(screen.getByText('Tomcat').closest('tr')?.textContent).toContain('technologyLink.hosted'));
  });

  it('declares a technology from the lookup, offering the hosted ones but not the declared ones', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    renderTab(relations());
    await screen.findByRole('table', { name: 'workspace.application.relations.sections.technologies' });
    const section = screen.getByRole('region', { name: 'workspace.application.relations.sections.technologies' });
    fireEvent.click(within(section).getByText('workspace.application.relations.add'));
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/technologies/lookup', expect.objectContaining({ params: { limit: 30 } })));
    const option = await screen.findByRole('option', { name: /SQL Server/ });
    expect(screen.queryByRole('option', { name: /Java/ })).toBeNull();
    fireEvent.click(option);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/technologies', { id: 'tec-1' }));
  });

  it('lists the business processes with their owner, and links and unlinks them', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    mocked.delete.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    renderTab(relations());
    const table = await screen.findByRole('table', { name: 'workspace.application.relations.sections.processes' });
    expect(within(table).getByText('Claire Dubois')).toBeTruthy();

    const section = screen.getByRole('region', { name: 'workspace.application.relations.sections.processes' });
    fireEvent.click(within(section).getByText('workspace.application.relations.add'));
    const option = await screen.findByRole('option', { name: /Procure to pay/ });
    expect(screen.queryByRole('option', { name: /Order to cash/ })).toBeNull();
    fireEvent.click(option);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/processes', { id: 'bp-2' }));

    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.relations.remove(name=Order to cash)' }));
    expect(mocked.delete).toHaveBeenCalledWith('/applications/app-1/relations/processes/bp-1');
  });

  it('leaves technologies and processes read-only without the right to edit their module', async () => {
    auth.readOnly = ['infrastructure', 'business_processes'];
    renderTab(relations());
    await screen.findByText('Migration Talend Cloud');
    const technologies = screen.getByRole('region', { name: 'workspace.application.relations.sections.technologies' });
    const processes = screen.getByRole('region', { name: 'workspace.application.relations.sections.processes' });
    expect(within(technologies).queryByText('workspace.application.relations.add')).toBeNull();
    expect(within(processes).queryByText('workspace.application.relations.add')).toBeNull();
    expect(within(technologies).queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(within(processes).queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    const projects = screen.getByRole('region', { name: 'workspace.application.relations.sections.projects' });
    expect(within(projects).getByText('workspace.application.relations.add')).toBeTruthy();
  });

  it('hides the technologies and processes the user cannot read', async () => {
    renderTab(relations({ technologies: null, processes: null }));
    await screen.findByText('Migration Talend Cloud');
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.technologies' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.processes' })).toBeNull();
  });
});
