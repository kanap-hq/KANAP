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
    </div>
  ),
}));
vi.mock('./workspace/request/RequestPropertyPanel', () => ({ default: () => null }));
vi.mock('./workspace/request/RequestSummaryTab', () => ({ default: () => <div data-testid="request-summary" /> }));
vi.mock('./workspace/request/RequestActivityTab', () => ({ default: () => <div data-testid="request-activity" /> }));
vi.mock('../../components/workspace/SendLinkButton', () => ({ default: () => null }));
vi.mock('../../components/workspace/MetadataUserPicker', () => ({
  default: () => null,
  formatMetadataUserName: () => '',
}));
vi.mock('../../components/history/RecordHistoryTab', () => ({
  default: (props: { table: string; recordId: string }) => <div data-testid="record-history">{`${props.table}:${props.recordId}`}</div>,
}));

const REQUEST = { id: 'req-1', item_number: 4, name: 'Data platform', status: 'pending_review', activities: [] };

function renderPage(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <KanapDialogProvider>
          <MemoryRouter initialEntries={[entry]}>
            <Routes>
              <Route path="/portfolio/requests/:id/:tab" element={<RequestWorkspacePage />} />
            </Routes>
          </MemoryRouter>
        </KanapDialogProvider>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

describe('RequestWorkspacePage history', () => {
  beforeEach(() => {
    get.mockReset();
    get.mockImplementation(async (url: string) => {
      if (url === '/portfolio/requests/req-1') return { data: REQUEST };
      if (url === '/portfolio/classification/all') return { data: { sources: [], categories: [], streams: [] } };
      return { data: {} };
    });
  });

  it('puts the History tab last and renders the request history on it', async () => {
    renderPage('/portfolio/requests/req-1/history');
    expect(await screen.findByTestId('record-history')).toHaveTextContent('portfolio_requests:req-1');
    const tabs = screen.getAllByRole('tab');
    expect(tabs[tabs.length - 1]).toHaveTextContent('portfolio:labels.history');
    expect((tabs[tabs.length - 1] as HTMLButtonElement).disabled).toBe(false);
    expect(screen.queryByTestId('request-summary')).toBeNull();
  });

  it('disables the History tab while the request is created, and shows no history', async () => {
    renderPage('/portfolio/requests/new/summary');
    expect(await screen.findByTestId('request-summary')).toBeInTheDocument();
    const history = screen.getByRole('tab', { name: 'portfolio:labels.history' }) as HTMLButtonElement;
    expect(history.disabled).toBe(true);
    expect(screen.queryByTestId('record-history')).toBeNull();
  });
});
