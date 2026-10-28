import React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';
import i18n from '../i18n';
import EntityTasksPanel from './EntityTasksPanel';

const auth = vi.hoisted(() => ({ tasksMember: false, tasksAdmin: false }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => resource === 'tasks' && (
      (level === 'member' && auth.tasksMember) || (level === 'admin' && auth.tasksAdmin)
    ),
  }),
}));

const get = vi.hoisted(() => vi.fn());
vi.mock('../api', () => ({ default: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

vi.mock('./design', () => ({
  StatusDot: () => null,
  useKanapDialogs: () => ({ confirm: vi.fn(async () => true), alert: vi.fn() }),
}));

const TASK = {
  id: 'task-1',
  item_number: 4,
  title: 'Relire le contrat',
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
          <EntityTasksPanel entityType="contract" entityId="contract-1" />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('EntityTasksPanel task creation', () => {
  beforeEach(async () => {
    get.mockReset();
    auth.tasksMember = false;
    auth.tasksAdmin = false;
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('fr');
  });

  it('lists the tasks without offering to create one without the tasks member right', async () => {
    auth.tasksMember = false;
    renderPanel();

    expect(await screen.findByText('Relire le contrat')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull();
  });

  it('offers to create a task with the tasks member right', async () => {
    auth.tasksMember = true;
    renderPanel();

    expect(await screen.findByText('Relire le contrat')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add task' })).toBeInTheDocument();
  });

  it('hides task deletion without the tasks admin right', async () => {
    auth.tasksMember = true;
    auth.tasksAdmin = false;
    renderPanel();

    expect(await screen.findByText('Relire le contrat')).toBeInTheDocument();
    expect(screen.queryByTitle('Delete task')).toBeNull();
  });

  it('offers task deletion with the tasks admin right', async () => {
    auth.tasksMember = true;
    auth.tasksAdmin = true;
    renderPanel();

    expect(await screen.findByText('Relire le contrat')).toBeInTheDocument();
    expect(screen.getByTitle('Delete task')).toBeInTheDocument();
  });
});
