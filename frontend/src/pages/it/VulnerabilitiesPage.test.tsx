import '../../i18n';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import VulnerabilitiesPage, { filterModelFromSearch, type VulnerabilityRow } from './VulnerabilitiesPage';
import type { VulnerabilityDetail } from './vulnerabilities/vulnerabilityTypes';

vi.mock('../../api', () => ({ default: { get: vi.fn(), patch: vi.fn(), post: vi.fn() } }));
const auth = vi.hoisted(() => ({ level: 'member' as 'reader' | 'member' | 'none' }));
const RANK: Record<string, number> = { none: 0, reader: 1, member: 2, admin: 3 };
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (_resource: string, level: string) => RANK[auth.level] >= RANK[level] }),
}));
const features = vi.hoisted(() => ({ vulnerabilityFeed: true }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features } }) }));
vi.mock('../ForbiddenPage', () => ({ default: () => <div>Forbidden</div> }));
const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    return null;
  },
}));

const getMock = vi.mocked(api.get);
const patchMock = vi.mocked(api.patch);
const postMock = vi.mocked(api.post);
const CVE = 'CVE-2026-1001';

const VERSION_980 = {
  id: 'row-1', technology_version_id: 'v-980', version_label: '9.0.80', potential: false, match_basis: 'version_in_range',
  matching: true, state: 'to_review' as const, note: null, state_changed_at: null, state_changed_by_name: null,
};
const VERSION_UNKNOWN = { ...VERSION_980, id: 'row-2', technology_version_id: null, version_label: null, potential: true, match_basis: 'version_unknown' };
const ROW: VulnerabilityRow = {
  cve_id: CVE,
  summary: 'Remote code execution in the connector',
  cvss_score: 9.8,
  severity: 'critical',
  cvss_version: '3.1',
  published_at: '2026-09-30T00:00:00.000Z',
  technologies: [{ technology_id: 'tech-1', reference: 'TEC-1', name: 'Tomcat', editor: 'Apache', versions: [VERSION_980, VERSION_UNKNOWN] }],
  editor: 'Apache',
  state: 'to_review',
  servers: 2,
  applications: null,
};
const DETAIL: VulnerabilityDetail = {
  ...ROW,
  cvss_vector: 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
  reference_urls: ['https://example.com/advisory'],
  servers_list: [
    { asset_id: 'a-1', name: 'SRV-WEB-01', reference: null, technology_id: 'tech-1', technology_name: 'Tomcat', version_label: '9.0.80', via_asset_name: null },
    { asset_id: 'a-2', name: 'VM-APP-02', reference: null, technology_id: 'tech-1', technology_name: 'Tomcat', version_label: null, via_asset_name: 'ESX-01' },
  ],
  applications_list: null,
};

function renderPage(path = '/it/vulnerabilities') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}><VulnerabilitiesPage /></MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

const column = (field: string) => (grid.props!.columns as any[]).find((col) => col.field === field);
const FILTERS = JSON.stringify({ state: { filterType: 'set', values: ['to_review'] } });

describe('VulnerabilitiesPage', () => {
  beforeEach(() => {
    grid.props = null;
    getMock.mockReset();
    patchMock.mockReset();
    postMock.mockReset();
    auth.level = 'member';
    features.vulnerabilityFeed = true;
    getMock.mockImplementation(async (url: string) => {
      if (url === `/vulnerabilities/${CVE}`) return { data: DETAIL } as any;
      if (url === '/technologies') return { data: { items: [{ id: 'tech-1', reference: 'TEC-1', name: 'Tomcat' }] } } as any;
      throw new Error(`unexpected ${url}`);
    });
  });

  it('shows nothing and reads nothing while the vulnerability feed is off', () => {
    features.vulnerabilityFeed = false;
    const { container } = renderPage();
    expect(container.textContent).toBe('');
    expect(grid.props).toBeNull();
    expect(getMock).not.toHaveBeenCalled();
  });

  it('refuses a user without the infrastructure read right', () => {
    auth.level = 'none';
    renderPage();
    expect(screen.getByText('Forbidden')).toBeTruthy();
  });

  it('lists on the standard grid, to review by default, with filters per column', async () => {
    renderPage();
    expect(grid.props!.endpoint).toBe('/vulnerabilities');
    expect(grid.props!.columnPreferencesKey).toBe('it-vulnerabilities');
    expect(grid.props!.defaultSort).toEqual({ field: 'severity', direction: 'DESC' });
    expect(grid.props!.initialState.filter.filterModel).toEqual({ state: { filterType: 'set', values: ['to_review'] } });
    expect((grid.props!.columns as any[]).map((col) => col.field)).toEqual([
      'cve_id', 'severity', 'cvss_score', 'summary', 'technologies', 'editor', 'servers', 'applications', 'state', 'published_at',
    ]);
    expect(column('published_at').filter).toBe('agDateColumnFilter');
    expect(column('servers').filter).toBe(false);
    expect(await column('technologies').filterParams.getValues({})).toEqual([{ value: 'TEC-1', label: 'TEC-1 Tomcat' }]);
    expect(column('technologies').valueFormatter({ value: ROW.technologies }))
      .toBe('TEC-1 Tomcat 9.0.80, Version not recorded (potentially concerned)');
    expect((await column('state').filterParams.getValues({})).map((v: any) => v.label)).toEqual(['To review', 'Handled', 'Not affected']);
    // Critical in orange.
    const Severity = column('severity').cellRenderer;
    render(<ThemeProvider theme={createAppTheme('light')}><Severity data={ROW} /></ThemeProvider>);
    const severity = document.querySelector('[data-severity="critical"]') as HTMLElement;
    expect(severity.textContent).toBe('Critical9.8');
    expect(getComputedStyle(severity).color).toBe('rgb(180, 83, 9)');
  });

  it('turns the entries by publisher, technology and CVE into grid filters', () => {
    expect(filterModelFromSearch('?editor=Oracle&technology=TEC-1&state=all&q=CVE-2026-1001')).toEqual({
      editor: { filterType: 'set', values: ['Oracle'] },
      technologies: { filterType: 'set', values: ['TEC-1'] },
      cve_id: { filterType: 'text', type: 'contains', filter: 'CVE-2026-1001' },
    });
    expect(filterModelFromSearch('?state=handled&severity=high')).toEqual({
      state: { filterType: 'set', values: ['handled'] },
      severity: { filterType: 'set', values: ['high'] },
    });
  });

  it('says what to do when nothing is to review', () => {
    renderPage();
    render(<ThemeProvider theme={createAppTheme('light')}>{grid.props!.emptyState}</ThemeProvider>);
    expect(screen.getByTestId('vulnerabilities-empty').textContent).toContain('CPE identifiers');
  });

  it('opens a CVE in the side panel: servers with the way through, a line for hidden applications', async () => {
    renderPage();
    act(() => grid.props!.onCellClicked({ data: ROW, column: { getColId: () => 'cve_id' } }));
    const detail = await screen.findByTestId('vulnerability-detail');
    expect(getMock).toHaveBeenCalledWith(`/vulnerabilities/${CVE}`);
    expect(screen.getByRole('region', { name: CVE })).toBeTruthy();
    expect(detail.textContent).toContain('CVSS:3.1/AV:N');
    expect(within(detail).getByRole('link', { name: 'SRV-WEB-01' }).getAttribute('href')).toBe('/it/assets/a-1');
    expect(detail.textContent).toContain('VM-APP-02 · Tomcat Version not recorded (potentially concerned) · through ESX-01');
    expect(detail.textContent).toContain('The applications are hidden');
    // A member changes the state of one version there.
    patchMock.mockResolvedValue({ data: { ok: true } } as any);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'State of 9.0.80' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Handled' }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith(`/technologies/tech-1/vulnerabilities/${CVE}`, { state: 'handled', technology_version_id: 'v-980' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('vulnerability-detail')).toBeNull());
  });

  it('changes the state of the selection, or of the whole filter, with the count first', async () => {
    postMock.mockImplementation(async (_url: string, body: any) => ({
      data: body.dry_run ? (body.all ? { rows: 120, cves: 40, changes: 118 } : { rows: 3, cves: 2, changes: 3 }) : { ok: true, changed: 3 },
    }) as any);
    renderPage();
    expect(grid.props!.enableRowSelection).toBe(true);
    act(() => {
      grid.props!.onSelectionChanged([ROW, { ...ROW, cve_id: 'CVE-2026-1002' }]);
      grid.props!.onListRequestChange({ params: { page: 1, limit: 50, sort: 'severity:DESC', filters: FILTERS }, total: 40 });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Change state (2)' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Common note' }), { target: { value: 'Patched in March' } });
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('This changes 3 rows of 3, on 2 vulnerabilities.'));
    expect(postMock).toHaveBeenLastCalledWith('/vulnerabilities/bulk-state', {
      state: 'handled', note: 'Patched in March', cve_ids: [CVE, 'CVE-2026-1002'], filters: { sort: 'severity:DESC', filters: FILTERS }, dry_run: true,
    });
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Every vulnerability of the current filter' }));
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('This changes 118 rows of 120, on 40 vulnerabilities.'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change state' }));
    await waitFor(() => expect(postMock).toHaveBeenLastCalledWith('/vulnerabilities/bulk-state', {
      state: 'handled', note: 'Patched in March', all: true, filters: { sort: 'severity:DESC', filters: FILTERS },
    }));
    await waitFor(() => expect(grid.props!.refreshKey).toBe(1));
  });

  it('refuses a change over the cap with a line that says to narrow the filters', async () => {
    postMock.mockRejectedValue(Object.assign(new Error('400'), { response: { status: 400 } }));
    renderPage();
    act(() => grid.props!.onListRequestChange({ params: { page: 1, limit: 50 }, total: 9000 }));
    fireEvent.click(screen.getByRole('button', { name: 'Change state' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toContain('More than 5,000 rows'));
    expect((within(dialog).getByRole('button', { name: 'Change state' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('gives a reader neither selection nor change of state', () => {
    auth.level = 'reader';
    renderPage();
    expect(grid.props!.enableRowSelection).toBe(false);
    expect(screen.queryByRole('button', { name: /Change state/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
  });
});
