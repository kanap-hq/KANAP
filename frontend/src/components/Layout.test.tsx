import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Layout from './Layout';
import { registerLeaveGuard } from '../hooks/leaveGuard';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

// Every right by default; a test may narrow it to a level per resource.
type Level = 'reader' | 'member' | 'admin';
const access = vi.hoisted(() => ({
  grants: null as Record<string, 'reader' | 'member' | 'admin'> | null,
  rank: { reader: 1, member: 3, admin: 4 } as Record<string, number>,
}));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    logout: vi.fn(),
    token: 'token',
    hasLevel: (resource: string, level: Level) => {
      if (access.grants === null) return true;
      const granted = access.grants[resource];
      return !!granted && access.rank[granted] >= access.rank[level];
    },
    claims: { isGlobalAdmin: false, isPlatformAdmin: false, isBillingAdmin: false },
    profile: { first_name: 'Ada', last_name: 'Lovelace', email: 'ada@example.com' },
    // A trial in progress: the subscription banner shows.
    subscription: { status: 'trialing', is_subscription_healthy: false, trial_days_remaining: 5 },
  }),
}));

vi.mock('../tenant/TenantContext', () => ({
  useTenant: () => ({ isPlatformHost: false, tenantName: 'Acme', logoUrl: null, useLogoInDark: false }),
}));

vi.mock('../config/FeaturesContext', () => ({
  useFeatures: () => ({
    config: {
      deploymentMode: 'multi-tenant',
      features: { billing: true, aiChat: false, aiSettings: false, sso: false, email: false },
    },
    isLoading: false,
  }),
}));

vi.mock('../config/ThemeContext', () => ({
  useThemeMode: () => ({ mode: 'light', resolvedMode: 'light', setMode: vi.fn() }),
}));

vi.mock('../ai/useAiCapabilities', () => ({
  useAiCapabilities: () => ({ data: undefined, isLoading: false, isFetching: false }),
}));

vi.mock('../ai/aiApi', () => ({
  aiAgentControlApi: { getBadges: vi.fn().mockResolvedValue({ pendingApprovals: 0 }) },
}));

vi.mock('../i18n/useLocale', () => ({ useLocale: () => 'en' }));

vi.mock('../hooks/useBusinessContributorApplicationVisibility', () => ({
  useBusinessContributorApplicationVisibility: () => ({
    isLoading: false,
    hasScopedApplicationReaderAccess: false,
    shouldHideApplications: false,
  }),
}));

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/ops/opex']}>
        <Routes>
          <Route element={<Layout />}>
            <Route path="/ops/opex" element={<div data-testid="page"><Link to="/ops/opex/1">open item</Link></div>} />
            <Route
              path="/ops/opex/:id"
              element={<div><div data-testid="column" data-primary-scroll="" tabIndex={-1}>content</div></div>}
            />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('Layout page scroller', () => {
  it('renders the page inside the bounded scroller, not directly in <main>', () => {
    const { container } = renderShell();
    const main = container.querySelector('main');
    const scroller = container.querySelector('.kanap-app-scroll');

    expect(main).toHaveClass('kanap-app-main');
    expect(scroller).not.toBeNull();
    expect(main).toContainElement(scroller as HTMLElement);
    expect(scroller).toContainElement(screen.getByTestId('page'));
  });

  it('keeps the subscription banner above the scroller so a full-height page still fits', () => {
    const { container } = renderShell();
    const main = container.querySelector('main') as HTMLElement;
    const scroller = container.querySelector('.kanap-app-scroll') as HTMLElement;
    const banner = screen.getByRole('alert');

    expect(main).toContainElement(banner);
    expect(scroller).not.toContainElement(banner);
    // Banner first, scroller after it.
    expect(banner.compareDocumentPosition(scroller) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('bounds <main> to the viewport and lets only the scroller scroll', () => {
    const { container } = renderShell();
    const main = container.querySelector('main') as HTMLElement;
    const scroller = container.querySelector('.kanap-app-scroll') as HTMLElement;

    expect(getComputedStyle(main).overflow).toBe('hidden');
    expect(getComputedStyle(scroller).overflow).toBe('auto');
    expect(getComputedStyle(scroller).minHeight).toBe('0');
  });

  it('never shrinks a page below its content, so ordinary pages scroll instead of clipping', () => {
    renderShell();
    expect(getComputedStyle(screen.getByTestId('page')).flexShrink).toBe('0');
  });

  it('after a navigation, starts at the top and focuses the workspace content column', () => {
    const { container } = renderShell();
    const scroller = container.querySelector('.kanap-app-scroll') as HTMLElement;
    expect(scroller).toHaveAttribute('tabindex', '-1');
    // A plain page: the app scroller takes keyboard focus.
    expect(document.activeElement).toBe(scroller);

    scroller.scrollTop = 300;
    const link = screen.getByRole('link', { name: 'open item' });
    link.focus();
    fireEvent.click(link);

    expect(scroller.scrollTop).toBe(0);
    expect(document.activeElement).toBe(screen.getByTestId('column'));
  });
});

describe('Layout links and a page with unsaved edits (lot 3C review)', () => {
  it('a link of the app asks the page first: stay keeps it, leave follows the link', async () => {
    const leave = vi.fn(async () => false);
    const unregister = registerLeaveGuard({ isBusy: () => true, leave });
    try {
      renderShell();
      const link = screen.getByRole('link', { name: 'open item' });
      fireEvent.click(link);
      await waitFor(() => expect(leave).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId('page')).toBeInTheDocument();

      leave.mockResolvedValueOnce(true);
      fireEvent.click(link);
      expect(await screen.findByTestId('column')).toBeInTheDocument();
    } finally {
      unregister();
    }
  });
});

describe('Layout budget management sidebar', () => {
  afterEach(() => {
    access.grants = null;
  });

  function renderSidebar(path = '/ops/opex') {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Layout />}>
              <Route path="/ops" element={<div>overview</div>} />
              <Route path="/ops/opex" element={<div>opex</div>} />
              <Route path="/ops/opex/:id" element={<div>opex item</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>,
    );
  }

  it('shows the administration entry to a budget administrator', () => {
    access.grants = { opex: 'admin', capex: 'admin', budget_ops: 'admin' };
    renderSidebar();

    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.administration' })).toHaveAttribute('href', '/ops/operations');
  });

  it('hides the administration entry from a budget member, who can use none of its pages', () => {
    access.grants = { opex: 'member', capex: 'member', budget_ops: 'reader', companies: 'reader', departments: 'member' };
    renderSidebar();

    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.opex' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'nav:sidebar.ops.administration' })).not.toBeInTheDocument();
  });

  it('selects OPEX, not Overview, on an OPEX item', () => {
    renderSidebar('/ops/opex/OPX-1');
    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.opex' })).toHaveClass('Mui-selected');
    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.overview' })).not.toHaveClass('Mui-selected');
  });

  it('selects Overview on the overview page itself', () => {
    renderSidebar('/ops');
    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.overview' })).toHaveClass('Mui-selected');
    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.opex' })).not.toHaveClass('Mui-selected');
  });

  it('does not select Overview on the OPEX list', () => {
    renderSidebar('/ops/opex');
    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.opex' })).toHaveClass('Mui-selected');
    expect(screen.getByRole('link', { name: 'nav:sidebar.ops.overview' })).not.toHaveClass('Mui-selected');
  });
});
