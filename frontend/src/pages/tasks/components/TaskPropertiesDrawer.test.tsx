import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { ThemeModeProvider, createAppTheme } from '../../../config/ThemeContext';
import TaskPropertiesDrawer from './TaskPropertiesDrawer';

const TASK_TYPES = [
  { id: 'tt-task', name: 'Task', code: 'task', description: 'Standard task or work item', is_active: true, display_order: 0 },
  { id: 'tt-bug', name: 'Defect', code: 'bug', description: null, is_active: true, display_order: 1 },
  { id: 'tt-problem', name: 'Problem', code: 'problem', description: null, is_active: true, display_order: 2 },
  { id: 'tt-own', name: 'Change', code: null, description: null, is_active: true, display_order: 3 },
];

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn((url: string) => Promise.resolve({ data: url === '/portfolio/classification/task-types' ? TASK_TYPES : [] })),
  },
}));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('./DrawerKnowledgeSection', () => ({ default: () => null }));

const task = (over: Record<string, unknown> = {}) => ({
  id: '',
  status: 'open',
  task_type_id: 'tt-task',
  task_type_name: 'Task',
  task_type_code: 'task',
  priority_level: 'normal',
  start_date: null,
  due_date: null,
  assignee_user_id: null,
  assignee_name: null,
  creator_id: null,
  creator_name: null,
  owner_ids: [],
  viewer_ids: [],
  labels: [],
  related_object_type: null,
  related_object_id: null,
  related_object_name: null,
  phase_id: null,
  phase_name: null,
  category_id: null,
  category_name: null,
  stream_id: null,
  stream_name: null,
  ...over,
});

function renderDrawer(props: { readOnly: boolean; task?: ReturnType<typeof task> }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeModeProvider>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter>
            <TaskPropertiesDrawer task={props.task ?? task()} open onToggle={() => {}} onPatch={() => {}} readOnly={props.readOnly} isCreate />
          </MemoryRouter>
        </ThemeProvider>
      </ThemeModeProvider>
    </QueryClientProvider>,
  );
}

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('TaskPropertiesDrawer task type', () => {
  it('shows the shipped type of the record in the user\'s language', async () => {
    await i18n.changeLanguage('fr');
    renderDrawer({ readOnly: true });
    expect(await screen.findByText('Tâche')).toBeTruthy();
    expect(screen.queryByText('Task')).toBeNull();
  });

  it('offers the shipped types in the user\'s language, and the renamed and added ones as they are', async () => {
    await i18n.changeLanguage('fr');
    renderDrawer({ readOnly: false });
    await waitFor(() => expect(screen.getByText('Tâche')).toBeTruthy());
    fireEvent.mouseDown(screen.getByText('Tâche'));
    const listbox = await screen.findByRole('listbox');
    expect(within(listbox).getAllByRole('option').map((node) => node.textContent)).toEqual(['—', 'Tâche', 'Defect', 'Problème', 'Change']);
  });
});
