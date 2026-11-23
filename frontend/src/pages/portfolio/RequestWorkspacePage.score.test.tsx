import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { KanapDialogProvider } from '../../components/design';
import { enabledCriterionIdsQueryKey } from './useEnabledCriterionIds';
import RequestWorkspacePage from './RequestWorkspacePage';

const get = vi.hoisted(() => vi.fn());

const stableT = (key: string) => key;
vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: () => undefined },
  useTranslation: () => ({ t: stableT, i18n: { language: 'en', resolvedLanguage: 'en' } }),
}));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel: () => true, profile: { id: 'u-1' } }),
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
  default: (props: { title?: string; titleFallback?: string; metadata?: React.ReactNode; children?: React.ReactNode }) => (
    <div>
      <h1>{props.title || props.titleFallback}</h1>
      <div data-testid="metadata">{props.metadata}</div>
      <main>{props.children}</main>
    </div>
  ),
}));
vi.mock('./workspace/request/RequestPropertyPanel', () => ({ default: () => null }));
vi.mock('./workspace/request/RequestSummaryTab', () => ({ default: () => null }));
vi.mock('./workspace/request/RequestActivityTab', () => ({ default: () => null }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/workspace/MetadataUserPicker', () => ({
  default: () => null,
  formatMetadataUserName: () => '',
}));
vi.mock('../../components/history/RecordHistoryTab', () => ({ default: () => null }));

const CRITERIA = [
  { id: 'c-value', enabled: true },
  { id: 'c-cost', enabled: true },
  { id: 'c-old', enabled: false },
];

const baseRequest = {
  id: 'req-1',
  item_number: 4,
  name: 'Data platform',
  status: 'pending_review',
  activities: [],
  priority_score: 50,
  priority_override: false,
  override_value: null as number | null,
  criteria_values: {} as Record<string, string>,
};

let request = { ...baseRequest };

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return client.prefetchQuery({
    queryKey: enabledCriterionIdsQueryKey,
    queryFn: async () => ['c-value', 'c-cost'],
  }).then(() => {
    render(
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
  });
}

describe('RequestWorkspacePage priority', () => {
  beforeEach(() => {
    request = { ...baseRequest, criteria_values: {} };
    get.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/requests/req-1') return { data: request };
      if (url === '/portfolio/criteria') return { data: CRITERIA };
      if (url === '/portfolio/classification/all') return { data: { sources: [], categories: [], streams: [] } };
      if (url === '/portfolio/settings') return { data: { mandatory_bypass_enabled: false } };
      return { data: {} };
    });
  });

  it('shows no priority in the header when no enabled criterion is answered', async () => {
    await renderPage();
    const meta = within(await screen.findByTestId('metadata'));
    expect(await screen.findByRole('heading', { name: 'Data platform' })).toBeInTheDocument();
    expect(meta.queryByText('50')).toBeNull();
  });

  it('shows no priority when the only answer belongs to a disabled criterion', async () => {
    request = { ...baseRequest, priority_score: 40, criteria_values: { 'c-old': 'v-b' } };
    await renderPage();
    const meta = within(await screen.findByTestId('metadata'));
    expect(await screen.findByRole('heading', { name: 'Data platform' })).toBeInTheDocument();
    expect(meta.queryByText('40')).toBeNull();
  });

  it('shows the score in the header once an enabled criterion is answered', async () => {
    request = { ...baseRequest, priority_score: 100, criteria_values: { 'c-value': 'v-high' } };
    await renderPage();
    const meta = within(await screen.findByTestId('metadata'));
    expect(await meta.findByText('100')).toBeInTheDocument();
  });

  it('shows the override value in the header when no criterion is answered', async () => {
    request = {
      ...baseRequest,
      priority_score: 50,
      priority_override: true,
      override_value: 72,
      criteria_values: {},
    };
    await renderPage();
    const meta = within(await screen.findByTestId('metadata'));
    expect(await meta.findByText('72')).toBeInTheDocument();
    expect(meta.queryByText('50')).toBeNull();
  });
});
