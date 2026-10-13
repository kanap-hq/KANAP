import type { TFunction } from 'i18next';
import type { LineType } from '../../constants/lineTypeUsage';

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
export type AnalyticsField = 'name' | 'code' | 'description' | 'sort_order' | 'applies_to' | 'required' | 'axis_id' | 'disabled_at';

const REFUSAL_FIELDS: ReadonlySet<string> = new Set<AnalyticsField>([
  'name', 'code', 'description', 'sort_order', 'applies_to', 'required', 'axis_id', 'disabled_at',
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

/**
 * The number of budget lines using a dimension or a value. A line has one nature and at most one value
 * per dimension (the link's key is tenant, line, dimension), so the per-nature counts add up to
 * distinct lines.
 */
export function usedLineCount(opexCount: number | null | undefined, capexCount: number | null | undefined): number {
  return (opexCount ?? 0) + (capexCount ?? 0);
}

/** "Used by 6 lines", or "Not used yet" without a line. */
export function linesUsageText(t: TFunction, kind: 'dimension' | 'value', lineCount: number): string {
  return lineCount > 0
    ? t(`analytics.usage.${kind}Lines`, { count: lineCount })
    : t(`analytics.usage.${kind}Unused`);
}

/** What a delete confirmation says: its title, its body and the label of its main action. */
export type DeleteConfirmation = { title: string; body: string; confirmLabel: string };

/**
 * The confirmation of a delete, or null when it needs none (nothing depends on the target).
 * A dimension with values: "Its 3 values are deleted too." (Delete). A dimension or a value used by
 * budget lines: what the lines lose, "This data cannot be recovered." (Delete anyway). `name` is the
 * name the screen shows; `lineCount` the distinct lines using it (`usedLineCount`).
 */
export function deleteConfirmation(
  t: TFunction,
  target: { kind: 'dimension'; name: string; valueCount: number; lineCount: number } | { kind: 'value'; name: string; lineCount: number },
): DeleteConfirmation | null {
  const title = t('analytics.forceDelete.title', { name: target.name });
  const anyway = t('analytics.forceDelete.confirmAnyway');
  if (target.kind === 'value') {
    return target.lineCount > 0
      ? { title, body: t('analytics.forceDelete.valueUsed', { count: target.lineCount }), confirmLabel: anyway }
      : null;
  }
  if (target.valueCount <= 0) return null;
  if (target.lineCount <= 0) {
    return { title, body: t('analytics.forceDelete.dimensionValues', { count: target.valueCount }), confirmLabel: t('common:buttons.delete') };
  }
  return {
    title,
    body: t('analytics.forceDelete.dimensionUsed', {
      values: t('analytics.forceDelete.dimensionUsedValues', { count: target.valueCount }),
      lines: t('analytics.forceDelete.budgetLines', { count: target.lineCount }),
    }),
    confirmLabel: anyway,
  };
}

/**
 * The values grid's bulk delete when some selected values are used by budget lines: "2 selected
 * values are used: they are removed from 6 budget lines. This data cannot be recovered."; null when
 * none is. The values of the grid belong to one dimension, so their line counts add up to distinct lines.
 */
export function valuesInUseMessage(
  t: TFunction,
  values: ReadonlyArray<{ opex_count?: number | null; capex_count?: number | null }>,
): string | null {
  const used = values.map((value) => usedLineCount(value.opex_count, value.capex_count)).filter((count) => count > 0);
  if (used.length === 0) return null;
  const lines = used.reduce((sum, count) => sum + count, 0);
  return t('analytics.forceDelete.valuesUsed', { count: used.length, lines: t('analytics.forceDelete.budgetLines', { count: lines }) });
}

/**
 * "117 OPEX lines and 15 CAPEX lines have no value.", naming only the types with lines lacking a
 * value; null when none does.
 */
export function requiredMissingLine(t: TFunction, opexMissing: number, capexMissing: number): string | null {
  if (opexMissing > 0 && capexMissing > 0) {
    return t('analytics.required.missing.both', {
      opex: t('analytics.usage.opex', { count: opexMissing }),
      capex: t('analytics.usage.capex', { count: capexMissing }),
    });
  }
  if (opexMissing > 0) return t('analytics.required.missing.opex', { count: opexMissing });
  if (capexMissing > 0) return t('analytics.required.missing.capex', { count: capexMissing });
  return null;
}

/** "No enabled value can be used on CAPEX lines. New CAPEX lines cannot be created.", or null when every type has one. */
export function requiredUnusableLine(t: TFunction, unusableFor: readonly LineType[] | null | undefined): string | null {
  const opex = !!unusableFor?.includes('opex');
  const capex = !!unusableFor?.includes('capex');
  if (opex && capex) return t('analytics.required.unusable.both');
  if (opex) return t('analytics.required.unusable.opex');
  if (capex) return t('analytics.required.unusable.capex');
  return null;
}
