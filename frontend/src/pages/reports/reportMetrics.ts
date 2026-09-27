import type { TFunction } from 'i18next';

/** Budget columns the report pickers offer (which columns reports offer is step R's setting). */
export const metricKeys = ['budget', 'follow_up', 'landing', 'revision'] as const;
/** A budget column with a translated label: the picker columns plus Forecast, which summary slots carry. */
export type MetricKey = (typeof metricKeys)[number] | 'forecast';

/** Same wording as the budget tab of OPEX and CAPEX items (ops namespace). */
export const metricLabelKeys: Record<MetricKey, string> = {
  budget: 'ops:operations.budgetColumns.budget',
  follow_up: 'ops:operations.budgetColumns.followUp',
  landing: 'ops:operations.budgetColumns.landing',
  revision: 'ops:operations.budgetColumns.revision',
  forecast: 'ops:operations.budgetColumns.forecast',
};

/** True for a budget column that has a translated label. */
export function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(metricLabelKeys, value);
}

/** Translated label of a budget column, keyed by report metric. */
export function getMetricLabels(t: TFunction): Record<MetricKey, string> {
  return {
    budget: t(metricLabelKeys.budget),
    follow_up: t(metricLabelKeys.follow_up),
    landing: t(metricLabelKeys.landing),
    revision: t(metricLabelKeys.revision),
    forecast: t(metricLabelKeys.forecast),
  };
}

/**
 * Height of a horizontal bar chart from its row count: one bar row per category plus
 * the title, axis and footnote, so a single department does not become a wall of colour.
 */
export function horizontalBarChartHeight(rowCount: number, minHeight = 180, maxHeight = 520): number {
  return Math.max(minHeight, Math.min(maxHeight, 120 + Math.max(rowCount, 1) * 44));
}
