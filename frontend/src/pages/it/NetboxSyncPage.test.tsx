import React from 'react';
import '../../i18n';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NetboxSyncPage from './NetboxSyncPage';
import { createAppTheme } from '../../config/ThemeContext';
import { api as apiClient } from '../../api/client';

vi.mock('../../api/client', () => {
  const get = vi.fn();
  return {
    api: {
      get,
      // The asset picker goes through `assetsApi.list`, which delegates to `get`.
      paginated: (url: string, params?: unknown) => get(url, { params }),
      post: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
    },
  };
});

vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true }),
}));

vi.mock('../../components/PageHeader', () => ({
  default: ({ title }: { title: string }) => <div>{title}</div>,
}));

const STATUS = {
  configured: true,
  enabled: true,
  auto_sync: false,
  sync: {
    status: 'success',
    trigger: 'manual',
    started_at: '2026-09-19T08:00:00.000Z',
    finished_at: '2026-09-19T08:00:12.000Z',
    duration_ms: 12000,
    counts: { create: 2, update: 3, unchanged: 10, ambiguous: 1, skipped: 4, missing: 1, error: 0 },
    error: null,
  },
  records: { linked: 10, ambiguous: 1, missing: 1, ignored: 2, error: 0 },
};

const AMBIGUOUS_ROW = {
  id: 'rec-1',
  external_type: 'device',
  external_id: '11',
  external_name: 'par-esx-01',
  external_url: 'https://netbox.internal/dcim/devices/11/',
  state: 'ambiguous',
  asset: null,
  candidates: [{ id: 'asset-1', name: 'PAR-ESX-01', asset_reference: 'AST-4' }],
  // Structured notice: the UI translates by code and only falls back to `text`.
  message: { code: 'ambiguous_candidates', params: {}, text: 'SERVER ENGLISH, SHOULD NOT BE SHOWN' },
  last_seen_at: '2026-09-19T08:00:00.000Z',
  last_synced_at: null,
};

const LINKED_ROW = {
  ...AMBIGUOUS_ROW,
  id: 'rec-2',
  external_name: 'par-nas-01',
  state: 'linked',
  asset: {
    id: 'asset-2', name: 'PAR-NAS-01', asset_reference: 'AST-9', status: 'active',
    kind: 'network_switch', kind_label: 'Network switch',
  },
  candidates: [],
  message: null,
};

const PREVIEW = {
  ok: true,
  message: null,
  // A current server always says what the batch holds; its absence means an old one.
  batch: { listed: 5, remaining: 0 },
  counts: { create: 1, update: 1, unchanged: 5, ambiguous: 1, skipped: 2, missing: 0, error: 0 },
  rows: [
    {
      external_type: 'device', external_id: '12', external_name: 'par-sw-02',
      external_url: 'https://netbox.internal/dcim/devices/12/',
      action: 'create', asset: null, matched_by: null, candidates: [], diffs: [],
      skip_reason: null, warnings: [],
    },
    {
      external_type: 'device', external_id: '13', external_name: 'par-esx-02',
      external_url: 'https://netbox.internal/dcim/devices/13/',
      action: 'update',
      asset: { id: 'asset-3', name: 'PAR-ESX-02', asset_reference: 'AST-7' },
      matched_by: 'serial', candidates: [],
      diffs: [{ field: 'serial_number', before: 'OLD1', after: 'NEW1' }],
      skip_reason: null,
      warnings: [{ code: 'os_not_in_catalog', params: { value: 'Photon OS' }, text: 'os fallback' }],
    },
    {
      external_type: 'device', external_id: '14', external_name: 'par-pdu-01',
      external_url: 'https://netbox.internal/dcim/devices/14/',
      action: 'skipped', asset: null, matched_by: null, candidates: [], diffs: [],
      skip_reason: 'unmapped_role', warnings: [],
    },
    // Two objects with exactly one suggestion each: the bulk action settles both.
    {
      external_type: 'device', external_id: '15', external_name: 'par-esx-03',
      external_url: 'https://netbox.internal/dcim/devices/15/',
      action: 'ambiguous', asset: null, matched_by: null,
      candidates: [{ id: 'asset-5', name: 'PAR-ESX-03', asset_reference: 'AST-11' }],
      diffs: [], skip_reason: null,
      warnings: [{ code: 'ip_match_candidates', params: { value: '10.1.2.3' }, text: 'ip fallback' }],
    },
    {
      external_type: 'device', external_id: '16', external_name: 'par-esx-04',
      external_url: 'https://netbox.internal/dcim/devices/16/',
      action: 'ambiguous', asset: null, matched_by: null,
      candidates: [{ id: 'asset-6', name: 'PAR-ESX-04', asset_reference: 'AST-12' }],
      diffs: [], skip_reason: null, warnings: [],
    },
  ],
  rows_truncated: false,
  missing: [],
};

const MAPPING_OPTIONS = {
  roles: [
    // Reserved row the backend synthesises for VMs: counts VMs, label is translated here.
    { slug: 'kanap:virtual-machines', name: 'Virtual machines', device_count: 0, vm_count: 11 },
    { slug: 'switch', name: 'Switch', device_count: 6, vm_count: 0 },
    { slug: 'pdu', name: 'PDU', device_count: 1, vm_count: 0 },
  ],
  sites: [{ slug: 'gouda', name: 'Gouda Server Room', device_count: 4, vm_count: 2 }],
  // Platforms are matched too, but they never filter the import.
  platforms: [
    { slug: 'debian-12', name: 'Debian 12', device_count: 2, vm_count: 5 },
    { slug: 'photon', name: 'Photon OS', device_count: 3, vm_count: 0 },
  ],
  asset_kinds: [{ code: 'virtual_machine', label: 'Virtual machine' }, { code: 'network_switch', label: 'Network switch' }],
  locations: [{ id: 'loc-1', name: 'Gouda Server Room' }],
  operating_systems: [
    { code: 'Debian 12 (bookworm)', label: 'Debian 12 (bookworm)' },
    { code: 'Windows Server 2022', label: 'Windows Server 2022' },
  ],
  role_map: { 'kanap:virtual-machines': 'virtual_machine' },
  site_map: {},
  os_map: { photon: 'Windows Server 2022' },
  suggested_role_map: { switch: 'network_switch' },
  suggested_site_map: {},
  suggested_os_map: {},
};

/** Netbox is less precise than KANAP, so the platform comes with a suggestion. */
const MAPPING_OPTIONS_WITH_OS_SUGGESTION = {
  ...MAPPING_OPTIONS,
  suggested_os_map: { 'debian-12': 'Debian 12 (bookworm)' },
};

function renderPage(initialPath = '/it/settings?tab=netbox') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[initialPath]}>
          <NetboxSyncPage />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('NetboxSyncPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (apiClient.get as any).mockImplementation((url: string, config?: any) => {
      if (url === '/netbox/status') return Promise.resolve(STATUS);
      if (url === '/netbox/records') {
        const state = config?.params?.state;
        const items = state === 'linked' ? [LINKED_ROW] : state === 'ambiguous' ? [AMBIGUOUS_ROW] : [];
        return Promise.resolve({ items, total: items.length });
      }
      throw new Error(`Unexpected GET ${url}`);
    });
    (apiClient.post as any).mockImplementation((url: string) => {
      if (url === '/netbox/sync/preview') return Promise.resolve(PREVIEW);
      if (url === '/netbox/sync') return Promise.resolve(STATUS);
      throw new Error(`Unexpected POST ${url}`);
    });
  });

  /** Opens the preview dialog and waits for its first plan. */
  async function openPreview() {
    renderPage();
    await screen.findByText('par-esx-01');
    fireEvent.click(screen.getByText('Synchronise now'));
    await screen.findByText('Review before applying');
  }

  const recordCalls = () =>
    (apiClient.get as any).mock.calls.filter((call: any[]) => call[0] === '/netbox/records');

  const previewCalls = () =>
    (apiClient.post as any).mock.calls.filter((call: unknown[]) => call[0] === '/netbox/sync/preview');

  it('shows a compact line and a settings link when Netbox is not configured', async () => {
    (apiClient.get as any).mockResolvedValue({ ...STATUS, configured: false });

    renderPage();

    expect(await screen.findByText('Netbox is not connected yet.')).toBeInTheDocument();
    expect(screen.getByText('Open the integration settings')).toBeInTheDocument();
    expect(screen.queryByText('Synchronise now')).not.toBeInTheDocument();
  });

  it('defaults to the first non-empty attention filter and lists its records', async () => {
    renderPage();

    expect(await screen.findByText('par-esx-01')).toBeInTheDocument();
    expect(screen.getByText('Several assets could be this object. Choose one, or create a new asset.')).toBeInTheDocument();
    expect(screen.queryByText(/SHOULD NOT BE SHOWN/)).not.toBeInTheDocument();
    expect(screen.getByText('Link to…')).toBeInTheDocument();
    expect(screen.getByText('To decide 1')).toBeInTheDocument();
  });

  it('honours the state query parameter', async () => {
    renderPage('/it/settings?tab=netbox&state=linked');

    expect(await screen.findByText('par-nas-01')).toBeInTheDocument();
    expect(screen.getByText('AST-9')).toBeInTheDocument();
  });

  it('shows the KANAP asset type of a linked object, not the Netbox object type', async () => {
    renderPage('/it/settings?tab=netbox&state=linked');

    expect(await screen.findByText('par-nas-01')).toBeInTheDocument();
    expect(screen.getByText('Network switch')).toBeInTheDocument();
    // Every switch and every server is a "Device" on the Netbox side: useless here.
    expect(screen.queryByText('Device')).not.toBeInTheDocument();
  });

  it('falls back to the Netbox object type, muted, when no asset is linked yet', async () => {
    renderPage();

    expect(await screen.findByText('par-esx-01')).toBeInTheDocument();
    expect(screen.getByText('Device')).toHaveClass('kanap-muted');
  });

  it('searches the list from the search field, starting again at the first page', async () => {
    (apiClient.get as any).mockImplementation((url: string, config?: any) => {
      if (url === '/netbox/status') return Promise.resolve(STATUS);
      if (url === '/netbox/records') {
        // More than one page, so the search has a page to reset.
        return Promise.resolve({ items: [AMBIGUOUS_ROW], total: 120 });
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    renderPage();
    await screen.findByText('par-esx-01');

    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    await waitFor(() => expect(recordCalls().at(-1)?.[1].params.page).toBe(2));

    fireEvent.change(screen.getByLabelText('Search the objects'), { target: { value: 'esx' } });

    await waitFor(() => {
      const last = recordCalls().at(-1)?.[1].params;
      expect(last.q).toBe('esx');
      expect(last.page).toBe(1);
    });

    // Clearing the field lists everything again.
    fireEvent.change(screen.getByLabelText('Search the objects'), { target: { value: '' } });
    await waitFor(() => expect(recordCalls().at(-1)?.[1].params.q).toBeUndefined());
  });

  it('counts mapping rows as devices or virtual machines and translates the reserved row', async () => {
    (apiClient.get as any).mockImplementation((url: string, config?: any) => {
      if (url === '/netbox/status') return Promise.resolve(STATUS);
      if (url === '/netbox/mapping-options') return Promise.resolve(MAPPING_OPTIONS);
      if (url === '/netbox/records') return Promise.resolve({ items: [], total: 0 });
      throw new Error(`Unexpected GET ${url}`);
    });

    renderPage();
    fireEvent.click(await screen.findByText('Mappings'));

    // Reserved row: our label, not the backend's, and counted in virtual machines.
    expect(await screen.findByText('Virtual machines')).toBeInTheDocument();
    expect(screen.getByText('11 virtual machines')).toBeInTheDocument();
    // Real roles only ever count devices.
    expect(screen.getByText('6 devices')).toBeInTheDocument();
    expect(screen.getByText('1 device')).toBeInTheDocument();
    // A site can hold both.
    expect(screen.getByText('4 devices · 2 virtual machines')).toBeInTheDocument();
    // An unsaved label match is flagged as a suggestion.
    expect(screen.getByText('Suggested')).toBeInTheDocument();
  });

  it('says that suggestions are not saved, and offers to save them from the top', async () => {
    let saved = false;
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/netbox/status') return Promise.resolve(STATUS);
      if (url === '/netbox/mapping-options') {
        return Promise.resolve(saved
          ? { ...MAPPING_OPTIONS, role_map: { ...MAPPING_OPTIONS.role_map, switch: 'network_switch' }, suggested_role_map: {} }
          : MAPPING_OPTIONS);
      }
      if (url === '/netbox/records') return Promise.resolve({ items: [], total: 0 });
      throw new Error(`Unexpected GET ${url}`);
    });
    (apiClient.put as any).mockImplementation((url: string, body: any) => {
      if (url !== '/netbox/mapping') throw new Error(`Unexpected PUT ${url}`);
      saved = true;
      return Promise.resolve({ role_map: body.role_map, site_map: body.site_map });
    });

    renderPage();
    fireEvent.click(await screen.findByText('Mappings'));

    // One suggestion pre-fills its row; it looks chosen and is not saved.
    expect(await screen.findByText('1 match is not saved yet. It decides nothing until you save.'))
      .toBeInTheDocument();
    // Two save buttons: the one next to the notice, and the one under the tables.
    const buttons = screen.getAllByRole('button', { name: 'Save mappings' });
    expect(buttons).toHaveLength(2);

    fireEvent.click(buttons[0]);

    expect(await screen.findByText('Mappings saved.')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText(/not saved yet/)).not.toBeInTheDocument());
    expect((apiClient.put as any).mock.calls[0][1].role_map.switch).toBe('network_switch');
  });

  /** Mounts the page on the Mappings tab with the given mapping options. */
  async function openMappings(options: unknown) {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/netbox/status') return Promise.resolve(STATUS);
      if (url === '/netbox/mapping-options') return Promise.resolve(options);
      if (url === '/netbox/records') return Promise.resolve({ items: [], total: 0 });
      throw new Error(`Unexpected GET ${url}`);
    });
    renderPage();
    fireEvent.click(await screen.findByText('Mappings'));
  }

  it('shows a translated message when the mapping options fail with a server error', async () => {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/netbox/status') return Promise.resolve(STATUS);
      if (url === '/netbox/mapping-options') {
        return Promise.reject({ response: { status: 500, data: { message: 'Internal server error', error: 'Internal Server Error' } } });
      }
      if (url === '/netbox/records') return Promise.resolve({ items: [], total: 0 });
      throw new Error(`Unexpected GET ${url}`);
    });

    renderPage();
    fireEvent.click(await screen.findByText('Mappings'));

    expect(await screen.findByText('The Netbox roles and sites could not be loaded.')).toBeInTheDocument();
    expect(screen.queryByText('Internal server error')).not.toBeInTheDocument();
    expect(screen.queryByText('Internal Server Error')).not.toBeInTheDocument();
  });

  it('keeps a business error from Netbox as the server wrote it', async () => {
    await openMappings(MAPPING_OPTIONS);
    (apiClient.put as any).mockRejectedValue({
      response: { status: 400, data: { message: 'Set up the Netbox connection first, then save the matches.', error: 'Bad Request' } },
    });

    fireEvent.click((await screen.findAllByRole('button', { name: 'Save mappings' }))[0]);

    expect(await screen.findByText('Set up the Netbox connection first, then save the matches.')).toBeInTheDocument();
    expect(screen.queryByText('The mappings could not be saved.')).not.toBeInTheDocument();
  });

  it('matches each Netbox platform with a KANAP operating system, suggestion included', async () => {
    await openMappings(MAPPING_OPTIONS_WITH_OS_SUGGESTION);

    expect(await screen.findByText('Operating systems')).toBeInTheDocument();
    expect(screen.getByText(/does not block the import/)).toBeInTheDocument();
    expect(screen.getByText('Netbox platform')).toBeInTheDocument();
    expect(screen.getByText('2 devices · 5 virtual machines')).toBeInTheDocument();
    // The saved match shows as chosen; the suggestion pre-fills its row and is
    // tagged exactly like an unsaved role or site match.
    expect(screen.getByText('Windows Server 2022')).toBeInTheDocument();
    expect(screen.getByText('Debian 12 (bookworm)')).toBeInTheDocument();
    expect(screen.getAllByText('Suggested')).toHaveLength(2);
    // One unsaved role match plus one unsaved operating system match.
    expect(screen.getByText('2 matches are not saved yet. They decide nothing until you save.'))
      .toBeInTheDocument();
  });

  it('saves the operating system matches together with the roles and the sites', async () => {
    (apiClient.put as any).mockImplementation((url: string, body: any) => {
      if (url !== '/netbox/mapping') throw new Error(`Unexpected PUT ${url}`);
      return Promise.resolve(body);
    });

    await openMappings(MAPPING_OPTIONS_WITH_OS_SUGGESTION);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Save mappings' }))[0]);

    await waitFor(() => expect((apiClient.put as any).mock.calls).toHaveLength(1));
    expect((apiClient.put as any).mock.calls[0][1].os_map).toEqual({
      photon: 'Windows Server 2022',
      'debian-12': 'Debian 12 (bookworm)',
    });
  });

  it('keeps the roles and the sites when Netbox refuses to list its platforms', async () => {
    // Netbox grants permissions per object type: the token may read devices,
    // roles and sites and still be refused the platforms.
    await openMappings({ ...MAPPING_OPTIONS, platforms: [], platforms_unavailable: true });

    expect(await screen.findByText('Netbox roles')).toBeInTheDocument();
    expect(screen.getByText('Netbox sites')).toBeInTheDocument();
    expect(screen.getByText('6 devices')).toBeInTheDocument();
    // The section says why, in one line, and offers nothing to match.
    expect(screen.getByText(/Check that the API token can read platforms/)).toBeInTheDocument();
    expect(screen.queryByText(/Netbox lists no platform/)).not.toBeInTheDocument();
    expect(screen.queryByText('Netbox platform')).not.toBeInTheDocument();
  });

  it('still shows the mappings on a server that does not match platforms yet', async () => {
    const { platforms, operating_systems, os_map, suggested_os_map, ...older } = MAPPING_OPTIONS;
    await openMappings(older);

    expect(await screen.findByText('Netbox roles')).toBeInTheDocument();
    // The section stays, as one line, rather than drawing an empty table.
    expect(screen.getByText('Operating systems')).toBeInTheDocument();
    expect(screen.getByText('Netbox lists no platform, so there is nothing to match here.')).toBeInTheDocument();
    expect(screen.queryByText('Netbox platform')).not.toBeInTheDocument();
  });

  /** Clusters are matched by Netbox id with a KANAP cluster asset, never by slug. */
  const MAPPING_OPTIONS_WITH_CLUSTERS = {
    ...MAPPING_OPTIONS,
    clusters: [
      { id: '7', name: 'Paris vSphere', vm_count: 4 },
      { id: '8', name: 'Gouda vSphere', vm_count: 0 },
    ],
    clusters_unavailable: false,
    kanap_clusters: [
      { id: 'cl-gouda', name: 'GOU-VSPHERE-CL01' },
      { id: 'cl-paris', name: 'PAR-VSPHERE-CL01' },
    ],
    // Cluster 9 left Netbox; its saved match keeps a row under the stored name.
    cluster_map: { 7: 'cl-paris', 9: 'cl-gone' },
    cluster_names: { 9: 'Parma vSphere' },
    suggested_cluster_map: { 8: 'cl-gouda' },
  };

  it('matches each Netbox cluster with a KANAP cluster, suggestion included', async () => {
    await openMappings(MAPPING_OPTIONS_WITH_CLUSTERS);

    expect(await screen.findByText('Clusters')).toBeInTheDocument();
    expect(screen.getByText(/nothing is removed/)).toBeInTheDocument();
    expect(screen.getByText('Netbox cluster')).toBeInTheDocument();
    expect(screen.getByText('KANAP cluster')).toBeInTheDocument();
    expect(screen.getByText('4 virtual machines')).toBeInTheDocument();
    expect(screen.getByText('PAR-VSPHERE-CL01')).toBeInTheDocument();
    expect(screen.getByText('GOU-VSPHERE-CL01')).toBeInTheDocument();
    // A saved match that no longer names a usable cluster never shows an id.
    expect(screen.getByText('Parma vSphere')).toBeInTheDocument();
    expect(screen.getByText('No longer in Netbox')).toBeInTheDocument();
    expect(screen.getByText('Asset no longer available')).toBeInTheDocument();
    expect(screen.queryByText('cl-gone')).not.toBeInTheDocument();
    // One unsaved role match plus one unsaved cluster match.
    expect(screen.getAllByText('Suggested')).toHaveLength(2);
    expect(screen.getByText('2 matches are not saved yet. They decide nothing until you save.'))
      .toBeInTheDocument();
  });

  it('saves the cluster matches with the Netbox names beside them', async () => {
    (apiClient.put as any).mockImplementation((url: string, body: any) => {
      if (url !== '/netbox/mapping') throw new Error(`Unexpected PUT ${url}`);
      return Promise.resolve(body);
    });

    await openMappings(MAPPING_OPTIONS_WITH_CLUSTERS);
    fireEvent.click((await screen.findAllByRole('button', { name: 'Save mappings' }))[0]);

    await waitFor(() => expect((apiClient.put as any).mock.calls).toHaveLength(1));
    const body = (apiClient.put as any).mock.calls[0][1];
    expect(body.cluster_map).toEqual({ 7: 'cl-paris', 8: 'cl-gouda', 9: 'cl-gone' });
    expect(body.cluster_names).toEqual({ 7: 'Paris vSphere', 8: 'Gouda vSphere' });
  });

  it('says why clusters cannot be matched when Netbox refuses to list them', async () => {
    await openMappings({ ...MAPPING_OPTIONS_WITH_CLUSTERS, clusters: [], clusters_unavailable: true, cluster_map: {} });

    expect(await screen.findByText('Clusters')).toBeInTheDocument();
    expect(screen.getByText(/Check that the API token can read clusters/)).toBeInTheDocument();
    expect(screen.queryByText('Netbox cluster')).not.toBeInTheDocument();
  });

  it('saves the other matches and leaves the cluster ones alone when Netbox refuses to list its clusters', async () => {
    (apiClient.put as any).mockImplementation((_url: string, body: any) => Promise.resolve(body));
    // A saved match on a cluster asset retired since: the backend would refuse it if sent.
    await openMappings({ ...MAPPING_OPTIONS_WITH_CLUSTERS, clusters: [], clusters_unavailable: true });

    expect(await screen.findByText(/Check that the API token can read clusters/)).toBeInTheDocument();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Save mappings' }))[0]);
    await waitFor(() => expect((apiClient.put as any).mock.calls).toHaveLength(1));
    const body = (apiClient.put as any).mock.calls[0][1];
    expect(body).toHaveProperty('role_map');
    expect(body).not.toHaveProperty('cluster_map');
    expect(body).not.toHaveProperty('cluster_names');
  });

  it('keeps a match on a cluster asset no longer available visible, and lets it be removed', async () => {
    (apiClient.put as any).mockImplementation((_url: string, body: any) => Promise.resolve(body));
    await openMappings({ ...MAPPING_OPTIONS_WITH_CLUSTERS, cluster_map: { 7: 'cl-retired' }, cluster_names: {} });

    const stale = await screen.findByText('Asset no longer available');
    fireEvent.mouseDown(stale);
    fireEvent.click(within(await screen.findByRole('listbox')).getByRole('option', { name: 'No match' }));
    expect(screen.queryByText('Asset no longer available')).not.toBeInTheDocument();

    fireEvent.click((await screen.findAllByRole('button', { name: 'Save mappings' }))[0]);
    await waitFor(() => expect((apiClient.put as any).mock.calls).toHaveLength(1));
    // An empty choice is how a match is removed: the server drops it.
    expect((apiClient.put as any).mock.calls[0][1].cluster_map).toEqual({ 7: '', 8: 'cl-gouda' });
  });

  it('leaves the cluster matches alone on a server that does not match clusters yet', async () => {
    (apiClient.put as any).mockImplementation((_url: string, body: any) => Promise.resolve(body));
    await openMappings(MAPPING_OPTIONS);

    expect(await screen.findByText('Operating systems')).toBeInTheDocument();
    expect(screen.queryByText('Clusters')).not.toBeInTheDocument();
    fireEvent.click((await screen.findAllByRole('button', { name: 'Save mappings' }))[0]);
    await waitFor(() => expect((apiClient.put as any).mock.calls).toHaveLength(1));
    expect((apiClient.put as any).mock.calls[0][1]).not.toHaveProperty('cluster_map');
  });

  it('shows the cluster a virtual machine joins and the clusters nobody matched', async () => {
    (apiClient.post as any).mockImplementation((url: string) => {
      if (url === '/netbox/sync/preview') {
        return Promise.resolve({
          ...PREVIEW,
          rows: [
            ...PREVIEW.rows,
            {
              external_type: 'vm', external_id: '50', external_name: 'par-app-01',
              external_url: 'https://netbox.internal/virtualization/virtual-machines/50/',
              action: 'update', asset: { id: 'asset-50', name: 'par-app-01', asset_reference: 'AST-50' },
              matched_by: 'link', candidates: [], skip_reason: null,
              diffs: [{ field: 'cluster', before: 'GOU-VSPHERE-CL01', after: 'PAR-VSPHERE-CL01' }],
              warnings: [{
                code: 'cluster_other_present',
                params: { name: 'par-app-01', value: 'GOU-VSPHERE-CL01' },
                text: 'other fallback',
              }],
            },
            {
              external_type: 'vm', external_id: '54', external_name: 'new-app-01',
              external_url: 'https://netbox.internal/virtualization/virtual-machines/54/',
              action: 'create', asset: null, matched_by: null, candidates: [], skip_reason: null,
              diffs: [{ field: 'cluster', before: null, after: 'GOU-VSPHERE-CL01' }],
              warnings: [],
            },
          ],
          notices: [{ code: 'cluster_not_mapped', params: { value: 'Parma vSphere' }, text: 'unmapped fallback' }],
        });
      }
      throw new Error(`Unexpected POST ${url}`);
    });
    await openPreview();

    expect(screen.getByText('Cluster: GOU-VSPHERE-CL01 → PAR-VSPHERE-CL01')).toBeInTheDocument();
    // A machine the run creates shows the cluster it joins.
    expect(screen.getByText('new-app-01')).toBeInTheDocument();
    expect(screen.getByText(/^Cluster: .+ → GOU-VSPHERE-CL01$/)).toBeInTheDocument();
    expect(screen.getByText(
      'The Netbox cluster "Parma vSphere" is not matched with a KANAP cluster, so its virtual machines were not attached to one.',
    )).toBeInTheDocument();
    expect(screen.getByText(
      'KANAP also places the virtual machine "par-app-01" in GOU-VSPHERE-CL01. That relation was kept: remove it by hand if it is out of date.',
    )).toBeInTheDocument();
  });

  it('labels the placement a virtual machine changes', async () => {
    (apiClient.post as any).mockImplementation((url: string) => {
      if (url === '/netbox/sync/preview') {
        return Promise.resolve({
          ...PREVIEW,
          rows: [{
            external_type: 'vm', external_id: '60', external_name: 'par-app-02',
            external_url: 'https://netbox.internal/virtualization/virtual-machines/60/',
            action: 'update',
            asset: { id: 'asset-60', name: 'par-app-02', asset_reference: 'AST-60' },
            matched_by: 'link', candidates: [], skip_reason: null,
            diffs: [{ field: 'placement', before: 'PAR-ESX-01', after: 'PAR-VSPHERE-CL01' }],
            warnings: [],
          }],
        });
      }
      throw new Error(`Unexpected POST ${url}`);
    });
    await openPreview();

    expect(screen.getByText('Placement: PAR-ESX-01 → PAR-VSPHERE-CL01')).toBeInTheDocument();
  });

  it('points at the mappings when no match is saved, instead of listing skipped objects', async () => {
    const defaultGet = (apiClient.get as any).getMockImplementation();
    (apiClient.get as any).mockImplementation((url: string, config?: any) => (
      url === '/netbox/mapping-options' ? Promise.resolve(MAPPING_OPTIONS) : defaultGet(url, config)
    ));
    (apiClient.post as any).mockImplementation((url: string) => {
      if (url === '/netbox/sync/preview') {
        return Promise.resolve({
          ...PREVIEW,
          counts: { ...PREVIEW.counts, create: 0, update: 0, unchanged: 0 },
          saved_matches: { roles: 0, sites: 2 },
        });
      }
      throw new Error(`Unexpected POST ${url}`);
    });

    await openPreview();

    expect(await screen.findByText(/^No role match is saved yet/)).toBeInTheDocument();
    expect(screen.queryByText(/^Skipped/)).not.toBeInTheDocument();
    // Applying would import nothing and still open the automatic runs.
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Open the mappings' }));

    await waitFor(() => expect(screen.queryByText('Review before applying')).not.toBeInTheDocument());
    expect(await screen.findByText('Netbox roles')).toBeInTheDocument();
  });

  it('groups the preview by what will happen and shows the field diffs', async () => {
    renderPage();
    await screen.findByText('par-esx-01');

    fireEvent.click(screen.getByText('Synchronise now'));

    await waitFor(() => expect(screen.getByText('Review before applying')).toBeInTheDocument());
    expect(screen.getByText('To create (1)')).toBeInTheDocument();
    expect(screen.getByText('To update (1)')).toBeInTheDocument();
    expect(screen.getByText('Skipped (1)')).toBeInTheDocument();
    expect(screen.getByText('Serial number: OLD1 → NEW1')).toBeInTheDocument();
    expect(screen.getByText('Role not mapped · 1')).toBeInTheDocument();
    expect(screen.getByText('Warnings')).toBeInTheDocument();
    // Notice translated by code, with its params interpolated.
    expect(screen.getByText('The operating system "Photon OS" is not in your catalogue, so it was left unchanged.')).toBeInTheDocument();
  });

  it('offers no choice on an object an earlier run already linked, and says how a first match was made', async () => {
    const linkedRow = {
      ...PREVIEW.rows[1],
      external_id: '99', external_name: 'par-web-01',
      asset: { id: 'asset-9', name: 'PAR-WEB-01', asset_reference: 'AST-11' },
      matched_by: 'link',
      diffs: [{ field: 'operating_system', before: 'Ubuntu 22.04 LTS', after: 'NixOS 25.05' }],
      warnings: [],
    };
    (apiClient.post as any).mockImplementation((url: string) => {
      if (url === '/netbox/sync/preview') return Promise.resolve({ ...PREVIEW, rows: [...PREVIEW.rows, linkedRow] });
      return Promise.resolve({});
    });
    renderPage();
    await screen.findByText('par-esx-01');
    fireEvent.click(screen.getByText('Synchronise now'));
    await waitFor(() => expect(screen.getByText('Review before applying')).toBeInTheDocument());

    // Already linked: the change is shown, nothing to decide.
    expect(screen.getByText('Operating system: Ubuntu 22.04 LTS → NixOS 25.05')).toBeInTheDocument();
    expect(screen.queryByLabelText('Correct the proposal for par-web-01')).not.toBeInTheDocument();
    // First match by serial number: said so, and open to correction.
    expect(screen.getByText('Recognised by its serial number.')).toBeInTheDocument();
    expect(screen.getByLabelText('Correct the proposal for par-esx-02')).toBeInTheDocument();
    expect(screen.getByText('Nothing is changed yet. These values are written when you press Apply.')).toBeInTheDocument();
  });

  it('renders the Netbox status notice with the status translated, not the raw value', async () => {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/netbox/status') return Promise.resolve(STATUS);
      if (url === '/netbox/records') {
        return Promise.resolve({
          items: [{
            ...AMBIGUOUS_ROW,
            state: 'linked',
            external_status: 'failed',
            candidates: [],
            message: {
              code: 'netbox_status_attention',
              params: { value: 'failed' },
              text: 'SERVER ENGLISH, SHOULD NOT BE SHOWN',
            },
          }],
          total: 1,
        });
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    renderPage('/it/settings?tab=netbox&state=linked');

    expect(await screen.findByText('Netbox reports this object as failed.')).toBeInTheDocument();
    expect(screen.queryByText(/SHOULD NOT BE SHOWN/)).not.toBeInTheDocument();
    // The raw value never leaks into the sentence.
    expect(screen.queryByText(/as failed\./)).toBeInTheDocument();
  });

  it('falls back to the server text for a notice code this build does not know', async () => {
    (apiClient.get as any).mockImplementation((url: string, config?: any) => {
      if (url === '/netbox/status') return Promise.resolve(STATUS);
      if (url === '/netbox/records') {
        return Promise.resolve({
          items: [{
            ...AMBIGUOUS_ROW,
            message: { code: 'something_new_from_the_backend', params: {}, text: 'A newer server explained this.' },
          }],
          total: 1,
        });
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    renderPage();

    expect(await screen.findByText('A newer server explained this.')).toBeInTheDocument();
  });

  it('shows the first preview without reuse_inventory and puts the decision notice on the row', async () => {
    await openPreview();

    expect(previewCalls()[0][1]).toEqual({});
    // Decision-tier notice sits next to the candidates it is about.
    expect(screen.getByText('An asset already uses the address 10.1.2.3. Choose whether it is the same equipment.'))
      .toBeInTheDocument();
    expect(screen.getByText('Suggested: PAR-ESX-03 AST-11')).toBeInTheDocument();
  });

  it('sends the decision taken on a new object in the next preview', async () => {
    await openPreview();

    fireEvent.click(screen.getByLabelText('Correct the proposal for par-sw-02'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Do not import this object/ }));

    // Shown at once, before the new plan comes back.
    expect(screen.getByText('Will not be imported')).toBeInTheDocument();

    await waitFor(() => expect(previewCalls()).toHaveLength(2), { timeout: 3000 });
    expect(previewCalls()[1][1]).toEqual({
      decisions: [{ external_type: 'device', external_id: '12', action: 'ignore' }],
      reuse_inventory: true,
    });
  });

  it('links every object that has a single suggestion in one go', async () => {
    await openPreview();

    fireEvent.click(screen.getByText('Link the 2 objects that have a single suggestion'));

    await waitFor(() => expect(previewCalls()).toHaveLength(2), { timeout: 3000 });
    expect(previewCalls()[1][1]).toEqual({
      decisions: [
        { external_type: 'device', external_id: '15', action: 'link', asset_id: 'asset-5' },
        { external_type: 'device', external_id: '16', action: 'link', asset_id: 'asset-6' },
      ],
      reuse_inventory: true,
    });
  });

  it('undoing a decision takes it out of the next preview', async () => {
    await openPreview();

    fireEvent.click(screen.getByLabelText('Correct the proposal for par-sw-02'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Do not import this object/ }));
    await waitFor(() => expect(previewCalls()).toHaveLength(2), { timeout: 3000 });

    fireEvent.click(screen.getByLabelText('Undo the choice for par-sw-02'));
    expect(screen.queryByText('Will not be imported')).not.toBeInTheDocument();

    await waitFor(() => expect(previewCalls()).toHaveLength(3), { timeout: 3000 });
    expect(previewCalls()[2][1]).toEqual({ decisions: [], reuse_inventory: true });
  });

  it('applies the run with the decisions taken in the dialog', async () => {
    await openPreview();

    fireEvent.click(screen.getByLabelText('Correct the proposal for par-sw-02'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Do not import this object/ }));
    await waitFor(() => expect(previewCalls()).toHaveLength(2), { timeout: 3000 });

    fireEvent.click(screen.getByText('Apply'));

    // The run is told what the preview listed, row by row: it writes nothing else.
    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/netbox/sync', {
      decisions: [{ external_type: 'device', external_id: '12', action: 'ignore' }],
      reviewed: PREVIEW.rows.map((row) => ({ external_type: row.external_type, external_id: row.external_id })),
    }));
  });

  it('presents a large inventory as a batch and applies that batch only', async () => {
    (apiClient.post as any).mockImplementation((url: string) => {
      if (url === '/netbox/sync/preview') {
        return Promise.resolve({
          ...PREVIEW,
          counts: { ...PREVIEW.counts, create: 640, update: 310, skipped: 600 },
          rows_truncated: true,
          batch: { listed: PREVIEW.rows.length, remaining: 830 },
          skipped_by_reason: { unmapped_role: 600 },
        });
      }
      if (url === '/netbox/sync') return Promise.resolve(STATUS);
      throw new Error(`Unexpected POST ${url}`);
    });

    await openPreview();

    expect(await screen.findByText(/^This is one batch\. 830 more objects are waiting/)).toBeInTheDocument();
    // Section titles say how much of each group this batch holds.
    expect(screen.getByText('To create (1 / 640)')).toBeInTheDocument();
    expect(screen.getByText('To update (1 / 310)')).toBeInTheDocument();
    // Out-of-scope objects come as counts from the server, not as rows.
    expect(screen.getByText('Skipped (600)')).toBeInTheDocument();
    expect(screen.getByText('Role not mapped · 600')).toBeInTheDocument();
    expect(screen.queryByText(/Everything is applied/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply this batch' }));

    await waitFor(() => expect(apiClient.post).toHaveBeenCalledWith('/netbox/sync', {
      decisions: [],
      reviewed: PREVIEW.rows.map((row) => ({ external_type: row.external_type, external_id: row.external_id })),
    }));
  });

  it('refuses to apply against a server that would ignore the reviewed list', async () => {
    (apiClient.post as any).mockImplementation((url: string) => {
      if (url === '/netbox/sync/preview') {
        // An older server: truncated rows, no `batch`, and it applies everything.
        const { batch: _batch, ...older } = PREVIEW as any;
        return Promise.resolve({ ...older, rows_truncated: true });
      }
      throw new Error(`Unexpected POST ${url}`);
    });

    await openPreview();

    expect(await screen.findByText(/^The server is older than this page/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
    expect(screen.queryByText(/and nothing else/)).not.toBeInTheDocument();
  });

  it('says exactly what Apply is about to write', async () => {
    await openPreview();
    // PREVIEW lists one creation and one update.
    expect(await screen.findByText('Applying writes the 2 creations and updates listed here, and nothing else.'))
      .toBeInTheDocument();
  });

  it('does not announce writes when the preview lists none', async () => {
    (apiClient.post as any).mockImplementation((url: string) => {
      if (url === '/netbox/sync/preview') {
        const rows = (PREVIEW as any).rows.filter((row: any) => row.action !== 'create' && row.action !== 'update');
        return Promise.resolve({ ...PREVIEW, rows });
      }
      throw new Error(`Unexpected POST ${url}`);
    });

    await openPreview();

    expect(await screen.findByText(/^Nothing to create or update here/)).toBeInTheDocument();
    expect(screen.queryByText(/and nothing else/)).not.toBeInTheDocument();
  });

  it('offers the next batch while objects wait for review', async () => {
    (apiClient.get as any).mockImplementation((url: string) => {
      if (url === '/netbox/status') return Promise.resolve({ ...STATUS, review_pending: 830 });
      if (url === '/netbox/records') return Promise.resolve({ items: [], total: 0 });
      throw new Error(`Unexpected GET ${url}`);
    });
    (apiClient.post as any).mockImplementation((url: string) => {
      if (url === '/netbox/sync/preview') return Promise.resolve(PREVIEW);
      throw new Error(`Unexpected POST ${url}`);
    });

    renderPage();

    expect(await screen.findByText(
      '830 objects are still waiting for review. Automatic synchronisation is on hold until they are reviewed.',
    )).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Review the next batch' }));

    expect(await screen.findByText('Review before applying')).toBeInTheDocument();
  });

  it('links an object to an existing asset through the shared picker', async () => {
    (apiClient.get as any).mockImplementation((url: string, config?: any) => {
      if (url === '/netbox/status') return Promise.resolve(STATUS);
      if (url === '/netbox/records') {
        const state = config?.params?.state;
        const items = state === 'ambiguous' ? [AMBIGUOUS_ROW] : [];
        return Promise.resolve({ items, total: items.length });
      }
      if (url === '/assets') {
        return Promise.resolve({
          items: [{ id: 'asset-9', name: 'PAR-SW-02', asset_reference: 'AST-20' }],
          total: 1,
        });
      }
      throw new Error(`Unexpected GET ${url}`);
    });

    await openPreview();

    fireEvent.click(screen.getByLabelText('Correct the proposal for par-sw-02'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Link to an existing asset/ }));

    const search = await screen.findByLabelText('Search for an asset');
    fireEvent.change(search, { target: { value: 'par' } });
    fireEvent.click(await screen.findByText('PAR-SW-02', undefined, { timeout: 3000 }));

    expect(screen.getByText('Linked by you to PAR-SW-02')).toBeInTheDocument();
    await waitFor(() => expect(previewCalls()).toHaveLength(2), { timeout: 3000 });
    expect(previewCalls()[1][1]).toEqual({
      decisions: [{ external_type: 'device', external_id: '12', action: 'link', asset_id: 'asset-9' }],
      reuse_inventory: true,
    });
  });

  it('drops the refused decision and shows what the backend said', async () => {
    (apiClient.post as any).mockImplementation((url: string, body?: any) => {
      if (url === '/netbox/sync/preview') {
        if (body?.decisions?.length) {
          return Promise.reject({
            response: { data: { statusCode: 409, code: 'NETBOX_ASSET_ALREADY_LINKED', message: 'PAR-ESX-03 is already linked to par-esx-99.' } },
          });
        }
        return Promise.resolve(PREVIEW);
      }
      throw new Error(`Unexpected POST ${url}`);
    });

    await openPreview();

    fireEvent.click(screen.getByLabelText('Decide about par-esx-03'));
    fireEvent.click(screen.getByRole('menuitem', { name: /Link to PAR-ESX-03/ }));

    expect(await screen.findByText('PAR-ESX-03 is already linked to par-esx-99.', undefined, { timeout: 3000 }))
      .toBeInTheDocument();
    // The refused decision is gone, and no further preview is asked for.
    await waitFor(() => expect(screen.getByLabelText('Decide about par-esx-03')).toBeInTheDocument());
    await new Promise((resolve) => { setTimeout(resolve, 900); });
    expect(previewCalls()).toHaveLength(2);
  });
  it('lists the sub-locations a run changes, once each', async () => {
    (apiClient.post as any).mockImplementation((url: string) => {
      if (url === '/netbox/sync/preview') {
        return Promise.resolve({
          ...PREVIEW,
          // The equipment row says where the asset goes, in words: the field
          // label is translated, never the raw diff key.
          rows: PREVIEW.rows.map((row) => (row.external_id === '13'
            ? { ...row, diffs: [{ field: 'sub_location', before: null, after: 'Salle serveurs' }] }
            : row)),
          sub_locations: {
            available: true,
            changes: [
              {
                action: 'create', sub_item_id: null, location_id: 'loc-1', location_name: 'Paris Data Center',
                external_id: '6', external_url: 'https://netbox.internal/dcim/locations/6/',
                name: 'Salle serveurs', previous_name: null, description: null, asset_count: 12,
              },
              {
                action: 'rename', sub_item_id: 'sub-1', location_id: 'loc-1', location_name: 'Paris Data Center',
                external_id: '7', external_url: 'https://netbox.internal/dcim/locations/7/',
                name: 'Salle B', previous_name: 'Salle A', description: null, asset_count: 0,
              },
              {
                action: 'conflict', sub_item_id: null, location_id: 'loc-2', location_name: 'Gouda Server Room',
                external_id: '9', external_url: 'https://netbox.internal/dcim/locations/9/',
                name: 'Local technique', previous_name: null, description: null, asset_count: 1,
              },
            ],
          },
        });
      }
      if (url === '/netbox/sync') return Promise.resolve(STATUS);
      throw new Error(`Unexpected POST ${url}`);
    });

    await openPreview();

    expect(await screen.findByText('Sub-locations (3)')).toBeInTheDocument();
    expect(screen.getByText(/^Sub-location: .* → Salle serveurs$/)).toBeInTheDocument();
    expect(screen.queryByText(/sub_location/)).not.toBeInTheDocument();
    expect(screen.getByText('New')).toBeInTheDocument();
    // A rename reads as one shared row changing, not as every asset moving.
    expect(screen.getByText('Salle A → Salle B')).toBeInTheDocument();
    expect(screen.getByText('Renamed')).toBeInTheDocument();
    expect(screen.getByText('Name already used, left unchanged')).toBeInTheDocument();
    expect(screen.getByText('12 assets')).toBeInTheDocument();
    // A shared row nobody ends up in shows no count at all.
    expect(screen.queryByText('0 assets')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Salle serveurs' }))
      .toHaveAttribute('href', 'https://netbox.internal/dcim/locations/6/');
  });

  it('says nothing about sub-locations when the run changes none', async () => {
    await openPreview();

    expect(await screen.findByText('To create (1)')).toBeInTheDocument();
    expect(screen.queryByText(/^Sub-locations/)).not.toBeInTheDocument();
  });

  it('says why sub-locations were left alone when Netbox refused its locations', async () => {
    (apiClient.post as any).mockImplementation((url: string) => {
      if (url === '/netbox/sync/preview') {
        return Promise.resolve({ ...PREVIEW, sub_locations: { available: false, changes: [] } });
      }
      if (url === '/netbox/sync') return Promise.resolve(STATUS);
      throw new Error(`Unexpected POST ${url}`);
    });

    await openPreview();

    expect(await screen.findByText('Netbox did not return its locations. Sub-locations were left unchanged in this run.'))
      .toBeInTheDocument();
    // The equipment plan is untouched by it.
    expect(screen.getByText('To create (1)')).toBeInTheDocument();
  });
});
