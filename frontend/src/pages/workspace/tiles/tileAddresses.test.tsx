import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import GlobalStatusChangesTile from './GlobalStatusChangesTile';
import MyTasksTile from './MyTasksTile';
import NewRequestsTile from './NewRequestsTile';
import ProjectsIContributeTile from './ProjectsIContributeTile';
import ProjectsILeadTile from './ProjectsILeadTile';
import StaleTasksTile from './StaleTasksTile';
import TeamActivityTile from './TeamActivityTile';

// The home tiles open a task, a project or a request by its reference (`T-9`, `PRJ-3`, `REQ-2`),
// and by its uuid when the row carries no number.

const get = vi.hoisted(() => vi.fn());
vi.mock('../../../api', () => ({ default: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
const translation = { t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } };
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }) }));
vi.mock('../../../i18n/useLocale', () => ({ useLocale: () => 'en' }));

const NOW = '2026-11-20T10:00:00Z';
const task = { id: 'task-uuid', item_number: 9, title: 'Order cheese', status: 'open', priority_level: 'normal', due_date: null, updated_at: NOW };
const staleTask = {
  id: 'task-uuid', itemNumber: 9, title: 'Order cheese', status: 'open', updatedAt: NOW, staleDays: 30,
  assigneeName: null, relatedObjectType: null, relatedObjectId: null, relatedObjectName: null,
};
const request = { id: 'req-uuid', item_number: 2, name: 'New cellar', status: 'pending_review', created_at: NOW, requestor: null };
const project = { id: 'prj-uuid', item_number: 3, name: 'Cheese cellar', status: 'in_progress', execution_progress: 10, planned_end: null, role: 'it_lead' };
const activity = {
  id: 'act-1', projectId: 'prj-uuid', projectItemNumber: 3, projectName: 'Cheese cellar', type: 'change', content: null,
  authorName: 'Ana', createdAt: NOW, changedFields: { status: ['planned', 'in_progress'] },
};
const statusChange = { ...activity, oldStatus: 'planned', newStatus: 'in_progress', changedAt: NOW, changedBy: 'Ana' };

const cases: Array<[string, React.ComponentType<{ config: Record<string, unknown> }>, string, (withNumber: boolean) => unknown, string, string, string]> = [
  ['my tasks', MyTasksTile, '/tasks', (n) => ({ items: [{ ...task, item_number: n ? 9 : null }], total: 1 }), 'Order cheese', '/portfolio/tasks/T-9', '/portfolio/tasks/task-uuid'],
  ['stale tasks', StaleTasksTile, '/dashboard/stale-tasks', (n) => [{ ...staleTask, itemNumber: n ? 9 : null }], 'Order cheese', '/portfolio/tasks/T-9', '/portfolio/tasks/task-uuid'],
  ['new requests', NewRequestsTile, '/portfolio/requests', (n) => ({ items: [{ ...request, item_number: n ? 2 : null }], total: 1 }), 'New cellar', '/portfolio/requests/REQ-2', '/portfolio/requests/req-uuid'],
  ['projects I lead', ProjectsILeadTile, '/dashboard/my-leadership-projects', (n) => [{ ...project, item_number: n ? 3 : null }], 'Cheese cellar', '/portfolio/projects/PRJ-3', '/portfolio/projects/prj-uuid'],
  ['projects I contribute to', ProjectsIContributeTile, '/dashboard/my-contribution-projects', (n) => [{ ...project, item_number: n ? 3 : null }], 'Cheese cellar', '/portfolio/projects/PRJ-3', '/portfolio/projects/prj-uuid'],
  ['team activity', TeamActivityTile, '/dashboard/team-activity', (n) => [{ ...activity, projectItemNumber: n ? 3 : null }], 'Cheese cellar', '/portfolio/projects/PRJ-3/activity', '/portfolio/projects/prj-uuid/activity'],
  ['status changes', GlobalStatusChangesTile, '/dashboard/project-status-changes', (n) => [{ ...statusChange, projectItemNumber: n ? 3 : null }], 'Cheese cellar', '/portfolio/projects/PRJ-3/activity', '/portfolio/projects/prj-uuid/activity'],
];

function Location() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderTile(Tile: React.ComponentType<{ config: Record<string, unknown> }>) {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter initialEntries={['/']}>
          <Location />
          <Routes>
            <Route path="/" element={<Tile config={{}} />} />
            <Route path="*" element={null} />
          </Routes>
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('home tile addresses', () => {
  beforeEach(() => get.mockReset());

  it.each(cases)('%s: opens the record by its reference', async (_name, Tile, url, rows, label, byReference) => {
    get.mockImplementation(async (path: string) => ({ data: path === url ? rows(true) : [] }));
    renderTile(Tile);
    fireEvent.click(await screen.findByText(label));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(byReference));
  });

  it.each(cases)('%s: opens the record by its uuid when the row has no number', async (_name, Tile, url, rows, label, _byReference, byUuid) => {
    get.mockImplementation(async (path: string) => ({ data: path === url ? rows(false) : [] }));
    renderTile(Tile);
    fireEvent.click(await screen.findByText(label));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent(byUuid));
  });
});
