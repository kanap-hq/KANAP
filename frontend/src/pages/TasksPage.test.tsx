import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';
import CheckboxSetFilter from '../components/CheckboxSetFilter';
import TasksPage from './TasksPage';
import { ACTIVE_TASK_STATUSES } from './tasks/task.constants';

const deleteButton = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const auth = vi.hoisted(() => ({ write: true }));
const post = vi.hoisted(() => vi.fn());
const t = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (_area: string, level: string) => level === 'reader' || auth.write,
    profile: null,
    user: null,
  }),
}));
vi.mock('../api', () => ({
  default: {
    get: vi.fn(async (url: string) => (
      url === '/portfolio/classification/task-types' ? { data: [] } : { data: { items: [] } }
    )),
    post,
  },
}));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'fromage' }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    return null;
  },
}));
vi.mock('../components/csv', () => ({ CsvExportDialogV2: () => null, CsvImportDialogV2: () => null }));
vi.mock('../components/PageHeader', () => ({ default: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div> }));
vi.mock('../components/DeleteSelectedButton', () => ({
  default: (props: Record<string, any>) => {
    deleteButton.props = props;
    return null;
  },
}));

describe('TasksPage delete', () => {
  beforeEach(() => {
    auth.write = true;
    grid.props = null;
  });

  it('asks the delete check before its confirmation, and names the tasks in its words', async () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter><TasksPage /></MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    const props = deleteButton.props!;
    expect(props).not.toBeNull();
    const refused = [{ id: 'a', name: 'Origin', code: 'TASK_REQUEST_ORIGIN', usages: [], params: { reference: 'REQ-4' } }];
    post.mockResolvedValueOnce({ data: { refused } });
    expect(await props.checkDelete(['a', 'b'])).toEqual({ refused });
    expect(post).toHaveBeenCalledWith('/tasks/delete-check', { ids: ['a', 'b'] });
    expect(String(props.itemLabels.toDelete(2))).toBe('tasks.delete.toDelete');
    expect(String(props.itemLabels.kept(1))).toBe('tasks.delete.kept');
  });

  it('says the list is empty in one line, with the creation for someone who may create', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter><TasksPage /></MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    const emptyState = grid.props?.emptyState as React.ReactElement;
    render(<ThemeProvider theme={createAppTheme('light')}>{emptyState}</ThemeProvider>);
    const empty = screen.getByTestId('tasks-empty');
    expect(empty.textContent).toContain('tasks.empty');
    expect(empty.querySelector('button')?.textContent).toBe('tasks.actions.new');
  });

  it('names by their label the types and contexts a restored filter selects and no task has', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter><TasksPage /></MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    const column = (field: string) => (grid.props?.columns as Array<Record<string, any>>).find((c) => c.field === field)!;
    const context = column('related_object_type').filterParams.labelFormatter;
    expect(context('contract')).toBe('context.contract');
    expect(context(null)).toBe('tasks.values.standalone');
    const type = column('task_type_name').filterParams.labelFormatter;
    expect(type('Unknown type')).toBe('Unknown type');
    expect(type(null)).toBe('shared.blankValue');
  });

  function statusCell(value: unknown) {
    const column = (grid.props?.columns as Array<Record<string, any>>).find((c) => c.field === 'status')!;
    const view = render(
      <ThemeProvider theme={createAppTheme('light')}>
        {column.cellRenderer({ value, data: value == null ? undefined : { id: 'row-1', status: value } })}
      </ThemeProvider>,
    );
    const result = { text: view.container.textContent ?? '', html: view.container.innerHTML };
    view.unmount();
    return result;
  }

  it('leaves the status cell empty when the row has no status', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter><TasksPage /></MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    for (const value of [undefined, null, '']) {
      const cell = statusCell(value);
      expect(cell.text).toBe('');
      expect(cell.html).toBe('');
    }
    const open = statusCell('open');
    expect(open.text).toBe('statuses.task.open');
    expect(open.html).not.toBe('');
  });

  it('leaves the creation out of the empty list for a reader', () => {
    auth.write = false;
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter><TasksPage /></MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    const emptyState = grid.props?.emptyState as React.ReactElement;
    render(<ThemeProvider theme={createAppTheme('light')}>{emptyState}</ThemeProvider>);
    expect(screen.getByTestId('tasks-empty').textContent).toBe('tasks.empty');
    expect(screen.getByTestId('tasks-empty').querySelector('button')).toBeNull();
  });
});

function renderTasks(search = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/tasks${search}`]}><TasksPage /></MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

/** The filters of the address a task's link opens, once the list has reported `filterModel`. */
function taskLinkFilters(filterModel: Record<string, unknown>) {
  act(() => grid.props!.onQueryStateChange({ sort: 'priority_score:DESC', q: '', filterModel }));
  const column = (grid.props!.columns as Array<Record<string, any>>).find((c) => c.field === 'item_number')!;
  const view = render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter>
        {column.cellRenderer({
          value: 4,
          valueFormatted: 'T-4',
          data: { id: 'row-1', item_number: 4, title: 'Origin' },
        })}
      </MemoryRouter>
    </ThemeProvider>,
  );
  const href = view.getByRole('link', { name: 'T-4' }).getAttribute('href')!;
  view.unmount();
  const filters = new URLSearchParams(href.split('?')[1] ?? '').get('filters');
  return filters ? JSON.parse(filters) : null;
}

describe('TasksPage default status filter', () => {
  beforeEach(() => {
    grid.props = null;
  });

  it('opens on the active statuses when the address names none', () => {
    const view = renderTasks();
    expect(grid.props!.initialState.filter.filterModel.status.values).toEqual(ACTIVE_TASK_STATUSES);
    view.unmount();
  });

  it('keeps a cleared status filter cleared when the address says so', () => {
    const view = renderTasks(`?filters=${encodeURIComponent(JSON.stringify({ status: null }))}`);
    expect(grid.props!.initialState.filter.filterModel.status).toBeNull();
    view.unmount();
  });

  it('opens a task with the status filter cleared, so the list comes back without it', () => {
    const view = renderTasks();
    expect(taskLinkFilters({})).toEqual({ status: null });
    view.unmount();
  });

  it('opens a task with the status filter the person chose, including every status and none', () => {
    const view = renderTasks();
    const chosen = { filterType: 'set', values: ['done'] };
    expect(taskLinkFilters({ status: chosen }).status).toEqual(chosen);
    const every = { filterType: 'set', values: ['open', 'in_progress', 'pending', 'in_testing', 'done', 'cancelled'] };
    expect(taskLinkFilters({ status: every }).status).toEqual(every);
    const none = { filterType: 'set', values: [] as string[] };
    expect(taskLinkFilters({ status: none }).status).toEqual(none);
    view.unmount();
  });

  it('names a selected status the list does not return, including pending and in testing', async () => {
    const view = renderTasks();
    const column = (grid.props!.columns as Array<Record<string, any>>).find((c) => c.field === 'status')!;
    const filterRef = React.createRef<any>();
    const model = { status: { filterType: 'set', values: ['open', 'pending', 'in_testing'] } };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const filter = render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <CheckboxSetFilter
            ref={filterRef}
            {...({
              api: { getFilterModel: () => model, setFilterModel: vi.fn() },
              column: { getColId: () => 'status' },
              colDef: { field: 'status' },
              context: { getQueryState: () => ({}) },
              ...column.filterParams,
              getValues: async () => [{ value: 'open', label: 'statuses.task.open' }],
            } as any)}
          />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    act(() => { filterRef.current.afterGuiAttached(); });
    expect(await screen.findByRole('checkbox', { name: 'statuses.task.open' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'pending' })).toBeNull();
    expect(screen.queryByRole('checkbox', { name: 'in_testing' })).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'statuses.task.pending' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'statuses.task.in_testing' })).toBeInTheDocument();
    filter.unmount();
    view.unmount();
  });
});
