import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import type { MetricKey } from './reportAggregates';
import type { ReportTableLabels } from './reportTables';

/** The words of the budget report tables (`reportTables.ts`) in the screen language, column names resolved. */
export function useReportTableLabels(): ReportTableLabels {
  const { t } = useTranslation(['ops']);
  const budgetColumns = useBudgetColumns();
  return useMemo<ReportTableLabels>(() => ({
    columnNames: Object.fromEntries(budgetColumns.all.map((column) => [column.key, column.label])) as Record<MetricKey, string>,
    columnFte: (column) => t('reports.measure.columnFte', { column }),
    metric: t('reports.filters.metric'),
    year: t('reports.filters.year'),
    column: t('reports.filters.column'),
    selection: t('reports.columns.selection'),
    total: t('reports.columns.total'),
    totalFte: t('reports.measure.totalFte'),
    item: t('reports.columns.item'),
    shareOfTotal: t('reports.columns.shareOfTotal'),
    delta: t('reports.columns.delta'),
    pctIncrease: t('reports.columns.pctIncrease'),
    consolidationAccount: t('reports.columns.consolidationAccount'),
    consolidationUnassigned: t('reports.consolidation.unassigned'),
    consolidationTotal: (metric) => t('reports.consolidation.totalMetric', { metric }),
    analyticsUnassigned: t('reports.analyticsCategory.unassigned'),
    analyticsUnnamed: t('reports.analyticsCategory.unnamed'),
    analyticsTotal: (metric) => t('reports.analyticsCategory.totalMetric', { metric }),
  }), [budgetColumns, t]);
}
