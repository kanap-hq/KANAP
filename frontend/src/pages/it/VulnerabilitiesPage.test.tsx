import '../../i18n';
import { Children, type ReactElement, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import api from '../../api';
import { createAppTheme } from '../../config/ThemeContext';
import i18n from '../../i18n';
import { formatShortDate } from '../../lib/dateFormat';
import VulnerabilitiesPage, { filterModelFromSearch, publishedFromSearch, publishedRange, type VulnerabilityRow } from './VulnerabilitiesPage';
import { formatEpssCell, formatEpssPercent, type VulnerabilityDetail } from './vulnerabilities/vulnerabilityTypes';

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

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function renderPage(path = '/it/vulnerabilities', withLocation = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <VulnerabilitiesPage />
          {withLocation ? <LocationProbe /> : null}
        </MemoryRouter>
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
    expect(grid.props!.defaultSort).toEqual({ field: 'exploited', direction: 'DESC' });
    expect(grid.props!.getRowId(ROW_NONE)).toBe('row-2');
    expect(grid.props!.initialState.filter.filterModel).toEqual({ state: { filterType: 'set', values: ['to_review'] } });
    expect((grid.props!.columns as any[]).map((col) => col.field ?? col.colId)).toEqual([
      'select', 'cve_id', 'severity', 'exploited', 'cvss_score', 'epss', 'summary', 'technology', 'version', 'editor', 'servers', 'applications', 'state', 'note', 'published_at',
    ]);
    expect(column('published_at').filter).toBe('agDateColumnFilter');
    expect(column('published_at').sortable).not.toBe(false);
    // EPSS is shown as a percentage only. The exploited column stays hidden: the icon next to the severity carries that signal.
    // The default set is then 1,279 px, past the old 1,100 px budget. The summary still takes the rest.
    const shown = (grid.props!.columns as any[]).filter((col) => !col.defaultHidden);
    expect(shown.map((col) => col.field ?? col.colId)).toEqual(['select', 'cve_id', 'severity', 'epss', 'summary', 'technology', 'version', 'servers', 'applications', 'state', 'published_at']);
    expect(shown.reduce((sum, col) => sum + (col.width ?? col.minWidth), 0)).toBe(1279);
    expect(column('exploited').defaultHidden).toBe(true);
    expect(column('cvss_score').defaultHidden).toBe(true);
    expect(column('select')).toMatchObject({ suppressColumnsToolPanel: true, filter: false, sortable: false, width: 44 });
    expect(grid.props!.enableRowSelection).toBeFalsy();
    expect(column('summary').flex).toBe(1);
    // The total in rows and in CVE, as the counters of the technologies list speak in CVE.
    expect(grid.props!.showRowCount).toBe(true);
    expect(grid.props!.rowCountText({ total: 31, cves: 12 })).toBe('Total: 31 rows (12 CVE)');
    expect(grid.props!.rowCountText({ total: 1, cves: 1 })).toBe('Total: 1 row (1 CVE)');
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
    expect(getMock).toHaveBeenCalledWith('/vulnerabilities/filter-values', expect.objectContaining({
      params: { fields: 'version', filters: FILTERS, alerts: 'included' },
    }));
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
    // The technology record's link: the row of that CVE for that technology and version, whatever its state.
    expect(filterModelFromSearch('?technology=TEC-4&version=none&state=all&q=CVE-2026-1001')).toEqual({
      technology: { filterType: 'set', values: ['TEC-4'] },
      version: { filterType: 'set', values: [null] },
      cve_id: { filterType: 'text', type: 'contains', filter: 'CVE-2026-1001' },
    });
  });

  it('reads the emails\' period as the email does: from now less its days, in UTC', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      // The email of 18 October 09:30 UTC lists the CVE published since 18 September 09:30 UTC.
      vi.setSystemTime(new Date('2026-10-18T09:30:00Z'));
      expect(filterModelFromSearch('?period=30')).toEqual({
        state: { filterType: 'set', values: ['to_review'] },
        // After 17 September: from 18 September, the day of that instant.
        published_at: { filterType: 'date', type: 'greaterThan', dateFrom: '2026-09-17 00:00:00', dateTo: null },
      });
      // Just after midnight UTC, whatever the local day.
      vi.setSystemTime(new Date('2026-10-18T00:10:00Z'));
      expect((filterModelFromSearch('?period=1').published_at as any).dateFrom).toBe('2026-10-16 00:00:00');
      expect(filterModelFromSearch('?period=abc').published_at).toBeUndefined();
      expect(filterModelFromSearch('?period=-3').published_at).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it('filters the rows by alerts and keeps the choice in the address', async () => {
    renderPage('/it/vulnerabilities?technology=TEC-1', true);
    expect(grid.props!.extraParams).toEqual({ alerts: 'included' });
    expect(grid.props!.getRowClass({ data: { alerts: false } })).toBeUndefined();
    const open = () => {
      const view = render(<ThemeProvider theme={createAppTheme('light')}>{grid.props!.toolbarExtras}</ThemeProvider>);
      fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Alerts' }));
      return view;
    };
    let view = open();
    fireEvent.click(await screen.findByRole('option', { name: 'Excluded' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/it/vulnerabilities?technology=TEC-1&alerts=excluded'));
    expect(grid.props!.extraParams).toEqual({ alerts: 'excluded' });
    // Every row is out of the alerts here: none is muted.
    expect(grid.props!.getRowClass({ data: { alerts: false } })).toBeUndefined();
    expect(grid.props!.getRowClass({ data: { alerts: true } })).toBeUndefined();
    view.unmount();

    view = open();
    fireEvent.click(await screen.findByRole('option', { name: 'All' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/it/vulnerabilities?technology=TEC-1&alerts=all'));
    expect(grid.props!.getRowClass({ data: { alerts: false } })).toBe('vulnerability-row-muted');
    view.unmount();

    view = open();
    fireEvent.click(await screen.findByRole('option', { name: 'Included' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/it/vulnerabilities?technology=TEC-1'));
    expect(grid.props!.extraParams).toEqual({ alerts: 'included' });
    view.unmount();
  });

  it('dims the rows that stay out of the alerts when the address already asks for them', () => {
    renderPage('/it/vulnerabilities?alerts=all&state=all');
    expect(grid.props!.extraParams).toEqual({ alerts: 'all' });
    expect(grid.props!.getRowClass({ data: { alerts: false } })).toBe('vulnerability-row-muted');
    expect(grid.props!.initialState.filter.filterModel.state).toBeUndefined();
  });

  it('says what to do when nothing is to review', () => {
    renderPage();
    render(<ThemeProvider theme={createAppTheme('light')}>{grid.props!.emptyState}</ThemeProvider>);
    expect(screen.getByTestId('vulnerabilities-empty').textContent).toContain('CPE identifiers');
  });

  it('offers the excluded rows when the same filters reach some, and keeps those filters', async () => {
    getMock.mockImplementation(async (url: string, config?: any) => {
      if (url === '/vulnerabilities' && config?.params?.alerts === 'excluded') return { data: { items: [], total: 4 } } as any;
      throw new Error(`unexpected ${url}`);
    });
    // Arrival: "To review" is on, so the empty list is a filtered one. Excluded rows of that filter are offered.
    renderPage('/it/vulnerabilities?technology=TEC-1', true);
    act(() => grid.props!.onListRequestChange({
      params: { page: 3, limit: 50, sort: 'severity:DESC', alerts: 'included', filters: FILTERS, q: 'tomcat' },
      total: 0,
    }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/vulnerabilities', {
      params: { sort: 'severity:DESC', filters: FILTERS, q: 'tomcat', alerts: 'excluded', page: 1, limit: 1 },
    }));
    // The page builds the line again once the count is in: the line and its button.
    await waitFor(() => expect(Children.count((grid.props!.emptyState as ReactElement<{ children: ReactNode }>).props.children)).toBe(2));
    render(<ThemeProvider theme={createAppTheme('light')}>{grid.props!.emptyState}</ThemeProvider>);
    expect(screen.getByTestId('vulnerabilities-empty').textContent).toContain('No vulnerability is in the alerts.');
    fireEvent.click(screen.getByRole('button', { name: 'Show the excluded ones' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/it/vulnerabilities?technology=TEC-1&alerts=excluded'));
  });

  it('keeps the filtered empty line when no excluded row matches the same filters', async () => {
    getMock.mockImplementation(async (url: string, config?: any) => {
      if (url === '/vulnerabilities' && config?.params?.alerts === 'excluded') return { data: { items: [], total: 0 } } as any;
      throw new Error(`unexpected ${url}`);
    });
    renderPage();
    act(() => grid.props!.onListRequestChange({
      params: { page: 1, limit: 50, sort: 'severity:DESC', alerts: 'included', filters: FILTERS },
      total: 0,
    }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/vulnerabilities', {
      params: { sort: 'severity:DESC', filters: FILTERS, alerts: 'excluded', page: 1, limit: 1 },
    }));
    await act(async () => undefined);
    render(<ThemeProvider theme={createAppTheme('light')}>{grid.props!.emptyState}</ThemeProvider>);
    expect(screen.getByTestId('vulnerabilities-empty').textContent).toBe('No vulnerability matches these filters.');
    expect(screen.queryByRole('button', { name: 'Show the excluded ones' })).toBeNull();
  });

  it('keeps the first-use line when nothing exists outside the alerts either', async () => {
    getMock.mockImplementation(async (url: string, config?: any) => {
      if (url === '/vulnerabilities' && config?.params?.alerts === 'excluded') return { data: { items: [], total: 0 } } as any;
      throw new Error(`unexpected ${url}`);
    });
    renderPage('/it/vulnerabilities?state=all');
    act(() => grid.props!.onListRequestChange({ params: { page: 1, limit: 50, sort: 'severity:DESC', alerts: 'included' }, total: 0 }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/vulnerabilities', {
      params: { sort: 'severity:DESC', alerts: 'excluded', page: 1, limit: 1 },
    }));
    await act(async () => undefined);
    render(<ThemeProvider theme={createAppTheme('light')}>{grid.props!.emptyState}</ThemeProvider>);
    expect(screen.getByTestId('vulnerabilities-empty').textContent).toContain('CPE identifiers');
    expect(screen.queryByRole('button', { name: 'Show the excluded ones' })).toBeNull();
  });

  it('counts the alerts filter as a filter, and resets it with the others', async () => {
    renderPage('/it/vulnerabilities?technology=TEC-1&alerts=excluded', true);
    expect(grid.props!.extraNarrows).toBe(true);
    render(<ThemeProvider theme={createAppTheme('light')}>{grid.props!.emptyState}</ThemeProvider>);
    expect(screen.getByTestId('vulnerabilities-empty').textContent).toBe('No vulnerability matches these filters.');
    act(() => grid.props!.onResetFilters());
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/it/vulnerabilities?technology=TEC-1'));
    expect(grid.props!.extraNarrows).toBe(false);
    expect(grid.props!.extraParams).toEqual({ alerts: 'included' });
  });

  it('opens the CVE of any of its rows in the side panel, and refreshes the grid after a change there', async () => {
    renderPage();
    listed(40);
    fireEvent.click(box(ROW_BOX));
    expect(screen.getByTestId('vulnerabilities-selection').textContent).toBe('1 row selected');
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
    // No exploitation signal on this CVE: the block stays out.
    expect(within(detail).queryByText('Exploitation')).toBeNull();
    expect(within(detail).queryByRole('link', { name: 'EPSS: FIRST' })).toBeNull();
    expect(within(detail).queryByRole('link', { name: 'See on the European vulnerability database (ENISA)' })).toBeNull();
    // A member changes the state of one version there.
    patchMock.mockResolvedValue({ data: { ok: true } } as any);
    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'State of 9.0.80' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Handled' }));
    await waitFor(() => expect(patchMock).toHaveBeenCalledWith(`/technologies/tech-1/vulnerabilities/${CVE}`, { state: 'handled', technology_version_id: 'v-980' }));
    await waitFor(() => expect(grid.props!.refreshKey).toBe(1));
    expect(screen.getByTestId('vulnerability-detail')).toBeTruthy();
    // The selection is cleared with the change.
    expect(screen.queryByTestId('vulnerabilities-selection')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.queryByTestId('vulnerability-detail')).toBeNull());
  });

  it('places the drawer under the application bar and closes it on escape', async () => {
    renderPage();
    act(() => grid.props!.onCellClicked({ data: ROW, column: { getColId: () => 'cve_id' } }));
    await screen.findByTestId('vulnerability-detail');
    const paper = document.querySelector('.MuiDrawer-paper') as HTMLElement;
    expect(getComputedStyle(paper).top).toBe('48px');
    const note = screen.getByRole('textbox', { name: 'Note on 9.0.80' });
    act(() => { note.focus(); });
    fireEvent.keyDown(note, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('region', { name: CVE })).toBeNull());
  });

  it('names how many servers and applications raise an alert, and dims the others', async () => {
    getMock.mockImplementation(async (url: string) => {
      if (url === `/vulnerabilities/${CVE}`) {
        return {
          data: {
            ...DETAIL,
            technologies: [{ ...DETAIL.technologies[0], versions: [{ ...VERSION_980, alerts: true }, { ...VERSION_UNKNOWN, alerts: false }] }],
            servers: 3,
            applications: 2,
            alerting: { servers: 1, applications: 1 },
            servers_list: [
              { ...DETAIL.servers_list[0], alerts: true },
              { ...DETAIL.servers_list[1], alerts: false },
              { asset_id: 'a-3', name: 'SRV-QUIET', reference: null, technology_id: 'tech-1', technology_name: 'Tomcat', version_label: '8.5', via_asset_name: null, alerts: false },
            ],
            applications_list: [
              { application_id: 'app-1', name: 'Billing', reference: 'APP-1', technology_name: 'Tomcat', version_label: '9.0.80', server_name: null, alerts: true },
              { application_id: 'app-2', name: 'Archive', reference: 'APP-2', technology_name: 'Tomcat', version_label: '8.5', server_name: null, alerts: false },
            ],
          },
        } as any;
      }
      if (url === '/technologies') return { data: { items: [] } } as any;
      throw new Error(`unexpected ${url}`);
    });
    renderPage();
    act(() => grid.props!.onCellClicked({ data: ROW, column: { getColId: () => 'cve_id' } }));
    const detail = await screen.findByTestId('vulnerability-detail');
    expect(detail.textContent).toContain('3 servers, 1 in alerts');
    expect(detail.textContent).toContain('2 applications, 1 in alerts');
    const quietVersion = detail.querySelector('[title="Version not recorded (potentially concerned) · Excluded from alerts"]') as HTMLElement;
    expect(getComputedStyle(quietVersion).color).toBe('rgb(108, 116, 130)');
    expect(getComputedStyle(detail.querySelector('[title="9.0.80"]') as HTMLElement).color).not.toBe('rgb(108, 116, 130)');
    const quiet = within(detail).getByRole('link', { name: 'SRV-QUIET' });
    const loud = within(detail).getByRole('link', { name: 'SRV-WEB-01' });
    expect(getComputedStyle(quiet).color).toBe('rgb(108, 116, 130)');
    expect(getComputedStyle(loud).color).not.toBe('rgb(108, 116, 130)');
    expect(getComputedStyle(within(detail).getByRole('link', { name: 'APP-2 Archive' })).color).toBe('rgb(108, 116, 130)');
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
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('This changes the state of 279 rows of 279, on 90 vulnerabilities.'));
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
    expect(dialog.textContent).toContain('The 2 selected rows.');
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('This changes the state of 2 rows of 2, on 1 vulnerability.'));
    expect(postMock).toHaveBeenLastCalledWith('/vulnerabilities/bulk-state', { state: 'handled', ids: ['row-1', 'row-2'], dry_run: true });
    // The note counts nothing again.
    const counts = postMock.mock.calls.length;
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Common note' }), { target: { value: 'Patched in March' } });
    expect(dialog.textContent).toContain('The note goes on the 2 rows.');
    expect(postMock.mock.calls.length).toBe(counts);
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
    postMock.mockRejectedValue(Object.assign(new Error('400'), { response: { status: 400, data: { code: 'bulk_too_many', message: 'These filters reach 9000 rows' } } }));
    renderPage();
    listed(9000);
    fireEvent.click(box(ALL_BOX));
    fireEvent.click(screen.getByRole('button', { name: 'Change state (9000)' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toContain('More than 5,000 rows'));
    expect((within(dialog).getByRole('button', { name: 'Change state' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('says the reason of another refusal of the count', async () => {
    postMock.mockRejectedValue(Object.assign(new Error('400'), { response: { status: 400, data: { message: 'The publication date filter must be a day (YYYY-MM-DD).' } } }));
    renderPage();
    listed(40);
    fireEvent.click(box(ALL_BOX));
    fireEvent.click(screen.getByRole('button', { name: 'Change state (40)' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('The publication date filter must be a day (YYYY-MM-DD).'));
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

  it('exports and changes the rows of the alerts filter on screen', async () => {
    getMock.mockResolvedValue({ data: new Blob(['x']), headers: {} } as any);
    postMock.mockImplementation(async (_url: string, body: any) => ({
      data: body.dry_run ? { rows: 3, cves: 2, changes: 3, as_of: '2026-10-18T10:00:02.000Z' } : { ok: true, changed: 3 },
    }) as any);
    renderPage('/it/vulnerabilities?alerts=excluded');
    act(() => grid.props!.onListRequestChange({ params: { page: 1, limit: 50, sort: 'severity:DESC', filters: FILTERS, alerts: 'excluded' }, total: 3 }));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith(
      '/vulnerabilities/export',
      expect.objectContaining({ params: { sort: 'severity:DESC', filters: FILTERS, alerts: 'excluded' }, responseType: 'blob' }),
    ));
    fireEvent.click(box(ALL_BOX));
    fireEvent.click(screen.getByRole('button', { name: 'Change state (3)' }));
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(postMock).toHaveBeenLastCalledWith('/vulnerabilities/bulk-state', {
      state: 'handled', all: true, filters: { sort: 'severity:DESC', filters: FILTERS, alerts: 'excluded' }, dry_run: true,
    }));
    expect(within(dialog).getByRole('status').textContent).toContain('3 rows');
  });

  it('exports the current filters through the list context', async () => {
    getMock.mockResolvedValue({ data: new Blob(['x']), headers: {} } as any);
    renderPage();
    act(() => grid.props!.onListRequestChange({ params: { page: 1, limit: 50, filters: FILTERS }, total: 40 }));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/vulnerabilities/export', expect.objectContaining({ params: { filters: FILTERS }, responseType: 'blob' })));
  });

  it('turns each publication period into inclusive UTC days', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-20T00:30:00Z'));
      expect(publishedRange('all')).toEqual({});
      // Exactly N days, today included: 14 to 20 October is 7 days.
      expect(publishedRange('7d')).toEqual({ from: '2026-10-14', to: '2026-10-20' });
      expect(publishedRange('30d')).toEqual({ from: '2026-09-21', to: '2026-10-20' });
      expect(publishedRange('90d')).toEqual({ from: '2026-07-23', to: '2026-10-20' });
      expect(publishedRange('1y')).toEqual({ from: '2025-10-21', to: '2026-10-20' });
      expect(publishedRange('older1y')).toEqual({ to: '2025-10-20' });
      // A leap day: the year before has no 29 February, the two windows still meet without a gap.
      vi.setSystemTime(new Date('2028-02-29T12:00:00Z'));
      expect(publishedRange('1y')).toEqual({ from: '2027-03-02', to: '2028-02-29' });
      expect(publishedRange('older1y')).toEqual({ to: '2027-03-01' });
      expect(publishedRange('7d')).toEqual({ from: '2028-02-23', to: '2028-02-29' });
      expect(publishedFromSearch('')).toBe('all');
      expect(publishedFromSearch('?published=nope')).toBe('all');
      expect(publishedFromSearch('?published=30d')).toBe('30d');
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the publication window relative, and sends it to the list, the export and the reset', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(new Date('2026-10-20T00:30:00Z'));
      renderPage('/it/vulnerabilities?technology=TEC-1&published=30d', true);
      expect(grid.props!.extraParams).toEqual({ alerts: 'included', from: '2026-09-21', to: '2026-10-20' });
      expect(grid.props!.extraNarrows).toBe(true);
      render(<ThemeProvider theme={createAppTheme('light')}>{grid.props!.emptyState}</ThemeProvider>);
      expect(screen.getByTestId('vulnerabilities-empty').textContent).toBe('No vulnerability matches these filters.');

      const openPublished = () => {
        const view = render(<ThemeProvider theme={createAppTheme('light')}>{grid.props!.toolbarExtras}</ThemeProvider>);
        fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Published' }));
        return view;
      };
      let view = openPublished();
      fireEvent.click(await screen.findByRole('option', { name: 'Less than 7 days' }));
      await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/it/vulnerabilities?technology=TEC-1&published=7d'));
      expect(grid.props!.extraParams).toEqual({ alerts: 'included', from: '2026-10-14', to: '2026-10-20' });
      view.unmount();

      view = openPublished();
      fireEvent.click(await screen.findByRole('option', { name: 'More than a year' }));
      await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/it/vulnerabilities?technology=TEC-1&published=older1y'));
      expect(grid.props!.extraParams).toEqual({ alerts: 'included', to: '2025-10-20' });
      view.unmount();

      // Changing the alerts keeps the relative period.
      view = render(<ThemeProvider theme={createAppTheme('light')}>{grid.props!.toolbarExtras}</ThemeProvider>);
      fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Alerts' }));
      fireEvent.click(await screen.findByRole('option', { name: 'Excluded' }));
      await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/it/vulnerabilities?technology=TEC-1&published=older1y&alerts=excluded'));
      view.unmount();

      await column('version').filterParams.getValues({ context: { getQueryState: () => ({ filters: {} }) } });
      expect(getMock).toHaveBeenCalledWith('/vulnerabilities/filter-values', expect.objectContaining({
        params: { fields: 'version', alerts: 'excluded', to: '2025-10-20' },
      }));

      getMock.mockResolvedValue({ data: new Blob(['x']), headers: {} } as any);
      postMock.mockImplementation(async (_url: string, body: any) => ({
        data: body.dry_run ? { rows: 3, cves: 2, changes: 3, as_of: '2026-10-18T10:00:02.000Z' } : { ok: true, changed: 3 },
      }) as any);
      act(() => grid.props!.onListRequestChange({
        params: { page: 1, limit: 50, sort: 'severity:DESC', filters: FILTERS, ...grid.props!.extraParams },
        total: 3,
      }));
      fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
      await waitFor(() => expect(getMock).toHaveBeenCalledWith('/vulnerabilities/export', expect.objectContaining({
        params: { sort: 'severity:DESC', filters: FILTERS, alerts: 'excluded', to: '2025-10-20' },
        responseType: 'blob',
      })));
      fireEvent.click(box(ALL_BOX));
      fireEvent.click(screen.getByRole('button', { name: 'Change state (3)' }));
      await waitFor(() => expect(postMock).toHaveBeenLastCalledWith('/vulnerabilities/bulk-state', {
        state: 'handled', all: true, filters: { sort: 'severity:DESC', filters: FILTERS, alerts: 'excluded', to: '2025-10-20' }, dry_run: true,
      }));

      act(() => grid.props!.onResetFilters());
      await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/it/vulnerabilities?technology=TEC-1'));
      expect(grid.props!.extraParams).toEqual({ alerts: 'included' });
      expect(grid.props!.extraNarrows).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reads an unknown publication period as every date', () => {
    renderPage('/it/vulnerabilities?published=nope');
    expect(grid.props!.extraParams).toEqual({ alerts: 'included' });
    expect(grid.props!.extraNarrows).toBe(false);
  });

  const TIP = 'Actively exploited: listed by CISA (United States) and/or the European Union.';
  const RANSOM = 'Used in ransomware campaigns';

  it('shows an actively exploited icon next to the severity, in light and dark', async () => {
    renderPage();
    const Severity = column('severity').cellRenderer;
    const light = render(
      <ThemeProvider theme={createAppTheme('light')}>
        <Severity data={{ ...ROW, exploited: true, kev_ransomware: false }} />
        <Severity data={ROW} />
      </ThemeProvider>,
    );
    const badge = screen.getByRole('img', { name: TIP });
    expect(badge.querySelector('svg')).toBeTruthy();
    expect(badge.textContent).toBe('');
    expect(document.querySelectorAll('[data-exploited]')).toHaveLength(1);
    expect(getComputedStyle(badge).color).toBe('rgb(180, 83, 9)');
    expect(getComputedStyle(badge).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(getComputedStyle(badge).cursor).not.toBe('help');
    fireEvent.mouseOver(badge);
    expect((await screen.findByRole('tooltip')).textContent).toBe(TIP);
    expect(screen.queryByRole('tooltip')?.textContent).not.toContain(RANSOM);
    light.unmount();

    const named = render(
      <ThemeProvider theme={createAppTheme('light')}>
        <Severity data={{ ...ROW, exploited: true, cisa_kev: true, eu_kev: true }} />
        <Severity data={{ ...ROW, exploited: true, cisa_kev: true, kev_ransomware: true }} />
        <Severity data={{ ...ROW, exploited: true, kev_sources: ['eu'] }} />
      </ThemeProvider>,
    );
    expect(screen.getByRole('img', { name: 'Actively exploited: CISA, European Union' })).toBeTruthy();
    expect(screen.getByRole('img', { name: `Actively exploited: CISA ${RANSOM}` })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Actively exploited: European Union' })).toBeTruthy();
    named.unmount();

    render(
      <ThemeProvider theme={createAppTheme('dark')}>
        <Severity data={{ ...ROW, exploited: true, kev_ransomware: true }} />
      </ThemeProvider>,
    );
    const darkBadge = screen.getByRole('img', { name: `${TIP} ${RANSOM}` });
    expect(darkBadge.querySelector('svg')).toBeTruthy();
    expect(getComputedStyle(darkBadge).color).toBe('rgb(240, 168, 48)');
    expect(getComputedStyle(darkBadge).backgroundColor).toBe('rgba(0, 0, 0, 0)');
    fireEvent.mouseOver(darkBadge);
    expect((await screen.findByRole('tooltip')).textContent).toBe(`${TIP} ${RANSOM}`);
  });

  it('formats the EPSS cell as a percentage, and keeps the percentile for the detail', async () => {
    renderPage();
    const epss = column('epss');
    expect(epss.defaultHidden).toBeFalsy();
    expect(epss.sortable).not.toBe(false);
    expect(epss.filter).toBe('agNumberColumnFilter');
    expect(epss.filterParams).toEqual({
      suppressAndOrCondition: true,
      maxNumConditions: 1,
      buttons: ['clear'],
      filterOptions: ['greaterThanOrEqual'],
      defaultOption: 'greaterThanOrEqual',
    });
    expect(epss.headerTooltip).toBe('Minimum probability, from 0 to 1');
    // The grid omits the percentile even when the row has one. The drawer keeps it (formatEpssCell).
    expect(epss.valueFormatter({ value: 0.153, data: { epss: 0.153, epss_percentile: 0.92 } })).toBe('15.3%');
    expect(epss.valueFormatter({ value: 0.142, data: { epss: 0.142, epss_percentile: 0.5 } })).toBe('14.2%');
    expect(epss.valueFormatter({ value: 0.153, data: { epss: 0.153, epss_percentile: null } })).toBe('15.3%');
    expect(epss.valueFormatter({ value: null, data: { epss: null } })).toBe('');
    expect(formatEpssPercent(0.142, 'fr')).toBe('14,2\u00a0%');
    expect((await column('exploited').filterParams.getValues({})).map((value: { value: string }) => value.value)).toEqual(['yes', 'no']);
    const t = (key: string, options?: Record<string, unknown>) => String(i18n.t(key, { ...options, lng: 'fr', ns: 'it' }));
    expect(formatEpssCell(0.153, 0.92, 'fr', t)).toBe('15,3\u00a0% (92e centile)');
    expect(formatEpssCell(0.153, 0.92, 'de', (key, options) => String(i18n.t(key, { ...options, lng: 'de', ns: 'it' })))).toBe('15,3\u00a0% (92. Perzentil)');
    expect(formatEpssCell(0.153, 0.92, 'es', (key, options) => String(i18n.t(key, { ...options, lng: 'es', ns: 'it' })))).toBe('15,3\u00a0% (percentil 92)');
  });

  it('keeps exploited only in the address, the list, the export and the reset', async () => {
    renderPage('/it/vulnerabilities?technology=TEC-1', true);
    expect(grid.props!.extraParams).toEqual({ alerts: 'included' });
    expect(grid.props!.extraNarrows).toBe(false);
    const view = render(<ThemeProvider theme={createAppTheme('light')}>{grid.props!.toolbarExtras}</ThemeProvider>);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Exploited only' }));
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/it/vulnerabilities?technology=TEC-1&exploited=1'));
    expect(grid.props!.extraParams).toEqual({ alerts: 'included', exploited: 'yes' });
    expect(grid.props!.extraNarrows).toBe(true);
    view.unmount();

    render(<ThemeProvider theme={createAppTheme('light')}>{grid.props!.emptyState}</ThemeProvider>);
    expect(screen.getByTestId('vulnerabilities-empty').textContent).toBe('No vulnerability matches these filters.');

    await column('version').filterParams.getValues({ context: { getQueryState: () => ({ filters: {} }) } });
    expect(getMock).toHaveBeenCalledWith('/vulnerabilities/filter-values', expect.objectContaining({
      params: { fields: 'version', alerts: 'included', exploited: 'yes' },
    }));

    getMock.mockResolvedValue({ data: new Blob(['x']), headers: {} } as any);
    postMock.mockImplementation(async (_url: string, body: any) => ({
      data: body.dry_run ? { rows: 3, cves: 2, changes: 3, as_of: '2026-10-18T10:00:02.000Z' } : { ok: true, changed: 3 },
    }) as any);
    act(() => grid.props!.onListRequestChange({
      params: { page: 1, limit: 50, sort: 'exploited:DESC', filters: FILTERS, ...grid.props!.extraParams },
      total: 3,
    }));
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));
    await waitFor(() => expect(getMock).toHaveBeenCalledWith('/vulnerabilities/export', expect.objectContaining({
      params: { sort: 'exploited:DESC', filters: FILTERS, alerts: 'included', exploited: 'yes' },
      responseType: 'blob',
    })));
    fireEvent.click(box(ALL_BOX));
    fireEvent.click(screen.getByRole('button', { name: 'Change state (3)' }));
    await waitFor(() => expect(postMock).toHaveBeenLastCalledWith('/vulnerabilities/bulk-state', {
      state: 'handled', all: true, filters: { sort: 'exploited:DESC', filters: FILTERS, alerts: 'included', exploited: 'yes' }, dry_run: true,
    }));

    act(() => grid.props!.onResetFilters());
    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/it/vulnerabilities?technology=TEC-1'));
    expect(grid.props!.extraParams).toEqual({ alerts: 'included' });
    expect(grid.props!.extraNarrows).toBe(false);
  });

  it('reads only exploited=1 as the shortcut', () => {
    const { unmount } = renderPage('/it/vulnerabilities?exploited=yes');
    expect(grid.props!.extraParams).toEqual({ alerts: 'included' });
    expect(grid.props!.extraNarrows).toBe(false);
    unmount();
    renderPage('/it/vulnerabilities?exploited=1&published=7d');
    expect(grid.props!.extraParams.exploited).toBe('yes');
    expect(grid.props!.extraNarrows).toBe(true);
  });

  it('shows the exploitation block when a signal, a score or a European identifier is present', async () => {
    const added = formatShortDate('2024-03-12', 'en', { year: 'always' });
    const scored = formatShortDate('2026-10-18', 'en', { year: 'always' });
    getMock.mockImplementation(async (url: string) => {
      if (url === `/vulnerabilities/${CVE}`) {
        return {
          data: {
            ...DETAIL,
            kev_sources: ['cisa', 'eu'],
            kev_added_at: '2024-03-12',
            kev_ransomware: true,
            epss: 0.153,
            epss_percentile: 0.92,
            epss_date: '2026-10-18',
            euvd_id: 'EUVD-2024-1234',
            euvd_url: 'https://euvd.enisa.europa.eu/vulnerability/EUVD-2024-1234',
          },
        } as any;
      }
      throw new Error(`unexpected ${url}`);
    });
    renderPage();
    act(() => grid.props!.onCellClicked({ data: ROW, column: { getColId: () => 'cve_id' } }));
    const detail = await screen.findByTestId('vulnerability-detail');
    const region = screen.getByRole('region', { name: CVE });
    expect(within(region).getByRole('heading', { name: CVE })).toBeTruthy();
    expect(within(region).getByRole('img', { name: `Actively exploited: CISA, European Union ${RANSOM}` })).toBeTruthy();
    expect(within(detail).getByText('Exploitation')).toBeTruthy();
    expect(detail.textContent).toContain('Sources CISA, European Union');
    expect(detail.textContent).toContain(`Added to the CISA list ${added}`);
    expect(detail.textContent).toContain(RANSOM);
    expect(detail.textContent).toContain(`EPSS 15.3% (92nd percentile) as of ${scored}`);
    const first = within(detail).getByRole('link', { name: 'EPSS: FIRST' });
    expect(first.getAttribute('href')).toBe('https://www.first.org/epss');
    expect(first.getAttribute('target')).toBe('_blank');
    expect(first.getAttribute('rel')).toBe('noopener noreferrer');
    expect(first.className).toContain('MuiLink-underlineHover');
    expect(detail.textContent).toContain('EUVD-2024-1234');
    const euvd = within(detail).getByRole('link', { name: 'See on the European vulnerability database (ENISA)' });
    expect(euvd.getAttribute('href')).toBe('https://euvd.enisa.europa.eu/vulnerability/EUVD-2024-1234');
    expect(euvd.getAttribute('target')).toBe('_blank');
    expect(detail.textContent).toContain('Source: ENISA, European vulnerability database');
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
