import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { NotifyProvider } from '../../../components/notify/NotifyProvider';
import { KanapDialogProvider } from '../../../components/design';
import api from '../../../api';
import type {
  ApplicationRelationRow,
  AssetRelationRow,
  ContractRow,
  ProjectRow,
  TechnologyRelationRow,
} from '../../../components/workspace/relations';
import type { LineType } from '../../../constants/lineTypeUsage';
import { BUDGET_NATURE_CONFIG } from '../natureConfig';
import BudgetLineRelationsTab from './BudgetLineRelationsTab';

const rights = vi.hoisted(() => ({
  budget: 'member',
  portfolio_projects: 'reader',
  applications: 'reader',
  infrastructure: 'reader',
  contracts: 'reader',
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
vi.mock('../../../components/contacts/ItemContactsSection', () => ({
  default: ({ itemType, canManage }: { itemType: string; canManage: boolean }) => (
    <div data-testid="contacts" data-type={itemType} data-manage={canManage ? 'yes' : 'no'} />
  ),
}));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ labelFor: (field: string, code?: string | null) => (code ? `${field}:${code}` : '') }),
}));
vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [{ code: 'high', label: 'High' }] } }),
}));

const mocked = vi.mocked(api);

type Suggestion = {
  type: 'application' | 'contract';
  id: string;
  reference: string | null;
  name: string;
  via: { kind: 'same_supplier'; label: null };
};

type Relations = {
  projects: ProjectRow[] | null;
  applications: ApplicationRelationRow[] | null;
  technologies: TechnologyRelationRow[] | null;
  contracts: ContractRow[] | null;
  assets: AssetRelationRow[] | null;
  suggestions: Suggestion[];
};

function relations(overrides: Partial<Relations> = {}): Relations {
  return {
    projects: [
      { id: 'prj-1', item_number: 4, name: 'Ledger migration', status: 'in_progress', planned_end: '2030-12-01' },
    ],
    applications: [
      { id: 'app-1', reference: 'APP-4', name: 'SAP S/4HANA', lifecycle: 'active', business_criticality: 'high', status: 'enabled' },
      { id: 'app-2', reference: 'APP-9', name: 'Legacy CRM', lifecycle: 'retired', business_criticality: null, status: 'disabled' },
    ],
    technologies: [
      { id: 'tec-1', reference: 'TEC-9', name: 'Oracle Database', family: 'database', vendor: 'Oracle' },
      { id: 'tec-2', reference: 'TEC-3', name: 'Tomcat', family: 'runtime', vendor: null },
    ],
    contracts: [
      {
        id: 'c-1', name: 'Oracle support', supplier_name: 'Oracle', end_date: '2030-03-31',
        yearly_amount: 12000, currency: 'EUR', auto_renewal: true, in_renewal_window: true, status: 'enabled',
      },
    ],
    assets: [
      { id: 'as-1', reference: 'AST-2', name: 'sap-prd-db01', kind: 'physical_server', environment: 'prod', status: 'active' },
      { id: 'as-2', reference: 'AST-8', name: 'old-printer', kind: 'virtual_machine', environment: 'test', status: 'retired' },
    ],
    suggestions: [
      { type: 'application', id: 'app-7', reference: 'APP-7', name: 'Payroll', via: { kind: 'same_supplier', label: null } },
      { type: 'contract', id: 'c-7', reference: null, name: 'Payroll contract', via: { kind: 'same_supplier', label: null } },
    ],
    ...overrides,
  };
}

const LINKS = [{ id: 'l-1', description: 'Vendor portal', url: 'https://me.example.com', created_at: '2026-10-01T10:00:00.000Z' }];
const FILES = [{ id: 'a-1', original_filename: 'contract.pdf', size: 2048, uploaded_at: '2026-10-01T10:00:00.000Z' }];

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function grantMember() {
  rights.budget = 'member';
  rights.portfolio_projects = 'reader';
  rights.applications = 'reader';
  rights.infrastructure = 'reader';
  rights.contracts = 'reader';
}

function renderTab(nature: LineType, data: Relations, onRelationsChange = vi.fn(), lineEditable?: boolean) {
  const itemsApi = BUDGET_NATURE_CONFIG[nature].itemsApi;
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/budget-lines/line-1/relations') return { data } as never;
    if (url === `${itemsApi}/line-1/links`) return { data: LINKS } as never;
    if (url === `${itemsApi}/line-1/attachments`) return { data: FILES } as never;
    if (url === '/portfolio/projects') {
      return { data: { items: [
        { id: 'prj-1', item_number: 4, name: 'Ledger migration' },
        { id: 'prj-8', item_number: 8, name: 'Billing platform' },
      ] } } as never;
    }
    if (url === '/applications') {
      return { data: { items: [
        { id: 'app-1', name: 'SAP S/4HANA', sequential_id: 'APP-4' },
        { id: 'app-8', name: 'Billing', sequential_id: 'APP-8' },
      ] } } as never;
    }
    if (url === '/technologies/lookup') {
      return { data: { items: [
        { id: 'tec-1', name: 'Oracle Database', reference: 'TEC-9', editor: 'Oracle' },
        { id: 'tec-8', name: 'Nginx', reference: 'TEC-8', editor: 'F5' },
      ] } } as never;
    }
    if (url === '/contracts/lookup') {
      return { data: { items: [
        { id: 'c-1', name: 'Oracle support' },
        { id: 'c-8', name: 'Hosting' },
      ] } } as never;
    }
    if (url === '/budget-lines/line-1/contract-consistency') {
      return { data: { items: [
        { id: 'c-8', mismatches: [{ field: 'supplier', line_value: 'Dairy One', contract_value: 'Dairy Two' }] },
      ] } } as never;
    }
    if (url === '/assets') {
      return { data: { items: [
        { id: 'as-1', name: 'sap-prd-db01', asset_reference: 'AST-2' },
        { id: 'as-8', name: 'edge-fw', asset_reference: 'AST-8' },
      ] } } as never;
    }
    return { data: [] } as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <NotifyProvider>
        <KanapDialogProvider>
          <MemoryRouter>
            <BudgetLineRelationsTab lineId="line-1" nature={nature} onRelationsChange={onRelationsChange} lineEditable={lineEditable} />
            <Location />
          </MemoryRouter>
        </KanapDialogProvider>
        </NotifyProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onRelationsChange, itemsApi };
}

const COL = (name: string) => `workspace.application.relations.columns.${name}`;
const SECTION = (name: string) => `workspace.application.relations.sections.${name}`;

describe.each(['opex', 'capex'] as const)('BudgetLineRelationsTab %s', (nature) => {
  const contactsType = nature === 'opex' ? 'spend-items' : 'capex-items';

  beforeEach(() => {
    grantMember();
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    mocked.delete.mockReset();
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    mocked.patch.mockResolvedValue({ data: { ok: true } } as never);
    mocked.delete.mockResolvedValue({ data: { ok: true } } as never);
  });

  it('shows one table per type, in order, and opens the record', async () => {
    renderTab(nature, relations());
    await screen.findByText('Ledger migration');

    const labels = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(labels).toEqual([
      SECTION('projects'),
      SECTION('applications'),
      SECTION('technologies'),
      SECTION('contracts'),
      SECTION('assets'),
      SECTION('related'),
      'linksAndFiles.title',
    ]);

    const projects = screen.getByRole('region', { name: SECTION('projects') });
    expect(within(projects).getByText('PRJ-4')).toBeTruthy();
    expect(within(projects).getByText('Ledger migration')).toBeTruthy();
    expect(within(projects).getByText('portfolio:statuses.project.in_progress')).toBeTruthy();
    expect(within(projects).getByText('1 Dec 2030')).toBeTruthy();
    expect(within(projects).getByText(COL('plannedEnd'))).toBeTruthy();

    const applications = screen.getByRole('region', { name: SECTION('applications') });
    expect(within(applications).getByText('APP-4')).toBeTruthy();
    expect(within(applications).getByText('SAP S/4HANA')).toBeTruthy();
    expect(within(applications).getByText('lifecycleStatus:active')).toBeTruthy();
    expect(within(applications).getByText('High')).toBeTruthy();
    expect(within(applications).getByText('Legacy CRM')).toBeTruthy();
    expect(within(applications).getByText('—')).toBeTruthy();
    expect(within(applications).getByText('common.lifecycle')).toBeTruthy();
    expect(within(applications).getByText('classification.business_criticality')).toBeTruthy();

    const technologies = screen.getByRole('region', { name: SECTION('technologies') });
    expect(within(technologies).getByText('TEC-9')).toBeTruthy();
    expect(within(technologies).getByText('Oracle Database')).toBeTruthy();
    expect(within(technologies).getByText('technologyFamily:database')).toBeTruthy();
    expect(within(technologies).getByText('Oracle')).toBeTruthy();
    expect(within(technologies).getByText('Tomcat')).toBeTruthy();
    expect(within(technologies).getByText('—')).toBeTruthy();
    expect(within(technologies).getByText('pages.technologies.columns.editor')).toBeTruthy();

    const contracts = screen.getByRole('region', { name: SECTION('contracts') });
    expect(within(contracts).getByText('Oracle support')).toBeTruthy();
    expect(within(contracts).getByText('Oracle')).toBeTruthy();
    expect(within(contracts).getByText('31 Mar 2030')).toBeTruthy();
    expect(within(contracts).getByText('12 000 EUR')).toBeTruthy();
    expect(within(contracts).getByText('workspace.application.relations.renewal.tacit')).toBeTruthy();
    expect(within(contracts).getByText(COL('yearlyAmount'))).toBeTruthy();
    expect(within(contracts).getByText(COL('renewal'))).toBeTruthy();

    const assets = screen.getByRole('region', { name: SECTION('assets') });
    expect(within(assets).getByText('AST-2')).toBeTruthy();
    expect(within(assets).getByText('sap-prd-db01')).toBeTruthy();
    expect(within(assets).getByText('serverKind:physical_server')).toBeTruthy();
    expect(within(assets).getByText('enums.environment.prod')).toBeTruthy();
    expect(within(assets).getByText('lifecycleStatus:active')).toBeTruthy();
    expect(within(assets).getByText('old-printer')).toBeTruthy();
    expect(within(assets).getByText('pages.assets.columns.environment')).toBeTruthy();

    const related = screen.getByRole('region', { name: SECTION('related') });
    expect(within(related).getByText('APP-7')).toBeTruthy();
    expect(within(related).getByText('Payroll')).toBeTruthy();
    expect(within(related).getByText('Payroll contract')).toBeTruthy();
    expect(within(related).getByText('workspace.application.relations.types.application')).toBeTruthy();
    expect(within(related).getByText('workspace.application.relations.types.contract')).toBeTruthy();

    expect(screen.getByTestId('contacts')).toHaveAttribute('data-type', contactsType);
    expect(screen.getByTestId('contacts')).toHaveAttribute('data-manage', 'yes');

    fireEvent.click(within(projects).getByText('Ledger migration'));
    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio/projects/PRJ-4');
    fireEvent.click(within(applications).getByText('SAP S/4HANA'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/applications/APP-4/overview');
    fireEvent.click(within(technologies).getByText('Oracle Database'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/technologies/TEC-9/overview');
    fireEvent.click(within(contracts).getByText('Oracle support'));
    expect(screen.getByTestId('location')).toHaveTextContent('/ops/contracts/c-1/overview');
    fireEvent.click(within(assets).getByText('sap-prd-db01'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-2/overview');
    fireEvent.click(within(related).getByText('Payroll contract'));
    expect(screen.getByTestId('location')).toHaveTextContent('/ops/contracts/c-7/overview');
  });

  it('marks a linked contract that differs, and a picker candidate', async () => {
    const base = relations();
    renderTab(nature, relations({
      contracts: [{
        ...base.contracts![0],
        mismatches: [{ field: 'paying_company', line_value: 'Fromage SA', contract_value: 'Fromage Italia' }],
      }],
    }));
    const contracts = await screen.findByRole('region', { name: SECTION('contracts') });
    const mark = within(contracts).getByTestId('contract-line-mismatch');
    expect(mark.getAttribute('aria-label')).toContain('line=Fromage SA');
    expect(mark.getAttribute('aria-label')).toContain('contract=Fromage Italia');
    fireEvent.mouseOver(mark);
    const tip = await screen.findByRole('tooltip');
    expect(tip).toHaveTextContent('Fromage SA');
    expect(tip).toHaveTextContent('Fromage Italia');
    fireEvent.mouseOut(mark);

    fireEvent.click(within(contracts).getByText('workspace.application.relations.add'));
    const option = await screen.findByRole('option', { name: /Hosting/ });
    const candidate = within(option).getByTestId('contract-line-mismatch');
    expect(candidate.getAttribute('aria-label')).toContain('line=Dairy One');
    expect(candidate.getAttribute('aria-label')).toContain('contract=Dairy Two');
    fireEvent.mouseOver(candidate);
    const pickerTip = await screen.findByRole('tooltip');
    expect(pickerTip).toHaveTextContent('Dairy One');
    expect(pickerTip).toHaveTextContent('Dairy Two');
    expect(mocked.get).toHaveBeenCalledWith('/budget-lines/line-1/contract-consistency', expect.objectContaining({
      params: { ids: 'c-1,c-8' },
    }));
  });

  it('adds from each picker and leaves out the rows already linked', async () => {
    const { onRelationsChange } = renderTab(nature, relations());
    const pick = async (section: string, option: RegExp, kind: string, id: string) => {
      const region = await screen.findByRole('region', { name: SECTION(section) });
      fireEvent.click(within(region).getByText('workspace.application.relations.add'));
      fireEvent.click(await screen.findByRole('option', { name: option }));
      await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(`/budget-lines/line-1/relations/${kind}`, { id }));
    };

    const projects = await screen.findByRole('region', { name: SECTION('projects') });
    fireEvent.click(within(projects).getByText('workspace.application.relations.add'));
    expect(await screen.findByRole('option', { name: /Billing platform/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Ledger migration/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Billing platform/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/budget-lines/line-1/relations/projects', { id: 'prj-8' }));

    await pick('applications', /Billing/, 'applications', 'app-8');
    await pick('technologies', /Nginx/, 'technologies', 'tec-8');
    await pick('contracts', /Hosting/, 'contracts', 'c-8');
    await pick('assets', /edge-fw/, 'assets', 'as-8');
    expect(onRelationsChange).toHaveBeenCalled();

    expect(mocked.get).toHaveBeenCalledWith('/portfolio/projects', expect.objectContaining({
      params: expect.objectContaining({ page: 1, limit: 30, sort: 'updated_at:DESC' }),
    }));
    expect(mocked.get).toHaveBeenCalledWith('/applications', expect.objectContaining({
      params: expect.objectContaining({ page: 1, limit: 30, sort: 'name:ASC' }),
    }));
    expect(mocked.get).toHaveBeenCalledWith('/technologies/lookup', expect.objectContaining({
      params: expect.objectContaining({ limit: 30 }),
    }));
    expect(mocked.get).toHaveBeenCalledWith('/contracts/lookup', expect.objectContaining({
      params: expect.objectContaining({ limit: 30 }),
    }));
    expect(mocked.get).toHaveBeenCalledWith('/assets', expect.objectContaining({
      params: expect.objectContaining({ page: 1, limit: 30, sort: 'name:ASC' }),
    }));
  });

  it('unlinks a row at once and restores it when the server refuses', async () => {
    const { onRelationsChange } = renderTab(nature, relations());
    let reject: (error: unknown) => void = () => undefined;
    mocked.delete.mockReturnValue(new Promise((_, next) => { reject = next; }) as never);
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=Ledger migration)' }));

    expect(mocked.delete).toHaveBeenCalledWith('/budget-lines/line-1/relations/projects/prj-1');
    await waitFor(() => expect(screen.queryByText('Ledger migration')).toBeNull());
    expect(onRelationsChange).not.toHaveBeenCalled();

    reject({ response: { status: 500, data: { message: 'Server down' } } });
    expect(await screen.findByText('Ledger migration')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onRelationsChange).not.toHaveBeenCalled();
  });

  it('offers to put an unlinked application back', async () => {
    renderTab(nature, relations());
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=SAP S/4HANA)' }));
    expect(await screen.findByText('workspace.application.relations.feedback.unlinked(name=SAP S/4HANA)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.undo' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/budget-lines/line-1/relations/applications', { id: 'app-1' }));
  });

  it('links a suggestion and moves it into its section', async () => {
    const current = relations();
    const itemsApi = BUDGET_NATURE_CONFIG[nature].itemsApi;
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/budget-lines/line-1/relations') return { data: current } as never;
      if (url === `${itemsApi}/line-1/links`) return { data: LINKS } as never;
      if (url === `${itemsApi}/line-1/attachments`) return { data: FILES } as never;
      return { data: [] } as never;
    });
    mocked.post.mockImplementation(async (url: string, body?: unknown) => {
      const id = (body as { id?: string } | undefined)?.id;
      if (url === '/budget-lines/line-1/relations/applications' && id === 'app-7') {
        current.suggestions = current.suggestions.filter((row) => row.id !== 'app-7');
        current.applications = [
          ...(current.applications ?? []),
          { id: 'app-7', reference: 'APP-7', name: 'Payroll', lifecycle: 'active', business_criticality: 'high', status: 'enabled' },
        ];
      }
      if (url === '/budget-lines/line-1/relations/contracts' && id === 'c-7') {
        current.suggestions = current.suggestions.filter((row) => row.id !== 'c-7');
        current.contracts = [
          ...(current.contracts ?? []),
          {
            id: 'c-7', name: 'Payroll contract', supplier_name: 'Oracle', end_date: null,
            yearly_amount: null, currency: null, auto_renewal: false, in_renewal_window: false, status: 'enabled',
          },
        ];
      }
      return { data: { ok: true, changed: true } } as never;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
            <MemoryRouter>
              <BudgetLineRelationsTab lineId="line-1" nature={nature} onRelationsChange={vi.fn()} />
            </MemoryRouter>
          </KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );

    const related = await screen.findByRole('region', { name: SECTION('related') });
    expect(within(related).getAllByText('workspace.application.relations.via.same_supplier(label=)')).toHaveLength(2);
    fireEvent.click(within(related).getByRole('button', { name: 'workspace.application.relations.linkNamed(name=Payroll)' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/budget-lines/line-1/relations/applications', { id: 'app-7' }));
    await waitFor(() => expect(within(screen.getByRole('region', { name: SECTION('applications') })).getByText('Payroll')).toBeTruthy());
    expect(screen.getByRole('region', { name: SECTION('related') })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.relations.linkNamed(name=Payroll contract)' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/budget-lines/line-1/relations/contracts', { id: 'c-7' }));
    await waitFor(() => expect(screen.queryByRole('region', { name: SECTION('related') })).toBeNull());
    expect(within(screen.getByRole('region', { name: SECTION('contracts') })).getByText('Payroll contract')).toBeTruthy();
  });

  it('leaves a null section out', async () => {
    renderTab(nature, relations({ technologies: null, assets: null }));
    await screen.findByRole('region', { name: SECTION('projects') });
    expect(screen.queryByRole('region', { name: SECTION('technologies') })).toBeNull();
    expect(screen.queryByRole('region', { name: SECTION('assets') })).toBeNull();
    expect(screen.getByRole('region', { name: SECTION('applications') })).toBeTruthy();
    expect(screen.getByRole('region', { name: SECTION('contracts') })).toBeTruthy();
  });

  it('hides Add when the caller cannot read that module', async () => {
    rights.infrastructure = '';
    rights.contracts = '';
    renderTab(nature, relations());
    const projects = await screen.findByRole('region', { name: SECTION('projects') });
    expect(within(projects).getByText('workspace.application.relations.add')).toBeTruthy();
    const technologies = screen.getByRole('region', { name: SECTION('technologies') });
    const assets = screen.getByRole('region', { name: SECTION('assets') });
    const contracts = screen.getByRole('region', { name: SECTION('contracts') });
    expect(within(technologies).queryByText('workspace.application.relations.add')).toBeNull();
    expect(within(assets).queryByText('workspace.application.relations.add')).toBeNull();
    expect(within(contracts).queryByText('workspace.application.relations.add')).toBeNull();
    expect(within(technologies).queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(within(screen.getByRole('region', { name: SECTION('applications') })).getByText('workspace.application.relations.add')).toBeTruthy();
  });

  it('gives a reader the tables and the navigation only', async () => {
    rights.budget = 'reader';
    renderTab(nature, relations());
    await screen.findByText('SAP S/4HANA');
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.linkNamed/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'linksAndFiles.addLink' })).toBeNull();
    expect(screen.queryByLabelText('linksAndFiles.attachFile')).toBeNull();
    expect(screen.getByTestId('contacts')).toHaveAttribute('data-manage', 'no');
    fireEvent.click(screen.getByText('sap-prd-db01'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-2/overview');
  });

  it('gives a member on a line read only in their data access the tables without the write actions', async () => {
    renderTab(nature, relations(), vi.fn(), false);
    await screen.findByText('SAP S/4HANA');
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.linkNamed/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'linksAndFiles.addLink' })).toBeNull();
    expect(screen.queryByLabelText('linksAndFiles.attachFile')).toBeNull();
    expect(screen.getByTestId('contacts')).toHaveAttribute('data-manage', 'no');
  });

  it('gives a contributor the tables without the write actions', async () => {
    rights.budget = 'contributor';
    renderTab(nature, relations());
    await screen.findByText('Ledger migration');
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.linkNamed/ })).toBeNull();
    expect(screen.getByTestId('contacts')).toHaveAttribute('data-manage', 'no');
  });

  it('saves a web link at once and deletes a file only after confirmation', async () => {
    const { onRelationsChange, itemsApi } = renderTab(nature, relations());
    expect(await screen.findByText('Vendor portal')).toBeTruthy();
    expect(screen.getByText('me.example.com')).toBeTruthy();
    expect(screen.getByText('contract.pdf')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.addLink' }));
    fireEvent.change(await screen.findByLabelText('linksAndFiles.columns.name'), { target: { value: 'Status page' } });
    fireEvent.change(screen.getByLabelText('linksAndFiles.url'), { target: { value: ' https://status.example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.add' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(`${itemsApi}/line-1/links`, { url: 'https://status.example.com', description: 'Status page' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onRelationsChange).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.editLinkNamed(name=Vendor portal)' }));
    fireEvent.change(await screen.findByLabelText('linksAndFiles.url'), { target: { value: 'https://portal.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith(`${itemsApi}/line-1/links/l-1`, { url: 'https://portal.example.com', description: 'Vendor portal' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.removeNamed(name=Vendor portal)' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith(`${itemsApi}/line-1/links/l-1`));

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.removeFileNamed(name=contract.pdf)' }));
    expect(mocked.patch).not.toHaveBeenCalledWith(`${itemsApi}/attachments/a-1/delete`, {});
    expect(await screen.findByText('ops:confirmations.deleteAttachment(name=contract.pdf)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith(`${itemsApi}/attachments/a-1/delete`, {}));
  });

  it('offers to put a removed web link back with the same name and URL', async () => {
    const { itemsApi } = renderTab(nature, relations());
    fireEvent.click(await screen.findByRole('button', { name: 'linksAndFiles.removeNamed(name=Vendor portal)' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith(`${itemsApi}/line-1/links/l-1`));
    expect(await screen.findByText('common:linksAndFiles.removed(name=Vendor portal)')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'buttons.undo' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(`${itemsApi}/line-1/links`, {
      description: 'Vendor portal',
      url: 'https://me.example.com',
    }));
  });

  it('attaches a file', async () => {
    const { onRelationsChange, itemsApi } = renderTab(nature, relations());
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(await screen.findByLabelText('linksAndFiles.attachFile'), { target: { files: [file] } });
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(`${itemsApi}/line-1/attachments`, expect.any(FormData)));
    await waitFor(() => expect(onRelationsChange).toHaveBeenCalled());
  });
});
