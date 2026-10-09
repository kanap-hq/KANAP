import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { ThemeModeProvider, createAppTheme } from '../../config/ThemeContext';
import FlowReport from './FlowReport';

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

// jsdom has no canvas, so the real chart cannot paint. The specs are about the figures and the
// links around it; the chart keeps its own visual verification in the browser.
vi.mock('ag-charts-react', () => ({
  AgChartsReact: ({ options }: { options: any }) => (
    <div
      data-testid="chart"
      data-series={options.series.map((s: any) => s.yKey).join(',')}
      data-labels={options.data.map((row: any) => row.label).join('|')}
    />
  ),
}));

const period = (periodStart: string, periodEnd: string, created: number, closed: number, openAtEnd: number) => ({
  periodStart,
  periodEnd,
  created,
  closed,
  openAtEnd,
});

const tasksPeriods = [
  period('2026-06-29', '2026-07-05', 4, 1, 10),
  period('2026-07-06', '2026-07-12', 2, 3, 9),
  period('2026-07-13', '2026-07-19', 5, 2, 12),
];

const monthPeriods = (openAtEnd: number[]) => [
  period('2025-11-01', '2025-11-30', 1, 0, openAtEnd[0]),
  period('2025-12-01', '2025-12-31', 0, 1, openAtEnd[1]),
  period('2026-01-01', '2026-01-31', 2, 0, openAtEnd[2]),
];

const emptyBuckets = { underOneMonth: 0, oneToThreeMonths: 0, threeToSixMonths: 0, overSixMonths: 0 };

/** One row of a creation-age grid: the brackets, and the total they add up to. */
const ageRow = (status: string, buckets: Record<string, number>) => ({
  status,
  buckets: { ...emptyBuckets, ...buckets },
  total: Object.values(buckets).reduce((sum, value) => sum + value, 0),
});

/** One row of a by-status grid. */
const statusRow = (status: string, open: number, stuck: number, plannedEndPassed?: number) => ({
  status,
  open,
  stuck,
  ...(plannedEndPassed === undefined ? {} : { plannedEndPassed }),
});

/** One stuck item, the unit behind a stuck figure. */
const stuckItem = (ref: string, status: string, over: Record<string, unknown> = {}) => ({
  id: `id-${ref}`,
  ref,
  itemPath: `/portfolio/${ref.startsWith('REQ') ? 'requests' : ref.startsWith('PRJ') ? 'projects' : 'tasks'}/${ref}/${
    ref.startsWith('T-') ? 'overview' : 'summary'
  }`,
  name: `Item ${ref}`,
  status,
  statusSince: '2026-05-04',
  ...over,
});

const report = (over: Record<string, unknown> = {}) => ({
  weeks: 13,
  months: 12,
  startDate: '2026-06-29',
  monthsStartDate: '2025-11-01',
  endDate: '2026-07-19',
  timeZone: 'Europe/Paris',
  asOf: '2026-07-19T10:00:00.000Z',
  flow: {
    tasks: { granularity: 'week', periods: tasksPeriods, openNow: 12 },
    requests: { granularity: 'month', periods: monthPeriods([3, 2, 4]), openNow: 4 },
    projects: { granularity: 'month', periods: monthPeriods([6, 7, 6]), openNow: 6 },
  },
  age: {
    tasks: {
      rows: [
        {
          taskTypeId: 'type-bug',
          taskTypeName: 'Bug',
          buckets: { upTo7: 1, from8To30: 2, from31To90: 3, over90: 0 },
          total: 6,
        },
        {
          taskTypeId: null,
          taskTypeName: null,
          buckets: { upTo7: 0, from8To30: 1, from31To90: 0, over90: 5 },
          total: 6,
        },
      ],
      total: {
        taskTypeId: null,
        taskTypeName: null,
        buckets: { upTo7: 1, from8To30: 3, from31To90: 3, over90: 5 },
        total: 12,
      },
    },
    requests: {
      rows: [
        ageRow('pending_review', { underOneMonth: 2 }),
        ageRow('candidate', {}),
        ageRow('approved', { overSixMonths: 1 }),
        ageRow('on_hold', { oneToThreeMonths: 1 }),
      ],
      total: ageRow('total', { underOneMonth: 2, oneToThreeMonths: 1, overSixMonths: 1 }),
    },
    projects: {
      rows: [
        ageRow('waiting_list', { underOneMonth: 1 }),
        ageRow('planned', { threeToSixMonths: 2 }),
        ageRow('in_progress', { oneToThreeMonths: 3 }),
        ageRow('in_testing', {}),
        ageRow('on_hold', {}),
      ],
      total: ageRow('total', { underOneMonth: 1, oneToThreeMonths: 3, threeToSixMonths: 2 }),
    },
  },
  byStatus: {
    tasks: {
      thresholdDays: 30,
      rows: [
        statusRow('open', 5, 1),
        statusRow('in_progress', 4, 2),
        statusRow('pending', 2, 0),
        statusRow('in_testing', 1, 0),
      ],
      total: statusRow('total', 12, 3),
      items: [
        stuckItem('T-1', 'in_progress'),
        stuckItem('T-2', 'in_progress'),
        stuckItem('T-3', 'open'),
      ],
    },
    requests: {
      thresholdDays: 91,
      rows: [
        statusRow('pending_review', 2, 1),
        statusRow('candidate', 0, 0),
        statusRow('approved', 1, 1),
        statusRow('on_hold', 1, 0),
      ],
      total: statusRow('total', 4, 2),
      items: [stuckItem('REQ-1', 'pending_review'), stuckItem('REQ-3', 'approved')],
    },
    projects: {
      thresholdDays: 91,
      rows: [
        statusRow('waiting_list', 1, 0, 0),
        statusRow('planned', 2, 2, 2),
        statusRow('in_progress', 3, 1, 1),
        statusRow('in_testing', 0, 0, 0),
        statusRow('on_hold', 0, 0, 0),
      ],
      total: statusRow('total', 6, 3, 3),
      items: [
        stuckItem('PRJ-2', 'planned', { plannedEnd: '2026-03-31', plannedEndPassed: true }),
        stuckItem('PRJ-3', 'planned', { plannedEnd: '2026-04-30', plannedEndPassed: true }),
        stuckItem('PRJ-4', 'in_progress', { plannedEnd: '2027-01-31', plannedEndPassed: false }),
      ],
    },
  },
  leadTime: {
    tasks: { closedCount: 6, measuredCount: 6, medianDays: 12.4 },
    tasksByType: [
      { taskTypeId: 'type-bug', taskTypeName: 'Bug', closedCount: 6, measuredCount: 6, medianDays: 12.4 },
    ],
    requests: {
      closedCount: 5,
      measuredCount: 5,
      medianDays: 21,
      converted: { closedCount: 3, measuredCount: 3, medianDays: 18.5 },
      rejected: { closedCount: 2, measuredCount: 2, medianDays: 30 },
    },
    projects: {
      closedCount: 0,
      measuredCount: 0,
      medianDays: null,
      done: { closedCount: 0, measuredCount: 0, medianDays: null, withPlannedEnd: 0, medianOverrunDays: null },
    },
  },
  ...over,
});

/** The sources and the categories the filter bar offers, as the weekly endpoint returns them. */
const FILTER_VALUES = {
  sources: [
    { id: 'src-desk', name: 'Service desk' },
    { id: 'src-mail', name: 'Email' },
  ],
  categories: [
    { id: 'cat-run', name: 'Run' },
    { id: 'cat-build', name: 'Build' },
  ],
  streams: [],
  taskTypes: [],
};

const PROJECT_TEAM_VALUES = {
  projects: [{ id: 'p-1', ref: 'PRJ-3', name: 'Cellar probes', status: 'in_progress' }],
  teams: [{ id: 'team-1', name: 'Cheese makers' }],
};

function mockApi(data: unknown, filterValues: unknown = FILTER_VALUES) {
  get.mockImplementation((url: string) =>
    Promise.resolve({
      data:
        url === '/portfolio/reports/filter-values'
          ? PROJECT_TEAM_VALUES
          : String(url).includes('filter-values')
            ? filterValues
            : data,
    }),
  );
}

/** The parameters of the nth call to the report endpoint, the filter values left aside. */
function reportCalls(): any[] {
  return get.mock.calls.filter((call) => String(call[0]) === '/portfolio/reports/flow').map((call) => call[1].params);
}

function renderReport(entry = '/portfolio/reports/flow') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeModeProvider>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter initialEntries={[entry]}>
            <FlowReport />
          </MemoryRouter>
        </ThemeProvider>
      </ThemeModeProvider>
    </QueryClientProvider>,
  );
}

/**
 * Every link reading exactly `text`, href decoded so the filter JSON stays readable. A query
 * string writes a space as `+`, which is what the list reads it back as: the specs undo it the
 * same way rather than asserting on the encoding.
 */
function hrefsFor(text: string): string[] {
  return screen
    .getAllByRole('link')
    .filter((node) => node.textContent?.trim() === text)
    .map((node) => decodeURIComponent((node.getAttribute('href') ?? '').replace(/\+/g, ' ')));
}

/** The one distinct destination behind the links reading `text` and satisfying `match`. */
function linkHref(text: string, match: (href: string) => boolean = () => true): string {
  const found = [...new Set(hrefsFor(text).filter(match))];
  expect(found).toHaveLength(1);
  return found[0];
}

/** Every destination the page offers, decoded the same way. */
function allHrefs(): string[] {
  return screen
    .getAllByRole('link')
    .map((node) => decodeURIComponent((node.getAttribute('href') ?? '').replace(/\+/g, ' ')));
}

/** The clickable figures that open a list inside the report, not a page. */
function figureButtons(text: string, root: HTMLElement | null = null): HTMLElement[] {
  const scope = root ? within(root) : screen;
  return scope.getAllByRole('button').filter((node) => node.textContent?.trim() === text);
}

/** The grid sitting under one of the section subtitles. */
function gridUnder(title: string): HTMLElement {
  return screen.getByText(title).parentElement!.querySelector('.ag-root') as HTMLElement;
}

/** The list the report opens under the stage grids. */
function openPanel(): HTMLElement {
  return screen.getByText('Close').closest('div')!.parentElement as HTMLElement;
}

beforeEach(() => {
  get.mockReset();
  window.localStorage.clear();
});

describe('FlowReport', () => {
  it('leads with what is open now, its change over the window and a trend', async () => {
    mockApi(report());
    renderReport();

    await waitFor(() => expect(screen.getByText('+2 since 29 Jun')).toBeTruthy());

    // Tasks: 12 open now, 10 at the end of the first week of the window.
    expect(screen.getByText('Flow')).toBeTruthy();
    // Requests and projects count from the first month of their own window.
    expect(screen.getByText('+1 since Nov 2025')).toBeTruthy();
    expect(screen.getByText('No change since Nov 2025')).toBeTruthy();
    expect(screen.getAllByText('open now')).toHaveLength(3);

    // One small multiple per entity: the tasks chart reads in weeks, the other two in months.
    const charts = screen.getAllByTestId('chart');
    expect(charts).toHaveLength(3);
    expect(charts[0].getAttribute('data-series')).toBe('created,closed');
    expect(charts[0].getAttribute('data-labels')).toBe('29 Jun|6 Jul|13 Jul');
    // The year comes back on the column that changes year, and only there.
    expect(charts[1].getAttribute('data-labels')).toBe('Nov 2025|Dec|Jan 2026');
    expect(charts[2].getAttribute('data-labels')).toBe('Nov 2025|Dec|Jan 2026');

    // The open figure opens the matching list, narrowed to its open scope.
    const tasksLink = [...new Set(hrefsFor('12'))];
    expect(tasksLink).toHaveLength(1);
    expect(tasksLink[0]).toContain('/portfolio/tasks?taskScope=all');
    expect(tasksLink[0]).toContain('"status":{"filterType":"set","values":["open","in_progress","pending","in_testing"]}');
    expect(linkHref('4', (href) => href.startsWith('/portfolio/requests'))).toContain('requestScope=all');
    expect(linkHref('6', (href) => href.startsWith('/portfolio/projects') && !href.includes('planned_end'))).toContain(
      'projectScope=all',
    );
  });

  it('carries the two horizons in one request and remembers both', async () => {
    window.localStorage.setItem('kanap.portfolioReports.flowWeeks', '26');
    window.localStorage.setItem('kanap.portfolioReports.flowMonths', '24');
    mockApi(report());
    renderReport();

    await waitFor(() => expect(reportCalls().length).toBeGreaterThan(0));
    expect(reportCalls()[0].weeks).toBe(26);
    expect(reportCalls()[0].months).toBe(24);
    expect(typeof reportCalls()[0].tz).toBe('string');
    // No classification chosen, so the report asks for the whole portfolio.
    expect(reportCalls()[0].sourceIds).toBeUndefined();
    expect(reportCalls()[0].categoryIds).toBeUndefined();

    const [tasksFilter, itemsFilter] = screen.getAllByRole('combobox');

    fireEvent.mouseDown(tasksFilter);
    fireEvent.click(await screen.findByRole('option', { name: '8 weeks' }));
    await waitFor(() =>
      expect(window.localStorage.getItem('kanap.portfolioReports.flowWeeks')).toBe('8'),
    );

    fireEvent.mouseDown(itemsFilter);
    fireEvent.click(await screen.findByRole('option', { name: '6 months' }));
    await waitFor(() =>
      expect(window.localStorage.getItem('kanap.portfolioReports.flowMonths')).toBe('6'),
    );

    const last = reportCalls()[reportCalls().length - 1];
    expect(last.weeks).toBe(8);
    expect(last.months).toBe(6);
  });

  it('opens the figures as two tables, one per grain', async () => {
    mockApi(report());
    renderReport();

    await waitFor(() => expect(screen.getByText('See the table')).toBeTruthy());
    expect(screen.queryByText('Tasks created')).toBeNull();

    fireEvent.click(screen.getByText('See the table'));

    await waitFor(() => expect(screen.getByText('Tasks created')).toBeTruthy());
    expect(screen.getByText('Tasks by week')).toBeTruthy();
    expect(screen.getByText('Requests and projects by month')).toBeTruthy();
    const headers = screen.getAllByRole('columnheader').map((node) => node.textContent?.trim() ?? '');
    expect(headers).toContain('Week');
    expect(headers).toContain('Month');
    expect(headers).toContain('Projects open');

    // A created cell opens that period's weekly report; the stock at the end is not a link.
    expect(hrefsFor('4')).toContain('/portfolio/reports/weekly?startDate=2026-06-29&endDate=2026-07-05');
    expect(screen.getAllByRole('link').filter((node) => node.textContent?.trim() === '10')).toHaveLength(0);

    fireEvent.click(screen.getByText('Hide the table'));
    await waitFor(() => expect(screen.queryByText('Tasks created')).toBeNull());
  });

  it('links an age cell to the task list holding exactly that count', async () => {
    mockApi(report());
    renderReport();

    await waitFor(() => expect(screen.getByText('No type')).toBeTruthy());

    expect(screen.getByText('Age of open work')).toBeTruthy();
    const headers = screen.getAllByRole('columnheader').map((node) => node.textContent?.trim() ?? '');
    expect(headers).toContain('0–7 d');
    expect(headers).toContain('Over 90 d');

    // Bug, 31–90 days: today is 2026-07-19, so the bracket runs from 2026-04-20 to 2026-06-18.
    const cell = linkHref('3', (href) => href.includes('"values":["Bug"]') && href.includes('inRange'));
    expect(cell).toContain('/portfolio/tasks?taskScope=all');
    expect(cell).toContain(
      '"created_at":{"filterType":"date","type":"inRange","dateFrom":"2026-04-20","dateTo":"2026-06-18"}',
    );

    // A zero is never a link nor a button: the list would open on nothing.
    expect(screen.getAllByRole('link').some((node) => node.textContent?.trim() === '0')).toBe(false);
    expect(figureButtons('0')).toHaveLength(0);
  });

  it('reads the open requests and projects by status and by how long ago they were created', async () => {
    mockApi(report());
    renderReport();

    await waitFor(() => expect(screen.getAllByText('Pending review').length).toBeGreaterThan(0));

    expect(screen.getByText('Age of open work')).toBeTruthy();
    expect(screen.getByText('Open requests')).toBeTruthy();
    expect(screen.getByText('Open projects')).toBeTruthy();
    const headers = screen.getAllByRole('columnheader').map((node) => node.textContent?.trim() ?? '');
    expect(headers).toContain('Status');
    expect(headers).toContain('Under 1 month');
    expect(headers).toContain('Over 6 months');
    // The three grids of the section read the same measure, and say so above the brackets.
    expect(headers.filter((header) => header === 'Created')).toHaveLength(3);

    // The statuses read as the labels the lists use, never as a raw status value.
    expect(screen.getAllByText('Waiting list').length).toBeGreaterThan(0);
    expect(screen.queryByText('pending_review')).toBeNull();

    // Planned, created 3 to 6 months ago: today is 2026-07-19, so the bracket runs from
    // 2026-01-18 to 2026-04-18, and the cell opens the project list on exactly that slice.
    const cell = linkHref('2', (href) => href.includes('"values":["planned"]') && href.includes('created_at'));
    expect(cell).toContain('/portfolio/projects?projectScope=all');
    expect(cell).toContain('"status":{"filterType":"set","values":["planned"]}');
    expect(cell).toContain(
      '"created_at":{"filterType":"date","type":"inRange","dateFrom":"2026-01-18","dateTo":"2026-04-18"}',
    );

    // The oldest bracket is open on the left, the newest open on the right.
    const oldest = linkHref(
      '1',
      (href) => href.includes('"values":["approved"]') && href.includes('lessThan'),
    );
    expect(oldest).toContain(
      '"created_at":{"filterType":"date","type":"lessThan","dateFrom":"2026-01-18"}',
    );
    const newest = linkHref(
      '2',
      (href) => href.includes('"values":["pending_review"]') && href.includes('greaterThanOrEqual'),
    );
    expect(newest).toContain(
      '"created_at":{"filterType":"date","type":"greaterThanOrEqual","dateFrom":"2026-06-20"}',
    );

    // A column total keeps the whole open scope and only carries the date.
    const columnTotal = linkHref(
      '1',
      (href) => href.startsWith('/portfolio/requests') && href.includes('lessThan') && !href.includes('["approved"]'),
    );
    expect(columnTotal).toContain(
      '"status":{"filterType":"set","values":["pending_review","candidate","approved","on_hold"]}',
    );

    // A row total is the status on its own, with no date filter at all.
    const rowTotal = linkHref(
      '3',
      (href) =>
        href.startsWith('/portfolio/projects') &&
        href.includes('"values":["in_progress"]') &&
        !href.includes('created_at'),
    );
    expect(rowTotal).not.toContain('created_at');
    expect(rowTotal).not.toContain('planned_end');
  });

  it('sends a planned-end figure to the project list with the exact filter model', async () => {
    mockApi(report());
    renderReport();

    await waitFor(() => expect(screen.getAllByText('Waiting list').length).toBeGreaterThan(0));

    // Planned, planned end passed: the stage plus "planned end before the report's today".
    const planned = linkHref('2', (href) => href.includes('planned_end') && href.includes('"values":["planned"]'));
    expect(planned).toBe(
      '/portfolio/projects?projectScope=all&filters=' +
        '{"status":{"filterType":"set","values":["planned"]},' +
        '"planned_end":{"filterType":"date","type":"lessThan","dateFrom":"2026-07-19"}}',
    );

    // On the total row the scope stays the whole open population, the date filter is the same.
    const total = linkHref(
      '3',
      (href) => href.includes('planned_end') && href.includes('"values":["waiting_list","planned"'),
    );
    expect(total).toContain(
      '"status":{"filterType":"set","values":["waiting_list","planned","in_progress","in_testing","on_hold"]}',
    );
    expect(total).toContain('"planned_end":{"filterType":"date","type":"lessThan","dateFrom":"2026-07-19"}');
  });

  it('shows where the open work sits and what has stopped moving', async () => {
    mockApi(report());
    renderReport();

    await waitFor(() => expect(screen.getAllByText('Waiting list').length).toBeGreaterThan(0));

    expect(screen.getByText('By status')).toBeTruthy();
    expect(
      screen.getByText('How many open items sit in each status, and how many have been there for a long time.'),
    ).toBeTruthy();
    expect(screen.getByText('Tasks by status')).toBeTruthy();
    expect(screen.getByText('Requests by status')).toBeTruthy();
    expect(screen.getByText('Projects by status')).toBeTruthy();

    const headers = screen.getAllByRole('columnheader').map((node) => node.textContent?.trim() ?? '');
    expect(headers).toContain('Open');
    // A task is read on a month, a request or a project on a quarter.
    expect(headers).toContain('In this status for over 30 days');
    expect(headers).toContain('In this status for over 3 months');
    expect(headers).toContain('Planned end passed');

    // An open figure opens its list on that single status.
    const pending = linkHref('2', (href) => href.startsWith('/portfolio/tasks') && href.includes('"values":["pending"]'));
    expect(pending).toContain('/portfolio/tasks?taskScope=all');
    expect(pending).toContain('"related_object_type":{"filterType":"set","values":[null,"project"]}');
    expect(pending).not.toContain('created_at');
  });

  it('opens the stuck items as a list inside the report, and closes it again', async () => {
    mockApi(report());
    renderReport();

    await waitFor(() => expect(screen.getAllByText('Waiting list').length).toBeGreaterThan(0));
    expect(screen.queryByText('Close')).toBeNull();

    // Planned projects, stuck: two of them, and the header says which figure was clicked.
    const projects = gridUnder('Projects by status');
    fireEvent.click(figureButtons('2', projects)[0]);

    await waitFor(() =>
      expect(screen.getByText('Planned · in this status for over 3 months · 2')).toBeTruthy(),
    );
    expect(screen.getByText('Item PRJ-2')).toBeTruthy();
    expect(screen.getByText('Item PRJ-3')).toBeTruthy();
    expect(screen.queryByText('Item PRJ-4')).toBeNull();
    expect(linkHref('PRJ-2')).toBe('/portfolio/projects/PRJ-2/summary');
    expect(screen.getAllByText('In this status since 4 May').length).toBe(2);
    expect(screen.getByText('Planned end 31 Mar · past due')).toBeTruthy();

    // Only one panel at a time: the total of the column replaces the open one.
    fireEvent.click(figureButtons('3', projects)[0]);
    await waitFor(() =>
      expect(screen.getByText('Projects · in this status for over 3 months · 3')).toBeTruthy(),
    );
    expect(screen.queryByText('Planned · in this status for over 3 months · 2')).toBeNull();
    expect(screen.getByText('Item PRJ-4')).toBeTruthy();

    fireEvent.click(screen.getByText('Close'));
    await waitFor(() =>
      expect(screen.queryByText('Projects · in this status for over 3 months · 3')).toBeNull(),
    );
  });

  it('reads the stuck tasks and requests on their own threshold', async () => {
    mockApi(report());
    renderReport();

    await waitFor(() => expect(screen.getAllByText('Pending review').length).toBeGreaterThan(0));

    // Tasks in progress, stuck for over a month: the two the figure counted, on their own tab.
    const tasks = gridUnder('Tasks by status');
    fireEvent.click(figureButtons('2', tasks)[0]);
    await waitFor(() =>
      expect(screen.getByText('In progress · in this status for over 30 days · 2')).toBeTruthy(),
    );
    expect(linkHref('T-1')).toBe('/portfolio/tasks/T-1/overview');
    // Tasks carry no planned end, so the list never mentions one.
    expect(within(openPanel()).queryByText(/Planned end/)).toBeNull();

    const requests = gridUnder('Requests by status');
    fireEvent.click(figureButtons('1', requests)[0]);
    await waitFor(() =>
      expect(screen.getByText('Pending review · in this status for over 3 months · 1')).toBeTruthy(),
    );
    expect(screen.getByText('Item REQ-1')).toBeTruthy();
    expect(screen.queryByText('Item REQ-3')).toBeNull();
  });

  it('breaks the median time to close down by outcome and by completion', async () => {
    mockApi(report());
    renderReport();

    await waitFor(() => expect(screen.getAllByText('12.4 d').length).toBeGreaterThan(0));

    expect(screen.getByText('Median time to close')).toBeTruthy();
    expect(linkHref('over 6 closings')).toBe(
      '/portfolio/reports/weekly?startDate=2026-06-29&endDate=2026-07-19',
    );
    // A monthly tile carries its horizon and opens the whole month window.
    expect(linkHref('over 5 closings · 12 months')).toBe(
      '/portfolio/reports/weekly?startDate=2025-11-01&endDate=2026-07-19',
    );

    expect(screen.getByText('Requests by outcome')).toBeTruthy();
    expect(screen.getByText('Converted')).toBeTruthy();
    expect(screen.getByText('Rejected')).toBeTruthy();
    expect(screen.getByText('18.5 d')).toBeTruthy();
    expect(screen.getByText('30 d')).toBeTruthy();

    // Projects closed nothing: an em dash, a plain sentence, and no link at all.
    expect(screen.getByText('Completed projects')).toBeTruthy();
    expect(screen.getByText('No closing in this period')).toBeTruthy();
    expect(screen.getAllByRole('link').some((node) => node.textContent?.includes('closing in this period'))).toBe(false);
  });

  it('shows the completed-project figures when projects did close', async () => {
    const base = report();
    mockApi({
      ...base,
      leadTime: {
        ...base.leadTime,
        projects: {
          closedCount: 4,
          medianDays: 180,
          done: { closedCount: 2, medianDays: 210.4, withPlannedEnd: 2, medianOverrunDays: 32 },
        },
      },
    });
    renderReport();

    await waitFor(() => expect(screen.getByText('210.4 d')).toBeTruthy());
    expect(screen.getByText('Completed projects')).toBeTruthy();
    const grid = screen.getByText('Median gap to planned end').closest('.ag-root') as HTMLElement;
    expect(within(grid).getByText('210.4 d')).toBeTruthy();
    expect(within(grid).getByText('32 d over 2 with a planned end')).toBeTruthy();
  });

  it('says so when nothing is open and nothing closed', async () => {
    const emptyAge = (statuses: string[]) => ({
      rows: statuses.map((status) => ageRow(status, {})),
      total: ageRow('total', {}),
    });
    const emptyStatus = (statuses: string[], withPlannedEnd: boolean, thresholdDays: number) => ({
      thresholdDays,
      rows: statuses.map((status) => statusRow(status, 0, 0, withPlannedEnd ? 0 : undefined)),
      total: statusRow('total', 0, 0, withPlannedEnd ? 0 : undefined),
      items: [],
    });
    const requestStatuses = ['pending_review', 'candidate', 'approved', 'on_hold'];
    const projectStatuses = ['waiting_list', 'planned', 'in_progress', 'in_testing', 'on_hold'];

    mockApi(
      report({
        age: {
          tasks: {
            rows: [],
            total: {
              taskTypeId: null,
              taskTypeName: null,
              buckets: { upTo7: 0, from8To30: 0, from31To90: 0, over90: 0 },
              total: 0,
            },
          },
          requests: emptyAge(requestStatuses),
          projects: emptyAge(projectStatuses),
        },
        byStatus: {
          tasks: emptyStatus(['open', 'in_progress', 'pending', 'in_testing'], false, 30),
          requests: emptyStatus(requestStatuses, false, 91),
          projects: emptyStatus(projectStatuses, true, 91),
        },
        leadTime: {
          tasks: { closedCount: 0, measuredCount: 0, medianDays: null },
          tasksByType: [],
          requests: {
            closedCount: 0,
            measuredCount: 0,
            medianDays: null,
            converted: { closedCount: 0, measuredCount: 0, medianDays: null },
            rejected: { closedCount: 0, measuredCount: 0, medianDays: null },
          },
          projects: {
            closedCount: 0,
            measuredCount: 0,
            medianDays: null,
            done: { closedCount: 0, measuredCount: 0, medianDays: null, withPlannedEnd: 0, medianOverrunDays: null },
          },
        },
      }),
    );
    renderReport();

    await waitFor(() => expect(screen.getAllByText('Waiting list').length).toBeGreaterThan(0));
    expect(screen.getByText('No open task to report.')).toBeTruthy();
    expect(screen.getByText('No task closed in this period.')).toBeTruthy();
    expect(screen.getAllByText('No closing in this period')).toHaveLength(3);
    // Every figure of the grids is a zero, so none of them is clickable.
    expect(figureButtons('0')).toHaveLength(0);
    expect(screen.getAllByRole('link').some((node) => node.textContent?.trim() === '0')).toBe(false);
  });

  it('narrows every figure, every list link and every weekly link to the chosen source', async () => {
    mockApi(report());
    renderReport();

    await waitFor(() => expect(screen.getAllByText('open now')).toHaveLength(3));
    // Two horizons, then the source and the category, in the order of the filter bar.
    expect(screen.getByText('All sources')).toBeTruthy();
    expect(screen.getByText('All categories')).toBeTruthy();

    // Every value is ticked while the filter reads "all", so narrowing to the service desk
    // means unticking the other source.
    const [, , sourceFilter] = screen.getAllByRole('combobox');
    fireEvent.mouseDown(sourceFilter);
    fireEvent.click(await screen.findByRole('option', { name: 'Email' }));
    // The menu is a modal: it has to close before the report behind it can be read again.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    // The report is read again on that source alone; the category stays out of the request.
    await waitFor(() => expect(reportCalls()[reportCalls().length - 1].sourceIds).toBe('src-desk'));
    expect(reportCalls()[reportCalls().length - 1].categoryIds).toBeUndefined();
    await waitFor(() => expect(screen.getByText('1 selected')).toBeTruthy());

    // A list link carries the filter the way the lists read it: the value name, as a set.
    const openRequests = linkHref('4', (href) => href.startsWith('/portfolio/requests'));
    expect(openRequests).toContain('"source_name":{"filterType":"set","values":["Service desk"]}');
    expect(openRequests).not.toContain('category_name');
    // And so does every other list destination: the task tile, the age grids and the by-status
    // grids all read the same population.
    const lists = allHrefs().filter(
      (href) => href.startsWith('/portfolio/tasks')
        || href.startsWith('/portfolio/requests')
        || href.startsWith('/portfolio/projects'),
    );
    expect(lists.length).toBeGreaterThan(10);
    expect(lists.every((href) => href.includes('"source_name":{"filterType":"set","values":["Service desk"]}'))).toBe(
      true,
    );
    // The report reads a task's source the way the task list does, so the task figures keep
    // opening their list under a filter.
    const openTasks = linkHref('12');
    expect(openTasks).toContain('/portfolio/tasks?taskScope=all');
    expect(openTasks).toContain('"source_name":{"filterType":"set","values":["Service desk"]}');
    const weekly = allHrefs().filter((href) => href.startsWith('/portfolio/reports/weekly'));
    expect(weekly.length).toBeGreaterThan(0);
    expect(weekly.every((href) => href.endsWith('&sourceIds=src-desk'))).toBe(true);

    // The weekly report reads identifiers, so its links carry those instead.
    expect(linkHref('over 6 closings')).toBe(
      '/portfolio/reports/weekly?startDate=2026-06-29&endDate=2026-07-19&sourceIds=src-desk',
    );

    // Including the ones inside the flow tables, which are built once per filter.
    fireEvent.click(screen.getByText('See the table'));
    await waitFor(() => expect(screen.getByText('Tasks by week')).toBeTruthy());
    const weeklyLinks = allHrefs().filter((href) => href.startsWith('/portfolio/reports/weekly'));
    expect(weeklyLinks.length).toBeGreaterThan(3);
    expect(weeklyLinks.every((href) => href.endsWith('&sourceIds=src-desk'))).toBe(true);
    // Heavy test: several full renders, slower under the full suite's load.
  }, 20_000);

  it('sends both filters at once and drops them when every value is picked', async () => {
    mockApi(report());
    renderReport();

    await waitFor(() => expect(screen.getAllByText('open now')).toHaveLength(3));
    const [, , sourceFilter, categoryFilter] = screen.getAllByRole('combobox');

    fireEvent.mouseDown(sourceFilter);
    fireEvent.click(await screen.findByRole('option', { name: 'Service desk' }));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.mouseDown(categoryFilter);
    fireEvent.click(await screen.findByRole('option', { name: 'Build' }));
    // The menu is a modal: it has to close before the report behind it can be read again.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    await waitFor(() => expect(reportCalls()[reportCalls().length - 1].categoryIds).toBe('cat-run'));
    const withBoth = reportCalls()[reportCalls().length - 1];
    expect(withBoth.sourceIds).toBe('src-mail');
    const bothLink = linkHref('12');
    expect(bothLink).toContain('/portfolio/tasks?taskScope=all');
    expect(bothLink).toContain('"source_name":{"filterType":"set","values":["Email"]}');
    expect(bothLink).toContain('"category_name":{"filterType":"set","values":["Run"]}');
    expect(linkHref('over 6 closings')).toBe(
      '/portfolio/reports/weekly?startDate=2026-06-29&endDate=2026-07-19&sourceIds=src-mail&categoryIds=cat-run',
    );

    // Unticking the last source means "every source": the filter goes away entirely.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.mouseDown(sourceFilter);
    fireEvent.click(await screen.findByRole('option', { name: 'Email' }));
    // The menu is a modal: it has to close before the report behind it can be read again.
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });

    await waitFor(() => expect(reportCalls()[reportCalls().length - 1].sourceIds).toBeUndefined());
    expect(screen.getByText('All sources')).toBeTruthy();
    // The category alone still holds, so the links keep it and drop the source.
    const afterClear = linkHref('12');
    expect(afterClear).not.toContain('source_name');
    expect(afterClear).toContain('"category_name":{"filterType":"set","values":["Run"]}');
    // Heavy test: several full renders, slower under the full suite's load.
  }, 20_000);

  it('drops the weekly link when some closings were imported already closed', async () => {
    const base = report();
    mockApi({
      ...base,
      leadTime: {
        ...base.leadTime,
        requests: { ...base.leadTime.requests, closedCount: 5, measuredCount: 3, medianDays: 21 },
      },
    });
    renderReport();

    await waitFor(() => expect(screen.getByText('over 3 closings · 12 months · 2 created already closed')).toBeTruthy());
    // The weekly report holds the five closings, not the three the median was read on.
    expect(
      screen
        .getAllByRole('link')
        .some((node) => node.textContent?.includes('created already closed')),
    ).toBe(false);
    // The tasks tile measured every one of its closings, so its caption is still a link.
    expect(linkHref('over 6 closings')).toBe('/portfolio/reports/weekly?startDate=2026-06-29&endDate=2026-07-19');
  });
  it('reads the projects and teams from the URL and carries them into every link', async () => {
    mockApi(report());
    renderReport('/portfolio/reports/flow?projectIds=p-1&teamIds=team-1');

    await waitFor(() => expect(screen.getAllByText('open now')).toHaveLength(3));
    expect(reportCalls()[0]).toMatchObject({ projectIds: 'p-1', teamIds: 'team-1' });

    // The weekly report reads the identifiers from its URL.
    await waitFor(() =>
      expect(linkHref('over 6 closings')).toBe(
        '/portfolio/reports/weekly?startDate=2026-06-29&endDate=2026-07-19&projectIds=p-1&teamIds=team-1',
      ),
    );
    const weekly = allHrefs().filter((href) => href.startsWith('/portfolio/reports/weekly'));
    expect(weekly.length).toBeGreaterThan(0);
    expect(weekly.every((href) => href.endsWith('&projectIds=p-1&teamIds=team-1'))).toBe(true);

    // The lists read them through their hidden filters, with the report's own rules.
    const filtersOf = (href: string) => JSON.parse(new URLSearchParams(href.split('?')[1]).get('filters') ?? '{}');
    const tasks = filtersOf(linkHref('12'));
    expect(tasks.related_object_type).toEqual({ filterType: 'set', values: ['project'] });
    expect(tasks.related_object_id).toEqual({ filterType: 'set', values: ['p-1'] });
    expect(tasks.assignee_team_id).toEqual({ filterType: 'set', values: ['team-1'] });
    expect(tasks.status.values).toEqual(['open', 'in_progress', 'pending', 'in_testing']);
    const requests = filtersOf(linkHref('4', (href) => href.startsWith('/portfolio/requests')));
    expect(requests.linked_project_id).toEqual({ filterType: 'set', values: ['p-1'] });
    expect(requests.involved_team_id).toEqual({ filterType: 'set', values: ['team-1'] });
    const projects = filtersOf(
      linkHref('6', (href) => href.startsWith('/portfolio/projects') && !href.includes('planned_end')),
    );
    expect(projects.id).toEqual({ filterType: 'set', values: ['p-1'] });
    expect(projects.involved_team_id).toEqual({ filterType: 'set', values: ['team-1'] });

    // Every list destination carries them, not only the tiles.
    const lists = allHrefs().filter((href) => /^\/portfolio\/(tasks|requests|projects)\?/.test(href));
    expect(lists.length).toBeGreaterThan(10);
    expect(lists.every((href) => href.includes('"values":["team-1"]'))).toBe(true);
  });

  it('sends the project and the team picked in the filter bar', async () => {
    mockApi(report());
    renderReport();
    await waitFor(() => expect(screen.getAllByText('open now')).toHaveLength(3));
    expect(reportCalls()[0].projectIds).toBeUndefined();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Project' }));
    fireEvent.click(await screen.findByRole('option', { name: 'PRJ-3 · Cellar probes' }));
    await waitFor(() => expect(reportCalls()[reportCalls().length - 1].projectIds).toBe('p-1'));

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    fireEvent.mouseDown(screen.getByText('All teams'));
    fireEvent.click(await screen.findByRole('option', { name: 'Cheese makers' }));
    await waitFor(() => expect(reportCalls()[reportCalls().length - 1].teamIds).toBe('team-1'));
  });
});
