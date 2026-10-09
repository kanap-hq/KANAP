import { ANALYTICS_CSV_PREFIX, AnalyticsAxisInfo, analyticsAxisLabel, axisAppliesTo } from '../analytics/analytics-axes.util';

/** One analytics dimension a budget line can be given a value on, as the prompt lists it. */
export type AnalyticsDimensionPromptEntry = {
  /** The field key for create_business_record / update_business_record. */
  key: string;
  name: string;
  default: boolean;
  /** The readable line types it applies to. */
  used_for: Array<'opex' | 'capex'>;
};

export type AnalyticsDimensionsPromptContext = AnalyticsDimensionPromptEntry[];

/**
 * The analytics dimensions OPEX and CAPEX lines may be given a value on, each
 * listed once: the enabled dimensions, in display order, with the line types
 * the user can read that they apply to. The default dimension keeps the key
 * `analytics_category` (as on the query side), the others are `analytics:<code>`.
 * Undefined when the user reads neither line type.
 */
export function analyticsDimensionsAiContext(
  axes: AnalyticsAxisInfo[],
  readableTypes: readonly string[],
): AnalyticsDimensionsPromptContext | undefined {
  const scopes: Array<'opex' | 'capex'> = [];
  if (readableTypes.includes('spend_items')) scopes.push('opex');
  if (readableTypes.includes('capex_items')) scopes.push('capex');
  if (scopes.length === 0) return undefined;
  return axes
    .filter((axis) => axis.status === 'enabled')
    .map((axis) => ({
      key: axis.is_default ? 'analytics_category' : `${ANALYTICS_CSV_PREFIX}${axis.code}`,
      name: analyticsAxisLabel(axis),
      default: axis.is_default,
      used_for: scopes.filter((scope) => axisAppliesTo(axis, scope)),
    }))
    .filter((entry) => entry.used_for.length > 0);
}
