import React from 'react';
import { act, render, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import ProjectWorkspacePage from './ProjectWorkspacePage';

const get = vi.hoisted(() => vi.fn());
const patch = vi.hoisted(() => vi.fn());
const panel = vi.hoisted(() => ({ props: null as any }));

const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'u-1' } }),
}));
vi.mock('../../api', () => ({ default: { get, post: vi.fn(), patch, delete: vi.fn() } }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'acme' }) }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../hooks/useProjectNav', () => ({
  useProjectNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
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
      <div role="tablist">
        {props.tabs.map((tab: any) => <button key={tab.key} role="tab" disabled={tab.disabled}>{tab.label}</button>)}
      </div>
      <main>{props.children}</main>
      <aside>{props.properties}</aside>
    </div>
  ),
}));
vi.mock('./workspace/project/ProjectPropertyPanel', () => ({
  default: (props: any) => {
    panel.props = props;
    return null;
  },
}));
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
vi.mock('../../components/workspace/MetadataUserPicker', () => ({
  default: () => null,
  formatMetadataUserName: () => '',
}));
vi.mock('../../components/history/RecordHistoryTab', () => ({
  default: (props: { table: string; recordId: string }) => <div data-testid="record-history">{`${props.table}:${props.recordId}`}</div>,
}));

const PROJECT = { id: 'proj-1', item_number: 7, name: 'Data platform', status: 'planned', origin: 'fast_track', activities: [] };

function renderPage(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[entry]}>
            <Routes>
              <Route path="/portfolio/projects/:id/:tab" element={<ProjectWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

// A project saved before a stream had to belong to its category (lot I7a of 26.12.1): saving another
// field leaves the pair out of the save; another category clears the stream in the same save.
describe('ProjectWorkspacePage, a stored stream of another category', () => {
  const CATALOG = {
    sources: [],
    categories: [{ id: 'cat-it', name: 'Infrastructure', is_active: true }, { id: 'cat-biz', name: 'Business applications', is_active: true }],
    streams: [{ id: 'ops-it', name: 'Ops', category_id: 'cat-it', is_active: true }],
  };
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
    patch.mockResolvedValue({ data: {} });
    panel.props = null;
    get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/projects/proj-1') return { data: { ...PROJECT, category_id: 'cat-biz', stream_id: 'ops-it' } };
      if (url === '/portfolio/classification/all') return { data: CATALOG };
      return { data: {} };
    });
  });

  it('hands the full lists to the panel, and saves another field alone', async () => {
    renderPage('/portfolio/projects/proj-1/summary');
    await waitFor(() => expect(panel.props?.form?.stream_id).toBe('ops-it'));
    await waitFor(() => expect(panel.props.classification).toEqual(CATALOG));
    await act(async () => { panel.props.onUpdate({ department_id: 'dep-1' }); });
    expect(patch).toHaveBeenCalledWith('/portfolio/projects/proj-1', { department_id: 'dep-1' });
  });

  it('clears the stream with another category', async () => {
    renderPage('/portfolio/projects/proj-1/summary');
    await waitFor(() => expect(panel.props?.form?.stream_id).toBe('ops-it'));
    await act(async () => { panel.props.onCategoryChange('cat-it'); });
    expect(patch).toHaveBeenCalledWith('/portfolio/projects/proj-1', { category_id: 'cat-it', stream_id: null });
  });
});
