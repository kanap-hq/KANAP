import { render, renderHook, screen } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
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
  config: { tiles: [{ id: 'my-tasks', enabled: true, order: 1, config: {} }, { id: 'vulnerabilities', enabled: true, order: 2, config: {} }] },
  updateConfig: () => Promise.resolve(), resetConfig: () => Promise.resolve(), isUpdating: false, isResetting: false,
}));
vi.mock('../hooks/useDashboardConfig', () => ({ useDashboardConfig: () => dashboard }));

function Harness() {
  const { canViewTile } = useTilePermissions();
  return <DashboardSettingsModal open onClose={() => undefined} canViewTile={canViewTile} />;
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
