import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
import { TITLE_FIELD } from '../../test/titleField';

// An asset born complete in a workspace without any site (lot L3b of 26.11.9): name, Tab, the cursor
// is in the site, its list offers to create one; the site created from the picker is chosen and
// completes the asset, written once with it.

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
    hostingType: [{ code: 'on_prem', label: 'On premises' }],
    adminZone: [],
    serverKind: [{ code: 'physical_server', label: 'Physical server' }, { code: 'virtual_machine', label: 'Virtual machine' }],
    lifecycleStatus: [{ code: 'active', label: 'Active' }],
    serverRole: [],
    serverProvider: [{ code: 'on_prem', label: 'On premises' }],
    ipAddressType: [],
  },
  labelFor: (_field: string, code: string) => code,
}));
// The settings the page sees: `enumOptions` unless a test swaps them (a workspace catalog, settings
// still loading); a swap re-renders the page, as the real query does when they arrive.
const settingsStore = vi.hoisted(() => {
  let current: unknown = null;
  const listeners = new Set<() => void>();
  return {
    get: () => current,
    set: (next: unknown) => { current = next; listeners.forEach((listener) => listener()); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
});
vi.mock('../../hooks/useItOpsEnumOptions', async () => {
  const { useSyncExternalStore } = await import('react');
  return { default: () => useSyncExternalStore(settingsStore.subscribe, settingsStore.get) ?? enumOptions };
});
// The provider catalog of a workspace created in 26.11: no `on_prem`.
const cloudCatalog = {
  ...enumOptions,
  byField: {
    ...enumOptions.byField,
    serverProvider: ['aws', 'azure', 'gcp', 'other'].map((code) => ({ code, label: code })),
  },
};
const loadingSettings = {
  settings: null,
  byField: {},
  labelFor: (_field: string, code: string) => code,
};
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
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/MarkdownEditor', () => ({ default: () => <div data-testid="description-editor" /> }));
vi.mock('../../components/history/RecordHistoryTab', () => ({ default: () => null }));

const mocked = vi.mocked(api);
const created = {
  id: 'asset-new',
  asset_reference: 'AST-7',
  name: 'Web 1',
  kind: 'virtual_machine',
  provider: 'other',
  environment: 'prod',
  status: 'active',
  is_cluster: false,
  hostname: 'web-1',
  location_id: 'loc-new',
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
const site = { id: 'loc-new', location_reference: 'LOC-1', name: 'Server room', hosting_type: 'on_prem' };

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function StartPage() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/it/assets/new/overview')}>new asset</button>;
}

describe('An asset born complete in a workspace without sites', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetCreationStore();
    resetNavigationTracker();
    settingsStore.set(null);
  });

  it('goes from the name to the site, creates the site from the picker and writes the asset with it', async () => {
    let sites: typeof site[] = [];
    mocked.get.mockImplementation(async (url: string) => {
      if (url === '/locations') return { data: { items: sites } } as never;
      if (url === '/locations/loc-new') return { data: site } as never;
      if (url === '/assets/by-ref/AST-7' || url === '/assets/asset-new') return { data: created } as never;
      if (url.endsWith('/sub-items')) return { data: [] } as never;
      return { data: { items: [], outgoing: [], incoming: [] } } as never;
    });
    mocked.post.mockImplementation(async (url: string) => {
      if (url === '/locations') {
        sites = [site];
        return { data: { id: 'loc-new' } } as never;
      }
      if (url === '/assets') return { data: { ...created, creation_token: 'token-1' } } as never;
      return { data: { ok: true } } as never;
    });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider theme={createAppTheme('light')}>
          <KanapDialogProvider>
            <MemoryRouter initialEntries={['/start']}>
              <NavigationTracker />
              <Location />
              <Routes>
                <Route path="/start" element={<StartPage />} />
                <Route path="/it/assets/:id/:tab" element={<AssetWorkspacePage />} />
              </Routes>
            </MemoryRouter>
          </KanapDialogProvider>
        </ThemeProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'new asset' }));
    const title = await screen.findByRole('textbox', { name: TITLE_FIELD });
    fireEvent.change(title, { target: { value: 'Web 1' } });
    fireEvent.keyDown(title, { key: 'Tab' });
    const siteField = document.querySelector<HTMLInputElement>('[data-creation-field="location"] input');
    await waitFor(() => expect(siteField).toHaveFocus());
    expect(mocked.post).not.toHaveBeenCalled();
    // The list offers the creation of a site, and nothing else.
    fireEvent.keyDown(siteField!, { key: 'ArrowDown' });
    const offer = await screen.findByRole('option', { name: 'it:workspace.location.createNew' });
    expect(screen.getAllByRole('option')).toHaveLength(1);
    fireEvent.click(offer);
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'it:pages.locations.columns.name' }), { target: { value: 'Server room' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(mocked.post).toHaveBeenCalledWith('/locations', { name: 'Server room', hosting_type: 'on_prem' }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/AST-7/overview'));
    const assetPosts = mocked.post.mock.calls.filter(([url]) => url === '/assets');
    expect(assetPosts).toHaveLength(1);
    expect(assetPosts[0][1]).toMatchObject({ name: 'Web 1', location_id: 'loc-new' });
    expect(await screen.findByRole('button', { name: 'common:buttons.done' })).toBeTruthy();
  });
});
