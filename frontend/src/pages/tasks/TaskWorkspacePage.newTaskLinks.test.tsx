import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { KanapDialogProvider } from '../../components/design';
import { createAppTheme } from '../../config/ThemeContext';
import api from '../../api';
import i18n from '../../i18n';
import TaskWorkspacePage from './TaskWorkspacePage';

// A new task has no server row. The lists follow the same rule as an existing task:
// null (no field, no read) when the person does not read the module.

const access = vi.hoisted(() => ({ modules: new Set<string>(['tasks']) }));

vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => access.modules.has(resource) && level !== 'admin',
    profile: { id: 'user-1', first_name: 'Ada', last_name: 'Lovelace' },
  }),
}));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'acme' }) }));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('../../components/MarkdownEditor', () => ({ default: () => <div data-testid="task-description" /> }));
vi.mock('./components/TaskActivity', () => ({ default: () => <div data-testid="task-activity" /> }));
vi.mock('./components/TaskAttachments', () => ({ default: () => null }));
vi.mock('./components/ConvertToRequestDialog', () => ({ default: () => null }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/history/RecordHistoryTab', () => ({ default: () => null }));

const mocked = vi.mocked(api);

const PROJECT = {
  id: 'project-a',
  name: 'Project A',
  can_contribute: true,
  source_id: null,
  category_id: null,
  stream_id: null,
  company_id: null,
};

function getUrls(): string[] {
  return mocked.get.mock.calls.map((call) => String(call[0]));
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

function renderNewTask() {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === '/portfolio/projects/project-a') return { data: PROJECT } as never;
    if (url === '/portfolio/classification/task-types') {
      return { data: [{ id: 'type-task', code: 'task', name: 'Task', is_active: true }] } as never;
    }
    if (url === '/portfolio/classification/all') return { data: { sources: [], categories: [], streams: [] } } as never;
    if (url === '/portfolio/team-members/me') return { data: {} } as never;
    if (url === '/assets') return { data: { items: [{ id: 'asset-1', name: 'Cellar server' }] } } as never;
    if (url === '/applications') return { data: { items: [{ id: 'app-1', name: 'CheeseTrack' }] } } as never;
    if (url.endsWith('/phases')) return { data: [] } as never;
    return { data: { items: [] } } as never;
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={['/portfolio/tasks/new/overview?projectId=project-a']}>
            <Routes>
              <Route path="/portfolio/tasks/:id/:tab" element={<TaskWorkspacePage />} />
              <Route path="/403" element={<div data-testid="access-denied" />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

async function propertiesPanel(): Promise<HTMLElement> {
  await waitFor(() => expect(document.querySelector('[data-creation-panel="properties"]')).toBeTruthy());
  return document.querySelector('[data-creation-panel="properties"]') as HTMLElement;
}

describe('new task linked records', () => {
  beforeEach(async () => {
    cleanup();
    vi.clearAllMocks();
    access.modules = new Set(['tasks']);
    await i18n.changeLanguage('en');
    const storage = createLocalStorage();
    vi.stubGlobal('localStorage', storage);
    Object.defineProperty(window, 'localStorage', { value: storage, configurable: true });
  });

  it('hides assets and applications, and does not read them, without those rights', async () => {
    renderNewTask();
    const panel = await propertiesPanel();
    await waitFor(() => expect(getUrls()).toContain('/portfolio/classification/task-types'));
    expect(within(panel).queryByText('Assets')).toBeNull();
    expect(within(panel).queryByText('Applications')).toBeNull();
    expect(getUrls()).not.toContain('/assets');
    expect(getUrls()).not.toContain('/applications');
    expect(screen.queryByTestId('access-denied')).toBeNull();
  });

  it('shows assets and reads them when the person reads the infrastructure', async () => {
    access.modules = new Set(['tasks', 'infrastructure']);
    renderNewTask();
    const panel = await propertiesPanel();
    expect(await within(panel).findByText('Assets')).toBeTruthy();
    await waitFor(() => expect(getUrls()).toContain('/assets'));
    expect(within(panel).queryByText('Applications')).toBeNull();
    expect(getUrls()).not.toContain('/applications');
  });

  it('shows applications and reads them when the person reads applications', async () => {
    access.modules = new Set(['tasks', 'applications']);
    renderNewTask();
    const panel = await propertiesPanel();
    expect(await within(panel).findByText('Applications')).toBeTruthy();
    await waitFor(() => expect(getUrls()).toContain('/applications'));
    expect(within(panel).queryByText('Assets')).toBeNull();
    expect(getUrls()).not.toContain('/assets');
  });
});
