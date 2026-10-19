import type { ValueFormatterParams } from 'ag-grid-community';
import i18n, { resolveSupportedLocale } from '../../i18n';
import { formatCount, formatDecimal } from '../../i18n/formatters';

/** Shown when a company metric was not entered. A stored zero stays a zero. */
export const EMPTY_METRIC = '—';

export function formatMetricValue(value: unknown, locale: string, kind: 'count' | 'decimal'): string {
  if (value == null || value === '') return EMPTY_METRIC;
  const n = Number(value);
  if (!Number.isFinite(n)) return EMPTY_METRIC;
  return kind === 'count' ? formatCount(n, locale) : formatDecimal(n, locale);
}

/** AG Grid formatter. Reads the language when the cell is drawn, like `countValueFormatter`. */
export function metricValueFormatter(kind: 'count' | 'decimal') {
  return (params: Pick<ValueFormatterParams, 'value'>): string =>
    formatMetricValue(
      params.value,
      resolveSupportedLocale(i18n.resolvedLanguage || i18n.language || 'en'),
      kind,
    );
}
