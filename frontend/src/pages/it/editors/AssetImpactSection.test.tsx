import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import AssetImpactSection, { IMPACT_ROWS_SHOWN, type AssetImpact } from './AssetImpactSection';

const translation = {
  t: (key: string, opts?: Record<string, unknown>) => {
    const args = opts ? Object.entries(opts).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../../api', () => ({ default: { get: vi.fn() } }));
vi.mock('../../../hooks/useItOpsEnumOptions', () => ({ default: () => ({ settings: null, byField: {}, labelFor: (_field: string, code: string) => `kind:${code}` }) }));
vi.mock('../../../hooks/useApplicationClassificationCatalog', () => ({
  default: () => ({ data: { businessCriticalityLevels: [{ code: 'business_critical', label: 'Business critical' }] } }),
}));

const mocked = vi.mocked(api);
const P = 'workspace.asset.impact';

function impact(overrides: Partial<AssetImpact> = {}): AssetImpact {
  const host = { id: 'host', name: 'ESX-01' };
  const vm1 = { id: 'vm1', name: 'VM-01' };
  return {
    asset: { id: 'host', reference: 'AST-1', name: 'ESX-01' },
    assets: [
      { id: 'host', reference: 'AST-1', name: 'ESX-01', kind: 'server', depth: 0, relation: null, via: [] },
      { id: 'vm1', reference: 'AST-2', name: 'VM-01', kind: 'vm', depth: 1, relation: 'contains', via: [host] },
      { id: 'web', reference: 'AST-3', name: 'WEB-01', kind: 'vm', depth: 2, relation: 'depends_on', via: [host, vm1] },
    ],
    clusters: [
      { id: 'cl', reference: 'AST-9', name: 'VSPHERE-CL', state: 'degraded', members: 3, fallen_members: 2, applications: 0, via: [host, { id: 'esx2', name: 'ESX-02' }], via_total: 2 },
      { id: 'solo', reference: 'AST-8', name: 'SOLO-CL', state: 'down', members: 1, fallen_members: 1, applications: 0, via: [host], via_total: 1 },
    ],
    applications: [
      { id: 'erp', reference: 'APP-4', name: 'ERP', criticality: 'business_critical', environments: ['prod', 'pre_prod'], via: [vm1, host], via_total: 2 },
    ],
    technologies: [{ id: 'tec', reference: 'TEC-1', name: 'vSphere', versions: ['8.0'], via: [host], via_total: 1 }],
    processes: [{ id: 'bp', name: 'Finance', via: [{ id: 'erp', name: 'ERP' }], via_total: 1 }],
    totals: { assets: 2, applications: 1, clusters: 2, technologies: 1, processes: 1 },
    ...overrides,
  };
}

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderSection(data: AssetImpact | Error, isServer = true) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url !== '/assets/host/impact') throw new Error(`unexpected GET ${url}`);
    if (data instanceof Error) throw data;
    return { data } as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/assets/host/relations']}>
          <Routes>
            <Route path="*" element={<><AssetImpactSection assetId="host" isServer={isServer} /><Location /></>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { client };
}

beforeEach(() => {
  mocked.get.mockReset();
});

describe('AssetImpactSection', () => {
  it('summarises the counts and lists each kind in its own table', async () => {
    renderSection(impact());
    expect(await screen.findByText(`${P}.title`)).toBeInTheDocument();
    expect(screen.getByText([
      `${P}.summary.applications(count=1)`,
      `${P}.summary.assets(count=2)`,
      `${P}.summary.clustersDown(count=1)`,
      `${P}.summary.clustersDegraded(count=1)`,
      `${P}.summary.processes(count=1)`,
    ].join(' · '))).toBeInTheDocument();

    // One row per application, its environments together: the section counts what the summary counts.
    expect(screen.getByRole('region', { name: `${P}.sections.applications` })).toHaveTextContent(`${P}.sections.applications1`);
    const apps = screen.getByRole('table', { name: `${P}.sections.applications` });
    const appRows = within(apps).getAllByRole('row').slice(1);
    expect(appRows).toHaveLength(1);
    expect(within(appRows[0]).getByText('APP-4')).toBeInTheDocument();
    expect(within(appRows[0]).getByText('Business critical')).toBeInTheDocument();
    expect(within(appRows[0]).getByText('enums.environment.prod, enums.environment.preProd')).toBeInTheDocument();
    expect(within(appRows[0]).getByText(`${P}.via.onThisServerAnd(name=VM-01)`)).toBeInTheDocument();

    // The server itself is not listed; each asset says how it falls, the full path on hover.
    const assets = screen.getByRole('table', { name: `${P}.sections.assets` });
    const assetRows = within(assets).getAllByRole('row').slice(1);
    expect(assetRows.map((row) => within(row).getAllByRole('cell')[1].textContent)).toEqual(['VM-01', 'WEB-01']);
    expect(within(assetRows[0]).getByText(`${P}.via.containsThisServer`)).toBeInTheDocument();
    expect(within(assetRows[1]).getByText(`${P}.via.dependsOn(name=VM-01)`)).toHaveAttribute('title', 'ESX-01 › VM-01 › WEB-01');
    expect(within(assetRows[1]).getByText('kind:vm')).toBeInTheDocument();

    const clusters = screen.getByRole('table', { name: `${P}.sections.clusters` });
    expect(within(clusters).getByText(`${P}.state.degraded(count=2,members=3)`)).toBeInTheDocument();
    expect(within(clusters).getByText(`${P}.state.down`)).toBeInTheDocument();
    // The server's own name reads through a whole-sentence key in every language.
    expect(within(clusters).getByText(`${P}.via.thisServer`)).toBeInTheDocument();
    expect(within(clusters).getByText(`${P}.via.thisServerAnd(name=ESX-02)`)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: `${P}.sections.technologies` })).not.toBeInTheDocument();
    expect(screen.queryByText('TEC-1')).not.toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: `${P}.sections.processes` })).getByText('Finance')).toBeInTheDocument();

    fireEvent.click(within(assetRows[1]).getByText('WEB-01'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/web/overview');
  });

  it('words the members of a cluster that falls, and the VMs it takes down', async () => {
    const cluster = { id: 'host', name: 'SQL-CL' };
    const member = { id: 'm1', name: 'SQL-01' };
    renderSection(impact({
      asset: { id: 'host', reference: 'AST-1', name: 'SQL-CL' },
      assets: [
        { id: 'host', reference: 'AST-1', name: 'SQL-CL', kind: 'cluster', depth: 0, relation: null, via: [] },
        { id: 'm1', reference: 'AST-2', name: 'SQL-01', kind: 'server', depth: 1, relation: 'member', via: [cluster] },
        { id: 'vm', reference: 'AST-3', name: 'VM-01', kind: 'vm', depth: 2, relation: 'contains', via: [cluster, member] },
      ],
      clusters: [], applications: [], processes: [], totals: { assets: 2, applications: 0, clusters: 0, technologies: 0, processes: 0 },
    }));
    const assets = await screen.findByRole('table', { name: `${P}.sections.assets` });
    expect(within(assets).getByText(`${P}.via.memberThisServer`)).toBeInTheDocument();
    expect(within(assets).getByText(`${P}.via.contains(name=SQL-01)`)).toBeInTheDocument();
    expect(within(assets).queryByText(`${P}.via.containsThisServer`)).not.toBeInTheDocument();
  });

  it('names the member of a cluster further down the path', async () => {
    const other = { id: 'other', name: 'ESX-02' };
    renderSection(impact({
      assets: [
        impact().assets[0],
        { id: 'm1', reference: 'AST-2', name: 'SQL-01', kind: 'server', depth: 2, relation: 'member', via: [{ id: 'host', name: 'ESX-01' }, other] },
      ],
      clusters: [], applications: [], processes: [], totals: { assets: 1, applications: 0, clusters: 0, technologies: 0, processes: 0 },
    }));
    const assets = await screen.findByRole('table', { name: `${P}.sections.assets` });
    expect(within(assets).getByText(`${P}.via.member(name=ESX-02)`)).toBeInTheDocument();
  });

  it('says in a tooltip what stands in a degraded cluster', async () => {
    renderSection(impact());
    const clusters = await screen.findByRole('table', { name: `${P}.sections.clusters` });
    expect(within(clusters).getByTitle(`${P}.state.degradedHint(count=1,members=3)`)).toHaveTextContent(`${P}.state.degraded(count=2,members=3)`);
    // A cluster that is down has nothing left to say.
    const down = within(clusters).getByText(`${P}.state.down`);
    expect(down.closest('[title]')).toBeNull();
  });

  it('does not repeat the cluster of a member that is its only fallen member: it is in its membership', async () => {
    // The page is the member's own: it is the one fallen member of the degraded cluster.
    renderSection(impact({
      clusters: [
        { id: 'cl', reference: 'AST-9', name: 'VSPHERE-CL', state: 'degraded', members: 2, fallen_members: 1, applications: 0, via: [{ id: 'host', name: 'ESX-01' }], via_total: 1 },
      ],
      totals: { assets: 2, applications: 1, clusters: 1, technologies: 1, processes: 1 },
    }));
    await screen.findByText(`${P}.title`);
    expect(screen.queryByRole('table', { name: `${P}.sections.clusters` })).not.toBeInTheDocument();
    expect(screen.queryByText(new RegExp('summary.clustersDegraded'))).not.toBeInTheDocument();
  });

  it('keeps the cluster of the only fallen member when the cluster carries applications', async () => {
    const own = { id: 'cl', reference: 'AST-9', name: 'VSPHERE-CL', state: 'degraded' as const, members: 2, fallen_members: 1, via: [{ id: 'host', name: 'ESX-01' }], via_total: 1 };
    renderSection(impact({ clusters: [{ ...own, applications: 2 }], totals: { assets: 2, applications: 1, clusters: 1, technologies: 1, processes: 1 } }));
    const clusters = await screen.findByRole('table', { name: `${P}.sections.clusters` });
    expect(within(clusters).getByTitle(`${P}.state.degradedHint(count=1,members=2)`)).toHaveTextContent(`${P}.state.degraded(count=1,members=2)`);
  });

  it('keeps a member\'s cluster that goes down, or that other fallen assets degrade', async () => {
    renderSection(impact({
      clusters: [
        { id: 'solo', reference: 'AST-8', name: 'SOLO-CL', state: 'down', members: 1, fallen_members: 1, applications: 0, via: [{ id: 'host', name: 'ESX-01' }], via_total: 1 },
        { id: 'cl', reference: 'AST-9', name: 'VSPHERE-CL', state: 'degraded', members: 3, fallen_members: 2, applications: 0, via: [{ id: 'host', name: 'ESX-01' }, { id: 'esx2', name: 'ESX-02' }], via_total: 2 },
      ],
      totals: { assets: 2, applications: 1, clusters: 2, technologies: 1, processes: 1 },
    }));
    const clusters = await screen.findByRole('table', { name: `${P}.sections.clusters` });
    expect(within(clusters).getAllByRole('row')).toHaveLength(3);
    expect(screen.getByRole('region', { name: `${P}.sections.clusters` })).toHaveTextContent(`${P}.sections.clusters2`);
  });

  it('shows the first rows of a long list and counts the rest', async () => {
    const many = Array.from({ length: 200 }, (_, n) => ({
      id: `vm${n}`, reference: `AST-${n + 10}`, name: `VM-${String(n).padStart(3, '0')}`, kind: 'vm', depth: 1, relation: 'contains' as const, via: [{ id: 'host', name: 'ESX-01' }],
    }));
    const application = { id: 'erp', reference: 'APP-4', name: 'ERP', criticality: null, environments: [], via: [{ id: 'host', name: 'ESX-01' }], via_total: 25 };
    renderSection(impact({
      assets: [impact().assets[0], ...many],
      applications: [application],
      totals: { ...impact().totals, assets: 640, applications: 1 },
    }));
    expect(await screen.findByText(new RegExp(`${P}.summary.assets\\(count=640\\)`))).toBeInTheDocument();
    const assets = screen.getByRole('table', { name: `${P}.sections.assets` });
    expect(within(assets).getAllByRole('row')).toHaveLength(IMPACT_ROWS_SHOWN + 1);
    expect(screen.getByText(`${P}.more(count=${640 - IMPACT_ROWS_SHOWN})`)).toBeInTheDocument();
    const apps = screen.getByRole('table', { name: `${P}.sections.applications` });
    expect(within(apps).getByText(`${P}.via.onThisServerAnd(name=${P}.more(count=24))`)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: `${P}.sections.technologies` })).not.toBeInTheDocument();
  });

  it('keeps the section on screen while it is read again', async () => {
    const { client } = renderSection(impact());
    expect(await screen.findByRole('table', { name: `${P}.sections.assets` })).toBeInTheDocument();
    mocked.get.mockImplementation(() => new Promise(() => undefined));
    void client.invalidateQueries({ queryKey: ['asset-impact', 'host'] });
    expect(screen.getByRole('table', { name: `${P}.sections.assets` })).toBeInTheDocument();
    await waitFor(() => expect(mocked.get).toHaveBeenCalledTimes(2));
  });

  it('leaves out empty sections and those the caller cannot read', async () => {
    renderSection(impact({ clusters: [], technologies: [], applications: null, processes: null, totals: { assets: 2, applications: 0, clusters: 0, technologies: 0, processes: 0 } }));
    expect(await screen.findByText(`${P}.summary.assets(count=2)`)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: `${P}.sections.assets` })).toBeInTheDocument();
    for (const section of ['applications', 'clusters', 'technologies', 'processes']) {
      expect(screen.queryByRole('table', { name: `${P}.sections.${section}` })).not.toBeInTheDocument();
    }
    expect(screen.queryByText(`${P}.empty`)).not.toBeInTheDocument();
  });

  it('leaves technologies out even when they are the only thing that falls', async () => {
    renderSection(impact({
      assets: impact().assets.slice(0, 1),
      clusters: [],
      applications: [],
      processes: [],
      technologies: [{ id: 'tec', reference: 'TEC-1', name: 'vSphere', versions: ['8.0'], via: [{ id: 'host', name: 'ESX-01' }], via_total: 1 }],
      totals: { assets: 0, applications: 0, clusters: 0, technologies: 1, processes: 0 },
    }));
    expect(await screen.findByText(`${P}.empty`)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.queryByText('TEC-1')).not.toBeInTheDocument();
  });

  it('says so in one line when nothing else falls', async () => {
    const none = { assets: 0, applications: 0, clusters: 0, technologies: 0, processes: 0 };
    renderSection(impact({ assets: impact().assets.slice(0, 1), clusters: [], applications: [], technologies: [], processes: [], totals: none }));
    expect(await screen.findByText(`${P}.empty`)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('speaks of infrastructure only when the caller cannot read applications', async () => {
    const none = { assets: 0, applications: 0, clusters: 0, technologies: 0, processes: 0 };
    renderSection(impact({ assets: impact().assets.slice(0, 1), clusters: [], applications: null, technologies: [], processes: null, totals: none }));
    expect(await screen.findByText(`${P}.emptyInfrastructure`)).toBeInTheDocument();
    expect(screen.queryByText(`${P}.empty`)).not.toBeInTheDocument();
  });

  it('says when the impact cannot be read', async () => {
    renderSection(new Error('boom'));
    expect(await screen.findByText(`${P}.loadFailed`)).toBeInTheDocument();
  });

  it('speaks of the asset when it is not a server', async () => {
    renderSection(impact(), false);
    expect(await screen.findByText(`${P}.titleAsset`)).toBeInTheDocument();
    expect(screen.queryByText(`${P}.title`)).not.toBeInTheDocument();
    const apps = screen.getByRole('table', { name: `${P}.sections.applications` });
    expect(within(apps).getByText(`${P}.via.onThisAssetAnd(name=VM-01)`)).toBeInTheDocument();
    const assets = screen.getByRole('table', { name: `${P}.sections.assets` });
    const assetRows = within(assets).getAllByRole('row').slice(1);
    expect(within(assetRows[0]).getByText(`${P}.via.containsThisAsset`)).toBeInTheDocument();
    const clusters = screen.getByRole('table', { name: `${P}.sections.clusters` });
    expect(within(clusters).getByText(`${P}.via.thisAsset`)).toBeInTheDocument();
    expect(within(clusters).getByText(`${P}.via.thisAssetAnd(name=ESX-02)`)).toBeInTheDocument();
  });

  it('says nothing else depends on an asset that is not a server', async () => {
    const none = { assets: 0, applications: 0, clusters: 0, technologies: 0, processes: 0 };
    renderSection(impact({
      assets: impact().assets.slice(0, 1),
      clusters: [],
      applications: [],
      technologies: [],
      processes: [],
      totals: none,
    }), false);
    expect(await screen.findByText(`${P}.emptyAsset`)).toBeInTheDocument();
    expect(screen.queryByText(`${P}.empty`)).not.toBeInTheDocument();
  });
});
