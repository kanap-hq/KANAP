import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import RequestWorkspacePage from './RequestWorkspacePage';

const get = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ projects: 'member' as string | undefined }));

const RANK: Record<string, number> = { reader: 1, contributor: 2, member: 3, manager: 3, admin: 4 };
const stableT = (key: string) => key;

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string, level: string) => {
      if (resource === 'portfolio_requests') return (RANK.admin ?? 0) >= (RANK[level] ?? 99);
      if (resource !== 'portfolio_projects') return false;
      const current = auth.projects ? RANK[auth.projects] ?? 0 : 0;
      return current >= (RANK[level] ?? 99);
    },
    profile: { id: 'u-1' },
  }),
}));
vi.mock('../../api', () => ({ default: { get, post: vi.fn(), patch: vi.fn(), delete: vi.fn() } }));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'acme' }) }));
vi.mock('../../i18n/useLocale', () => ({ useLocale: () => 'en' }));
vi.mock('../../hooks/useRequestNav', () => ({
  useRequestNav: () => ({ total: 0, index: 0, hasPrev: false, hasNext: false, prevId: null, nextId: null }),
}));
vi.mock('../../hooks/useClassificationDefaults', () => ({
  useClassificationDefaults: () => ({ data: null, isLoading: false }),
}));
vi.mock('../workspace/hooks/useRecentlyViewed', () => ({ useRecentlyViewed: () => ({ addToRecent: () => undefined }) }));
vi.mock('./workspace/portfolioRelations', () => ({
  portfolioLinksKey: (entity: string, id: string) => ['portfolio-links', entity, id],
  usePortfolioRelationsBadge: () => 0,
}));
vi.mock('./workspace/PortfolioDetailWorkspaceShell', () => ({
  default: (props: { title?: string; titleFallback?: string; actions?: React.ReactNode }) => (
    <div>
      <h1>{props.title || props.titleFallback}</h1>
      <div data-testid="header-actions">{props.actions}</div>
    </div>
  ),
}));
vi.mock('./workspace/request/RequestPropertyPanel', () => ({ default: () => null }));
vi.mock('./workspace/request/RequestSummaryTab', () => ({ default: () => <div data-testid="request-summary" /> }));
vi.mock('./workspace/request/RequestActivityTab', () => ({ default: () => null }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/workspace/MetadataUserPicker', () => ({
  default: () => null,
  formatMetadataUserName: () => '',
}));
vi.mock('../../components/history/RecordHistoryTab', () => ({ default: () => null }));

const CONVERT = 'portfolio:actions.convertToProject';

function request(status: string) {
  return { id: 'req-1', item_number: 4, name: 'Data platform', status, activities: [], resulting_projects: [] };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={['/portfolio/requests/req-1/summary']}>
            <Routes>
              <Route path="/portfolio/requests/:id/:tab" element={<RequestWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('RequestWorkspacePage convert to project', () => {
  beforeEach(() => {
    auth.projects = 'member';
    get.mockReset();
  });

  async function open(status: string) {
    get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/requests/req-1') return { data: request(status) };
      if (url === '/portfolio/classification/all') return { data: { sources: [], categories: [], streams: [] } };
      return { data: {} };
    });
    renderPage();
    expect(await screen.findByRole('button', { name: 'common:buttons.close' })).toBeInTheDocument();
  }

  it('offers Convert to project on an approved request when the person may create projects', async () => {
    await open('approved');
    expect(screen.getByRole('button', { name: CONVERT })).toBeInTheDocument();
  });

  it('hides Convert to project on an approved request without the projects member level', async () => {
    auth.projects = 'reader';
    await open('approved');
    expect(screen.queryByRole('button', { name: CONVERT })).toBeNull();
  });

  it('hides Convert to project on a converted request', async () => {
    auth.projects = 'admin';
    await open('converted');
    expect(screen.queryByRole('button', { name: CONVERT })).toBeNull();
  });
});
