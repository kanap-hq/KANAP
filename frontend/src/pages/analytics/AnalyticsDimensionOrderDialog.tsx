import React from 'react';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { lineTypeUsageLabel } from '../../constants/lineTypeUsage';
import { ANALYTICS_AXES_QUERY_KEY, analyticsAxisLabel, buildAnalyticsAxes } from '../../hooks/useAnalyticsAxes';
import { getAnalyticsAxes, isAnalyticsActive, reorderAnalyticsAxes, type AnalyticsAxis } from '../../services/analytics';
import SortableOrderDialog from './SortableOrderDialog';

/** Every dimension in its order, read fresh each time the dialog opens (under the dimensions' key). */
const DIMENSION_ORDER_KEY = [...ANALYTICS_AXES_QUERY_KEY, 'order'] as const;

type Props = {
  open: boolean;
  onClose: () => void;
};

/**
 * Puts the dimensions in a manual order by dragging them (pointer or keyboard), disabled ones and
 * dimensions for one line type included. Saving refreshes every query that lists the dimensions
 * (the chip bar, the drawers, the list columns, the dimension pages).
 */
export default function AnalyticsDimensionOrderDialog({ open, onClose }: Props) {
  const { t } = useTranslation(['master-data', 'common']);
  const queryClient = useQueryClient();
  const load = React.useCallback(async () => buildAnalyticsAxes(await getAnalyticsAxes(), t).axes, [t]);
  // The marks of the chip bar, and which dimension is the default.
  const toItem = React.useCallback((axis: AnalyticsAxis) => ({
    id: axis.id,
    label: analyticsAxisLabel(axis, t),
    marks: [
      ...(axis.is_default ? [t('analytics.defaultMark')] : []),
      ...(isAnalyticsActive(axis) ? [] : [t('analytics.disabledMark')]),
      ...(axis.applies_to ? [lineTypeUsageLabel(t, axis.applies_to)] : []),
    ],
  }), [t]);
  const save = React.useCallback(async (ids: string[]) => {
    await reorderAnalyticsAxes(ids);
    // The list (`useAnalyticsAxes`) and every dimension detail sit under this key.
    void queryClient.invalidateQueries({ queryKey: ANALYTICS_AXES_QUERY_KEY });
  }, [queryClient]);

  return (
    <SortableOrderDialog<AnalyticsAxis>
      open={open}
      title={t('analytics.reorderDimensions.title')}
      hint={t('analytics.reorderDimensions.hint')}
      queryKey={DIMENSION_ORDER_KEY}
      load={load}
      toItem={toItem}
      save={save}
      textsKey="analytics.reorderDimensions"
      idAttribute="data-dimension-id"
      onClose={onClose}
    />
  );
}
