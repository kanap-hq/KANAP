import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { ThemeModeProvider, createAppTheme } from '../../config/ThemeContext';
import UpcomingReport, { horizonStorageKey, type UpcomingReportData } from './UpcomingReport';

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

const task = (ref: string, dueDate: string) => ({
  ref,
  itemPath: `/portfolio/tasks/${ref}/overview`,
  name: `Task ${ref}`,
  status: 'open',
  taskTypeName: 'Task',
  priorityLevel: 'high',
  assigneeName: 'Alice Martin',
  dueDate,
  project: { ref: 'PRJ-3', name: 'Cellar probes', itemPath: '/portfolio/projects/PRJ-3/summary' },
});

const project = (ref: string, plannedEnd: string | null, plannedStart: string | null = null) => ({
  ref,
  itemPath: `/portfolio/projects/${ref}/summary`,
  name: `Project ${ref}`,
  status: 'in_progress',
  priority: 72.4,
  plannedStart,
  plannedEnd,
  progress: 40,
  itLeadName: 'Bob Durand',
  businessLeadName: 'Chloé Blanc',
});

const request = (ref: string, createdOn: string, targetDeliveryDate: string | null = null) => ({
  ref,
  itemPath: `/portfolio/requests/${ref}/summary`,
  name: `Request ${ref}`,
  status: 'pending_review',
  sourceName: 'Business',
  createdOn,
  targetDeliveryDate,
  requestorName: 'Denis Roux',
});

const report = (overrides: Partial<UpcomingReportData> = {}): UpcomingReportData => ({
  asOf: '2026-09-22',
  tasks: { horizonDays: 14, until: '2026-10-06', overdueCount: 5, rows: [task('T-4', '2026-09-24'), task('T-9', '2026-10-01')] },
  projectEnds: { horizonDays: 30, until: '2026-10-22', passedCount: 2, rows: [project('PRJ-3', '2026-10-10')] },
  projectStarts: { horizonDays: 30, until: '2026-10-22', rows: [] },
  pendingRequests: { thresholdDays: 30, createdBefore: '2026-08-24', rows: [request('REQ-7', '2026-07-01')] },
  requestDeliveries: { horizonDays: 30, until: '2026-10-22', rows: [request('REQ-8', '2026-09-01', '2026-10-15')] },
  ...overrides,
});

const PROJECT_TEAM_VALUES = {
  projects: [{ id: 'p-1', ref: 'PRJ-3', name: 'Cellar probes', status: 'in_progress' }],
  teams: [{ id: 'team-1', name: 'Business applications' }],
};

function mockApi(data: unknown) {
  get.mockImplementation((url: string) =>
    Promise.resolve({ data: url === '/portfolio/reports/filter-values' ? PROJECT_TEAM_VALUES : data }),
  );
}

const reportCalls = () =>
  get.mock.calls
    .filter(([url]: any[]) => url === '/portfolio/reports/upcoming')
    .map((call: any[]) => call[1]?.params);

function renderReport(entry = '/portfolio/reports/upcoming') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeModeProvider>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter initialEntries={[entry]}>
            <UpcomingReport />
          </MemoryRouter>
        </ThemeProvider>
      </ThemeModeProvider>
    </QueryClientProvider>,
  );
}

/** The list a link opens: its path, scope parameter and decoded filter model. */
const linkOf = (element: Element | null | undefined) => {
  const anchor = element?.closest('a') ?? element?.querySelector('a');
  const href = anchor?.getAttribute('href') ?? '';
  const [path, search] = href.split('?');
  const params = new URLSearchParams(search);
  return { href, path, params, filters: JSON.parse(params.get('filters') ?? '{}') };
};

const section = (key: string) => screen.getByTestId(`upcoming-${key}`);
const countLink = (key: string) => linkOf(screen.getByTestId(`upcoming-${key}-count`));

const OPEN_TASKS = ['open', 'in_progress', 'pending', 'in_testing'];
const OPEN_PROJECTS = ['waiting_list', 'planned', 'in_progress', 'in_testing', 'on_hold'];
const OPEN_REQUESTS = ['pending_review', 'candidate', 'approved', 'on_hold'];

beforeEach(() => {
  get.mockReset();
  try {
    window.localStorage.clear();
  } catch {
    // jsdom without storage still runs the specs on the default horizons.
  }
});

describe('UpcomingReport', () => {
  it('shows the five sections in order, each with its figure', async () => {
    mockApi(report());
    renderReport();

    await screen.findByText('Tasks due');
    const titles = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(titles).toEqual([
      'Planned project ends',
      'Planned project starts',
      'Requests awaiting review',
      'Requested deliveries',
      'Tasks due',
    ]);
    expect(within(screen.getByTestId('upcoming-tasks-count')).getByText('2')).toBeTruthy();
    expect(within(section('tasks')).getByText('Within the next 14 days')).toBeTruthy();
    expect(within(section('pendingRequests')).getByText('For more than 30 days')).toBeTruthy();
    expect(within(section('tasks')).getByText('T-4')).toBeTruthy();
    // Tasks carry their status like the project and request grids: a dot and its label.
    const taskHeaders = within(section('tasks')).getAllByRole('columnheader').map((node) => node.textContent?.trim());
    expect(taskHeaders.indexOf('Status')).toBe(taskHeaders.indexOf('Priority') + 1);
    expect(within(section('tasks')).getAllByText('Open').length).toBeGreaterThan(0);
  });

  it('shows a shipped task type in the reader\'s language until the tenant renames it', async () => {
    mockApi(report({
      tasks: {
        horizonDays: 14,
        until: '2026-10-06',
        overdueCount: 0,
        rows: [
          { ...task('T-4', '2026-09-24'), taskTypeName: 'Incident', taskTypeCode: 'incident' },
          { ...task('T-5', '2026-09-25'), taskTypeName: 'Ticket', taskTypeCode: 'task' },
          { ...task('T-6', '2026-09-26'), taskTypeName: 'Bug', taskTypeCode: null },
        ],
      } as any,
    }));
    await i18n.changeLanguage('de');
    try {
      renderReport();
      await waitFor(() => expect(within(section('tasks')).getByText('Vorfall')).toBeTruthy());
      expect(within(section('tasks')).getByText('Ticket')).toBeTruthy();
      expect(within(section('tasks')).queryByText('Incident')).toBeNull();
      expect(within(section('tasks')).getByText('Bug')).toBeTruthy();
    } finally {
      await i18n.changeLanguage('en');
    }
  });

  it('sends the default horizons and the viewer zone', async () => {
    mockApi(report());
    renderReport();
    await screen.findByText('Tasks due');
    const params = reportCalls()[0];
    expect(params).toMatchObject({ taskDays: 14, projectDays: 30, requestDays: 30 });
    expect(typeof params.tz).toBe('string');
    expect(params.projectIds).toBeUndefined();
    expect(params.teamIds).toBeUndefined();
  });

  it('changes and remembers a horizon', async () => {
    mockApi(report());
    renderReport();
    await screen.findByText('Tasks due');

    fireEvent.click(within(section('tasks')).getByRole('tab', { name: '30 days' }));
    await waitFor(() => expect(reportCalls().some((params) => params.taskDays === 30)).toBe(true));
    expect(window.localStorage.getItem(horizonStorageKey('taskDays'))).toBe('30');

    fireEvent.click(within(section('pendingRequests')).getByRole('tab', { name: '60 days' }));
    await waitFor(() => expect(reportCalls().some((params) => params.requestDays === 60)).toBe(true));
    expect(window.localStorage.getItem(horizonStorageKey('requestDays'))).toBe('60');

    // Starts and deliveries read the project horizon: every selector of it moves together.
    fireEvent.click(within(section('projectStarts')).getByRole('tab', { name: '90 days' }));
    await waitFor(() => expect(reportCalls().some((params) => params.projectDays === 90)).toBe(true));
    expect(within(section('projectEnds')).getByRole('tab', { name: '90 days' }).getAttribute('aria-selected')).toBe('true');
    expect(window.localStorage.getItem(horizonStorageKey('projectDays'))).toBe('90');
  });

  it('opens a remembered horizon', async () => {
    window.localStorage.setItem(horizonStorageKey('taskDays'), '7');
    window.localStorage.setItem(horizonStorageKey('projectDays'), '45');
    mockApi(report());
    renderReport();
    await screen.findByText('Tasks due');
    expect(reportCalls()[0]).toMatchObject({ taskDays: 7, projectDays: 30 });
  });

  it('links every figure to the list with exact, inclusive bounds', async () => {
    mockApi(report());
    renderReport();
    await screen.findByText('Tasks due');

    const tasks = countLink('tasks');
    expect(tasks.path).toBe('/portfolio/tasks');
    expect(tasks.params.get('taskScope')).toBe('all');
    expect(tasks.filters.status.values).toEqual(OPEN_TASKS);
    expect(tasks.filters.related_object_type.values).toEqual([null, 'project']);
    expect(tasks.filters.due_date).toEqual({ filterType: 'date', type: 'inRange', dateFrom: '2026-09-22', dateTo: '2026-10-06' });

    const overdue = linkOf(within(section('tasks')).getByText('5 tasks already overdue'));
    expect(overdue.filters.due_date).toEqual({ filterType: 'date', type: 'lessThan', dateFrom: '2026-09-22' });
    expect(overdue.filters.status.values).toEqual(OPEN_TASKS);

    const ends = countLink('projectEnds');
    expect(ends.path).toBe('/portfolio/projects');
    expect(ends.filters.status.values).toEqual(OPEN_PROJECTS);
    expect(ends.filters.planned_end).toEqual({ filterType: 'date', type: 'inRange', dateFrom: '2026-09-22', dateTo: '2026-10-22' });
    expect(linkOf(within(section('projectEnds')).getByText('2 planned ends already passed')).path).toBe('/portfolio/reports/flow');

    const pending = countLink('pendingRequests');
    expect(pending.path).toBe('/portfolio/requests');
    expect(pending.filters.status.values).toEqual(['pending_review']);
    // Created on or before 2026-08-23, read by the grid as "before the next day".
    expect(pending.filters.created_at).toEqual({ filterType: 'date', type: 'lessThan', dateFrom: '2026-08-24' });

    const deliveries = countLink('requestDeliveries');
    expect(deliveries.filters.status.values).toEqual(OPEN_REQUESTS);
    expect(deliveries.filters.target_delivery_date).toEqual({
      filterType: 'date',
      type: 'inRange',
      dateFrom: '2026-09-22',
      dateTo: '2026-10-22',
    });
  });

  it('shows an empty section as one line, with no figure link and no grid', async () => {
    mockApi(report());
    renderReport();
    await screen.findByText('Tasks due');
    const starts = section('projectStarts');
    expect(within(starts).getByText('No planned start')).toBeTruthy();
    expect(within(screen.getByTestId('upcoming-projectStarts-count')).queryByRole('link')).toBeNull();
    expect(starts.querySelector('.ag-root-wrapper')).toBeNull();
  });

  it('sends the project and team filters and carries them in every link', async () => {
    mockApi(report());
    renderReport('/portfolio/reports/upcoming?projectIds=p-1&teamIds=team-1');
    await screen.findByText('Tasks due');

    expect(reportCalls()[0]).toMatchObject({ projectIds: 'p-1', teamIds: 'team-1' });

    const tasks = countLink('tasks');
    expect(tasks.filters.related_object_type.values).toEqual(['project']);
    expect(tasks.filters.related_object_id.values).toEqual(['p-1']);
    expect(tasks.filters.assignee_team_id.values).toEqual(['team-1']);

    const starts = linkOf(within(section('projectEnds')).getByText('2 planned ends already passed'));
    expect(starts.params.get('projectIds')).toBe('p-1');
    expect(starts.params.get('teamIds')).toBe('team-1');

    const ends = countLink('projectEnds');
    expect(ends.filters.id.values).toEqual(['p-1']);
    expect(ends.filters.involved_team_id.values).toEqual(['team-1']);

    const pending = countLink('pendingRequests');
    expect(pending.filters.linked_project_id.values).toEqual(['p-1']);
    expect(pending.filters.involved_team_id.values).toEqual(['team-1']);
  });

  it('folds a section and remembers it', async () => {
    mockApi(report());
    renderReport();
    await screen.findByText('Tasks due');
    const toggle = within(section('tasks')).getByRole('button', { name: 'Tasks due' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(window.localStorage.getItem('kanap.portfolioReports.upcoming.collapsed.tasks')).toBe('1');
  });
});
