import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useBudgetColumns } from '../../hooks/useBudgetColumns';
import { useLocale } from '../../i18n/useLocale';
import type { MetricKey } from './reportAggregates';
import { shortMonthNames, type ReportTableLabels } from './reportTables';

/** The words of the budget report tables (`reportTables.ts`) in the screen language, column names resolved. */
export function useReportTableLabels(): ReportTableLabels {
  const { t } = useTranslation(['ops']);
  const budgetColumns = useBudgetColumns();
  const locale = useLocale();
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
    monthNames: shortMonthNames(locale),
    average: t('reports.staffing.average'),
    peak: t('reports.staffing.peak'),
    fte: t('reports.measure.fte'),
    staffCost: t('reports.costPerFte.staffCost'),
    costPerFte: t('reports.costPerFte.costPerFte'),
    days: t('reports.costPerFte.days'),
    dayCost: t('reports.costPerFte.dayCost'),
    dailyRate: t('reports.costPerFte.dailyRate'),
  }), [budgetColumns, locale, t]);
}
