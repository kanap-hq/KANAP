import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import TaskComments from './TaskComments';
import { TASK_STATUS_LABELS } from '../task.constants';

const { apiGet, t } = vi.hoisted(() => ({
  apiGet: vi.fn(),
  // A stable `t`: a new one on each render would loop the component's effects.
  t: (key: string, options?: Record<string, unknown>) => {
    if (options && typeof options.from === 'string' && typeof options.to === 'string') return `${key}:${options.from}->${options.to}`;
    return typeof options?.defaultValue === 'string' ? options.defaultValue : key;
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t, i18n: { language: 'en' } }),
}));

vi.mock('../../../api', () => ({
  default: { get: apiGet, post: vi.fn(), patch: vi.fn() },
}));

vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'user-1' } }),
}));

vi.mock('../../../tenant/TenantContext', () => ({
  useTenant: () => ({ tenantSlug: 'acme' }),
}));

vi.mock('../../../i18n/useLocale', () => ({
  useLocale: () => 'en',
}));

vi.mock('./UnifiedActivityForm', () => ({
  default: () => <div data-testid="activity-form" />,
}));

vi.mock('../../../components/MarkdownContent', () => ({
  MarkdownContent: ({ content }: { content: string }) => <div>{content}</div>,
}));

function renderComments() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TaskComments taskId="task-1" currentStatus="in_progress" />
    </QueryClientProvider>,
  );
}

describe('TaskComments', () => {
  it('shows the status changed with a comment on the comment', async () => {
    apiGet.mockResolvedValue({
      data: [
        {
          id: 'a-1', type: 'comment', content: 'Moving on', context: null, author_id: 'user-2',
          first_name: 'Alba', last_name: 'All', created_at: '2026-10-29T10:00:00.000Z',
          changed_fields: { status: ['open', 'in_progress'] },
        },
        {
          id: 'a-2', type: 'comment', content: 'Just a note', context: null, author_id: 'user-2',
          first_name: 'Alba', last_name: 'All', created_at: '2026-10-29T09:00:00.000Z',
        },
        // The feed's `change` entry stays in the data for the dashboard tiles: never shown here.
        {
          id: 'a-3', type: 'change', content: null, context: null, author_id: 'user-2',
          first_name: 'Alba', last_name: 'All', created_at: '2026-10-29T10:00:00.000Z',
          changed_fields: { status: ['open', 'in_progress'] },
        },
      ],
    });
    renderComments();

    expect(await screen.findByText('Moving on')).toBeInTheDocument();
    expect(screen.getByText('Just a note')).toBeInTheDocument();
    expect(apiGet).toHaveBeenCalledWith('/tasks/task-1/activities');
    const status = screen.getAllByText(/^portfolio:activity\.labels\.statusChange:/);
    expect(status).toHaveLength(1);
    expect(status[0].textContent).toBe(
      `portfolio:activity.labels.statusChange:${TASK_STATUS_LABELS.open}->${TASK_STATUS_LABELS.in_progress}`,
    );
  });
});
