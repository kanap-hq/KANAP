import { ANALYTICS_CSV_PREFIX, AnalyticsAxisInfo, analyticsAxisLabel, axisAppliesTo } from '../analytics/analytics-axes.util';

/** One analytics dimension a budget line can be given a value on, as the prompt lists it. */
export type AnalyticsDimensionPromptEntry = {
  /** The field key for create_business_record / update_business_record. */
  key: string;
  name: string;
  default: boolean;
};

/** The writable dimensions per line type, for the line types the user can read. */
export type AnalyticsDimensionsPromptContext = {
  opex_lines?: AnalyticsDimensionPromptEntry[];
  capex_lines?: AnalyticsDimensionPromptEntry[];
};

/**
 * The analytics dimensions OPEX and CAPEX lines may be given a value on: the
 * enabled dimensions used for each line type, in display order. The default
 * dimension keeps the key `analytics_category` (as on the query side), the
 * others are `analytics:<code>`. Undefined when the user reads neither type.
 */
export function analyticsDimensionsAiContext(
  axes: AnalyticsAxisInfo[],
  readableTypes: readonly string[],
): AnalyticsDimensionsPromptContext | undefined {
  const entries = (scope: 'opex' | 'capex'): AnalyticsDimensionPromptEntry[] => axes
    .filter((axis) => axis.status === 'enabled' && axisAppliesTo(axis, scope))
    .map((axis) => ({
      key: axis.is_default ? 'analytics_category' : `${ANALYTICS_CSV_PREFIX}${axis.code}`,
      name: analyticsAxisLabel(axis),
      default: axis.is_default,
    }));
  const context: AnalyticsDimensionsPromptContext = {};
  if (readableTypes.includes('spend_items')) context.opex_lines = entries('opex');
  if (readableTypes.includes('capex_items')) context.capex_lines = entries('capex');
  return context.opex_lines || context.capex_lines ? context : undefined;
}
