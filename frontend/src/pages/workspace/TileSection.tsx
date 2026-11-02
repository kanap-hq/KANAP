import { useState, type ReactNode } from 'react';
import { Box, IconButton, Menu, MenuItem, Popover, Stack, Tooltip, Typography } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import AddIcon from '@mui/icons-material/Add';
import TuneIcon from '@mui/icons-material/Tune';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, rectSortingStrategy, sortableKeyboardCoordinates, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTranslation } from 'react-i18next';
import { drawerMenuItemSx } from '../../theme/formSx';
import { TileEmptyContext, useEmptyTiles, useReportEmpty } from './tiles/emptyTiles';

export type SectionEntry = {
  id: string;
  node: ReactNode;
  /** Columns the tile takes, within the row. */
  span?: number;
  /** Stays in place without edit controls, and is never empty (the first steps). */
  fixed?: boolean;
  /** The tile's options, under its settings button while the page is customized. */
  options?: ReactNode;
};

/** What the customize mode can do to a section and its tiles. */
export type SectionEditing = {
  hidden: boolean;
  onToggleHidden: () => void;
  /** The tiles off in this section, which the person may turn on. */
  addable: Array<{ id: string; title: string }>;
  onAdd: (id: string) => void;
  onRemove: (id: string) => void;
  onMove: (activeId: string, overId: string) => void;
};

/** Sortable id of a section among the sections, apart from its tiles' ids. */
export const sectionSortId = (id: string) => `section:${id}`;

const iconButtonSx = { p: 0.5, color: 'kanap.text.tertiary' } as const;

function SectionTile({ entry, span, hiddenEmpty, editing, onReport, onRemove }: {
  entry: SectionEntry;
  span: number;
  hiddenEmpty: boolean;
  editing: boolean;
  onReport: (empty: boolean) => void;
  onRemove?: () => void;
}) {
  const { t } = useTranslation('common');
  const editable = editing && !entry.fixed;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id, disabled: !editable });
  const [optionsAnchor, setOptionsAnchor] = useState<HTMLElement | null>(null);
  return (
    <Box
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition, opacity: isDragging ? 0.6 : 1 }}
      sx={{
        gridColumn: `span ${span}`,
        minWidth: 0,
        display: hiddenEmpty ? 'none' : 'flex',
        flexDirection: 'column',
        ...(editable ? { outline: '1px dashed', outlineColor: 'kanap.border.default', outlineOffset: 4, borderRadius: '8px' } : {}),
      }}
    >
      {editable && (
        <Stack direction="row" alignItems="center" sx={{ mb: 0.5 }}>
          <Box component="span" aria-label={t('dashboard.settings.dragToReorder')} {...attributes} {...listeners} sx={{ ...iconButtonSx, display: 'inline-flex', cursor: 'grab', touchAction: 'none' }}>
            <DragIndicatorIcon fontSize="small" />
          </Box>
          <Box sx={{ flex: 1 }} />
          {entry.options && (
            <Tooltip title={t('dashboard.customize.tileOptions')}>
              <IconButton size="small" aria-label={t('dashboard.customize.tileOptions')} sx={iconButtonSx} onClick={(event) => setOptionsAnchor(event.currentTarget)}>
                <TuneIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip title={t('dashboard.customize.hideTile')}>
            <IconButton size="small" aria-label={t('dashboard.customize.hideTile')} sx={iconButtonSx} onClick={onRemove}>
              <VisibilityOffIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Popover
            open={!!optionsAnchor}
            anchorEl={optionsAnchor}
            onClose={() => setOptionsAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
            transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            slotProps={{ paper: { sx: { p: 1.5, width: 280 } } }}
          >
            {entry.options}
          </Popover>
        </Stack>
      )}
      {/* While customizing, a click on the tile does not open what it shows. */}
      <Box sx={[{ flex: 1, minWidth: 0 }, editable && { pointerEvents: 'none' }]}>
        <TileEmptyContext.Provider value={onReport}>{entry.node}</TileEmptyContext.Provider>
      </Box>
    </Box>
  );
}

/**
 * One section of the home page: its title over its tiles, taking as many columns of the page grid as
 * its tiles shown (at most a row), so that short sections share a row. With `hideEmpty`, a tile with
 * nothing to show is left out, and the section with it when none is left; the section tells the page
 * through `TileEmptyContext`. While the page is customized, it shows every tile it holds, with their
 * handles, options and hide buttons, and its own handle, add menu and visibility button.
 */
export default function TileSection({ id, title, entries, perRow, hideEmpty, editing }: {
  id: string;
  title: string;
  entries: SectionEntry[];
  perRow: number;
  hideEmpty: boolean;
  editing?: SectionEditing | null;
}) {
  const { t } = useTranslation('common');
  const { empty, reporter } = useEmptyTiles();
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const isEditing = !!editing;
  const sortable = useSortable({ id: sectionSortId(id), disabled: !isEditing });
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const isHiddenEmpty = (entry: SectionEntry) => !isEditing && hideEmpty && !entry.fixed && empty.has(entry.id);
  const spanOf = (entry: SectionEntry) => Math.max(1, Math.min(entry.span ?? 1, perRow));
  const slots = entries.filter((entry) => !isHiddenEmpty(entry)).reduce((total, entry) => total + spanOf(entry), 0);
  const columns = Math.max(1, Math.min(perRow, slots));
  useReportEmpty(entries.every((entry) => !entry.fixed && empty.has(entry.id)));
  const shown = isEditing || slots > 0;

  const moveTile = ({ active, over }: DragEndEvent) => {
    if (over && active.id !== over.id) editing?.onMove(String(active.id), String(over.id));
  };

  return (
    <Box
      ref={sortable.setNodeRef}
      role="group"
      aria-label={title}
      style={{ transform: CSS.Translate.toString(sortable.transform), transition: sortable.transition, opacity: sortable.isDragging ? 0.6 : 1 }}
      sx={{ gridColumn: `span ${columns}`, minWidth: 0, display: shown ? 'flex' : 'none', flexDirection: 'column', gap: 1.5 }}
    >
      <Stack direction="row" alignItems="center" spacing={0.5} sx={{ minHeight: 28 }}>
        {isEditing && (
          <Box component="span" aria-label={t('dashboard.customize.moveSection')} {...sortable.attributes} {...sortable.listeners} sx={{ ...iconButtonSx, display: 'inline-flex', cursor: 'grab', touchAction: 'none' }}>
            <DragIndicatorIcon fontSize="small" />
          </Box>
        )}
        <Typography component="h2" noWrap sx={{ fontSize: 16, fontWeight: 500, color: editing?.hidden ? 'kanap.text.tertiary' : 'kanap.text.primary', minWidth: 0 }}>
          {title}
        </Typography>
        {isEditing && (
          <>
            <Box sx={{ flex: 1 }} />
            <Tooltip title={t('dashboard.customize.addTile')}>
              <span>
                <IconButton size="small" aria-label={t('dashboard.customize.addTile')} sx={iconButtonSx} disabled={!editing.addable.length} onClick={(event) => setAddAnchor(event.currentTarget)}>
                  <AddIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t(editing.hidden ? 'dashboard.customize.showSection' : 'dashboard.customize.hideSection')}>
              <IconButton size="small" aria-label={t(editing.hidden ? 'dashboard.customize.showSection' : 'dashboard.customize.hideSection')} sx={iconButtonSx} onClick={editing.onToggleHidden}>
                {editing.hidden ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
              </IconButton>
            </Tooltip>
            <Menu
              anchorEl={addAnchor}
              open={!!addAnchor}
              onClose={() => setAddAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
              {editing.addable.map((tile) => (
                <MenuItem key={tile.id} sx={drawerMenuItemSx} onClick={() => { setAddAnchor(null); editing.onAdd(tile.id); }}>
                  {tile.title}
                </MenuItem>
              ))}
            </Menu>
          </>
        )}
      </Stack>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={moveTile}>
        <SortableContext items={entries.map((entry) => entry.id)} strategy={rectSortingStrategy}>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
              gap: 3,
              alignItems: 'start',
              ...(editing?.hidden ? { opacity: 0.45 } : {}),
            }}
          >
            {entries.map((entry) => (
              <SectionTile
                key={entry.id}
                entry={entry}
                span={Math.min(spanOf(entry), columns)}
                hiddenEmpty={isHiddenEmpty(entry)}
                editing={isEditing}
                onReport={reporter(entry.id)}
                onRemove={() => editing?.onRemove(entry.id)}
              />
            ))}
          </Box>
        </SortableContext>
      </DndContext>
    </Box>
  );
}
