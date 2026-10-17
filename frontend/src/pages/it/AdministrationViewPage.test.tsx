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
const stableT = (key: string, options?: Record<string, unknown>) => (options && Object.keys(options).length ? `${key}:${JSON.stringify(options)}` : key);
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'fr', resolvedLanguage: 'fr' } }),
}));
vi.mock('../../api', () => ({ default: { get } }));
vi.mock('../../utils/downloadBlob', () => ({ downloadBlob: download, extractFilenameFromDisposition: () => 'administration_view_zones.csv' }));
vi.mock('../../hooks/useItOpsEnumOptions', () => ({
  default: () => ({ settings: null, byField: {}, labelFor: (_field: string, code: string) => ({ directory: 'Directory and identity', hypervisor: 'Hypervisor' } as Record<string, string>)[code] ?? code }),
}));

const VIEW: AdministrationView = {
  zones: [
    {
      code: 'tier_0', label: 'Tier 0', admin_group: 'Domain admins', privilege_level: 'Tier 0', secrets_location: 'Vault A', description: 'Identity core',
      deprecated: false, unknown: false, server_count: 1,
      technologies: [{ id: 'tech-ad', reference: 'TEC-1', name: 'Active Directory', family: 'directory', directory: true, servers: [{ id: 'asset-dc1', name: 'dc1', reference: null, via_name: null }] }],
      directory_services: [{ id: 'tech-ad', reference: 'TEC-1', name: 'Active Directory' }],
    },
    { code: 'tier_1', label: 'Tier 1', admin_group: null, privilege_level: null, secrets_location: null, description: null, deprecated: false, unknown: false, server_count: 0, technologies: [], directory_services: [] },
    {
      code: null, label: null, admin_group: null, privilege_level: null, secrets_location: null, description: null, deprecated: false, unknown: false, server_count: 2,
      technologies: [{ id: 'tech-vs', reference: 'TEC-3', name: 'vSphere', family: 'hypervisor', directory: false, servers: [{ id: 'asset-h', name: 'host1', reference: null, via_name: null }, { id: 'asset-vm', name: 'vm1', reference: null, via_name: 'host1' }] }],
      directory_services: [],
    },
  ],
  domains: [
    { code: 'corp', label: 'Corp', dns_suffix: 'corp.example.com', forest: 'corp.example.com', trusts: [{ domain: 'lab', label: 'Lab', direction: 'two_way' }], account_count: 1200, machine_count: 300, domain_controllers: [{ id: 'asset-dc1', name: 'dc1', reference: null }], deprecated: false },
    { code: 'lab', label: 'Lab', dns_suffix: 'lab.example.com', forest: null, trusts: [], account_count: null, machine_count: null, domain_controllers: [], deprecated: false },
  ],
  unplaced_count: 1,
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
    download.mockReset();
    get.mockImplementation(async (url: string) => (url.endsWith('/export') ? { data: new Blob(['x']), headers: {} } : { data: VIEW }));
  });

  it('lists each zone with its attributes, technologies, servers and directory services', async () => {
    renderPage();
    const tier0 = await screen.findByRole('region', { name: 'Tier 0' });
    expect(within(tier0).getByText('Domain admins')).toBeInTheDocument();
    expect(within(tier0).getByText('Vault A')).toBeInTheDocument();
    expect(within(tier0).getByText('Identity core')).toBeInTheDocument();
    const table = within(tier0).getByRole('table', { name: 'Tier 0' });
    expect(within(table).getByText('TEC-1')).toBeInTheDocument();
    expect(within(table).getByText('Directory and identity')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: 'dc1' })).toHaveAttribute('href', '/it/assets/asset-dc1');
    expect(within(tier0).getByText('pages.administrationView.attributes.directoryServices')).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Tier 1' })).getByText('pages.administrationView.emptyZone')).toBeInTheDocument();
    expect(get).toHaveBeenCalledWith('/technologies/reports/administration');
  });

  it('flags the technologies without a zone as data to complete', async () => {
    renderPage();
    expect(await screen.findByText('pages.administrationView.unplaced:{"count":1}')).toBeInTheDocument();
    const none = screen.getByRole('region', { name: 'pages.administrationView.noZone' });
    expect(within(none).getByText('vSphere')).toBeInTheDocument();
    expect(within(none).getByText('pages.administrationView.via:{"name":"host1"}', { exact: false })).toBeInTheDocument();
  });

  it('lists the domains with forest, trusts, counts and deduced controllers', async () => {
    renderPage();
    const domains = await screen.findByRole('table', { name: 'pages.administrationView.domains' });
    const rows = within(domains).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Corp');
    expect(rows[1]).toHaveTextContent('Lab (pages.settings.trusts.directions.two_way)');
    expect(rows[1]).toHaveTextContent('1,200');
    expect(within(rows[1]).getByRole('link', { name: 'dc1' })).toBeInTheDocument();
    expect(rows[2]).toHaveTextContent('pages.administrationView.noController');
    expect(rows[2]).toHaveTextContent('pages.administrationView.notSet');
  });

  it('exports the zones as a CSV file in the user language', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Tier 0' });
    fireEvent.click(screen.getByRole('button', { name: 'pages.administrationView.exportZones' }));
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'administration_view_zones.csv'));
    expect(get).toHaveBeenCalledWith('/technologies/reports/administration/export', { params: { list: 'zones', language: 'fr' }, responseType: 'blob' });
  });

  it('points to the settings when no zone is defined', async () => {
    get.mockResolvedValue({ data: { zones: [], domains: [], unplaced_count: 0 } });
    renderPage();
    expect(await screen.findByRole('link', { name: 'pages.administrationView.openSettings' })).toHaveAttribute('href', '/it/settings');
    expect(screen.getByText('pages.administrationView.noDomains')).toBeInTheDocument();
  });
});
