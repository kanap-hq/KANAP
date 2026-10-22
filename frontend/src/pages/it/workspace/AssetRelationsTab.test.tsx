import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { KanapDialogProvider } from '../../../components/design';
import api from '../../../api';
import AssetRelationsTab, { type AssetRelationsData } from './AssetRelationsTab';

const rights = vi.hoisted(() => ({} as Record<string, string>));

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
vi.mock('../editors/AssetImpactSection', () => ({
  default: ({ version }: { version?: number }) => <section aria-label="impact" data-version={version ?? 0} />,
}));
vi.mock('../../../hooks/useBudgetColumns', () => ({
  default: () => ({ label: (key: string) => `column:${key}` }),
}));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ labelFor: (field: string, code?: string | null) => (code ? `${field}:${code}` : '') }),
}));
vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [] } }),
}));

const mocked = vi.mocked(api);

const asset = (id: string, reference: string, name: string, status = 'active') => ({
  id, reference, name, kind: 'virtual_machine', environment: 'prod', status,
});

function relations(overrides: Partial<AssetRelationsData> = {}): AssetRelationsData {
  return {
    year: 2026,
    budget_column: { key: 'budget', label: 'Budget' },
    assets: {
      contains: [asset('as-2', 'AST-2', 'vm-app-01')],
      contained_by: [asset('as-3', 'AST-3', 'esx-host-01')],
      depends_on: [asset('as-4', 'AST-4', 'san-01')],
      depended_on_by: [asset('as-5', 'AST-5', 'backup-01', 'retired')],
    },
    budget_lines: [{
      id: 'bl-1', item_number: 12, nature: 'opex', product_name: 'Hosting', supplier_name: 'OVH',
      amount: 1200, currency: 'EUR', status: 'enabled',
    }],
    contracts: [{
      id: 'c-1', name: 'VMware support', supplier_name: 'Broadcom', end_date: '2030-03-31',
      yearly_amount: 5000, currency: 'EUR', auto_renewal: false, in_renewal_window: false, status: 'enabled',
    }],
    projects: [{ id: 'prj-1', item_number: 4, name: 'Datacenter move', status: 'in_progress', planned_end: '2030-12-01' }],
    tasks: [{ id: 'tsk-1', item_number: 7, title: 'Patch the host', status: 'open', assignee_name: 'Ana Silva', due_date: '2030-01-15' }],
    incidents: [
      { id: 'inc-5', item_number: 5, title: 'Disk full', status: 'open', severity: 'high', detected_at: '2026-10-01T08:00:00.000Z' },
      { id: 'inc-6', item_number: 6, title: 'Old outage', status: 'closed', severity: 'low', detected_at: '2026-09-01T08:00:00.000Z' },
    ],
    counts: { total: 11 },
    ...overrides,
  };
}

const LINKS = [{ id: 'l-1', description: 'Console', url: 'https://console.example.com', created_at: '2026-10-01T10:00:00.000Z' }];
const FILES = [{ id: 'a-1', original_filename: 'rack.pdf', size: 2048, uploaded_at: '2026-10-01T10:00:00.000Z' }];

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderTab(data: AssetRelationsData, onRelationsChange = vi.fn()) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/assets/as-1/relations-tab') return { data } as never;
    if (url === '/assets/as-1/links') return { data: LINKS } as never;
    if (url === '/assets/as-1/attachments') return { data: FILES } as never;
    if (url === '/assets') {
      return { data: { items: [
        { id: 'as-1', name: 'this-server', asset_reference: 'AST-1' },
        { id: 'as-2', name: 'vm-app-01', asset_reference: 'AST-2' },
        { id: 'as-9', name: 'edge-fw', asset_reference: 'AST-9' },
      ] } } as never;
    }
    if (url === '/budget-lines/summary') {
      return { data: { items: [{ id: 'bl-9', item_number: 9, product_name: 'Backup licence', nature: 'capex' }] } } as never;
    }
    if (url === '/contracts/lookup') return { data: { items: [{ id: 'c-9', name: 'Hosting contract' }] } } as never;
    if (url === '/portfolio/projects') return { data: { items: [{ id: 'prj-9', item_number: 9, name: 'Network refresh' }] } } as never;
    if (url === '/tasks') return { data: { items: [{ id: 'tsk-9', item_number: 9, title: 'Renew certificate' }] } } as never;
    if (url === '/incidents') {
      return { data: { items: [
        { id: 'inc-9', item_number: 9, title: 'Fan failure', status: 'open' },
        { id: 'inc-10', item_number: 10, title: 'Closed one', status: 'closed' },
      ] } } as never;
    }
    return { data: [] } as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter>
            <AssetRelationsTab assetId="as-1" onRelationsChange={onRelationsChange} />
            <Location />
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onRelationsChange };
}

const A = (name: string) => `workspace.asset.relations.${name}`;
const SECTION = (name: string) => `workspace.application.relations.sections.${name}`;
const INCIDENTS = 'components.incidentRelations.title';

function grantMember() {
  for (const key of Object.keys(rights)) delete rights[key];
  Object.assign(rights, {
    infrastructure: 'member',
    budget: 'reader',
    contracts: 'reader',
    portfolio_projects: 'reader',
    tasks: 'reader',
    incidents: 'contributor',
  });
}

describe('AssetRelationsTab', () => {
  beforeEach(() => {
    grantMember();
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.patch.mockReset();
    mocked.delete.mockReset();
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    mocked.patch.mockResolvedValue({ data: { ok: true } } as never);
    mocked.delete.mockResolvedValue({ data: { ok: true, changed: true } } as never);
  });

  it('shows the impact first, then one table per type in order, and opens the record', async () => {
    renderTab(relations());
    await screen.findByText('vm-app-01');

    const labels = screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'));
    expect(labels).toEqual([
      'impact',
      A('contains'),
      A('containedBy'),
      A('dependsOn'),
      A('dependedOnBy'),
      SECTION('budgetLines'),
      SECTION('contracts'),
      SECTION('projects'),
      SECTION('tasks'),
      INCIDENTS,
      'linksAndFiles.title',
    ]);
    expect(mocked.get).toHaveBeenCalledWith('/assets/as-1/relations-tab');
    expect(mocked.get).not.toHaveBeenCalledWith('/assets/as-1/relations');

    const contains = screen.getByRole('region', { name: A('contains') });
    expect(within(contains).getByText('AST-2')).toBeTruthy();
    expect(within(contains).getByText('serverKind:virtual_machine')).toBeTruthy();
    expect(within(contains).getByText('enums.environment.prod')).toBeTruthy();
    expect(within(contains).getByText('lifecycleStatus:active')).toBeTruthy();
    expect(within(contains).getByText('pages.assets.columns.environment')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: A('containedBy') })).getByText('esx-host-01')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: A('dependsOn') })).getByText('san-01')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: A('dependedOnBy') })).getByText('backup-01')).toBeTruthy();

    const budget = screen.getByRole('region', { name: SECTION('budgetLines') });
    expect(within(budget).getByText('BL-12')).toBeTruthy();
    expect(within(budget).getByText('OVH')).toBeTruthy();
    expect(within(budget).getByText('column:budget 2026 (EUR)')).toBeTruthy();
    const contracts = screen.getByRole('region', { name: SECTION('contracts') });
    expect(within(contracts).getByText('5 000 EUR')).toBeTruthy();
    const projects = screen.getByRole('region', { name: SECTION('projects') });
    expect(within(projects).getByText('PRJ-4')).toBeTruthy();
    const tasks = screen.getByRole('region', { name: SECTION('tasks') });
    expect(within(tasks).getByText('T-7')).toBeTruthy();
    expect(within(tasks).getByText('Ana Silva')).toBeTruthy();
    expect(within(tasks).getByText('portfolio:statuses.task.open')).toBeTruthy();
    const incidents = screen.getByRole('region', { name: INCIDENTS });
    expect(within(incidents).getByText('INC-5')).toBeTruthy();
    expect(within(incidents).getByText('enums.incidentSeverity.high')).toBeTruthy();

    fireEvent.click(within(screen.getByRole('region', { name: A('containedBy') })).getByText('esx-host-01'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-3/overview');
    fireEvent.click(within(budget).getByText('Hosting'));
    expect(screen.getByTestId('location')).toHaveTextContent('/ops/budget/BL-12');
    fireEvent.click(within(contracts).getByText('VMware support'));
    expect(screen.getByTestId('location')).toHaveTextContent('/ops/contracts/c-1/overview');
    fireEvent.click(within(projects).getByText('Datacenter move'));
    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio/projects/PRJ-4');
    fireEvent.click(within(tasks).getByText('Patch the host'));
    expect(screen.getByTestId('location')).toHaveTextContent('/portfolio/tasks/T-7');
    fireEvent.click(within(incidents).getByText('Disk full'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/incidents/INC-5/overview');
  });

  it('adds in each direction and each type, without the asset itself or the rows already linked', async () => {
    const { onRelationsChange } = renderTab(relations());
    const pick = async (section: string, option: RegExp, kind: string, id: string) => {
      const region = await screen.findByRole('region', { name: section });
      fireEvent.click(within(region).getByText('workspace.application.relations.add'));
      fireEvent.click(await screen.findByRole('option', { name: option }));
      await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(`/assets/as-1/relations/${kind}`, { id }));
    };

    await screen.findByText('vm-app-01');
    const contains = screen.getByRole('region', { name: A('contains') });
    fireEvent.click(within(contains).getByText('workspace.application.relations.add'));
    expect(await screen.findByRole('option', { name: /edge-fw/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /this-server/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /vm-app-01/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /edge-fw/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/relations/contains', { id: 'as-9' }));
    await waitFor(() => expect(screen.getByRole('region', { name: 'impact' })).toHaveAttribute('data-version', '1'));

    await pick(A('containedBy'), /edge-fw/, 'contained_by', 'as-9');
    await pick(A('dependsOn'), /edge-fw/, 'depends_on', 'as-9');
    await pick(A('dependedOnBy'), /edge-fw/, 'depended_on_by', 'as-9');
    await pick(SECTION('budgetLines'), /Backup licence/, 'budget_lines', 'bl-9');
    await pick(SECTION('contracts'), /Hosting contract/, 'contracts', 'c-9');
    await pick(SECTION('projects'), /Network refresh/, 'projects', 'prj-9');
    await pick(SECTION('tasks'), /Renew certificate/, 'tasks', 'tsk-9');

    const incidents = screen.getByRole('region', { name: INCIDENTS });
    fireEvent.click(within(incidents).getByText('workspace.application.relations.add'));
    expect(await screen.findByRole('option', { name: /Fan failure/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /Closed one/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /Fan failure/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/relations/incidents', { id: 'inc-9' }));
    expect(onRelationsChange).toHaveBeenCalled();
  });

  it('unlinks an asset relation at once and restores it when the server refuses', async () => {
    const { onRelationsChange } = renderTab(relations());
    let reject: (error: unknown) => void = () => undefined;
    mocked.delete.mockReturnValue(new Promise((_, next) => { reject = next; }) as never);
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=san-01)' }));

    expect(mocked.delete).toHaveBeenCalledWith('/assets/as-1/relations/depends_on/as-4');
    await waitFor(() => expect(screen.queryByText('san-01')).toBeNull());
    expect(screen.getByText('vm-app-01')).toBeTruthy();

    reject({ response: { status: 500, data: { message: 'Server down' } } });
    expect(await screen.findByText('san-01')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(onRelationsChange).not.toHaveBeenCalled();
  });

  it('unlinks a task and keeps a closed incident', async () => {
    const { onRelationsChange } = renderTab(relations());
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=Patch the host)' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/assets/as-1/relations/tasks/tsk-1'));
    await waitFor(() => expect(onRelationsChange).toHaveBeenCalled());

    const incidents = screen.getByRole('region', { name: INCIDENTS });
    expect(within(incidents).getByRole('button', { name: 'workspace.application.relations.remove(name=Disk full)' })).toBeTruthy();
    expect(within(incidents).queryByRole('button', { name: 'workspace.application.relations.remove(name=Old outage)' })).toBeNull();
  });

  it('leaves a null section out', async () => {
    renderTab(relations({ budget_lines: null, contracts: null, projects: null, tasks: null, incidents: null }));
    await screen.findByText('vm-app-01');
    for (const name of [SECTION('budgetLines'), SECTION('contracts'), SECTION('projects'), SECTION('tasks'), INCIDENTS]) {
      expect(screen.queryByRole('region', { name })).toBeNull();
    }
    expect(screen.getByRole('region', { name: A('dependedOnBy') })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'linksAndFiles.title' })).toBeTruthy();
  });

  it('hides Add where the caller cannot read the module or edit incidents', async () => {
    rights.contracts = '';
    rights.incidents = 'reader';
    renderTab(relations());
    await screen.findByText('vm-app-01');
    const contracts = screen.getByRole('region', { name: SECTION('contracts') });
    expect(within(contracts).queryByText('workspace.application.relations.add')).toBeNull();
    expect(within(contracts).queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    const incidents = screen.getByRole('region', { name: INCIDENTS });
    expect(within(incidents).queryByText('workspace.application.relations.add')).toBeNull();
    expect(within(incidents).queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(within(screen.getByRole('region', { name: SECTION('projects') })).getByText('workspace.application.relations.add')).toBeTruthy();
  });

  it('gives a reader the tables and the navigation only', async () => {
    rights.infrastructure = 'reader';
    renderTab(relations());
    await screen.findByText('vm-app-01');
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'linksAndFiles.addLink' })).toBeNull();
    expect(screen.queryByLabelText('linksAndFiles.attachFile')).toBeNull();
    expect(screen.getByRole('region', { name: 'impact' })).toBeTruthy();
    fireEvent.click(screen.getByText('san-01'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-4/overview');
  });

  it('saves a web link at once and deletes a file only after confirmation', async () => {
    const { onRelationsChange } = renderTab(relations());
    expect(await screen.findByText('Console')).toBeTruthy();
    expect(screen.getByText('rack.pdf')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.addLink' }));
    fireEvent.change(await screen.findByLabelText('linksAndFiles.columns.name'), { target: { value: 'Status page' } });
    fireEvent.change(screen.getByLabelText('linksAndFiles.url'), { target: { value: ' https://status.example.com ' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.add' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/links', { url: 'https://status.example.com', description: 'Status page' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onRelationsChange).toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.editLinkNamed(name=Console)' }));
    fireEvent.change(await screen.findByLabelText('linksAndFiles.url'), { target: { value: 'https://admin.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/assets/as-1/links/l-1', { url: 'https://admin.example.com', description: 'Console' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.removeNamed(name=Console)' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/assets/as-1/links/l-1'));

    fireEvent.click(screen.getByRole('button', { name: 'linksAndFiles.removeNamed(name=rack.pdf)' }));
    expect(mocked.patch).not.toHaveBeenCalledWith('/assets/attachments/a-1/delete', {});
    expect(await screen.findByText('workspace.asset.relations.deleteAttachmentConfirm(name=rack.pdf)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/assets/attachments/a-1/delete', {}));
  });

  it('attaches a file', async () => {
    const { onRelationsChange } = renderTab(relations());
    const file = new File(['x'], 'notes.txt', { type: 'text/plain' });
    fireEvent.change(await screen.findByLabelText('linksAndFiles.attachFile'), { target: { files: [file] } });
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/attachments', expect.any(FormData)));
    await waitFor(() => expect(onRelationsChange).toHaveBeenCalled());
  });
});
