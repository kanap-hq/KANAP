import React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import AssetWorkspacePage from './AssetWorkspacePage';

const get = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
const post = vi.hoisted(() => vi.fn());
const del = vi.hoisted(() => vi.fn());
const t = vi.hoisted(() => (key: string, options?: { label?: string }) => (options?.label ? `${key}:${options.label}` : key));
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
  settings: {
    hostingTypes: [],
    serverKinds: [{ code: 'virtual_machine', label: 'Virtual machine', is_physical: false }],
    domains: [],
    subnets: [
      { location_id: 'loc-1', cidr: '10.0.0.0/24', network_zone: 'lan' },
      { location_id: 'loc-1', cidr: '10.9.0.0/24', network_zone: 'lan', deprecated: true },
    ],
  },
  byField: {
    adminZone: [],
    serverKind: [{ code: 'virtual_machine', label: 'Virtual machine' }],
    lifecycleStatus: [{ code: 'active', label: 'Active' }],
    serverRole: [],
    serverProvider: [{ code: 'on_prem', label: 'On premises' }],
    ipAddressType: [
      { code: 'host', label: 'Host' },
      { code: 'ipmi', label: 'IPMI', deprecated: true },
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

// Rule P7 (lot K2c of 26.12.1): a retired IP address type or subnet is offered only to the asset
// that holds it; the asset that holds it shows it and keeps it.

const BASE = {
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
  is_cluster: false,
  status: 'active',
  go_live_date: null,
  end_of_life_date: null,
  location_id: 'loc-1',
  notes: '',
  external_links: [],
};

function renderNetwork(ipAddresses: Array<{ type: string; ip: string; subnet_cidr: string | null }>) {
  const asset = { ...BASE, ip_addresses: ipAddresses };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockImplementation(async (url: string) => {
    if (url === '/assets/by-ref/AST-1') return { data: asset };
    if (url.endsWith('/assignments')) return { data: [] };
    if (url.endsWith('/relations-tab')) return { data: { counts: { assets: 0, total: 0 } } };
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

const optionsOf = async (combobox: HTMLElement) => {
  fireEvent.mouseDown(combobox);
  const names = within(await screen.findByRole('listbox')).getAllByRole('option').map((node) => node.textContent);
  fireEvent.keyDown(screen.getByRole('listbox'), { key: 'Escape' });
  return names;
};

describe('Asset network: retired catalog values (rule P7)', () => {
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
    post.mockReset();
    del.mockReset();
  });
  afterEach(cleanup);

  it('shows and keeps the retired type and subnet the asset holds', async () => {
    renderNetwork([{ type: 'ipmi', ip: '10.9.0.5', subnet_cidr: '10.9.0.0/24' }]);
    await screen.findByText('QA-C4 VM');
    const type = await screen.findByText('IPMI (common:enumEditor.retiredSuffix)');
    expect(await optionsOf(type.closest('[role="combobox"]') as HTMLElement)).toEqual(['Host', 'IPMI (common:enumEditor.retiredSuffix)']);
    const subnet = screen.getAllByRole('combobox').find((node) => node.textContent?.includes('10.9.0.0/24'));
    expect(subnet).toBeTruthy();
    expect(await optionsOf(subnet!)).toEqual(['common:labels.none', '10.0.0.0/24', '10.9.0.0/24 (common:enumEditor.retiredSuffix)']);
  });

  it('does not offer them to an asset that does not hold them', async () => {
    renderNetwork([{ type: 'host', ip: '10.0.0.5', subnet_cidr: '10.0.0.0/24' }]);
    await screen.findByText('QA-C4 VM');
    const type = screen.getAllByRole('combobox').find((node) => node.textContent === 'Host');
    expect(await optionsOf(type!)).toEqual(['Host']);
    const subnet = screen.getAllByRole('combobox').find((node) => node.textContent?.includes('10.0.0.0/24'));
    expect(await optionsOf(subnet!)).toEqual(['common:labels.none', '10.0.0.0/24']);
  });
});
