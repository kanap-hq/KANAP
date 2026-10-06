import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const translation = vi.hoisted(() => ({ t: (key: string) => key, i18n: { language: 'en', resolvedLanguage: 'en' } }));
vi.mock('react-i18next', () => ({ useTranslation: () => translation }));
const auth = vi.hoisted(() => ({ readable: new Set<string>() }));
vi.mock('./auth/AuthContext', () => ({
  useAuth: () => ({
    token: 'token',
    isAuthenticating: false,
    serverUnavailable: false,
    sessionExpired: false,
    profile: { role: 'Reader', roles: [] },
    claims: { isGlobalAdmin: false, isPlatformAdmin: false, isBillingAdmin: false },
    hasLevel: (resource: string) => auth.readable.has(resource),
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
    auth.readable = new Set(['opex']);
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

describe('budget administration access', () => {
  it.each(['/ops/operations', '/ops/operations/'])('opens %s to a CAPEX-only reader, with the currency tile only', (path) => {
    auth.readable = new Set(['capex']);
    renderAt(path);
    expect(screen.getByRole('heading', { name: 'operations.title' })).toBeInTheDocument();
    expect(tileHrefs()).toEqual(['/ops/operations/currency']);
    expect(screen.queryByText('operations.sections.operations')).not.toBeInTheDocument();
  });

  it('opens the landing to a budget-only reader, with the currency tile only', () => {
    auth.readable = new Set(['budget_ops']);
    renderAt('/ops/operations');
    expect(tileHrefs()).toEqual(['/ops/operations/currency']);
  });

  it('keeps the landing closed without a budget right', () => {
    auth.readable = new Set(['companies', 'departments']);
    renderAt('/ops/operations');
    expect(screen.getByText('forbidden')).toBeInTheDocument();
  });

  it.each(['budget_ops', 'opex', 'capex'])('opens the currencies to a %s reader', (resource) => {
    auth.readable = new Set([resource]);
    renderAt('/ops/operations/currency');
    expect(screen.getByText('page /ops/operations/currency')).toBeInTheDocument();
  });

  it('keeps the currencies closed without a budget right', () => {
    auth.readable = new Set(['companies']);
    renderAt('/master-data/currency');
    expect(screen.getByText('forbidden')).toBeInTheDocument();
  });

  it('keeps the other administration pages on OPEX readers', () => {
    auth.readable = new Set(['capex', 'budget_ops']);
    renderAt('/ops/operations/freeze');
    expect(screen.getByText('forbidden')).toBeInTheDocument();
  });
});
