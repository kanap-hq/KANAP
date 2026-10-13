import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { ThemeModeProvider, createAppTheme } from '../../config/ThemeContext';
import WeeklyReport from './WeeklyReport';

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

const emptyLists = () => ({ created: [], modified: [], closed: [] });

const requestRow = (over: Record<string, unknown> = {}) => ({
  requestId: 'r1',
  ref: 'REQ-5',
  itemPath: '/portfolio/requests/REQ-5/summary',
  name: 'Cave climate digital twin',
  sourceId: null,
  sourceName: null,
  categoryId: null,
  categoryName: null,
  streamId: null,
  streamName: null,
  status: 'converted',
  createdAt: '2026-09-10',
  eventAt: '2026-09-14',
  changes: null,
  ...over,
});

const projectRow = (over: Record<string, unknown> = {}) => ({
  projectId: 'p1',
  ref: 'PRJ-16',
  itemPath: '/portfolio/projects/PRJ-16/summary',
  name: 'Cheese grading rollout',
  sourceId: null,
  sourceName: null,
  categoryId: null,
  categoryName: null,
  streamId: null,
  streamName: null,
  status: 'planned',
  createdAt: '2026-09-14',
  eventAt: '2026-09-14',
  changes: null,
  priority: 70,
  progress: 0,
  origin: null,
  originValue: 'fast_track',
  ...over,
});

const report = (over: Record<string, unknown> = {}) => ({
  requests: emptyLists(),
  projects: emptyLists(),
  tasks: emptyLists(),
  ...over,
});

const PROJECT_TEAM_VALUES = {
  projects: [{ id: 'p-1', ref: 'PRJ-3', name: 'Cellar probes', status: 'in_progress' }],
  teams: [{ id: 'team-1', name: 'Cheese makers' }],
};

const EMPTY_FILTER_VALUES = { sources: [], categories: [], streams: [], taskTypes: [] };

function mockApi(data: unknown, filterValues: unknown = EMPTY_FILTER_VALUES) {
  get.mockImplementation((url: string) => {
    if (url === '/portfolio/reports/weekly/filter-values') {
      return Promise.resolve({ data: filterValues });
    }
    if (url === '/portfolio/reports/filter-values') {
      return Promise.resolve({ data: PROJECT_TEAM_VALUES });
    }
    return Promise.resolve({ data });
  });
}

/** The parameters of the last call to the report endpoint. */
const lastWeeklyParams = () => {
  const calls = get.mock.calls.filter(([url]: any[]) => url === '/portfolio/reports/weekly');
  return calls[calls.length - 1]?.[1]?.params;
};

function renderReport(entry = '/portfolio/reports/weekly') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeModeProvider>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter initialEntries={[entry]}>
            <WeeklyReport />
          </MemoryRouter>
        </ThemeProvider>
      </ThemeModeProvider>
    </QueryClientProvider>,
  );
}

const taskRow = (over: Record<string, unknown> = {}) => ({
  taskId: 't1',
  ref: 'T-1',
  itemPath: '/portfolio/tasks/T-1/overview',
  name: 'Tune the cellar probes',
  sourceId: null,
  sourceName: null,
  categoryId: null,
  categoryName: null,
  streamId: null,
  streamName: null,
  status: 'open',
  createdAt: '2026-09-15',
  eventAt: '2026-09-15',
  changes: null,
  taskTypeId: null,
  taskTypeName: null,
  priority: 70,
  ...over,
});

const emptyPersonLists = () => ({ created: [], modified: [], closed: [] });

const person = (over: Record<string, unknown> = {}) => ({
  userId: 'u-thomas',
  name: 'Thomas Berger',
  contributorRef: 'CTR-3',
  loggedDays: { project: 2, other: 1.5, total: 3.5 },
  ...emptyPersonLists(),
  ...over,
});

const byPersonPayload = () => ({
  teams: [
    {
      teamId: 'team-ops',
      teamName: 'Operations',
      totals: { created: 1, modified: 0, closed: 1, loggedDays: 3.5 },
      members: [
        person({
          created: [taskRow()],
          closed: [taskRow({ taskId: 't2', ref: 'T-2', name: 'Replace the ripening sensor', status: 'done' })],
        }),
      ],
    },
  ],
  unassigned: {
    created: [],
    modified: [],
    closed: [taskRow({ taskId: 't3', ref: 'T-3', name: 'Archive the old batches', status: 'done' })],
  },
});

beforeEach(() => {
  get.mockReset();
  hasLevel.mockReset();
  hasLevel.mockReturnValue(true);
  window.localStorage.clear();
});

describe('WeeklyReport', () => {
  it('shows the three sections in the owner order, an empty one on a single line', async () => {
    mockApi(report());
    renderReport();

    await waitFor(() => expect(screen.getAllByText('0 created · 0 modified · 0 closed')).toHaveLength(3));

    const headings = screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent);
    expect(headings).toEqual(['Requests', 'Projects', 'Tasks']);

    // Nothing to unfold: no list headings under an empty section.
    expect(screen.queryByText('Created (0)')).toBeNull();
    expect(screen.queryByText('Modified (0)')).toBeNull();
    expect(screen.queryByText('Closed (0)')).toBeNull();
  });

  it('keeps an empty list to its heading and renders a grid only when there are rows', async () => {
    mockApi(report({ requests: { created: [requestRow()], modified: [], closed: [] } }));
    renderReport();

    await waitFor(() => expect(screen.getByText('Cave climate digital twin')).toBeTruthy());

    expect(screen.getByText('Created (1)')).toBeTruthy();
    expect(screen.getByText('REQ-5')).toBeTruthy();
    // The heading carries the zero; there is no sentence under an empty list.
    expect(screen.getAllByText('Modified (0)')).toHaveLength(1);
    expect(screen.queryByText(/in this period\./)).toBeNull();
    expect(document.querySelectorAll('.ag-root-wrapper')).toHaveLength(1);
  });

  it('summarises every entity as created, modified and closed', async () => {
    mockApi(
      report({
        requests: { created: [requestRow()], modified: [], closed: [requestRow()] },
        projects: { created: [projectRow()], modified: [], closed: [] },
      }),
    );
    renderReport();

    await waitFor(() =>
      expect(
        screen.getByText(/Requests 1 created · 0 modified · 1 closed/),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/Projects 1 created · 0 modified · 0 closed/)).toBeTruthy();
    expect(screen.getByText(/Tasks 0 created · 0 modified · 0 closed/)).toBeTruthy();
  });

  it('shows the source request of a converted project, and the KANAP origin label otherwise', async () => {
    mockApi(
      report({
        projects: {
          created: [
            projectRow(),
            projectRow({ projectId: 'p3', ref: 'PRJ-18', name: 'Old cellar mapping', originValue: 'legacy' }),
            projectRow({
              projectId: 'p2',
              ref: 'PRJ-17',
              name: 'Smart packaging',
              originValue: 'standard',
              origin: {
                ref: 'REQ-2',
                name: 'Smart packaging automation',
                itemPath: '/portfolio/requests/REQ-2/summary',
              },
            }),
          ],
          modified: [],
          closed: [],
        },
      }),
    );
    renderReport();

    await waitFor(() => expect(screen.getByText('Smart packaging')).toBeTruthy());
    expect(screen.getByText('Fast-track')).toBeTruthy();
    expect(screen.getByText('Legacy')).toBeTruthy();
    expect(screen.getByText('REQ-2')).toBeTruthy();
    expect(screen.getByText('Smart packaging automation')).toBeTruthy();
    expect(screen.queryByText('Created directly')).toBeNull();
  });

  it('lists an item created and closed in the same period in both grids', async () => {
    mockApi(
      report({
        requests: {
          created: [requestRow({ eventAt: '2026-09-10' })],
          modified: [],
          closed: [requestRow({ eventAt: '2026-09-14' })],
        },
      }),
    );
    renderReport();

    await waitFor(() => expect(screen.getAllByText('Cave climate digital twin')).toHaveLength(2));
    expect(screen.getByText('Created (1)')).toBeTruthy();
    expect(screen.getByText('Closed (1)')).toBeTruthy();
    expect(screen.getAllByText('Modified (0)')).toHaveLength(1);
  });

  it('shows the creation day before the closing day in a closed list', async () => {
    mockApi(
      report({
        requests: { created: [], modified: [], closed: [requestRow({ eventAt: '2026-09-14' })] },
      }),
    );
    renderReport();

    await waitFor(() => expect(screen.getByText('Cave climate digital twin')).toBeTruthy());

    const headers = screen
      .getAllByRole('columnheader')
      .map((node) => node.textContent?.trim() ?? '');
    expect(headers).toContain('Created on');
    expect(headers).toContain('Closed on');
    expect(headers.indexOf('Created on')).toBeLessThan(headers.indexOf('Closed on'));
    expect(screen.getByText('10 Sep')).toBeTruthy();
    expect(screen.getByText('14 Sep')).toBeTruthy();
  });

  it('folds a group, keeps its counts in the title row and remembers the choice', async () => {
    mockApi(report({ requests: { created: [requestRow()], modified: [], closed: [] } }));
    const view = renderReport();

    await waitFor(() => expect(screen.getByText('Cave climate digital twin')).toBeTruthy());

    const requestsHeading = screen.getAllByRole('heading', { level: 2 })[0];
    const toggle = within(requestsHeading).getByRole('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');

    fireEvent.click(toggle);

    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'));
    expect(window.localStorage.getItem('kanap.portfolioReports.weekly.collapsed.requests')).toBe('1');
    expect(screen.getByText('1 created · 0 modified · 0 closed')).toBeTruthy();

    view.unmount();
    mockApi(report({ requests: { created: [requestRow()], modified: [], closed: [] } }));
    renderReport();

    await waitFor(() =>
      expect(
        screen.getAllByRole('heading', { level: 2 })[0].querySelector('button')?.getAttribute('aria-expanded'),
      ).toBe('false'),
    );
  });

  it('opens on the period carried by the URL, and ignores a day that does not exist', async () => {
    mockApi(report());
    renderReport('/portfolio/reports/weekly?startDate=2026-08-17&endDate=2026-08-23');

    await waitFor(() => expect(get).toHaveBeenCalledWith('/portfolio/reports/weekly', expect.anything()));
    const call = get.mock.calls.find(([url]: any[]) => url === '/portfolio/reports/weekly');
    expect(call?.[1]?.params?.startDate).toBe('2026-08-17');
    expect(call?.[1]?.params?.endDate).toBe('2026-08-23');

    get.mockReset();
    mockApi(report());
    renderReport('/portfolio/reports/weekly?startDate=2026-02-31&endDate=nope');

    await waitFor(() => expect(get).toHaveBeenCalledWith('/portfolio/reports/weekly', expect.anything()));
    const fallback = get.mock.calls.find(([url]: any[]) => url === '/portfolio/reports/weekly');
    expect(fallback?.[1]?.params?.startDate).not.toBe('2026-02-31');
    expect(fallback?.[1]?.params?.endDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('opens on the source and the category carried by the URL', async () => {
    // The flow report links here with the classification its figure was read under.
    mockApi(
      report({
        requests: {
          created: [requestRow({ sourceId: 'src-desk', sourceName: 'Service desk', categoryId: 'cat-run', categoryName: 'Run' })],
          modified: [],
          closed: [],
        },
      }),
      {
        sources: [{ id: 'src-desk', name: 'Service desk' }, { id: 'src-mail', name: 'Email' }],
        categories: [{ id: 'cat-run', name: 'Run' }, { id: 'cat-build', name: 'Build' }],
        streams: [],
        taskTypes: [],
      },
    );
    renderReport(
      '/portfolio/reports/weekly?startDate=2026-09-14&endDate=2026-09-20&sourceIds=src-desk&categoryIds=cat-run',
    );

    await waitFor(() => expect(get).toHaveBeenCalledWith('/portfolio/reports/weekly', expect.anything()));
    const call = get.mock.calls.find(([url]: any[]) => url === '/portfolio/reports/weekly');
    expect(call?.[1]?.params?.sourceIds).toBe('src-desk');
    expect(call?.[1]?.params?.categoryIds).toBe('cat-run');
    // The filter bar shows the narrowing rather than claiming the whole portfolio, and it
    // survives the first render, when neither the values nor the rows have arrived yet.
    await waitFor(() => expect(screen.getAllByText('1 selected').length).toBe(2));
    expect(screen.queryByText('All sources')).toBeNull();
    expect(screen.queryByText('All categories')).toBeNull();
  });

  it('spells out what changed on a modified row', async () => {
    mockApi(
      report({
        requests: {
          created: [],
          modified: [
            requestRow({
              status: 'approved',
              eventAt: '2026-09-15',
              changes: {
                statusChain: ['pending_review', 'candidate', 'approved'],
                fields: [
                  { key: 'priority_score', before: '44.44', after: '68', kind: 'number' },
                  { key: 'target_delivery_date', before: null, after: '2026-09-30', kind: 'date' },
                ],
              },
            }),
          ],
          closed: [],
        },
      }),
    );
    renderReport();

    await waitFor(() =>
      expect(
        screen.getByText(
          'Pending review → Candidate → Approved; Priority score: 44.44 → 68; Target delivery date: empty → 30 Sep',
        ),
      ).toBeTruthy(),
    );
    // Two fields fit: nothing is folded away.
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  it('shows the chain and two fields, folds the rest into +n and lists everything on hover', async () => {
    mockApi(
      report({
        tasks: {
          created: [],
          modified: [
            taskRow({
              status: 'done',
              eventAt: '2026-09-15',
              changes: {
                statusChain: ['open', 'in_progress', 'in_testing', 'done'],
                fields: [
                  { key: 'assignee_user_id', before: 'Thomas Berger', after: 'Isabelle Moreau', kind: 'ref' },
                  { key: 'labels', before: '0', after: '2', kind: 'list' },
                  { key: 'task_type_id', before: '', after: 'Bug', kind: 'ref' },
                ],
              },
            }),
          ],
          closed: [],
        },
      }),
    );
    renderReport();

    const cell = await screen.findByText(
      'Open → In progress → In testing → Done; Assignee: Thomas Berger → Isabelle Moreau; Labels: 0 items → 2 items',
    );
    expect(screen.getByText('+1')).toBeTruthy();
    expect(screen.queryByText(/Task type: unknown → Bug/)).toBeNull();

    fireEvent.mouseOver(cell);
    const tooltip = await screen.findByTestId('weekly-changes-tooltip');
    const lines = Array.from(tooltip.children).map((node) => node.textContent);
    expect(lines).toEqual([
      'Open → In progress → In testing → Done',
      'Assignee: Thomas Berger → Isabelle Moreau',
      'Labels: 0 items → 2 items',
      'Task type: unknown → Bug',
    ]);
  });

  it('reads a status with the labels of the row object', async () => {
    // Projects and tasks share `in_progress`: give the project its own wording to tell them apart.
    i18n.addResource('en', 'portfolio', 'statuses.project.in_progress', 'Running');
    try {
      mockApi(
        report({
          projects: {
            created: [],
            modified: [
              projectRow({
                status: 'in_progress',
                eventAt: '2026-09-15',
                changes: { statusChain: ['planned', 'in_progress'], fields: [] },
              }),
            ],
            closed: [],
          },
        }),
      );
      renderReport();

      await waitFor(() => expect(screen.getByText('Planned → Running')).toBeTruthy());
      // The status column reads the project wording too, never the task one.
      expect(screen.getByText('Running')).toBeTruthy();
    } finally {
      i18n.addResource('en', 'portfolio', 'statuses.project.in_progress', 'In progress');
    }
  });
});

describe('WeeklyReport status reached and company', () => {
  it('opens on the statuses carried by the URL and ignores an unknown one', async () => {
    mockApi(report());
    renderReport('/portfolio/reports/weekly?statuses=done,bogus');

    await waitFor(() => expect(lastWeeklyParams()?.statuses).toBe('done'));
    expect(screen.getByText('1 selected')).toBeTruthy();
  });

  it('sends the statuses picked in the menu, grouped by object with their labels', async () => {
    mockApi(report());
    renderReport('/portfolio/reports/weekly?statuses=done');

    await waitFor(() => expect(screen.getByText('1 selected')).toBeTruthy());
    fireEvent.mouseDown(screen.getByText('1 selected'));

    const listbox = await screen.findByRole('listbox');
    // One group per object, in the owner order, with the labels the app uses, never raw values.
    expect(within(listbox).getByText('Requests')).toBeTruthy();
    expect(within(listbox).getByText('Projects')).toBeTruthy();
    expect(within(listbox).getByText('Tasks')).toBeTruthy();
    expect(within(listbox).getByText('Pending review')).toBeTruthy();
    expect(within(listbox).queryByText('pending_review')).toBeNull();

    fireEvent.click(within(listbox).getByText('Rejected'));

    await waitFor(() => expect(lastWeeklyParams()?.statuses).toBe('done,rejected'));
  });

  it('sends no status filter by default', async () => {
    mockApi(report());
    renderReport();

    await waitFor(() => expect(lastWeeklyParams()).toBeTruthy());
    expect(lastWeeklyParams()?.statuses).toBeUndefined();
    expect(screen.getByText('All statuses')).toBeTruthy();
  });

  it('shows the company of each row', async () => {
    mockApi(report({ requests: { created: [requestRow({ company: 'Fromage & Co SA' })], modified: [], closed: [] } }));
    renderReport();

    await waitFor(() => expect(screen.getByText('Fromage & Co SA')).toBeTruthy());
    expect(screen.getAllByText('Company').length).toBeGreaterThan(0);
  });
});

describe('WeeklyReport by person', () => {
  const personReport = () =>
    report({
      tasks: {
        created: [taskRow()],
        modified: [],
        closed: [
          taskRow({ taskId: 't2', ref: 'T-2', name: 'Replace the ripening sensor', status: 'done' }),
          taskRow({ taskId: 't3', ref: 'T-3', name: 'Archive the old batches', status: 'done' }),
        ],
      },
      byPerson: byPersonPayload(),
    });

  it('offers no switch between the two reports: the URL alone decides', async () => {
    mockApi(personReport());
    renderReport();

    await waitFor(() => expect(screen.getAllByText('Created (1)').length).toBeGreaterThan(0));
    // The title only: no breadcrumb repeats it.
    expect(screen.getAllByText('Period review')).toHaveLength(1);
    expect(document.querySelector('nav[aria-label="breadcrumb"]')).toBeNull();
    expect(screen.queryByText('Grouping')).toBeNull();
    expect(screen.queryByText('By type')).toBeNull();
    expect(screen.queryByText('By person')).toBeNull();
    expect(lastWeeklyParams()?.groupBy).toBe('type');
    expect(window.localStorage.getItem('kanap.portfolioReports.weeklyGroupBy')).toBeNull();
  });

  it('opens by type without the URL parameter, whatever view was chosen before', async () => {
    // A previous visit switched to the by-person view (and an older build stored it).
    window.localStorage.setItem('kanap.portfolioReports.weeklyGroupBy', 'person');
    mockApi(personReport());
    const first = renderReport('/portfolio/reports/weekly?groupBy=person');
    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());
    first.unmount();

    get.mockReset();
    mockApi(personReport());
    renderReport();

    await waitFor(() => expect(screen.getAllByText('Created (1)').length).toBeGreaterThan(0));
    const call = get.mock.calls.find(([url]: any[]) => url === '/portfolio/reports/weekly');
    expect(call?.[1]?.params?.groupBy).toBe('type');
    expect(screen.queryByText('Operations')).toBeNull();
  });

  it('opens on the by-person reading carried by the URL', async () => {
    // The "Activity by person" card of the hub opens this same page with `groupBy=person`.
    mockApi(personReport());
    renderReport('/portfolio/reports/weekly?groupBy=person');

    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());
    const call = get.mock.calls.find(([url]: any[]) => url === '/portfolio/reports/weekly');
    expect(call?.[1]?.params?.groupBy).toBe('person');
    // Its own report: its own title and subtitle, the ones of its hub card.
    expect(screen.getAllByText('Activity by person')).toHaveLength(1);
    expect(
      screen.getByText('Tasks each person created, changed and closed over a period, with the days they logged.'),
    ).toBeTruthy();
    expect(window.localStorage.getItem('kanap.portfolioReports.weeklyGroupBy')).toBeNull();
  });

  it('reads team first, then person, then person, with the counts and the time', async () => {
    mockApi(personReport());
    renderReport('/portfolio/reports/weekly?groupBy=person');

    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());

    const note = screen.getByText(
      (_, node) => node?.tagName === 'P' && (node.textContent ?? '').startsWith('This report covers tasks.'),
    );
    expect(note.textContent).toBe('This report covers tasks. Requests and projects are in the Period review.');
    // The summary speaks of tasks only, like the report.
    expect(screen.queryByText(/Requests \d+ created/)).toBeNull();
    expect(screen.getByText(/^Tasks \d+ created/)).toBeTruthy();
    expect(screen.getByText('Thomas Berger')).toBeTruthy();
    expect(screen.getByText('CTR-3')).toBeTruthy();
    expect(screen.getByText('1 created · 0 modified · 1 closed · 3.5 days logged')).toBeTruthy();
    expect(
      screen.getByText('1 created · 0 modified · 1 closed · Time logged 3.5 d (project 2.0 · other 1.5)'),
    ).toBeTruthy();
    expect(screen.getByText('Tune the cellar probes')).toBeTruthy();
    expect(screen.getByText('Replace the ripening sensor')).toBeTruthy();
  });

  it('says nothing about time for a person who logged none', async () => {
    mockApi(
      report({
        byPerson: {
          teams: [
            {
              teamId: 'team-ops',
              teamName: 'Operations',
              totals: { created: 1, modified: 0, closed: 0, loggedDays: 0 },
              members: [
                person({
                  userId: 'u-isabelle',
                  name: 'Isabelle Moreau',
                  contributorRef: 'CTR-4',
                  loggedDays: { project: 0, other: 0, total: 0 },
                  created: [taskRow({ taskId: 't4', ref: 'T-4', name: 'Label the new cave' })],
                }),
              ],
            },
          ],
          unassigned: emptyPersonLists(),
        },
      }),
    );
    renderReport('/portfolio/reports/weekly?groupBy=person');

    await waitFor(() => expect(screen.getByText('Isabelle Moreau')).toBeTruthy());
    // Neither the person nor the team line mentions time when none was logged.
    expect(screen.getAllByText('1 created · 0 modified · 0 closed')).toHaveLength(2);
    expect(screen.queryByText(/Time logged/)).toBeNull();
    expect(screen.queryByText(/days? logged/)).toBeNull();
    // Her empty lists are headings only.
    expect(screen.getByText('Modified (0)')).toBeTruthy();
    expect(screen.queryByText(/in this period\./)).toBeNull();
  });

  it('shows an empty Unassigned group as its header line only', async () => {
    mockApi(report({ byPerson: { ...byPersonPayload(), unassigned: emptyPersonLists() } }));
    renderReport('/portfolio/reports/weekly?groupBy=person');

    await waitFor(() => expect(screen.getByText('Unassigned')).toBeTruthy());
    expect(screen.getByText('0 created · 0 modified · 0 closed')).toBeTruthy();
    expect(screen.queryByText(/No task/)).toBeNull();
    // Nothing to unfold: the header is not a toggle.
    expect(screen.getByText('Unassigned').closest('button')).toBeNull();
  });

  it('gathers what nobody carried under Unassigned', async () => {
    mockApi(personReport());
    renderReport('/portfolio/reports/weekly?groupBy=person');

    await waitFor(() => expect(screen.getByText('Unassigned')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Archive the old batches')).toBeTruthy());
    expect(screen.getByText('0 created · 0 modified · 1 closed')).toBeTruthy();
  });

  it('folds a person and remembers it', async () => {
    mockApi(personReport());
    renderReport('/portfolio/reports/weekly?groupBy=person');

    await waitFor(() => expect(screen.getByText('Thomas Berger')).toBeTruthy());

    const toggle = screen.getByText('Thomas Berger').closest('button') as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);

    await waitFor(() => expect(toggle.getAttribute('aria-expanded')).toBe('false'));
    expect(window.localStorage.getItem('kanap.portfolioReports.weeklyCollapsedPeople')).toBe(
      JSON.stringify(['person:u-thomas']),
    );
  });

  it('hides the contributor reference from a reader without the portfolio settings right', async () => {
    hasLevel.mockReturnValue(false);
    mockApi(personReport());
    renderReport('/portfolio/reports/weekly?groupBy=person');

    await waitFor(() => expect(screen.getByText('Thomas Berger')).toBeTruthy());
    expect(screen.queryByText('CTR-3')).toBeNull();
  });

  it('exports the reading shown on screen', async () => {
    mockApi(personReport());
    renderReport('/portfolio/reports/weekly?groupBy=person');

    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());
    fireEvent.click(screen.getByText('Export CSV'));

    await waitFor(() =>
      expect(get.mock.calls.some(([url]: any[]) => url === '/portfolio/reports/weekly/export')).toBe(true),
    );
    const call = get.mock.calls.find(([url]: any[]) => url === '/portfolio/reports/weekly/export');
    expect(call?.[1]?.params?.groupBy).toBe('person');
    expect(call?.[1]?.params?.format).toBe('csv');
  });

  it('has no type filter in the by-person view, which reads tasks only', async () => {
    mockApi(personReport());
    renderReport('/portfolio/reports/weekly?groupBy=person&entities=request');

    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());
    expect(screen.queryByText('All types')).toBeNull();
    expect(screen.queryByText('Type')).toBeNull();
    expect(lastWeeklyParams()?.entities).toBeUndefined();
  });

  it('links the by-person view to the period review on the same period and filters', async () => {
    mockApi(personReport());
    renderReport(
      '/portfolio/reports/weekly?groupBy=person&startDate=2026-09-14&endDate=2026-09-20&sourceIds=src-desk&projectIds=p-1&teamIds=team-1',
    );

    await waitFor(() => expect(screen.getByText('Operations')).toBeTruthy());
    const link = screen.getByRole('link', { name: 'Period review' });
    const [path, search] = (link.getAttribute('href') ?? '').split('?');
    expect(path).toBe('/portfolio/reports/weekly');
    const params = new URLSearchParams(search);
    expect(params.get('groupBy')).toBeNull();
    expect(params.get('startDate')).toBe('2026-09-14');
    expect(params.get('endDate')).toBe('2026-09-20');
    expect(params.get('sourceIds')).toBe('src-desk');
    expect(params.get('projectIds')).toBe('p-1');
    expect(params.get('teamIds')).toBe('team-1');
  });
});

describe('WeeklyReport project and team', () => {
  const weeklyCalls = () =>
    get.mock.calls.filter(([url]: any[]) => url === '/portfolio/reports/weekly').map((call: any[]) => call[1]?.params);

  it('opens on the projects and teams carried by the URL and exports them too', async () => {
    mockApi(report({ tasks: { created: [taskRow()], modified: [], closed: [] } }));
    renderReport('/portfolio/reports/weekly?startDate=2026-08-17&endDate=2026-08-23&projectIds=p-1,p-2&teamIds=team-1');

    await waitFor(() => expect(weeklyCalls().length).toBeGreaterThan(0));
    expect(weeklyCalls()[0]).toMatchObject({ projectIds: 'p-1,p-2', teamIds: 'team-1' });
    await screen.findAllByText('Tune the cellar probes');

    fireEvent.click(screen.getByText('Export CSV'));
    await waitFor(() =>
      expect(get.mock.calls.some(([url]: any[]) => url === '/portfolio/reports/weekly/export')).toBe(true),
    );
    const exportCall = get.mock.calls.find(([url]: any[]) => url === '/portfolio/reports/weekly/export');
    expect(exportCall?.[1]?.params).toMatchObject({ projectIds: 'p-1,p-2', teamIds: 'team-1' });
  });

  it('sends the project and the team picked in the filter bar', async () => {
    mockApi(report());
    renderReport();

    await waitFor(() => expect(weeklyCalls().length).toBeGreaterThan(0));
    expect(weeklyCalls()[0].projectIds).toBeUndefined();
    expect(weeklyCalls()[0].teamIds).toBeUndefined();

    // Every project is offered, even with no row in the period.
    const project = screen.getByRole('combobox', { name: 'Project' });
    fireEvent.mouseDown(project);
    fireEvent.click(await screen.findByRole('option', { name: 'PRJ-3 · Cellar probes' }));
    await waitFor(() => expect(weeklyCalls().some((params) => params.projectIds === 'p-1')).toBe(true));

    fireEvent.mouseDown(screen.getByText('All teams'));
    fireEvent.click(await screen.findByRole('option', { name: 'Cheese makers' }));
    await waitFor(() =>
      expect(weeklyCalls().some((params) => params.projectIds === 'p-1' && params.teamIds === 'team-1')).toBe(true),
    );
  });
});

describe('WeeklyReport filter options', () => {
  const CATALOGUE = {
    sources: [
      { id: 'src-desk', name: 'Service desk' },
      { id: 'src-mail', name: 'Email' },
    ],
    categories: [
      { id: 'cat-run', name: 'Run' },
      { id: 'cat-build', name: 'Build' },
    ],
    streams: [
      { id: 'str-ops', name: 'Operations', categoryId: 'cat-run' },
      { id: 'str-new', name: 'New products', categoryId: 'cat-build' },
    ],
    taskTypes: [{ id: 'tt-bug', name: 'Bug' }],
  };

  it('offers every value of the catalogue, and a value unticked can be ticked again', async () => {
    // The rows carry one source only; the other one is offered all the same.
    mockApi(
      report({ requests: { created: [requestRow({ sourceId: 'src-desk', sourceName: 'Service desk' })], modified: [], closed: [] } }),
      CATALOGUE,
    );
    renderReport();
    await waitFor(() => expect(screen.getByText('All sources')).toBeTruthy());

    fireEvent.mouseDown(screen.getByText('All sources'));
    let listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((node) => node.textContent)).toEqual(['Service desk', 'Email']);
    fireEvent.click(within(listbox).getByText('Service desk'));
    await waitFor(() => expect(lastWeeklyParams()?.sourceIds).toBe('src-mail'));

    // The value unticked stays in the list, whatever rows came back.
    mockApi(report(), CATALOGUE);
    fireEvent.keyDown(listbox, { key: 'Escape' });
    fireEvent.mouseDown(await screen.findByText('1 selected'));
    listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((node) => node.textContent)).toEqual(['Service desk', 'Email']);
    fireEvent.click(within(listbox).getByText('Service desk'));
    // Both ticked again: no filter at all.
    await waitFor(() => expect(lastWeeklyParams()?.sourceIds).toBeUndefined());
    expect(screen.getByText('All sources')).toBeTruthy();
  });

  it('offers the streams of the categories picked, from the catalogue', async () => {
    mockApi(report(), CATALOGUE);
    renderReport('/portfolio/reports/weekly?categoryIds=cat-build');
    await waitFor(() => expect(lastWeeklyParams()?.categoryIds).toBe('cat-build'));
    const streams = screen.getByText('All streams');
    await waitFor(() => expect(streams.getAttribute('aria-disabled')).toBeNull());

    fireEvent.mouseDown(streams);
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((node) => node.textContent)).toEqual(['New products']);
  });
});

describe('WeeklyReport type', () => {
  it('reads the objects from the URL, sends them and shows their sections only', async () => {
    mockApi(report({ projects: { created: [projectRow()], modified: [], closed: [] } }));
    renderReport('/portfolio/reports/weekly?entities=project,task,bogus');

    await waitFor(() => expect(lastWeeklyParams()?.entities).toBe('project,task'));
    await waitFor(() => expect(screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)).toEqual([
      'Projects',
      'Tasks',
    ]));
    expect(screen.getByText('Projects, Tasks')).toBeTruthy();
    expect(screen.queryByText(/Requests \d+ created/)).toBeNull();
    expect(screen.getByText(/Projects 1 created · 0 modified · 0 closed \| Tasks 0 created/)).toBeTruthy();

    // The export covers the same objects.
    fireEvent.click(screen.getByText('Export CSV'));
    await waitFor(() =>
      expect(get.mock.calls.some(([url]: any[]) => url === '/portfolio/reports/weekly/export')).toBe(true),
    );
    const exportCall = get.mock.calls.find(([url]: any[]) => url === '/portfolio/reports/weekly/export');
    expect(exportCall?.[1]?.params?.entities).toBe('project,task');
  });

  it('sends the objects picked in the menu, and nothing once all three are back', async () => {
    mockApi(report());
    renderReport();
    await waitFor(() => expect(screen.getByText('All types')).toBeTruthy());
    expect(lastWeeklyParams()?.entities).toBeUndefined();

    fireEvent.mouseDown(screen.getByText('All types'));
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((node) => node.textContent)).toEqual([
      'Requests',
      'Projects',
      'Tasks',
    ]);
    fireEvent.click(within(listbox).getByText('Tasks'));
    await waitFor(() => expect(lastWeeklyParams()?.entities).toBe('request,project'));
    // The menu is modal: closed, the page behind it can be read again.
    fireEvent.keyDown(listbox, { key: 'Escape' });
    await waitFor(() =>
      expect(screen.getAllByRole('heading', { level: 2 }).map((node) => node.textContent)).toEqual([
        'Requests',
        'Projects',
      ]),
    );

    fireEvent.mouseDown(screen.getByText('Requests, Projects'));
    fireEvent.click(within(await screen.findByRole('listbox')).getByText('Tasks'));
    await waitFor(() => expect(lastWeeklyParams()?.entities).toBeUndefined());
  });

});
