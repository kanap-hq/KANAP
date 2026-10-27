import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../config/ThemeContext';

// Projects, requests and tasks: the export dialog gets the list's request (filters, quick search,
// scope and sort) with `rows=list`, so the file holds the rows of the screen.

const grid = vi.hoisted(() => ({ props: null as null | Record<string, any> }));
const dialog = vi.hoisted(() => ({ props: null as null | Record<string, any> }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'u-1' }, user: null }),
}));
vi.mock('../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post: vi.fn() } }));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'fromage' }) }));
vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../components/ServerDataGrid', () => ({
  default: (props: Record<string, any>) => {
    grid.props = props;
    return null;
  },
}));
vi.mock('../components/csv', () => ({
  CsvExportDialogV2: (props: Record<string, any>) => {
    dialog.props = props;
    return null;
  },
  CsvImportDialogV2: () => null,
}));
vi.mock('../components/PageHeader', () => ({ default: ({ actions }: { actions?: React.ReactNode }) => <div>{actions}</div> }));

import ProjectsPage from './portfolio/ProjectsPage';
import RequestsPage from './portfolio/RequestsPage';
import TasksPage from './TasksPage';

const screenRequest = {
  sort: 'name:DESC',
  q: 'alpha',
  filters: '{"status":{"filterType":"set","values":["in_progress"]}}',
  involvedUserId: 'u-1',
  include: 'company,classification',
};

async function exportParamsOf(page: React.ReactElement, buttonKey: string) {
  grid.props = null;
  dialog.props = null;
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>{page}</MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
  // Read again: the render set them (the reset above narrowed the type).
  const gridProps = grid.props as Record<string, any> | null;
  expect(gridProps?.onListRequestChange).toBeTypeOf('function');
  act(() => gridProps!.onListRequestChange({ params: screenRequest, total: 3 }));
  fireEvent.click(screen.getByRole('button', { name: buttonKey }));
  const dialogProps = dialog.props as Record<string, any> | null;
  expect(dialogProps?.open).toBe(true);
  return dialogProps?.params;
}

describe('list exports follow the screen', () => {
  const expected = {
    sort: 'name:DESC',
    q: 'alpha',
    filters: '{"status":{"filterType":"set","values":["in_progress"]}}',
    involvedUserId: 'u-1',
    rows: 'list',
  };

  it('projects', async () => {
    expect(await exportParamsOf(<ProjectsPage />, 'projects.actions.exportCsv')).toEqual(expected);
  });

  it('requests', async () => {
    expect(await exportParamsOf(<RequestsPage />, 'requests.actions.exportCsv')).toEqual(expected);
  });

  it('tasks', async () => {
    expect(await exportParamsOf(<TasksPage />, 'tasks.actions.exportCsv')).toEqual(expected);
  });
});
