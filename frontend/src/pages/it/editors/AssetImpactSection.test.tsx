import React from 'react';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import api from '../../../api';
import AssetImpactSection, { type AssetImpact } from './AssetImpactSection';

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
      { id: 'cl', reference: 'AST-9', name: 'VSPHERE-CL', state: 'degraded', members: 2, fallen_members: 1, via: [host] },
      { id: 'solo', reference: 'AST-8', name: 'SOLO-CL', state: 'down', members: 1, fallen_members: 1, via: [host] },
    ],
    applications: [
      { id: 'erp', reference: 'APP-4', name: 'ERP', criticality: 'business_critical', environment: 'prod', via: [vm1] },
      { id: 'erp', reference: 'APP-4', name: 'ERP', criticality: 'business_critical', environment: 'pre_prod', via: [host] },
    ],
    technologies: [{ id: 'tec', reference: 'TEC-1', name: 'vSphere', versions: ['8.0'], via: [host] }],
    processes: [{ id: 'bp', name: 'Finance', via: [{ id: 'erp', name: 'ERP' }] }],
    ...overrides,
  };
}

function Location() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderSection(data: AssetImpact | Error) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url !== '/assets/host/impact') throw new Error(`unexpected GET ${url}`);
    if (data instanceof Error) throw data;
    return { data } as never;
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/it/assets/host/relations']}>
          <Routes>
            <Route path="*" element={<><AssetImpactSection assetId="host" /><Location /></>} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
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
      `${P}.summary.technologies(count=1)`,
      `${P}.summary.processes(count=1)`,
    ].join(' · '))).toBeInTheDocument();

    const apps = screen.getByRole('table', { name: `${P}.sections.applications` });
    const appRows = within(apps).getAllByRole('row').slice(1);
    expect(appRows).toHaveLength(2);
    expect(within(appRows[0]).getByText('APP-4')).toBeInTheDocument();
    expect(within(appRows[0]).getByText('Business critical')).toBeInTheDocument();
    expect(within(appRows[0]).getByText('enums.environment.prod')).toBeInTheDocument();
    expect(within(appRows[0]).getByText(`${P}.via.on(name=VM-01)`)).toBeInTheDocument();
    expect(within(appRows[1]).getByText('enums.environment.preProd')).toBeInTheDocument();
    expect(within(appRows[1]).getByText(`${P}.via.on(name=${P}.via.thisServer)`)).toBeInTheDocument();

    // The server itself is not listed; each asset says how it falls, the full path on hover.
    const assets = screen.getByRole('table', { name: `${P}.sections.assets` });
    const assetRows = within(assets).getAllByRole('row').slice(1);
    expect(assetRows.map((row) => within(row).getAllByRole('cell')[1].textContent)).toEqual(['VM-01', 'WEB-01']);
    expect(within(assetRows[0]).getByText(`${P}.via.contains(name=${P}.via.thisServer)`)).toBeInTheDocument();
    expect(within(assetRows[1]).getByText(`${P}.via.dependsOn(name=VM-01)`)).toHaveAttribute('title', 'ESX-01 › VM-01 › WEB-01');
    expect(within(assetRows[1]).getByText('kind:vm')).toBeInTheDocument();

    const clusters = screen.getByRole('table', { name: `${P}.sections.clusters` });
    expect(within(clusters).getByText(`${P}.state.degraded(fallen=1,members=2)`)).toBeInTheDocument();
    expect(within(clusters).getByText(`${P}.state.down`)).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: `${P}.sections.technologies` })).getByText('TEC-1')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: `${P}.sections.processes` })).getByText('Finance')).toBeInTheDocument();

    fireEvent.click(within(assetRows[1]).getByText('WEB-01'));
    expect(screen.getByTestId('location')).toHaveTextContent('/it/assets/web/overview');
  });

  it('leaves out empty sections and those the caller cannot read', async () => {
    renderSection(impact({ clusters: [], technologies: [], applications: null, processes: null }));
    expect(await screen.findByText(`${P}.summary.assets(count=2)`)).toBeInTheDocument();
    expect(screen.getByRole('table', { name: `${P}.sections.assets` })).toBeInTheDocument();
    for (const section of ['applications', 'clusters', 'technologies', 'processes']) {
      expect(screen.queryByRole('table', { name: `${P}.sections.${section}` })).not.toBeInTheDocument();
    }
    expect(screen.queryByText(`${P}.empty`)).not.toBeInTheDocument();
  });

  it('says so in one line when nothing else falls', async () => {
    renderSection(impact({ assets: impact().assets.slice(0, 1), clusters: [], applications: [], technologies: [], processes: [] }));
    expect(await screen.findByText(`${P}.empty`)).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('says when the impact cannot be read', async () => {
    renderSection(new Error('boom'));
    expect(await screen.findByText(`${P}.loadFailed`)).toBeInTheDocument();
  });
});
