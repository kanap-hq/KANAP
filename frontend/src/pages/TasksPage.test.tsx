import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';
import TasksPage from './TasksPage';

const deleteButton = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const auth = vi.hoisted(() => ({ write: true }));
const post = vi.hoisted(() => vi.fn());
const t = vi.hoisted(() => (key: string) => key);

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (_area: string, level: string) => level === 'reader' || auth.write,
    profile: null,
    user: null,
  }),
}));
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post } }));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'fromage' }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    return null;
  },
}));
vi.mock('../components/csv', () => ({ CsvExportDialogV2: () => null, CsvImportDialogV2: () => null }));
vi.mock('../components/PageHeader', () => ({ default: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div> }));
vi.mock('../components/DeleteSelectedButton', () => ({
  default: (props: Record<string, any>) => {
    deleteButton.props = props;
    return null;
  },
}));

describe('TasksPage delete', () => {
  beforeEach(() => {
    auth.write = true;
    grid.props = null;
  });

  it('asks the delete check before its confirmation, and names the tasks in its words', async () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter><TasksPage /></MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    const props = deleteButton.props!;
    expect(props).not.toBeNull();
    const refused = [{ id: 'a', name: 'Origin', code: 'TASK_REQUEST_ORIGIN', usages: [], params: { reference: 'REQ-4' } }];
    post.mockResolvedValueOnce({ data: { refused } });
    expect(await props.checkDelete(['a', 'b'])).toEqual({ refused });
    expect(post).toHaveBeenCalledWith('/tasks/delete-check', { ids: ['a', 'b'] });
    expect(String(props.itemLabels.toDelete(2))).toBe('tasks.delete.toDelete');
    expect(String(props.itemLabels.kept(1))).toBe('tasks.delete.kept');
  });

  it('says the list is empty in one line, with the creation for someone who may create', () => {
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter><TasksPage /></MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    const emptyState = grid.props?.emptyState as React.ReactElement;
    render(<ThemeProvider theme={createAppTheme('light')}>{emptyState}</ThemeProvider>);
    const empty = screen.getByTestId('tasks-empty');
    expect(empty.textContent).toContain('tasks.empty');
    expect(empty.querySelector('button')?.textContent).toBe('tasks.actions.new');
  });

  it('leaves the creation out of the empty list for a reader', () => {
    auth.write = false;
    render(
      <ThemeProvider theme={createAppTheme('light')}>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter><TasksPage /></MemoryRouter>
        </QueryClientProvider>
      </ThemeProvider>,
    );
    const emptyState = grid.props?.emptyState as React.ReactElement;
    render(<ThemeProvider theme={createAppTheme('light')}>{emptyState}</ThemeProvider>);
    expect(screen.getByTestId('tasks-empty').textContent).toBe('tasks.empty');
    expect(screen.getByTestId('tasks-empty').querySelector('button')).toBeNull();
  });
});
