import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import AssetWorkspacePage from './AssetWorkspacePage';

const get = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ manage: true }));
const t = vi.hoisted(() => (key: string, options?: { label?: unknown }) => (options?.label ? `${key}:${options.label}` : key));
const zones = vi.hoisted(() => ({
  list: [
    { code: 'tier_0', label: 'Tier 0' },
    { code: 'old', label: 'Old zone', deprecated: true },
    { code: 'tier_1', label: 'Tier 1' },
  ] as Array<{ code: string; label: string; deprecated?: boolean }>,
}));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));
vi.mock('../../api', () => ({ default: { get, patch, post: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string, level: string) => auth.manage && resource === 'infrastructure' && level === 'member' }),
}));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({
    settings: { hostingTypes: [], serverKinds: [{ code: 'virtual_machine', label: 'Virtual machine', is_physical: false }], domains: [], subnets: [] },
    byField: {
      adminZone: zones.list,
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
vi.mock('./workspace/AssetDependenciesTab', () => ({ default: () => null }));
vi.mock('./components/AssetTechnologiesSection', async (importOriginal) => ({ ...(await importOriginal<any>()), default: () => null }));
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
  admin_zone: 'tier_0',
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

function renderAsset(asset: typeof ASSET = ASSET) {
  get.mockImplementation(async (url: string) => {
    if (url === '/assets/asset-1') return { data: asset };
    if (url === '/locations') return { data: { items: [] } };
    if (url.endsWith('/assignments')) return { data: [] };
    if (url.endsWith('/clusters') || url.endsWith('/members')) return { data: { items: [] } };
    return { data: { items: [], outgoing: [], incoming: [] } };
  });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={['/it/assets/asset-1/operations']}>
            <Routes>
              <Route path="/it/assets/:id/:tab" element={<AssetWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const zoneField = () => screen.findByRole('combobox', { name: 'workspace.asset.technical.adminZone' });

async function zoneShowing(text: string) {
  await zoneField();
  await waitFor(() => expect(screen.getByRole('combobox', { name: 'workspace.asset.technical.adminZone' })).toHaveTextContent(text));
  return screen.getByRole('combobox', { name: 'workspace.asset.technical.adminZone' });
}

describe('Asset properties: administration zone', () => {
  beforeEach(() => {
    auth.manage = true;
    get.mockReset();
    patch.mockReset();
    patch.mockResolvedValue({ data: ASSET });
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

  it('sits between environment and lifecycle in the properties panel, and only there', async () => {
    renderAsset();
    const field = await zoneField();
    const drawer = field.closest('aside');
    expect(drawer).not.toBeNull();
    const text = drawer?.textContent ?? '';
    const environment = text.indexOf('workspace.asset.technical.environment');
    const zone = text.indexOf('workspace.asset.technical.adminZone');
    const lifecycle = text.indexOf('workspace.asset.overview.lifecycle');
    expect(environment).toBeGreaterThanOrEqual(0);
    expect(zone).toBeGreaterThan(environment);
    expect(lifecycle).toBeGreaterThan(zone);
    expect(screen.getAllByRole('combobox', { name: 'workspace.asset.technical.adminZone' })).toHaveLength(1);
  });

  it('offers the current zones only, and saves the choice', async () => {
    renderAsset();
    const field = await zoneShowing('Tier 0');
    fireEvent.mouseDown(field);
    const options = within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['common:labels.none', 'Tier 0', 'Tier 1']);
    fireEvent.click(screen.getByRole('option', { name: 'Tier 1' }));
    expect(patch).toHaveBeenCalledWith('/assets/asset-1', { admin_zone: 'tier_1' });
  });

  it('saves a field changed while another saves after it, and keeps its value meanwhile', async () => {
    let answerFirst: (value: unknown) => void = () => undefined;
    patch.mockImplementationOnce(() => new Promise((resolve) => { answerFirst = resolve; }));
    patch.mockResolvedValueOnce({ data: { ...ASSET, is_cluster: true, admin_zone: 'tier_1' } });
    renderAsset();
    const field = await zoneShowing('Tier 0');
    const toggle = await screen.findByRole('checkbox', { name: 'workspace.asset.meta.cluster' });
    fireEvent.click(toggle);
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    fireEvent.mouseDown(field);
    fireEvent.click(screen.getByRole('option', { name: 'Tier 1' }));
    // The zone waits for the switch, and shows its new value.
    expect(patch).toHaveBeenCalledTimes(1);
    expect(field).toHaveTextContent('Tier 1');
    // The switch's answer still holds the old zone: the zone keeps its new value, then saves.
    answerFirst({ data: { ...ASSET, is_cluster: true } });
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(2));
    expect(patch.mock.calls.map((call) => call[1])).toEqual([{ is_cluster: true }, { admin_zone: 'tier_1' }]);
    expect(screen.getByRole('combobox', { name: 'workspace.asset.technical.adminZone' })).toHaveTextContent('Tier 1');
    await waitFor(() => expect(toggle).toBeChecked());
    expect(field).toBeEnabled();
  });

  it('keeps a retired zone while it is the value', async () => {
    renderAsset({ ...ASSET, admin_zone: 'old' });
    const field = await zoneShowing('common.deprecatedOption:Old zone');
    fireEvent.mouseDown(field);
    const options = within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['common:labels.none', 'Tier 0', 'common.deprecatedOption:Old zone', 'Tier 1']);
  });

  it('shows a value outside the catalog as legacy and does not offer a retired zone', async () => {
    renderAsset({ ...ASSET, admin_zone: 'ghost' });
    const field = await zoneShowing('common.legacyOption:ghost');
    fireEvent.mouseDown(field);
    const options = within(screen.getByRole('listbox')).getAllByRole('option').map((option) => option.textContent);
    expect(options).toEqual(['common:labels.none', 'common.legacyOption:ghost', 'Tier 0', 'Tier 1']);
  });

  it('is disabled without the right to manage assets', async () => {
    auth.manage = false;
    renderAsset();
    expect(await zoneField()).toHaveAttribute('aria-disabled', 'true');
  });
});
