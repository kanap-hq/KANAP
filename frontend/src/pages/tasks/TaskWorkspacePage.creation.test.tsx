import { StrictMode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import NavigationTracker, { resetNavigationTracker } from '../../components/navigation/NavigationTracker';
import { resetCreationStore } from '../../components/workspace/creation/creationStore';
import { clearCreationFieldFocus } from '../../components/workspace/creation/creationFieldFocus';
import api from '../../api';
import TaskWorkspacePage from './TaskWorkspacePage';

// Creation at the title (lot V4): the title committed in the header creates the task through the
// route of its relation, with the defaults of the former creation form; the page moves to it with
// its properties panel open, and "Cancel" deletes it while the person stays.

const translation = {
  t: (key: string, opts?: unknown) => {
    const values = opts && typeof opts === 'object' ? opts as Record<string, unknown> : null;
    const args = values ? Object.entries(values).filter(([k]) => k !== 'defaultValue').map(([k, v]) => `${k}=${v}`).join(',') : '';
    return args ? `${key}(${args})` : key;
  },
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => undefined } }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const auth = vi.hoisted(() => ({ admin: false }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: (_resource: string, level: string) => auth.admin || level !== 'admin', profile: { id: 'user-1', first_name: 'Ada', last_name: 'Lovelace' } }),
}));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'acme' }) }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../hooks/useTaskNav', () => ({
  useTaskNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../../hooks/useClassificationDefaults', () => ({
  useClassificationDefaults: () => ({ data: { source_id: 'src-1', category_id: 'cat-1', stream_id: 'str-1', company_id: 'co-1' }, isLoading: false }),
}));
vi.mock('../../utils/taskTypeLocalization', () => ({
  localizeTaskType: (type: unknown) => type,
  taskTypeLabel: (name: string | null | undefined) => name ?? '',
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('./components/TaskPropertiesDrawer', () => ({
  default: (props: { task: { related_object_name?: string | null } | null }) => (
    <aside data-creation-panel="properties" data-testid="task-properties">
      {`related:${props.task?.related_object_name ?? ''}`}
      <input aria-label="related to" />
    </aside>
  ),
}));
vi.mock('./components/TaskActivity', () => ({ default: () => <div data-testid="task-activity" /> }));
vi.mock('./components/TaskAttachments', () => ({ default: () => null }));
vi.mock('./components/ConvertToRequestDialog', () => ({ default: () => null }));
vi.mock('../../components/MarkdownEditor', () => ({ default: () => <div data-testid="task-description" contentEditable suppressContentEditableWarning /> }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/workspace/MetadataUserPicker', () => ({
  default: (props: { label: string; displayName: string | null }) => <span>{`${props.label}: ${props.displayName ?? ''}`}</span>,
  formatMetadataUserName: (user: { first_name?: string; last_name?: string } | null) => (user ? `${user.first_name} ${user.last_name}` : null),
}));
vi.mock('../../components/history/RecordHistoryTab', () => ({ default: () => null }));

const mocked = vi.mocked(api);
const TITLE = 'common:buttons.editTitle';
const PROJECT = { id: 'project-a', name: 'Project A', source_id: 'src-p', category_id: 'cat-p', stream_id: 'str-p', company_id: 'co-p' };
const created = { id: 'task-new', item_number: 9, title: 'Order cheese', status: 'open', priority_level: 'normal', priority_score: 0, creation_token: 'token-1' };

function detail(relation: { type: string | null; id: string | null; name: string | null }) {
  return {
    ...created,
    creation_token: undefined,
    description: null,
    priority_level: 'normal',
    priority_score: 0,
    task_type_id: 'type-task',
    assignee_user_id: 'user-1',
    creator_id: 'user-1',
    owner_ids: [],
    viewer_ids: [],
    labels: [],
    application_ids: [],
    asset_ids: [],
    applications: [],
    assets: [],
    related_object_type: relation.type,
    related_object_id: relation.id,
    related_object_name: relation.name,
    created_at: '2026-11-03T00:00:00Z',
    updated_at: '2026-11-03T00:00:00Z',
  };
}

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function StartPage() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate('/portfolio/tasks/new/overview')}>new task</button>;
}

function createLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, String(value)); },
    removeItem: (key: string) => { store.delete(key); },
    clear: () => store.clear(),
  };
}

function renderPage(
  entries: string[],
  options: {
    changes?: { fields: number; children: Record<string, number> };
    relation?: { type: string | null; id: string | null; name: string | null };
    taskTypes?: Promise<unknown>;
    /** Holds the project read until the test releases it, or rejects it. */
    projectRead?: Promise<typeof PROJECT> | 'error' | 'forbidden';
    /** What the project read answers, besides the project itself. */
    projectExtra?: Record<string, unknown>;
    /** Strict mode cancels the init effect and runs it again, as on dev. */
    strict?: boolean;
  } = {},
) {
  const changes = options.changes ?? { fields: 0, children: {} };
  const relation = options.relation ?? { type: null, id: null, name: null };
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/portfolio/classification/task-types') {
      return { data: await (options.taskTypes ?? Promise.resolve([{ id: 'type-task', code: 'task', name: 'Task', is_active: true }])) } as never;
    }
    if (url === '/portfolio/projects/project-a') {
      if (options.projectRead === 'error') throw new Error('forbidden');
      if (options.projectRead === 'forbidden') throw Object.assign(new Error('forbidden'), { response: { status: 403, data: {} } });
      return { data: { ...(options.projectRead ? await options.projectRead : PROJECT), ...options.projectExtra } } as never;
    }
    if (url === '/budget-lines/line-1') return { data: { id: 'line-1', item_number: 4, product_name: 'Cheese cellar' } } as never;
    if (url === '/tasks/T-9' || url === '/tasks/task-new') return { data: detail(relation) } as never;
    if (url.endsWith('/task-new/creation')) return { data: { changes } } as never;
    if (url.endsWith('/attachments') || url.endsWith('/tasks')) return { data: [] } as never;
    return { data: {} } as never;
  });
  mocked.post.mockImplementation(async () => ({ data: created }) as never);
  mocked.patch.mockResolvedValue({ data: {} } as never);
  mocked.delete.mockResolvedValue({ data: undefined } as never);
  const tree = (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={entries}>
            <NavigationTracker />
            <Location />
            <Routes>
              <Route path="/start" element={<StartPage />} />
              <Route path="/403" element={<div data-testid="access-denied" />} />
              <Route path="/portfolio/tasks" element={<div data-testid="task-list" />} />
              <Route path="/portfolio/projects/:id/:tab" element={<div data-testid="project-page" />} />
              <Route path="/portfolio/tasks/:id/:tab" element={<TaskWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
  return render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
}

function location() {
  return screen.getByTestId('location').textContent;
}

async function commitTitle() {
  const input = await screen.findByRole('textbox', { name: TITLE });
  fireEvent.change(input, { target: { value: 'Order cheese' } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

async function createOrderCheese(path = '/portfolio/tasks/T-9/overview') {
  await commitTitle();
  await waitFor(() => expect(location()).toBe(path));
}

describe('Task creation at the title', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    resetCreationStore();
    resetNavigationTracker();
    auth.admin = false;
    const storage = createLocalStorage();
    vi.stubGlobal('localStorage', storage);
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
    // A person who closed the properties panel on their tasks: it still opens on a creation.
    storage.setItem('kanap.taskDetail.drawerOpen', 'false');
    clearCreationFieldFocus();
  });

  it('opens with the title to type and the task to come dimmed, its properties panel open', async () => {
    renderPage(['/portfolio/tasks/new/overview']);
    const input = await screen.findByRole('textbox', { name: TITLE });
    expect(input).toHaveFocus();
    expect(input).toHaveAttribute('placeholder', 'portfolio:workspace.task.title.placeholder');
    // Create and Cancel in place of the close button.
    expect(screen.getByRole('button', { name: 'common:buttons.create' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.close' })).toBeNull();
    for (const tab of screen.getAllByRole('tab')) expect(tab).toBeDisabled();

    // The metadata, the description and the properties panel of an empty task, out of reach.
    // The description editor loads on its own.
    await screen.findByTestId('task-description');
    const previews = screen.getAllByTestId('creation-preview');
    expect(previews.some((preview) => within(preview).queryByTestId('task-description'))).toBe(true);
    expect(previews.some((preview) => within(preview).queryByTestId('task-properties'))).toBe(true);
    for (const preview of previews) {
      expect(preview).toHaveAttribute('inert');
      expect(within(preview).queryAllByRole('textbox')).toHaveLength(0);
    }
    // Nothing written for a task that does not exist yet.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const urls = mocked.get.mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => /undefined|null|\/\/|\/tasks\/new\b/.test(url))).toEqual([]);
    expect(mocked.post).not.toHaveBeenCalled();
    expect(mocked.patch).not.toHaveBeenCalled();
  });

  it('takes Ctrl+S as Create: the empty title is asked for, nothing created', async () => {
    renderPage(['/portfolio/tasks/new/overview']);
    const input = await screen.findByRole('textbox', { name: TITLE });
    fireEvent.keyDown(input, { key: 's', ctrlKey: true });
    expect(await screen.findByText('common:creation.titleRequired')).toBeTruthy();
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('creates a standalone task with the defaults, then opens it with its properties panel', async () => {
    renderPage(['/portfolio/tasks/new/overview']);
    await createOrderCheese();
    expect(mocked.post).toHaveBeenCalledTimes(1);
    expect(mocked.post).toHaveBeenCalledWith('/tasks/standalone', expect.objectContaining({
      title: 'Order cheese',
      status: 'open',
      priority_level: 'normal',
      assignee_user_id: 'user-1',
      creator_id: 'user-1',
      task_type_id: 'type-task',
      source_id: 'src-1',
      category_id: 'cat-1',
      stream_id: 'str-1',
      company_id: 'co-1',
    }));
    expect(await screen.findByRole('button', { name: TITLE })).toHaveTextContent('Order cheese');
    for (const tab of screen.getAllByRole('tab')) expect(tab).not.toBeDisabled();
    expect(screen.queryByTestId('creation-preview')).toBeNull();
    expect(screen.getByTestId('task-properties')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
  });

  it('waits for the task types before creating', async () => {
    let release: (value: unknown) => void = () => undefined;
    const taskTypes = new Promise((resolve) => { release = resolve; });
    renderPage(['/portfolio/tasks/new/overview'], { taskTypes });
    await commitTitle();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocked.post).not.toHaveBeenCalled();
    release([{ id: 'type-task', code: 'task', name: 'Task', is_active: true }]);
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][1]).toMatchObject({ title: 'Order cheese', task_type_id: 'type-task' });
  });

  it('creates a project task with the project classification, and cancels it on the project route', async () => {
    const relation = { type: 'project', id: 'project-a', name: 'Project A' };
    renderPage(['/portfolio/tasks/new/overview?projectId=project-a&projectTab=tasks'], { relation });
    await createOrderCheese('/portfolio/tasks/T-9/overview?projectId=project-a&projectTab=tasks');
    expect(mocked.post).toHaveBeenCalledWith('/portfolio/projects/project-a/tasks', expect.objectContaining({
      title: 'Order cheese', source_id: 'src-p', category_id: 'cat-p', stream_id: 'str-p', company_id: 'co-p',
    }));
    await waitFor(() => expect(screen.getByTestId('task-properties')).toHaveTextContent('related:Project A'));
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.cancel' }));
    await waitFor(() => expect(location()).toBe('/portfolio/projects/project-a/tasks'));
    expect(mocked.get).toHaveBeenCalledWith('/portfolio/projects/project-a/tasks/task-new/creation', { params: { token: 'token-1' } });
    expect(mocked.delete).toHaveBeenCalledWith('/portfolio/projects/project-a/tasks/task-new/creation', { data: { token: 'token-1' } });
  });

  it('opens on a project the person contributes to', async () => {
    renderPage(['/portfolio/tasks/new/overview?projectId=project-a&projectTab=tasks'], { projectExtra: { can_contribute: true } });
    expect(await screen.findByRole('textbox', { name: TITLE })).toBeInTheDocument();
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/portfolio/projects/project-a'));
    expect(location()).toBe('/portfolio/tasks/new/overview?projectId=project-a&projectTab=tasks');
  });

  it('leads to the access denied page on a project the person only reads, nothing created', async () => {
    renderPage(['/portfolio/tasks/new/overview?projectId=project-a&projectTab=tasks'], { projectExtra: { can_contribute: false } });
    await waitFor(() => expect(location()).toBe('/403'));
    expect(screen.getByTestId('access-denied')).toBeInTheDocument();
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('shows nothing of the new task while the project read is pending, then leads to access denied', async () => {
    let release: (project: typeof PROJECT) => void = () => undefined;
    const projectRead = new Promise<typeof PROJECT>((resolve) => { release = resolve; });
    renderPage(['/portfolio/tasks/new/overview?projectId=project-a&projectTab=tasks'], { projectRead, projectExtra: { can_contribute: false } });
    expect(await screen.findByText('portfolio:workspace.task.messages.loading')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: TITLE })).toBeNull();
    expect(screen.queryByTestId('task-properties')).toBeNull();
    release(PROJECT);
    await waitFor(() => expect(location()).toBe('/403'));
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('leads to the access denied page when the project read is refused', async () => {
    renderPage(['/portfolio/tasks/new/overview?projectId=project-a&projectTab=tasks'], { projectRead: 'forbidden' });
    await waitFor(() => expect(location()).toBe('/403'));
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('shows the project name in the preview when its read answers after a re-render', async () => {
    let release: (project: typeof PROJECT) => void = () => undefined;
    const projectRead = new Promise<typeof PROJECT>((resolve) => { release = resolve; });
    renderPage(['/portfolio/tasks/new/overview?projectId=project-a&projectTab=tasks'], {
      strict: true,
      projectRead,
    });
    // The init effect has been cancelled by the strict re-render; the read is still pending: the
    // page waits, nothing of the new task shows.
    expect(await screen.findByText('portfolio:workspace.task.messages.loading')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: TITLE })).toBeNull();
    expect(screen.queryByTestId('task-properties')).toBeNull();
    release(PROJECT);
    await waitFor(() => expect(screen.getByTestId('task-properties')).toHaveTextContent('related:Project A'));
  });

  it('shows the type label in the preview when the project cannot be read', async () => {
    renderPage(['/portfolio/tasks/new/overview?projectId=project-a&projectTab=tasks'], { projectRead: 'error' });
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/portfolio/projects/project-a'));
    await waitFor(() => expect(screen.getByTestId('task-properties')).toHaveTextContent('related:portfolio:context.project'));
  });

  it('creates a task of a budget line on its route, without a classification', async () => {
    renderPage(['/portfolio/tasks/new/overview?spendItemId=line-1'], { relation: { type: 'spend_item', id: 'line-1', name: 'Cheese cellar' } });
    await commitTitle();
    await waitFor(() => expect(mocked.post).toHaveBeenCalledTimes(1));
    expect(mocked.post.mock.calls[0][0]).toBe('/spend-items/line-1/tasks');
    expect(mocked.post.mock.calls[0][1]).not.toHaveProperty('source_id');
  });

  it('cancels a creation with only its title at once, and goes back where it started', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new task' }));
    await createOrderCheese();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.cancel' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.get).toHaveBeenCalledWith('/tasks/task-new/creation', { params: { token: 'token-1' } });
    expect(mocked.delete).toHaveBeenCalledWith('/tasks/task-new/creation', { data: { token: 'token-1' } });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks before cancelling a creation that holds more than its title', async () => {
    renderPage(['/portfolio/tasks/new/overview'], { changes: { fields: 1, children: { comment: 2 } } });
    await createOrderCheese();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.cancel' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/common:creation\.confirmMessage/).textContent).toContain(
      'changes=common:creation.changes.fields(count=1), common:creation.changes.comments(count=2)',
    );
    fireEvent.click(within(dialog).getByRole('button', { name: 'common:buttons.delete' }));
    await waitFor(() => expect(location()).toBe('/portfolio/tasks'));
    expect(mocked.delete).toHaveBeenCalledWith('/tasks/task-new/creation', { data: { token: 'token-1' } });
  });

  it('leaves an empty new task on Escape, to the previous address', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new task' }));
    const input = await screen.findByRole('textbox', { name: TITLE });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.post).not.toHaveBeenCalled();
  });

  it('shows the error under the empty title on Create and gives it the focus, nothing created', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new task' }));
    await screen.findByRole('textbox', { name: TITLE });
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.create' }));
    expect(await screen.findByText('common:creation.titleRequired')).toBeTruthy();
    await waitFor(() => expect(screen.getByRole('textbox', { name: TITLE })).toHaveFocus());
    expect(mocked.post).not.toHaveBeenCalled();
    expect(location()).not.toBe('/start');
  });

  it('shows no Delete beside Cancel while the task is being created', async () => {
    auth.admin = true;
    renderPage(['/portfolio/tasks/new/overview']);
    await createOrderCheese();
    expect(await screen.findByRole('button', { name: 'common:buttons.cancel' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'common:buttons.delete' })).toBeNull();
  });

  it('keeps the task being created and closes it on Create, back where the creation started', async () => {
    renderPage(['/start']);
    fireEvent.click(await screen.findByRole('button', { name: 'new task' }));
    await createOrderCheese();
    fireEvent.click(await screen.findByRole('button', { name: 'common:buttons.create' }));
    await waitFor(() => expect(location()).toBe('/start'));
    expect(mocked.delete).not.toHaveBeenCalled();
    expect(mocked.post).toHaveBeenCalledTimes(1);
  });

  it('sends Tab from the title to the description, and Shift+Tab reaches Create', async () => {
    const user = userEvent.setup();
    renderPage(['/portfolio/tasks/new/overview']);
    const input = await screen.findByRole('textbox', { name: TITLE });
    await user.type(input, 'Order cheese');
    await user.tab();
    await waitFor(() => expect(location()).toBe('/portfolio/tasks/T-9/overview'));
    // Nothing is required: the description takes the focus once the task is open.
    await waitFor(() => expect(document.activeElement?.closest('[data-creation-description]')).toBeTruthy());
    expect(document.activeElement).toHaveAttribute('data-testid', 'task-description');
    expect(screen.getByRole('button', { name: 'common:buttons.cancel' })).not.toHaveFocus();
    const create = screen.getByRole('button', { name: 'common:buttons.create' });
    for (let i = 0; i < 20 && document.activeElement !== create; i += 1) {
      await user.tab({ shift: true });
    }
    expect(create).toHaveFocus();
  });
});
