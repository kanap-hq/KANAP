import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import TimeLoggedReport, {
  TIME_LOGGED_MONTHS_STORAGE_KEY,
  type TimeLoggedCell,
  type TimeLoggedReportResponse,
} from './TimeLoggedReport';

/** This jsdom build ships no Storage. The page guards against that; the specs need one. */
if (!window.localStorage) {
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
      clear: () => { store.clear(); },
      key: (index: number) => Array.from(store.keys())[index] ?? null,
      get length() { return store.size; },
    },
  });
}

const get = vi.fn();
vi.mock('../../api', () => ({ default: { get: (...args: any[]) => get(...args) } }));

const hasLevel = vi.fn();
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: (...args: any[]) => hasLevel(...args) }) }));

// jsdom has no canvas, so the real chart cannot paint. The specs are about the figures around
// it; the chart keeps its own visual verification in the browser.
vi.mock('ag-charts-react', () => ({
  AgChartsReact: React.forwardRef(({ options }: { options: any }, _ref) => (
    <div
      data-testid="chart"
      data-series={options.series.map((s: any) => `${s.yKey}:${s.stacked ? 'stacked' : 'side'}`).join(',')}
      data-values={options.data.map((row: any) => `${row.projectDays}/${row.otherDays}`).join('|')}
    />
  )),
}));

const MONTHS = ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09'];
const cells = (values: Record<string, [number, number]> = {}): TimeLoggedCell[] =>
  MONTHS.map((month) => {
    const projectDays = values[month]?.[0] ?? 0;
    const otherDays = values[month]?.[1] ?? 0;
    return { month, projectDays, otherDays, totalDays: Math.round((projectDays + otherDays) * 10) / 10 };
  });

const report = (): TimeLoggedReportResponse => ({
  months: MONTHS,
  totals: { projectDays: 2.8, otherDays: 1.8, totalDays: 4.5, contributorsWithoutEntries: 2, contributorsTotal: 4 },
  series: cells({ '2026-04': [0.6, 1], '2026-05': [2, 0.3], '2026-09': [0.2, 0.5] }),
  teams: [
    {
      teamId: 'team-infra',
      teamName: 'Infrastructure',
      cells: cells(),
      members: [{ userId: 'u-dan', name: 'Dan Petit', contributorRef: 'CTR-7', cells: cells() }],
    },
    {
      teamId: 'team-apps',
      teamName: 'Business applications',
      cells: cells({ '2026-04': [0.6, 1], '2026-05': [0, 0.3], '2026-09': [0.2, 0] }),
      members: [
        { userId: 'u-alice', name: 'Alice Martin', contributorRef: 'CTR-12', cells: cells({ '2026-04': [0.6, 1], '2026-09': [0.2, 0] }) },
        { userId: 'u-bob', name: 'Bob Durand', contributorRef: 'CTR-3', cells: cells({ '2026-05': [0, 0.3] }) },
      ],
    },
    {
      teamId: null,
      teamName: null,
      cells: cells({ '2026-05': [2, 0], '2026-09': [0, 0.5] }),
      members: [
        { userId: 'u-chloe', name: 'Chloé Blanc', contributorRef: null, cells: cells({ '2026-05': [2, 0] }) },
        { userId: null, name: '', contributorRef: null, cells: cells({ '2026-09': [0, 0.5] }) },
      ],
    },
  ],
});

const PROJECT_TEAM_VALUES = {
  projects: [{ id: 'p-1', ref: 'PRJ-3', name: 'Cellar probes', status: 'in_progress' }],
  teams: [
    { id: 'team-infra', name: 'Infrastructure' },
    { id: 'team-apps', name: 'Business applications' },
  ],
};

function mockApi(data: unknown) {
  get.mockImplementation((url: string) =>
    Promise.resolve({ data: url === '/portfolio/reports/filter-values' ? PROJECT_TEAM_VALUES : data }),
  );
}

/** The parameters of every call to the report endpoint, the filter options left aside. */
const reportCalls = () =>
  get.mock.calls
    .filter(([url]: any[]) => url === '/portfolio/reports/time-logged')
    .map((call: any[]) => call[1]?.params);

function renderReport(entry = '/portfolio/reports/time-logged') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[entry]}>
          <TimeLoggedReport />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** The first column of each body row, in order. */
const rowLabels = () =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0].textContent);

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

beforeEach(() => {
  get.mockReset();
  hasLevel.mockReset();
  hasLevel.mockReturnValue(true);
  try {
    window.localStorage.clear();
  } catch {
    // jsdom without storage still runs the specs on the default horizon.
  }
});

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL;
  URL.revokeObjectURL = originalRevokeObjectURL;
});

describe('TimeLoggedReport', () => {
  it('shows the tiles with the totals of the period', async () => {
    mockApi(report());
    renderReport();

    const tile = async (label: string) => (await screen.findByText(label)).parentElement as HTMLElement;
    expect((await tile('Project days')).textContent).toContain('2.8');
    expect((await tile('Other days')).textContent).toContain('1.8');
    expect((await tile('Total')).textContent).toContain('4.5');
    // 2.8 of 4.6 days.
    expect((await tile('Project share')).textContent).toContain('61%');
    const without = await tile('Contributors without entries');
    expect(without.textContent).toContain('2');
    expect(without.textContent).toContain('of 4 contributors');
  });

  it('draws project and other days stacked, month by month', async () => {
    mockApi(report());
    renderReport();

    const chart = await screen.findByTestId('chart');
    expect(chart.getAttribute('data-series')).toBe('projectDays:stacked,otherDays:stacked');
    expect(chart.getAttribute('data-values')).toBe('0.6/1|2/0.3|0/0|0/0|0/0|0.2/0.5');
  });

  it('asks for six months by default and for twelve once chosen, and remembers it', async () => {
    mockApi(report());
    renderReport();

    await waitFor(() => expect(reportCalls()).toHaveLength(1));
    expect(reportCalls()[0]).toMatchObject({ months: 6 });

    fireEvent.click(screen.getByRole('tab', { name: '12 months' }));
    await waitFor(() => expect(reportCalls()[reportCalls().length - 1]).toMatchObject({ months: 12 }));
    expect(window.localStorage.getItem(TIME_LOGGED_MONTHS_STORAGE_KEY)).toBe('12');
  });

  it('lists teams in their order, then their people alphabetically, the group without a team last', async () => {
    mockApi(report());
    renderReport();

    await screen.findByText('Dan Petit');
    expect(rowLabels()).toEqual([
      'Infrastructure',
      'Dan PetitCTR-7',
      'Business applications',
      'Alice MartinCTR-12',
      'Bob DurandCTR-3',
      'No team',
      'Chloé Blanc',
      'Unknown user',
    ]);
  });

  it('keeps a person without entries in their team, with empty cells', async () => {
    mockApi(report());
    renderReport();

    const row = (await screen.findByText('Dan Petit')).closest('tr') as HTMLElement;
    const figures = within(row).getAllByRole('cell').slice(1);
    expect(figures).toHaveLength(6);
    figures.forEach((cell) => expect(cell.textContent).toBe(''));

    const alice = screen.getByText('Alice Martin').closest('tr') as HTMLElement;
    const aliceCells = within(alice).getAllByRole('cell').slice(1);
    expect(aliceCells[0].textContent).toBe('1.6 d0.6 / 1');
    expect(aliceCells[1].textContent).toBe('');
  });

  it('folds a team and remembers it', async () => {
    mockApi(report());
    renderReport();

    fireEvent.click(await screen.findByRole('button', { name: 'Business applications' }));
    expect(screen.queryByText('Alice Martin')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('kanap.portfolioReports.timeLogged.collapsed') ?? '[]')).toEqual([
      'team-apps',
    ]);
  });

  it('shows the contributor reference only to readers of the contributor settings', async () => {
    hasLevel.mockImplementation((key: string) => key !== 'portfolio_settings');
    mockApi(report());
    renderReport();

    await screen.findByText('Alice Martin');
    expect(screen.queryByText('CTR-12')).toBeNull();
    expect(screen.queryByRole('link', { name: 'CTR-7' })).toBeNull();
  });

  it('links the contributor reference to the contributor', async () => {
    mockApi(report());
    renderReport();

    const link = await screen.findByRole('link', { name: 'CTR-12' });
    expect(link.getAttribute('href')).toBe('/portfolio/contributors/CTR-12');
  });

  it('sends the project and team filters it was opened with', async () => {
    mockApi(report());
    renderReport('/portfolio/reports/time-logged?projectIds=p-1&teamIds=team-apps');

    await waitFor(() => expect(reportCalls()).toHaveLength(1));
    expect(reportCalls()[0]).toMatchObject({ months: 6, projectIds: 'p-1', teamIds: 'team-apps' });
  });

  it('shows the month total the server computed', async () => {
    const data = report();
    data.teams[1].members[0].cells[0] = { month: '2026-04', projectDays: 0.6, otherDays: 1, totalDays: 1.7 };
    mockApi(data);
    renderReport();
    const alice = (await screen.findByText('Alice Martin')).closest('tr') as HTMLElement;
    expect(within(alice).getAllByRole('cell')[1].textContent).toBe('1.7 d0.6 / 1');
  });

  it('asks the server for the table file with the parameters of the screen', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:time-logged') as any;
    URL.revokeObjectURL = vi.fn();
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    mockApi(report());
    renderReport('/portfolio/reports/time-logged?teamIds=team-apps');
    await screen.findByText('Alice Martin');

    fireEvent.click(screen.getByRole('button', { name: 'Export table' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'CSV' }));
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1));
    const call = get.mock.calls.find(([url]: any[]) => url === '/portfolio/reports/time-logged/export');
    expect(call?.[1]).toMatchObject({
      params: { months: 6, teamIds: 'team-apps', format: 'csv', language: 'en' },
      responseType: 'blob',
    });
    expect(call?.[1].params.tz).toBeTruthy();
    expect(call?.[1].params).not.toHaveProperty('projectIds');
    click.mockRestore();
  });
});
