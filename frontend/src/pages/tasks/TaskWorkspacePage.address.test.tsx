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
  default: (props: {
    projectWorkspaceLink?: string | null;
    onRelationChange: (relation: { type: 'project'; id: string; name: string }) => void;
  }) => (
    <aside data-testid="task-properties" data-project-link={props.projectWorkspaceLink ?? ''}>
      <button type="button" onClick={() => props.onRelationChange({ type: 'project', id: OTHER_PROJECT, name: 'Tasting room' })}>
        move to another project
      </button>
    </aside>
  ),
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
const OTHER_PROJECT = 'b0b1c2d3-0000-4000-8000-000000000004';

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

function renderPage(entries: string[], task: Record<string, unknown> = TASK, reads: Record<string, unknown> = {}) {
  mocked.get.mockImplementation(async (url: string) => {
    if (url === `/tasks/${TASK.id}` || url === '/tasks/T-9') return { data: task } as never;
    if (url in reads) return { data: reads[url] } as never;
    if (url.endsWith('/attachments') || url.endsWith('/tasks')) return { data: [] } as never;
    if (url.endsWith('/time-entries/sum')) return { data: { total: 0 } } as never;
    return { data: {} } as never;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
            <Location />
            <BackButton />
            <Routes>
              <Route path="/start" element={<div data-testid="start" />} />
              <Route path="/portfolio/tasks" element={<div data-testid="task-list" />} />
              <Route path="/portfolio/projects/:id/:tab" element={<div data-testid="project-page" />} />
              <Route path="/ops/contracts/:id/:tab" element={<div data-testid="contract-page" />} />
              <Route path="/ops/budget/:ref/:tab" element={<div data-testid="budget-page" />} />
              <Route path="/it/incidents/:id/:tab" element={<div data-testid="incident-page" />} />
              <Route path="/portfolio/tasks/:id" element={<TaskWorkspacePage />} />
              <Route path="/portfolio/tasks/:id/:tab" element={<TaskWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...view, client };
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

  it('refreshes the project pages read under their reference when the task moves to another project', async () => {
    mocked.patch.mockResolvedValue({ data: { ...TASK, related_object_id: OTHER_PROJECT, related_object_name: 'Tasting room' } } as never);
    const { client } = renderPage(['/portfolio/tasks/T-9/overview']);
    // The page of the project the task leaves, read under its address.
    client.setQueryData(['portfolio-project', 'PRJ-3', 'summary'], { id: TASK.related_object_id, item_number: 3 });
    await screen.findAllByTitle('Cheese cellar');
    fireEvent.click(screen.getByRole('button', { name: 'portfolio:workspace.openProperties' }));
    fireEvent.click(await screen.findByRole('button', { name: 'move to another project' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalled());
    await waitFor(() => expect(client.getQueryState(['portfolio-project', 'PRJ-3', 'summary'])?.isInvalidated).toBe(true));
  });

  it('names the record it was opened from by its reference, and moves an address by uuid to it', async () => {
    const contractId = 'c0b1c2d3-0000-4000-8000-000000000002';
    const contractTask = { ...TASK, related_object_type: 'contract', related_object_id: contractId, related_object_name: 'CTR-2 · Cellar lease', project_item_number: null };
    renderPage([`/portfolio/tasks/${TASK.id}/overview?contractId=${contractId}&originTab=overview`], contractTask);
    // The task and the contract it was opened from move to their references in one step.
    await waitFor(() => expect(location()).toBe('/portfolio/tasks/T-9/overview?contractId=CTR-2&originTab=overview'));
    // The contract is known from the task: no read of its own, and its tasks are read by its uuid.
    expect(mocked.get).not.toHaveBeenCalledWith(`/contracts/${contractId}`);
    expect(mocked.get).not.toHaveBeenCalledWith('/contracts/CTR-2');
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith(`/contracts/${contractId}/tasks`));
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    await waitFor(() => expect(location()).toBe('/ops/contracts/CTR-2/overview'));
  });

  it('reads another record it was opened from by its reference, and goes back to it by its reference', async () => {
    renderPage(['/portfolio/tasks/T-9/overview?incidentId=INC-3&originTab=relations'], TASK, {
      '/incidents/INC-3': { id: 'i0b1c2d3-0000-4000-8000-000000000003', item_number: 3, title: 'Cellar flood' },
    });
    expect(await screen.findByRole('link', { name: /INC-3 · Cellar flood/ })).toHaveAttribute('href', '/it/incidents/INC-3/relations');
    await waitFor(() => expect(mocked.get).toHaveBeenCalledWith('/incidents/i0b1c2d3-0000-4000-8000-000000000003/tasks'));
    expect(location()).toBe('/portfolio/tasks/T-9/overview?incidentId=INC-3&originTab=relations');
  });

  it('moves the uuid of another record it was opened from to its reference once read', async () => {
    const lineId = 'd0b1c2d3-0000-4000-8000-000000000008';
    renderPage([`/portfolio/tasks/T-9/overview?spendItemId=${lineId}&originTab=budget`], TASK, {
      [`/budget-lines/${lineId}`]: { id: lineId, item_number: 8, product_name: 'Cheese wax' },
    });
    await waitFor(() => expect(location()).toBe('/portfolio/tasks/T-9/overview?spendItemId=BL-8&originTab=budget'));
    expect(await screen.findByRole('link', { name: /BL-8 · Cheese wax/ })).toHaveAttribute('href', '/ops/budget/BL-8/budget');
  });

  it('names the parent record by its reference in the breadcrumb, whatever its family', async () => {
    const incidentTask = { ...TASK, related_object_type: 'incident', related_object_id: 'i0b1c2d3-0000-4000-8000-000000000003', related_object_name: 'INC-3 · Cellar flood', project_item_number: null };
    renderPage(['/portfolio/tasks/T-9/overview'], incidentTask);
    expect(await screen.findByTitle('INC-3 · Cellar flood')).toHaveAttribute('href', '/it/incidents/INC-3/overview');
  });

  it('goes back to the project it was opened from by its reference once the task moved to another project', async () => {
    mocked.patch.mockResolvedValue({ data: {} } as never);
    renderPage([`/portfolio/tasks/T-9/overview?projectId=${TASK.related_object_id}&projectTab=tasks`], TASK, {
      '/portfolio/projects/PRJ-3': { id: TASK.related_object_id, item_number: 3, name: 'Cheese cellar' },
    });
    await waitFor(() => expect(location()).toBe('/portfolio/tasks/T-9/overview?projectId=PRJ-3&projectTab=tasks'));
    fireEvent.click(screen.getByRole('button', { name: 'portfolio:workspace.openProperties' }));
    fireEvent.click(await screen.findByRole('button', { name: 'move to another project' }));
    await waitFor(() => expect(mocked.patch).toHaveBeenCalledWith(`/tasks/${TASK.id}/move`, expect.anything()));
    // The way back still names the project the task left, by its reference.
    await waitFor(() => expect(screen.getByRole('link', { name: /Cheese cellar/ })).toHaveAttribute('href', '/portfolio/projects/PRJ-3/tasks'));
    expect(screen.getAllByRole('link').map((link) => link.getAttribute('href')).filter((href) => href?.includes(TASK.related_object_id))).toEqual([]);
    fireEvent.click(screen.getByRole('button', { name: 'common:buttons.close' }));
    await waitFor(() => expect(location()).toBe('/portfolio/projects/PRJ-3/tasks'));
  });
});
