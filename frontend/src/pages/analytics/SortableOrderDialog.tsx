import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, type QueryKey } from '@tanstack/react-query';
import { Alert, Box, Typography } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import KanapDialog from '../../components/design/KanapDialog';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

/** One row of the dialog: its name, and the marks shown after it (disabled, one line type only, ...). */
export type SortableOrderItem = { id: string; label: string; marks: string[] };

const listSx = {
  border: 1,
  borderColor: 'kanap.border.default',
  borderRadius: '8px',
  maxHeight: '60vh',
  overflowY: 'auto',
} as const;

function SortableRow({
  item,
  position,
  roleDescription,
  idAttribute,
}: {
  item: SortableOrderItem;
  position: number;
  roleDescription: string;
  idAttribute: string;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    attributes: { roleDescription },
  });
  return (
    <Box
      ref={setNodeRef}
      {...{ [idAttribute]: item.id }}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      {...attributes}
      {...listeners}
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 1,
        minHeight: 36,
        px: 1,
        cursor: isDragging ? 'grabbing' : 'grab',
        touchAction: 'none',
        position: 'relative',
        zIndex: isDragging ? 1 : 'auto',
        bgcolor: isDragging ? 'kanap.bg.hover' : 'kanap.bg.primary',
        borderBottom: 1,
        borderColor: 'kanap.border.soft',
        '&:last-of-type': { borderBottom: 0 },
        '&:hover': { bgcolor: 'kanap.bg.hover' },
        '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
      }}
    >
      <DragIndicatorIcon fontSize="small" sx={{ color: 'kanap.text.tertiary' }} />
      <Typography
        component="span"
        sx={{ width: 28, fontSize: 12, color: 'kanap.text.tertiary', fontVariantNumeric: 'tabular-nums' }}
      >
        {position}
      </Typography>
      <Typography component="span" sx={{ flex: 1, minWidth: 0, fontSize: 13, color: 'kanap.text.primary' }}>
        {item.label}
        {item.marks.length > 0 && (
          <Box component="span" sx={{ ml: 0.75, fontSize: 12, color: 'kanap.text.tertiary' }}>
            {item.marks.join(' · ')}
          </Box>
        )}
      </Typography>
    </Box>
  );
}

type Props<T extends { id: string }> = {
  open: boolean;
  title: string;
  hint: string;
  /** The stored order, read each time the dialog opens. */
  queryKey: QueryKey;
  load: (signal?: AbortSignal) => Promise<T[]>;
  toItem: (entry: T) => SortableOrderItem;
  /** Stores the order and refreshes the queries that follow it; a rejection stays in the dialog. */
  save: (ids: string[]) => Promise<unknown>;
  /**
   * Key prefix of the texts the dialog writes itself: `loadFailed`, `saveFailed`, `roleDescription`,
   * `instructions` and the screen-reader announcements (`pickedUp`, `movedTo`, `droppedAt`, `cancelled`).
   */
  textsKey: string;
  /** The data attribute that carries each row's id (`data-value-id`). */
  idAttribute: string;
  onClose: () => void;
  /** After the new order is saved. */
  onSaved?: () => void;
};

/**
 * Puts a list in a manual order by dragging its rows (pointer or keyboard). Save sends the whole
 * order, and closes without a request when nothing moved; Cancel discards it. Escape during a move
 * cancels the move only.
 */
export default function SortableOrderDialog<T extends { id: string }>({
  open,
  title,
  hint,
  queryKey,
  load,
  toItem,
  save,
  textsKey,
  idAttribute,
  onClose,
  onSaved,
}: Props<T>) {
  const { t } = useTranslation(['master-data', 'common']);
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => load(signal),
    enabled: open,
    // Stale at once: opening the dialog always reads the stored order.
    staleTime: 0,
    retry: false,
  });
  const [order, setOrder] = React.useState<T[] | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // A row is being moved: Escape then cancels the move instead of closing the dialog.
  const [dragging, setDragging] = React.useState(false);
  const openedAtRef = React.useRef(0);

  // The list read since the dialog opened, never a cached one; edits are never overwritten by a later refetch.
  React.useEffect(() => {
    if (!open) {
      openedAtRef.current = 0;
      setOrder(null);
      setError(null);
      setSaving(false);
      setDragging(false);
      return;
    }
    if (!openedAtRef.current) openedAtRef.current = Date.now();
    if (order == null && query.data && !query.isFetching && query.dataUpdatedAt >= openedAtRef.current) setOrder(query.data);
  }, [open, order, query.data, query.isFetching, query.dataUpdatedAt]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const items = React.useMemo(() => (order ?? []).map(toItem), [order, toItem]);
  const ids = React.useMemo(() => items.map((item) => item.id), [items]);
  const nameOf = React.useCallback(
    (id: UniqueIdentifier) => items.find((item) => item.id === id)?.label ?? '',
    [items],
  );
  const positionOf = React.useCallback((id: UniqueIdentifier | undefined) => (id == null ? 0 : ids.indexOf(String(id)) + 1), [ids]);

  const announcements = React.useMemo<Announcements>(() => ({
    onDragStart: ({ active }) => t(`${textsKey}.pickedUp`, { name: nameOf(active.id) }),
    onDragOver: ({ active, over }) => (over
      ? t(`${textsKey}.movedTo`, { name: nameOf(active.id), position: positionOf(over.id), count: ids.length })
      : undefined),
    onDragEnd: ({ active, over }) => (over
      ? t(`${textsKey}.droppedAt`, { name: nameOf(active.id), position: positionOf(over.id), count: ids.length })
      : undefined),
    onDragCancel: ({ active }) => t(`${textsKey}.cancelled`, { name: nameOf(active.id) }),
  }), [ids.length, nameOf, positionOf, t, textsKey]);

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    setDragging(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((current) => {
      if (!current) return current;
      const from = current.findIndex((entry) => entry.id === active.id);
      const to = current.findIndex((entry) => entry.id === over.id);
      return from < 0 || to < 0 ? current : arrayMove(current, from, to);
    });
  }, []);

  const changed = !!order && !!query.data && order.some((entry, i) => entry.id !== query.data[i]?.id);

  const handleSave = async () => {
    if (!order) return;
    if (!changed) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await save(order.map((entry) => entry.id));
      onSaved?.();
      onClose();
    } catch (e) {
      setError(getApiErrorMessage(e, t, t(`${textsKey}.saveFailed`)));
    } finally {
      setSaving(false);
    }
  };

  const loadError = query.isError ? getApiErrorMessage(query.error, t, t(`${textsKey}.loadFailed`)) : null;

  return (
    <KanapDialog
      open={open}
      title={title}
      subtitle={hint}
      onClose={onClose}
      disableEscapeKeyDown={dragging}
      onSave={handleSave}
      saveLabel={t('common:buttons.save')}
      saveDisabled={!order}
      saveLoading={saving}
    >
      {(error || loadError) && (
        <Alert severity="error" sx={{ mb: 1.5 }}>{error ?? loadError}</Alert>
      )}
      {!order && !loadError && (
        <Typography sx={{ fontSize: 13, color: 'kanap.text.secondary' }}>{t('common:status.loading')}</Typography>
      )}
      {order && (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={() => setDragging(true)}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setDragging(false)}
          accessibility={{
            announcements,
            screenReaderInstructions: { draggable: t(`${textsKey}.instructions`) },
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <Box sx={listSx}>
              {items.map((item, index) => (
                <SortableRow
                  key={item.id}
                  item={item}
                  position={index + 1}
                  roleDescription={t(`${textsKey}.roleDescription`)}
                  idAttribute={idAttribute}
                />
              ))}
            </Box>
          </SortableContext>
        </DndContext>
      )}
    </KanapDialog>
  );
}
