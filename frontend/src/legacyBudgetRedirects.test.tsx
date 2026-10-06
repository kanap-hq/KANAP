import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
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
import { LEGACY_BUDGET_REDIRECTS, legacyBudgetRedirectRoutes } from './legacyBudgetRedirects';

const NEW_ROUTES = [
  '/ops/operations',
  '/ops/operations/currency',
  '/ops/operations/master-data-freeze',
  '/ops/operations/metrics-copy',
  '/ops/operations/freeze',
];

/** The same layout as App: redirects first, then the protected pages. */
function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        {legacyBudgetRedirectRoutes()}
        <Route element={<ProtectedRoute />}>
          {NEW_ROUTES.map((route) => (
            <Route key={route} path={route} element={<div>page {route}</div>} />
          ))}
        </Route>
        <Route path="/403" element={<div>forbidden</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('legacy budget redirects', () => {
  beforeEach(() => {
    auth.readable = new Set(['opex']);
  });

  it.each([
    ['/master-data/currency', '/ops/operations/currency'],
    ['/master-data/operations', '/ops/operations'],
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

describe('budget administration access', () => {
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
