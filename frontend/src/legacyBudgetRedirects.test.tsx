import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const translation = vi.hoisted(() => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }));
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
const auth = vi.hoisted(() => ({
  grants: {} as Record<string, string>,
  rank: { reader: 1, member: 3, admin: 4 } as Record<string, number>,
}));
vi.mock('./auth/AuthContext', () => ({
  useAuth: () => ({
    token: 'token',
    isAuthenticating: false,
    serverUnavailable: false,
    sessionExpired: false,
    profile: { role: 'Reader', roles: [] },
    claims: { isGlobalAdmin: false, isPlatformAdmin: false, isBillingAdmin: false },
    hasLevel: (resource: string, level: string) => (auth.rank[auth.grants[resource]] ?? 0) >= auth.rank[level],
    hasAnyAccess: true,
    subscription: null,
  }),
}));
vi.mock('./tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
vi.mock('./config/FeaturesContext', () => ({
  useFeatures: () => ({ config: { features: { billing: false, aiChat: false, aiSettings: false } } }),
}));
vi.mock('./ai/useAiCapabilities', () => ({ useAiCapabilities: () => ({ isLoading: false, isFetching: false, data: undefined }) }));
vi.mock('./pages/PendingAccessPage', () => ({ default: () => null }));

import ProtectedRoute from './components/ProtectedRoute';
import BudgetOperationsLandingPage from './pages/operations/BudgetOperationsLandingPage';
import { createAppTheme } from './config/ThemeContext';
import { LEGACY_BUDGET_REDIRECTS, legacyBudgetRedirectRoutes } from './legacyBudgetRedirects';

const NEW_ROUTES = [
  '/ops/operations/currency',
  '/ops/operations/master-data-freeze',
  '/ops/operations/metrics-copy',
  '/ops/operations/freeze',
];

/** The same layout as App: redirects first, then the protected pages. */
function renderAt(path: string) {
  return render(
    <ThemeProvider theme={createAppTheme('light')}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          {legacyBudgetRedirectRoutes()}
          <Route element={<ProtectedRoute />}>
            <Route path="/ops/operations" element={<BudgetOperationsLandingPage />} />
            {NEW_ROUTES.map((route) => (
              <Route key={route} path={route} element={<div>page {route}</div>} />
            ))}
          </Route>
          <Route path="/403" element={<div>forbidden</div>} />
        </Routes>
      </MemoryRouter>
    </ThemeProvider>,
  );
}

describe('legacy budget redirects', () => {
  beforeEach(() => {
    auth.grants = { opex: 'admin', capex: 'admin', budget_ops: 'admin' };
  });

  it('sends /master-data/operations to the administration landing', () => {
    renderAt('/master-data/operations');
    expect(screen.getByRole('heading', { name: 'operations.title' })).toBeInTheDocument();
  });

  it.each([
    ['/master-data/currency', '/ops/operations/currency'],
    ['/master-data/operations/freeze', '/ops/operations/master-data-freeze'],
    ['/master-data/operations/copy', '/ops/operations/metrics-copy'],
  ])('sends %s to %s', (from, to) => {
    renderAt(from);
    expect(screen.getByText(`page ${to}`)).toBeInTheDocument();
  });

  it('covers every old path', () => {
    expect(LEGACY_BUDGET_REDIRECTS.map((r) => r.from)).toEqual([
      '/master-data/currency',
      '/master-data/operations',
      '/master-data/operations/freeze',
      '/master-data/operations/copy',
    ]);
  });
});

/** The tile links on the landing, in order. */
const tileHrefs = () => screen.getAllByRole('region')
  .flatMap((region) => within(region).getAllByRole('link'))
  .map((link) => link.getAttribute('href'));

const BUDGET_MEMBER = { opex: 'member', capex: 'member', budget_ops: 'reader', companies: 'reader', departments: 'member' };

describe('budget administration access', () => {
  it.each(['/ops/operations', '/ops/operations/'])('opens %s to a budget administrator', (path) => {
    auth.grants = { budget_ops: 'admin' };
    renderAt(path);
    expect(screen.getByRole('heading', { name: 'operations.title' })).toBeInTheDocument();
    expect(tileHrefs()).toEqual([
      '/ops/operations/currency',
      '/ops/operations/columns',
      '/ops/operations/allocation-default',
      '/ops/operations/freeze',
      '/ops/operations/master-data-freeze',
      '/ops/operations/metrics-copy',
    ]);
  });

  it('keeps the landing closed to a budget member, who can use none of its pages', () => {
    auth.grants = BUDGET_MEMBER;
    renderAt('/ops/operations');
    expect(screen.getByText('forbidden')).toBeInTheDocument();
  });

  it.each(NEW_ROUTES)('keeps %s closed to a budget member', (route) => {
    auth.grants = BUDGET_MEMBER;
    renderAt(route);
    expect(screen.getByText('forbidden')).toBeInTheDocument();
  });

  it('keeps the landing closed to a master data administrator without budget access', () => {
    auth.grants = { companies: 'admin', departments: 'admin' };
    renderAt('/ops/operations');
    expect(screen.getByText('forbidden')).toBeInTheDocument();
  });

  it('opens the master data pages to a departments administrator with budget access', () => {
    auth.grants = { ...BUDGET_MEMBER, departments: 'admin' };
    renderAt('/ops/operations/master-data-freeze');
    expect(screen.getByText('page /ops/operations/master-data-freeze')).toBeInTheDocument();
  });

  it('keeps the budget settings closed to an OPEX administrator', () => {
    auth.grants = { opex: 'admin', budget_ops: 'reader' };
    renderAt('/ops/operations/currency');
    expect(screen.getByText('forbidden')).toBeInTheDocument();
  });
});
