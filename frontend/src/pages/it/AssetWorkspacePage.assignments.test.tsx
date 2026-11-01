import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import AssetWorkspacePage from './AssetWorkspacePage';

const get = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const del = vi.hoisted(() => vi.fn());

vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: { vulnerabilityFeed: false } } }) }));
vi.mock('../../api', () => ({ default: { get, patch: vi.fn(), post, delete: del } }));
// What the person may do: edit the infrastructure, and (or not) the applications' assignments.
const auth = vi.hoisted(() => ({ assign: true }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => (resource === 'infrastructure' && level !== 'admin') || (resource === 'applications' && (level === 'reader' || auth.assign)),
  }),
}));
const enumOptions = vi.hoisted(() => ({
  settings: { hostingTypes: [], serverKinds: [], domains: [], subnets: [] },
  byField: {
    adminZone: [],
    serverKind: [{ code: 'virtual_machine', label: 'Virtual machine' }],
    lifecycleStatus: [{ code: 'active', label: 'Active' }],
    serverRole: [{ code: 'db', label: 'db' }],
    serverProvider: [{ code: 'on_prem', label: 'On premises' }],
    ipAddressType: [],
  },
  labelFor: (_field: string, code: string) => code,
}));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({ default: () => enumOptions }));
vi.mock('../../hooks/useAssetNav', () => ({
  useAssetNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('./editors/HardwareInfoPanel', () => ({ default: () => null }));
vi.mock('./editors/SupportInfoPanel', () => ({ default: () => null }));
vi.mock('./workspace/AssetRelationsTab', () => ({ default: () => null }));
vi.mock('./workspace/AssetDependenciesTab', () => ({ default: () => null }));
vi.mock('./components/AssetTechnologiesSection', async (importOriginal) => ({ ...(await importOriginal<any>()), default: () => null }));
vi.mock('../../components/EntityKnowledgePanel', () => ({ default: () => null }));
vi.mock('../../components/fields/LocationSelect', () => ({ default: () => null }));
vi.mock('../../components/fields/ApplicationSelect', () => ({
  default: ({ onChange }: { onChange: (value: string | null) => void }) => <button type="button" onClick={() => onChange('app-1')}>pick-application</button>,
}));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/MarkdownEditor', () => ({ default: () => null }));

const ASSET = {
  id: 'asset-1',
  name: 'PAR-SQL-01',
  asset_reference: 'AST-1',
  kind: 'virtual_machine',
  provider: 'on_prem',
  environment: 'prod',
  hostname: 'sql1',
  domain: '',
  admin_zone: '',
  fqdn: 'sql1',
  aliases: [],
  ip_addresses: [],
  is_cluster: false,
  status: 'active',
  go_live_date: null,
  end_of_life_date: null,
  location_id: null,
  notes: '',
  external_links: [],
};

const wire = {
  asset: ASSET as typeof ASSET,
  assignments: { items: [] as unknown[], groupable: [] as unknown[] },
  /** The rows of the member PAR-SQL-02 (`GET /assets/sql-2/assignments`). */
  memberRows: [] as unknown[],
  clusters: [] as unknown[],
  members: [] as unknown[],
  deploymentServers: [] as unknown[],
  /** The deployments of CheeseTrack (`GET /applications/app-1?include=instances`). */
  instances: [{ id: 'dep-1', environment: 'prod' }] as Array<{ id: string; environment: string }>,
};

const direct = {
  id: 'as-1', app_instance_id: 'dep-9', asset_id: 'asset-1', role: 'app', since_date: null, notes: null,
  application: { id: 'app-9', name: 'Intranet' }, environment: 'prod', inherited: false, via_clusters: [], groupable: null,
};
const inherited = {
  id: 'as-cl', app_instance_id: 'dep-1', asset_id: 'asset-1', role: 'db', since_date: null, notes: null,
  application: { id: 'app-1', name: 'CheeseTrack' }, environment: 'prod', inherited: true, via_clusters: [{ id: 'cl-1', name: 'PAR-SQL-CL01' }], groupable: null,
};

function renderOperations(tab = 'operations') {
  get.mockImplementation(async (url: string) => {
    if (url === '/assets/asset-1' || url === '/assets/by-ref/AST-1') return { data: wire.asset };
    if (url === '/assets/asset-1/assignments') return { data: wire.assignments.items };
    if (url === '/assets/asset-1/assignments/groupable') return { data: { items: wire.assignments.groupable } };
    if (url === '/assets/sql-2/assignments') return { data: wire.memberRows };
    if (url === '/applications/app-1') return { data: { id: 'app-1', name: 'CheeseTrack', instances: wire.instances } };
    if (url === '/applications/app-1/deployment-servers') return { data: { items: wire.deploymentServers, groupable: [] } };
    if (url === '/assets/asset-1/clusters') return { data: { items: wire.clusters } };
    if (url === '/assets/asset-1/members') return { data: { items: wire.members } };
    if (url === '/assets/cl-1/members') return { data: { items: wire.members } };
    if (url === '/locations') return { data: { items: [] } };
    if (url.endsWith('/sub-items')) return { data: [] };
    if (url === '/assets/asset-1/relations-tab') return { data: { counts: { assets: 0, total: 0 } } };
    return { data: { items: [], outgoing: [], incoming: [] } };
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[`/it/assets/asset-1/${tab}`]}>
            <Routes>
              <Route path="/it/assets/:id/:tab" element={<AssetWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return client;
}

/** Fills the assignment dialog (application, environment) and saves it; the role defaults to the first one. */
async function addAssignment() {
  fireEvent.click(await screen.findByRole('button', { name: 'Add assignment' }));
  const dialog = await screen.findByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'pick-application' }));
  await waitFor(() => expect(get).toHaveBeenCalledWith('/applications/app-1', expect.anything()));
  fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[0]);
  fireEvent.click(await screen.findByRole('option', { name: 'Prod' }));
  fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
}

describe('Asset workspace: assignments and clusters', () => {
  beforeEach(() => {
    get.mockReset();
    post.mockReset();
    del.mockReset();
    post.mockResolvedValue({ data: { absorbed: [] } });
    auth.assign = true;
    wire.asset = ASSET;
    wire.assignments = { items: [], groupable: [] };
    wire.memberRows = [];
    wire.clusters = [];
    wire.members = [];
    wire.deploymentServers = [];
    wire.instances = [{ id: 'dep-1', environment: 'prod' }];
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false, media: query, addListener: () => undefined, removeListener: () => undefined,
      addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false,
    }));
  });
  afterEach(() => cleanup());

  it('shows what a member inherits with its cluster, and no way to change it', async () => {
    wire.assignments = { items: [direct, inherited], groupable: [] };
    renderOperations();
    const link = await screen.findByRole('link', { name: 'PAR-SQL-CL01' });
    expect(link.getAttribute('href')).toBe('/it/assets/cl-1/overview');
    const inheritedRow = screen.getByText('CheeseTrack').closest('tr') as HTMLElement;
    expect(within(inheritedRow).queryAllByRole('button').map((button) => button.textContent)).toEqual(['CheeseTrack']);
    expect(within(inheritedRow).getByText(/^via/)).toBeTruthy();
    const ownRow = screen.getByText('Intranet').closest('tr') as HTMLElement;
    expect(within(ownRow).getAllByRole('button').length).toBe(3);
    // An empty date and empty notes show the dash of every other table of the page.
    expect(within(ownRow).getAllByText('—')).toHaveLength(2);
    expect(within(ownRow).queryByText('-')).toBeNull();
  });

  it('keeps the assignment button of a cluster active and shows no alert', async () => {
    wire.asset = { ...ASSET, is_cluster: true };
    renderOperations();
    const button = await screen.findByRole('button', { name: 'Add assignment' });
    expect(button).not.toBeDisabled();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/cannot host/)).toBeNull();
  });

  it('gives a reader the rows and no button', async () => {
    auth.assign = false;
    wire.assignments = { items: [direct, inherited], groupable: [] };
    renderOperations();
    await screen.findByRole('link', { name: 'PAR-SQL-CL01' });
    expect(screen.queryByRole('button', { name: 'Add assignment' })).toBeNull();
    const ownRow = screen.getByText('Intranet').closest('tr') as HTMLElement;
    expect(within(ownRow).getAllByRole('button').map((button) => button.textContent)).toEqual(['Intranet']);
  });

  it('asks about the cluster before assigning a member, and posts the cluster on the answer', async () => {
    wire.clusters = [{ id: 'cl-1', name: 'PAR-SQL-CL01', status: 'active' }];
    wire.members = [
      { id: 'asset-1', name: 'PAR-SQL-01', status: 'active' },
      { id: 'sql-2', name: 'PAR-SQL-02', status: 'active' },
    ];
    wire.deploymentServers = [{ id: 'as-2', app_instance_id: 'dep-1', server_id: 'sql-2', role: 'db' }];
    renderOperations();
    await addAssignment();
    const question = await screen.findByText('Assign to the cluster?');
    const dialog = question.closest('[role="dialog"]') as HTMLElement;
    expect(within(dialog).getByText('PAR-SQL-01 is part of PAR-SQL-CL01. Its 2 members will host CheeseTrack (Prod, db).')).toBeTruthy();
    expect(within(dialog).getByText('The direct assignment of PAR-SQL-02 will be replaced.')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign to the cluster' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/app-instances/dep-1/assets', expect.objectContaining({ server_id: 'cl-1', role: 'db' })));
  });

  it('creates the deployment an application lacks, then assigns the server to it', async () => {
    wire.instances = [];
    post.mockImplementation(async (url: string) => (
      url === '/applications/app-1/deployments' ? { data: { id: 'dep-new', environment: 'dev' } } : { data: { absorbed: [] } }
    ));
    renderOperations();
    fireEvent.click(await screen.findByRole('button', { name: 'Add assignment' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Deployment')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'pick-application' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/applications/app-1', expect.anything()));
    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[0]);
    fireEvent.click(await screen.findByRole('option', { name: '+ Create the Dev deployment' }));
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/app-instances/dep-new/assets', expect.objectContaining({ server_id: 'asset-1' })));
    expect(post.mock.calls[0]).toEqual(['/applications/app-1/deployments', { environment: 'dev' }]);
  });

  it('offers to create only the deployments the application does not have', async () => {
    renderOperations();
    fireEvent.click(await screen.findByRole('button', { name: 'Add assignment' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'pick-application' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith('/applications/app-1', expect.anything()));
    fireEvent.mouseDown(within(dialog).getAllByRole('combobox')[0]);
    expect(await screen.findByRole('option', { name: 'Prod' })).toBeTruthy();
    expect(screen.queryByRole('option', { name: '+ Create the Prod deployment' })).toBeNull();
    expect(screen.getByRole('option', { name: '+ Create the Sandbox deployment' })).toBeTruthy();
  });

  it('assigns this server alone on "This server only"', async () => {
    wire.clusters = [{ id: 'cl-1', name: 'PAR-SQL-CL01', status: 'active' }];
    wire.members = [{ id: 'asset-1', name: 'PAR-SQL-01', status: 'active' }, { id: 'sql-2', name: 'PAR-SQL-02', status: 'active' }];
    renderOperations();
    await addAssignment();
    fireEvent.click(await screen.findByRole('button', { name: 'This server only' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/app-instances/dep-1/assets', expect.objectContaining({ server_id: 'asset-1' })));
  });

  it('refuses without a question when the cluster already carries the role', async () => {
    wire.clusters = [{ id: 'cl-1', name: 'PAR-SQL-CL01', status: 'active' }];
    wire.members = [{ id: 'asset-1', name: 'PAR-SQL-01', status: 'active' }, { id: 'sql-2', name: 'PAR-SQL-02', status: 'active' }];
    wire.deploymentServers = [{ id: 'as-cl', app_instance_id: 'dep-1', server_id: 'cl-1', role: 'db' }];
    renderOperations();
    await addAssignment();
    expect(await screen.findByText('Already hosted by this server through PAR-SQL-CL01.')).toBeTruthy();
    expect(screen.queryByText('Assign to the cluster?')).toBeNull();
    expect(post).not.toHaveBeenCalled();
  });

  it('lets a retired member take its own row though its cluster carries the role', async () => {
    wire.clusters = [{ id: 'cl-1', name: 'PAR-SQL-CL01', status: 'active' }];
    wire.members = [{ id: 'asset-1', name: 'PAR-SQL-01', status: 'retired' }, { id: 'sql-2', name: 'PAR-SQL-02', status: 'active' }];
    wire.deploymentServers = [{ id: 'as-cl', app_instance_id: 'dep-1', server_id: 'cl-1', role: 'db' }];
    renderOperations();
    await addAssignment();
    await waitFor(() => expect(post).toHaveBeenCalledWith('/app-instances/dep-1/assets', expect.objectContaining({ server_id: 'asset-1' })));
    expect(screen.queryByText('Already hosted by this server through PAR-SQL-CL01.')).toBeNull();
  });

  it('says which direct rows a cluster replaces before assigning it, and posts it on the answer', async () => {
    wire.asset = { ...ASSET, is_cluster: true };
    wire.members = [{ id: 'sql-2', name: 'PAR-SQL-02', status: 'active' }];
    wire.deploymentServers = [{ id: 'as-2', app_instance_id: 'dep-1', server_id: 'sql-2', role: 'db' }];
    renderOperations();
    await addAssignment();
    const dialog = (await screen.findByText('The direct assignment of PAR-SQL-02 will be replaced.')).closest('[role="dialog"]') as HTMLElement;
    expect(within(dialog).queryByRole('button', { name: 'This server only' })).toBeNull();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign to the cluster' }));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/app-instances/dep-1/assets', expect.objectContaining({ server_id: 'asset-1', role: 'db' })));
  });

  it('proposes to group on the cluster page and posts the cluster after a confirmation', async () => {
    wire.asset = { ...ASSET, id: 'asset-1', name: 'PAR-SQL-CL01', is_cluster: true };
    wire.assignments = {
      items: [],
      groupable: [{ cluster_id: 'asset-1', cluster_name: 'PAR-SQL-CL01', app_instance_id: 'dep-1', role: 'db', application_id: 'app-1', application_name: 'CheeseTrack', environment: 'prod', member_ids: ['sql-1', 'sql-2'] }],
    };
    wire.members = [{ id: 'sql-1', name: 'PAR-SQL-01' }, { id: 'sql-2', name: 'PAR-SQL-02' }];
    renderOperations();
    expect(await screen.findByText('CheeseTrack (Prod, db) on PAR-SQL-01, PAR-SQL-02')).toBeTruthy();
    // The set names its application: no read of a member's assignments.
    expect(get).not.toHaveBeenCalledWith('/assets/sql-1/assignments', expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'Assign to the cluster' }));
    expect(await screen.findByText('CheeseTrack will stay available as long as one member stands.')).toBeTruthy();
    expect(screen.getByText('Assign to the cluster?')).toBeTruthy();
    expect(post).not.toHaveBeenCalled();
    const buttons = screen.getAllByRole('button', { name: 'Assign to the cluster' });
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(post).toHaveBeenCalledWith('/app-instances/dep-1/assets', { server_id: 'asset-1', role: 'db' }));
  });

  describe('members of a cluster', () => {
    const member = (id: string, name: string, environment = 'prod') => ({ id, name, environment, status: 'active', kind: 'virtual_machine', provider: 'on_prem' });
    const row = (id: string, app: string) => ({ ...direct, id, app_instance_id: `dep-${id}`, application: { id: `app-${id}`, name: app } });

    async function openMembers(clusterOs: string | null = null) {
      wire.asset = { ...ASSET, is_cluster: true, operating_system: clusterOs } as never;
      wire.members = [member('sql-1', 'PAR-SQL-01'), member('sql-2', 'PAR-SQL-02', 'qa')];
      renderOperations();
      fireEvent.click(await screen.findByRole('button', { name: 'Edit members' }));
      return screen.findByRole('dialog');
    }
    const removeSecond = (dialog: HTMLElement) => fireEvent.click(within(dialog).getAllByTestId('CancelIcon')[1]);
    const save = (dialog: HTMLElement) => fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    it('says what a removed member stops hosting, and removes it on "Remove anyway"', async () => {
      wire.assignments = { items: [row('b', 'Sage X3'), row('a', 'CheeseTrack')], groupable: [] };
      const dialog = await openMembers();
      removeSecond(dialog);
      save(dialog);
      expect(await screen.findByText('PAR-SQL-02 will no longer host CheeseTrack and Sage X3.')).toBeTruthy();
      expect(post).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: 'Remove anyway' }));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/assets/asset-1/members', { server_ids: ['sql-1'] }));
    });

    it('leaves out what the removed member also holds directly or through another cluster', async () => {
      wire.assignments = { items: [row('b', 'Sage X3'), row('a', 'CheeseTrack'), row('c', 'Intranet')], groupable: [] };
      wire.memberRows = [
        { ...row('b', 'Sage X3'), id: 'own-b' },
        { ...row('c', 'Intranet'), id: 'other-c', inherited: true, via_clusters: [{ id: 'cl-9', name: 'OTHER-CL' }] },
        { ...row('a', 'CheeseTrack'), id: 'via-a', inherited: true, via_clusters: [{ id: 'asset-1', name: 'PAR-SQL-CL01' }] },
      ];
      const dialog = await openMembers();
      removeSecond(dialog);
      save(dialog);
      expect(await screen.findByText('PAR-SQL-02 will no longer host CheeseTrack.')).toBeTruthy();
    });

    it('names three applications and counts the others', async () => {
      wire.assignments = { items: [row('a', 'Alpha'), row('b', 'Bravo'), row('c', 'Charlie'), row('d', 'Delta'), row('e', 'Echo')], groupable: [] };
      const dialog = await openMembers();
      removeSecond(dialog);
      save(dialog);
      expect(await screen.findByText('PAR-SQL-02 will no longer host Alpha, Bravo, Charlie, and 2 others.')).toBeTruthy();
    });

    it('writes nothing when the question is cancelled', async () => {
      wire.assignments = { items: [row('a', 'CheeseTrack')], groupable: [] };
      const dialog = await openMembers();
      removeSecond(dialog);
      save(dialog);
      const ask = (await screen.findByText('Remove members?')).closest('[role="dialog"]') as HTMLElement;
      fireEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
      await waitFor(() => expect(screen.queryByText('Remove members?')).toBeNull());
      expect(post).not.toHaveBeenCalled();
    });

    it('asks nothing when the cluster carries no assignment', async () => {
      const dialog = await openMembers();
      removeSecond(dialog);
      save(dialog);
      await waitFor(() => expect(post).toHaveBeenCalledWith('/assets/asset-1/members', { server_ids: ['sql-1'] }));
      expect(screen.queryByText('Remove members?')).toBeNull();
    });

    it('asks once for the removed members and the operating system', async () => {
      wire.assignments = { items: [row('a', 'CheeseTrack')], groupable: [] };
      const dialog = await openMembers('Windows Server 2022');
      removeSecond(dialog);
      save(dialog);
      const ask = (await screen.findByText('Remove members?')).closest('[role="dialog"]') as HTMLElement;
      expect(within(ask).getByText('PAR-SQL-02 will no longer host CheeseTrack.')).toBeTruthy();
      expect(within(ask).getByText('A cluster with members has no operating system: Windows Server 2022 will be removed.')).toBeTruthy();
      fireEvent.click(within(ask).getByRole('button', { name: 'Remove anyway' }));
      await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
      expect(post).toHaveBeenCalledWith('/assets/asset-1/members', { server_ids: ['sql-1'], remove_operating_system: true });
    });

    it('flags a member of another environment than the cluster on its chip, and refuses nothing', async () => {
      const dialog = await openMembers();
      const flagged = within(dialog).getAllByLabelText('Different environment from the cluster');
      expect(flagged.length).toBe(1);
      expect(within(dialog).getByText('PAR-SQL-02').closest('.MuiChip-root')?.contains(flagged[0])).toBe(true);
      save(dialog);
      await waitFor(() => expect(post).toHaveBeenCalledWith('/assets/asset-1/members', { server_ids: ['sql-1', 'sql-2'] }));
    });

    it('reads the technologies, the vulnerabilities and the inherited assignments again after a removal', async () => {
      const invalidate = vi.spyOn(QueryClient.prototype, 'invalidateQueries');
      const dialog = await openMembers();
      removeSecond(dialog);
      save(dialog);
      await waitFor(() => expect(post).toHaveBeenCalledWith('/assets/asset-1/members', { server_ids: ['sql-1'] }));

      // What a cluster shows from its members is stale after the save: its technologies, its
      // vulnerabilities (with the severe badge) and the applications it inherits from them.
      const predicates = invalidate.mock.calls
        .map(([filters]) => (filters as { predicate?: (query: { queryKey: unknown[] }) => boolean } | undefined)?.predicate)
        .filter((predicate): predicate is (query: { queryKey: unknown[] }) => boolean => typeof predicate === 'function');
      expect(predicates.some((predicate) => predicate({ queryKey: ['asset-technologies', 'asset-1'] }))).toBe(true);
      expect(predicates.some((predicate) => predicate({ queryKey: ['asset-technologies', 'asset-1', 'vulnerabilities'] }))).toBe(true);
      await waitFor(() => expect(get.mock.calls.filter(([url]) => url === '/assets/asset-1/assignments').length).toBeGreaterThanOrEqual(2));
      invalidate.mockRestore();
    });
  });
});
