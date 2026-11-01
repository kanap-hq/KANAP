import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { orderTilesForAngle } from './angleLayout';

const env = vi.hoisted(() => ({
  onboarding: undefined as undefined | Record<string, unknown>,
  budgetReader: true,
}));

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../api', () => ({ default: { get: vi.fn().mockResolvedValue({ data: [] }) } }));
vi.mock('../../auth/AuthContext', () => ({
  useAuth: () => ({
    hasLevel: (resource: string) => !['budget', 'contracts'].includes(resource) || env.budgetReader,
    profile: { id: 'u1', first_name: 'Ada' },
  }),
}));
vi.mock('../../tenant/TenantContext', () => ({ useTenant: () => ({ tenantSlug: 'acme', isPlatformHost: false }) }));
vi.mock('../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { deploymentMode: 'multi-tenant', features: {} } }) }));
vi.mock('../../ai/useAiCapabilities', () => ({ useAiCapabilities: () => ({ data: undefined }) }));
vi.mock('../../components/onboarding/useOnboarding', () => ({ useOnboarding: () => ({ state: env.onboarding }) }));
vi.mock('../../components/onboarding/OnboardingStatusLine', () => ({ default: () => null }));
vi.mock('../../components/onboarding/FirstStepsTile', () => ({
  default: () => <div data-testid="block">first steps</div>,
  firstStepsShown: (state: { steps?: unknown[] } | undefined) => !!state?.steps?.length,
}));
vi.mock('../admin/sample-data/SampleDataBanner', () => ({ default: () => null }));
vi.mock('./BudgetSection', () => ({
  default: ({ leading }: { leading?: React.ReactNode }) => (
    <>{leading}<div data-testid="block">budget section</div></>
  ),
}));
vi.mock('./hooks/useDashboardConfig', () => ({
  useDashboardConfig: () => ({
    config: { tiles: ['my-tasks', 'projects-i-lead', 'application-compliance'].map((id, index) => ({ id, enabled: true, order: index + 1, config: {} })) },
    isLoading: false,
  }),
}));
vi.mock('./hooks/useTilePermissions', () => ({
  useTilePermissions: () => ({ filterVisibleTiles: (tiles: unknown[]) => tiles, canViewTile: () => true }),
}));
vi.mock('./tiles/TileRegistry', () => {
  const ids = ['my-tasks', 'projects-i-lead', 'application-compliance'];
  const tile = (id: string) => () => <div data-testid="block">{id}</div>;
  return {
    TILE_REGISTRY: Object.fromEntries(ids.map((id) => [id, { titleKey: id, icon: 'Task' }])),
    TILE_LOADERS: Object.fromEntries(ids.map((id) => [id, async () => tile(id)])),
  };
});
vi.mock('./settings/DashboardSettingsModal', () => ({ default: () => null }));
vi.mock('./actions/QuickLogTimeModal', () => ({ default: () => null }));

import WorkspaceDashboardPage from './WorkspaceDashboardPage';

function renderHome() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ThemeProvider theme={createAppTheme('light')}>
        <MemoryRouter><WorkspaceDashboardPage /></MemoryRouter>
      </ThemeProvider>
    </QueryClientProvider>,
  );
}

const blocks = () => screen.getAllByTestId('block').map((block) => block.textContent);
const steps = [{ key: 'x', done_at: null }];

describe('home page by onboarding path', () => {
  beforeEach(() => {
    env.onboarding = undefined;
    env.budgetReader = true;
  });

  it('keeps the saved order, then the budget section, without a path', async () => {
    renderHome();
    await waitFor(() => expect(blocks()).toEqual(['my-tasks', 'projects-i-lead', 'application-compliance', 'budget section']));
  });

  it('puts the budget section first, the first steps leading it, for the budget path', async () => {
    env.onboarding = { angle: 'budget', steps };
    renderHome();
    await waitFor(() => expect(blocks()).toEqual(['first steps', 'budget section', 'my-tasks', 'projects-i-lead', 'application-compliance']));
  });

  it('keeps the budget section after the tiles on the budget path for a person who cannot read the budget', async () => {
    env.budgetReader = false;
    env.onboarding = { angle: 'budget', steps };
    renderHome();
    await waitFor(() => expect(blocks()).toEqual(['first steps', 'my-tasks', 'projects-i-lead', 'application-compliance', 'budget section']));
  });

  it('puts the IT landscape tiles first for the IT landscape path', async () => {
    env.onboarding = { angle: 'cartography', steps };
    renderHome();
    await waitFor(() => expect(blocks()).toEqual(['first steps', 'application-compliance', 'my-tasks', 'projects-i-lead', 'budget section']));
  });
});

describe('orderTilesForAngle', () => {
  const tiles = ['my-tasks', 'new-requests', 'vulnerabilities', 'projects-i-lead'].map((id, index) => ({ id, order: index }));

  it('keeps the saved order within each group', () => {
    expect(orderTilesForAngle(tiles, 'portfolio').map((t) => t.id)).toEqual(['new-requests', 'projects-i-lead', 'my-tasks', 'vulnerabilities']);
    expect(orderTilesForAngle(tiles, 'cartography').map((t) => t.id)).toEqual(['vulnerabilities', 'my-tasks', 'new-requests', 'projects-i-lead']);
    expect(orderTilesForAngle(tiles, null).map((t) => t.id)).toEqual(['my-tasks', 'new-requests', 'vulnerabilities', 'projects-i-lead']);
  });
});
