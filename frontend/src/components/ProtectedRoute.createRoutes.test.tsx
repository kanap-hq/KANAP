import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProtectedRoute from './ProtectedRoute';

const rights = vi.hoisted(() => ({
  grants: {} as Record<string, string>,
  dataAccessLimited: false,
  rank: { reader: 1, contributor: 2, member: 3, admin: 4 } as Record<string, number>,
  reservedWrites: new Set(['companies', 'departments', 'cost_centers', 'accounts', 'business_processes', 'analytics']),
}));

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }) }));
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({
    token: 'token',
    isAuthenticating: false,
    serverUnavailable: false,
    sessionExpired: false,
    profile: { role: 'Reader', roles: [] },
    claims: { isGlobalAdmin: false, isPlatformAdmin: false, isBillingAdmin: false, permissions: {} },
    hasLevel: (resource: string, level: string) => {
      if (
        rights.dataAccessLimited
        && (resource === 'ai_agents' || (rights.reservedWrites.has(resource) && level !== 'reader'))
      ) {
        return false;
      }
      return (rights.rank[rights.grants[resource]] ?? 0) >= (rights.rank[level] ?? 99);
    },
    hasAnyAccess: true,
    subscription: null,
    dataAccess: rights.dataAccessLimited
      ? { available: true, mode: 'limited', nodes: [], modules: [] }
      : { available: true, mode: 'all', nodes: [], modules: [] },
  }),
}));
vi.mock('../tenant/TenantContext', () => ({ useTenant: () => ({ isPlatformHost: false }) }));
vi.mock('../config/FeaturesContext', () => ({
  useFeatures: () => ({ config: { deploymentMode: 'multi-tenant', features: { billing: false, aiChat: false, aiSettings: false } } }),
}));
vi.mock('../ai/useAiCapabilities', () => ({ useAiCapabilities: () => ({ isLoading: false, isFetching: false, data: undefined }) }));
vi.mock('../pages/PendingAccessPage', () => ({ default: () => null }));

function ForbiddenProbe() {
  const location = useLocation();
  return <div data-testid="forbidden-state">{JSON.stringify(location.state)}</div>;
}

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route element={<ProtectedRoute />}>
          <Route path="*" element={<div>page</div>} />
        </Route>
        <Route path="/403" element={<ForbiddenProbe />} />
      </Routes>
    </MemoryRouter>,
  );
}

function expectForbidden(path: string, state: Record<string, string>) {
  renderAt(path);
  expect(screen.getByTestId('forbidden-state')).toHaveTextContent(JSON.stringify(state));
}

describe('ProtectedRoute on creation addresses', () => {
  beforeEach(() => {
    rights.grants = {};
    rights.dataAccessLimited = false;
  });

  it('sends an infrastructure reader from a connection creation to the forbidden page with the creation right', () => {
    rights.grants = { infrastructure: 'reader' };
    expectForbidden('/it/connections/new/overview', {
      from: '/it/connections/new/overview',
      resource: 'infrastructure',
      level: 'member',
    });
  });

  it('lets an infrastructure member open a connection creation', () => {
    rights.grants = { infrastructure: 'member' };
    renderAt('/it/connections/new/overview');
    expect(screen.getByText('page')).toBeInTheDocument();
  });

  it('lets an infrastructure reader open an existing connection', () => {
    rights.grants = { infrastructure: 'reader' };
    renderAt('/it/connections/0b7c9a15-1111-4e2e-9d2b-8a1a0d2e4f5a/overview');
    expect(screen.getByText('page')).toBeInTheDocument();
  });

  it('refuses an incidents reader on an incident creation with the contributor right', () => {
    rights.grants = { incidents: 'reader' };
    expectForbidden('/it/incidents/new', {
      from: '/it/incidents/new',
      resource: 'incidents',
      level: 'contributor',
    });
  });

  it('lets an incidents contributor open an incident creation', () => {
    rights.grants = { incidents: 'contributor' };
    renderAt('/it/incidents/new');
    expect(screen.getByText('page')).toBeInTheDocument();
  });

  it.each([
    ['/master-data/analytics/dimensions/new', '/master-data/analytics/dimensions/new', 'analytics'],
    ['/master-data/analytics/new/overview', '/master-data/analytics/new/overview', 'analytics'],
    ['/ops/budget/new?nature=capex', '/ops/budget/new', 'budget'],
  ])('refuses a reader on %s with the creation right of the module', (path, from, resource) => {
    rights.grants = {};
    expectForbidden(path, { from, resource, level: 'member' });
  });

  it('names no module when the person is limited by scope', () => {
    rights.grants = { companies: 'member' };
    rights.dataAccessLimited = true;
    expectForbidden('/master-data/companies/new', { from: '/master-data/companies/new' });
  });
});
