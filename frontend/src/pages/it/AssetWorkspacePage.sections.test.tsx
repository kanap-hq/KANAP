import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import AssetWorkspacePage from './AssetWorkspacePage';
import { invalidateTechnologyLinks } from './components/technologyLinkQueries';

const get = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const del = vi.hoisted(() => vi.fn());
const t = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));
const features = vi.hoisted(() => ({ vulnerabilityFeed: false }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features } }) }));
vi.mock('../../api', () => ({ default: { get, patch, post, delete: del } }));
// What the person may do on infrastructure: nothing (a reader), 'member' (edits) or 'admin' (also deletes).
const auth = vi.hoisted(() => ({ level: 'member' as 'reader' | 'member' | 'admin' }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => resource === 'infrastructure'
      && ((level === 'member' && auth.level !== 'reader') || (level === 'admin' && auth.level === 'admin')),
  }),
}));
// One object for every render, as the real hook memoises it: a fresh one would re-run the location effects forever.
const enumOptions = vi.hoisted(() => ({
  settings: {
    hostingTypes: [],
    serverKinds: [
      { code: 'virtual_machine', label: 'Virtual machine', is_physical: false },
      { code: 'physical_server', label: 'Physical server', is_physical: true },
    ],
    domains: [],
    subnets: [],
  },
  byField: {
    adminZone: [],
    serverKind: [{ code: 'virtual_machine', label: 'Virtual machine' }, { code: 'physical_server', label: 'Physical server' }],
    lifecycleStatus: [{ code: 'active', label: 'Active' }],
    serverRole: [],
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
vi.mock('./editors/SupportInfoPanel', () => ({ default: () => <div>support-panel</div> }));
vi.mock('./workspace/AssetRelationsTab', () => ({ default: () => null }));
vi.mock('./workspace/AssetDependenciesTab', () => ({
  default: ({ clusterSection }: { clusterSection?: React.ReactNode }) => <div>dependencies-tab{clusterSection}</div>,
}));
vi.mock('./components/AssetTechnologiesSection', async (importOriginal) => ({ ...(await importOriginal<any>()), default: () => <div>technologies-section</div> }));
vi.mock('../../components/EntityKnowledgePanel', () => ({ default: () => <div>knowledge-panel</div> }));
vi.mock('../../components/fields/LocationSelect', () => ({
  default: ({ onChange }: { onChange: (value: string | null) => void }) => <button type="button" onClick={() => onChange('loc-1')}>pick-location</button>,
}));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/MarkdownEditor', () => ({ default: () => null }));

const ASSET = {
  id: 'asset-1',
  name: 'dc1',
  asset_reference: 'AST-1',
  kind: 'virtual_machine',
  provider: 'on_prem',
  environment: 'prod',
  hostname: 'dc1',
  domain: '',
  admin_zone: '',
  fqdn: 'dc1',
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

const VULNERABILITIES_URL = '/assets/asset-1/vulnerabilities';
const OPEN = { critical: 1, high: 2, medium: 0, low: 0, none: 0, unknown: 0 };
const REACH = {
  rows: [{ technology: { id: 'tech-1', name: 'OpenSSL', reference: 'TEC-1' }, version_id: 'v-1', label: '3.0', open: OPEN, total: 3, severe: 3, exploited_severe: 1 }],
  indirect: [],
  totals: { open: 3, severe: 3, exploited_severe: 1 },
};

// What the relations read and the cluster lists answer; each test sets them.
const wire = vi.hoisted(() => ({ counts: { assets: 0, total: 0 } as Record<string, number>, members: [] as unknown[], clusters: [] as unknown[], candidates: [] as unknown[] }));

function renderAt(path: string, reach: unknown = REACH, asset: typeof ASSET | (() => Promise<unknown>) = ASSET) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockImplementation(async (url: string) => {
    if (url === '/assets/asset-1' || url === '/assets/by-ref/AST-1') return typeof asset === 'function' ? asset() : { data: asset };
    if (url === VULNERABILITIES_URL) return typeof reach === 'function' ? reach() : { data: reach };
    if (url === '/assets/asset-2' || url === '/assets/by-ref/AST-2') return { data: { ...ASSET, id: 'asset-2', asset_reference: 'AST-2', is_cluster: false } };
    if (url === '/locations') return { data: { items: [] } };
    if (url === '/locations/loc-1') return { data: { id: 'loc-1', location_reference: 'LOC-1', name: 'Paris', hosting_type: 'on_prem' } };
    if (url.endsWith('/sub-items')) return { data: [] };
    if (url.endsWith('/assignments')) return { data: [] };
    if (url === '/assets/asset-1/relations-tab') return { data: { counts: wire.counts } };
    if (url === '/assets') return { data: { items: wire.candidates } };
    if (url.endsWith('/members')) return { data: { items: wire.members } };
    if (url.endsWith('/clusters')) return { data: { items: wire.clusters } };
    return { data: { items: [], outgoing: [], incoming: [] } };
  });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={queryClient}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/it/assets/:id/:tab" element={<><AssetWorkspacePage /><LocationProbe /></>} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return queryClient;
}

function LocationProbe() {
  const navigate = useNavigate();
  return (
    <>
      <div data-testid="location">{useLocation().pathname}</div>
      <button type="button" data-testid="go-asset-2" onClick={() => navigate('/it/assets/asset-2/dependencies')}>go</button>
      <button type="button" data-testid="go-asset-1" onClick={() => navigate('/it/assets/asset-1/dependencies')}>back</button>
    </>
  );
}

/** A dialog of the page, found by its title (the dialogs carry no accessible name). */
const dialogTitled = async (title: string) => (await screen.findByText(title)).closest('[role="dialog"]') as HTMLElement;
const gone = (title: string) => waitFor(() => expect(screen.queryByText(title)).toBeNull());

const currentPath = () => screen.getByTestId('location').textContent;

const vulnerabilityCalls = () => get.mock.calls.filter(([url]) => url === VULNERABILITIES_URL).length;

const follows = (first: Element, second: Element) =>
  Boolean(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('Asset workspace: section placement', () => {
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
    post.mockReset();
    del.mockReset();
    wire.counts = { assets: 0, total: 0 };
    wire.members = [];
    wire.clusters = [];
    wire.candidates = [];
    auth.level = 'member';
    features.vulnerabilityFeed = false;
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: false,
      media: query,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }));
  });

  it('shows the description, then support, then the knowledge base in the overview', async () => {
    renderAt('/it/assets/asset-1/overview');
    const support = await screen.findByText('support-panel');
    const description = screen.getByText('workspace.asset.overview.description');
    const knowledge = screen.getByText('knowledge-panel');
    expect(follows(description, support)).toBe(true);
    expect(follows(support, knowledge)).toBe(true);
    expect(screen.getByText('workspace.asset.support.title')).toBeInTheDocument();
    expect(screen.queryByText('workspace.asset.technical.identity')).toBeNull();
    expect(screen.queryByText('workspace.asset.operations.hostedApplications')).toBeNull();
    expect(screen.queryByText('workspace.asset.connections.title')).toBeNull();
  });

  it('shows support in the overview of a virtual asset', async () => {
    renderAt('/it/assets/asset-1/overview');
    expect(await screen.findByText('support-panel')).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: /workspace.asset.tabs.hardware/ })).toBeNull();
  });

  it('leaves support and the knowledge base out of the overview when creating an asset', async () => {
    renderAt('/it/assets/new/overview');
    await screen.findByText('workspace.asset.overview.basics');
    expect(screen.queryByText('support-panel')).toBeNull();
    expect(screen.queryByText('knowledge-panel')).toBeNull();
  });

  it('lists hosted applications, technologies, then vulnerabilities in the operations tab', async () => {
    features.vulnerabilityFeed = true;
    renderAt('/it/assets/asset-1/operations');
    const vulnerabilities = await screen.findByText('pages.vulnerabilities.section.title');
    const hosted = screen.getByText('workspace.asset.operations.hostedApplications');
    const technologies = screen.getByText('technologies-section');
    expect(follows(hosted, technologies)).toBe(true);
    expect(follows(technologies, vulnerabilities)).toBe(true);
    expect(screen.queryByText('workspace.asset.technical.ipAddresses')).toBeNull();
    expect(screen.queryByText('workspace.asset.technical.identity')).toBeNull();
  });

  it('lists identity, IP addresses, then connections in the network tab', async () => {
    renderAt('/it/assets/asset-1/network');
    await waitFor(() => expect(screen.getByPlaceholderText('workspace.asset.technical.hostnamePlaceholder')).toHaveValue('dc1'));
    const identity = screen.getByText('workspace.asset.technical.identity');
    const ipAddresses = screen.getByText('workspace.asset.technical.ipAddresses');
    const connections = screen.getByText('workspace.asset.connections.title');
    expect(follows(identity, ipAddresses)).toBe(true);
    expect(follows(ipAddresses, connections)).toBe(true);
    expect(screen.queryByText('technologies-section')).toBeNull();
    expect(screen.queryByText('workspace.asset.technical.members')).toBeNull();
    expect(screen.queryByText('workspace.asset.technical.clusterMembership')).toBeNull();
  });

  it('mentions Netbox once in the network tab of an asset Netbox feeds', async () => {
    renderAt('/it/assets/asset-1/network', REACH, {
      ...ASSET,
      external_links: [{ source: 'netbox', state: 'linked', external_url: 'https://netbox.example/dcim/devices/1/', last_synced_at: null }],
    } as unknown as typeof ASSET);
    await waitFor(() => expect(screen.getByPlaceholderText('workspace.asset.technical.hostnamePlaceholder')).toBeDisabled());
    expect(screen.getAllByText('pages.netbox.assetSource.managedFields')).toHaveLength(1);
  });

  it('mentions nothing about Netbox in the network tab of an asset it does not feed', async () => {
    renderAt('/it/assets/asset-1/network');
    await screen.findByText('workspace.asset.technical.ipAddresses');
    expect(screen.queryByText('pages.netbox.assetSource.managedFields')).toBeNull();
  });

  it('leaves the FQDN out of the metadata bar: identity shows it', async () => {
    renderAt('/it/assets/asset-1/network', REACH, { ...ASSET, hostname: 'srv-fqdn', fqdn: 'srv-fqdn' });
    await waitFor(() => expect(screen.getByPlaceholderText('workspace.asset.technical.hostnamePlaceholder')).toHaveValue('srv-fqdn'));
    expect(screen.getAllByDisplayValue('srv-fqdn').length).toBeGreaterThan(1);
    expect(screen.queryByText('srv-fqdn')).toBeNull();
  });

  it('keeps identity and IP addresses editable when creating an asset, without connections or technologies', async () => {
    renderAt('/it/assets/new/network');
    await screen.findByText('workspace.asset.technical.identity');
    expect(screen.getByPlaceholderText('workspace.asset.technical.hostnamePlaceholder')).toBeEnabled();
    expect(screen.getByText('workspace.asset.technical.ipAddresses')).toBeInTheDocument();
    expect(screen.queryByText('workspace.asset.connections.title')).toBeNull();
    expect(screen.queryByText('technologies-section')).toBeNull();
    expect(currentPath()).toBe('/it/assets/new/network');
  });

  it('shows no untitled title while the asset loads, and shows it for a loaded asset without a name', async () => {
    let answer: (value: unknown) => void = () => undefined;
    renderAt('/it/assets/asset-1/overview', REACH, () => new Promise((resolve) => { answer = resolve; }));
    await waitFor(() => expect(get.mock.calls.some(([url]) => url === '/assets/asset-1')).toBe(true));
    expect(screen.queryByText('workspace.asset.untitled')).toBeNull();
    answer({ data: { ...ASSET, name: '' } });
    expect(await screen.findByText('workspace.asset.untitled')).toBeInTheDocument();
  });

  describe('properties panel', () => {
    const PANEL_ORDER = [
      'workspace.asset.overview.assetType',
      'workspace.asset.meta.cluster',
      'workspace.asset.technical.environment',
      'workspace.asset.technical.adminZone',
      'workspace.asset.overview.location',
      'workspace.asset.overview.lifecycle',
      'workspace.asset.overview.goLiveDate',
      'workspace.asset.overview.endOfLifeDate',
    ];

    const expectPanelOrder = () => {
      // The metadata bar above repeats the location: the panel's row is the last match.
      const nodes = PANEL_ORDER.map((label) => screen.getAllByText(label).slice(-1)[0]);
      for (let i = 1; i < nodes.length; i += 1) expect(follows(nodes[i - 1], nodes[i])).toBe(true);
    };

    it('lists Type, Cluster, Environment, Administration zone, then Location, then Lifecycle and dates', async () => {
      renderAt('/it/assets/asset-1/network');
      await screen.findByText('workspace.asset.technical.ipAddresses');
      expectPanelOrder();
    });

    it('shows the same rows when creating an asset', async () => {
      renderAt('/it/assets/new/network');
      await screen.findByText('workspace.asset.technical.ipAddresses');
      expectPanelOrder();
    });

    it('sets the cluster state without any call when creating an asset', async () => {
      renderAt('/it/assets/new/overview');
      const toggle = await screen.findByRole('checkbox', { name: 'workspace.asset.meta.cluster' });
      expect(toggle).toBeEnabled();
      expect(toggle).not.toBeChecked();
      fireEvent.click(toggle);
      expect(toggle).toBeChecked();
      expect(patch).not.toHaveBeenCalled();
      expect(post).not.toHaveBeenCalled();
      expect(del).not.toHaveBeenCalled();
    });

    it('saves at once, and removes nothing, when an asset becomes a cluster', async () => {
      patch.mockResolvedValue({ data: { ...ASSET, is_cluster: true } });
      renderAt('/it/assets/asset-1/overview');
      const toggle = await screen.findByRole('checkbox', { name: 'workspace.asset.meta.cluster' });
      await waitFor(() => expect(toggle).toBeEnabled());
      fireEvent.click(toggle);
      await waitFor(() => expect(patch).toHaveBeenCalledWith('/assets/asset-1', { is_cluster: true }));
      await waitFor(() => expect(toggle).toBeChecked());
      expect(del).not.toHaveBeenCalled();
    });

    it('keeps the switch enabled, with its focus, while it saves, and ignores a second click', async () => {
      let resolvePatch: (value: unknown) => void = () => {};
      patch.mockImplementation(() => new Promise((resolve) => { resolvePatch = resolve; }));
      renderAt('/it/assets/asset-1/overview');
      const toggle = await screen.findByRole('checkbox', { name: 'workspace.asset.meta.cluster' });
      await waitFor(() => expect(toggle).toBeEnabled());
      toggle.focus();
      fireEvent.click(toggle);
      await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
      expect(toggle).toBeEnabled();
      expect(document.activeElement).toBe(toggle);
      fireEvent.click(toggle);
      expect(patch).toHaveBeenCalledTimes(1);
      resolvePatch({ data: { ...ASSET, is_cluster: true } });
      await waitFor(() => expect(toggle).toBeChecked());
      expect(document.activeElement).toBe(toggle);
    });

    it('keeps the other fields of the panel enabled while one saves', async () => {
      patch.mockImplementation(() => new Promise(() => undefined));
      renderAt('/it/assets/asset-1/overview');
      const toggle = await screen.findByRole('checkbox', { name: 'workspace.asset.meta.cluster' });
      await waitFor(() => expect(toggle).toBeEnabled());
      fireEvent.click(toggle);
      await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
      expect(screen.getByLabelText('workspace.asset.technical.adminZone')).not.toHaveAttribute('aria-disabled', 'true');
      expect(screen.getByPlaceholderText('workspace.asset.overview.searchAssetTypes')).toBeEnabled();
    });

    it('shows the server refusal and puts the switch back when a cluster still has members', async () => {
      patch.mockRejectedValue({ response: { status: 400, data: { code: 'cluster_has_members', params: { count: 2 } } } });
      renderAt('/it/assets/asset-1/overview', REACH, { ...ASSET, is_cluster: true });
      const toggle = await screen.findByRole('checkbox', { name: 'workspace.asset.meta.cluster' });
      await waitFor(() => expect(toggle).toBeChecked());
      fireEvent.click(toggle);
      expect(await screen.findByText('errors:cluster_has_members')).toBeInTheDocument();
      await waitFor(() => expect(toggle).toBeChecked());
      expect(del).not.toHaveBeenCalled();
    });

    it('explains the switch in a tooltip, and a reader why it is off', async () => {
      renderAt('/it/assets/asset-1/overview');
      expect(await screen.findByLabelText('workspace.asset.clusterSwitch.hint')).toBeInTheDocument();
    });

    it('tells a reader, on the greyed switch, that the role does not allow editing', async () => {
      auth.level = 'reader';
      renderAt('/it/assets/asset-1/overview');
      const toggle = await screen.findByRole('checkbox', { name: 'workspace.asset.meta.cluster' });
      expect(toggle).toBeDisabled();
      expect(screen.getByLabelText('workspace.asset.readOnlyRole')).toBeInTheDocument();
    });

    it('reads the members only once the server has made the asset a cluster', async () => {
      let resolvePatch: (value: unknown) => void = () => {};
      patch.mockImplementation(() => new Promise((resolve) => { resolvePatch = resolve; }));
      renderAt('/it/assets/asset-1/overview');
      const toggle = await screen.findByRole('checkbox', { name: 'workspace.asset.meta.cluster' });
      await waitFor(() => expect(toggle).toBeEnabled());
      fireEvent.click(toggle);
      await waitFor(() => expect(patch).toHaveBeenCalledWith('/assets/asset-1', { is_cluster: true }));
      const membersReads = () => get.mock.calls.filter(([url]) => String(url).endsWith('/members')).length;
      expect(membersReads()).toBe(0);
      resolvePatch({ data: { ...ASSET, is_cluster: true } });
      await waitFor(() => expect(membersReads()).toBe(1));
    });

    it('reads the clusters of the next asset, never its members, after a move from a cluster', async () => {
      renderAt('/it/assets/asset-1/dependencies', REACH, { ...ASSET, is_cluster: true });
      await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/asset-1/members'));
      fireEvent.click(screen.getByTestId('go-asset-2'));
      await waitFor(() => expect(get).toHaveBeenCalledWith('/assets/asset-2/clusters'));
      expect(get.mock.calls.filter(([url]) => url === '/assets/asset-2/members')).toHaveLength(0);
    });

    it('saves at once, and removes nothing, when a cluster becomes a server', async () => {
      patch.mockResolvedValue({ data: { ...ASSET, is_cluster: false } });
      renderAt('/it/assets/asset-1/overview', REACH, { ...ASSET, is_cluster: true });
      const toggle = await screen.findByRole('checkbox', { name: 'workspace.asset.meta.cluster' });
      await waitFor(() => expect(toggle).toBeChecked());
      fireEvent.click(toggle);
      await waitFor(() => expect(patch).toHaveBeenCalledWith('/assets/asset-1', { is_cluster: false }));
      expect(del).not.toHaveBeenCalled();
    });

    it('loads the cluster list that the Dependencies badge counts after the switch', async () => {
      wire.counts = { assets: 0, total: 0 };
      wire.members = [{ id: 'm1' }, { id: 'm2' }];
      wire.clusters = [{ id: 'c1' }];
      patch.mockResolvedValue({ data: { ...ASSET, is_cluster: true } });
      del.mockResolvedValue({ data: {} });
      renderAt('/it/assets/asset-1/overview');
      await waitFor(() => expect(screen.getByRole('tab', { name: /workspace.asset.tabs.dependencies/ }).textContent).toBe('workspace.asset.tabs.dependencies1'));
      fireEvent.click(await screen.findByRole('checkbox', { name: 'workspace.asset.meta.cluster' }));
      await waitFor(() => expect(screen.getByRole('tab', { name: /workspace.asset.tabs.dependencies/ }).textContent).toBe('workspace.asset.tabs.dependencies2'));
    });
  });

  describe('cluster sections of the Dependencies tab', () => {
    it('hands a cluster its members and the edit button, with a hint on the title and no info alert', async () => {
      wire.members = [{ id: 'm1', name: 'node-1', environment: 'prod', status: 'active', operating_system: null }];
      renderAt('/it/assets/asset-1/dependencies', REACH, { ...ASSET, is_cluster: true });
      expect(await screen.findByText('node-1')).toBeInTheDocument();
      expect(screen.getByText('workspace.asset.technical.members')).toBeInTheDocument();
      expect(screen.getByLabelText('workspace.asset.clusterSwitch.membersHint')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'workspace.asset.technical.editMembers' })).toBeEnabled();
      expect(screen.queryByText('workspace.asset.overview.clusterInfo')).toBeNull();
      expect(screen.queryByText('workspace.asset.technical.clusterMembership')).toBeNull();
      expect(screen.queryByText('workspace.asset.technical.saveClusterFirst')).toBeNull();
      // An empty value is the em dash, as elsewhere in the app.
      expect(screen.getByText('—')).toBeInTheDocument();
    });

    it('offers to add members to a cluster that has none, without an empty state', async () => {
      renderAt('/it/assets/asset-1/dependencies', REACH, { ...ASSET, is_cluster: true });
      expect(await screen.findByRole('button', { name: 'workspace.asset.technical.addMembers' })).toBeEnabled();
      expect(screen.queryByRole('button', { name: 'workspace.asset.technical.editMembers' })).toBeNull();
      expect(screen.queryByText('workspace.asset.technical.noMembers')).toBeNull();
    });

    it('says a cluster is loading its members before it offers to add some', async () => {
      let answer: (value: unknown) => void = () => undefined;
      renderAt('/it/assets/asset-1/dependencies', REACH, { ...ASSET, is_cluster: true });
      const read = get.getMockImplementation()!;
      get.mockImplementation(async (url: string, config?: unknown) => (
        url.endsWith('/members') ? new Promise((resolve) => { answer = resolve; }) : read(url, config)
      ));
      // A render of the same asset reads the members again: the answer is held back.
      fireEvent.click(await screen.findByTestId('go-asset-2'));
      fireEvent.click(await screen.findByTestId('go-asset-1'));
      expect(await screen.findByText('workspace.asset.technical.loadingMembers')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'workspace.asset.technical.addMembers' })).toBeNull();
      answer({ data: { items: [] } });
      expect(await screen.findByRole('button', { name: 'workspace.asset.technical.addMembers' })).toBeInTheDocument();
      expect(screen.queryByText('workspace.asset.technical.loadingMembers')).toBeNull();
    });

    it('says a server is loading its clusters before it says it is in none', async () => {
      let answer: (value: unknown) => void = () => undefined;
      renderAt('/it/assets/asset-1/dependencies');
      const read = get.getMockImplementation()!;
      get.mockImplementation(async (url: string, config?: unknown) => (
        url.endsWith('/clusters') ? new Promise((resolve) => { answer = resolve; }) : read(url, config)
      ));
      fireEvent.click(await screen.findByTestId('go-asset-2'));
      expect(await screen.findByText('workspace.asset.technical.loadingClusters')).toBeInTheDocument();
      expect(screen.queryByText('workspace.asset.technical.notInCluster')).toBeNull();
      answer({ data: { items: [] } });
      expect(await screen.findByText('workspace.asset.technical.notInCluster')).toBeInTheDocument();
      expect(screen.queryByText('workspace.asset.technical.loadingClusters')).toBeNull();
    });

    it('hands a server its cluster membership, without the cluster members', async () => {
      wire.clusters = [{ id: 'c1', name: 'cluster-1', environment: 'prod', status: 'active' }];
      renderAt('/it/assets/asset-1/dependencies');
      expect(await screen.findByText('workspace.asset.technical.clusterMembership')).toBeInTheDocument();
      expect(await screen.findByText('cluster-1')).toBeInTheDocument();
      expect(screen.queryByText('workspace.asset.technical.members')).toBeNull();
    });

    it('greys the members button for a reader, with the reason in a tooltip', async () => {
      auth.level = 'reader';
      renderAt('/it/assets/asset-1/dependencies', REACH, { ...ASSET, is_cluster: true });
      const button = await screen.findByRole('button', { name: 'workspace.asset.technical.addMembers' });
      expect(button).toBeDisabled();
      expect(button.parentElement).toHaveAttribute('aria-label', 'workspace.asset.readOnlyRole');
    });
  });

  describe('members dialog', () => {
    const CANDIDATES = [
      { id: 'asset-1', name: 'dc1', environment: 'prod', kind: 'virtual_machine', provider: 'on_prem', is_cluster: true },
      { id: 'srv-2', name: 'srv-2', environment: 'prod', kind: 'physical_server', provider: 'on_prem', is_cluster: false },
      { id: 'srv-3', name: 'srv-3', environment: 'qa', kind: 'virtual_machine', provider: 'on_prem', is_cluster: false },
    ];
    const CLUSTER = { ...ASSET, is_cluster: true };

    async function openDialog(asset: typeof ASSET & { operating_system?: string | null } = CLUSTER) {
      renderAt('/it/assets/asset-1/dependencies', REACH, asset);
      fireEvent.click(await screen.findByRole('button', { name: /workspace.asset.technical.(add|edit)Members/ }));
      const dialog = await dialogTitled('workspace.asset.editMembersDialog.title');
      const input = within(dialog).getByRole('combobox');
      return { dialog, input };
    }

    const open = (input: HTMLElement) => {
      fireEvent.mouseDown(input);
      fireEvent.keyDown(input, { key: 'ArrowDown' });
    };

    it('searches the servers that are not clusters, with the grid filter, and lists them in plain words without the asset itself', async () => {
      wire.candidates = CANDIDATES;
      const original = enumOptions.labelFor;
      enumOptions.labelFor = (field: string, code: string) => `${field}:${code}`;
      try {
        const { dialog, input } = await openDialog();
        await waitFor(() => expect(get).toHaveBeenCalledWith('/assets', {
          params: {
            q: undefined,
            limit: 50,
            sort: 'name:ASC',
            filters: JSON.stringify({ is_cluster: { filterType: 'set', values: ['false'] } }),
          },
        }));
        await waitFor(() => expect(within(dialog).queryByRole('progressbar')).toBeNull());
        open(input);
        const option = await screen.findByRole('option', { name: /srv-2/ });
        expect(option.textContent).toContain('enums.environment.prod / serverKind:physical_server / serverProvider:on_prem');
        expect(screen.getByRole('option', { name: /srv-3/ })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: /dc1/ })).toBeNull();
        expect(within(dialog).queryByText('workspace.asset.editMembersDialog.membersHint')).toBeNull();
      } finally {
        enumOptions.labelFor = original;
      }
    });

    it('sends the typed search to the server and invites to narrow a full list of results', async () => {
      wire.candidates = Array.from({ length: 50 }, (_, i) => ({ id: `s${i}`, name: `server-${i}`, environment: 'prod', kind: 'virtual_machine', provider: 'on_prem', is_cluster: false }));
      const { input } = await openDialog();
      open(input);
      const more = await screen.findByText('workspace.asset.editMembersDialog.narrowSearch');
      expect(more.closest('[role="option"]')).toHaveAttribute('aria-disabled', 'true');
      fireEvent.change(input, { target: { value: 'sql' } });
      await waitFor(() => expect(get).toHaveBeenCalledWith('/assets', expect.objectContaining({ params: expect.objectContaining({ q: 'sql' }) })));
    });

    it('starts from the current members and clears the error when the selection changes', async () => {
      wire.members = [{ id: 'm1', name: 'node-1', environment: 'prod', status: 'active', kind: 'virtual_machine', provider: 'on_prem', operating_system: null }];
      wire.candidates = CANDIDATES;
      post.mockRejectedValue({ response: { status: 400, data: { code: 'cluster_member_not_found' } } });
      const { dialog, input } = await openDialog();
      expect(within(dialog).getByText('node-1')).toBeInTheDocument();
      fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.save' }));
      expect(await within(dialog).findByText('errors:cluster_member_not_found')).toBeInTheDocument();
      open(input);
      fireEvent.click(await screen.findByRole('option', { name: /srv-2/ }));
      await waitFor(() => expect(within(dialog).queryByText('errors:cluster_member_not_found')).toBeNull());
    });

    it('asks before removing the operating system of a cluster that gets its first members, then sends the flag', async () => {
      wire.candidates = CANDIDATES;
      post.mockResolvedValue({ data: { items: [] } });
      const { dialog, input } = await openDialog({ ...CLUSTER, operating_system: 'Windows Server 2022' } as never);
      open(input);
      fireEvent.click(await screen.findByRole('option', { name: /srv-2/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.save' }));
      const ask = await dialogTitled('workspace.asset.editMembersDialog.removeOsTitle');
      expect(post).not.toHaveBeenCalled();
      fireEvent.click(within(ask).getByRole('button', { name: 'workspace.asset.editMembersDialog.removeOsConfirm' }));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/assets/asset-1/members', { server_ids: ['srv-2'], remove_operating_system: true }));
    });

    it('writes nothing, and keeps the dialog open, when the removal of the operating system is cancelled', async () => {
      wire.candidates = CANDIDATES;
      const { dialog, input } = await openDialog({ ...CLUSTER, operating_system: 'Windows Server 2022' } as never);
      open(input);
      fireEvent.click(await screen.findByRole('option', { name: /srv-2/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.save' }));
      const ask = await dialogTitled('workspace.asset.editMembersDialog.removeOsTitle');
      fireEvent.click(within(ask).getByRole('button', { name: 'buttons.cancel' }));
      await gone('workspace.asset.editMembersDialog.removeOsTitle');
      expect(post).not.toHaveBeenCalled();
      expect(screen.getByText('workspace.asset.editMembersDialog.title')).toBeInTheDocument();
    });

    it('sends no flag, and asks nothing, when the cluster carries no operating system', async () => {
      wire.candidates = CANDIDATES;
      post.mockResolvedValue({ data: { items: [] } });
      const { dialog, input } = await openDialog();
      open(input);
      fireEvent.click(await screen.findByRole('option', { name: /srv-2/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.save' }));
      await waitFor(() => expect(post).toHaveBeenCalledWith('/assets/asset-1/members', { server_ids: ['srv-2'] }));
    });

    it('asks the same question when the server finds an operating system set since the page loaded', async () => {
      wire.candidates = CANDIDATES;
      post.mockRejectedValueOnce({ response: { status: 400, data: { code: 'cluster_os_with_members', params: { os: 'Debian' } } } });
      post.mockResolvedValueOnce({ data: { items: [] } });
      const { dialog, input } = await openDialog();
      open(input);
      fireEvent.click(await screen.findByRole('option', { name: /srv-2/ }));
      fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.save' }));
      const ask = await dialogTitled('workspace.asset.editMembersDialog.removeOsTitle');
      fireEvent.click(within(ask).getByRole('button', { name: 'workspace.asset.editMembersDialog.removeOsConfirm' }));
      await waitFor(() => expect(post).toHaveBeenLastCalledWith('/assets/asset-1/members', { server_ids: ['srv-2'], remove_operating_system: true }));
      expect(post).toHaveBeenCalledTimes(2);
    });
  });

  describe('deleting an asset', () => {
    async function clickDelete() {
      auth.level = 'admin';
      renderAt('/it/assets/asset-1/overview');
      fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.delete' }));
    }

    it('adds the warnings of the delete check to the confirmation and reads "Delete anyway"', async () => {
      post.mockResolvedValue({
        data: {
          refused: [],
          warnings: [{
            id: 'asset-1', name: 'dc1',
            member_of: [{ id: 'c1', name: 'PAR-SQL-CL01' }],
            member_count: 0,
            relations: [{ id: 'a2', name: 'PAR-ESX-01', relation_type: 'depends_on', direction: 'outgoing' }],
            relations_total: 1,
          }],
        },
      });
      del.mockResolvedValue({ data: {} });
      await clickDelete();
      const dialog = await dialogTitled('systemDialogs.confirmTitle');
      expect(post).toHaveBeenCalledWith('/assets/delete-check', { ids: ['asset-1'] });
      expect(dialog.textContent).toContain('workspace.asset.deleteConfirm');
      expect(dialog.textContent).toContain('common:delete.assetWarning.memberOf');
      expect(dialog.textContent).toContain('common:delete.assetWarning.links');
      fireEvent.click(within(dialog).getByRole('button', { name: 'common:delete.anyway' }));
      await waitFor(() => expect(del).toHaveBeenCalledWith('/assets/asset-1'));
    });

    it('keeps the plain confirmation when the check has no warning', async () => {
      post.mockResolvedValue({ data: { refused: [], warnings: [] } });
      await clickDelete();
      const dialog = await dialogTitled('systemDialogs.confirmTitle');
      expect(dialog.textContent).toBe('systemDialogs.confirmTitle' + 'workspace.asset.deleteConfirm' + 'buttons.cancel' + 'common:buttons.delete');
    });
  });

  describe('dependencies and relations tabs', () => {
    const tabText = (name: string) => screen.getByRole('tab', { name: new RegExp(`workspace.asset.tabs.${name}`) }).textContent;

    it('puts Dependencies just before Relations and counts each from the one shared read', async () => {
      wire.counts = { assets: 3, total: 12 };
      wire.clusters = [{ id: 'c1', name: 'cluster-1' }, { id: 'c2', name: 'cluster-2' }];
      renderAt('/it/assets/asset-1/overview');
      await waitFor(() => expect(tabText('dependencies')).toBe('workspace.asset.tabs.dependencies5'));
      expect(tabText('relations')).toBe('workspace.asset.tabs.relations12');
      const tabs = screen.getAllByRole('tab').map((tab) => tab.textContent);
      expect(tabs.indexOf('workspace.asset.tabs.dependencies5')).toBe(tabs.indexOf('workspace.asset.tabs.relations12') - 1);
      expect(get.mock.calls.filter(([url]) => url === '/assets/asset-1/relations-tab')).toHaveLength(1);
    });

    it('counts the members of a cluster instead of its clusters', async () => {
      wire.counts = { assets: 1, total: 0 };
      wire.members = [{ id: 'm1' }, { id: 'm2' }, { id: 'm3' }];
      wire.clusters = [{ id: 'c1' }];
      renderAt('/it/assets/asset-1/overview', REACH, { ...ASSET, is_cluster: true });
      await waitFor(() => expect(tabText('dependencies')).toBe('workspace.asset.tabs.dependencies4'));
      expect(tabText('relations')).toBe('workspace.asset.tabs.relations0');
    });

    it('renders the Dependencies tab on /dependencies only', async () => {
      renderAt('/it/assets/asset-1/dependencies');
      expect(await screen.findByText('dependencies-tab')).toBeInTheDocument();
    });

    it('does not render the Dependencies tab elsewhere', async () => {
      renderAt('/it/assets/asset-1/overview');
      await screen.findByText('support-panel');
      expect(screen.queryByText('dependencies-tab')).toBeNull();
    });
  });

  describe('tabs', () => {
    const tabNames = () => screen.getAllByRole('tab').map((tab) => tab.textContent?.replace(/\d+$/, ''));
    const tab = (name: string) => screen.getByRole('tab', { name: new RegExp(`workspace.asset.tabs.${name}`) });

    it('lists Overview, Operations, Network, Dependencies and Relations for a virtual asset, all open', async () => {
      renderAt('/it/assets/asset-1/overview');
      await screen.findByText('support-panel');
      expect(tabNames()).toEqual([
        'workspace.asset.tabs.overview',
        'workspace.asset.tabs.operations',
        'workspace.asset.tabs.network',
        'workspace.asset.tabs.dependencies',
        'workspace.asset.tabs.relations',
      ]);
      screen.getAllByRole('tab').forEach((node) => expect(node).toBeEnabled());
    });

    it('puts Hardware after Network for a physical asset', async () => {
      renderAt('/it/assets/asset-1/overview', REACH, { ...ASSET, kind: 'physical_server' });
      await waitFor(() => expect(tabNames()).toEqual([
        'workspace.asset.tabs.overview',
        'workspace.asset.tabs.operations',
        'workspace.asset.tabs.network',
        'workspace.asset.tabs.hardware',
        'workspace.asset.tabs.dependencies',
        'workspace.asset.tabs.relations',
      ]));
    });

    it('opens only Overview and Network when creating an asset', async () => {
      renderAt('/it/assets/new/overview');
      await screen.findByText('workspace.asset.overview.basics');
      expect(tabNames()).toEqual([
        'workspace.asset.tabs.overview',
        'workspace.asset.tabs.operations',
        'workspace.asset.tabs.network',
        'workspace.asset.tabs.dependencies',
        'workspace.asset.tabs.relations',
      ]);
      expect(tab('overview')).toBeEnabled();
      expect(tab('network')).toBeEnabled();
      expect(tab('operations')).toBeDisabled();
      expect(tab('dependencies')).toBeDisabled();
      expect(tab('relations')).toBeDisabled();
    });
  });

  describe('former and unknown tab addresses', () => {
    it.each([
      ['technical', 'operations'],
      ['support', 'overview'],
      ['connections', 'network'],
      ['knowledge', 'overview'],
      ['assignments', 'operations'],
      ['nonsense', 'overview'],
      ['toString', 'overview'],
    ])('sends /%s to /%s', async (from, to) => {
      renderAt(`/it/assets/asset-1/${from}`);
      await waitFor(() => expect(currentPath()).toMatch(new RegExp(`^/it/assets/(asset-1|AST-1)/${to}$`)));
      expect(screen.getByRole('tab', { name: new RegExp(`workspace.asset.tabs.${to}`) })).toHaveAttribute('aria-selected', 'true');
    });

    it('sends the hardware tab of a virtual asset to the overview', async () => {
      renderAt('/it/assets/asset-1/hardware');
      await waitFor(() => expect(currentPath()).toBe('/it/assets/AST-1/overview'));
    });

    it('sends a creation on a tab it cannot open to the overview', async () => {
      renderAt('/it/assets/new/operations');
      await waitFor(() => expect(currentPath()).toBe('/it/assets/new/overview'));
      expect(await screen.findByText('workspace.asset.overview.basics')).toBeInTheDocument();
    });
  });

  describe('creating an asset', () => {
    const startCreation = async () => {
      renderAt('/it/assets/new/overview');
      fireEvent.change(await screen.findByPlaceholderText('workspace.asset.overview.namePlaceholder'), { target: { value: 'web 1' } });
      fireEvent.click(screen.getAllByText('pick-location')[0]);
      await waitFor(() => expect(get).toHaveBeenCalledWith('/locations/loc-1'));
      fireEvent.click(screen.getByRole('tab', { name: /workspace.asset.tabs.network/ }));
      await waitFor(() => expect(currentPath()).toBe('/it/assets/new/network'));
      return screen.getByPlaceholderText('workspace.asset.technical.hostnamePlaceholder');
    };
    const create = async () => {
      fireEvent.click(screen.getByRole('tab', { name: /workspace.asset.tabs.overview/ }));
      await waitFor(() => expect(currentPath()).toBe('/it/assets/new/overview'));
      const button = screen.getByRole('button', { name: 'common:buttons.create' });
      await waitFor(() => expect(button).toBeEnabled());
      fireEvent.click(button);
    };

    it('keeps the host name typed in the network tab and sends it from the overview', async () => {
      post.mockResolvedValue({ data: { id: 'asset-9', asset_reference: 'AST-9' } });
      const hostname = await startCreation();
      fireEvent.change(hostname, { target: { value: 'web-01' } });
      await create();
      await waitFor(() => expect(post).toHaveBeenCalledWith('/assets', expect.objectContaining({ name: 'web 1', hostname: 'web-01' })));
    });

    it('opens the network tab when the host name is malformed', async () => {
      const hostname = await startCreation();
      fireEvent.change(hostname, { target: { value: 'web 01!' } });
      await create();
      await waitFor(() => expect(currentPath()).toBe('/it/assets/new/network'));
      expect(screen.getAllByText('workspace.asset.technical.hostnameInvalid').length).toBeGreaterThan(0);
      expect(post).not.toHaveBeenCalled();
    });
  });

  describe('vulnerabilities', () => {
    beforeEach(() => {
      features.vulnerabilityFeed = true;
    });

    it('shows the section last in the operations tab, after technologies', async () => {
      renderAt('/it/assets/asset-1/operations');
      const section = await screen.findByText('pages.vulnerabilities.section.title');
      const technologies = screen.getByText('technologies-section');
      expect(follows(technologies, section)).toBe(true);
      expect(screen.getByText('OpenSSL')).toBeInTheDocument();
      expect(document.getElementById('vulnerabilities')).not.toBeNull();
    });

    it('asks nothing and shows nothing while the vulnerability feed is off', async () => {
      features.vulnerabilityFeed = false;
      renderAt('/it/assets/asset-1/operations');
      await screen.findByText('technologies-section');
      expect(screen.queryByText('pages.vulnerabilities.section.title')).toBeNull();
      expect(screen.queryByTestId('vulnerability-severe-badge')).toBeNull();
      expect(vulnerabilityCalls()).toBe(0);
    });

    it('asks nothing when creating an asset', async () => {
      renderAt('/it/assets/new/network');
      await screen.findByText('workspace.asset.technical.ipAddresses');
      expect(screen.queryByText('pages.vulnerabilities.section.title')).toBeNull();
      expect(vulnerabilityCalls()).toBe(0);
    });

    it('shows neither section nor badge for a retired asset', async () => {
      renderAt('/it/assets/asset-1/operations', { rows: [], indirect: [], totals: null });
      await screen.findByText('technologies-section');
      await waitFor(() => expect(vulnerabilityCalls()).toBe(1));
      expect(screen.queryByText('pages.vulnerabilities.section.title')).toBeNull();
      expect(screen.queryByTestId('vulnerability-severe-badge')).toBeNull();
    });

    it('links the severe badge to the Vulnerabilities page filtered on the asset', async () => {
      renderAt('/it/assets/asset-1/overview');
      const badge = await screen.findByTestId('vulnerability-severe-badge');
      expect(badge.querySelector('[data-severity="critical"]')).not.toBeNull();
      expect(badge.querySelector('[data-exploited]')).not.toBeNull();
      expect(screen.getByRole('link', { name: 'pages.vulnerabilities.severeBadge.hint' }).getAttribute('href'))
        .toBe('/it/vulnerabilities?asset=AST-1');
      expect(vulnerabilityCalls()).toBe(1);
    });

    it('counts a cluster on its members: the badge and the section follow member_totals, and say so', async () => {
      renderAt('/it/assets/asset-1/operations', {
        ...REACH,
        // Its own links count nothing: only the members' CVE raise the badge.
        totals: { open: 0, severe: 0, exploited_severe: 0 },
        member_totals: { open: 11, severe: 7, exploited_severe: 2 },
      });
      const badge = await screen.findByTestId('vulnerability-severe-badge');
      expect(badge.textContent).toContain('pages.vulnerabilities.severeBadge.label');
      expect(screen.getByRole('link', { name: 'pages.vulnerabilities.severeBadge.hintMembers' }).getAttribute('href'))
        .toBe('/it/vulnerabilities?asset=AST-1');
      expect(screen.queryByRole('link', { name: 'pages.vulnerabilities.severeBadge.hint' })).toBeNull();
      expect((await screen.findByTestId('reach-vulnerabilities-count')).textContent).toBe('11');
    });

    it('links the section count to the Vulnerabilities page filtered on the asset', async () => {
      renderAt('/it/assets/asset-1/operations');
      const count = await screen.findByTestId('reach-vulnerabilities-count');
      expect(count.textContent).toBe('3');
      expect(count.getAttribute('href')).toBe('/it/vulnerabilities?asset=AST-1');
    });

    it('shows no badge without severe vulnerabilities', async () => {
      renderAt('/it/assets/asset-1/operations', {
        rows: [{ ...REACH.rows[0], open: { ...OPEN, critical: 0, high: 0, medium: 2 }, severe: 0, exploited_severe: 0 }],
        indirect: [],
        totals: { open: 2, severe: 0, exploited_severe: 0 },
      });
      await screen.findByText('pages.vulnerabilities.section.title');
      expect(screen.queryByTestId('vulnerability-severe-badge')).toBeNull();
    });

    it('shows the metadata bar in one go, once the vulnerabilities have arrived', async () => {
      let answer: (value: unknown) => void = () => undefined;
      renderAt('/it/assets/asset-1/network', () => new Promise((resolve) => { answer = resolve; }));
      await waitFor(() => expect(screen.getByPlaceholderText('workspace.asset.technical.hostnamePlaceholder')).toHaveValue('dc1'));
      await waitFor(() => expect(vulnerabilityCalls()).toBe(1));
      expect(screen.getByTestId('metadata-pending')).toHaveAttribute('aria-hidden', 'true');
      expect(screen.queryByTestId('vulnerability-severe-badge')).toBeNull();
      answer({ data: REACH });
      expect(await screen.findByTestId('vulnerability-severe-badge')).toBeInTheDocument();
      expect(screen.queryByTestId('metadata-pending')).toBeNull();
    });

    it('shows the metadata bar without the badge when the vulnerabilities cannot be read', async () => {
      renderAt('/it/assets/asset-1/overview', () => Promise.reject(new Error('down')));
      await waitFor(() => expect(vulnerabilityCalls()).toBe(1));
      await waitFor(() => expect(screen.queryByTestId('metadata-pending')).toBeNull());
      expect(screen.queryByTestId('vulnerability-severe-badge')).toBeNull();
    });

    it('shows the metadata bar without waiting while the vulnerability feed is off', async () => {
      features.vulnerabilityFeed = false;
      renderAt('/it/assets/asset-1/network');
      await waitFor(() => expect(screen.getByPlaceholderText('workspace.asset.technical.hostnamePlaceholder')).toHaveValue('dc1'));
      expect(screen.queryByTestId('metadata-pending')).toBeNull();
      expect(vulnerabilityCalls()).toBe(0);
    });

    it('reads the vulnerabilities again after a change of technology links', async () => {
      const queryClient = renderAt('/it/assets/asset-1/operations');
      await screen.findByText('pages.vulnerabilities.section.title');
      expect(vulnerabilityCalls()).toBe(1);
      await invalidateTechnologyLinks(queryClient);
      await waitFor(() => expect(vulnerabilityCalls()).toBe(2));
    });
  });
});
