import React from 'react';
import { render, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';

const grid = vi.hoisted(() => ({ props: null as null | Record<string, unknown> }));
const auth = vi.hoisted(() => ({ write: true }));

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (_area: string, level: string) => level === 'reader' || auth.write,
    profile: { id: 'u-1' },
    user: null,
  }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn(async () => ({ data: { items: [] } })), post: vi.fn() } }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'fromage' }) }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../components/ServerDataGrid', () => ({
  default: (props: Record<string, unknown>) => {
    grid.props = props;
    return null;
  },
}));
vi.mock('../../components/csv', () => ({ CsvExportDialogV2: () => null, CsvImportDialogV2: () => null }));
vi.mock('../../components/PageHeader', () => ({ default: () => null }));

import ProjectsPage from './ProjectsPage';
import RequestsPage from './RequestsPage';

function renderPage(page: React.ReactElement) {
  grid.props = null;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <MemoryRouter>{page}</MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

function expectEmptyLine(testId: string, sentenceKey: string, buttonKey: string) {
  const emptyState = grid.props?.emptyState as React.ReactElement;
  render(<ThemeProvider theme={createAppTheme('light')}>{emptyState}</ThemeProvider>);
  const empty = screen.getByTestId(testId);
  expect(empty.textContent).toContain(sentenceKey);
  expect(empty.querySelector('button')?.textContent).toBe(buttonKey);
}

describe('portfolio list empty states', () => {
  beforeEach(() => {
    auth.write = true;
  });

  it('says a project list is empty in one line, with the creation for someone who may create', () => {
    renderPage(<ProjectsPage />);
    expectEmptyLine('projects-empty', 'projects.empty', 'projects.actions.new');
  });

  it('says a request list is empty in one line, with the creation for someone who may create', () => {
    renderPage(<RequestsPage />);
    expectEmptyLine('requests-empty', 'requests.empty', 'requests.actions.new');
  });

  it('leaves the creation out of an empty project or request list for a reader', () => {
    auth.write = false;
    renderPage(<ProjectsPage />);
    const projects = grid.props?.emptyState as React.ReactElement;
    render(<ThemeProvider theme={createAppTheme('light')}>{projects}</ThemeProvider>);
    expect(screen.getByTestId('projects-empty').textContent).toBe('projects.empty');
    expect(screen.getByTestId('projects-empty').querySelector('button')).toBeNull();

    renderPage(<RequestsPage />);
    const requests = grid.props?.emptyState as React.ReactElement;
    render(<ThemeProvider theme={createAppTheme('light')}>{requests}</ThemeProvider>);
    expect(screen.getByTestId('requests-empty').textContent).toBe('requests.empty');
    expect(screen.getByTestId('requests-empty').querySelector('button')).toBeNull();
  });
});
