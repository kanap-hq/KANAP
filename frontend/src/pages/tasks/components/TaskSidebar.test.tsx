import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';

// A stable `t`: a new one per render would loop the effects that depend on it.
const t = vi.hoisted(() => (key: string, options?: Record<string, unknown>) => (
  options && 'count' in options ? `${key}:${options.count}` : key
));
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../../api', () => ({ default: { get: vi.fn(async () => ({ data: [] })) } }));
vi.mock('../../../auth/AuthContext', () => ({ useAuth: () => ({ hasLevel: () => false }) }));
vi.mock('../../../hooks/useLocalizedTaskTypes', () => ({
  useLocalizedTaskTypes: () => ({ data: [] }),
  useTaskTypeLabel: () => () => null,
}));
vi.mock('../../../components/EntityKnowledgePanel', () => ({ default: () => null }));

import TaskSidebar from './TaskSidebar';

const task = {
  id: '',
  status: 'open',
  task_type_id: null,
  task_type_name: null,
  task_type_code: null,
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
  related_object_type: 'contract',
  related_object_id: null,
  related_object_name: null,
  related_object_hidden: true,
  related_object_hidden_kind: 'contract' as const,
  phase_id: null,
  phase_name: null,
  category_id: null,
  category_name: null,
  stream_id: null,
  stream_name: null,
};

function renderSidebar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter>
          <TaskSidebar task={task} onPatch={() => undefined} readOnly isCreate />
        </MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('TaskSidebar hidden contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('names a contract outside the access with its label, without a link', () => {
    renderSidebar();
    const label = screen.getByText('ops:contracts.outsideYourAccess');
    expect(label).toBeInTheDocument();
    expect(label.closest('a')).toBeNull();
  });
});
