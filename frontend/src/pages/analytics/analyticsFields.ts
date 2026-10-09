import type { TFunction } from 'i18next';

export const ANALYTICS_LIST_PATH = '/master-data/analytics';
export const ANALYTICS_DIMENSIONS_PATH = `${ANALYTICS_LIST_PATH}/dimensions`;

/** Query key prefix of a dimension's detail (`GET /analytics-axes/:id`), under the dimensions' key so one invalidation reaches both. */
export const ANALYTICS_AXIS_DETAIL_KEY = ['analytics-axes', 'detail'] as const;

/** The server's rule for a dimension code (CSV headers and AI keys use it). */
export const DIMENSION_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

// Letters that do not decompose into a base letter and an accent.
const SPELLED_LETTERS: Record<string, string> = { 'œ': 'oe', 'æ': 'ae', 'ß': 'ss', 'ø': 'o' };

/**
 * A code proposed from a name: lowercase, letters spelled out or stripped of their accents, spaces to `-`,
 * other characters dropped, 40 at most, never ending with `-` or `_`.
 */
export function proposeDimensionCode(name: string): string {
  return name
    .toLowerCase()
    .replace(/[œæßø]/g, (letter) => SPELLED_LETTERS[letter])
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^[_-]+/, '')
    .slice(0, 40)
    .replace(/[_-]+$/, '');
}

/** Fields a refusal can be attached to, so the error shows under the field that caused it. */
export type AnalyticsField = 'name' | 'code' | 'description' | 'sort_order' | 'applies_to' | 'axis_id' | 'disabled_at';

const REFUSAL_FIELDS: ReadonlySet<string> = new Set<AnalyticsField>([
  'name', 'code', 'description', 'sort_order', 'applies_to', 'axis_id', 'disabled_at',
]);

/**
 * The field a server refusal names (`{ message, field }` in the 400 body), or null when it names none.
 * A lifecycle refusal (`status`) belongs under the date.
 */
export function analyticsRefusalField(error: unknown): AnalyticsField | null {
  const raw = (error as { response?: { data?: { field?: unknown } } } | null)?.response?.data?.field;
  const field = raw === 'status' ? 'disabled_at' : raw;
  return typeof field === 'string' && REFUSAL_FIELDS.has(field) ? (field as AnalyticsField) : null;
}

function linesUsage(t: TFunction, opexCount: number, capexCount: number): { opex: string | null; capex: string | null } {
  return {
    opex: opexCount > 0 ? t('analytics.usage.opex', { count: opexCount }) : null,
    capex: capexCount > 0 ? t('analytics.usage.capex', { count: capexCount }) : null,
  };
}

/** "Used by 3 OPEX lines and 1 CAPEX line.", or null when no line uses the value. */
export function valueUsageLine(t: TFunction, opexCount: number, capexCount: number): string | null {
  const { opex, capex } = linesUsage(t, opexCount, capexCount);
  if (opex && capex) return t('analytics.usage.valueBoth', { opex, capex });
  if (opex || capex) return t('analytics.usage.valueOne', { lines: opex ?? capex });
  return null;
}

/** "12 values, used by 27 OPEX lines and 2 CAPEX lines." */
export function dimensionUsageLine(t: TFunction, valueCount: number, opexCount: number, capexCount: number): string {
  if (valueCount <= 0) return t('analytics.usage.noValues');
  const values = t('analytics.usage.values', { count: valueCount });
  const { opex, capex } = linesUsage(t, opexCount, capexCount);
  if (opex && capex) return t('analytics.usage.dimensionBoth', { values, opex, capex });
  if (opex || capex) return t('analytics.usage.dimensionOne', { values, lines: opex ?? capex });
  return t('analytics.usage.dimensionUnused', { values });
}

/** The line that explains a disabled Delete on a dimension other than the default, or null when it can be deleted. */
export function dimensionDeleteBlock(t: TFunction, valueCount: number): string | null {
  return valueCount > 0 ? t('analytics.deleteBlocked.dimensionHasValues') : null;
}
