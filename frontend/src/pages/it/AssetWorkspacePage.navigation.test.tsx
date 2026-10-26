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
const nav = vi.hoisted(() => ({ total: 2, index: 0, hasPrev: false, hasNext: true, prevId: null, nextId: 'AST-2' }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({
    t,
    i18n: { language: 'en', resolvedLanguage: 'en' },
  }),
}));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features } }) }));
vi.mock('../../api', () => ({ default: { get, patch, post, delete: del } }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true }),
}));
const enumOptions = vi.hoisted(() => ({
  settings: {
    hostingTypes: [],
    serverKinds: [{ code: 'virtual_machine', label: 'Virtual machine', is_physical: false }],
    domains: [],
    subnets: [],
  },
  byField: {
    adminZone: [],
    serverKind: [{ code: 'virtual_machine', label: 'Virtual machine' }],
    lifecycleStatus: [{ code: 'active', label: 'Active' }],
    serverRole: [],
    serverProvider: [{ code: 'on_prem', label: 'On premises' }],
    ipAddressType: [],
  },
  labelFor: (_field: string, code: string) => code,
}));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({ default: () => enumOptions }));
vi.mock('../../hooks/useAssetNav', () => ({
  useAssetNav: () => nav,
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('./editors/HardwareInfoPanel', () => ({ default: () => null }));
vi.mock('./editors/SupportInfoPanel', () => ({ default: () => null }));
vi.mock('./workspace/AssetRelationsTab', () => ({ default: () => null }));
vi.mock('./workspace/AssetDependenciesTab', () => ({ default: () => null }));
vi.mock('./components/AssetTechnologiesSection', () => ({ default: () => null }));
vi.mock('../../components/EntityKnowledgePanel', () => ({ default: () => null }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/MarkdownEditor', () => ({
  default: ({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) => (
    <textarea aria-label={placeholder} value={value} onChange={(event) => onChange(event.target.value)} />
  ),
}));

const FIRST = {
  id: 'asset-1',
  name: 'QA-C4 Serveur',
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

const SECOND = {
  ...FIRST,
  id: 'asset-2',
  name: 'SRV-PAIE-OLD',
  asset_reference: 'AST-2',
  hostname: 'paie-old',
  notes: 'already there',
  environment: 'prod',
};

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  get.mockImplementation(async (url: string) => {
    if (url === '/assets/by-ref/AST-1' || url === '/assets/asset-1') return { data: FIRST };
    if (url === '/assets/by-ref/AST-2' || url === '/assets/asset-2') return { data: SECOND };
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
          <MemoryRouter initialEntries={[path]}>
            <Routes>
              <Route path="/it/assets/:id/:tab" element={<AssetWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('Asset workspace: next just after a description', () => {
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
    post.mockReset();
    del.mockReset();
    patch.mockResolvedValue({ data: FIRST });
  });

  it('shows the next asset when Next is clicked before the description response, and the following edit stays on it', async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    patch.mockImplementation((url: string, body?: Partial<typeof SECOND>) => {
      if (url === '/assets/asset-1') {
        return new Promise((resolve) => { resolveFirst = resolve; });
      }
      return Promise.resolve({ data: { ...SECOND, ...body } });
    });
    renderAt('/it/assets/AST-1/overview');
    const description = await screen.findByRole('textbox', { name: 'workspace.asset.overview.descriptionPlaceholder' });
    await waitFor(() => expect(screen.getByText('QA-C4 Serveur')).toBeInTheDocument());
    fireEvent.change(description, { target: { value: 'typed before next' } });
    fireEvent.click(screen.getByRole('button', { name: 'workspace.asset.next' }));

    await waitFor(() => expect(screen.getByText('SRV-PAIE-OLD')).toBeInTheDocument());
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/assets/asset-1', { notes: 'typed before next' }));
    expect(screen.getByRole('textbox', { name: 'workspace.asset.overview.descriptionPlaceholder' })).toHaveValue('already there');

    resolveFirst({ data: { ...FIRST, notes: 'typed before next' } });
    await waitFor(() => expect(screen.getByText('SRV-PAIE-OLD')).toBeInTheDocument());
    expect(screen.getByRole('textbox', { name: 'workspace.asset.overview.descriptionPlaceholder' })).toHaveValue('already there');

    fireEvent.click(screen.getByRole('button', { name: 'enums.environment.prod' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'enums.environment.test' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/assets/asset-2', { environment: 'test' }));
    const urls = patch.mock.calls.map(([url]) => url);
    expect(urls.filter((url) => url === '/assets/asset-2')).toEqual(['/assets/asset-2']);
    expect(urls).not.toContain('/assets/asset-1/environment');
    // The late description stays on the asset that was on screen, and nothing else is written there.
    expect(patch.mock.calls.filter(([url]) => url === '/assets/asset-1')).toEqual([
      ['/assets/asset-1', { notes: 'typed before next' }],
    ]);
  });
});
