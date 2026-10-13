import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import ByAssigneeReport, { type AssigneeAttention } from './ByAssigneeReport';

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

const TASK_SCOPE = {
  status: { filterType: 'set', values: ['open', 'in_progress', 'pending', 'in_testing'] },
  related_object_type: { filterType: 'set', values: [null, 'project'] },
};

const report = (overrides: Partial<AssigneeAttention> = {}): AssigneeAttention => ({
  staleDays: 14,
  asOf: '2026-09-22',
  staleBefore: '2026-09-08',
  teams: [
    {
      teamId: 'team-1',
      teamName: 'Business applications',
      open: 13,
      overdue: 8,
      stale: 10,
      members: [
        { userId: 'u1', name: 'Alice Martin', contributorRef: 'CTR-12', open: 9, overdue: 5, stale: 6 },
        { userId: 'u2', name: 'Bob Durand', contributorRef: null, open: 4, overdue: 3, stale: 4 },
      ],
    },
    {
      teamId: null,
      teamName: null,
      open: 1,
      overdue: 0,
      stale: 1,
      members: [{ userId: 'u3', name: 'Chloé Blanc', contributorRef: null, open: 1, overdue: 0, stale: 1 }],
    },
  ],
  unassigned: { open: 3, overdue: 0, stale: 3 },
  totals: { open: 17, overdue: 8, stale: 14 },
  ...overrides,
});

const PROJECT_TEAM_VALUES = {
  projects: [
    { id: 'p-1', ref: 'PRJ-3', name: 'Cellar probes', status: 'in_progress' },
    { id: 'p-2', ref: 'PRJ-1', name: 'Old cave', status: 'done' },
  ],
  teams: [
    { id: 'team-1', name: 'Business applications' },
    { id: 'team-2', name: 'Infrastructure' },
  ],
};

/** The report on its own endpoint, the filter options on theirs. */
function mockApi(data: unknown) {
  get.mockImplementation((url: string) =>
    Promise.resolve({ data: url === '/portfolio/reports/filter-values' ? PROJECT_TEAM_VALUES : data }),
  );
}

/** The parameters of every call to the report endpoint, the filter options left aside. */
const reportCalls = () =>
  get.mock.calls
    .filter(([url]: any[]) => url === '/portfolio/reports/attention-by-assignee')
    .map((call: any[]) => call[1]?.params);

function renderReport(entry = '/portfolio/reports/by-assignee') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={[entry]}>
          <ByAssigneeReport />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

/** The filter model a figure links with, read back from its href. */
const filtersOf = (element: Element | null | undefined) => {
  const anchor = element?.closest('a') ?? element?.querySelector('a');
  const href = anchor?.getAttribute('href') ?? '';
  const [path, search] = href.split('?');
  const params = new URLSearchParams(search);
  return { path, scope: params.get('taskScope'), filters: JSON.parse(params.get('filters') ?? '{}') };
};

const rowOf = (label: string) => screen.getByText(label).closest('tr') as HTMLElement;

beforeEach(() => {
  get.mockReset();
  hasLevel.mockReset();
  hasLevel.mockReturnValue(true);
  try {
    window.localStorage.clear();
  } catch {
    // jsdom without storage still runs the specs on the default window.
  }
});

describe('ByAssigneeReport', () => {
  it('shows the report frame and no table while the first load is in flight', () => {
    get.mockReturnValue(new Promise(() => {}));
    renderReport();
    // The title carries the report name.
    expect(screen.getAllByText('Attention by contributor').length).toBeGreaterThan(0);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('shows the teams, their members and the sums of each group', async () => {
    mockApi(report());
    renderReport();

    expect(await screen.findByText('Business applications')).toBeTruthy();
    // The people without a team come last, under a plain label.
    expect(screen.getByText('No team')).toBeTruthy();
    expect(screen.getByText('Alice Martin')).toBeTruthy();
    expect(screen.getByText('Unassigned')).toBeTruthy();
    expect(screen.getByText('Total')).toBeTruthy();

    const team = rowOf('Business applications');
    expect(within(team).getByText('13')).toBeTruthy();
    expect(within(team).getByText('8')).toBeTruthy();
    expect(within(team).getByText('10')).toBeTruthy();

    // The header reads the same totals as the Total row.
    expect(screen.getByText('17 open')).toBeTruthy();
    expect(screen.getByText('8 overdue')).toBeTruthy();
    expect(screen.getByText('14 without movement')).toBeTruthy();
    expect(screen.getByText('3 unassigned')).toBeTruthy();
  });

  it('links each figure of a person to the list filtered on the same population', async () => {
    mockApi(report());
    renderReport();

    await screen.findByText('Alice Martin');
    const row = rowOf('Alice Martin');
    const open = filtersOf(within(row).getByText('9'));
    expect(open.path).toBe('/portfolio/tasks');
    expect(open.scope).toBe('all');
    expect(open.filters).toEqual({
      ...TASK_SCOPE,
      assignee_user_id: { filterType: 'set', values: ['u1'] },
    });

    expect(filtersOf(within(row).getByText('5')).filters).toEqual({
      ...TASK_SCOPE,
      assignee_user_id: { filterType: 'set', values: ['u1'] },
      due_date: { filterType: 'date', type: 'lessThan', dateFrom: '2026-09-22' },
    });

    expect(filtersOf(within(row).getByText('6')).filters).toEqual({
      ...TASK_SCOPE,
      assignee_user_id: { filterType: 'set', values: ['u1'] },
      updated_at: { filterType: 'date', type: 'lessThan', dateFrom: '2026-09-08' },
    });
  });

  it('links a team to every one of its members and the unassigned line to the empty value', async () => {
    mockApi(report());
    renderReport();

    await screen.findByText('Business applications');
    const team = rowOf('Business applications');
    expect(filtersOf(await within(team).findByText('13')).filters).toEqual({
      ...TASK_SCOPE,
      assignee_user_id: { filterType: 'set', values: ['u1', 'u2'] },
    });

    const unassigned = rowOf('Unassigned');
    // The open column, not the equally valued "no movement" one.
    expect(filtersOf(within(unassigned).getAllByRole('cell')[1]).filters).toEqual({
      ...TASK_SCOPE,
      assignee_user_id: { filterType: 'set', values: [null] },
    });
  });

  it('never links a zero', async () => {
    mockApi(report());
    renderReport();

    await screen.findByText('Unassigned');
    const unassigned = rowOf('Unassigned');
    expect(within(unassigned).getByText('0').closest('a')).toBeNull();
  });

  it('shows one line and nothing else when no task is open', async () => {
    mockApi(report({ teams: [], unassigned: { open: 0, overdue: 0, stale: 0 }, totals: { open: 0, overdue: 0, stale: 0 } }));
    renderReport();

    expect(await screen.findByText('No open task')).toBeTruthy();
    expect(screen.queryByText('Total')).toBeNull();
  });

  it('folds a team away', async () => {
    mockApi(report());
    renderReport();

    await screen.findByText('Alice Martin');
    fireEvent.click(screen.getByText('Business applications'));
    await waitFor(() => expect(screen.queryByText('Alice Martin')).toBeNull());
  });

  it('refetches with the window the user picks', async () => {
    mockApi(report());
    renderReport();

    await screen.findByText('Alice Martin');
    expect(reportCalls()[0]).toMatchObject({ staleDays: 14 });

    fireEvent.mouseDown(screen.getAllByRole('combobox')[0]);
    fireEvent.click(await screen.findByRole('option', { name: '7 days' }));
    await waitFor(() => expect(reportCalls().some((params) => params?.staleDays === 7)).toBe(true));
  });

  it('opens the contributor page from the reference of a member', async () => {
    mockApi(report());
    renderReport();
    expect((await screen.findByText('CTR-12')).getAttribute('href')).toBe('/portfolio/contributors/CTR-12');
  });

  it('drops the contributor reference for a reader of the reports alone', async () => {
    hasLevel.mockReturnValue(false);
    mockApi(report());
    renderReport();
    await screen.findByText('Alice Martin');
    expect(screen.queryByText('CTR-12')).toBeNull();
  });
  it('reads the projects and teams from the URL and carries them into every link', async () => {
    mockApi(report({ teams: [report().teams[0]], unassigned: { open: 0, overdue: 0, stale: 0 } }));
    renderReport('/portfolio/reports/by-assignee?projectIds=p-1&teamIds=team-1');

    await screen.findByText('Alice Martin');
    expect(reportCalls()[0]).toMatchObject({ projectIds: 'p-1', teamIds: 'team-1' });

    // A person's figure opens the task list on that person, that project and that team.
    const { path, filters } = filtersOf(within(rowOf('Alice Martin')).getByText('5'));
    expect(path).toBe('/portfolio/tasks');
    expect(filters).toEqual({
      ...TASK_SCOPE,
      related_object_type: { filterType: 'set', values: ['project'] },
      assignee_user_id: { filterType: 'set', values: ['u1'] },
      due_date: { filterType: 'date', type: 'lessThan', dateFrom: '2026-09-22' },
      related_object_id: { filterType: 'set', values: ['p-1'] },
      assignee_team_id: { filterType: 'set', values: ['team-1'] },
    });

    // Under a team filter no unassigned task can count: the line and its summary are gone.
    expect(screen.queryByText('Unassigned')).toBeNull();
    expect(screen.queryByText(/unassigned/i)).toBeNull();
  });

  it('sends the project and the team picked in the filter bar, and keeps the unassigned line under a project', async () => {
    mockApi(report());
    renderReport();
    await screen.findByText('Alice Martin');
    expect(reportCalls()[0].projectIds).toBeUndefined();

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Project' }));
    fireEvent.click(await screen.findByRole('option', { name: 'PRJ-3 · Cellar probes' }));
    await waitFor(() => expect(reportCalls()[reportCalls().length - 1].projectIds).toBe('p-1'));
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.getByText('Unassigned')).toBeTruthy();
    // The unassigned line keeps its own blank-assignee filter, narrowed to the project.
    const unassigned = filtersOf(within(rowOf('Unassigned')).getAllByText('3')[0]);
    expect(unassigned.filters.assignee_user_id).toEqual({ filterType: 'set', values: [null] });
    expect(unassigned.filters.related_object_id).toEqual({ filterType: 'set', values: ['p-1'] });

    fireEvent.mouseDown(screen.getByText('All teams'));
    fireEvent.click(await screen.findByRole('option', { name: 'Infrastructure' }));
    await waitFor(() => expect(reportCalls()[reportCalls().length - 1].teamIds).toBe('team-2'));
  });
});
