import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import api from '../../api';
import TaskWorkspacePage from './TaskWorkspacePage';

// A task's address names it by its reference (`T-9`): an address by uuid moves to it through the
// router, and stays there through a tab change and a step back. The way back to its project, the
// project link and the parent breadcrumb name the project by its reference too.

const translation = {
  t: (key: string) => key,
  i18n: { language: 'en', resolvedLanguage: 'en' },
};
vi.mock('react-i18next', () => ({ useTranslation: () => translation, initReactI18next: { type: '3rdParty', init: () => undefined } }));
vi.mock('../../api', () => ({ default: { get: vi.fn(), post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }),
}));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'acme' }) }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../hooks/useTaskNav', () => ({
  useTaskNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../../hooks/useClassificationDefaults', () => ({
  useClassificationDefaults: () => ({ data: null, isLoading: false }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('./components/TaskPropertiesDrawer', () => ({
  default: (props: { projectWorkspaceLink?: string | null }) => <aside data-testid="task-properties" data-project-link={props.projectWorkspaceLink ?? ''} />,
}));
vi.mock('./components/TaskActivity', () => ({ default: () => <div data-testid="task-activity" /> }));
vi.mock('./components/TaskAttachments', () => ({ default: () => null }));
vi.mock('./components/ConvertToRequestDialog', () => ({ default: () => null }));
vi.mock('../../components/MarkdownEditor', () => ({ default: () => <div data-testid="task-description" /> }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/workspace/MetadataUserPicker', () => ({
  default: () => null,
  formatMetadataUserName: () => null,
}));
vi.mock('../../components/history/RecordHistoryTab', () => ({ default: () => <div data-testid="task-history" /> }));

const mocked = vi.mocked(api);

const TASK = {
  id: 'f1e2d3c4-0000-4000-8000-000000000009',
  item_number: 9,
  title: 'Order cheese',
  description: null,
  status: 'open',
  priority_level: 'normal',
  priority_score: 0,
  task_type_id: null,
  assignee_user_id: 'user-1',
  creator_id: 'user-1',
  owner_ids: [],
  viewer_ids: [],
  labels: [],
  application_ids: [],
  asset_ids: [],
  applications: [],
  assets: [],
  related_object_type: 'project',
  related_object_id: 'a0b1c2d3-0000-4000-8000-000000000003',
  related_object_name: 'Cheese cellar',
  project_item_number: 3,
  phase_id: null,
  created_at: '2026-11-03T00:00:00Z',
  updated_at: '2026-11-03T00:00:00Z',
};

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function BackButton() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>step back</button>;
}

function renderPage(entries: string[], task: Record<string, unknown> = TASK) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === `/tasks/${TASK.id}` || url === '/tasks/T-9') return { data: task } as never;
    if (url.endsWith('/attachments') || url.endsWith('/tasks')) return { data: [] } as never;
    if (url.endsWith('/time-entries/sum')) return { data: { total: 0 } } as never;
    return { data: {} } as never;
  });
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
            <Location />
            <BackButton />
            <Routes>
              <Route path="/start" element={<div data-testid="start" />} />
              <Route path="/portfolio/tasks" element={<div data-testid="task-list" />} />
              <Route path="/portfolio/projects/:id/:tab" element={<div data-testid="project-page" />} />
              <Route path="/portfolio/tasks/:id" element={<TaskWorkspacePage />} />
              <Route path="/portfolio/tasks/:id/:tab" element={<TaskWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const location = () => screen.getByTestId('location').textContent;

describe('TaskWorkspacePage address', () => {
  beforeEach(() => {
    mocked.get.mockReset();
    try {
      window.localStorage.clear();
    } catch {
      // jsdom without storage: the page falls back to its defaults.
    }
  });

  it('moves an address by uuid to the reference, and keeps it through a tab change and a step back', async () => {
    renderPage(['/start', `/portfolio/tasks/${TASK.id}/overview?sort=title%3AASC`]);
    await waitFor(() => expect(location()).toBe('/portfolio/tasks/T-9/overview?sort=title%3AASC'));
    fireEvent.click(await screen.findByRole('tab', { name: 'portfolio:workspace.task.tabs.history' }));
    await waitFor(() => expect(location()).toBe('/portfolio/tasks/T-9/history?sort=title%3AASC'));
    expect(await screen.findByTestId('task-history')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'step back' }));
    await waitFor(() => expect(location()).toBe('/portfolio/tasks/T-9/overview?sort=title%3AASC'));
    // The step back reaches the page before the task, never the task's uuid address.
    fireEvent.click(screen.getByRole('button', { name: 'step back' }));
    await waitFor(() => expect(location()).toBe('/start'));
  });

  it('keeps the shape of an address without a tab', async () => {
    renderPage([`/portfolio/tasks/${TASK.id}`]);
    await waitFor(() => expect(location()).toBe('/portfolio/tasks/T-9'));
  });

  it('names the project by its reference in the project link, the panel link and the way back', async () => {
    renderPage([`/portfolio/tasks/T-9/overview?projectId=${TASK.related_object_id}&projectTab=tasks`]);
    const projectLink = await screen.findByTitle('Cheese cellar');
    expect(projectLink).toHaveAttribute('href', '/portfolio/projects/PRJ-3');
    fireEvent.click(screen.getByRole('button', { name: 'portfolio:workspace.openProperties' }));
    expect((await screen.findByTestId('task-properties')).dataset.projectLink).toBe('/portfolio/projects/PRJ-3/overview');
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    await waitFor(() => expect(location()).toBe('/portfolio/projects/PRJ-3/tasks'));
  });

  it('names the parent project by its reference in the breadcrumb', async () => {
    renderPage(['/portfolio/tasks/T-9/overview']);
    await waitFor(() => expect(screen.getAllByTitle('Cheese cellar')).toHaveLength(2));
    const hrefs = screen.getAllByTitle('Cheese cellar').map((link) => link.getAttribute('href')).sort();
    expect(hrefs).toEqual(['/portfolio/projects/PRJ-3', '/portfolio/projects/PRJ-3/summary']);
  });

  it('keeps the uuid of a project whose number the person does not read', async () => {
    renderPage(['/portfolio/tasks/T-9/overview'], { ...TASK, project_item_number: null });
    await waitFor(() => expect(screen.getAllByTitle('Cheese cellar')).toHaveLength(2));
    const hrefs = screen.getAllByTitle('Cheese cellar').map((link) => link.getAttribute('href')).sort();
    expect(hrefs).toEqual([`/portfolio/projects/${TASK.related_object_id}`, `/portfolio/projects/${TASK.related_object_id}/summary`]);
  });
});
