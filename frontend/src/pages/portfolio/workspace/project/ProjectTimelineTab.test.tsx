import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KanapDialogProvider } from '../../../../components/design';
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
const apiDelete = vi.hoisted(() => vi.fn());
vi.mock('../../../../api', () => ({ default: { get, post: vi.fn(), patch: vi.fn(), delete: apiDelete } }));

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

function renderTimeline({
  form = FORM,
  onRefetch = vi.fn(async () => undefined),
}: {
  form?: any;
  onRefetch?: () => Promise<unknown>;
} = {}) {
  get.mockImplementation(async (url: string) => {
    if (url === '/portfolio/phase-templates') return { data: [] };
    if (url === '/portfolio/projects/project-1/tasks') return { data: [] };
    return { data: [] };
  });
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <ProjectTimelineTab
            canManage
            form={form}
            projectId="project-1"
            onError={vi.fn()}
            onNavigateToTask={vi.fn()}
            onRefetch={onRefetch}
            onSetForm={vi.fn()}
            onUpdate={vi.fn()}
          />
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { onRefetch };
}

async function openPhaseMenu() {
  const add = await screen.findByTitle('Add task to phase');
  fireEvent.click(add);
  expect(await screen.findByText('Link existing task')).toBeInTheDocument();
}

const MILESTONE_FORM = {
  phases: [],
  milestones: [{
    id: 'milestone-1',
    name: 'Go live',
    phase_id: null,
    target_date: null,
    status: 'pending',
  }],
};

/** The milestone row's delete control has no accessible name of its own. */
function milestoneDeleteButton() {
  const icon = screen.getByTestId('DeleteIcon');
  const button = icon.closest('button');
  if (!button) throw new Error('milestone delete button missing');
  return button;
}

async function expectDeleteConfirm(message: string) {
  const dialog = await screen.findByRole('dialog');
  expect(dialog).toHaveTextContent(message);
  expect(within(dialog).getByRole('button', { name: 'Delete' }).className).toMatch(/action-danger/);
  expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  return dialog;
}

describe('ProjectTimelineTab task creation', () => {
  beforeEach(async () => {
    get.mockReset();
    apiDelete.mockReset();
    apiDelete.mockResolvedValue({ data: {} });
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

  it('says there are no milestones yet, in one line and without an alert', async () => {
    auth.tasksMember = false;
    renderTimeline();

    expect(await screen.findByText('No milestones yet.')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('ProjectTimelineTab deletion', () => {
  beforeEach(async () => {
    get.mockReset();
    apiDelete.mockReset();
    apiDelete.mockResolvedValue({ data: {} });
    auth.tasksMember = false;
    await i18n.changeLanguage('en');
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage('fr');
  });

  it('asks before deleting a phase, and sends the request only after Delete', async () => {
    const { onRefetch } = renderTimeline();
    fireEvent.click(await screen.findByTitle('Delete phase'));

    expect(apiDelete).not.toHaveBeenCalled();
    const dialog = await expectDeleteConfirm('Delete this phase?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(apiDelete).not.toHaveBeenCalled();
    expect(onRefetch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTitle('Delete phase'));
    const again = await expectDeleteConfirm('Delete this phase?');
    fireEvent.click(within(again).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(1));
    expect(apiDelete).toHaveBeenCalledWith('/portfolio/projects/project-1/phases/phase-1');
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });

  it('asks before deleting a milestone, and sends the request only after Delete', async () => {
    const { onRefetch } = renderTimeline({ form: MILESTONE_FORM });
    expect(await screen.findByDisplayValue('Go live')).toBeInTheDocument();
    fireEvent.click(milestoneDeleteButton());

    expect(apiDelete).not.toHaveBeenCalled();
    const dialog = await expectDeleteConfirm('Delete this milestone?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(apiDelete).not.toHaveBeenCalled();
    expect(onRefetch).not.toHaveBeenCalled();

    fireEvent.click(milestoneDeleteButton());
    const again = await expectDeleteConfirm('Delete this milestone?');
    fireEvent.click(within(again).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(1));
    expect(apiDelete).toHaveBeenCalledWith('/portfolio/projects/project-1/milestones/milestone-1');
    expect(onRefetch).toHaveBeenCalledTimes(1);
  });
});
