import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ThemeProvider } from '@mui/material/styles';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createAppTheme } from '../../../config/ThemeContext';
import { resolveBudgetColumns } from '../../../hooks/useBudgetColumns';
import { DEFAULT_BUDGET_COLUMNS } from '../../../services/budgetColumns';
import { DEFAULT_BUDGET_TILES } from '../hooks/useBudgetDashboardConfig';
import BudgetDashboardSettingsModal from './BudgetDashboardSettingsModal';
import type { useBudgetDashboardConfig } from '../hooks/useBudgetDashboardConfig';
import type { TFunction } from 'i18next';

const t = (key: string) => key;
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t }) }));
const save = vi.fn();
const reset = vi.fn();
const close = vi.fn();
const columns = resolveBudgetColumns(DEFAULT_BUDGET_COLUMNS, t as TFunction);

function renderModal(mode: 'light' | 'dark' = 'light', selected: string[] | null = null) {
  const settings = {
    config: { tiles: DEFAULT_BUDGET_TILES.map((tile) => ({ ...tile, config: tile.id === 'budget' ? { columns: selected } : {} })) },
    updateConfig: save, resetConfig: reset, isUpdating: false, isResetting: false, isLoading: false,
  } as unknown as ReturnType<typeof useBudgetDashboardConfig>;
  return render(<ThemeProvider theme={createAppTheme(mode)}><BudgetDashboardSettingsModal open onClose={close} settings={settings} columns={columns} canViewTile={() => true} /></ThemeProvider>);
}

describe('BudgetDashboardSettingsModal', () => {
  beforeEach(() => { Element.prototype.scrollIntoView = vi.fn(); save.mockReset().mockResolvedValue({}); reset.mockReset().mockResolvedValue({}); close.mockReset(); });
  it.each(['light', 'dark'] as const)('shows all tile choices and follows tenant columns by default in %s mode', (mode) => {
    renderModal(mode);
    expect(screen.getByRole('checkbox', { name: 'dashboard.budgetSettings.tenantColumns' })).toBeChecked();
    expect(screen.getAllByRole('checkbox').filter((checkbox) => !checkbox.hasAttribute('disabled'))).toHaveLength(10);
    for (const column of columns.shown) expect(screen.getByRole('checkbox', { name: column.label })).toBeDisabled();
  });
  it('selects custom columns, preserves at least one and saves a hidden tile', async () => {
    renderModal();
    fireEvent.click(screen.getByRole('checkbox', { name: 'dashboard.budgetSettings.tenantColumns' }));
    for (const column of columns.shown.slice(1)) fireEvent.click(screen.getByRole('checkbox', { name: column.label }));
    expect(screen.getByRole('checkbox', { name: columns.shown[0].label })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: columns.shown[0].label })).toBeDisabled();
    fireEvent.click(screen.getByRole('checkbox', { name: 'dashboard.dataHygiene' }));
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(save).toHaveBeenCalledWith({ tiles: expect.arrayContaining([
      expect.objectContaining({ id: 'budget', config: { columns: ['budget'] } }),
      expect.objectContaining({ id: 'hygiene', enabled: false }),
    ]) });
  });
  it('returns to tenant columns and can reset or cancel', async () => {
    renderModal('light', ['budget']);
    fireEvent.click(screen.getByRole('checkbox', { name: 'dashboard.budgetSettings.tenantColumns' }));
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith({ tiles: expect.arrayContaining([expect.objectContaining({ id: 'budget', config: { columns: null } })]) }));
    fireEvent.click(screen.getByRole('button', { name: 'dashboard.settings.resetToDefaults' }));
    await waitFor(() => expect(reset).toHaveBeenCalledOnce());
    save.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.cancel' }));
    expect(save).not.toHaveBeenCalled();
  });
  it('requires a replacement when every saved column was disabled by the tenant', () => {
    renderModal('light', ['obsolete']);
    expect(screen.getByRole('button', { name: 'buttons.save' })).toBeDisabled();
    expect(screen.getByText('dashboard.budgetSettings.atLeastOne')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: columns.shown[0].label }));
    expect(screen.getByRole('button', { name: 'buttons.save' })).toBeEnabled();
  });
  it('keeps failed saves open and presents the translated error', async () => {
    save.mockRejectedValueOnce(new Error('offline'));
    renderModal();
    fireEvent.click(screen.getByRole('button', { name: 'buttons.save' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('dashboard.budgetSettings.saveFailed');
    expect(close).not.toHaveBeenCalled();
  });
  it('exposes keyboard-accessible ordering handles and cancels a drag without saving', async () => {
    renderModal();
    const handles = screen.getAllByRole('button', { name: 'dashboard.settings.dragToReorder' });
    handles[0].focus();
    fireEvent.keyDown(handles[0], { key: ' ', code: 'Space' });
    // Keyboard ordering is based on measured rows; jsdom has zero-sized boxes.
    expect(within(screen.getByRole('dialog')).getAllByRole('button', { name: 'dashboard.settings.dragToReorder' })).toHaveLength(9);
    fireEvent.keyDown(handles[0], { key: 'Escape', code: 'Escape' });
    expect(save).not.toHaveBeenCalled();
  });
});
