import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import AssetWorkspacePage from './AssetWorkspacePage';

const get = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const del = vi.hoisted(() => vi.fn());
const t = vi.hoisted(() => (key: string) => key);
const features = vi.hoisted(() => ({ vulnerabilityFeed: false }));
const nav = vi.hoisted(() => ({ total: 1, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features } }) }));
vi.mock('../../api', () => ({ default: { get, patch, post, delete: del } }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
const enumOptions = vi.hoisted(() => ({
  settings: { hostingTypes: [], serverKinds: [{ code: 'virtual_machine', label: 'Virtual machine', is_physical: false }], domains: [], subnets: [] },
  byField: {
    adminZone: [],
    serverKind: [{ code: 'virtual_machine', label: 'Virtual machine' }],
    lifecycleStatus: [{ code: 'active', label: 'Active' }],
    serverRole: [],
    serverProvider: [{ code: 'on_prem', label: 'On premises' }],
    ipAddressType: [
      { code: 'host', label: 'Host' },
      { code: 'ipmi', label: 'IPMI' },
    ],
  },
  labelFor: (_field: string, code: string) => code,
}));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({ default: () => enumOptions }));
vi.mock('../../hooks/useAssetNav', () => ({ useAssetNav: () => nav }));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('./editors/HardwareInfoPanel', () => ({ default: () => null }));
vi.mock('./editors/SupportInfoPanel', () => ({ default: () => null }));
vi.mock('./workspace/AssetRelationsTab', () => ({ default: () => null }));
vi.mock('./workspace/AssetDependenciesTab', () => ({ default: () => null }));
vi.mock('./components/AssetTechnologiesSection', () => ({ default: () => null }));
vi.mock('../../components/EntityKnowledgePanel', () => ({ default: () => null }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/MarkdownEditor', () => ({ default: () => null }));

const ASSET = {
  id: 'asset-1',
  name: 'QA-C4 VM',
  asset_reference: 'AST-1',
  kind: 'virtual_machine',
  provider: 'on_prem',
  environment: 'prod',
  hostname: 'qa-c4',
  domain: '',
  admin_zone: '',
  fqdn: 'qa-c4',
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

function renderNetwork() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockImplementation(async (url: string) => {
    if (url === '/assets/by-ref/AST-1') return { data: ASSET };
    if (url === '/locations') return { data: { items: [] } };
    if (url.endsWith('/assignments')) return { data: [] };
    if (url.endsWith('/relations-tab')) return { data: { counts: { assets: 0, total: 0 } } };
    if (url.endsWith('/members') || url.endsWith('/clusters')) return { data: { items: [] } };
    return { data: { items: [] } };
  });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={queryClient}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={['/it/assets/AST-1/network']}>
            <Routes>
              <Route path="/it/assets/:id/:tab" element={<AssetWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('Asset network: an empty IP row', () => {
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
    post.mockReset();
    del.mockReset();
    patch.mockResolvedValue({ data: ASSET });
  });

  it('stays on screen when its type is chosen before the address', async () => {
    renderNetwork();
    await screen.findByText('QA-C4 VM');
    fireEvent.click(screen.getByRole('button', { name: 'workspace.asset.technical.addIpAddress' }));
    const address = screen.getByPlaceholderText('workspace.asset.technical.ipAddressPlaceholder');
    const typeSelect = screen.getAllByRole('combobox').find((el) => el.textContent === 'Host');
    expect(typeSelect).toBeTruthy();
    fireEvent.mouseDown(typeSelect!);
    fireEvent.click(await screen.findByRole('option', { name: 'IPMI' }));
    expect(screen.getByPlaceholderText('workspace.asset.technical.ipAddressPlaceholder')).toBe(address);
    expect(screen.getAllByRole('combobox').some((el) => el.textContent === 'IPMI')).toBe(true);
    await waitFor(() => expect(patch).not.toHaveBeenCalled());
  });
});
