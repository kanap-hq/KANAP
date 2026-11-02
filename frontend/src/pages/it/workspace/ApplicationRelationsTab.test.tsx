import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { NotifyProvider } from '../../../components/notify/NotifyProvider';
import api from '../../../api';
import ApplicationRelationsTab, { type ApplicationRelationsData } from './ApplicationRelationsTab';
import { ApplicationFeedbackProvider } from '../applicationFeedback';

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
vi.mock('../../../hooks/useBudgetColumns', () => ({ default: () => ({ label: (key: string) => `column:${key}` }) }));

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
    incidents: [
      { id: 'inc-5', item_number: 5, title: 'Flux bloqués', status: 'open', severity: 'high', detected_at: '2026-10-12' },
      { id: 'inc-2', item_number: 2, title: 'Panne du serveur', status: 'closed', severity: 'low', detected_at: '2026-09-01' },
    ],
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

function renderTab(data: ApplicationRelationsData | (() => Promise<unknown>)) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/applications/app-1/relations') return (typeof data === 'function' ? data() : { data }) as never;
    if (url === '/technologies/lookup') {
      return { data: { items: [{ id: 'tec-4', name: 'Java', reference: 'TEC-4', editor: 'Oracle' }, { id: 'tec-1', name: 'SQL Server', reference: 'TEC-1', editor: 'Microsoft' }] } } as never;
    }
    if (url === '/business-processes/lookup') return { data: { items: [{ id: 'bp-1', name: 'Order to cash' }, { id: 'bp-2', name: 'Procure to pay' }] } } as never;
    if (url === '/incidents') {
      return { data: { items: [
        { id: 'inc-5', item_number: 5, title: 'Flux bloqués', status: 'open' },
        { id: 'inc-8', item_number: 8, title: 'Lenteurs', status: 'investigating' },
        { id: 'inc-9', item_number: 9, title: 'Incident clos', status: 'closed' },
      ] } } as never;
    }
    if (url === '/portfolio/projects') return { data: { items: [{ id: 'prj-9', item_number: 9, name: 'Refonte du datalake' }, { id: 'prj-7', item_number: 7, name: 'Migration Talend Cloud' }] } } as never;
    throw new Error(`unexpected GET ${url}`);
  });
  const onRelationsChange = vi.fn();
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <NotifyProvider>
        <MemoryRouter initialEntries={['/it/applications/app-1/relations']}>
          <Routes>
            <Route path="*" element={<ApplicationFeedbackProvider onError={() => undefined}><ApplicationRelationsTab id="app-1" onRelationsChange={onRelationsChange} /><Location /></ApplicationFeedbackProvider>} />
          </Routes>
        </MemoryRouter>
        </NotifyProvider>
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
    expect(screen.getByRole('table', { name: 'components.incidentRelations.title' })).toBeTruthy();

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

  it('opens a row through a real link on its name', async () => {
    renderTab(relations());
    const link = await screen.findByRole('link', { name: 'Migration Talend Cloud' });
    expect(link.getAttribute('href')).toBe('/portfolio/projects/PRJ-7');
    fireEvent.click(link);
    expect(screen.getByTestId('location').textContent).toBe('/portfolio/projects/PRJ-7');
  });

  it('shows a spinner while the tab loads, then says when it could not be loaded and reads it again on retry', async () => {
    let calls = 0;
    renderTab(async () => {
      calls += 1;
      if (calls === 1) throw new Error('boom');
      return { data: relations() };
    });
    expect(screen.getByRole('progressbar')).toBeTruthy();
    expect(await screen.findByText('workspace.application.relations.loadFailed')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.projects' })).toBeNull();
    expect(screen.queryByText('workspace.application.relations.empty.projects')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.retry' }));
    expect(await screen.findByText('Migration Talend Cloud')).toBeTruthy();
    expect(calls).toBe(2);
  });

  it('unlinks at once and offers to undo it, which links the object again', async () => {
    mocked.delete.mockResolvedValue({ data: { ok: true } } as never);
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    renderTab(relations());
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=Mettre à jour le connecteur)' }));
    expect(await screen.findByText('workspace.application.relations.feedback.unlinked(name=Mettre à jour le connecteur)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.undo' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/tasks', { id: 't-118' }));
  });

  it('says what was linked when an object is added', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    renderTab(relations());
    await screen.findByText('Migration Talend Cloud');
    const section = screen.getByRole('region', { name: 'workspace.application.relations.sections.projects' });
    fireEvent.click(within(section).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /Refonte du datalake/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/projects', { id: 'prj-9' }));
    expect(screen.queryByText(/feedback\.linked/)).toBeNull();
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

  it('shows a line without a rate in its own currency, leaves it out of the total and names it under the table', async () => {
    renderTab(relations({
      budget_lines: [
        { id: 'bl-12', item_number: 12, nature: 'opex', product_name: 'Licences Talend', supplier_name: 'Talend SAS', amount: 48000, currency: 'EUR', status: 'enabled' },
        { id: 'bl-50', item_number: 50, nature: 'opex', product_name: 'Support UK', supplier_name: null, amount: null, currency: 'EUR', status: 'enabled', fx_missing: { currency: 'GBP', amount: 20000 } },
      ],
      contracts: [
        { id: 'ct-1', name: 'Maintenance Talend', supplier_name: 'Talend SAS', end_date: '2027-05-31', yearly_amount: 36000, currency: 'EUR', auto_renewal: true, in_renewal_window: false, status: 'enabled' },
        { id: 'ct-3', name: 'Support UK', supplier_name: 'Talend Ltd', end_date: '2027-01-31', yearly_amount: 10000, currency: 'GBP', auto_renewal: false, in_renewal_window: false, status: 'enabled' },
      ],
    }));
    const lines = await screen.findByRole('table', { name: 'workspace.application.relations.sections.budgetLines' });
    const row = within(lines).getByText('BL-50').closest('tr') as HTMLElement;
    expect(row.textContent).toMatch(/shared\.fxMissing\.localAmount\(amount=20\s000,currency=GBP\)/);
    expect(within(row).getByRole('img', { name: 'shared.fxMissing.lineTooltip(currency=GBP,year=2026)' })).toBeInTheDocument();
    expect(lines.querySelector('tfoot tr')?.textContent).toMatch(/^workspace\.application\.relations\.total48\s000$/);
    const notice = screen.getByRole('status');
    expect(notice.textContent).toContain('ops:shared.fxMissing.excluding(count=1,pairs=ops:shared.fxMissing.pair(currency=GBP,year=2026))');
    expect(lines.closest('section')).toContainElement(notice);

    // The contracts keep one total per currency.
    const contractTotals = [...screen.getByRole('table', { name: 'workspace.application.relations.sections.contracts' }).querySelectorAll('tfoot tr')].map((tr) => tr.textContent);
    expect(contractTotals).toHaveLength(2);
    expect(contractTotals[0]).toMatch(/36\s000 EUR$/);
    expect(contractTotals[1]).toMatch(/10\s000 GBP$/);
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

  it('does not list technologies', async () => {
    renderTab(relations());
    await screen.findByText('Migration Talend Cloud');
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.technologies' })).toBeNull();
    expect(screen.queryByText('Java')).toBeNull();
  });

  it('does not list the business processes: they are in the properties panel', async () => {
    renderTab(relations());
    await screen.findByText('Migration Talend Cloud');
    expect(screen.queryByText('Order to cash')).toBeNull();
    expect(mocked.get).not.toHaveBeenCalledWith('/business-processes/lookup', expect.anything());
  });

  it('lists the incidents with their facts, from the tab read only', async () => {
    renderTab(relations());
    const table = await screen.findByRole('table', { name: 'components.incidentRelations.title' });
    expect(within(table).getByText('INC-5')).toBeTruthy();
    expect(within(table).getByText('Flux bloqués')).toBeTruthy();
    expect(within(table).getByText('enums.incidentSeverity.high')).toBeTruthy();
    expect(within(table).getByText('enums.incidentStatus.open')).toBeTruthy();
    expect(mocked.get).not.toHaveBeenCalledWith('/incidents', expect.objectContaining({ params: expect.objectContaining({ application_id: 'app-1' }) }));
    fireEvent.click(within(table).getByText('Flux bloqués'));
    expect(screen.getByTestId('location').textContent).toBe('/it/incidents/INC-5/overview');
  });

  it('links an incident from a server search, without the linked and closed ones, and unlinks an open one', async () => {
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    mocked.delete.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    const { onRelationsChange } = renderTab(relations());
    await screen.findByText('Flux bloqués');
    const section = screen.getByRole('region', { name: 'components.incidentRelations.title' });
    fireEvent.click(within(section).getByText('workspace.application.relations.add'));
    const option = await screen.findByRole('option', { name: /Lenteurs/ });
    expect(screen.queryByRole('option', { name: /Flux bloqués/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /Incident clos/ })).toBeNull();
    fireEvent.click(option);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/applications/app-1/relations/incidents', { id: 'inc-8' }));
    await waitFor(() => expect(onRelationsChange).toHaveBeenCalled());

    // A closed incident is frozen: no remove action on its row.
    expect(screen.queryByRole('button', { name: 'workspace.application.relations.remove(name=Panne du serveur)' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.relations.remove(name=Flux bloqués)' }));
    expect(mocked.delete).toHaveBeenCalledWith('/applications/app-1/relations/incidents/inc-5');
  });

  it('leaves the incidents read-only without the right to edit incidents', async () => {
    auth.readOnly = ['incidents'];
    renderTab(relations());
    await screen.findByText('Flux bloqués');
    const section = screen.getByRole('region', { name: 'components.incidentRelations.title' });
    expect(within(section).queryByText('workspace.application.relations.add')).toBeNull();
    expect(within(section).queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    const projects = screen.getByRole('region', { name: 'workspace.application.relations.sections.projects' });
    expect(within(projects).getByText('workspace.application.relations.add')).toBeTruthy();
  });

  it('hides the incidents the user cannot read', async () => {
    renderTab(relations({ incidents: null }));
    await screen.findByText('Migration Talend Cloud');
    expect(screen.queryByRole('region', { name: 'components.incidentRelations.title' })).toBeNull();
  });
});
