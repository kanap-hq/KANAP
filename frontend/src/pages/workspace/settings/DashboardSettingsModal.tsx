import { useState, useEffect, useMemo } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  FormControlLabel,
  MenuItem,
  Select,
  Switch,
  TextField,
  Typography,
  Box,
} from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type KeyboardCoordinateGetter,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import KanapDialog from '../../../components/design/KanapDialog';
import { useBudgetColumns } from '../../../hooks/useBudgetColumns';
import { useDashboardConfig, DashboardTileConfig } from '../hooks/useDashboardConfig';
import { useBudgetDashboardConfig } from '../hooks/useBudgetDashboardConfig';
import { ON_HOME_PAGE_ALREADY, useBudgetTileAccess } from '../BudgetSection';
import { TILE_REGISTRY, type ConfigFieldSchema } from '../tiles/TileRegistry';
import { TILE_ICONS } from '../tiles/DashboardTile';
import { drawerMenuItemSx, inlineControlSx } from '../../../theme/formSx';

interface DashboardSettingsModalProps {
  open: boolean;
  onClose: () => void;
  canViewTile: (tileId: string) => boolean;
}

/** The budget tiles: their name and icon, as the budget section draws them. */
const BUDGET_TILES: Record<string, { titleKey: string; icon: string }> = {
  budget: { titleKey: 'dashboard.budgetSnapshot', icon: 'AccountBalanceWallet' },
  hygiene: { titleKey: 'dashboard.dataHygiene', icon: 'ReportProblemOutlined' },
  'my-budget': { titleKey: 'dashboard.myBudget.title', icon: 'VerifiedUser' },
  renewals: { titleKey: 'dashboard.nextRenewals', icon: 'EventAvailable' },
  'top-lines': { titleKey: 'dashboard.topItems', icon: 'Leaderboard' },
  'top-increases': { titleKey: 'dashboard.topIncreases', icon: 'TrendingUp' },
  'cost-centers': { titleKey: 'dashboard.byCostCenter', icon: 'Groups' },
  'recent-updates': { titleKey: 'dashboard.recentUpdates', icon: 'Update' },
};

const optionValueSx = { width: 72, '& input': { fontSize: 13, py: 0.5, textAlign: 'right' } } as const;

/** One option of a tile (max items, days, scope…) rendered inline: label on the left, compact control on the right. */
function TileOption({ name, schema, value, onChange }: {
  name: string;
  schema: ConfigFieldSchema;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const { t } = useTranslation('common');
  const label = t(schema.labelKey);
  let control: React.ReactNode;
  if (schema.type === 'boolean') {
    control = <Switch size="small" checked={value !== false} onChange={(event) => onChange(event.target.checked)} inputProps={{ 'aria-label': label }} />;
  } else if (schema.type === 'select') {
    control = (
      <Select
        variant="standard"
        value={String(value ?? schema.options?.[0] ?? '')}
        onChange={(event) => onChange(event.target.value)}
        sx={{ ...inlineControlSx, fontSize: 13 }}
        inputProps={{ 'aria-label': label }}
      >
        {(schema.options || []).map((option) => (
          <MenuItem key={option} value={option} sx={drawerMenuItemSx}>
            {schema.optionLabelKey ? t(`${schema.optionLabelKey}.${option}`) : option}
          </MenuItem>
        ))}
      </Select>
    );
  } else {
    control = (
      <TextField
        variant="standard"
        type="number"
        value={typeof value === 'number' ? value : ''}
        onChange={(event) => {
          const next = Number(event.target.value);
          if (!Number.isFinite(next)) return;
          const min = schema.min ?? 1;
          const max = schema.max ?? 100;
          onChange(Math.max(min, Math.min(max, Math.round(next))));
        }}
        inputProps={{ min: schema.min, max: schema.max, 'aria-label': label }}
        sx={optionValueSx}
      />
    );
  }
  return (
    <Box key={name} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2, py: 0.25 }}>
      <Typography variant="caption" sx={{ color: 'kanap.text.tertiary', fontSize: 12 }}>{label}</Typography>
      {control}
    </Box>
  );
}

/** A tile in the list: its checkbox, icon and name, the drag handle, and its options while it is on. */
function SortableTileRow({ id, enabled, titleKey, icon, onToggle, children }: {
  id: string;
  enabled: boolean;
  titleKey: string;
  icon: string;
  onToggle: () => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation('common');
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const IconComponent = TILE_ICONS[icon] || TILE_ICONS.Task;

  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      sx={{
        borderRadius: '6px',
        px: 1,
        py: 0.5,
        mb: 0.5,
        bgcolor: enabled ? 'kanap.bg.hover' : 'transparent',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Checkbox edge="start" size="small" checked={enabled} onChange={onToggle} inputProps={{ 'aria-label': t(titleKey) }} />
        <IconComponent fontSize="small" sx={{ color: 'text.secondary', mr: 0.5 }} />
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>{t(titleKey)}</Typography>
        <Box
          component="span"
          aria-label={t('dashboard.settings.dragToReorder')}
          sx={{ display: 'inline-flex', cursor: 'grab', touchAction: 'none', color: 'kanap.text.tertiary', p: 0.5 }}
          {...attributes}
          {...listeners}
        >
          <DragIndicatorIcon fontSize="small" />
        </Box>
      </Box>
      {enabled && children}
    </Box>
  );
}

/** The tiles in their saved order, with those the person may not see kept at the end. */
function reorder(tiles: DashboardTileConfig[], canView: (id: string) => boolean, { active, over }: DragEndEvent) {
  if (!over || active.id === over.id) return tiles;
  const visible = tiles.filter((tile) => canView(tile.id));
  const ids = visible.map((tile) => tile.id);
  const from = ids.indexOf(String(active.id));
  const to = ids.indexOf(String(over.id));
  if (from < 0 || to < 0) return tiles;
  return [...arrayMove(visible, from, to), ...tiles.filter((tile) => !canView(tile.id))];
}

/**
 * The settings of the whole home page: the option that leaves out the empty tiles, the home tiles,
 * then the budget tiles for those who read the budget or the contracts. Each list saves to its own
 * configuration.
 */
export default function DashboardSettingsModal({
  open,
  onClose,
  canViewTile,
}: DashboardSettingsModalProps) {
  const { config, updateConfig, resetConfig, isUpdating, isResetting } =
    useDashboardConfig();
  const budgetSettings = useBudgetDashboardConfig();
  const columns = useBudgetColumns();
  const budgetAccess = useBudgetTileAccess();
  const { t } = useTranslation('common');
  const [localTiles, setLocalTiles] = useState<DashboardTileConfig[]>([]);
  const [budgetTiles, setBudgetTiles] = useState<DashboardTileConfig[]>([]);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [error, setError] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Initialize local state when modal opens or config changes
  useEffect(() => {
    if (open) {
      // Build complete tile list: existing config + any missing tiles with defaults
      const existingIds = new Set(config.tiles.map((t) => t.id));
      const allTiles = [...config.tiles];

      // Add any tiles from registry that aren't in config
      Object.entries(TILE_REGISTRY).forEach(([id, def]) => {
        if (!existingIds.has(id)) {
          allTiles.push({
            id,
            enabled: false,
            order: allTiles.length + 1,
            config: def.defaultConfig,
          });
        }
      });

      // Sort by order
      allTiles.sort((a, b) => a.order - b.order);
      setLocalTiles(allTiles);
      setHideEmpty(config.hideEmptyTiles !== false);
      setError(false);
    }
  }, [open, config.tiles, config.hideEmptyTiles]);

  useEffect(() => {
    if (open) setBudgetTiles(budgetSettings.config.tiles.slice().sort((a, b) => a.order - b.order));
  }, [open, budgetSettings.config.tiles]);

  // Filter to only show tiles the user has permission to view
  const visibleTiles = useMemo(() => localTiles.filter((tile) => canViewTile(tile.id)), [localTiles, canViewTile]);
  const visibleIds = useMemo(() => visibleTiles.map((tile) => tile.id), [visibleTiles]);
  // The budget tiles of the home page: its own My tasks tile already lists the tasks.
  const canViewBudgetTile = (id: string) => budgetAccess.canViewTile(id) && !ON_HOME_PAGE_ALREADY.has(id) && !!BUDGET_TILES[id];
  const budgetVisible = budgetTiles.filter((tile) => canViewBudgetTile(tile.id));
  const budgetIds = budgetVisible.map((tile) => tile.id);
  const showBudget = budgetAccess.anyBudget && budgetVisible.length > 0;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: centerToCenter }),
  );

  const chosen = budgetTiles.find((tile) => tile.id === 'budget')?.config.columns as string[] | null | undefined;
  const selected = columns.shown.filter((column) => chosen == null || chosen.includes(column.key));
  const budgetEnabled = budgetTiles.some((tile) => tile.id === 'budget' && tile.enabled);
  const setColumns = (value: string[] | null) => setBudgetTiles((prev) => prev.map((tile) => (tile.id === 'budget' ? { ...tile, config: { ...tile.config, columns: value } } : tile)));
  const busy = isUpdating || isResetting || budgetSettings.isUpdating || budgetSettings.isResetting;

  const handleToggle = (tileId: string) => {
    setLocalTiles((prev) =>
      prev.map((tile) => (tile.id === tileId ? { ...tile, enabled: !tile.enabled } : tile)),
    );
  };

  const handleOptionChange = (tileId: string, name: string, value: unknown) => {
    setLocalTiles((prev) =>
      prev.map((tile) => (tile.id === tileId ? { ...tile, config: { ...tile.config, [name]: value } } : tile)),
    );
  };

  const handleSave = async () => {
    try {
      // Re-assign order based on position; tiles the user can't see keep their place at the end.
      const tilesWithOrder = localTiles.map((tile, i) => ({ ...tile, order: i + 1 }));
      await updateConfig({ tiles: tilesWithOrder, hideEmptyTiles: hideEmpty });
      if (showBudget) {
        await budgetSettings.updateConfig({
          tiles: budgetTiles.map((tile, index) => ({
            ...tile,
            order: index + 1,
            config: tile.id === 'budget' && chosen != null && selected.length > 0 ? { ...tile.config, columns: selected.map((column) => column.key) } : tile.config,
          })),
        });
      }
      onClose();
    } catch {
      setError(true);
    }
  };

  const handleReset = async () => {
    try {
      await resetConfig();
      if (budgetAccess.anyBudget) await budgetSettings.resetConfig();
      onClose();
    } catch {
      setError(true);
    }
  };

  return (
    <KanapDialog
      open={open}
      title={t('dashboard.settings.title')}
      subtitle={t('dashboard.settings.description')}
      onClose={() => { if (!busy) onClose(); }}
      onSave={handleSave}
      saveLabel={t('buttons.save')}
      saveLoading={isUpdating || budgetSettings.isUpdating}
      saveDisabled={busy || (showBudget && (!columns.ready || budgetSettings.isLoading || (budgetEnabled && chosen != null && selected.length === 0)))}
      disableEscapeKeyDown={dragging}
      footerLeft={<Button variant="action" onClick={handleReset} disabled={busy}>{t('dashboard.settings.resetToDefaults')}</Button>}
    >
      {error && <Alert severity="error" sx={{ mb: 1 }}>{t('dashboard.budgetSettings.saveFailed')}</Alert>}
      <FormControlLabel
        sx={{ display: 'flex', mx: 0, mb: 1.5, justifyContent: 'space-between' }}
        labelPlacement="start"
        label={<Typography variant="body2">{t('dashboard.settings.hideEmptyTiles')}</Typography>}
        control={<Switch size="small" checked={hideEmpty} onChange={(event) => setHideEmpty(event.target.checked)} />}
      />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={() => setDragging(true)}
        onDragCancel={() => setDragging(false)}
        onDragEnd={(event) => { setDragging(false); setLocalTiles((prev) => reorder(prev, canViewTile, event)); }}
      >
        <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
          {visibleTiles.map((tile) => {
            const def = TILE_REGISTRY[tile.id];
            if (!def) return null;
            const optionEntries = Object.entries(def.configSchema);
            return (
              <SortableTileRow
                key={tile.id}
                id={tile.id}
                enabled={tile.enabled}
                titleKey={def.titleKey}
                icon={def.icon}
                onToggle={() => handleToggle(tile.id)}
              >
                {optionEntries.length > 0 && (
                  <Box sx={{ pl: 5.5, pr: 4.5, pb: 0.5 }}>
                    {optionEntries.map(([name, schema]) => (
                      <TileOption
                        key={name}
                        name={name}
                        schema={schema}
                        value={tile.config?.[name] ?? def.defaultConfig[name]}
                        onChange={(value) => handleOptionChange(tile.id, name, value)}
                      />
                    ))}
                  </Box>
                )}
              </SortableTileRow>
            );
          })}
        </SortableContext>
      </DndContext>

      {showBudget && (
        <Box component="section" aria-label={t('nav:workspaces.budgetManagement')} sx={{ mt: 2 }}>
          <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>{t('nav:workspaces.budgetManagement')}</Typography>
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={() => setDragging(true)}
            onDragCancel={() => setDragging(false)}
            onDragEnd={(event) => { setDragging(false); setBudgetTiles((prev) => reorder(prev, canViewBudgetTile, event)); }}
          >
            <SortableContext items={budgetIds} strategy={verticalListSortingStrategy}>
              {budgetVisible.map((tile) => (
                <SortableTileRow
                  key={tile.id}
                  id={tile.id}
                  enabled={tile.enabled}
                  titleKey={BUDGET_TILES[tile.id].titleKey}
                  icon={BUDGET_TILES[tile.id].icon}
                  onToggle={() => setBudgetTiles((prev) => prev.map((entry) => (entry.id === tile.id ? { ...entry, enabled: !entry.enabled } : entry)))}
                >
                  {tile.id === 'budget' && (
                    <Box sx={{ pl: 5.5, pr: 4.5, pb: 0.5 }}>
                      <Typography variant="caption" sx={{ color: 'kanap.text.tertiary', fontSize: 12 }}>{t('dashboard.budgetSettings.columns')}</Typography>
                      <FormControlLabel
                        sx={{ display: 'flex' }}
                        control={<Checkbox size="small" checked={chosen == null} onChange={(event) => setColumns(event.target.checked ? null : columns.shown.map((column) => column.key))} />}
                        label={<Typography variant="body2">{t('dashboard.budgetSettings.tenantColumns')}</Typography>}
                      />
                      {columns.shown.map((column) => {
                        const checked = selected.some((entry) => entry.key === column.key);
                        return (
                          <FormControlLabel
                            key={column.key}
                            sx={{ display: 'flex' }}
                            label={<Typography variant="body2">{column.label}</Typography>}
                            control={(
                              <Checkbox
                                size="small"
                                checked={checked}
                                disabled={chosen == null || (checked && selected.length === 1)}
                                onChange={(event) => setColumns(event.target.checked
                                  ? [...selected.map((entry) => entry.key), column.key]
                                  : selected.filter((entry) => entry.key !== column.key).map((entry) => entry.key))}
                              />
                            )}
                          />
                        );
                      })}
                      {chosen != null && selected.length === 0 && <Typography variant="caption" color="error">{t('dashboard.budgetSettings.atLeastOne')}</Typography>}
                    </Box>
                  )}
                </SortableTileRow>
              ))}
            </SortableContext>
          </DndContext>
        </Box>
      )}
    </KanapDialog>
  );
}

/** Keyboard moves go from row center to row center: a row with options is taller than the others. */
const centerToCenter: KeyboardCoordinateGetter = (event, { currentCoordinates, context }) => {
  const step = event.code === 'ArrowDown' ? 1 : event.code === 'ArrowUp' ? -1 : 0;
  if (!step || !context.collisionRect) return undefined;
  const rects = [...context.droppableRects.entries()]
    .filter(([, rect]) => !!rect)
    .sort(([, a], [, b]) => a.top - b.top);
  const index = rects.findIndex(([id]) => id === (context.over?.id ?? context.active?.id));
  const target = rects[index + step]?.[1];
  if (index < 0 || !target) return undefined;
  event.preventDefault();
  return { x: currentCoordinates.x, y: currentCoordinates.y + target.top + target.height / 2 - context.collisionRect.top - context.collisionRect.height / 2 };
};
