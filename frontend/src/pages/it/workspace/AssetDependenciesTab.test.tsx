import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { NotifyProvider } from '../../../components/notify/NotifyProvider';
import api from '../../../api';
import AssetDependenciesTab from './AssetDependenciesTab';
import { ApplicationFeedbackProvider } from '../applicationFeedback';
import { assetRelationsKey, type AssetRelationsData } from './assetRelationsData';

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
  default: ({ assetId }: { assetId: string }) => <section aria-label="impact" data-asset={assetId} />,
}));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ labelFor: (field: string, code?: string | null) => (code ? `${field}:${code}` : '') }),
}));

const mocked = vi.mocked(api);

const asset = (id: string, reference: string, name: string, status = 'active') => ({
  id, reference, name, kind: 'virtual_machine', environment: 'prod', status,
});

function relations(): AssetRelationsData {
  return {
    year: 2026,
    budget_column: { key: 'budget', label: 'Budget' },
    assets: {
      contains: [asset('as-2', 'AST-2', 'vm-app-01')],
      contained_by: [asset('as-3', 'AST-3', 'esx-host-01')],
      depends_on: [asset('as-4', 'AST-4', 'san-01')],
      depended_on_by: [asset('as-5', 'AST-5', 'backup-01', 'retired')],
    },
    budget_lines: [],
    contracts: [],
    projects: [],
    tasks: [],
    incidents: [],
    counts: { assets: 4, total: 0 },
  };
}

/** A cluster: one dependency of its own, and two carried by its members (folded). */
function clusterRelations(): AssetRelationsData {
  const data = relations();
  data.assets.contains = [];
  data.assets.contained_by = [];
  data.assets.depends_on = [asset('as-6', 'AST-6', 'backup-01')];
  data.assets.depended_on_by = [];
  data.assets.depends_on_through_members = [
    {
      ...asset('as-4', 'AST-4', 'san-01'),
      via: [
        { id: 'as-3', name: 'esx-host-01' },
        { id: 'as-7', name: 'esx-host-02' },
      ],
    },
    {
      ...asset('as-8', 'AST-8', 'nas-02'),
      via: [{ id: 'as-7', name: 'esx-host-02' }],
    },
  ];
  data.counts = { assets: 1, total: 0 };
  return data;
}

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

type AssetRef = { id: string; name: string; status?: string };

type TabOptions = {
  relations?: AssetRelationsData;
  clusters?: Record<string, AssetRef[]>;
  members?: Record<string, AssetRef[]>;
  incoming?: Record<string, Array<{ asset_id: string; relation_type: string }>>;
};

function renderTab({ relations: data = relations(), clusters = {}, members = {}, incoming = {} }: TabOptions = {}) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/assets/as-1/relations-tab') return { data } as never;
    if (url === '/assets') {
      return { data: { items: [
        { id: 'as-1', name: 'this-server', asset_reference: 'AST-1' },
        { id: 'as-2', name: 'vm-app-01', asset_reference: 'AST-2' },
        { id: 'as-9', name: 'edge-fw', asset_reference: 'AST-9' },
      ] } } as never;
    }
    const relationsMatch = /^\/assets\/(.+)\/relations$/.exec(url);
    if (relationsMatch) return { data: { outgoing: [], incoming: incoming[relationsMatch[1]] ?? [] } } as never;
    const clusterMatch = /^\/assets\/(.+)\/clusters$/.exec(url);
    if (clusterMatch) return { data: { items: clusters[clusterMatch[1]] ?? [] } } as never;
    const memberMatch = /^\/assets\/(.+)\/members$/.exec(url);
    if (memberMatch) return { data: { items: members[memberMatch[1]] ?? [] } } as never;
    return { data: [] } as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <NotifyProvider>
        <MemoryRouter>
          <ApplicationFeedbackProvider onError={() => undefined}>
            <AssetDependenciesTab assetId="as-1" />
            <Location />
          </ApplicationFeedbackProvider>
        </MemoryRouter>
        </NotifyProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  const invalidated = (key: readonly unknown[]) =>
    invalidate.mock.calls.some(([filters]) => JSON.stringify(filters?.queryKey) === JSON.stringify(key));
  return { client, invalidated };
}

const A = (name: string) => `workspace.asset.relations.${name}`;

describe('AssetDependenciesTab', () => {
  beforeEach(() => {
    for (const key of Object.keys(rights)) delete rights[key];
    Object.assign(rights, { infrastructure: 'member' });
    mocked.get.mockReset();
    mocked.post.mockReset();
    mocked.delete.mockReset();
    mocked.post.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    mocked.delete.mockResolvedValue({ data: { ok: true, changed: true } } as never);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('shows the impact, then the four directions in order', async () => {
    renderTab();
    await screen.findByText('vm-app-01');

    expect(screen.getAllByRole('region').map((region) => region.getAttribute('aria-label'))).toEqual([
      'impact', A('contains'), A('containedBy'), A('dependsOn'), A('dependedOnBy'),
    ]);
    expect(mocked.get).toHaveBeenCalledWith('/assets/as-1/relations-tab');

    const contains = screen.getByRole('region', { name: A('contains') });
    expect(within(contains).getByText('AST-2')).toBeTruthy();
    expect(within(contains).getByText('serverKind:virtual_machine')).toBeTruthy();
    expect(within(contains).getByText('enums.environment.prod')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: A('containedBy') })).getByText('esx-host-01')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: A('dependsOn') })).getByText('san-01')).toBeTruthy();
    expect(within(screen.getByRole('region', { name: A('dependedOnBy') })).getByText('backup-01')).toBeTruthy();

    fireEvent.click(within(screen.getByRole('region', { name: A('containedBy') })).getByText('esx-host-01'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-3/overview');
  });

  it('folds what the members of a cluster depend on, closed first and opened on click', async () => {
    renderTab({ relations: clusterRelations() });
    await screen.findByText('backup-01');
    const region = screen.getByRole('region', { name: A('dependsOn') });
    const toggle = within(region).getByRole('button', { name: 'workspace.asset.relations.throughMembers(count=2)' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(within(region).queryByText('san-01')).toBeNull();
    // The section count and the Dependencies badge count the direct rows only.
    expect(within(region).getByText('1')).toBeTruthy();

    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(within(region).getByText('san-01')).toBeTruthy();
    expect(within(region).getByText('nas-02')).toBeTruthy();
    expect(within(region).getByText('esx-host-01')).toBeTruthy();
    expect(within(region).getAllByText('esx-host-02')).toHaveLength(2);
    expect(within(region).getByText('workspace.asset.relations.via')).toBeTruthy();
    // A carried dependency has no action of its own.
    expect(within(region).queryByRole('button', { name: /relations\.remove/ })).toBeTruthy();
    expect(within(region).queryByRole('button', { name: /san-01|nas-02/ })).toBeNull();

    fireEvent.click(within(region).getByText('san-01'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-4/overview');
  });

  it('shows the folded line of a cluster whose only dependencies come from its members', async () => {
    const data = clusterRelations();
    data.assets.depends_on = [];
    data.counts.assets = 0;
    renderTab({ relations: data });
    const region = screen.getByRole('region', { name: A('dependsOn') });
    const toggle = await within(region).findByRole('button', { name: 'workspace.asset.relations.throughMembers(count=2)' });
    expect(within(region).queryByText('workspace.asset.relations.empty.dependsOn')).toBeNull();
    expect(within(region).queryByText('workspace.asset.relations.via')).toBeNull();
    fireEvent.click(toggle);
    expect(within(region).getByText('workspace.asset.relations.via')).toBeTruthy();
    expect(within(region).getByText('san-01')).toBeTruthy();
  });

  it('adds no folded line or Via column on a server', async () => {
    renderTab();
    await screen.findByText('san-01');
    expect(screen.queryByRole('button', { name: /throughMembers/ })).toBeNull();
    expect(screen.queryByText('workspace.asset.relations.via')).toBeNull();
  });

  it('keeps the Via column of the folded line at a narrow width, where the environment hides', async () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
      return this.tagName === 'DIV' ? 500 : 0;
    });
    renderTab({ relations: clusterRelations() });
    await screen.findByText('backup-01');
    const region = screen.getByRole('region', { name: A('dependsOn') });
    fireEvent.click(within(region).getByRole('button', { name: 'workspace.asset.relations.throughMembers(count=2)' }));
    expect(within(region).getByText('workspace.asset.relations.via')).toBeTruthy();
    expect(within(region).getByText('esx-host-01')).toBeTruthy();
    expect(within(region).queryByText('enums.environment.prod')).toBeNull();
  });

  it('explains Contains in a tooltip on its title, and no other direction', async () => {
    renderTab();
    await screen.findByText('vm-app-01');
    const contains = screen.getByRole('region', { name: A('contains') });
    expect(within(contains).getByLabelText('workspace.asset.relations.containsHint')).toBeTruthy();
    expect(screen.getAllByLabelText('workspace.asset.relations.containsHint')).toHaveLength(1);
  });

  it('links in each direction without offering the asset itself or a row already linked, and reads the relations and the impact of every asset again', async () => {
    const { invalidated } = renderTab();
    await screen.findByText('vm-app-01');
    expect(invalidated(['asset-impact'])).toBe(false);

    fireEvent.click(within(screen.getByRole('region', { name: A('contains') })).getByText('workspace.application.relations.add'));
    expect(await screen.findByRole('option', { name: /edge-fw/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /this-server/ })).toBeNull();
    expect(screen.queryByRole('option', { name: /vm-app-01/ })).toBeNull();
    fireEvent.click(screen.getByRole('option', { name: /edge-fw/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/relations/contains', { id: 'as-9' }));
    await waitFor(() => expect(invalidated(['asset-impact'])).toBe(true));
    // The other asset of the relation reads its relations again too.
    expect(invalidated(['asset-relations-tab'])).toBe(true);
    expect(invalidated(assetRelationsKey('as-1'))).toBe(true);

    for (const [section, kind] of [[A('containedBy'), 'contained_by'], [A('dependsOn'), 'depends_on'], [A('dependedOnBy'), 'depended_on_by']] as const) {
      const region = screen.getByRole('region', { name: section });
      fireEvent.click(within(region).getByText('workspace.application.relations.add'));
      fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));
      await waitFor(() => expect(mocked.post).toHaveBeenCalledWith(`/assets/as-1/relations/${kind}`, { id: 'as-9' }));
    }
  });

  it('offers to put an unlinked asset back', async () => {
    renderTab();
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=san-01)' }));
    expect(await screen.findByText('workspace.asset.relations.feedback.unlinked(name=san-01)')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.undo' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/relations/depends_on', { id: 'as-4' }));
  });

  it('asks where to place an asset a cluster contains, writes on the cluster and says what it replaced', async () => {
    const { invalidated } = renderTab({
      clusters: { 'as-1': [{ id: 'cl-1', name: 'PAR-VSPHERE-CL01', status: 'active' }] },
      members: {
        'cl-1': [
          { id: 'as-1', name: 'this-server', status: 'active' },
          { id: 'as-2', name: 'vm-app-01', status: 'active' },
        ],
      },
    });
    mocked.post.mockResolvedValue({
      data: {
        ok: true,
        changed: true,
        replaced_host_links: [{
          host_id: 'as-7',
          host_name: 'esx-07',
          asset_id: 'as-9',
          asset_name: 'edge-fw',
          cluster_id: 'cl-1',
          cluster_name: 'PAR-VSPHERE-CL01',
        }],
      },
    } as never);
    await screen.findByText('vm-app-01');
    fireEvent.click(within(screen.getByRole('region', { name: A('contains') })).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));

    expect(await screen.findByText('components.clusterPlacement.title')).toBeTruthy();
    expect(screen.getByText('components.clusterPlacement.inCluster(host=this-server,cluster=PAR-VSPHERE-CL01,count=2)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'components.clusterPlacement.hostOnly' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'components.clusterPlacement.placeInCluster' }));

    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/cl-1/relations/contains', { id: 'as-9' }));
    expect(await screen.findByText('workspace.asset.relations.placementReplaced(cluster=PAR-VSPHERE-CL01,hosts=esx-07,asset=edge-fw)')).toBeTruthy();
    await waitFor(() => expect(invalidated(['asset-impact'])).toBe(true));
    expect(invalidated(assetRelationsKey('as-1'))).toBe(true);
  });

  it('asks nothing when the cluster already contains the asset, and shows the server refusal', async () => {
    renderTab({
      clusters: { 'as-1': [{ id: 'cl-1', name: 'PAR-VSPHERE-CL01', status: 'active' }] },
      members: {
        'cl-1': [
          { id: 'as-1', name: 'this-server', status: 'active' },
          { id: 'as-9', name: 'edge-fw', status: 'active' },
        ],
      },
      incoming: { 'as-9': [{ asset_id: 'cl-1', relation_type: 'contains' }] },
    });
    mocked.post.mockRejectedValue({
      response: { status: 409, data: { code: 'placement_inherited', params: { cluster: 'PAR-VSPHERE-CL01' } } },
    });
    await screen.findByText('vm-app-01');
    fireEvent.click(within(screen.getByRole('region', { name: A('contains') })).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));

    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/relations/contains', { id: 'as-9' }));
    expect(screen.queryByText('components.clusterPlacement.title')).toBeNull();
    expect(mocked.get).toHaveBeenCalledWith('/assets/as-9/relations');
    expect(await screen.findByText('errors:placement_inherited(cluster=PAR-VSPHERE-CL01)')).toBeTruthy();
  });

  it('keeps the link on the host only, and writes nothing when the question closes', async () => {
    renderTab({
      clusters: { 'as-1': [{ id: 'cl-1', name: 'PAR-VSPHERE-CL01', status: 'active' }] },
      members: {
        'cl-1': [
          { id: 'as-1', name: 'this-server', status: 'active' },
          { id: 'as-2', name: 'vm-app-01', status: 'active' },
        ],
      },
    });
    await screen.findByText('vm-app-01');
    const contains = () => screen.getByRole('region', { name: A('contains') });
    fireEvent.click(within(contains()).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'components.clusterPlacement.hostOnly' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/relations/contains', { id: 'as-9' }));

    mocked.post.mockClear();
    fireEvent.click(within(contains()).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'buttons.cancel' }));
    await waitFor(() => expect(screen.queryByText('components.clusterPlacement.title')).toBeNull());
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('writes the chosen cluster on the page of a contained virtual machine', async () => {
    renderTab({
      clusters: { 'as-9': [{ id: 'cl-1', name: 'PAR-VSPHERE-CL01', status: 'active' }] },
      members: {
        'cl-1': [
          { id: 'as-9', name: 'edge-fw', status: 'active' },
          { id: 'as-2', name: 'vm-app-01', status: 'active' },
        ],
      },
    });
    await screen.findByText('vm-app-01');
    fireEvent.click(within(screen.getByRole('region', { name: A('containedBy') })).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));
    expect(await screen.findByText('components.clusterPlacement.title')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'components.clusterPlacement.placeInCluster' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/relations/contained_by', { id: 'cl-1' }));
  });

  it('asks nothing for a host of no cluster and links it directly', async () => {
    renderTab();
    await screen.findByText('vm-app-01');
    fireEvent.click(within(screen.getByRole('region', { name: A('contains') })).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/relations/contains', { id: 'as-9' }));
    expect(screen.queryByText('components.clusterPlacement.title')).toBeNull();
  });

  it('asks nothing for a retired cluster or a host retired in its cluster', async () => {
    renderTab({
      clusters: { 'as-1': [{ id: 'cl-1', name: 'PAR-VSPHERE-CL01', status: 'retired' }] },
      members: { 'cl-1': [{ id: 'as-1', name: 'this-server', status: 'active' }] },
    });
    await screen.findByText('vm-app-01');
    fireEvent.click(within(screen.getByRole('region', { name: A('contains') })).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/relations/contains', { id: 'as-9' }));
    expect(screen.queryByText('components.clusterPlacement.title')).toBeNull();

    cleanup();
    mocked.post.mockClear();
    renderTab({
      clusters: { 'as-1': [{ id: 'cl-1', name: 'PAR-VSPHERE-CL01', status: 'active' }] },
      members: { 'cl-1': [
        { id: 'as-1', name: 'this-server', status: 'retired' },
        { id: 'as-2', name: 'vm-app-01', status: 'active' },
      ] },
    });
    await screen.findByText('vm-app-01');
    fireEvent.click(within(screen.getByRole('region', { name: A('contains') })).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/relations/contains', { id: 'as-9' }));
    expect(screen.queryByText('components.clusterPlacement.title')).toBeNull();
  });

  it('asks nothing when the page is a cluster, when the target is a cluster, or for another direction', async () => {
    // A cluster belongs to no cluster: the page reads an empty list and is written as is.
    renderTab();
    await screen.findByText('vm-app-01');
    fireEvent.click(within(screen.getByRole('region', { name: A('contains') })).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/relations/contains', { id: 'as-9' }));
    expect(screen.queryByText('components.clusterPlacement.title')).toBeNull();

    cleanup();
    mocked.post.mockClear();
    mocked.get.mockClear();
    // A cluster is a container, never a member: no question before adding it as contained by.
    renderTab({ clusters: { 'as-9': [] } });
    await screen.findByText('vm-app-01');
    fireEvent.click(within(screen.getByRole('region', { name: A('containedBy') })).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/relations/contained_by', { id: 'as-9' }));
    expect(screen.queryByText('components.clusterPlacement.title')).toBeNull();

    cleanup();
    mocked.post.mockClear();
    mocked.get.mockClear();
    renderTab();
    await screen.findByText('vm-app-01');
    fireEvent.click(within(screen.getByRole('region', { name: A('dependsOn') })).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/relations/depends_on', { id: 'as-9' }));
    expect(mocked.get.mock.calls.filter(([url]) => String(url).endsWith('/clusters'))).toHaveLength(0);
  });

  it('asks nothing for a host of a cluster already holding the page', async () => {
    const data = relations();
    data.assets.contained_by = [
      asset('cl-1', 'AST-20', 'PAR-VSPHERE-CL01'),
      asset('as-3', 'AST-3', 'esx-host-01'),
    ];
    renderTab({
      relations: data,
      clusters: { 'as-9': [{ id: 'cl-1', name: 'PAR-VSPHERE-CL01', status: 'active' }] },
      members: { 'cl-1': [{ id: 'as-9', name: 'edge-fw', status: 'active' }] },
    });
    await screen.findByText('esx-host-01');
    fireEvent.click(within(screen.getByRole('region', { name: A('containedBy') })).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/as-1/relations/contained_by', { id: 'as-9' }));
    expect(screen.queryByText('components.clusterPlacement.title')).toBeNull();
  });

  it('offers each cluster of a host of several and writes the chosen one', async () => {
    const { invalidated } = renderTab({
      clusters: { 'as-1': [
        { id: 'cl-1', name: 'FIRST-CL', status: 'active' },
        { id: 'cl-2', name: 'SECOND-CL', status: 'active' },
      ] },
      members: {
        'cl-1': [{ id: 'as-1', name: 'this-server', status: 'active' }],
        'cl-2': [{ id: 'as-1', name: 'this-server', status: 'active' }, { id: 'as-2', name: 'vm-app-01', status: 'active' }],
      },
    });
    await screen.findByText('vm-app-01');
    fireEvent.click(within(screen.getByRole('region', { name: A('contains') })).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));
    expect(await screen.findByText('components.clusterPlacement.inClusters(host=this-server)')).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /SECOND-CL/ }));
    fireEvent.click(screen.getByRole('button', { name: 'components.clusterPlacement.placeInCluster' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/cl-2/relations/contains', { id: 'as-9' }));

    // The host's own list stays empty: the message says where the link went, and the page reads again.
    expect(await screen.findByText('workspace.asset.relations.placementLinked(cluster=SECOND-CL)')).toBeTruthy();
    await waitFor(() => expect(invalidated(assetRelationsKey('as-1'))).toBe(true));
    expect(invalidated(['asset-relations-tab'])).toBe(true);
    expect(invalidated(['asset-impact'])).toBe(true);
  });

  it('shows the refusal of the server when the host is already covered by its cluster', async () => {
    renderTab({
      clusters: { 'as-1': [{ id: 'cl-1', name: 'PAR-VSPHERE-CL01', status: 'active' }] },
      members: { 'cl-1': [{ id: 'as-1', name: 'this-server', status: 'active' }] },
    });
    mocked.post.mockRejectedValue({
      response: { status: 409, data: { code: 'placement_inherited', params: { cluster: 'PAR-VSPHERE-CL01' } } },
    });
    await screen.findByText('vm-app-01');
    fireEvent.click(within(screen.getByRole('region', { name: A('contains') })).getByText('workspace.application.relations.add'));
    fireEvent.click(await screen.findByRole('option', { name: /edge-fw/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'components.clusterPlacement.hostOnly' }));
    expect(await screen.findByText('errors:placement_inherited(cluster=PAR-VSPHERE-CL01)')).toBeTruthy();
  });

  it('flags a contained asset held by another container, and leaves a row without one plain', async () => {
    const data = relations();
    data.assets.contains = [
      { ...asset('as-2', 'AST-2', 'vm-app-01'), also_contained_by: [{ id: 'cl-1', name: 'PAR-VSPHERE-CL01' }] },
      asset('as-6', 'AST-6', 'vm-db-01'),
    ];
    renderTab({ relations: data });
    await screen.findByText('vm-app-01');
    expect(screen.getByRole('img', { name: 'workspace.asset.relations.alsoContainedBy(names=PAR-VSPHERE-CL01)' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: A('contains') })).getByText('vm-db-01')).toBeTruthy();
    expect(screen.getAllByRole('img', { name: /alsoContainedBy/ })).toHaveLength(1);
  });

  it('names the other containers in service on each contained-by row', async () => {
    const data = relations();
    data.assets.contained_by = [
      asset('as-3', 'AST-3', 'esx-host-01'),
      asset('as-7', 'AST-7', 'esx-host-02'),
    ];
    renderTab({ relations: data });
    await screen.findByText('esx-host-01');
    expect(screen.getByRole('img', { name: 'workspace.asset.relations.alsoContainedBy(names=esx-host-02)' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'workspace.asset.relations.alsoContainedBy(names=esx-host-01)' })).toBeTruthy();
  });

  it('leaves a retired container out, and flags no row with it', async () => {
    const data = relations();
    data.assets.contained_by = [
      asset('as-3', 'AST-3', 'esx-host-01'),
      asset('as-7', 'AST-7', 'esx-host-02'),
      asset('as-8', 'AST-8', 'esx-old', 'retired'),
    ];
    renderTab({ relations: data });
    await screen.findByText('esx-old');
    expect(screen.getByRole('img', { name: 'workspace.asset.relations.alsoContainedBy(names=esx-host-02)' })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'workspace.asset.relations.alsoContainedBy(names=esx-host-01)' })).toBeTruthy();
    expect(screen.getAllByRole('img', { name: /alsoContainedBy/ })).toHaveLength(2);
    expect(screen.queryByRole('img', { name: /esx-old/ })).toBeNull();
  });

  it('shows the double container to a reader', async () => {
    rights.infrastructure = 'reader';
    const data = relations();
    data.assets.contains = [
      { ...asset('as-2', 'AST-2', 'vm-app-01'), also_contained_by: [{ id: 'cl-1', name: 'PAR-VSPHERE-CL01' }] },
    ];
    renderTab({ relations: data });
    expect(await screen.findByRole('img', { name: 'workspace.asset.relations.alsoContainedBy(names=PAR-VSPHERE-CL01)' })).toBeTruthy();
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
  });

  it('unlinks at once, reads the relations and the impact of every asset again, and restores the row when the server refuses', async () => {
    const { invalidated } = renderTab();
    let reject: (error: unknown) => void = () => undefined;
    mocked.delete.mockReturnValue(new Promise((_, next) => { reject = next; }) as never);
    fireEvent.click(await screen.findByRole('button', { name: 'workspace.application.relations.remove(name=san-01)' }));

    expect(mocked.delete).toHaveBeenCalledWith('/assets/as-1/relations/depends_on/as-4');
    await waitFor(() => expect(screen.queryByText('san-01')).toBeNull());
    expect(screen.getByText('vm-app-01')).toBeTruthy();

    reject({ response: { status: 500, data: { message: 'Server down' } } });
    expect(await screen.findByText('san-01')).toBeTruthy();
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(invalidated(assetRelationsKey('as-1'))).toBe(false);

    mocked.delete.mockResolvedValue({ data: { ok: true, changed: true } } as never);
    fireEvent.click(screen.getByRole('button', { name: 'workspace.application.relations.remove(name=backup-01)' }));
    await waitFor(() => expect(mocked.delete).toHaveBeenCalledWith('/assets/as-1/relations/depended_on_by/as-5'));
    await waitFor(() => expect(invalidated(['asset-impact'])).toBe(true));
    // The other asset of the relation reads its relations again too.
    expect(invalidated(['asset-relations-tab'])).toBe(true);
    expect(invalidated(assetRelationsKey('as-1'))).toBe(true);
  });

  it('gives a reader the tables and the navigation only', async () => {
    rights.infrastructure = 'reader';
    renderTab();
    await screen.findByText('vm-app-01');
    expect(screen.queryByText('workspace.application.relations.add')).toBeNull();
    expect(screen.queryByRole('button', { name: /relations\.remove/ })).toBeNull();
    fireEvent.click(screen.getByText('san-01'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-4/overview');
  });
});
