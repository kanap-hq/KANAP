import { fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { resolveBudgetColumns } from '../../../hooks/useBudgetColumns';
import { DEFAULT_BUDGET_COLUMNS } from '../../../services/budgetColumns';
import { DEFAULT_BUDGET_TILES } from '../hooks/useBudgetDashboardConfig';
import type { TFunction } from 'i18next';
import { useTilePermissions } from '../hooks/useTilePermissions';
import DashboardSettingsModal from './DashboardSettingsModal';

const t = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));

const state = vi.hoisted(() => ({
  levels: {} as Record<string, string>,
  features: { vulnerabilityFeed: true } as Record<string, boolean>,
}));
const RANK = { reader: 1, contributor: 2, member: 3, admin: 4 } as const;
vi.mock('../../../auth/AuthContext', () => ({
  useAuth: () => ({ hasLevel }),
}));
vi.mock('../../../config/FeaturesContext', () => ({ useFeatures: () => ({ config: { features: state.features }, isLoading: false }) }));
// `hasLevel` stable across renders, as the real context's.
const hasLevel = (resource: string, level: keyof typeof RANK) => {
  const held = state.levels[resource] as keyof typeof RANK | undefined;
  return !!held && RANK[held] >= RANK[level];
};
// One stable object: the modal copies `config.tiles` into its state whenever it changes.
const dashboard = vi.hoisted(() => ({
  config: { tiles: [{ id: 'my-tasks', enabled: true, order: 1, config: {} }, { id: 'vulnerabilities', enabled: true, order: 2, config: {} }] } as { tiles: any[]; hideEmptyTiles?: boolean },
  updateConfig: vi.fn(), resetConfig: vi.fn(), isUpdating: false, isResetting: false,
}));
vi.mock('../hooks/useDashboardConfig', () => ({ useDashboardConfig: () => dashboard }));
const budget = vi.hoisted(() => ({
  config: { tiles: [] as any[] },
  updateConfig: vi.fn(), resetConfig: vi.fn(), isUpdating: false, isResetting: false, isLoading: false,
}));
vi.mock('../hooks/useBudgetDashboardConfig', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/useBudgetDashboardConfig')>()),
  useBudgetDashboardConfig: () => budget,
}));
const columns = resolveBudgetColumns(DEFAULT_BUDGET_COLUMNS, t as unknown as TFunction);
vi.mock('../../../hooks/useBudgetColumns', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../hooks/useBudgetColumns')>()),
  useBudgetColumns: () => columns,
}));
// The budget section's rights, without its data hooks.
vi.mock('../BudgetSection', () => ({
  ON_HOME_PAGE_ALREADY: new Set(['my-tasks']),
  useBudgetTileAccess: () => ({
    anyBudget: hasLevel('budget', 'reader') || hasLevel('contracts', 'reader'),
    canViewTile: (id: string) => (id === 'my-tasks' ? hasLevel('tasks', 'reader') : id === 'renewals' ? hasLevel('contracts', 'reader') : hasLevel('budget', 'reader')),
  }),
}));

const close = vi.fn();
function Harness() {
  const { canViewTile } = useTilePermissions();
  return <DashboardSettingsModal open onClose={close} canViewTile={canViewTile} />;
}

function renderModal(mode: 'light' | 'dark' = 'light') {
  return render(<ThemeProvider theme={createAppTheme(mode)}><Harness /></ThemeProvider>);
}

describe('canViewTile with a required feature', () => {
  beforeEach(() => {
    state.levels = { infrastructure: 'reader', tasks: 'reader' };
    state.features = { vulnerabilityFeed: true };
  });

  it('shows the vulnerabilities tile to an infrastructure reader with the feed on', () => {
    const { result } = renderHook(() => useTilePermissions());
    expect(result.current.canViewTile('vulnerabilities')).toBe(true);
  });

  it('hides it with the feed off, whatever the rights', () => {
    state.features = { vulnerabilityFeed: false };
    state.levels = { infrastructure: 'admin' };
    const { result } = renderHook(() => useTilePermissions());
    expect(result.current.canViewTile('vulnerabilities')).toBe(false);
    expect(result.current.availableTileIds).not.toContain('vulnerabilities');
  });

  it('hides it without the infrastructure read right', () => {
    state.levels = { tasks: 'reader' };
    const { result } = renderHook(() => useTilePermissions());
    expect(result.current.canViewTile('vulnerabilities')).toBe(false);
    expect(result.current.canViewTile('my-tasks')).toBe(true);
  });
});

describe('DashboardSettingsModal', () => {
  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    state.levels = { infrastructure: 'reader', tasks: 'reader' };
    state.features = { vulnerabilityFeed: true };
  });

  it.each(['light', 'dark'] as const)('offers the vulnerabilities tile with the feed on (%s)', (mode) => {
    renderModal(mode);
    expect(screen.getByRole('checkbox', { name: 'dashboard.tiles.vulnerabilities' })).toBeChecked();
  });

  it('leaves it out with the feed off', () => {
    state.features = { vulnerabilityFeed: false };
    renderModal();
    expect(screen.getByRole('checkbox', { name: 'dashboard.myTasks' })).toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'dashboard.tiles.vulnerabilities' })).not.toBeInTheDocument();
  });
});

describe('DashboardSettingsModal: one screen for every home tile', () => {
  const budgetGroup = () => screen.getByRole('region', { name: 'nav:workspaces.budgetManagement' });
  const setBudgetTiles = (selected: string[] | null = null) => {
    budget.config = { tiles: DEFAULT_BUDGET_TILES.map((tile) => ({ ...tile, config: tile.id === 'budget' ? { columns: selected } : {} })) };
  };

  beforeEach(() => {
    Element.prototype.scrollIntoView = vi.fn();
    state.levels = { infrastructure: 'reader', tasks: 'reader', budget: 'reader', contracts: 'reader' };
    state.features = { vulnerabilityFeed: true };
    dashboard.config = { tiles: [{ id: 'my-tasks', enabled: true, order: 1, config: {} }, { id: 'vulnerabilities', enabled: true, order: 2, config: {} }] };
    dashboard.updateConfig.mockReset().mockResolvedValue({});
    dashboard.resetConfig.mockReset().mockResolvedValue({});
    budget.updateConfig.mockReset().mockResolvedValue({});
    budget.resetConfig.mockReset().mockResolvedValue({});
    setBudgetTiles();
    close.mockReset();
  });

  it.each(['light', 'dark'] as const)('lists the budget tiles under their own title, the home page\'s My tasks left out (%s)', (mode) => {
    renderModal(mode);
    const group = budgetGroup();
    expect(within(group).getAllByRole('checkbox', { name: /^dashboard\.(?!budgetSettings)/ }).map((box) => box.getAttribute('aria-label'))).toEqual([
      'dashboard.budgetSnapshot', 'dashboard.topItems', 'dashboard.dataHygiene', 'dashboard.myBudget.title',
      'dashboard.nextRenewals', 'dashboard.topIncreases', 'dashboard.byCostCenter', 'dashboard.recentUpdates',
    ]);
    expect(within(group).getByRole('checkbox', { name: 'dashboard.budgetSettings.tenantColumns' })).toBeChecked();
    for (const column of columns.shown) expect(within(group).getByRole('checkbox', { name: column.label })).toBeDisabled();
  });

  it('offers the contract tile only to a contract reader, and no budget group without either right', () => {
    state.levels = { tasks: 'reader', contracts: 'reader' };
    const view = renderModal();
    expect(within(budgetGroup()).getAllByRole('checkbox').map((box) => box.getAttribute('aria-label'))).toEqual(['dashboard.nextRenewals']);
    view.unmount();
    state.levels = { tasks: 'reader' };
    renderModal();
    expect(screen.queryByRole('region', { name: 'nav:workspaces.budgetManagement' })).not.toBeInTheDocument();
  });

  it('hides the empty tiles by default and saves the option with the home tiles, the budget tiles to their own settings', async () => {
    renderModal();
    const option = screen.getByRole('checkbox', { name: 'dashboard.settings.hideEmptyTiles' });
    expect(option).toBeChecked();
    fireEvent.click(option);
    fireEvent.click(within(budgetGroup()).getByRole('checkbox', { name: 'dashboard.dataHygiene' }));
    fireEvent.click(within(budgetGroup()).getByRole('checkbox', { name: 'dashboard.budgetSettings.tenantColumns' }));
    for (const column of columns.shown.slice(1)) fireEvent.click(within(budgetGroup()).getByRole('checkbox', { name: column.label }));
    expect(within(budgetGroup()).getByRole('checkbox', { name: columns.shown[0].label })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(dashboard.updateConfig).toHaveBeenCalledWith(expect.objectContaining({ hideEmptyTiles: false }));
    expect(budget.updateConfig).toHaveBeenCalledWith({ tiles: expect.arrayContaining([
      expect.objectContaining({ id: 'budget', config: { columns: [columns.shown[0].key] } }),
      expect.objectContaining({ id: 'hygiene', enabled: false }),
    ]) });
  });

  it('shows the option as saved', () => {
    dashboard.config = { ...dashboard.config, hideEmptyTiles: false };
    renderModal();
    expect(screen.getByRole('checkbox', { name: 'dashboard.settings.hideEmptyTiles' })).not.toBeChecked();
  });

  it('saves the home tiles only for a person without the budget', async () => {
    state.levels = { tasks: 'reader' };
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(dashboard.updateConfig).toHaveBeenCalledOnce();
    expect(budget.updateConfig).not.toHaveBeenCalled();
  });

  it('resets both lists to their defaults', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'dashboard.settings.resetToDefaults' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(dashboard.resetConfig).toHaveBeenCalledOnce();
    expect(budget.resetConfig).toHaveBeenCalledOnce();
  });

  it('requires a replacement when every saved column was disabled by the workspace', () => {
    setBudgetTiles(['obsolete']);
    renderModal();
    expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
    expect(screen.getByText('dashboard.budgetSettings.atLeastOne')).toBeInTheDocument();
    fireEvent.click(within(budgetGroup()).getByRole('checkbox', { name: columns.shown[0].label }));
    expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled();
  });

  it('stays open and says so when a save fails', async () => {
    budget.updateConfig.mockRejectedValueOnce(new Error('offline'));
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('dashboard.budgetSettings.saveFailed');
    expect(close).not.toHaveBeenCalled();
  });

  it('offers a keyboard handle on every row of both lists', () => {
    renderModal();
    const handles = screen.getAllByRole('button', { name: 'dashboard.settings.dragToReorder' });
    handles[0].focus();
    fireEvent.keyDown(handles[0], { key: ' ', code: 'Space' });
    fireEvent.keyDown(handles[0], { key: 'Escape', code: 'Escape' });
    expect(within(budgetGroup()).getAllByRole('button', { name: 'dashboard.settings.dragToReorder' })).toHaveLength(8);
    expect(dashboard.updateConfig).not.toHaveBeenCalled();
  });
});
