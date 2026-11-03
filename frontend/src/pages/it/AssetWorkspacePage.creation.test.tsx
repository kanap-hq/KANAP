import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import NavigationTracker, { resetNavigationTracker } from '../../components/navigation/NavigationTracker';
import { resetCreationStore } from '../../components/workspace/creation/creationStore';
import api from '../../api';
import AssetWorkspacePage from './AssetWorkspacePage';

// Creation at the title (lot 3): the name committed in the header creates the asset with the type,
// environment, provider and lifecycle shown, without a site; Create names the site while it is
// missing and focuses it, or closes the asset; Cancel deletes it.

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => undefined } }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: { vulnerabilityFeed: false } } }) }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: (_resource: string, level: string) => level !== 'admin' }) }));
// One object for every render, as the real hook memoises it.
const enumOptions = vi.hoisted(() => ({
  settings: {
    hostingTypes: [],
    serverKinds: [
      { code: 'physical_server', label: 'Physical server', is_physical: true },
      { code: 'virtual_machine', label: 'Virtual machine', is_physical: false },
    ],
    domains: [],
    subnets: [],
  },
  byField: {
    adminZone: [],
    serverKind: [{ code: 'physical_server', label: 'Physical server' }, { code: 'virtual_machine', label: 'Virtual machine' }],
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
vi.mock('./editors/SupportInfoPanel', () => ({ default: () => null }));
vi.mock('./workspace/AssetRelationsTab', () => ({ default: () => null }));
vi.mock('./workspace/AssetDependenciesTab', () => ({ default: () => null }));
vi.mock('./components/AssetTechnologiesSection', async (importOriginal) => ({ ...(await importOriginal<any>()), default: () => null }));
vi.mock('../../components/EntityKnowledgePanel', () => ({ default: () => null }));
vi.mock('../../components/fields/LocationSelect', () => ({
  default: ({ onChange }: { onChange: (value: string | null) => void }) => (
    <>
      <input aria-label="site" />
      <button type="button" onClick={() => onChange('loc-1')}>pick-location</button>
    </>
  ),
}));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/MarkdownEditor', () => ({ default: () => <div data-testid="description-editor" /> }));
vi.mock('../../components/history/RecordHistoryTab', () => ({ default: () => null }));

const mocked = vi.mocked(api);
const TITLE = 'common:buttons.editTitle';
const created = {
  id: 'asset-new',
  asset_reference: 'AST-7',
  name: 'Web 1',
  kind: 'virtual_machine',
  provider: 'on_prem',
  environment: 'prod',
  status: 'active',
  is_cluster: false,
  hostname: 'web-1',
  location_id: null,
  creation_token: 'token-1',
};
const detail = {
  ...created,
  creation_token: undefined,
  domain: '',
  admin_zone: '',
  fqdn: 'web-1',
  aliases: [],
  ip_addresses: [],
  go_live_date: null,
  end_of_life_date: null,
  notes: '',
  external_links: [],
};

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function StartPage() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/it/assets/new/overview')}>new asset</button>;
}

function renderPage(entries: string[]) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/assets/by-ref/AST-7' || url === '/assets/asset-new') return { data: detail } as never;
    if (url === '/assets/asset-new/creation') return { data: { changes: { fields: 0, children: {} } } } as never;
    if (url === '/locations/loc-1') return { data: { id: 'loc-1', location_reference: 'LOC-1', name: 'Paris', hosting_type: 'on_prem' } } as never;
    if (url.endsWith('/sub-items')) return { data: [] } as never;
    return { data: { items: [], outgoing: [], incoming: [] } } as never;
  });
  mocked.post.mockImplementation(async (url: string) => {
    if (url === '/assets/creation') return { data: created } as never;
    return { data: { ok: true } } as never;
  });
  mocked.patch.mockImplementation(async (_url: string, body?: unknown) => ({ data: { ...detail, ...(body as object) } }) as never);
  mocked.delete.mockResolvedValue({ data: undefined } as never);
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={entries}>
            <NavigationTracker />
            <Location />
            <Routes>
              <Route path="/start" element={<StartPage />} />
              <Route path="/it/assets" element={<div data-testid="asset-list" />} />
              <Route path="/it/assets/:id/:tab" element={<AssetWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

function location() {
  return screen.getByTestId('location').textContent;
}

async function typeTitle(value: string) {
  const input = await screen.findByRole('textbox', { name: TITLE });
  fireEvent.change(input, { target: { value } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

async function createAsset() {
  renderPage(['/start']);
  fireEvent.click(await screen.findByRole('button', { name: 'new asset' }));
  await typeTitle('Web 1');
  await waitFor(() => expect(location()).toBe('/it/assets/AST-7/overview'));
  await screen.findByRole('button', { name: TITLE });
}

describe('Asset creation at the title', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetCreationStore();
    resetNavigationTracker();
  });

  it('opens with the title to type and the asset to come dimmed, nothing written', async () => {
    renderPage(['/it/assets/new/overview']);
    const input = await screen.findByRole('textbox', { name: TITLE });
    expect(input).toHaveFocus();
    expect(screen.getByRole('button', { name: 'common:buttons.create' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common.close' })).toBeNull();
    const previews = screen.getAllByTestId('creation-preview');
    expect(previews.length).toBeGreaterThan(0);
    for (const preview of previews) {
      expect(preview).toHaveAttribute('inert');
      expect(within(preview).queryAllByRole('textbox')).toHaveLength(0);
    }
    for (const tab of screen.getAllByRole('tab').slice(1)) expect(tab).toBeDisabled();
    expect(mocked.post).not.toHaveBeenCalled();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('creates the asset from its title, as a virtual machine in production, and opens it', async () => {
    await createAsset();
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(mocked.post).toHaveBeenCalledWith('/assets/creation', {
      name: 'Web 1',
      kind: 'virtual_machine',
      environment: 'prod',
      provider: 'on_prem',
      status: 'active',
      is_cluster: false,
      hostname: 'web-1',
    });
    expect(screen.queryByTestId('creation-preview')).toBeNull();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
  });

  it('creates a cluster when the list asked for one', async () => {
    renderPage(['/it/assets/new/overview?cluster=1']);
    await typeTitle('Web 1');
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/assets/creation', expect.objectContaining({ is_cluster: true })));
  });

  it('checks the asset when Create is clicked while the title is typed, and names the site', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new asset' }));
    const input = await screen.findByRole('textbox', { name: TITLE });
    fireEvent.change(input, { target: { value: 'Web 1' } });
    mocked.post.mockImplementation(async (url: string) => {
      if (url === '/assets/creation') return { data: created } as never;
      throw { response: { status: 400, data: { code: 'CREATION_INCOMPLETE', params: { fields: ['location'] } } } };
    });
    // In a browser the click's mousedown blurs the title first, which commits it.
    fireEvent.blur(input);
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('workspace.asset.creation.missing(fields=workspace.asset.overview.location)')).toBeTruthy();
    expect(mocked.post).toHaveBeenLastCalledWith('/assets/asset-new/creation/complete', { token: 'token-1' });
    expect(location()).toBe('/it/assets/AST-7/overview');
  });

  it('creates the asset on Tab out of the title and puts the focus on its site', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new asset' }));
    const input = await screen.findByRole('textbox', { name: TITLE });
    fireEvent.change(input, { target: { value: 'Web 1' } });
    fireEvent.keyDown(input, { key: 'Tab' });
    await waitFor(() => expect(location()).toBe('/it/assets/AST-7/overview'));
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'site' })).toHaveFocus());
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });

  it('names the missing site on Create, focuses it and stays', async () => {
    await createAsset();
    mocked.post.mockRejectedValueOnce({
      response: { status: 400, data: { code: 'CREATION_INCOMPLETE', params: { fields: ['location'] } } },
    });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('workspace.asset.creation.missing(fields=workspace.asset.overview.location)')).toBeTruthy();
    expect(mocked.post).toHaveBeenLastCalledWith('/assets/asset-new/creation/complete', { token: 'token-1' });
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'site' })).toHaveFocus());
    expect(location()).toBe('/it/assets/AST-7/overview');
  });

  it('closes the asset on Create once it has a site, back where the creation started', async () => {
    await createAsset();
    fireEvent.click(screen.getAllByText('pick-location')[0]);
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith('/assets/asset-new', { location_id: 'loc-1', sub_location_id: null }));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.post).toHaveBeenLastCalledWith('/assets/asset-new/creation/complete', { token: 'token-1' });
    expect(mocked.delete).not.toHaveBeenCalled();
  });

  it('deletes the asset on Cancel and goes back where it started', async () => {
    await createAsset();
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.cancel' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.delete).toHaveBeenCalledWith('/assets/asset-new/creation', { data: { token: 'token-1' } });
  });

  it('asks before leaving an asset being created without a site, and deletes it on Delete', async () => {
    await createAsset();
    fireEvent.click(screen.getByRole('button', { name: 'pages.assets.title' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('it:workspace.asset.creation.missing(fields=workspace.asset.overview.location)')).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'it:workspace.asset.creation.leaveDelete' }));
    await waitFor(() => expect(location()).toBe('/it/assets'));
    expect(mocked.delete).toHaveBeenCalledWith('/assets/asset-new/creation', { data: { token: 'token-1' } });
  });
});
