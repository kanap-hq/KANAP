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
// The grid: its props, and the selection column drawn for the rows of `grid.rows` (header box and
// row boxes), inside the page as AG Grid draws them.
const grid = vi.hoisted(() => ({ props: null as null | Record<string, any>, rows: [] as any[] }));
vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    const select = (props.columns as any[]).find((col) => col.colId === 'select');
    if (!select) return null;
    const Header = select.headerComponent;
    const Cell = select.cellRenderer;
    return <div data-testid="grid"><Header />{grid.rows.map((row) => <Cell key={row.id} data={row} />)}</div>;
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
/** Two grid rows of one CVE: Tomcat 9.0.80, and Tomcat without a recorded version. */
const ROW: VulnerabilityRow = {
  id: 'row-1',
  cve_id: CVE,
  summary: 'Remote code execution in the connector',
  cvss_score: 9.8,
  severity: 'critical',
  cvss_version: '3.1',
  published_at: '2026-09-30T00:00:00.000Z',
  technology: { id: 'tech-1', reference: 'TEC-1', name: 'Tomcat' },
  editor: 'Apache',
  version: '9.0.80',
  technology_version_id: 'v-980',
  potential: false,
  state: 'to_review',
  note: null,
  servers: 1,
  applications: null,
};
const ROW_NONE: VulnerabilityRow = { ...ROW, id: 'row-2', version: null, technology_version_id: null, potential: true };
const DETAIL: VulnerabilityDetail = {
  cve_id: CVE,
  summary: ROW.summary,
  cvss_score: 9.8,
  severity: 'critical',
  cvss_version: '3.1',
  published_at: ROW.published_at,
  technologies: [{ technology_id: 'tech-1', reference: 'TEC-1', name: 'Tomcat', editor: 'Apache', versions: [VERSION_980, VERSION_UNKNOWN] }],
  servers: 2,
  applications: null,
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

const column = (key: string) => (grid.props!.columns as any[]).find((col) => (col.field ?? col.colId) === key);
const FILTERS = JSON.stringify({ state: { filterType: 'set', values: ['to_review'] } });
const OTHER_FILTERS = JSON.stringify({ state: { filterType: 'set', values: ['handled'] } });
const listed = (total: number, filters = FILTERS, sort = 'severity:DESC') => act(() => grid.props!.onListRequestChange({ params: { page: 1, limit: 50, sort, filters }, total }));
const box = (name: string) => screen.getByRole('checkbox', { name }) as HTMLInputElement;
const ROW_BOX = 'Select CVE-2026-1001, Tomcat 9.0.80';
const ROW_NONE_BOX = 'Select CVE-2026-1001, Tomcat Not recorded';
const ALL_BOX = 'Select every row of the filter';

describe('VulnerabilitiesPage', () => {
  beforeEach(() => {
    grid.props = null;
    grid.rows = [ROW, ROW_NONE];
    getMock.mockReset();
    patchMock.mockReset();
    postMock.mockReset();
    auth.level = 'member';
    features.vulnerabilityFeed = true;
    getMock.mockImplementation(async (url: string) => {
      if (url === `/vulnerabilities/${CVE}`) return { data: DETAIL } as any;
      if (url === '/technologies') return { data: { items: [{ id: 'tech-1', reference: 'TEC-1', name: 'Tomcat' }] } } as any;
      if (url === '/vulnerabilities/filter-values') return { data: { version: ['9.0.80', '10.1.5', null] } } as any;
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

  it('lists one row per technology, version and CVE, to review by default, with filters per column', async () => {
    renderPage();
    expect(grid.props!.endpoint).toBe('/vulnerabilities');
    expect(grid.props!.columnPreferencesKey).toBe('it-vulnerabilities');
    expect(grid.props!.defaultSort).toEqual({ field: 'severity', direction: 'DESC' });
    expect(grid.props!.getRowId(ROW_NONE)).toBe('row-2');
    expect(grid.props!.initialState.filter.filterModel).toEqual({ state: { filterType: 'set', values: ['to_review'] } });
    expect((grid.props!.columns as any[]).map((col) => col.field ?? col.colId)).toEqual([
      'select', 'cve_id', 'severity', 'cvss_score', 'summary', 'technology', 'version', 'editor', 'servers', 'applications', 'state', 'note', 'published_at',
    ]);
    expect(column('published_at').filter).toBe('agDateColumnFilter');
    // The default set fits a 1,440 px window, the selection column included: the summary takes the rest.
    const shown = (grid.props!.columns as any[]).filter((col) => !col.defaultHidden);
    expect(shown.map((col) => col.field ?? col.colId)).toEqual(['select', 'cve_id', 'severity', 'summary', 'technology', 'version', 'servers', 'applications', 'state', 'published_at']);
    expect(shown.reduce((sum, col) => sum + (col.width ?? col.minWidth), 0)).toBeLessThanOrEqual(1100);
    expect(column('select')).toMatchObject({ suppressColumnsToolPanel: true, filter: false, sortable: false, width: 44 });
    expect(grid.props!.enableRowSelection).toBeFalsy();
    expect(column('summary').flex).toBe(1);
    expect(column('servers').filter).toBe(false);
    expect(await column('technology').filterParams.getValues({})).toEqual([{ value: 'TEC-1', label: 'TEC-1 Tomcat' }]);
    expect(column('technology').valueFormatter({ value: ROW.technology })).toBe('TEC-1 Tomcat');
    expect((await column('state').filterParams.getValues({})).map((v: any) => v.label)).toEqual(['To review', 'Handled', 'Not affected']);
    // Critical in orange.
    const Severity = column('severity').cellRenderer;
    render(<ThemeProvider theme={createAppTheme('light')}><Severity data={ROW} /></ThemeProvider>);
    const severity = document.querySelector('[data-severity="critical"]') as HTMLElement;
    expect(severity.textContent).toBe('Critical9.8');
    expect(getComputedStyle(severity).color).toBe('rgb(180, 83, 9)');
  });

  it('shows a version not recorded in quiet text, potentially concerned, and filters by version', async () => {
    renderPage();
    const Version = column('version').cellRenderer;
    const { container } = render(<ThemeProvider theme={createAppTheme('light')}><Version data={ROW} /><Version data={ROW_NONE} /></ThemeProvider>);
    expect(container.textContent).toBe('9.0.80Not recorded');
    expect(screen.getByLabelText('No version recorded: potentially concerned').textContent).toBe('Not recorded');
    // The labels the other filters reach, then "Not recorded"; the column's own filter left out.
    const filters = { state: { filterType: 'set', values: ['to_review'] }, version: { filterType: 'set', values: ['9.0.80'] } };
    const values = await column('version').filterParams.getValues({ context: { getQueryState: () => ({ q: '', filters }) } });
    expect(getMock).toHaveBeenCalledWith('/vulnerabilities/filter-values', expect.objectContaining({ params: { fields: 'version', filters: FILTERS } }));
    expect(values).toEqual([{ value: '9.0.80', label: '9.0.80' }, { value: '10.1.5', label: '10.1.5' }, { value: null, label: 'Not recorded' }]);
    expect(column('version').filterParams.emptyLabel).toBe('Not recorded');
  });

  it('turns the entries by publisher, technology, version and CVE into grid filters', () => {
    expect(filterModelFromSearch('?editor=Oracle&technology=TEC-1&state=all&q=CVE-2026-1001')).toEqual({
      editor: { filterType: 'set', values: ['Oracle'] },
      technology: { filterType: 'set', values: ['TEC-1'] },
      cve_id: { filterType: 'text', type: 'contains', filter: 'CVE-2026-1001' },
    });
    expect(filterModelFromSearch('?state=handled&severity=high&version=9.0.80')).toEqual({
      state: { filterType: 'set', values: ['handled'] },
      version: { filterType: 'set', values: ['9.0.80'] },
      severity: { filterType: 'set', values: ['high'] },
    });
    expect(filterModelFromSearch('?version=none').version).toEqual({ filterType: 'set', values: [null] });
    // The technology record's link: the rows of that CVE for that technology, whatever their state.
    expect(filterModelFromSearch('?technology=TEC-4&state=all&q=CVE-2026-1001')).toEqual({
      technology: { filterType: 'set', values: ['TEC-4'] },
      cve_id: { filterType: 'text', type: 'contains', filter: 'CVE-2026-1001' },
    });
  });

  it('reads the emails\' period as the CVE published within its last days, to review', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date(2026, 9, 18, 9, 30));
      expect(filterModelFromSearch('?period=30')).toEqual({
        state: { filterType: 'set', values: ['to_review'] },
        // After 18 September: from the 19th, today included (30 days).
        published_at: { filterType: 'date', type: 'greaterThan', dateFrom: '2026-09-18 00:00:00', dateTo: null },
      });
      expect(filterModelFromSearch('?period=abc').published_at).toBeUndefined();
      expect(filterModelFromSearch('?period=-3').published_at).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('says what to do when nothing is to review', () => {
    renderPage();
    render(<ThemeProvider theme={createAppTheme('light')}>{grid.props!.emptyState}</ThemeProvider>);
    expect(screen.getByTestId('vulnerabilities-empty').textContent).toContain('CPE identifiers');
  });

  it('opens the CVE of any of its rows in the side panel, and refreshes the grid after a change there', async () => {
    renderPage();
    // A click in the selection column opens nothing.
    act(() => grid.props!.onCellClicked({ data: ROW_NONE, column: { getColId: () => 'select' } }));
    expect(screen.queryByTestId('vulnerability-detail')).toBeNull();
    act(() => grid.props!.onCellClicked({ data: ROW_NONE, column: { getColId: () => 'version' } }));
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
    await waitFor(() => expect(grid.props!.refreshKey).toBe(1));
    expect(screen.getByTestId('vulnerability-detail')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('vulnerability-detail')).toBeNull());
  });

  it('selects every row of the filter from the header box, unticked rows left out, and changes them after the count', async () => {
    postMock.mockImplementation(async (_url: string, body: any) => ({
      data: body.dry_run ? { rows: 279, cves: 90, changes: 279, as_of: '2026-10-18T10:00:01.000Z' } : { ok: true, changed: 279 },
    }) as any);
    renderPage();
    listed(280);
    expect((screen.getByRole('button', { name: 'Change state' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(box(ALL_BOX));
    expect(screen.getByTestId('vulnerabilities-selection').textContent).toBe('280 rows selected, whole filter');
    expect(box(ALL_BOX).checked).toBe(true);
    expect(box(ROW_BOX).checked && box(ROW_NONE_BOX).checked).toBe(true);
    // One row unticked: still the whole filter, but that row.
    fireEvent.click(box(ROW_BOX));
    expect(screen.getByTestId('vulnerabilities-selection').textContent).toBe('279 rows selected, whole filter');
    expect(box(ALL_BOX).checked).toBe(false);
    expect(box(ALL_BOX).getAttribute('data-indeterminate')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Change state (279)' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByRole('checkbox')).toBeNull();
    expect(dialog.textContent).toContain('Every row of the current filter but 1.');
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('This changes 279 rows of 279, on 90 vulnerabilities.'));
    expect(postMock).toHaveBeenLastCalledWith('/vulnerabilities/bulk-state', {
      state: 'handled', all: true, filters: { sort: 'severity:DESC', filters: FILTERS }, exclude_ids: ['row-1'], dry_run: true,
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change state' }));
    await waitFor(() => expect(postMock).toHaveBeenLastCalledWith('/vulnerabilities/bulk-state', {
      state: 'handled', all: true, filters: { sort: 'severity:DESC', filters: FILTERS }, exclude_ids: ['row-1'], as_of: '2026-10-18T10:00:01.000Z', expected_rows: 279,
    }));
    await waitFor(() => expect(grid.props!.refreshKey).toBe(1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.queryByTestId('vulnerabilities-selection')).toBeNull();
    expect(box(ALL_BOX).checked).toBe(false);
  });

  it('changes the ticked rows by their ids, and clears the selection when the filter changes', async () => {
    postMock.mockImplementation(async (_url: string, body: any) => ({
      data: body.dry_run ? { rows: 2, cves: 1, changes: 2, as_of: '2026-10-18T10:00:00.000Z' } : { ok: true, changed: 2 },
    }) as any);
    renderPage();
    listed(40);
    fireEvent.click(box(ROW_BOX));
    fireEvent.click(box(ROW_NONE_BOX));
    expect(screen.getByTestId('vulnerabilities-selection').textContent).toBe('2 rows selected');
    expect(box(ALL_BOX).getAttribute('data-indeterminate')).toBe('true');
    // Another sort keeps the selection; another filter clears it.
    listed(40, FILTERS, 'cve_id:ASC');
    expect(screen.getByTestId('vulnerabilities-selection').textContent).toBe('2 rows selected');
    fireEvent.click(screen.getByRole('button', { name: 'Change state (2)' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Common note' }), { target: { value: 'Patched in March' } });
    expect(dialog.textContent).toContain('The 2 selected rows.');
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('This changes 2 rows of 2, on 1 vulnerabilities.'));
    expect(postMock).toHaveBeenLastCalledWith('/vulnerabilities/bulk-state', { state: 'handled', note: 'Patched in March', ids: ['row-1', 'row-2'], dry_run: true });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    listed(12, OTHER_FILTERS);
    expect(screen.queryByTestId('vulnerabilities-selection')).toBeNull();
    expect(box(ROW_BOX).checked).toBe(false);
    // A row ticked again, then the whole filter, then the header box again: nothing selected.
    fireEvent.click(box(ROW_BOX));
    fireEvent.click(box(ALL_BOX));
    expect(screen.getByTestId('vulnerabilities-selection').textContent).toBe('12 rows selected, whole filter');
    fireEvent.click(box(ALL_BOX));
    expect(screen.queryByTestId('vulnerabilities-selection')).toBeNull();
    fireEvent.click(box(ROW_NONE_BOX));
    fireEvent.click(screen.getByRole('button', { name: 'Clear selection' }));
    expect(screen.queryByTestId('vulnerabilities-selection')).toBeNull();
  });

  it('counts again when the list changed between the count and the change (409)', async () => {
    let counts = 0;
    postMock.mockImplementation(async (_url: string, body: any) => {
      if (body.dry_run) {
        counts += 1;
        return { data: counts === 1 ? { rows: 40, cves: 12, changes: 40, as_of: '2026-10-18T10:00:00.000Z' } : { rows: 41, cves: 13, changes: 41, as_of: '2026-10-18T10:00:05.000Z' } } as any;
      }
      if (body.expected_rows === 40) throw Object.assign(new Error('409'), { response: { status: 409 } });
      return { data: { ok: true, changed: 41 } } as any;
    });
    renderPage();
    listed(40);
    fireEvent.click(box(ALL_BOX));
    fireEvent.click(screen.getByRole('button', { name: 'Change state (40)' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toContain('40 rows of 40'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change state' }));
    expect((await within(dialog).findByRole('alert')).textContent).toBe('The list changed since the count. Check the new count, then confirm again.');
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toContain('41 rows of 41'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change state' }));
    await waitFor(() => expect(postMock).toHaveBeenLastCalledWith('/vulnerabilities/bulk-state', expect.objectContaining({ as_of: '2026-10-18T10:00:05.000Z', expected_rows: 41 })));
    await waitFor(() => expect(grid.props!.refreshKey).toBe(1));
  });

  it('refuses a change over the cap with a line that says to narrow the filters', async () => {
    postMock.mockRejectedValue(Object.assign(new Error('400'), { response: { status: 400 } }));
    renderPage();
    listed(9000);
    fireEvent.click(box(ALL_BOX));
    fireEvent.click(screen.getByRole('button', { name: 'Change state (9000)' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toContain('More than 5,000 rows'));
    expect((within(dialog).getByRole('button', { name: 'Change state' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says a count failed apart from the cap, and starts afresh at each opening', async () => {
    postMock.mockRejectedValueOnce(Object.assign(new Error('503'), { response: { status: 503 } }));
    postMock.mockResolvedValue({ data: { rows: 1, cves: 1, changes: 1, as_of: '2026-10-17T10:00:00.000Z' } } as any);
    renderPage();
    listed(40);
    fireEvent.click(box(ROW_BOX));
    fireEvent.click(screen.getByRole('button', { name: 'Change state (1)' }));
    let dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('The rows could not be counted. Try again.'));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Common note' }), { target: { value: 'Old note' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Change state (1)' }));
    dialog = await screen.findByRole('dialog');
    expect((within(dialog).getByRole('textbox', { name: 'Common note' }) as HTMLInputElement).value).toBe('');
  });

  it('exports the current filters through the list context', async () => {
    getMock.mockResolvedValue({ data: new Blob(['x']), headers: {} } as any);
    renderPage();
    act(() => grid.props!.onListRequestChange({ params: { page: 1, limit: 50, filters: FILTERS }, total: 40 }));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/vulnerabilities/export', expect.objectContaining({ params: { filters: FILTERS }, responseType: 'blob' })));
  });

  it('gives a reader neither selection nor change of state', () => {
    auth.level = 'reader';
    renderPage();
    expect(column('select')).toBeUndefined();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /Change state/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeTruthy();
  });
});
