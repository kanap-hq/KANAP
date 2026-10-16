import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../../i18n';
import { createAppTheme } from '../../../config/ThemeContext';
import TaskHistory from './TaskHistory';

// The history keeps the type names as they were when the change was made. A name that is still
// a shipped type the tenant kept is shown in the reader's language, like the type field itself.
const TASK_TYPES = [
  { id: 'tt-task', name: 'Task', code: 'task', description: null, is_active: true },
  { id: 'tt-bug', name: 'Bug', code: 'bug', description: null, is_active: true },
  { id: 'tt-problem', name: 'Ticket', code: 'problem', description: null, is_active: true },
];

vi.mock('../../../api', () => ({
  default: {
    get: vi.fn((url: string) => Promise.resolve({
      data: url === '/portfolio/classification/task-types'
        ? TASK_TYPES
        : [{
          id: 'a-1',
          type: 'change',
          content: null,
          context: null,
          author_id: null,
          first_name: 'Clara',
          last_name: 'Dupont',
          created_at: '2026-08-22T11:06:49Z',
          changed_fields: { task_type_id: ['Task', 'Problem'] },
        }],
    })),
  },
}));

afterEach(async () => {
  await i18n.changeLanguage('en');
});

describe('TaskHistory task type', () => {
  it('shows a former and a new type in the reader\'s language while they are shipped types the tenant kept', async () => {
    await i18n.changeLanguage('fr');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
    render(
      <QueryClientProvider client={client}>
        <ThemeProvider theme={createAppTheme('light')}>
          <TaskHistory taskId="t-1" createdAt="2026-08-22T11:06:40Z" createdByName="Thomas Berger" />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    // "Task" is the tenant's shipped type: translated. "Problem" was renamed "Ticket" since: kept as recorded.
    expect(await screen.findByText(/Tâche/)).toBeTruthy();
    expect(screen.getByText(/Problem/)).toBeTruthy();
  });
});
