import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string, level: string) => resource === 'infrastructure' && level === 'member' }),
}));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    settings: { hostingTypes: [], serverKinds: [{ code: 'virtual_machine', label: 'Virtual machine', is_physical: false }], domains: [], subnets: [] },
    byField: {
      adminZone: [],
      serverKind: [{ code: 'virtual_machine', label: 'Virtual machine' }],
      lifecycleStatus: [{ code: 'active', label: 'Active' }],
      serverRole: [],
      serverProvider: [{ code: 'on_prem', label: 'On premises' }],
      ipAddressType: [],
    },
    labelFor: (_field: string, code: string) => code,
  }),
}));
vi.mock('../../hooks/useAssetNav', () => ({
  useAssetNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('./editors/HardwareInfoPanel', () => ({ default: () => null }));
vi.mock('./editors/SupportInfoPanel', () => ({ default: () => null }));
vi.mock('./workspace/AssetRelationsTab', () => ({ default: () => null }));
vi.mock('./workspace/AssetDependenciesTab', () => ({
  default: ({ clusterSection }: { clusterSection?: React.ReactNode }) => <div>dependencies-tab{clusterSection}</div>,
}));
vi.mock('./components/AssetTechnologiesSection', async (importOriginal) => ({ ...(await importOriginal<any>()), default: () => <div>technologies-section</div> }));
vi.mock('../../components/EntityKnowledgePanel', () => ({ default: () => null }));
vi.mock('../../components/fields/LocationSelect', () => ({ default: () => <div /> }));
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
const wire = vi.hoisted(() => ({ counts: { assets: 0, total: 0 } as Record<string, number>, members: [] as unknown[], clusters: [] as unknown[] }));

function renderAt(path: string, reach: unknown = REACH, asset: typeof ASSET | (() => Promise<unknown>) = ASSET) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockImplementation(async (url: string) => {
    if (url === '/assets/asset-1' || url === '/assets/by-ref/AST-1') return typeof asset === 'function' ? asset() : { data: asset };
    if (url === VULNERABILITIES_URL) return typeof reach === 'function' ? reach() : { data: reach };
    if (url === '/locations') return { data: { items: [] } };
    if (url.endsWith('/assignments')) return { data: [] };
    if (url === '/assets/asset-1/relations-tab') return { data: { counts: wire.counts } };
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
              <Route path="/it/assets/:id/:tab" element={<AssetWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  return queryClient;
}

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

  it('shows identity in the overview, right after the description', async () => {
    renderAt('/it/assets/asset-1/overview');
    await waitFor(() => expect(screen.getByPlaceholderText('workspace.asset.technical.hostnamePlaceholder')).toHaveValue('dc1'));
    const identity = await screen.findByText('workspace.asset.technical.identity');
    const description = screen.getByText('workspace.asset.overview.description');
    const assignments = screen.getByText('workspace.asset.assignments.title');
    expect(follows(description, identity)).toBe(true);
    expect(follows(identity, assignments)).toBe(true);
  });

  it('leaves the FQDN out of the metadata bar: identity shows it', async () => {
    renderAt('/it/assets/asset-1/overview', REACH, { ...ASSET, hostname: 'srv-fqdn', fqdn: 'srv-fqdn' });
    await waitFor(() => expect(screen.getByPlaceholderText('workspace.asset.technical.hostnamePlaceholder')).toHaveValue('srv-fqdn'));
    expect(screen.getAllByDisplayValue('srv-fqdn').length).toBeGreaterThan(1);
    expect(screen.queryByText('srv-fqdn')).toBeNull();
  });

  it('lists IP addresses before technologies in the technical tab, without identity', async () => {
    renderAt('/it/assets/asset-1/technical');
    const ipAddresses = await screen.findByText('workspace.asset.technical.ipAddresses');
    const technologies = await screen.findByText('technologies-section');
    expect(screen.queryByText('workspace.asset.technical.clusterManagement')).toBeNull();
    expect(screen.queryByText('workspace.asset.technical.members')).toBeNull();
    expect(screen.queryByText('workspace.asset.technical.clusterMembership')).toBeNull();
    expect(follows(ipAddresses, technologies)).toBe(true);
    expect(screen.queryByText('workspace.asset.technical.identity')).toBeNull();
  });

  it('keeps identity editable when creating an asset', async () => {
    renderAt('/it/assets/new/overview');
    await screen.findByText('workspace.asset.technical.identity');
    expect(screen.getByPlaceholderText('workspace.asset.technical.hostnamePlaceholder')).toBeEnabled();
  });

  it('keeps IP addresses, and no cluster section, in the technical tab when creating an asset', async () => {
    renderAt('/it/assets/new/technical');
    expect(await screen.findByText('workspace.asset.technical.ipAddresses')).toBeInTheDocument();
    expect(screen.queryByText('workspace.asset.technical.clusterManagement')).toBeNull();
    expect(screen.queryByText('technologies-section')).toBeNull();
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
      renderAt('/it/assets/asset-1/technical');
      await screen.findByText('workspace.asset.technical.ipAddresses');
      expectPanelOrder();
    });

    it('shows the same rows when creating an asset', async () => {
      renderAt('/it/assets/new/technical');
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

    it('saves at once, and removes the operating system, when an asset becomes a cluster', async () => {
      patch.mockResolvedValue({ data: { ...ASSET, is_cluster: true } });
      del.mockResolvedValue({ data: {} });
      renderAt('/it/assets/asset-1/overview');
      const toggle = await screen.findByRole('checkbox', { name: 'workspace.asset.meta.cluster' });
      await waitFor(() => expect(toggle).toBeEnabled());
      fireEvent.click(toggle);
      await waitFor(() => expect(patch).toHaveBeenCalledWith('/assets/asset-1', { is_cluster: true }));
      await waitFor(() => expect(del).toHaveBeenCalledWith('/assets/asset-1/operating-system'));
      await waitFor(() => expect(toggle).toBeChecked());
    });

    it('reads the members only once the server has made the asset a cluster', async () => {
      let resolvePatch: (value: unknown) => void = () => {};
      patch.mockImplementation(() => new Promise((resolve) => { resolvePatch = resolve; }));
      del.mockResolvedValue({ data: {} });
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
    it('hands a cluster its info, its members and the edit button', async () => {
      wire.members = [{ id: 'm1', name: 'node-1', environment: 'prod', status: 'active', operating_system: 'Linux' }];
      renderAt('/it/assets/asset-1/dependencies', REACH, { ...ASSET, is_cluster: true });
      expect(await screen.findByText('workspace.asset.overview.clusterInfo')).toBeInTheDocument();
      expect(await screen.findByText('node-1')).toBeInTheDocument();
      expect(screen.getByText('workspace.asset.technical.members')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'workspace.asset.technical.editMembers' })).toBeEnabled();
      expect(screen.queryByText('workspace.asset.technical.clusterMembership')).toBeNull();
      expect(screen.queryByText('workspace.asset.technical.saveClusterFirst')).toBeNull();
    });

    it('hands a server its cluster membership, without the cluster info', async () => {
      wire.clusters = [{ id: 'c1', name: 'cluster-1', environment: 'prod', status: 'active' }];
      renderAt('/it/assets/asset-1/dependencies');
      expect(await screen.findByText('workspace.asset.technical.clusterMembership')).toBeInTheDocument();
      expect(await screen.findByText('cluster-1')).toBeInTheDocument();
      expect(screen.queryByText('workspace.asset.overview.clusterInfo')).toBeNull();
      expect(screen.queryByText('workspace.asset.technical.members')).toBeNull();
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
      await screen.findByText('workspace.asset.technical.identity');
      expect(screen.queryByText('dependencies-tab')).toBeNull();
    });
  });

  describe('vulnerabilities', () => {
    beforeEach(() => {
      features.vulnerabilityFeed = true;
    });

    it('shows the section last in the technical tab, after technologies', async () => {
      renderAt('/it/assets/asset-1/technical');
      const section = await screen.findByText('pages.vulnerabilities.section.title');
      const technologies = screen.getByText('technologies-section');
      expect(follows(technologies, section)).toBe(true);
      expect(screen.getByText('OpenSSL')).toBeInTheDocument();
      expect(document.getElementById('vulnerabilities')).not.toBeNull();
    });

    it('asks nothing and shows nothing while the vulnerability feed is off', async () => {
      features.vulnerabilityFeed = false;
      renderAt('/it/assets/asset-1/technical');
      await screen.findByText('technologies-section');
      expect(screen.queryByText('pages.vulnerabilities.section.title')).toBeNull();
      expect(screen.queryByTestId('vulnerability-severe-badge')).toBeNull();
      expect(vulnerabilityCalls()).toBe(0);
    });

    it('asks nothing when creating an asset', async () => {
      renderAt('/it/assets/new/technical');
      await screen.findByText('workspace.asset.technical.ipAddresses');
      expect(screen.queryByText('pages.vulnerabilities.section.title')).toBeNull();
      expect(vulnerabilityCalls()).toBe(0);
    });

    it('shows neither section nor badge for a retired asset', async () => {
      renderAt('/it/assets/asset-1/technical', { rows: [], indirect: [], totals: null });
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

    it('links the section count to the Vulnerabilities page filtered on the asset', async () => {
      renderAt('/it/assets/asset-1/technical');
      const count = await screen.findByTestId('reach-vulnerabilities-count');
      expect(count.textContent).toBe('3');
      expect(count.getAttribute('href')).toBe('/it/vulnerabilities?asset=AST-1');
    });

    it('shows no badge without severe vulnerabilities', async () => {
      renderAt('/it/assets/asset-1/technical', {
        rows: [{ ...REACH.rows[0], open: { ...OPEN, critical: 0, high: 0, medium: 2 }, severe: 0, exploited_severe: 0 }],
        indirect: [],
        totals: { open: 2, severe: 0, exploited_severe: 0 },
      });
      await screen.findByText('pages.vulnerabilities.section.title');
      expect(screen.queryByTestId('vulnerability-severe-badge')).toBeNull();
    });

    it('shows the metadata bar in one go, once the vulnerabilities have arrived', async () => {
      let answer: (value: unknown) => void = () => undefined;
      renderAt('/it/assets/asset-1/overview', () => new Promise((resolve) => { answer = resolve; }));
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
      renderAt('/it/assets/asset-1/overview');
      await waitFor(() => expect(screen.getByPlaceholderText('workspace.asset.technical.hostnamePlaceholder')).toHaveValue('dc1'));
      expect(screen.queryByTestId('metadata-pending')).toBeNull();
      expect(vulnerabilityCalls()).toBe(0);
    });

    it('reads the vulnerabilities again after a change of technology links', async () => {
      const queryClient = renderAt('/it/assets/asset-1/technical');
      await screen.findByText('pages.vulnerabilities.section.title');
      expect(vulnerabilityCalls()).toBe(1);
      await invalidateTechnologyLinks(queryClient);
      await waitFor(() => expect(vulnerabilityCalls()).toBe(2));
    });
  });
});
