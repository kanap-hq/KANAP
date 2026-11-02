import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../config/ThemeContext';
import { resolveSections } from './sections';

const env = vi.hoisted(() => ({
  onboarding: undefined as undefined | Record<string, unknown>,
  budgetReader: true,
  tiles: ['my-tasks', 'projects-i-lead', 'application-compliance'],
  sections: null as null | Array<{ id: string; hidden: boolean }>,
  empty: [] as string[],
  budgetEmpty: false,
  hideEmptyTiles: undefined as boolean | undefined,
  width: 1920,
  updateConfig: vi.fn(),
  resetConfig: vi.fn(),
  updateBudget: vi.fn(),
  resetBudget: vi.fn(),
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
      return <div role="group" aria-label="nav:workspaces.budgetManagement" style={{ gridColumn: 'span 4' }}>{leading}<div data-testid="block">budget section</div></div>;
    },
    useBudgetTileAccess: () => ({ anyBudget: env.budgetReader, canViewTile: () => env.budgetReader }),
  };
});
vi.mock('./hooks/useDashboardConfig', () => ({
  useDashboardConfig: () => ({
    config: { tiles: env.tiles.map((id, index) => ({ id, enabled: true, order: index + 1, config: {} })), hideEmptyTiles: env.hideEmptyTiles, sections: env.sections },
    isLoading: false,
    updateConfig: env.updateConfig,
    resetConfig: env.resetConfig,
  }),
}));
vi.mock('./hooks/useBudgetDashboardConfig', () => ({
  useBudgetDashboardConfig: () => ({ config: { tiles: [] }, isLoading: false, updateConfig: env.updateBudget, resetConfig: env.resetBudget }),
}));
vi.mock('./hooks/useTilePermissions', () => ({
  useTilePermissions: () => ({ filterVisibleTiles: (tiles: unknown[]) => tiles, canViewTile: () => true }),
}));
vi.mock('./tiles/TileRegistry', async () => {
  const { useReportEmpty } = await import('./tiles/emptyTiles');
  const sections: Record<string, string> = {
    'my-tasks': 'work', 'recently-viewed': 'work',
    'projects-i-lead': 'portfolio', 'new-requests': 'portfolio',
    'application-compliance': 'landscape', vulnerabilities: 'landscape',
  };
  const tile = (id: string) => function Tile() {
    useReportEmpty(env.empty.includes(id));
    return <div data-testid="block">{id}</div>;
  };
  return {
    TILE_REGISTRY: Object.fromEntries(Object.entries(sections).map(([id, section]) => [id, { titleKey: id, icon: 'Task', section, configSchema: {}, defaultConfig: {} }])),
    TILE_LOADERS: Object.fromEntries(Object.keys(sections).map((id) => [id, async () => tile(id)])),
  };
});
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
/** The blocks a person sees: those of a hidden tile or section left out. */
const shown = () => screen.getAllByTestId('block').filter((block) => {
  for (let node: HTMLElement | null = block; node; node = node.parentElement) {
    if (getComputedStyle(node).display === 'none') return false;
  }
  return true;
}).map((block) => block.textContent);
const sectionNames = () => screen.getAllByRole('group').map((group) => group.getAttribute('aria-label')).filter(Boolean);
const steps = [{ key: 'x', done_at: null }];

describe('home page sections', () => {
  beforeEach(() => {
    env.onboarding = undefined;
    env.budgetReader = true;
    env.tiles = ['my-tasks', 'projects-i-lead', 'application-compliance'];
    env.sections = null;
    env.empty = [];
    env.budgetEmpty = false;
    env.hideEmptyTiles = undefined;
    env.width = 1920;
    for (const fn of [env.updateConfig, env.resetConfig, env.updateBudget, env.resetBudget]) fn.mockReset().mockResolvedValue({});
  });

  it('shows the sections in the default order without a path, each tile in its own', async () => {
    renderHome();
    await waitFor(() => expect(blocks()).toEqual(['my-tasks', 'projects-i-lead', 'application-compliance', 'budget section']));
    expect(sectionNames()).toEqual(['dashboard.sections.work', 'nav:workspaces.portfolio', 'nav:workspaces.itOperations', 'nav:workspaces.budgetManagement']);
  });

  it.each([
    ['budget', ['first steps', 'budget section', 'my-tasks', 'projects-i-lead', 'application-compliance']],
    ['cartography', ['first steps', 'application-compliance', 'my-tasks', 'projects-i-lead', 'budget section']],
    ['portfolio', ['first steps', 'projects-i-lead', 'my-tasks', 'application-compliance', 'budget section']],
  ])('puts the section of the %s path first, led by the first steps', async (angle, order) => {
    env.onboarding = { angle, steps };
    renderHome();
    await waitFor(() => expect(blocks()).toEqual(order));
  });

  it('gives the first steps to the first section when the path has no section for the person', async () => {
    env.budgetReader = false;
    env.onboarding = { angle: 'budget', steps };
    renderHome();
    await waitFor(() => expect(blocks()).toEqual(['first steps', 'my-tasks', 'projects-i-lead', 'application-compliance']));
  });

  it('follows the saved order and leaves out a hidden section', async () => {
    env.sections = [{ id: 'budget', hidden: false }, { id: 'landscape', hidden: false }, { id: 'work', hidden: true }, { id: 'portfolio', hidden: false }];
    env.onboarding = { angle: 'portfolio', steps: [] };
    renderHome();
    await waitFor(() => expect(blocks()).toEqual(['budget section', 'application-compliance', 'projects-i-lead']));
  });

  it('lets short sections share a row: each takes the columns of its tiles shown', async () => {
    env.tiles = ['my-tasks', 'recently-viewed', 'application-compliance'];
    renderHome();
    await waitFor(() => expect(blocks()).toContain('recently-viewed'));
    const work = screen.getByRole('group', { name: 'dashboard.sections.work' });
    const landscape = screen.getByRole('group', { name: 'nav:workspaces.itOperations' });
    expect(getComputedStyle(work).gridColumn).toContain('span 2');
    expect(getComputedStyle(landscape).gridColumn).toContain('span 1');
  });

  it('hides the empty tiles by default, and a section with nothing left', async () => {
    env.tiles = ['my-tasks', 'recently-viewed', 'projects-i-lead', 'application-compliance'];
    env.empty = ['recently-viewed', 'projects-i-lead'];
    renderHome();
    await waitFor(() => expect(shown()).toEqual(['my-tasks', 'application-compliance', 'budget section']));
    await waitFor(() => expect(getComputedStyle(screen.getByRole('group', { name: 'dashboard.sections.work', hidden: true })).gridColumn).toContain('span 1'));
  });

  it('shows the empty tiles with the option off', async () => {
    env.empty = ['projects-i-lead'];
    env.hideEmptyTiles = false;
    renderHome();
    await waitFor(() => expect(blocks()).toContain('projects-i-lead'));
    expect(shown()).toEqual(blocks());
  });

  it('says in one line that nothing is shown when every section is empty', async () => {
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
});

describe('customizing the home page', () => {
  beforeEach(() => {
    env.onboarding = undefined;
    env.budgetReader = true;
    env.tiles = ['my-tasks', 'projects-i-lead', 'application-compliance'];
    env.sections = null;
    env.empty = ['projects-i-lead'];
    env.budgetEmpty = false;
    env.hideEmptyTiles = undefined;
    env.width = 1920;
    for (const fn of [env.updateConfig, env.resetConfig, env.updateBudget, env.resetBudget]) fn.mockReset().mockResolvedValue({});
  });

  const customize = async () => {
    renderHome();
    await screen.findByText('my-tasks');
    fireEvent.click(screen.getByRole('button', { name: 'dashboard.customize.start' }));
  };

  it('shows every tile with its controls, the empty ones included, and the option instead of the quick actions', async () => {
    await customize();
    expect(shown()).toContain('projects-i-lead');
    expect(screen.getByRole('checkbox', { name: 'dashboard.settings.hideEmptyTiles' })).toBeChecked();
    expect(screen.queryByRole('button', { name: 'dashboard.newBudgetLine' })).not.toBeInTheDocument();
    const work = screen.getByRole('group', { name: 'dashboard.sections.work' });
    expect(within(work).getByRole('button', { name: 'dashboard.customize.hideTile' })).toBeInTheDocument();
    expect(within(work).getByLabelText('dashboard.customize.moveSection')).toBeInTheDocument();
  });

  it('hides a tile, adds another, hides a section, and saves it all on Done', async () => {
    await customize();
    const work = screen.getByRole('group', { name: 'dashboard.sections.work' });
    fireEvent.click(within(work).getByRole('button', { name: 'dashboard.customize.hideTile' }));
    expect(blocks()).not.toContain('my-tasks');
    fireEvent.click(within(work).getByRole('button', { name: 'dashboard.customize.addTile' }));
    fireEvent.click(await screen.findByRole('menuitem', { name: 'recently-viewed' }));
    await waitFor(() => expect(blocks()).toContain('recently-viewed'));
    fireEvent.click(within(screen.getByRole('group', { name: 'nav:workspaces.portfolio' })).getByRole('button', { name: 'dashboard.customize.hideSection' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'dashboard.settings.hideEmptyTiles' }));
    fireEvent.click(screen.getByRole('button', { name: 'dashboard.customize.done' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'dashboard.customize.start' })).toBeInTheDocument());
    const saved = env.updateConfig.mock.calls[0][0];
    expect(saved.hideEmptyTiles).toBe(false);
    expect(saved.sections).toEqual([
      { id: 'work', hidden: false }, { id: 'portfolio', hidden: true }, { id: 'landscape', hidden: false }, { id: 'budget', hidden: false },
    ]);
    const enabled = saved.tiles.filter((tile: { enabled: boolean }) => tile.enabled).map((tile: { id: string }) => tile.id);
    expect(enabled).toEqual(['projects-i-lead', 'application-compliance', 'recently-viewed']);
    expect(env.updateBudget).toHaveBeenCalledOnce();
  });

  it('leaves everything as it was on Cancel', async () => {
    await customize();
    fireEvent.click(within(screen.getByRole('group', { name: 'dashboard.sections.work' })).getByRole('button', { name: 'dashboard.customize.hideTile' }));
    fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
    expect(blocks()).toContain('my-tasks');
    expect(env.updateConfig).not.toHaveBeenCalled();
  });

  it('resets both lists and the layout to the defaults', async () => {
    await customize();
    fireEvent.click(screen.getByRole('button', { name: 'dashboard.settings.resetToDefaults' }));
    await waitFor(() => expect(env.resetBudget).toHaveBeenCalledOnce());
    expect(env.resetConfig).toHaveBeenCalledOnce();
  });

  it('stays in the customize mode and says so when the save fails', async () => {
    env.updateConfig.mockRejectedValueOnce(new Error('offline'));
    await customize();
    fireEvent.click(screen.getByRole('button', { name: 'dashboard.customize.done' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('dashboard.budgetSettings.saveFailed');
    expect(screen.getByRole('button', { name: 'dashboard.customize.done' })).toBeInTheDocument();
  });
});

describe('resolveSections', () => {
  it('puts the section of the path first until the person orders them', () => {
    expect(resolveSections(null, null).map((s) => s.id)).toEqual(['work', 'portfolio', 'landscape', 'budget']);
    expect(resolveSections(null, 'budget').map((s) => s.id)).toEqual(['budget', 'work', 'portfolio', 'landscape']);
    expect(resolveSections(null, 'cartography').map((s) => s.id)).toEqual(['landscape', 'work', 'portfolio', 'budget']);
  });

  it('keeps the saved order whatever the path, drops unknown or repeated ids and appends the missing ones', () => {
    const saved = [{ id: 'budget', hidden: true }, { id: 'other', hidden: false }, { id: 'budget', hidden: false }, { id: 'work', hidden: false }] as never;
    expect(resolveSections(saved, 'portfolio')).toEqual([
      { id: 'budget', hidden: true }, { id: 'work', hidden: false }, { id: 'portfolio', hidden: false }, { id: 'landscape', hidden: false },
    ]);
  });
});
