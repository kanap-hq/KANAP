import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// A full page load of /admin/sample-data: the route must not depend on /config/public, whose
// answer comes later (or never), or the first match falls to the catch-all and leaves the page.

const features = vi.hoisted(() => ({
  isLoading: true,
  config: { deploymentMode: 'multi-tenant', features: { sampleData: false, billing: false, email: false, sso: false } } as any,
}));
vi.mock('./config/FeaturesContext', () => ({
  FeaturesProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useFeatures: () => ({ config: features.config, isLoading: features.isLoading }),
}));
vi.mock('./auth/AuthContext', () => ({ useAuth: () => ({ token: null }) }));
vi.mock('./components/ProtectedRoute', () => ({ default: () => <Outlet /> }));
vi.mock('./components/Layout', () => ({ default: () => <Outlet /> }));
vi.mock('./pages/admin/SampleDataPage', () => ({ default: () => <div>sample data page</div> }));

import App from './App';

function Where() {
  return <div data-testid="where">{useLocation().pathname}</div>;
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
      <Where />
    </MemoryRouter>,
  );
}

describe('App routes: sample data', () => {
  beforeEach(() => {
    features.isLoading = true;
    features.config = { deploymentMode: 'multi-tenant', features: { sampleData: false, billing: false, email: false, sso: false } };
  });

  it('stays on /admin/sample-data while the features are still loading', () => {
    renderAt('/admin/sample-data');
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/sample-data');
  });

  it('matches /admin/sample-data even when the features came back without the flag (the page refuses itself)', async () => {
    features.isLoading = false;
    renderAt('/admin/sample-data');
    expect(await screen.findByText('sample data page')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/admin/sample-data');
  });
});
