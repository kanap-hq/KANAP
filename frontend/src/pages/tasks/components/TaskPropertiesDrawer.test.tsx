import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

const LOOKUP_PEOPLE = [
  { id: 'u-camille', first_name: 'Camille', last_name: 'Bernard', email: 'camille.bernard@fromage-co.com', status: 'enabled' },
  { id: 'u-lea', first_name: 'Léa', last_name: 'Martin', email: null, status: 'enabled' },
];

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn((url: string) => {
      if (url === '/portfolio/classification/task-types') return Promise.resolve({ data: TASK_TYPES });
      if (url === '/users/lookup') return Promise.resolve({ data: { items: LOOKUP_PEOPLE, has_more: false } });
      return Promise.resolve({ data: [] });
    }),
  },
}));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => true }) }));
vi.mock('./DrawerKnowledgeSection', () => ({ default: () => null }));

import api from '../../../api';

const apiGet = (api as unknown as { get: ReturnType<typeof vi.fn> }).get;

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

function renderDrawer(props: { readOnly: boolean; task?: ReturnType<typeof task>; onPatch?: (patch: Record<string, unknown>) => void }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeModeProvider>
        <ThemeProvider theme={createAppTheme('light')}>
          <MemoryRouter>
            <TaskPropertiesDrawer task={props.task ?? task()} open onToggle={() => {}} onPatch={props.onPatch ?? (() => {})} readOnly={props.readOnly} isCreate />
          </MemoryRouter>
        </ThemeProvider>
      </ThemeModeProvider>
    </QueryClientProvider>,
  );
}

/** The property row whose label is `label` (the label box is the direct parent of the text). */
function fieldRow(label: string): HTMLElement {
  const row = screen.getByText(label).parentElement;
  if (!row) throw new Error(`missing row for ${label}`);
  return row;
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

describe('TaskPropertiesDrawer people', () => {
  const named = task({
    creator_id: 'u-camille',
    creator_name: 'Camille Bernard',
    assignee_user_id: 'u-marc',
    assignee_name: 'Marc Zola',
  });

  it('shows the requestor by name in the same control as the assignee, and never the email', async () => {
    apiGet.mockClear();
    renderDrawer({ readOnly: false, task: named });
    const requestor = within(fieldRow('Requestor')).getByRole('button', { name: 'Camille Bernard' });
    const assignee = within(fieldRow('Assignee')).getByRole('button', { name: 'Marc Zola' });
    expect(requestor.tagName).toBe(assignee.tagName);
    expect(within(fieldRow('Requestor')).queryByRole('combobox')).toBeNull();
    expect(screen.queryByText('camille.bernard@fromage-co.com')).toBeNull();
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 300)); });
    expect(apiGet.mock.calls.some((call) => call[0] === '/users/lookup')).toBe(false);
    expect(screen.queryByText('camille.bernard@fromage-co.com')).toBeNull();
  });

  it('uses the same empty placeholder style as the assignee', () => {
    renderDrawer({ readOnly: false });
    expect(within(fieldRow('Requestor')).getByRole('button', { name: 'Requestor missing' })).toBeEnabled();
    expect(within(fieldRow('Assignee')).getByRole('button', { name: 'Assignee missing' })).toBeEnabled();
  });

  it('patches creator_id from the anchored search', async () => {
    const onPatch = vi.fn();
    renderDrawer({ readOnly: false, onPatch, task: named });
    fireEvent.click(within(fieldRow('Requestor')).getByRole('button', { name: 'Camille Bernard' }));
    expect(await screen.findByPlaceholderText('Requestor')).toBeTruthy();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Léa Martin' }));
    expect(onPatch).toHaveBeenCalledWith({ creator_id: 'u-lea' });
  });

  it('shows the name without opening a control when read-only', () => {
    const onPatch = vi.fn();
    renderDrawer({ readOnly: true, onPatch, task: named });
    const requestor = within(fieldRow('Requestor')).getByRole('button', { name: 'Camille Bernard' });
    const assignee = within(fieldRow('Assignee')).getByRole('button', { name: 'Marc Zola' });
    expect(requestor).toBeDisabled();
    expect(assignee).toBeDisabled();
    fireEvent.click(requestor);
    expect(screen.queryByPlaceholderText('Requestor')).toBeNull();
    expect(onPatch).not.toHaveBeenCalled();
    expect(screen.queryByText('camille.bernard@fromage-co.com')).toBeNull();
  });
});

describe('TaskPropertiesDrawer linked records the person cannot read', () => {
  it('leaves out the applications, the assets and the object the task belongs to', () => {
    // The API sends no id and no name for a module the person does not read: the rows disappear.
    renderDrawer({
      readOnly: true,
      task: task({
        related_object_type: 'project',
        related_object_id: null,
        related_object_name: null,
        related_object_hidden: true,
        phase_name: 'Build',
        applications: null,
        application_ids: null,
        assets: null,
        asset_ids: null,
      }),
    });
    for (const label of ['Related to', 'Phase', 'Applications', 'Assets']) {
      expect(screen.queryByText(label)).toBeNull();
    }
    expect(screen.queryByText('Standalone task')).toBeNull();
  });

  it('shows them to a reader of their modules', () => {
    renderDrawer({
      readOnly: true,
      task: task({
        related_object_type: 'project',
        related_object_id: 'p-1',
        related_object_name: 'ERP rollout',
        phase_name: 'Build',
        applications: [{ id: 'a-1', name: 'CheeseTrack', sequential_id: 'APP-36' }],
        application_ids: ['a-1'],
        assets: [],
        asset_ids: [],
      }),
    });
    expect(within(fieldRow('Related to')).getByText('ERP rollout')).toBeTruthy();
    expect(within(fieldRow('Applications')).getByText('APP-36 CheeseTrack')).toBeTruthy();
    expect(screen.getByText('Assets')).toBeTruthy();
  });
});

describe('TaskPropertiesDrawer labels', () => {
  it('adds and removes a label through onPatch', async () => {
    const user = userEvent.setup();
    const onPatch = vi.fn();
    renderDrawer({ readOnly: false, onPatch, task: task({ labels: ['alpha'] }) });
    const input = within(fieldRow('Labels')).getByRole('combobox', { name: 'Labels' });
    await user.type(input, ' beta{enter}');
    expect(onPatch).toHaveBeenCalledWith({ labels: ['alpha', 'beta'] });
    const alpha = within(fieldRow('Labels')).getByText('alpha').closest('.MuiChip-root');
    if (!alpha) throw new Error('missing alpha chip');
    await user.click(alpha.querySelector('.MuiChip-deleteIcon') as Element);
    expect(onPatch).toHaveBeenLastCalledWith({ labels: [] });
  });

  it('shows chips only to a reader', () => {
    renderDrawer({ readOnly: true, task: task({ labels: ['alpha', 'beta'] }) });
    const row = fieldRow('Labels');
    expect(within(row).getByText('alpha')).toBeTruthy();
    expect(within(row).getByText('beta')).toBeTruthy();
    expect(within(row).queryByRole('combobox')).toBeNull();
    expect(within(row).getByText('alpha').closest('.MuiChip-root')?.querySelector('.MuiChip-deleteIcon')).toBeNull();
  });
});
