import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design';
import api from '../../../api';
import type {
  ApplicationRelationRow,
  AssetRelationRow,
  BudgetLineRow,
  BusinessProcessRow,
  ConversionRow,
  TechnologyRelationRow,
} from '../../../components/workspace/relations';
import PortfolioRelationsTab from './PortfolioRelationsTab';
import {
  portfolioRelationsCount,
  usePortfolioRelationsBadge,
  type PortfolioLinksData,
  type ProjectRelationsData,
  type RequestRelationsData,
} from './portfolioRelations';

const rights = vi.hoisted(() => ({
  portfolio_projects: 'contributor',
  portfolio_requests: 'contributor',
  infrastructure: 'reader',
  business_processes: 'member',
} as Record<string, string>));

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([name]) => name !== 'defaultValue').map(([name, value]) => `${name}=${value}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => translation,
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => {
      const rank: Record<string, number> = { reader: 1, contributor: 2, member: 3, manager: 3, admin: 4 };
      const current = rights[resource];
      if (!current) return false;
      return (rank[current] ?? 0) >= (rank[level] ?? 0);
    },
  }),
}));
vi.mock('../../../hooks/useBudgetColumns', () => ({
  default: () => ({ label: (key: string) => `column:${key}` }),
}));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ labelFor: (field: string, code?: string | null) => (code ? `${field}:${code}` : '') }),
}));
vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [{ code: 'high', label: 'High' }] } }),
}));

const mocked = vi.mocked(api);

const BUDGET: BudgetLineRow[] = [
  { id: 'bl-1', item_number: 4, nature: 'opex', product_name: 'Licences', supplier_name: 'Oracle', amount: 48000, currency: 'EUR', status: 'enabled' },
  { id: 'bl-2', item_number: 12, nature: 'capex', product_name: 'Servers', supplier_name: null, amount: 12000, currency: 'EUR', status: 'enabled' },
];
const APPLICATIONS: ApplicationRelationRow[] = [
  { id: 'app-1', reference: 'APP-4', name: 'SAP S/4HANA', lifecycle: 'active', business_criticality: 'high', status: 'enabled' },
];
const ASSETS: AssetRelationRow[] = [
  { id: 'as-1', reference: 'AST-2', name: 'sap-prd-db01', kind: 'physical_server', environment: 'prod', status: 'active' },
];
const TECHNOLOGIES: TechnologyRelationRow[] = [
  { id: 'tec-1', reference: 'TEC-9', name: 'Oracle Database', family: 'database', vendor: 'Oracle' },
];
const PROCESSES: BusinessProcessRow[] = [
  { id: 'bp-1', name: 'Order to cash', status: 'enabled', owner_name: 'Ada Lovelace' },
  { id: 'bp-2', name: 'Retired process', status: 'disabled', owner_name: null },
];
const SOURCE: ConversionRow[] = [
  { id: 'req-3', item_number: 3, name: 'Replace the ledger', status: 'approved' },
];
const RESULTING: ConversionRow[] = [
  { id: 'prj-8', item_number: 8, name: 'New billing', status: 'in_progress' },
];

function projectRelations(overrides: Partial<ProjectRelationsData> = {}): ProjectRelationsData {
  return {
    year: 2026,
    budget_column: { key: 'planned', label: 'Planned' },
    budget_lines: BUDGET,
    applications: APPLICATIONS,
    assets: ASSETS,
    technologies: TECHNOLOGIES,
    source_requests: SOURCE,
    ...overrides,
  };
}

function requestRelations(overrides: Partial<RequestRelationsData> = {}): RequestRelationsData {
  return {
    year: 2026,
    budget_column: { key: 'planned', label: 'Planned' },
    budget_lines: BUDGET,
    applications: APPLICATIONS,
    assets: ASSETS,
    processes: PROCESSES,
    resulting_projects: RESULTING,
    ...overrides,
  };
}

const LINKS: PortfolioLinksData = {
  urls: [{ id: 'l-1', label: 'Vendor portal', url: 'https://me.example.com', created_at: '2026-10-01T10:00:00.000Z' }],
  attachments: [{ id: 'a-1', original_filename: 'contract.pdf', size: 2048, mime_type: 'application/pdf', created_at: '2026-10-01T10:00:00.000Z' }],
};

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function grantContributor() {
  rights.portfolio_projects = 'contributor';
  rights.portfolio_requests = 'contributor';
  rights.infrastructure = 'reader';
  rights.business_processes = 'member';
}

function installGets(base: string, data: ProjectRelationsData | RequestRelationsData) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === `${base}/relations`) return { data } as never;
    if (url === base) return { data: LINKS } as never;
    if (url === '/applications') {
      return { data: { items: [
        { id: 'app-1', name: 'SAP S/4HANA', sequential_id: 'APP-4' },
        { id: 'app-8', name: 'Billing', sequential_id: 'APP-8' },
      ] } } as never;
    }
    if (url === '/budget-lines/summary') {
      return { data: { items: [{ id: 'bl-9', item_number: 9, product_name: 'Hosting', nature: 'opex' }] } } as never;
    }
    if (url === '/business-processes/lookup') {
      return { data: { items: [{ id: 'bp-1', name: 'Order to cash' }, { id: 'bp-9', name: 'Hire to retire' }] } } as never;
    }
    return { data: { items: [] } } as never;
  });
}

function renderTab(
  entity: 'project' | 'request',
  data: ProjectRelationsData | RequestRelationsData,
  onRelationsChange = vi.fn(),
) {
  const id = entity === 'project' ? 'p-1' : 'r-1';
  const base = entity === 'project' ? `/portfolio/projects/${id}` : `/portfolio/requests/${id}`;
  installGets(base, data);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter>
            <PortfolioRelationsTab entity={entity} id={id} onRelationsChange={onRelationsChange} />
            <Location />
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return onRelationsChange;
}

describe('PortfolioRelationsTab', () => {
  beforeEach(() => {
    grantContributor();
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    mocked.delete.mockReset();
    mocked.post.mockResolvedValue({ data: { ok: true } } as never);
    mocked.delete.mockResolvedValue({ data: { ok: true } } as never);
  });

  it('shows a project sections and columns, and opens each record', async () => {
    renderTab('project', projectRelations());
    const budget = await screen.findByRole('region', { name: 'workspace.application.relations.sections.budgetLines' });
    expect(within(budget).getByText('BL-4')).toBeTruthy();
    expect(within(budget).getByText('Licences')).toBeTruthy();
    expect(within(budget).getByText('ops:budget.opex')).toBeTruthy();
    expect(within(budget).getByText('ops:budget.capex')).toBeTruthy();
    expect(within(budget).getByText('Oracle')).toBeTruthy();
    expect(within(budget).getByText('48 000')).toBeTruthy();
    expect(within(budget).getByText('12 000')).toBeTruthy();
    expect(within(budget).getByText('60 000')).toBeTruthy();
    expect(within(budget).getByText('column:planned 2026 (EUR)')).toBeTruthy();
    expect(within(budget).getByText('workspace.application.relations.total')).toBeTruthy();

    const applications = screen.getByRole('region', { name: 'workspace.application.relations.sections.applications' });
    expect(within(applications).getByText('APP-4')).toBeTruthy();
    expect(within(applications).getByText('lifecycleStatus:active')).toBeTruthy();
    expect(within(applications).getByText('High')).toBeTruthy();

    const assets = screen.getByRole('region', { name: 'workspace.application.relations.sections.assets' });
    expect(within(assets).getByText('AST-2')).toBeTruthy();
    expect(within(assets).getByText('serverKind:physical_server')).toBeTruthy();
    expect(within(assets).getByText('enums.environment.prod')).toBeTruthy();
    expect(within(assets).getByText('lifecycleStatus:active')).toBeTruthy();

    const technologies = screen.getByRole('region', { name: 'workspace.application.relations.sections.technologies' });
    expect(within(technologies).getByText('TEC-9')).toBeTruthy();
    expect(within(technologies).getByText('technologyFamily:database')).toBeTruthy();
    expect(within(technologies).getByText('pages.technologies.columns.editor')).toBeTruthy();

    const source = screen.getByRole('region', { name: 'portfolio:workspace.project.sections.sourceRequests' });
    expect(within(source).getByText('REQ-3')).toBeTruthy();
    expect(within(source).getByText('Replace the ledger')).toBeTruthy();
    expect(within(source).getByText('portfolio:statuses.request.approved')).toBeTruthy();
    expect(within(source).queryByText('workspace.application.relations.add')).toBeNull();
    expect(within(source).queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.related' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.processes' })).toBeNull();

    fireEvent.click(within(budget).getByText('Licences'));
    expect(screen.getByTestId('location')).toHaveTextContent('/ops/budget/BL-4');
    fireEvent.click(within(applications).getByText('SAP S/4HANA'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/applications/APP-4/overview');
    fireEvent.click(within(assets).getByText('sap-prd-db01'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-2/overview');
    fireEvent.click(within(technologies).getByText('Oracle Database'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/technologies/TEC-9/overview');
    fireEvent.click(within(source).getByText('Replace the ledger'));
    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio/requests/REQ-3');
  });

  it('shows a request sections, the process owner, and opens the records', async () => {
    renderTab('request', requestRelations());
    const processes = await screen.findByRole('region', { name: 'workspace.application.relations.sections.processes' });
    expect(within(processes).getByText('Order to cash')).toBeTruthy();
    expect(within(processes).getByText('Ada Lovelace')).toBeTruthy();
    expect(within(processes).getByText('Retired process')).toBeTruthy();
    expect(within(processes).getByText('—')).toBeTruthy();
    expect(within(processes).getByText('workspace.application.relations.columns.owner')).toBeTruthy();

    const resulting = screen.getByRole('region', { name: 'portfolio:workspace.request.sections.resultingProjects' });
    expect(within(resulting).getByText('PRJ-8')).toBeTruthy();
    expect(within(resulting).getByText('New billing')).toBeTruthy();
    expect(within(resulting).getByText('portfolio:statuses.project.in_progress')).toBeTruthy();
    expect(within(resulting).queryByText('workspace.application.relations.add')).toBeNull();
    expect(within(resulting).queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.technologies' })).toBeNull();
    expect(screen.getByText('60 000')).toBeTruthy();

    fireEvent.click(within(processes).getByText('Order to cash'));
    expect(screen.getByTestId('location')).toHaveTextContent('/master-data/business-processes/bp-1/overview');
    fireEvent.click(within(resulting).getByText('New billing'));
    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio/projects/PRJ-8');
  });

  it('adds an application and a budget line from the search', async () => {
    const onRelationsChange = renderTab('project', projectRelations());
    const applications = await screen.findByRole('region', { name: 'workspace.application.relations.sections.applications' });
    fireEvent.click(within(applications).getByText('workspace.application.relations.add'));
    expect(await screen.findByRole('option', { name: /Billing/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /SAP S\/4HANA/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Billing/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/portfolio/projects/p-1/relations/applications', { id: 'app-8' }));
    await waitFor(() => expect(onRelationsChange).toHaveBeenCalled());

    const budget = screen.getByRole('region', { name: 'workspace.application.relations.sections.budgetLines' });
    fireEvent.click(within(budget).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /Hosting/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/portfolio/projects/p-1/relations/budget_lines', { id: 'bl-9' }));
    expect(mocked.get).toHaveBeenCalledWith('/budget-lines/summary', expect.objectContaining({
      params: expect.objectContaining({ page: 1, limit: 30, status: 'enabled', sort: 'product_name:ASC' }),
    }));
  });

  it('adds a business process from the lookup', async () => {
    const onRelationsChange = renderTab('request', requestRelations());
    const processes = await screen.findByRole('region', { name: 'workspace.application.relations.sections.processes' });
    fireEvent.click(within(processes).getByText('workspace.application.relations.add'));
    expect(await screen.findByRole('option', { name: 'Hire to retire' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: 'Order to cash' })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: 'Hire to retire' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/portfolio/requests/r-1/relations/processes', { id: 'bp-9' }));
    await waitFor(() => expect(onRelationsChange).toHaveBeenCalled());
    expect(mocked.get).toHaveBeenCalledWith('/business-processes/lookup', expect.objectContaining({
      params: expect.objectContaining({ limit: 30 }),
    }));
  });

  it('unlinks a row at once and restores it when the server refuses', async () => {
    const onRelationsChange = renderTab('project', projectRelations());
    let reject: (error: unknown) => void = () => undefined;
    mocked.delete.mockReturnValue(new Promise((_, refuse) => { reject = refuse; }) as never);
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=SAP S/4HANA)' }));

    expect(mocked.delete).toHaveBeenCalledWith('/portfolio/projects/p-1/relations/applications/app-1');
    await waitFor(() => expect(screen.queryByText('SAP S/4HANA')).toBeNull());
    expect(onRelationsChange).not.toHaveBeenCalled();

    reject({ response: { status: 500, data: { message: 'Server down' } } });
    expect(await screen.findByText('SAP S/4HANA')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onRelationsChange).not.toHaveBeenCalled();
  });

  it('leaves a null section out and keeps an empty conversion list read only', async () => {
    renderTab('project', projectRelations({ technologies: null, source_requests: [] }));
    await screen.findByRole('region', { name: 'workspace.application.relations.sections.applications' });
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.technologies' })).toBeNull();
    const source = screen.getByRole('region', { name: 'portfolio:workspace.project.sections.sourceRequests' });
    expect(within(source).getByText('workspace.application.relations.empty.sourceRequests')).toBeTruthy();
    expect(within(source).queryByText('workspace.application.relations.add')).toBeNull();
  });

  it('leaves a null process section out', async () => {
    renderTab('request', requestRelations({ processes: null, resulting_projects: null }));
    await screen.findByRole('region', { name: 'workspace.application.relations.sections.assets' });
    expect(screen.queryByRole('region', { name: 'workspace.application.relations.sections.processes' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'portfolio:workspace.request.sections.resultingProjects' })).toBeNull();
  });

  it('lets a contributor write, and keeps Add off when the other module refuses it', async () => {
    rights.infrastructure = '';
    renderTab('project', projectRelations());
    const technologies = await screen.findByRole('region', { name: 'workspace.application.relations.sections.technologies' });
    expect(within(technologies).queryByText('workspace.application.relations.add')).toBeNull();
    expect(within(technologies).queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    const applications = screen.getByRole('region', { name: 'workspace.application.relations.sections.applications' });
    expect(within(applications).getByText('workspace.application.relations.add')).toBeTruthy();
  });

  it('shows processes to a contributor who cannot manage them, without Add', async () => {
    rights.business_processes = 'reader';
    renderTab('request', requestRelations());
    const processes = await screen.findByRole('region', { name: 'workspace.application.relations.sections.processes' });
    expect(within(processes).getByText('Order to cash')).toBeTruthy();
    expect(within(processes).queryByText('workspace.application.relations.add')).toBeNull();
    expect(within(processes).queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    const applications = screen.getByRole('region', { name: 'workspace.application.relations.sections.applications' });
    expect(within(applications).getByText('workspace.application.relations.add')).toBeTruthy();
  });

  it('offers a request links and files to a member only, as the server writes them', async () => {
    renderTab('request', requestRelations());
    await screen.findByRole('region', { name: 'workspace.application.relations.sections.processes' });
    const applications = screen.getByRole('region', { name: 'workspace.application.relations.sections.applications' });
    expect(within(applications).getByText('workspace.application.relations.add')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'linksAndFiles.addLink' })).toBeNull();
    expect(screen.queryByLabelText('linksAndFiles.attachFile')).toBeNull();
  });

  it('offers a request links and files to a member', async () => {
    rights.portfolio_requests = 'member';
    renderTab('request', requestRelations());
    expect(await screen.findByRole('button', { name: 'linksAndFiles.addLink' })).toBeTruthy();
  });

  it('gives a reader the tables and the navigation only', async () => {
    rights.portfolio_projects = 'reader';
    rights.portfolio_requests = 'reader';
    renderTab('project', projectRelations());
    await screen.findByText('SAP S/4HANA');
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'linksAndFiles.addLink' })).toBeNull();
    expect(screen.queryByLabelText('linksAndFiles.attachFile')).toBeNull();
    fireEvent.click(screen.getByText('Replace the ledger'));
    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio/requests/REQ-3');
  });

  it('saves a project link by replacing the list, and deletes a file after confirmation', async () => {
    const onRelationsChange = renderTab('project', projectRelations());
    expect(await screen.findByText('Vendor portal')).toBeTruthy();
    expect(screen.getByText('me.example.com')).toBeTruthy();
    expect(screen.getByText('contract.pdf')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.addLink' }));
    fireEvent.change(await screen.findByLabelText('linksAndFiles.columns.name'), { target: { value: 'Status page' } });
    fireEvent.change(screen.getByLabelText('linksAndFiles.url'), { target: { value: ' https://status.example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.add' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/portfolio/projects/p-1/urls', {
      urls: [
        { url: 'https://me.example.com', label: 'Vendor portal' },
        { url: 'https://status.example.com', label: 'Status page' },
      ],
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onRelationsChange).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.editLinkNamed(name=Vendor portal)' }));
    fireEvent.change(await screen.findByLabelText('linksAndFiles.columns.name'), { target: { value: 'Vendor desk' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/portfolio/projects/p-1/urls', {
      urls: [{ url: 'https://me.example.com', label: 'Vendor desk' }],
    }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.removeFileNamed(name=contract.pdf)' }));
    expect(mocked.delete).not.toHaveBeenCalled();
    expect(await screen.findByText('workspace.application.relations.deleteAttachment(name=contract.pdf)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/portfolio/projects/p-1/attachments/a-1'));
  });

  it('offers to put a removed web link back with the same name and URL', async () => {
    renderTab('project', projectRelations());
    expect(await screen.findByText('Vendor portal')).toBeTruthy();
    let removed = false;
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/projects/p-1/relations') return { data: projectRelations() } as never;
      if (url === '/portfolio/projects/p-1') return { data: removed ? { ...LINKS, urls: [] } : LINKS } as never;
      return { data: { items: [] } } as never;
    });
    mocked.post.mockImplementation(async (url: string) => {
      if (url === '/portfolio/projects/p-1/urls') removed = true;
      return { data: { ok: true } } as never;
    });

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.removeNamed(name=Vendor portal)' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/portfolio/projects/p-1/urls', { urls: [] }));
    expect(await screen.findByText('common:linksAndFiles.removed(name=Vendor portal)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.undo.undo' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/portfolio/projects/p-1/urls', {
      urls: [{ url: 'https://me.example.com', label: 'Vendor portal' }],
    }));
  });

  it('drops a link at once and restores it when the replacement is refused', async () => {
    rights.portfolio_requests = 'member'; // the server writes a request's links and files at member
    const onRelationsChange = renderTab('request', requestRelations());
    let reject: (error: unknown) => void = () => undefined;
    mocked.post.mockReturnValue(new Promise((_, refuse) => { reject = refuse; }) as never);
    fireEvent.click(await screen.findByRole('button', { name: 'linksAndFiles.removeNamed(name=Vendor portal)' }));
    await waitFor(() => expect(screen.queryByText('Vendor portal')).toBeNull());
    expect(mocked.post).toHaveBeenCalledWith('/portfolio/requests/r-1/urls', { urls: [] });
    expect(onRelationsChange).not.toHaveBeenCalled();

    reject({ response: { status: 500, data: { message: 'Server down' } } });
    expect(await screen.findByText('Vendor portal')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onRelationsChange).not.toHaveBeenCalled();
  });

  it('attaches a file and downloads it from the portfolio attachment route', async () => {
    rights.portfolio_requests = 'member'; // the server writes a request's links and files at member
    const onRelationsChange = renderTab('request', requestRelations());
    const createObjectURL = vi.fn(() => 'blob:file');
    const revokeObjectURL = vi.fn();
    vi.spyOn(URL, 'createObjectURL').mockImplementation(createObjectURL);
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(revokeObjectURL);
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/requests/r-1/relations') return { data: requestRelations() } as never;
      if (url === '/portfolio/requests/r-1') return { data: LINKS } as never;
      if (url === '/portfolio/requests/attachments/a-1') return { data: 'pdf' } as never;
      return { data: { items: [] } } as never;
    });

    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(await screen.findByLabelText('linksAndFiles.attachFile'), { target: { files: [file] } });
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/portfolio/requests/r-1/attachments', expect.any(FormData)));
    await waitFor(() => expect(onRelationsChange).toHaveBeenCalled());

    fireEvent.click(screen.getByText('contract.pdf'));
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/portfolio/requests/attachments/a-1', { responseType: 'blob' }));
  });

  it('counts the visible rows, the dependencies, and the links and files', () => {
    const project = projectRelations();
    const links = LINKS;
    expect(portfolioRelationsCount('project', undefined, links, 3)).toBeUndefined();
    // Budget lines 2, one application, one asset, one technology, one source request.
    expect(portfolioRelationsCount('project', project, undefined, 3)).toBe(6 + 3);
    expect(portfolioRelationsCount('project', project, links, 3)).toBe(6 + 3 + 2);
    expect(portfolioRelationsCount('project', projectRelations({ technologies: null, source_requests: null }), links, 0)).toBe(4 + 2);
    // Budget lines 2, one application, one asset, two processes, one resulting project.
    expect(portfolioRelationsCount('request', requestRelations(), links, 1)).toBe(7 + 1 + 2);
    expect(portfolioRelationsCount('request', requestRelations({ processes: null }), undefined, 0)).toBe(5);
    // The budget lines the section counts without listing them: outside the data access, or all without the budget right.
    expect(portfolioRelationsCount('project', projectRelations({ budget_lines_hidden: 3 }), undefined, 0)).toBe(6 + 3);
    expect(portfolioRelationsCount('request', requestRelations({ budget_lines: null, budget_lines_hidden: 4 }), undefined, 0)).toBe(5 + 4);
  });

  it('reads /relations once when the badge and the tab are mounted together', async () => {
    installGets('/portfolio/projects/p-1', projectRelations());
    function Badge() {
      const count = usePortfolioRelationsBadge('project', 'p-1', 3);
      return <div data-testid="badge">{count === undefined ? 'pending' : String(count)}</div>;
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
            <MemoryRouter>
              <Badge />
              <PortfolioRelationsTab entity="project" id="p-1" onRelationsChange={vi.fn()} />
            </MemoryRouter>
          </KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('badge')).toHaveTextContent('11'));
    const relationsGets = mocked.get.mock.calls.filter((call) => call[0] === '/portfolio/projects/p-1/relations');
    const linkGets = mocked.get.mock.calls.filter((call) => call[0] === '/portfolio/projects/p-1');
    expect(relationsGets).toHaveLength(1);
    expect(linkGets).toHaveLength(1);
  });
});
