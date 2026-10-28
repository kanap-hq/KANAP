import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../../config/ThemeContext';
import i18n from '../../../../i18n';
import ProjectTimelineTab from './ProjectTimelineTab';

const auth = vi.hoisted(() => ({ tasksMember: false }));
vi.mock('../../../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => auth.tasksMember && resource === 'tasks' && level === 'member',
  }),
}));

const get = vi.hoisted(() => vi.fn());
vi.mock('../../../../api', () => ({ default: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));

vi.mock('../../components/ProjectTimeline', () => ({
  ProjectTimeline: ({ tableView }: any) => tableView,
}));

vi.mock('../../../tasks/hooks/useDoneRequiresTime', () => ({
  useDoneRequiresTime: () => ({ runWithGuard: vi.fn() }),
}));

const FORM = {
  phases: [{
    id: 'phase-1',
    name: 'Cadrage',
    sequence: 0,
    status: 'pending',
    planned_start: null,
    planned_end: null,
  }],
  milestones: [],
};

function renderTimeline() {
  get.mockImplementation(async (url: string) => {
    if (url === '/portfolio/phase-templates') return { data: [] };
    if (url === '/portfolio/projects/project-1/tasks') return { data: [] };
    return { data: [] };
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <ProjectTimelineTab
          canManage
          form={FORM}
          projectId="project-1"
          onError={vi.fn()}
          onNavigateToTask={vi.fn()}
          onRefetch={vi.fn(async () => undefined)}
          onSetForm={vi.fn()}
          onUpdate={vi.fn()}
        />
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

async function openPhaseMenu() {
  const add = await screen.findByTitle('Add task to phase');
  fireEvent.click(add);
  expect(await screen.findByText('Link existing task')).toBeInTheDocument();
}

describe('ProjectTimelineTab task creation', () => {
  beforeEach(async () => {
    get.mockReset();
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('fr');
  });

  it('hides the new task entry without the tasks member right', async () => {
    auth.tasksMember = false;
    renderTimeline();

    await openPhaseMenu();
    expect(screen.queryByText('New task')).toBeNull();
  });

  it('shows the new task entry with the tasks member right', async () => {
    auth.tasksMember = true;
    renderTimeline();

    await openPhaseMenu();
    expect(screen.getByText('New task')).toBeInTheDocument();
  });
});
