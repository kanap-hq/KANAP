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
  tiles: ['my-tasks', 'projects-i-lead', 'application-compliance'],
  empty: [] as string[],
  budgetEmpty: false,
  hideEmptyTiles: undefined as boolean | undefined,
  width: 1920,
}));

// The breakpoints as the window width says: xl from 1536 px, lg from 1200 px, md from 900 px.
window.matchMedia = ((query: string) => {
  const min = Number(/min-width:\s*([\d.]+)px/.exec(query)?.[1] ?? 0);
  return { matches: env.width >= min, media: query, onchange: null, addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false };
}) as typeof window.matchMedia;

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
vi.mock('./BudgetSection', async () => {
  const { useReportEmpty } = await import('./tiles/emptyTiles');
  return {
    default: function Section({ leading }: { leading?: React.ReactNode }) {
      useReportEmpty(env.budgetEmpty);
      return <>{leading}<div data-testid="block">budget section</div></>;
    },
    useBudgetTileAccess: () => ({ anyBudget: env.budgetReader, canViewTile: () => env.budgetReader }),
  };
});
vi.mock('./hooks/useDashboardConfig', () => ({
  useDashboardConfig: () => ({
    config: { tiles: env.tiles.map((id, index) => ({ id, enabled: true, order: index + 1, config: {} })), hideEmptyTiles: env.hideEmptyTiles },
    isLoading: false,
  }),
}));
vi.mock('./hooks/useTilePermissions', () => ({
  useTilePermissions: () => ({ filterVisibleTiles: (tiles: unknown[]) => tiles, canViewTile: () => true }),
}));
vi.mock('./tiles/TileRegistry', async () => {
  const { useReportEmpty } = await import('./tiles/emptyTiles');
  const ids = ['my-tasks', 'projects-i-lead', 'application-compliance', 'vulnerabilities', 'recently-viewed'];
  const tile = (id: string) => function Tile() {
    useReportEmpty(env.empty.includes(id));
    return <div data-testid="block">{id}</div>;
  };
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
/** The blocks a person sees: the hidden ones left out. */
const shown = () => screen.getAllByTestId('block').filter((block) => block.closest('[class*="MuiGrid-item"]') === null || getComputedStyle(block.closest('[class*="MuiGrid-item"]')!).display !== 'none').map((block) => block.textContent);
const steps = [{ key: 'x', done_at: null }];

describe('home page by onboarding path', () => {
  beforeEach(() => {
    env.onboarding = undefined;
    env.budgetReader = true;
    env.tiles = ['my-tasks', 'projects-i-lead', 'application-compliance'];
    env.empty = [];
    env.budgetEmpty = false;
    env.hideEmptyTiles = undefined;
    env.width = 1920;
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

  it('keeps the budget section after the first row on the budget path for a person who cannot read the budget', async () => {
    env.budgetReader = false;
    env.onboarding = { angle: 'budget', steps };
    renderHome();
    await waitFor(() => expect(blocks()).toEqual(['first steps', 'my-tasks', 'projects-i-lead', 'application-compliance', 'budget section']));
  });

  it('puts the budget section right after the first row: four tiles on a wide screen', async () => {
    env.tiles = ['my-tasks', 'projects-i-lead', 'application-compliance', 'vulnerabilities', 'recently-viewed'];
    renderHome();
    await waitFor(() => expect(blocks()).toEqual(['my-tasks', 'projects-i-lead', 'application-compliance', 'vulnerabilities', 'budget section', 'recently-viewed']));
  });

  it('puts it after three tiles at 1280 pixels, the first steps counting as one', async () => {
    env.width = 1280;
    env.tiles = ['my-tasks', 'projects-i-lead', 'application-compliance', 'vulnerabilities'];
    const view = renderHome();
    await waitFor(() => expect(blocks()).toEqual(['my-tasks', 'projects-i-lead', 'application-compliance', 'budget section', 'vulnerabilities']));
    view.unmount();
    env.onboarding = { angle: 'portfolio', steps };
    renderHome();
    await waitFor(() => expect(blocks()).toEqual(['first steps', 'projects-i-lead', 'my-tasks', 'budget section', 'application-compliance', 'vulnerabilities']));
  });

  it('hides the empty tiles by default, and counts only the tiles shown in the first row', async () => {
    env.tiles = ['my-tasks', 'projects-i-lead', 'application-compliance', 'vulnerabilities', 'recently-viewed'];
    env.empty = ['projects-i-lead'];
    renderHome();
    await waitFor(() => expect(blocks()).toEqual(['my-tasks', 'projects-i-lead', 'application-compliance', 'vulnerabilities', 'recently-viewed', 'budget section']));
    expect(shown()).toEqual(['my-tasks', 'application-compliance', 'vulnerabilities', 'recently-viewed', 'budget section']);
  });

  it('shows the empty tiles with the option off', async () => {
    env.empty = ['projects-i-lead'];
    env.hideEmptyTiles = false;
    renderHome();
    await waitFor(() => expect(blocks()).toEqual(['my-tasks', 'projects-i-lead', 'application-compliance', 'budget section']));
    expect(shown()).toEqual(blocks());
  });

  it('says in one line that nothing is shown when every tile and the budget section are empty', async () => {
    env.empty = ['my-tasks', 'projects-i-lead', 'application-compliance'];
    env.budgetEmpty = true;
    renderHome();
    expect(await screen.findByText('dashboard.allTilesEmpty')).toBeInTheDocument();
  });

  it('offers one budget line action, without a request or a contract action', async () => {
    renderHome();
    await screen.findByText('my-tasks');
    expect(screen.getByRole('button', { name: 'dashboard.newBudgetLine' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /newRequest|newContract|newOpexLine|newCapexLine/ })).not.toBeInTheDocument();
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
