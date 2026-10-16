import type { ValueFormatterParams } from 'ag-grid-community';
import i18n, { resolveSupportedLocale } from '../../i18n';
import { formatCount } from '../../i18n/formatters';

/**
 * AG Grid `valueFormatter` for integer cells (headcounts, linked item counts): the number with the
 * thousand separator of the user language. Empty when there is no value.
 */
export function countValueFormatter(params: Pick<ValueFormatterParams, 'value'>): string {
  const value = params.value;
  if (value == null || value === '') return '';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return formatCount(n, resolveSupportedLocale(i18n.resolvedLanguage || i18n.language || 'en'));
}
