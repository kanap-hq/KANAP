import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import AdministrationViewPage, { type AdministrationView } from './AdministrationViewPage';

const get = vi.hoisted(() => vi.fn());
const download = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ settings: true }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: (resource: string) => resource !== 'settings' || auth.settings }) }));
const stableT = (key: string, options?: Record<string, unknown>) => (options && Object.keys(options).length ? `${key}:${JSON.stringify(options)}` : key);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'fr', resolvedLanguage: 'fr' } }),
}));
vi.mock('../../api', () => ({ default: { get } }));
vi.mock('../../utils/downloadBlob', () => ({ downloadBlob: download, extractFilenameFromDisposition: () => 'administration_view_zones.csv' }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  // The tenant translated a zone and a domain: the page shows the translated names.
  default: () => ({ settings: null, byField: { adminZone: [{ code: 'tier_0', label: 'Niveau 0' }], domain: [{ code: 'lab', label: 'Labo' }] }, labelFor: (_field: string, code: string) => code }),
}));

const EMPTY_CONTROLS: AdministrationView['controls'] = {
  most_sensitive_zone: null,
  assets_without_zone: [],
  domain_controllers_outside: null,
  directory_assets_outside: null,
  trust_raised: null,
  applications_on_most_sensitive: null,
};

const VIEW: AdministrationView = {
  zones: [
    {
      code: 'tier_0', label: 'Tier 0', admin_group: 'Domain admins', description: 'Identity core',
      deprecated: false, unknown: false,
      assets: [{ id: 'asset-fw1', name: 'fw1', reference: 'AST-4', kind: 'firewall' }],
      asset_counts: [{ kind: 'firewall', count: 1 }],
      hosted_application_count: 2,
      directory_services: [{ id: 'tech-ad', reference: 'TEC-1', name: 'Active Directory' }],
    },
    {
      code: 'tier_1', label: 'Tier 1', admin_group: null, description: null,
      deprecated: true, unknown: false,
      assets: [], asset_counts: [], hosted_application_count: 0, directory_services: [],
    },
  ],
  domains: [
    { code: 'corp', label: 'Corp', dns_suffix: 'corp.example.com', forest: 'corp.example.com', trusts: [{ domain: 'lab', label: 'Lab', direction: 'two_way' }], declared_by: [], account_count: 1200, machine_count: 300, domain_controllers: [{ id: 'asset-dc1', name: 'dc1', reference: null }], deprecated: false },
    { code: 'lab', label: 'Lab', dns_suffix: 'lab.example.com', forest: null, trusts: [], declared_by: [{ domain: 'corp', label: 'Corp', direction: 'two_way' }], account_count: null, machine_count: null, domain_controllers: [], deprecated: false },
  ],
  controls: {
    most_sensitive_zone: 'tier_0',
    assets_without_zone: [{ id: 'asset-bare', name: 'bare', reference: 'AST-9', kind: 'vm' }],
    domain_controllers_outside: [{ id: 'asset-dc2', name: 'dc2', reference: 'AST-2', kind: 'vm' }],
    directory_assets_outside: [],
    trust_raised: [{
      asset: { id: 'asset-guest', name: 'guest', reference: 'AST-7', kind: 'vm' },
      asset_zone: 'tier_0',
      holder: { id: 'asset-host', name: 'host1', reference: 'AST-6', kind: 'vm' },
      holder_zone: 'tier_1',
      holder_kind: 'contains',
    }],
    applications_on_most_sensitive: [{
      id: 'app-1', name: 'Portal', reference: 'APP-3',
      asset: { id: 'asset-fw1', name: 'fw1', reference: 'AST-4', kind: 'firewall' },
    }],
  },
};

function renderPage() {
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter><AdministrationViewPage /></MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

describe('AdministrationViewPage', () => {
  beforeEach(() => {
    get.mockReset();
    auth.settings = true;
    download.mockReset();
    get.mockImplementation(async (url: string) => (url.endsWith('/export') ? { data: new Blob(['x']), headers: {} } : { data: VIEW }));
  });

  it('lists each zone with its assets, hosted applications and directory services', async () => {
    renderPage();
    const tier0 = await screen.findByRole('region', { name: 'Niveau 0' });
    expect(within(tier0).getByText('Domain admins')).toBeInTheDocument();
    expect(within(tier0).getByText('Identity core')).toBeInTheDocument();
    expect(within(tier0).getByText('firewall: 1')).toBeInTheDocument();
    expect(within(tier0).getByText('pages.administrationView.hostedApplications:{"count":2}')).toBeInTheDocument();
    const scope = within(tier0).getByRole('table', { name: 'pages.administrationView.scope' });
    expect(within(scope).getByRole('link', { name: 'AST-4' })).toHaveAttribute('href', '/it/assets/asset-fw1');
    expect(within(scope).getByText('fw1')).toBeInTheDocument();
    expect(within(scope).getByText('firewall')).toBeInTheDocument();
    const cols = scope.querySelectorAll('col');
    expect(cols).toHaveLength(4);
    expect(cols[0]).toHaveStyle({ width: '96px' });
    expect(cols[1]).toHaveStyle({ width: '240px' });
    expect(cols[2]).toHaveStyle({ width: '160px' });
    expect(cols[3].getAttribute('style')).toBeNull();
    const directory = within(tier0).getByRole('table', { name: 'pages.administrationView.attributes.directoryServices' });
    expect(within(directory).getByRole('link', { name: 'TEC-1' })).toHaveAttribute('href', '/it/technologies/tech-ad');
    expect(within(directory).getByText('Active Directory')).toBeInTheDocument();
    expect(within(tier0).queryByText('asset-fw1')).toBeNull();
    expect(within(screen.getByRole('region', { name: 'Tier 1 (common:enumEditor.retiredSuffix)' })).getByText('pages.administrationView.scopeEmpty')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/technologies/reports/administration');
  });

  it('lists each control point with a link to the record to correct', async () => {
    renderPage();
    expect(await screen.findByText('pages.administrationView.controlsHint:{"zone":"Niveau 0"}')).toBeInTheDocument();
    const bare = screen.getByRole('region', { name: 'pages.administrationView.controlsList.assetsWithoutZone.title' });
    expect(within(bare).getByRole('link', { name: 'AST-9' })).toHaveAttribute('href', '/it/assets/asset-bare');
    expect(within(bare).queryByText('asset-bare')).toBeNull();
    const dc = screen.getByRole('region', { name: 'pages.administrationView.controlsList.domainControllers.title' });
    expect(within(dc).getByRole('link', { name: 'AST-2' })).toHaveAttribute('href', '/it/assets/asset-dc2');
    expect(within(dc).getByText('pages.administrationView.noZone')).toBeInTheDocument();
    const directory = screen.getByRole('region', { name: 'pages.administrationView.controlsList.directoryAssets.title' });
    expect(within(directory).getByText('pages.administrationView.none')).toBeInTheDocument();
    const trust = screen.getByRole('region', { name: 'pages.administrationView.controlsList.trustRaised.title' });
    expect(within(trust).getByRole('link', { name: 'AST-6' })).toHaveAttribute('href', '/it/assets/asset-host');
    expect(within(trust).getByText('pages.administrationView.relation.contains')).toBeInTheDocument();
    expect(within(trust).getByText('guest')).toBeInTheDocument();
    expect(within(trust).queryByText('asset-host')).toBeNull();
    const apps = screen.getByRole('region', { name: 'pages.administrationView.controlsList.applications.title' });
    expect(within(apps).getByRole('link', { name: 'APP-3' })).toHaveAttribute('href', '/it/applications/app-1');
    expect(within(apps).getByText('AST-4')).toBeInTheDocument();
    expect(within(apps).queryByText('app-1')).toBeNull();
  });

  it('lists the domains with forest, trusts, counts and deduced controllers', async () => {
    renderPage();
    const domains = await screen.findByRole('table', { name: 'pages.administrationView.domains' });
    const rows = within(domains).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Corp');
    expect(rows[1]).toHaveTextContent('Labo (pages.settings.trusts.directions.two_way)');
    expect(rows[1]).toHaveTextContent('1,200');
    expect(within(rows[1]).getByRole('link', { name: 'dc1' })).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('Labo');
    // The trust declared on Corp shows on Lab, read only.
    expect(rows[2]).toHaveTextContent('pages.administrationView.declaredTrust:{"name":"Corp","direction":"pages.settings.trusts.directions.two_way"}');
    expect(rows[2]).toHaveTextContent('pages.administrationView.noController');
    // Absent forest and counts: a dash each, "Not set" on hover.
    const dashes = within(rows[2]).getAllByTitle('pages.administrationView.notSet');
    expect(dashes).toHaveLength(3);
    for (const dash of dashes) expect(dash).toHaveTextContent('—');
    expect(rows[2]).not.toHaveTextContent('pages.administrationView.notSet');
  });

  it('exports the zones as a CSV file in the user language', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Niveau 0' });
    fireEvent.click(screen.getByRole('button', { name: 'pages.administrationView.exportZones' }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'administration_view_zones.csv'));
    expect(get).toHaveBeenCalledWith('/technologies/reports/administration/export', { params: { list: 'zones', language: 'fr' }, responseType: 'blob' });
  });

  it('points to the settings when no zone is defined', async () => {
    get.mockResolvedValue({ data: { zones: [], domains: [], controls: EMPTY_CONTROLS } });
    renderPage();
    expect(await screen.findByRole('link', { name: 'pages.administrationView.openSettings' })).toHaveAttribute('href', '/it/settings');
    expect(screen.getByText('pages.administrationView.noDomains')).toBeInTheDocument();
    expect(screen.getByText('pages.administrationView.controlsNoCatalog')).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'pages.administrationView.controlsList.domainControllers.title' })).toBeNull();
  });

  it('does not link to the settings without the right to read them', async () => {
    auth.settings = false;
    get.mockResolvedValue({ data: { zones: [], domains: [], controls: EMPTY_CONTROLS } });
    renderPage();
    expect(await screen.findByText('pages.administrationView.noZones')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'pages.administrationView.openSettings' })).toBeNull();
  });
});
