import { changeAppLanguage } from '../../i18n';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { NotifyProvider } from '../../components/notify/NotifyProvider';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import AdministrationViewPage, {
  type AdministrationAssetRow,
  type AdministrationDirectories,
  type AdministrationSummary,
} from './AdministrationViewPage';

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn() } }));
const auth = vi.hoisted(() => ({ level: 'member' as 'reader' | 'member' }));
const RANK: Record<string, number> = { none: 0, reader: 1, member: 2, admin: 3 };
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (resource: string, level: string) => resource !== 'settings' && RANK[auth.level] >= RANK[level] }),
}));
const download = vi.hoisted(() => vi.fn());
const navigate = vi.hoisted(() => vi.fn());
vi.mock('react-router-dom', async (importOriginal) => ({ ...(await importOriginal<typeof import('react-router-dom')>()), useNavigate: () => navigate }));
vi.mock('../../utils/downloadBlob', () => ({ downloadBlob: download, extractFilenameFromDisposition: () => null }));
const KINDS = vi.hoisted(() => [{ code: 'vm', label: 'Virtual machine' }, { code: 'physical', label: 'Physical server' }]);
const zoneOptions = vi.hoisted(() => ({
  adminZone: [{ code: 'tier_0', label: 'Niveau 0' }] as Array<{ code: string; label: string }>,
}));
vi.mock('../../hooks/useItOpsEnumOptions', () => {
  // The tenant translated a zone and a domain: the page shows the translated names.
  const byField = { adminZone: zoneOptions.adminZone, domain: [{ code: 'lab', label: 'Labo' }], serverKind: KINDS };
  const labelFor = (_field: string, code: string) => KINDS.find((kind) => kind.code === code)?.label ?? code;
  const value = { settings: null, byField, labelFor };
  return { default: () => value };
});
// The grid: its props, and the cells of `grid.rows` drawn inside the page, as AG Grid draws them
// (the selection header too).
const grid = vi.hoisted(() => ({ props: null as null | Record<string, any>, rows: [] as any[] }));
vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    const columns = props.columns as any[];
    const select = columns.find((col) => col.colId === 'select');
    const Header = select?.headerComponent;
    return (
      <div data-testid="grid">
        {Header && <Header />}
        {grid.rows.map((row) => columns.filter((col) => col.cellRenderer).map((col) => {
          const Cell = col.cellRenderer;
          return <div key={`${row.id}:${col.colId ?? col.field}`} data-testid={`cell-${col.colId ?? col.field}-${row.id}`}><Cell data={row} /></div>;
        }))}
      </div>
    );
  },
}));

const getMock = vi.mocked(api.get);
const postMock = vi.mocked(api.post);
const ENDPOINT = '/technologies/reports/administration';

const SUMMARY: AdministrationSummary = {
  most_sensitive: 'tier_0',
  zones: [
    {
      code: 'tier_0', label: 'Tier 0', description: 'Identity core', admin_group: 'Domain admins', deprecated: false, unknown: false,
      asset_counts: [{ kind: 'vm', count: 3 }, { kind: 'physical', count: 1 }], hosted_application_count: 2,
      directory_services: [{ id: 'tech-ad', reference: 'TEC-1', name: 'Active Directory' }],
    },
    {
      code: 'tier_1', label: 'Tier 1', description: null, admin_group: null, deprecated: false, unknown: false,
      asset_counts: [], hosted_application_count: 0, directory_services: [],
    },
    {
      code: 'legacy', label: 'Legacy', description: null, admin_group: null, deprecated: true, unknown: false,
      asset_counts: [{ kind: 'vm', count: 1 }], hosted_application_count: 0, directory_services: [],
    },
  ],
  without_zone: { asset_count: 5 },
  controls: [
    { key: 'assets_without_zone', count: 5 },
    { key: 'domain_controllers_outside', count: 0 },
    { key: 'directory_assets_outside', count: 1 },
    { key: 'trust_raised', count: 2 },
    { key: 'applications_on_most_sensitive', count: 3 },
  ],
};

const ROW: AdministrationAssetRow = {
  id: 'asset-host', reference: 'AST-6', name: 'host1', kind: 'physical', zone: 'tier_1',
  technologies: {
    total: 4,
    items: [
      { reference: 'TEC-2', name: 'vSphere', version: '8.0' },
      { reference: 'TEC-3', name: 'Windows Server', version: null },
      { reference: 'TEC-4', name: 'Veeam', version: null },
      { reference: 'TEC-5', name: 'SQL Server', version: '2019' },
    ],
  },
  applications: { total: 1, items: [{ reference: 'APP-3', name: 'Portal' }] },
  findings: ['trust_raised'],
  trust_peers: { total: 2, items: [
    { relation: 'contains', reference: 'AST-7', name: 'dc1', zone: 'tier_0' },
    { relation: 'cluster', reference: 'AST-5', name: 'vsphere', zone: 'tier_0' },
  ] },
  application_references: { total: 0, items: [] },
};
const ROW_BARE: AdministrationAssetRow = {
  ...ROW, id: 'asset-bare', reference: 'AST-9', name: 'bare', kind: 'vm', zone: null,
  technologies: { total: 0, items: [] }, applications: { total: 0, items: [] }, findings: ['assets_without_zone'], trust_peers: { total: 0, items: [] },
};

const DIRECTORIES: AdministrationDirectories = {
  services: [{ id: 'tech-ad', reference: 'TEC-1', name: 'Active Directory', zone: 'tier_0', servers: 2 }],
  forests: [
    {
      forest: 'corp.example.com',
      domains: [{
        code: 'corp', label: 'Corp', dns_suffix: 'corp.example.com', forest: 'corp.example.com',
        trusts: [{ domain: 'lab', label: 'Lab', direction: 'two_way' }], declared_by: [],
        account_count: 1200, machine_count: 300, domain_controllers: [{ id: 'asset-dc1', name: 'dc1', reference: 'AST-7' }], deprecated: false,
      }],
    },
    {
      forest: null,
      domains: [{
        code: 'lab', label: 'Lab', dns_suffix: 'lab.example.com', forest: null, trusts: [],
        declared_by: [{ domain: 'corp', label: 'Corp', direction: 'two_way' }],
        account_count: null, machine_count: null, domain_controllers: [], deprecated: false,
      }],
    },
  ],
};

/** The address the page writes, read back by the tests. */
const address = { search: '' };
function Address() {
  address.search = useLocation().search;
  return null;
}

function renderPage(entry = '/it/administration') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <NotifyProvider>
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[entry]}><AdministrationViewPage /><Address /></MemoryRouter>
        </QueryClientProvider>
      </NotifyProvider>
    </ThemeProvider>,
  );
}

/** A stand-in for AG Grid's API: the filter model it holds, reported back as the grid does. */
function gridApi() {
  let model: Record<string, unknown> = {};
  const api = {
    getFilterModel: vi.fn(() => model),
    setFilterModel: vi.fn((next: Record<string, unknown>) => {
      model = next ?? {};
      act(() => grid.props!.onQueryStateChange({ sort: 'name:ASC', filterModel: model, q: '' }));
    }),
  };
  act(() => grid.props!.onGridApiReady(api));
  return api;
}

const column = (key: string) => (grid.props!.columns as any[]).find((col) => (col.colId ?? col.field) === key);
const cell = (key: string, data: AdministrationAssetRow) => screen.getByTestId(`cell-${key}-${data.id}`);
const FILTERS = JSON.stringify({ control: { filterType: 'set', values: ['trust_raised'] } });
const listed = (total: number, filters: string | undefined = FILTERS, q?: string) => act(() => grid.props!.onListRequestChange({
  params: { page: 1, limit: 50, sort: 'name:ASC', ...(filters ? { filters } : {}), ...(q ? { q } : {}) }, total,
}));
const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const zoneRow = (name: string) => within(screen.getByRole('group', { name: 'Administration zones' })).getByRole('button', { name: new RegExp(`^${name}`) });

describe('AdministrationViewPage', () => {
  beforeEach(() => {
    grid.props = null;
    grid.rows = [ROW, ROW_BARE];
    zoneOptions.adminZone.splice(0, zoneOptions.adminZone.length, { code: 'tier_0', label: 'Niveau 0' });
    getMock.mockReset();
    postMock.mockReset();
    download.mockReset();
    navigate.mockReset();
    auth.level = 'member';
    getMock.mockImplementation(async (url: string) => {
      if (url === ENDPOINT) return { data: SUMMARY } as any;
      if (url === `${ENDPOINT}/directories`) return { data: DIRECTORIES } as any;
      if (url === `${ENDPOINT}/export`) return { data: new Blob(['x']), headers: {} } as any;
      throw new Error(`unexpected ${url}`);
    });
  });

  it('has a title and no subtitle', async () => {
    renderPage();
    expect(screen.getByRole('heading', { name: 'Administration zones' })).toBeTruthy();
    await screen.findByRole('group', { name: 'Administration zones' });
    expect(screen.queryByText(/administration view of/i)).toBeNull();
  });

  it('opens on the assets tab, with a count on each tab', async () => {
    renderPage();
    await screen.findByRole('group', { name: 'Administration zones' });
    // 3 + 1 + 1 assets in the zones, 5 without one; 1 directory service and 2 domains.
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Assets 10' }).getAttribute('aria-selected')).toBe('true'));
    await waitFor(() => expect(screen.getByRole('tab', { name: 'Directories and domains 3' }).getAttribute('aria-selected')).toBe('false'));
    expect(screen.getByTestId('grid')).toBeTruthy();
    expect(screen.queryByRole('table', { name: 'Directory services' })).toBeNull();
  });

  it('switches to the directories and domains and back, keeping the filters of the address', async () => {
    const filters = encodeURIComponent(FILTERS);
    renderPage(`/it/administration?filters=${filters}`);
    await screen.findByRole('group', { name: 'Administration zones' });
    fireEvent.click(screen.getByRole('tab', { name: /^Directories and domains/ }));
    expect(await screen.findByRole('table', { name: 'Directory services' })).toBeTruthy();
    expect(screen.queryByTestId('grid')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Administration zones' })).toBeNull();
    let params = new URLSearchParams(address.search);
    expect(params.get('tab')).toBe('directories');
    expect(params.get('filters')).toBe(FILTERS);
    // Both exports stay in the header.
    expect(screen.getByRole('button', { name: 'Export assets' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Export domains' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: /^Assets/ }));
    expect(await screen.findByRole('group', { name: 'Administration zones' })).toBeTruthy();
    params = new URLSearchParams(address.search);
    expect(params.get('tab')).toBeNull();
    expect(params.get('filters')).toBe(FILTERS);
  });

  it('opens the directories and domains tab from the address', async () => {
    renderPage('/it/administration?tab=directories');
    expect(await screen.findByRole('table', { name: 'Directory services' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: /^Directories and domains/ }).getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByTestId('grid')).toBeNull();
  });

  it('shows one compact row per zone, its description under its name, then No zone', async () => {
    renderPage();
    const band = await screen.findByRole('group', { name: 'Administration zones' });
    const rows = within(band).getAllByRole('button');
    expect(screen.getByText('Choose a zone to filter the asset list.')).toBeTruthy();
    expect(rows.map((row) => row.textContent)).toEqual([
      'Niveau 0Identity coreAdministrator groupDomain adminsVirtual machine: 3, Physical server: 1·2 applications·1 directory service',
      'Tier 1No asset in this zone.',
      'Legacy (no longer offered)Virtual machine: 1·0 applications',
      'No zone5 assets',
    ]);
    // The description sits under the name, in the zone's first cell, in tertiary text.
    const description = within(rows[0]).getByTestId('zone-description');
    expect(description.previousElementSibling?.textContent).toBe('Niveau 0');
    expect(rows[0].getAttribute('title')).toBe('Show the assets in Niveau 0.');
    expect(rows[3].getAttribute('title')).toBe('Show the assets in No zone.');
    expect(getComputedStyle(description).fontSize).toBe('12px');
  });

  it('narrows the asset list to the zone selected, and clears it on a second click', async () => {
    renderPage();
    await screen.findByRole('group', { name: 'Administration zones' });
    const api = gridApi();
    fireEvent.click(zoneRow('Niveau 0'));
    expect(api.setFilterModel).toHaveBeenLastCalledWith({ zone: { filterType: 'set', values: ['tier_0'] } });
    expect(zoneRow('Niveau 0').getAttribute('aria-pressed')).toBe('true');
    // Another zone replaces it; No zone filters on an empty zone.
    fireEvent.click(zoneRow('No zone'));
    expect(api.setFilterModel).toHaveBeenLastCalledWith({ zone: { filterType: 'set', values: [null] } });
    expect(zoneRow('Niveau 0').getAttribute('aria-pressed')).toBe('false');
    expect(zoneRow('No zone').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(zoneRow('No zone'));
    expect(api.setFilterModel).toHaveBeenLastCalledWith({});
    expect(zoneRow('No zone').getAttribute('aria-pressed')).toBe('false');
  });

  it('writes zone names in the address and sends catalog codes to the grid', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === ENDPOINT) return {
        data: {
          ...SUMMARY,
          zones: [
            ...SUMMARY.zones,
            {
              code: 'tiens_1', label: 'Palier 1', description: null, admin_group: null, deprecated: false, unknown: false,
              asset_counts: [], hosted_application_count: 0, directory_services: [],
            },
          ],
        },
      } as any;
      if (url === `${ENDPOINT}/directories`) return { data: DIRECTORIES } as any;
      throw new Error(`unexpected ${url}`);
    });
    const filters = JSON.stringify({ zone: { filterType: 'set', values: ['tiens_1', null] } });
    renderPage(`/it/administration?filters=${encodeURIComponent(filters)}`);
    await screen.findByRole('group', { name: 'Administration zones' });
    await waitFor(() => {
      const parsed = JSON.parse(new URLSearchParams(address.search).get('filters') || '{}');
      expect(parsed.zone.values).toEqual(['Palier 1', null]);
    });
    expect(address.search).not.toContain('tiens_1');
    const api = gridApi();
    api.setFilterModel({ zone: { filterType: 'set', values: ['Palier 1', null] } });
    expect(api.setFilterModel).toHaveBeenLastCalledWith({ zone: { filterType: 'set', values: ['tiens_1', null] } });
    api.setFilterModel({ zone: { filterType: 'set', values: ['not-a-zone'] } });
    expect(api.setFilterModel).toHaveBeenLastCalledWith({ zone: { filterType: 'set', values: ['not-a-zone'] } });
  });

  it('starts the grid on the zone code of a link that names the zone, once the zones are known', async () => {
    let answer: (value: unknown) => void = () => undefined;
    getMock.mockImplementation(async (url: string) => {
      if (url === ENDPOINT) return new Promise((resolve) => { answer = resolve; }) as any;
      if (url === `${ENDPOINT}/directories`) return { data: DIRECTORIES } as any;
      throw new Error(`unexpected ${url}`);
    });
    const filters = JSON.stringify({ zone: { filterType: 'set', values: ['Tier 1'] } });
    renderPage(`/it/administration?filters=${encodeURIComponent(filters)}`);
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(ENDPOINT));
    expect(grid.props).toBeNull();
    await act(async () => { answer({ data: SUMMARY }); });
    await screen.findByRole('group', { name: 'Administration zones' });
    await waitFor(() => expect(grid.props).not.toBeNull());
    expect(grid.props!.initialState).toEqual({ filter: { filterModel: { zone: { filterType: 'set', values: ['tier_1'] } } } });
  });

  it('reads a shared zone name whatever the no-break spaces of the language', async () => {
    zoneOptions.adminZone.push({ code: 'tier_1', label: 'Tier\u00a01 : Production' });
    const filters = JSON.stringify({ zone: { filterType: 'set', values: ['Tier 1 : Production'] } });
    renderPage(`/it/administration?filters=${encodeURIComponent(filters)}`);
    await screen.findByRole('group', { name: 'Administration zones' });
    await waitFor(() => expect(grid.props!.initialState).toEqual({
      filter: { filterModel: { zone: { filterType: 'set', values: ['tier_1'] } } },
    }));
  });

  it('shows one toggle per control with its count; one filters the list at a time, again to clear', async () => {
    renderPage();
    const toggles = await screen.findByRole('group', { name: 'Control points' });
    expect(within(toggles).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Without a zone5', 'Domain controller outside0', 'Directory service outside1', 'Less sensitive host2', 'Application hosted3',
    ]);
    // A zero count is quiet.
    expect(getComputedStyle(screen.getByTestId('control-count-domain_controllers_outside')).color)
      .not.toBe(getComputedStyle(screen.getByTestId('control-count-trust_raised')).color);
    // The tooltip names the button while it shows: take it before.
    const trust = within(toggles).getByRole('button', { name: 'Less sensitive host 2' });
    fireEvent.mouseOver(trust);
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toContain('What runs an asset is in a less sensitive zone');
    expect(tooltip.textContent).toContain('The most sensitive zone is Niveau 0.');
    const api = gridApi();
    fireEvent.click(trust);
    expect(api.setFilterModel).toHaveBeenLastCalledWith({ control: { filterType: 'set', values: ['trust_raised'] } });
    expect(trust.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(toggles).getByRole('button', { name: 'Without a zone 5' }));
    expect(api.setFilterModel).toHaveBeenLastCalledWith({ control: { filterType: 'set', values: ['assets_without_zone'] } });
    fireEvent.click(within(toggles).getByRole('button', { name: 'Without a zone 5' }));
    expect(api.setFilterModel).toHaveBeenLastCalledWith({});
  });

  it('says that the other controls need a catalog of zones when there is none', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === ENDPOINT) {
        return { data: { most_sensitive: null, zones: [], without_zone: { asset_count: 2 }, controls: SUMMARY.controls.map((c) => ({ ...c, count: c.key === 'assets_without_zone' ? 2 : null })) } } as any;
      }
      return { data: { services: [], forests: [] } } as any;
    });
    renderPage();
    const toggles = await screen.findByRole('group', { name: 'Control points' });
    expect(within(toggles).getAllByRole('button').map((button) => button.textContent)).toEqual(['Without a zone2']);
    expect(screen.getByText('Add an administration zone in the IT settings to run the other checks.')).toBeTruthy();
    expect(screen.getByText('No administration zones defined yet.')).toBeTruthy();
  });

  it('lists the assets on the server grid with filters on zone, type and control', async () => {
    renderPage();
    await screen.findByRole('group', { name: 'Administration zones' });
    expect(grid.props!.endpoint).toBe(`${ENDPOINT}/assets`);
    expect(grid.props!.enableSearch).toBe(true);
    expect(grid.props!.defaultSort).toEqual({ field: 'name', direction: 'ASC' });
    expect((grid.props!.columns as any[]).map((col) => col.colId ?? col.field)).toEqual([
      'select', 'reference', 'name', 'kind', 'zone', 'technologies', 'applications', 'control',
    ]);
    expect(column('control').field).toBe('findings');
    for (const key of ['technologies', 'applications', 'control']) expect(column(key).sortable).toBe(false);
    for (const key of ['technologies', 'applications']) expect(column(key).filter).toBe(false);
    expect(column('kind').valueFormatter({ value: 'vm' })).toBe('Virtual machine');
    // The types in the order of their names, whatever the order of the catalog.
    expect(await column('kind').filterParams.getValues({})).toEqual([{ value: 'physical', label: 'Physical server' }, { value: 'vm', label: 'Virtual machine' }]);
    expect(await column('zone').filterParams.getValues({})).toEqual([
      { value: 'tier_0', label: 'Niveau 0' }, { value: 'tier_1', label: 'Tier 1' }, { value: 'legacy', label: 'Legacy (no longer offered)' }, { value: null, label: 'No zone' },
    ]);
    expect((await column('control').filterParams.getValues({})).map((v: any) => v.value)).toEqual([
      'assets_without_zone', 'domain_controllers_outside', 'directory_assets_outside', 'trust_raised', 'applications_on_most_sensitive',
    ]);
  });

  it('draws the cells: reference link, zone, names with +n and their list, controls with the trust explained', async () => {
    renderPage();
    await screen.findByRole('group', { name: 'Administration zones' });
    expect(within(cell('reference', ROW)).getByRole('link', { name: 'AST-6' }).getAttribute('href')).toBe('/it/assets/AST-6');
    // The zone cells read the zones of the summary: no zone in quiet text.
    expect(cell('zone', ROW).textContent).toBe('Tier 1');
    expect(cell('zone', ROW_BARE).textContent).toBe('No zone');
    expect(cell('technologies', ROW).textContent).toBe('vSphere, Windows Server+2');
    expect(cell('technologies', ROW_BARE).textContent).toBe('');
    fireEvent.mouseOver(cell('technologies', ROW).firstElementChild!);
    expect((await screen.findByRole('tooltip')).textContent).toBe('TEC-2 vSphere 8.0TEC-3 Windows ServerTEC-4 VeeamTEC-5 SQL Server 2019');
    fireEvent.mouseLeave(cell('technologies', ROW).firstElementChild!);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    expect(within(cell('applications', ROW)).getByRole('link', { name: 'Portal' }).getAttribute('href')).toBe('/it/applications/APP-3');
    expect(cell('control', ROW).textContent).toBe('Less sensitive host');
    expect(cell('control', ROW_BARE).textContent).toBe('Without a zone');
    expect(column('control').wrapText).toBeUndefined();
    expect(column('control').autoHeight).toBeUndefined();
    fireEvent.mouseOver(within(cell('control', ROW)).getByText('Less sensitive host'));
    expect((await screen.findByRole('tooltip')).textContent).toBe('Runs AST-7 dc1 (Niveau 0)Member of cluster AST-5 vsphere (Niveau 0)');
  });

  it('names a host in French as Héberge', async () => {
    await changeAppLanguage('fr');
    const view = renderPage();
    try {
      await screen.findByRole('group', { name: "Zones d'administration" });
      fireEvent.mouseOver(within(cell('control', ROW)).getByText('Hôte moins sensible'));
      expect((await screen.findByRole('tooltip')).textContent).toBe('Héberge AST-7 dc1 (Niveau 0)Membre du cluster AST-5 vsphere (Niveau 0)');
    } finally {
      view.unmount();
      await changeAppLanguage('en');
    }
  });

  it('counts three controls on one line and names each in the tooltip', async () => {
    const many: AdministrationAssetRow = {
      ...ROW,
      id: 'asset-many',
      reference: 'PAR-AD-01',
      name: 'ad',
      findings: ['assets_without_zone', 'domain_controllers_outside', 'trust_raised'],
    };
    grid.rows = [many];
    renderPage();
    await screen.findByRole('group', { name: 'Administration zones' });
    const control = cell('control', many);
    expect(control.textContent).toBe('3 controls');
    expect(control.querySelectorAll('[data-finding]')).toHaveLength(0);
    expect(control.querySelector('[data-finding-count]')?.getAttribute('data-finding-count')).toBe('3');
    fireEvent.mouseOver(within(control).getByText('3 controls'));
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip.textContent).toContain('Without a zone');
    expect(tooltip.textContent).toContain('Domain controller outside');
    expect(tooltip.textContent).toContain('Less sensitive host');
    expect(tooltip.textContent).toContain('Runs AST-7 dc1 (Niveau 0)');
    expect(tooltip.textContent).toContain('Member of cluster AST-5 vsphere (Niveau 0)');
  });

  it('opens the asset on a click in its row, and leaves a link in a cell to open its own page', async () => {
    renderPage();
    await screen.findByRole('group', { name: 'Administration zones' });
    const click = (colId: string, target: Element) => grid.props!.onCellClicked({ data: ROW, column: { getColId: () => colId }, event: { target } });
    const app = within(cell('applications', ROW)).getByRole('link', { name: 'Portal' });
    click('applications', app);
    click('reference', within(cell('reference', ROW)).getByRole('link', { name: 'AST-6' }));
    expect(navigate).not.toHaveBeenCalled();
    click('applications', cell('applications', ROW));
    expect(navigate).toHaveBeenCalledWith('/it/assets/AST-6');
  });

  it('assigns a zone to the ticked assets after a dry-run count, then reloads the band, the toggles and the grid', async () => {
    postMock.mockImplementation(async (_url: string, body: any) => ({
      data: body.dry_run ? { ok: true, dry_run: true, rows: 2, changes: 1, as_of: '2026-10-19T10:00:00.000Z' } : { ok: true, rows: 2, changed: 1 },
    }) as any);
    renderPage();
    await screen.findByRole('group', { name: 'Administration zones' });
    listed(40);
    expect((screen.getByRole('button', { name: 'Assign to a zone' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(box('Select AST-6 host1'));
    fireEvent.click(box('Select AST-9 bare'));
    expect(screen.getByTestId('administration-selection').textContent).toBe('2 assets selected');
    fireEvent.click(screen.getByRole('button', { name: 'Assign to a zone (2)' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('The 2 selected assets.');
    // No zone is chosen at the opening: nothing is counted, nothing can be assigned.
    expect(within(dialog).getByRole('combobox', { name: 'Zone' }).textContent).toBe('Choose a zone');
    expect(within(dialog).getByRole('status').textContent).toBe('Choose a zone to see how many assets change.');
    expect((within(dialog).getByRole('button', { name: 'Assign' }) as HTMLButtonElement).disabled).toBe(true);
    expect(postMock).not.toHaveBeenCalled();
    // The zones offered: those of the catalog still offered, then No zone.
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Zone' }));
    const options = (await screen.findAllByRole('option')).map((option) => option.textContent);
    expect(options).toEqual(['Niveau 0', 'Tier 1', 'No zone']);
    fireEvent.click(screen.getByRole('option', { name: 'Niveau 0' }));
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('This changes the zone of 1 asset of 2.'));
    expect(postMock).toHaveBeenLastCalledWith(`${ENDPOINT}/assets/zone`, { zone: 'tier_0', ids: ['asset-host', 'asset-bare'], dry_run: true });
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Zone' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Tier 1' }));
    await waitFor(() => expect(postMock).toHaveBeenLastCalledWith(`${ENDPOINT}/assets/zone`, { zone: 'tier_1', ids: ['asset-host', 'asset-bare'], dry_run: true }));
    const assign = within(dialog).getByRole('button', { name: 'Assign' }) as HTMLButtonElement;
    await waitFor(() => expect(assign.disabled).toBe(false));
    const summaryReads = getMock.mock.calls.filter(([url]) => url === ENDPOINT).length;
    fireEvent.click(assign);
    await waitFor(() => expect(postMock).toHaveBeenLastCalledWith(`${ENDPOINT}/assets/zone`, {
      zone: 'tier_1', ids: ['asset-host', 'asset-bare'], as_of: '2026-10-19T10:00:00.000Z', expected_rows: 2,
    }));
    await waitFor(() => expect(grid.props!.refreshKey).toBe(1));
    await waitFor(() => expect(getMock.mock.calls.filter(([url]) => url === ENDPOINT).length).toBeGreaterThan(summaryReads));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByTestId('administration-selection')).toBeNull();
    // A short message gives the number of assets changed.
    expect(await screen.findByText('Zone changed on 1 asset.')).toBeInTheDocument();
  });

  it('assigns No zone to every asset of the filter but the unticked ones, with the list request as scope', async () => {
    postMock.mockImplementation(async (_url: string, body: any) => ({
      data: body.dry_run ? { ok: true, dry_run: true, rows: 39, changes: 39, as_of: '2026-10-19T10:00:01.000Z' } : { ok: true, rows: 39, changed: 39 },
    }) as any);
    renderPage();
    await screen.findByRole('group', { name: 'Administration zones' });
    listed(40, FILTERS, 'srv');
    fireEvent.click(box('Select every asset of the filter'));
    fireEvent.click(box('Select AST-6 host1'));
    expect(screen.getByTestId('administration-selection').textContent).toBe('39 assets selected, whole filter');
    fireEvent.click(screen.getByRole('button', { name: 'Assign to a zone (39)' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Every asset of the current filter but 1.');
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Zone' }));
    fireEvent.click(await screen.findByRole('option', { name: 'No zone' }));
    // The list request: its search and grid filters only, no paging or sort.
    const scope = { zone: null, all: true, filters: { q: 'srv', filters: FILTERS }, exclude_ids: ['asset-host'] };
    await waitFor(() => expect(postMock).toHaveBeenLastCalledWith(`${ENDPOINT}/assets/zone`, { ...scope, dry_run: true }));
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('This changes the zone of 39 assets of 39.'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    await waitFor(() => expect(postMock).toHaveBeenLastCalledWith(`${ENDPOINT}/assets/zone`, { ...scope, as_of: '2026-10-19T10:00:01.000Z', expected_rows: 39 }));
    // A filter change clears the selection.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(box('Select AST-9 bare'));
    listed(12, undefined);
    expect(screen.queryByTestId('administration-selection')).toBeNull();
  });

  it('refuses an assignment over the cap with a line that says to narrow the filters', async () => {
    postMock.mockRejectedValue(Object.assign(new Error('400'), { response: { status: 400, data: { code: 'bulk_too_many', message: 'These filters reach 9000 rows' } } }));
    renderPage();
    await screen.findByRole('group', { name: 'Administration zones' });
    listed(9000);
    fireEvent.click(box('Select every asset of the filter'));
    fireEvent.click(screen.getByRole('button', { name: 'Assign to a zone (9000)' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Zone' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Tier 1' }));
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('More than 5,000 assets: narrow the filters.'));
    expect((within(dialog).getByRole('button', { name: 'Assign' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('counts again when the list changed between the count and the assignment (409)', async () => {
    let counts = 0;
    postMock.mockImplementation(async (_url: string, body: any) => {
      if (body.dry_run) {
        counts += 1;
        return { data: { ok: true, dry_run: true, rows: 40 + counts - 1, changes: 40 + counts - 1, as_of: `2026-10-19T10:00:0${counts}.000Z` } } as any;
      }
      if (body.expected_rows === 40) throw Object.assign(new Error('409'), { response: { status: 409, data: { code: 'bulk_list_changed' } } });
      return { data: { ok: true, rows: 41, changed: 41 } } as any;
    });
    renderPage();
    await screen.findByRole('group', { name: 'Administration zones' });
    listed(40);
    fireEvent.click(box('Select every asset of the filter'));
    fireEvent.click(screen.getByRole('button', { name: 'Assign to a zone (40)' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.mouseDown(within(dialog).getByRole('combobox', { name: 'Zone' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Tier 1' }));
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toContain('40 assets of 40'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Assign' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('The list changed since the count. Check the new count, then confirm again.');
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toContain('41 assets of 41'));
  });

  it('gives a reader neither selection nor assignment', async () => {
    auth.level = 'reader';
    renderPage();
    await screen.findByRole('group', { name: 'Administration zones' });
    expect(column('select')).toBeUndefined();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Assign to a zone/ })).toBeNull();
  });

  it('lists the directory services, then the domains grouped by forest', async () => {
    renderPage('/it/administration?tab=directories');
    const services = await screen.findByRole('table', { name: 'Directory services' });
    expect(within(services).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Ref', 'Name', 'Zone', 'Servers']);
    expect(within(services).getByRole('link', { name: 'TEC-1' }).getAttribute('href')).toBe('/it/technologies/tech-ad');
    const serviceRow = within(services).getAllByRole('row')[1];
    expect(serviceRow.textContent).toContain('Active Directory');
    expect(serviceRow.textContent).toContain('Niveau 0');
    expect(serviceRow.textContent).toContain('2');
    expect(screen.getByRole('heading', { name: 'corp.example.com' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'No forest' })).toBeTruthy();
    const corp = screen.getByRole('table', { name: 'corp.example.com' });
    const headers = within(corp).getAllByRole('columnheader').map((th) => th.textContent);
    expect(headers).toEqual(['Domain', 'DNS suffix', 'Trusts', 'Accounts', 'Computers', 'Domain controllers']);
    const corpRow = within(corp).getAllByRole('row')[1].textContent;
    expect(corpRow).toContain('Labo (two-way)');
    expect(corpRow).toContain('1,200');
    expect(corpRow).toContain('300');
    expect(within(corp).getByRole('link', { name: 'dc1' }).getAttribute('href')).toBe('/it/assets/AST-7');
    const lab = screen.getByRole('table', { name: 'No forest' });
    expect(within(lab).getAllByRole('row')[1].textContent).toContain('Corp (two-way, declared on that domain)');
  });

  it('exports the assets with the filters on screen, and the domains', async () => {
    renderPage();
    await screen.findByRole('group', { name: 'Administration zones' });
    listed(40, FILTERS, 'srv');
    fireEvent.click(screen.getByRole('button', { name: 'Export assets' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSV' }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(`${ENDPOINT}/export`, expect.objectContaining({
      params: { sort: 'name:ASC', filters: FILTERS, q: 'srv', list: 'assets', language: 'en', format: 'csv' }, responseType: 'blob',
    })));
    await waitFor(() => expect(download).toHaveBeenCalledWith(expect.any(Blob), 'administration_view_assets.csv'));
    fireEvent.click(screen.getByRole('button', { name: 'Export domains' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Excel (.xlsx)' }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(`${ENDPOINT}/export`, expect.objectContaining({ params: { list: 'domains', language: 'en', format: 'xlsx' } })));
  });
});
