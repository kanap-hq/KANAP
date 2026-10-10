import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
import { lineTypeUsageLabel } from '../../constants/lineTypeUsage';
import {
  ANALYTICS_VALUES_LOOKUP_ENDPOINT,
  analyticsValueOrderKey,
  getAnalyticsValuesInOrder,
  isAnalyticsActive,
  reorderAnalyticsValues,
  type AnalyticsValue,
} from '../../services/analytics';
import { getApiErrorMessage } from '../../utils/apiErrorMessage';

/**
 * The queries that list a dimension's values and follow their order: the values grid and its
 * prev/next, the pickers, the list set filters and the report option lists.
 */
export function invalidateAnalyticsValueOrder(queryClient: ReturnType<typeof useQueryClient>) {
  void queryClient.invalidateQueries({ queryKey: ['analytics-categories'] });
  void queryClient.invalidateQueries({ queryKey: ['analytics-ids'] });
  void queryClient.invalidateQueries({ queryKey: ['lookup', ANALYTICS_VALUES_LOOKUP_ENDPOINT] });
  void queryClient.invalidateQueries({ queryKey: ['grid-filter-values'] });
}

const listSx = {
  border: 1,
  borderColor: 'kanap.border.default',
  borderRadius: '8px',
  maxHeight: '60vh',
  overflowY: 'auto',
} as const;

function SortableValueRow({ value, position }: { value: AnalyticsValue; position: number }) {
  const { t } = useTranslation(['master-data']);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: value.id,
    attributes: { roleDescription: t('analytics.reorder.roleDescription') },
  });
  // A disabled value, or one for one type of line only, says so after its name (as the dimension chips do).
  const marks = [
    ...(isAnalyticsActive(value) ? [] : [t('analytics.disabledMark')]),
    ...(value.applies_to ? [lineTypeUsageLabel(t, value.applies_to)] : []),
  ];
  return (
    <Box
      ref={setNodeRef}
      data-value-id={value.id}
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
        {value.name}
        {marks.length > 0 && (
          <Box component="span" sx={{ ml: 0.75, fontSize: 12, color: 'kanap.text.tertiary' }}>
            {marks.join(' · ')}
          </Box>
        )}
      </Typography>
    </Box>
  );
}

type Props = {
  open: boolean;
  /** The dimension whose values are reordered. */
  axisId: string;
  /** Its display name, for the title. */
  axisLabel: string;
  onClose: () => void;
  /** After the new order is saved (the value queries are already invalidated). */
  onSaved?: () => void;
};

/**
 * Puts a dimension's values in a manual order by dragging them (pointer or keyboard). Every value
 * is listed, disabled ones and values for one line type included. Save sends the whole order;
 * Cancel discards it.
 */
export default function AnalyticsValueOrderDialog({ open, axisId, axisLabel, onClose, onSaved }: Props) {
  const { t } = useTranslation(['master-data', 'common']);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: analyticsValueOrderKey(axisId),
    queryFn: ({ signal }) => getAnalyticsValuesInOrder(axisId, signal),
    enabled: open && !!axisId,
    // Stale at once: opening the dialog always reads the stored order.
    staleTime: 0,
    retry: false,
  });
  const [order, setOrder] = React.useState<AnalyticsValue[] | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // A value is being moved: Escape then cancels the move instead of closing the dialog.
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

  const ids = React.useMemo(() => (order ?? []).map((value) => value.id), [order]);
  const nameOf = React.useCallback(
    (id: UniqueIdentifier) => order?.find((value) => value.id === id)?.name ?? '',
    [order],
  );
  const positionOf = React.useCallback((id: UniqueIdentifier | undefined) => (id == null ? 0 : ids.indexOf(String(id)) + 1), [ids]);

  const announcements = React.useMemo<Announcements>(() => ({
    onDragStart: ({ active }) => t('analytics.reorder.pickedUp', { name: nameOf(active.id) }),
    onDragOver: ({ active, over }) => (over
      ? t('analytics.reorder.movedTo', { name: nameOf(active.id), position: positionOf(over.id), count: ids.length })
      : undefined),
    onDragEnd: ({ active, over }) => (over
      ? t('analytics.reorder.droppedAt', { name: nameOf(active.id), position: positionOf(over.id), count: ids.length })
      : undefined),
    onDragCancel: ({ active }) => t('analytics.reorder.cancelled', { name: nameOf(active.id) }),
  }), [ids.length, nameOf, positionOf, t]);

  const handleDragEnd = React.useCallback((event: DragEndEvent) => {
    setDragging(false);
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((current) => {
      if (!current) return current;
      const from = current.findIndex((value) => value.id === active.id);
      const to = current.findIndex((value) => value.id === over.id);
      return from < 0 || to < 0 ? current : arrayMove(current, from, to);
    });
  }, []);

  const changed = !!order && !!query.data && order.some((value, i) => value.id !== query.data[i]?.id);

  const handleSave = async () => {
    if (!order) return;
    if (!changed) {
      onClose();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await reorderAnalyticsValues(axisId, order.map((value) => value.id));
      invalidateAnalyticsValueOrder(queryClient);
      onSaved?.();
      onClose();
    } catch (e) {
      setError(getApiErrorMessage(e, t, t('analytics.reorder.saveFailed')));
    } finally {
      setSaving(false);
    }
  };

  const loadError = query.isError ? getApiErrorMessage(query.error, t, t('analytics.reorder.loadFailed')) : null;

  return (
    <KanapDialog
      open={open}
      title={t('analytics.reorder.title', { name: axisLabel })}
      subtitle={t('analytics.reorder.hint')}
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
            screenReaderInstructions: { draggable: t('analytics.reorder.instructions') },
          }}
        >
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <Box sx={listSx}>
              {order.map((value, index) => (
                <SortableValueRow key={value.id} value={value} position={index + 1} />
              ))}
            </Box>
          </SortableContext>
        </DndContext>
      )}
    </KanapDialog>
  );
}
