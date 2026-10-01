import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';
import Layout from './Layout';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    logout: vi.fn(),
    token: 'token',
    hasLevel: () => true,
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
