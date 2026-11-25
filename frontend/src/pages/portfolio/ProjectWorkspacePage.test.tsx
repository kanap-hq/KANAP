import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import ProjectWorkspacePage from './ProjectWorkspacePage';

const get = vi.hoisted(() => vi.fn());
const navParams = vi.hoisted(() => [] as Array<{ extraParams?: Record<string, string | undefined> }>);

const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'u-1' } }),
}));
const patch = vi.hoisted(() => vi.fn());
vi.mock('../../api', () => ({ default: { get, post: vi.fn(), patch, delete: vi.fn() } }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'acme' }) }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../hooks/useProjectNav', () => ({
  useProjectNav: (params: unknown) => {
    navParams.push(params as { extraParams?: Record<string, string | undefined> });
    return { total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null };
  },
}));
vi.mock('../../hooks/useClassificationDefaults', () => ({
  useClassificationDefaults: () => ({ data: null, isLoading: false }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('./workspace/portfolioRelations', () => ({
  portfolioLinksKey: (entity: string, id: string) => ['portfolio-links', entity, id],
  usePortfolioRelationsBadge: () => 0,
}));
// The shell's layout is covered by its own tests: here it lays its slots out plainly.
vi.mock('./workspace/PortfolioDetailWorkspaceShell', () => ({
  default: (props: any) => (
    <div>
      <h1>{props.title || props.titleFallback}</h1>
      <div data-testid="workspace-notices">{props.notices}</div>
      <div data-testid="workspace-metadata">{props.metadata}</div>
      <div role="tablist">
        {props.tabs.map((tab: any) => (
          <button key={tab.key} role="tab" disabled={tab.disabled} onClick={() => props.onTabChange(tab.key)}>{tab.label}</button>
        ))}
      </div>
      <main>{props.children}</main>
    </div>
  ),
}));
vi.mock('./workspace/project/ProjectPropertyPanel', () => ({ default: () => null }));
vi.mock('./workspace/project/ProjectSummaryTab', () => ({
  default: (props: { canEditManagedDocs: boolean }) => (
    <div data-testid="project-summary" data-edit-docs={String(props.canEditManagedDocs)} />
  ),
}));
vi.mock('./editors/ProjectTasksPanel', () => ({
  default: (props: { disabled: boolean }) => <div data-testid="project-tasks" data-disabled={String(props.disabled)} />,
}));
vi.mock('./workspace/project/ProjectActivityTab', () => ({ default: () => <div data-testid="project-activity" /> }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
// A picker is a button that picks `u-2`: the header's IT lead change, for the effort reads below.
vi.mock('../../components/workspace/MetadataUserPicker', () => ({
  default: (props: { label: string; onChange: (value: string) => void }) => (
    <button type="button" onClick={() => props.onChange('u-2')}>{props.label}</button>
  ),
  formatMetadataUserName: () => '',
}));
vi.mock('./workspace/project/ProjectEffortTab', () => ({
  default: (props: { itAllocationData?: { version?: number } | null; projectId: string }) => (
    <div data-testid="project-effort" data-project={props.projectId} data-it-version={String(props.itAllocationData?.version ?? '')} />
  ),
}));
vi.mock('./workspace/project/ProjectTimelineTab', () => ({
  default: (props: { projectId: string }) => <div data-testid="project-timeline" data-project={props.projectId} />,
}));
vi.mock('../../components/history/RecordHistoryTab', () => ({
  default: (props: { table: string; recordId: string }) => <div data-testid="record-history">{`${props.table}:${props.recordId}`}</div>,
}));

const PROJECT = { id: 'proj-1', item_number: 7, name: 'Data platform', status: 'planned', origin: 'fast_track', activities: [] };

function Location() {
  const location = useLocation();
  return <div data-testid="location">{`${location.pathname}${location.search}`}</div>;
}

function BackButton() {
  const navigate = useNavigate();
  return <button type="button" onClick={() => navigate(-1)}>step back</button>;
}

function renderPage(entry: string | string[]) {
  const entries = Array.isArray(entry) ? entry : [entry];
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={entries} initialIndex={entries.length - 1}>
            <Location />
            <BackButton />
            <Routes>
              <Route path="/start" element={<div data-testid="start" />} />
              <Route path="/portfolio/projects/:id/:tab" element={<ProjectWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const location = () => screen.getByTestId('location').textContent;

describe('ProjectWorkspacePage history', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/projects/proj-1' || url === '/portfolio/projects/PRJ-7') return { data: PROJECT };
      if (url === '/portfolio/classification/all') return { data: { sources: [], categories: [], streams: [] } };
      return { data: {} };
    });
  });

  it('puts the History tab last and renders the project history on it', async () => {
    renderPage('/portfolio/projects/proj-1/history');
    expect(await screen.findByTestId('record-history')).toHaveTextContent('portfolio_projects:proj-1');
    const tabs = screen.getAllByRole('tab');
    expect(tabs[tabs.length - 1]).toHaveTextContent('portfolio:labels.history');
    expect((tabs[tabs.length - 1] as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId('project-summary')).toBeNull();
  });

  it('disables the History tab while the project is created, and shows no history', async () => {
    renderPage('/portfolio/projects/new/summary');
    expect(await screen.findByTestId('project-summary')).toBeInTheDocument();
    const history = screen.getByRole('tab', { name: 'portfolio:labels.history' }) as HTMLButtonElement;
    expect(history.disabled).toBe(true);
    expect(screen.queryByTestId('record-history')).toBeNull();
  });

  it('asks the neighbours of every status when opened from the list, as its status filter decides', async () => {
    navParams.length = 0;
    renderPage('/portfolio/projects/proj-1/history?projectScope=all&sort=name%3AASC');
    await screen.findByTestId('record-history');
    expect(navParams[navParams.length - 1].extraParams).toEqual({ status: 'all' });
  });

  it('keeps the server default for the neighbours when opened from elsewhere', async () => {
    navParams.length = 0;
    renderPage('/portfolio/projects/proj-1/history');
    await screen.findByTestId('record-history');
    expect(navParams[navParams.length - 1].extraParams).toBeUndefined();
  });
});

describe('ProjectWorkspacePage contribution', () => {
  const serve = (project: Record<string, unknown>) => {
    get.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/projects/proj-1' || url === '/portfolio/projects/PRJ-7') return { data: project };
      if (url === '/portfolio/classification/all') return { data: { sources: [], categories: [], streams: [] } };
      return { data: {} };
    });
  };

  // The person holds the contributor level (every level here) but the project read says the
  // server refuses their contributions to this project.
  it('offers no task and no managed document edit when the project read refuses contributions', async () => {
    serve({ ...PROJECT, can_contribute: false });
    renderPage('/portfolio/projects/proj-1/tasks');
    expect(await screen.findByTestId('project-tasks')).toHaveAttribute('data-disabled', 'true');
    serve({ ...PROJECT, can_contribute: false });
    renderPage('/portfolio/projects/proj-1/summary');
    expect(await screen.findByTestId('project-summary')).toHaveAttribute('data-edit-docs', 'false');
  });

  it('offers them when the project read allows contributions', async () => {
    serve({ ...PROJECT, can_contribute: true });
    renderPage('/portfolio/projects/proj-1/tasks');
    expect(await screen.findByTestId('project-tasks')).toHaveAttribute('data-disabled', 'false');
  });
});

// A project's address names it by its reference (`PRJ-7`): an address by uuid moves to it through
// the router, and stays there through a tab change and a step back.
describe('ProjectWorkspacePage address', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/projects/proj-1' || url === '/portfolio/projects/PRJ-7') return { data: PROJECT };
      if (url === '/portfolio/classification/all') return { data: { sources: [], categories: [], streams: [] } };
      return { data: {} };
    });
  });

  it('moves an address by uuid to the reference, keeping its tab and its query', async () => {
    renderPage(['/start', '/portfolio/projects/proj-1/summary?projectScope=all&sort=name%3AASC']);
    await waitFor(() => expect(location()).toBe('/portfolio/projects/PRJ-7/summary?projectScope=all&sort=name%3AASC'));
    expect(screen.getByTestId('project-summary')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'portfolio:labels.history' }));
    await waitFor(() => expect(location()).toBe('/portfolio/projects/PRJ-7/history?projectScope=all&sort=name%3AASC'));
    expect(await screen.findByTestId('record-history')).toHaveTextContent('portfolio_projects:proj-1');
    fireEvent.click(screen.getByRole('button', { name: 'step back' }));
    await waitFor(() => expect(location()).toBe('/portfolio/projects/PRJ-7/summary?projectScope=all&sort=name%3AASC'));
    // The step back reaches the page before the project, never its uuid address.
    fireEvent.click(screen.getByRole('button', { name: 'step back' }));
    await waitFor(() => expect(location()).toBe('/start'));
  });

  it('leaves an address by reference as it is', async () => {
    renderPage('/portfolio/projects/PRJ-7/summary');
    expect(await screen.findByTestId('project-summary')).toBeInTheDocument();
    expect(location()).toBe('/portfolio/projects/PRJ-7/summary');
    expect(get).not.toHaveBeenCalledWith('/portfolio/projects/proj-1', expect.anything());
  });
});

// The effort and timeline reads are keyed by the project's uuid: the gestures that change them
// (a lead, the team, a task moved) invalidate them by the uuid, while the address is `PRJ-7`.
describe('ProjectWorkspacePage reads under the address PRJ-7', () => {
  let itVersion = 0;
  beforeEach(() => {
    itVersion = 0;
    get.mockReset();
    patch.mockReset();
    patch.mockResolvedValue({ data: {} });
    get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/projects/proj-1' || url === '/portfolio/projects/PRJ-7') return { data: PROJECT };
      if (url === '/portfolio/classification/all') return { data: { sources: [], categories: [], streams: [] } };
      if (url.endsWith('/effort-allocations/it')) {
        itVersion += 1;
        return { data: { version: itVersion, url } };
      }
      return { data: {} };
    });
  });

  it('reads the effort of the project by its uuid, and reads it again when the IT lead changes', async () => {
    renderPage('/portfolio/projects/PRJ-7/effort');
    const effort = await screen.findByTestId('project-effort');
    await waitFor(() => expect(effort).toHaveAttribute('data-it-version', '1'));
    fireEvent.click(screen.getByRole('button', { name: 'portfolio:workspace.project.fields.itLead' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/portfolio/projects/PRJ-7', { it_lead_id: 'u-2' }));
    await waitFor(() => expect(screen.getByTestId('project-effort')).toHaveAttribute('data-it-version', '2'));
    expect(screen.getByTestId('project-effort')).toHaveAttribute('data-project', 'proj-1');
    expect(get).toHaveBeenCalledWith('/portfolio/projects/proj-1/effort-allocations/it');
  });

  it('hands the timeline the project uuid', async () => {
    renderPage('/portfolio/projects/PRJ-7/timeline');
    expect(await screen.findByTestId('project-timeline')).toHaveAttribute('data-project', 'proj-1');
  });
});
