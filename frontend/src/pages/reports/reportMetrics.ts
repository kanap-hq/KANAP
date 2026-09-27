import { useMemo, useState } from 'react';
import { AMOUNT_COLUMNS, type AmountColumnKey } from '../../components/finance/amountColumns';
import type { BudgetColumns } from '../../hooks/useBudgetColumns';

/** A budget column as the summary API and the reports name it. */
export type MetricKey = AmountColumnKey;

/**
 * The five budget columns in their fixed order (column 1 to 5). Which ones a picker offers,
 * their names and the preselected one come from the tenant setting (`useBudgetColumns()`).
 */
export const metricKeys: readonly MetricKey[] = AMOUNT_COLUMNS.map((column) => column.key);

/** True for the summary key of a budget column. */
export function isMetricKey(value: unknown): value is MetricKey {
  return typeof value === 'string' && (metricKeys as readonly string[]).includes(value);
}

/** Columns a report picker offers: the shown columns, fixed order. */
export function shownMetricKeys(columns: BudgetColumns): MetricKey[] {
  return columns.shown.map((column) => column.key);
}

/** A picked column while it is shown; otherwise (nothing picked, or hidden since) the default column. */
export function resolveMetric(columns: BudgetColumns, picked: string | null | undefined): MetricKey {
  const column = picked ? columns.shown.find((c) => c.key === picked) : undefined;
  return (column ?? columns.defaultColumn).key;
}

/**
 * Picked columns that are still shown, fixed order. Nothing picked yet: the list display defaults
 * (default column, then the last shown one). An emptied selection keeps the default column.
 */
export function resolveMetrics(columns: BudgetColumns, picked: readonly string[] | null): MetricKey[] {
  if (picked == null) return columns.displayDefaults.map((column) => column.key);
  const kept = columns.shown.filter((column) => picked.includes(column.key)).map((column) => column.key);
  return kept.length > 0 ? kept : [columns.defaultColumn.key];
}

/** Column name in a downloaded file name: lower-case letters and digits, `column-N` when none is left. */
export function metricFileName(columns: BudgetColumns, key: string): string {
  const column = columns.get(key);
  const slug = column.label
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `column-${column.position}`;
}

/** One picker column: follows the default column until the user picks one. */
export function useReportMetric(columns: BudgetColumns): [MetricKey, (key: MetricKey) => void] {
  const [picked, setPicked] = useState<MetricKey | null>(null);
  return [resolveMetric(columns, picked), setPicked];
}

/** Several picker columns: the list display defaults until the user picks others. */
export function useReportMetrics(columns: BudgetColumns): [MetricKey[], (keys: string[]) => void] {
  const [picked, setPicked] = useState<string[] | null>(null);
  const metrics = useMemo(() => resolveMetrics(columns, picked), [columns, picked]);
  return [metrics, setPicked];
}

/**
 * Height of a horizontal bar chart from its row count: one bar row per category plus
 * the title, axis and footnote, so a single department does not become a wall of colour.
 */
export function horizontalBarChartHeight(rowCount: number, minHeight = 180, maxHeight = 520): number {
  return Math.max(minHeight, Math.min(maxHeight, 120 + Math.max(rowCount, 1) * 44));
}
