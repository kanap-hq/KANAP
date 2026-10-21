import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import AssetWorkspacePage from './AssetWorkspacePage';
import { invalidateTechnologyLinks } from './components/technologyLinkQueries';

const get = vi.hoisted(() => vi.fn());
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
vi.mock('../../api', () => ({ default: { get, patch: vi.fn(), post: vi.fn(), delete: vi.fn() } }));
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
vi.mock('./editors/AssetRelationsPanel', () => ({ default: () => null }));
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

function renderAt(path: string, reach: unknown = REACH, asset: typeof ASSET | (() => Promise<unknown>) = ASSET) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockImplementation(async (url: string) => {
    if (url === '/assets/asset-1' || url === '/assets/by-ref/AST-1') return typeof asset === 'function' ? asset() : { data: asset };
    if (url === VULNERABILITIES_URL) return typeof reach === 'function' ? reach() : { data: reach };
    if (url === '/locations') return { data: { items: [] } };
    if (url.endsWith('/assignments')) return { data: [] };
    if (url.endsWith('/clusters') || url.endsWith('/members')) return { data: { items: [] } };
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
    const cluster = screen.getByText('workspace.asset.technical.clusterManagement');
    expect(follows(cluster, ipAddresses)).toBe(true);
    expect(follows(ipAddresses, technologies)).toBe(true);
    expect(screen.queryByText('workspace.asset.technical.identity')).toBeNull();
  });

  it('keeps identity editable when creating an asset', async () => {
    renderAt('/it/assets/new/overview');
    await screen.findByText('workspace.asset.technical.identity');
    expect(screen.getByPlaceholderText('workspace.asset.technical.hostnamePlaceholder')).toBeEnabled();
  });

  it('keeps cluster management and IP addresses in the technical tab when creating an asset', async () => {
    renderAt('/it/assets/new/technical');
    expect(await screen.findByText('workspace.asset.technical.clusterManagement')).toBeInTheDocument();
    expect(screen.getByText('workspace.asset.technical.ipAddresses')).toBeInTheDocument();
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
      await screen.findByText('workspace.asset.technical.clusterManagement');
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
