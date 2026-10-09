import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { getAnalyticsAxes, isAnalyticsActive, type AnalyticsAxis } from '../services/analytics';
import { usageAllowsLineType, type LineType } from '../constants/lineTypeUsage';

export const ANALYTICS_AXES_QUERY_KEY = ['analytics-axes'] as const;

export type AnalyticsAxes = {
  /** False until the dimensions are loaded (or while the hook is disabled). */
  ready: boolean;
  /** The last load failed: `axes` is then empty and says nothing about the tenant. */
  isError: boolean;
  /** Every dimension, disabled ones included, in order: sort order, then name, then code. */
  axes: AnalyticsAxis[];
  /**
   * Dimensions enabled now, in order. Forms, lists, filters and reports show these only. With a
   * scope, only those that apply to its lines (the default dimension always does).
   */
  enabled: AnalyticsAxis[];
  byId: Map<string, AnalyticsAxis>;
  defaultAxis: AnalyticsAxis | null;
  /** The dimension's name, or the translated "Analytics dimension" when it has none (the default only). */
  label(axis: Pick<AnalyticsAxis, 'name'>): string;
};

/**
 * The dimension applies to lines of `scope`: used for both types (null), or for that one. A value a
 * line holds on a dimension that does not apply to its type stays stored and is never shown.
 */
export function axisAppliesTo(axis: Pick<AnalyticsAxis, 'applies_to'>, scope: LineType): boolean {
  return usageAllowsLineType(axis.applies_to, scope);
}

/**
 * A known dimension the screen shows no field for: disabled, or (with a scope) not applying to its
 * lines. A write leaves its value out. An unknown id (dimensions not loaded) is not hidden: the
 * server decides.
 */
export function isHiddenAxis(axes: Pick<AnalyticsAxes, 'byId' | 'enabled'>, axisId: string): boolean {
  return axes.byId.has(axisId) && !axes.enabled.some((axis) => axis.id === axisId);
}

/** The display name of a dimension: its name, else the translated default label. */
export function analyticsAxisLabel(axis: Pick<AnalyticsAxis, 'name'> | null | undefined, t: TFunction): string {
  const name = axis?.name?.trim();
  return name || t('master-data:analytics.analyticsCategoryFallback');
}

// The server's order (sort order, then lower(coalesce(name, '')), then code), repeated so a screen
// never depends on the response order.
function compareAxes(a: AnalyticsAxis, b: AnalyticsAxis): number {
  if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
  const an = (a.name ?? '').toLowerCase();
  const bn = (b.name ?? '').toLowerCase();
  if (an !== bn) return an < bn ? -1 : 1;
  if (a.code !== b.code) return a.code < b.code ? -1 : 1;
  return 0;
}

/**
 * Pure core of the hook, exported for tests and callers that already hold the dimensions. `scope`
 * narrows `enabled` only: `axes`, `byId`, `defaultAxis` and `label` stay complete, for the labels
 * of held values and edit conflicts.
 */
export function buildAnalyticsAxes(
  list: AnalyticsAxis[],
  t: TFunction,
  ready = true,
  isError = false,
  asOf: Date = new Date(),
  scope?: LineType | null,
): AnalyticsAxes {
  const axes = [...list].sort(compareAxes);
  const byId = new Map<string, AnalyticsAxis>();
  for (const axis of axes) byId.set(axis.id, axis);
  return {
    ready,
    isError,
    axes,
    enabled: axes.filter((axis) => isAnalyticsActive(axis, asOf) && (!scope || axisAppliesTo(axis, scope))),
    byId,
    defaultAxis: axes.find((axis) => axis.is_default) ?? null,
    label: (axis) => analyticsAxisLabel(axis, t),
  };
}

const EMPTY: AnalyticsAxis[] = [];

/**
 * The tenant's dimensions. Pass the line type (`scope`) wherever the list belongs to OPEX or CAPEX
 * lines: `enabled` then holds only the dimensions that apply to it. Admin screens pass none.
 */
export function useAnalyticsAxes(options?: { enabled?: boolean; scope?: LineType | null }): AnalyticsAxes {
  const enabled = options?.enabled ?? true;
  const scope = options?.scope ?? null;
  const { t } = useTranslation(['master-data']);
  const query = useQuery({
    queryKey: ANALYTICS_AXES_QUERY_KEY,
    queryFn: getAnalyticsAxes,
    enabled,
    staleTime: 5 * 60_000,
  });
  const list = query.data ?? EMPTY;
  const ready = enabled && (query.isSuccess || query.isError);
  const isError = enabled && query.isError;
  return useMemo(() => buildAnalyticsAxes(list, t, ready, isError, undefined, scope), [list, t, ready, isError, scope]);
}
