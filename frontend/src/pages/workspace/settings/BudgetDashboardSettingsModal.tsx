import { useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Checkbox, FormControlLabel, Typography } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent, type KeyboardCoordinateGetter } from '@dnd-kit/core';
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import KanapDialog from '../../../components/design/KanapDialog';
import type { BudgetColumns } from '../../../hooks/useBudgetColumns';
import type { DashboardTileConfig } from '../hooks/useDashboardConfig';
import type { useBudgetDashboardConfig } from '../hooks/useBudgetDashboardConfig';

const TITLE_KEYS: Record<string, string> = {
  budget: 'dashboard.budgetSnapshot', hygiene: 'dashboard.dataHygiene',
  'my-budget': 'dashboard.myBudget.title', 'my-tasks': 'dashboard.myTasks',
  renewals: 'dashboard.nextRenewals', 'top-lines': 'dashboard.topItems',
  'top-increases': 'dashboard.topIncreases', 'cost-centers': 'dashboard.byCostCenter',
  'recent-updates': 'dashboard.recentUpdates',
};

function TileRow({ tile, onToggle, children }: { tile: DashboardTileConfig; onToggle: () => void; children?: React.ReactNode }) {
  const { t } = useTranslation('common');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tile.id });
  return (
    <Box ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      sx={{ borderRadius: '6px', px: 1, py: 0.5, mb: 0.5, bgcolor: tile.enabled ? 'kanap.bg.hover' : 'transparent' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <FormControlLabel sx={{ flex: 1, mr: 0 }} control={<Checkbox size="small" checked={tile.enabled} onChange={onToggle} />} label={t(TITLE_KEYS[tile.id])} />
        <Box component="span" aria-label={t('dashboard.settings.dragToReorder')} {...attributes} {...listeners}
          sx={{ display: 'inline-flex', cursor: 'grab', touchAction: 'none', color: 'kanap.text.tertiary', p: 0.5 }}>
          <DragIndicatorIcon fontSize="small" />
        </Box>
      </Box>
      {tile.enabled && children}
    </Box>
  );
}

export default function BudgetDashboardSettingsModal({ open, onClose, settings, columns, canViewTile }: {
  open: boolean;
  onClose: () => void;
  settings: ReturnType<typeof useBudgetDashboardConfig>;
  columns: BudgetColumns;
  canViewTile: (id: string) => boolean;
}) {
  const { t } = useTranslation('common');
  const [tiles, setTiles] = useState<DashboardTileConfig[]>([]);
  const [error, setError] = useState(false);
  const [dragging, setDragging] = useState(false);
  useEffect(() => {
    if (open) { setTiles(settings.config.tiles.slice().sort((a, b) => a.order - b.order)); setError(false); }
  }, [open, settings.config.tiles]);
  const visible = tiles.filter((tile) => canViewTile(tile.id));
  const ids = useMemo(() => visible.map((tile) => tile.id), [visible]);
  // Move centers rather than edges: the Budget row is taller because it includes column choices.
  const keyboardCoordinates: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
    const step = event.code === 'ArrowDown' ? 1 : event.code === 'ArrowUp' ? -1 : 0;
    const index = ids.indexOf(String(context.over?.id ?? context.active?.id));
    const target = context.droppableRects.get(ids[index + step]);
    if (!step || index < 0 || !target || !context.collisionRect) return undefined;
    event.preventDefault();
    return { x: currentCoordinates.x, y: currentCoordinates.y + target.top + target.height / 2 - context.collisionRect.top - context.collisionRect.height / 2 };
  };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor, { coordinateGetter: keyboardCoordinates }));
  const chosen = tiles.find((tile) => tile.id === 'budget')?.config.columns as string[] | null | undefined;
  const selected = columns.shown.filter((column) => chosen == null || chosen.includes(column.key));
  const busy = settings.isUpdating || settings.isResetting;
  const setColumns = (value: string[] | null) => setTiles((prev) => prev.map((tile) => tile.id === 'budget' ? { ...tile, config: { ...tile.config, columns: value } } : tile));
  const reorder = ({ active, over }: DragEndEvent) => {
    setDragging(false);
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const ordered = arrayMove(visible, from, to);
    setTiles([...ordered, ...tiles.filter((tile) => !canViewTile(tile.id))]);
  };
  const save = async () => {
    try {
      await settings.updateConfig({ tiles: tiles.map((tile, index) => ({ ...tile, order: index + 1,
        config: tile.id === 'budget' && chosen != null && selected.length > 0 ? { ...tile.config, columns: selected.map((column) => column.key) } : tile.config })) });
      onClose();
    } catch { setError(true); }
  };
  const reset = async () => {
    try { await settings.resetConfig(); onClose(); } catch { setError(true); }
  };
  const budgetEnabled = tiles.some((tile) => tile.id === 'budget' && tile.enabled);
  return (
    <KanapDialog open={open} title={t('dashboard.budgetSettings.title')} subtitle={t('dashboard.settings.description')}
      onClose={() => { if (!busy) onClose(); }} onSave={save} saveLabel={t('buttons.save')} saveLoading={settings.isUpdating} disableEscapeKeyDown={dragging}
      saveDisabled={busy || !columns.ready || settings.isLoading || (budgetEnabled && chosen != null && selected.length === 0)}
      footerLeft={<Button variant="action" onClick={reset} disabled={busy}>{t('dashboard.settings.resetToDefaults')}</Button>}>
      {error && <Alert severity="error">{t('dashboard.budgetSettings.saveFailed')}</Alert>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragStart={() => setDragging(true)} onDragCancel={() => setDragging(false)} onDragEnd={reorder}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {visible.map((tile) => (
            <TileRow key={tile.id} tile={tile} onToggle={() => setTiles((prev) => prev.map((entry) => entry.id === tile.id ? { ...entry, enabled: !entry.enabled } : entry))}>
              {tile.id === 'budget' && (
                <Box sx={{ pl: 4, pb: 1 }}>
                  <Typography variant="caption" sx={{ color: 'kanap.text.tertiary' }}>{t('dashboard.budgetSettings.columns')}</Typography>
                  <FormControlLabel sx={{ display: 'flex' }} control={<Checkbox size="small" checked={chosen == null} onChange={(event) => setColumns(event.target.checked ? null : columns.shown.map((column) => column.key))} />} label={t('dashboard.budgetSettings.tenantColumns')} />
                  {columns.shown.map((column) => {
                    const checked = selected.some((entry) => entry.key === column.key);
                    return <FormControlLabel key={column.key} sx={{ display: 'flex' }} label={column.label}
                      control={<Checkbox size="small" checked={checked} disabled={chosen == null || (checked && selected.length === 1)} onChange={(event) => setColumns(event.target.checked ? [...selected.map((entry) => entry.key), column.key] : selected.filter((entry) => entry.key !== column.key).map((entry) => entry.key))} />} />;
                  })}
                  {chosen != null && selected.length === 0 && <Typography variant="caption" color="error">{t('dashboard.budgetSettings.atLeastOne')}</Typography>}
                </Box>
              )}
            </TileRow>
          ))}
        </SortableContext>
      </DndContext>
    </KanapDialog>
  );
}
