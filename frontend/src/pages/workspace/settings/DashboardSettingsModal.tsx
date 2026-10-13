import { useState, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Checkbox,
  MenuItem,
  Select,
  Switch,
  TextField,
  Typography,
  Box,
  Divider,
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
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { useDashboardConfig, DashboardTileConfig } from '../hooks/useDashboardConfig';
import { TILE_REGISTRY, type ConfigFieldSchema } from '../tiles/TileRegistry';
import { TILE_ICONS } from '../tiles/DashboardTile';
import { drawerMenuItemSx, inlineControlSx } from '../../../theme/formSx';

interface DashboardSettingsModalProps {
  open: boolean;
  onClose: () => void;
  canViewTile: (tileId: string) => boolean;
}

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

function SortableTileRow({ tile, onToggle, onOptionChange }: {
  tile: DashboardTileConfig;
  onToggle: () => void;
  onOptionChange: (name: string, value: unknown) => void;
}) {
  const { t } = useTranslation('common');
  const def = TILE_REGISTRY[tile.id];
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tile.id });
  if (!def) return null;
  const IconComponent = TILE_ICONS[def.icon] || TILE_ICONS.Task;
  const optionEntries = Object.entries(def.configSchema);

  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      sx={{
        borderRadius: '6px',
        px: 1,
        py: 0.5,
        mb: 0.5,
        bgcolor: tile.enabled ? 'kanap.bg.hover' : 'transparent',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
        <Checkbox edge="start" size="small" checked={tile.enabled} onChange={onToggle} inputProps={{ 'aria-label': t(def.titleKey) }} />
        <IconComponent fontSize="small" sx={{ color: 'text.secondary', mr: 0.5 }} />
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>{t(def.titleKey)}</Typography>
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
      {tile.enabled && optionEntries.length > 0 && (
        <Box sx={{ pl: 5.5, pr: 4.5, pb: 0.5 }}>
          {optionEntries.map(([name, schema]) => (
            <TileOption
              key={name}
              name={name}
              schema={schema}
              value={tile.config?.[name] ?? def.defaultConfig[name]}
              onChange={(value) => onOptionChange(name, value)}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}

export default function DashboardSettingsModal({
  open,
  onClose,
  canViewTile,
}: DashboardSettingsModalProps) {
  const { config, updateConfig, resetConfig, isUpdating, isResetting } =
    useDashboardConfig();
  const { t } = useTranslation('common');
  const [localTiles, setLocalTiles] = useState<DashboardTileConfig[]>([]);

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
    }
  }, [open, config.tiles]);

  // Filter to only show tiles the user has permission to view
  const visibleTiles = useMemo(() => localTiles.filter((tile) => canViewTile(tile.id)), [localTiles, canViewTile]);
  const visibleIds = useMemo(() => visibleTiles.map((tile) => tile.id), [visibleTiles]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

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

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = visibleIds.indexOf(String(active.id));
    const newIndex = visibleIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    const reordered = arrayMove(visibleTiles, oldIndex, newIndex);
    const hidden = localTiles.filter((tile) => !canViewTile(tile.id));
    setLocalTiles([...reordered, ...hidden]);
  };

  const handleSave = async () => {
    // Preserve tiles user can't see (don't drop them from config)
    const hiddenTiles = localTiles.filter((tile) => !canViewTile(tile.id));
    const updatedTiles = [...visibleTiles, ...hiddenTiles];

    // Re-assign order based on position
    const tilesWithOrder = updatedTiles.map((tile, i) => ({ ...tile, order: i + 1 }));

    await updateConfig({ tiles: tilesWithOrder });
    onClose();
  };

  const handleReset = async () => {
    await resetConfig();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>{t('dashboard.settings.title')}</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          {t('dashboard.settings.description')}
        </Typography>

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleIds} strategy={verticalListSortingStrategy}>
            {visibleTiles.map((tile) => (
              <SortableTileRow
                key={tile.id}
                tile={tile}
                onToggle={() => handleToggle(tile.id)}
                onOptionChange={(name, value) => handleOptionChange(tile.id, name, value)}
              />
            ))}
          </SortableContext>
        </DndContext>

        <Divider sx={{ my: 2 }} />

        <Box>
          <Button
            variant="text"
            color="error"
            onClick={handleReset}
            disabled={isResetting}
            size="small"
          >
            {t('dashboard.settings.resetToDefaults')}
          </Button>
        </Box>
      </DialogContent>
      <DialogActions>
        <Button variant="action" onClick={onClose}>{t('buttons.cancel')}</Button>
        <Button
          variant="action-primary"
          onClick={handleSave}
          disabled={isUpdating}
        >
          {t('buttons.save')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
