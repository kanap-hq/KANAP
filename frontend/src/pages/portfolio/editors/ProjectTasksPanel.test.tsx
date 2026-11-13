import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import i18n from '../../../i18n';
import ProjectTasksPanel from './ProjectTasksPanel';

const RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, admin: 4 };
const auth = vi.hoisted(() => ({ levels: {} as Record<string, string> }));
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => (RANK[auth.levels[resource]] ?? 0) >= (RANK[level] ?? 99),
  }),
}));

const get = vi.hoisted(() => vi.fn());
vi.mock('../../../api', () => ({ default: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

vi.mock('../../../components/design', () => ({
  StatusDot: () => null,
  useKanapDialogs: () => ({ confirm: vi.fn(async () => true), alert: vi.fn() }),
}));

const TASK = {
  id: 'task-1',
  item_number: 4,
  title: 'Préparer la recette',
  description: null,
  status: 'open',
  due_date: null,
  start_date: null,
  priority_level: 'normal',
  assignee_user_id: null,
  phase_id: null,
};

function renderPanel() {
  get.mockResolvedValue({ data: [TASK] });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <ProjectTasksPanel projectId="project-1" />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

// A project's task is created through the project's address: the tasks member right, and a
// contribution to the project (the project management right is not needed).
describe('ProjectTasksPanel task creation', () => {
  beforeEach(async () => {
    get.mockReset();
    auth.levels = {};
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('fr');
  });

  it('offers to add a task with the tasks member right and a contribution to the project', async () => {
    auth.levels = { tasks: 'member', portfolio_projects: 'contributor' };
    renderPanel();

    expect(await screen.findByText('Préparer la recette')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add task' })).toBeInTheDocument();
  });

  it('does not offer it without the tasks member right, even to a project administrator', async () => {
    auth.levels = { tasks: 'reader', portfolio_projects: 'admin' };
    renderPanel();

    expect(await screen.findByText('Préparer la recette')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
  });

  it('does not offer it to a project reader, whose creation the project refuses', async () => {
    auth.levels = { tasks: 'member', portfolio_projects: 'reader' };
    renderPanel();

    expect(await screen.findByText('Préparer la recette')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
  });
});
