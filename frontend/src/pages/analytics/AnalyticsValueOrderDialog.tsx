import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { lineTypeUsageLabel } from '../../constants/lineTypeUsage';
import {
  ANALYTICS_VALUES_LOOKUP_ENDPOINT,
  analyticsValueOrderKey,
  getAnalyticsValuesInOrder,
  isAnalyticsActive,
  reorderAnalyticsValues,
  type AnalyticsValue,
} from '../../services/analytics';
import SortableOrderDialog from './SortableOrderDialog';

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
  const load = React.useCallback((signal?: AbortSignal) => getAnalyticsValuesInOrder(axisId, signal), [axisId]);
  // A disabled value, or one for one type of line only, says so after its name (as the dimension chips do).
  const toItem = React.useCallback((value: AnalyticsValue) => ({
    id: value.id,
    label: value.name,
    marks: [
      ...(isAnalyticsActive(value) ? [] : [t('analytics.disabledMark')]),
      ...(value.applies_to ? [lineTypeUsageLabel(t, value.applies_to)] : []),
    ],
  }), [t]);
  const save = React.useCallback(async (ids: string[]) => {
    await reorderAnalyticsValues(axisId, ids);
    invalidateAnalyticsValueOrder(queryClient);
  }, [axisId, queryClient]);

  return (
    <SortableOrderDialog<AnalyticsValue>
      open={open}
      title={t('analytics.reorder.title', { name: axisLabel })}
      hint={t('analytics.reorder.hint')}
      queryKey={analyticsValueOrderKey(axisId)}
      load={load}
      canLoad={!!axisId}
      toItem={toItem}
      save={save}
      textsKey="analytics.reorder"
      idAttribute="data-value-id"
      onClose={onClose}
      onSaved={onSaved}
    />
  );
}
