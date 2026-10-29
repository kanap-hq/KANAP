import React from 'react';
import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import i18n from '../../i18n';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';

const auth = vi.hoisted(() => ({ contributor: true }));
const navigate = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  post: vi.fn(),
}));
const gantt = vi.hoisted(() => ({
  readonly: undefined as boolean | undefined,
  onUpdateTask: undefined as undefined | ((ev: unknown) => Promise<void> | void),
  onShowEditor: undefined as undefined | ((ev: { id?: string }) => boolean),
}));

vi.mock('../../api', () => ({ default: api }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) =>
      resource === 'portfolio_projects' && level === 'contributor' && auth.contributor,
  }),
}));
vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('@svar-ui/react-gantt/style.css', () => ({}));
vi.mock('@svar-ui/react-gantt', () => ({
  Gantt: (props: { readonly?: boolean; init?: (api: unknown) => void }) => {
    gantt.readonly = props.readonly;
    const chart = {
      exec: () => undefined,
      getState: () => ({ _scales: { width: 0 } }),
      on: (event: string, handler: (ev: unknown) => Promise<void> | void) => {
        if (event === 'update-task') gantt.onUpdateTask = handler;
      },
      intercept: (event: string, handler: (ev: { id?: string }) => boolean) => {
        if (event === 'show-editor') gantt.onShowEditor = handler;
      },
    };
    props.init?.(chart);
    return <div data-testid="gantt" data-readonly={String(!!props.readonly)} />;
  },
}));

import PlanningPage from './PlanningPage';

const timeline = {
  projects: [{
    id: 'prj-1',
    name: 'Cheese track',
    status: 'planned',
    category_id: null,
    planned_start: '2026-03-02',
    planned_end: '2026-06-30',
    execution_progress: 0,
  }],
  dependencies: [],
  milestones: [],
  viewStart: '2026-03-01',
};

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <QueryClientProvider client={client}>
        <KanapDialogProvider>
          <MemoryRouter>
            <PlanningPage />
          </MemoryRouter>
        </KanapDialogProvider>
      </QueryClientProvider>
    </ThemeProvider>,
  );
}

async function dragBar() {
  await act(async () => {
    await gantt.onUpdateTask?.({
      id: 'prj-1',
      inProgress: false,
      task: { start: new Date(2026, 2, 2), end: new Date(2026, 3, 10) },
    });
  });
}

describe('Planning timeline dates', () => {
  beforeEach(async () => {
    auth.contributor = true;
    navigate.mockReset();
    api.patch.mockReset();
    api.patch.mockResolvedValue({ data: {} });
    api.get.mockImplementation(async (url: string) => {
      if (String(url).includes('/planning/timeline')) return { data: timeline };
      return { data: [] };
    });
    gantt.readonly = undefined;
    gantt.onUpdateTask = undefined;
    gantt.onShowEditor = undefined;
    await i18n.loadNamespaces(['portfolio', 'errors']);
    await i18n.changeLanguage('en');
  });

  it('locks the chart for a reader and still opens the project', async () => {
    auth.contributor = false;
    renderPage();
    expect(await screen.findByTestId('gantt')).toHaveAttribute('data-readonly', 'true');
    expect(gantt.readonly).toBe(true);

    await dragBar();
    expect(api.patch).not.toHaveBeenCalled();

    gantt.onShowEditor?.({ id: 'prj-1' });
    expect(navigate).toHaveBeenCalledWith('/portfolio/projects/prj-1/summary');
  });

  it('keeps dragging and opening for a contributor', async () => {
    renderPage();
    expect(await screen.findByTestId('gantt')).toHaveAttribute('data-readonly', 'false');
    expect(gantt.readonly).toBe(false);

    await dragBar();
    expect(api.patch).toHaveBeenCalledWith('/portfolio/projects/prj-1', {
      planned_start: '2026-03-02',
      planned_end: '2026-04-10',
    });

    gantt.onShowEditor?.({ id: 'prj-1' });
    expect(navigate).toHaveBeenCalledWith('/portfolio/projects/prj-1/summary');
  });
});
