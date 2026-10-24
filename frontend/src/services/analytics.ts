import api from '../api';
import { deriveStatusFromDisabledAt } from '../constants/status';
import type { LineType } from '../constants/lineTypeUsage';

/**
 * Analytics dimensions (`/analytics-axes`) and their values (`/analytics-categories`). "Axis" and
 * "category" are the storage words; the UI says dimension and value. Each budget line holds at most
 * one value per dimension. The default dimension (`is_default`) is an identity, never a position:
 * the legacy `analytics_category_*` fields address it. Its name may be null, and every screen then
 * shows the translated default label (`useAnalyticsAxes().label`).
 */
export type AnalyticsStatus = 'enabled' | 'disabled';

export type AnalyticsAxis = {
  id: string;
  code: string;
  name: string | null;
  description: string | null;
  /** The dimension's position (read only in the UI, set through `reorderAnalyticsAxes`). */
  sort_order: number;
  is_default: boolean;
  /** The lines the dimension applies to: OPEX only, CAPEX only, or both when null (always both for the default). */
  applies_to: LineType | null;
  /**
   * New lines must hold a value, and a held value cannot be cleared. Checked only while the dimension
   * is enabled, on the lines it applies to (`axisRequiredFor`). Lines without a value stay editable.
   */
  required: boolean;
  /**
   * Open values: anyone who may modify a budget line adds a value, from the line's picker or the
   * budget file. Closed (false, the default): values come from the dimension page.
   */
  open_values?: boolean;
  status: AnalyticsStatus;
  disabled_at: string | null;
  created_at?: string;
  updated_at?: string;
};

/** `GET /analytics-axes/:id`, and the create and update responses. */
export type AnalyticsAxisDetail = AnalyticsAxis & {
  value_count: number;
  opex_count: number;
  capex_count: number;
  /** OPEX / CAPEX lines of every status with no value on the dimension (0 for a type it does not apply to). */
  opex_missing?: number;
  capex_missing?: number;
  /** The types the dimension applies to for which none of its enabled values may be used. */
  unusable_for?: LineType[];
};

export type AnalyticsAxisWrite = {
  code: string;
  name: string | null;
  description?: string | null;
  sort_order?: number;
  /** Null for OPEX and CAPEX lines. On a patch, null clears it and absent leaves it unchanged. */
  applies_to?: LineType | null;
  /** Absent on a patch leaves it unchanged. */
  required?: boolean;
  /** Absent on a patch leaves it unchanged. Reserved to people with access to all data. */
  open_values?: boolean;
  status?: AnalyticsStatus;
  disabled_at?: string | null;
};

export type AnalyticsAxisPatch = Partial<AnalyticsAxisWrite>;

export type AnalyticsValue = {
  id: string;
  axis_id: string;
  name: string;
  description: string | null;
  /** The lines that may use the value: OPEX only, CAPEX only, or both when null. */
  applies_to: LineType | null;
  /**
   * The value's position in its dimension (1..n once reordered; read only, set through
   * `reorderAnalyticsValues`). Pickers, filters and lists offer the values by position, then name.
   */
  sort_order: number;
  status: AnalyticsStatus;
  disabled_at: string | null;
  created_at?: string;
  updated_at?: string;
  /** The OPEX and CAPEX lines holding it: the list (`GET /analytics-categories`) and the detail give them. */
  opex_count?: number;
  capex_count?: number;
};

/** `GET /analytics-categories/:id`, and the create and update responses. */
export type AnalyticsValueDetail = AnalyticsValue & {
  axis_name?: string | null;
  axis_is_default?: boolean;
};

export type AnalyticsValueWrite = {
  /** Omitted, the server uses the default dimension. Never changes after create. */
  axis_id?: string;
  name: string;
  description?: string | null;
  /** Null for OPEX and CAPEX lines. On a patch, null clears it and absent leaves it unchanged. */
  applies_to?: LineType | null;
  status?: AnalyticsStatus;
  disabled_at?: string | null;
};

export type AnalyticsValuePatch = Partial<Omit<AnalyticsValueWrite, 'axis_id'>>;

/** One entry of an item's `analytics_values` (detail, create and update responses), in dimension order. */
export type ItemAnalyticsValue = {
  axis_id: string;
  axis_code: string;
  axis_name: string | null;
  is_default: boolean;
  category_id: string;
  category_name: string;
};

export const ANALYTICS_AXES_ENDPOINT = '/analytics-axes';
export const ANALYTICS_VALUES_ENDPOINT = '/analytics-categories';
/** Picker search within one dimension (`axis_id`) and labels by `ids`. */
export const ANALYTICS_VALUES_LOOKUP_ENDPOINT = `${ANALYTICS_VALUES_ENDPOINT}/lookup`;
/** The values list in dimension order (`sort` of `GET /analytics-categories`). */
export const ANALYTICS_VALUE_ORDER_SORT = 'sort_order:ASC';

/** List and summary field of a dimension's value name (`analytics_<axis id>`), never split on a colon. */
export const ANALYTICS_FIELD_PREFIX = 'analytics_';

export function analyticsFieldKey(axisId: string): string {
  return `${ANALYTICS_FIELD_PREFIX}${axisId}`;
}

/** Enabled now: a dimension or value disabled from a future date still counts as enabled. */
export function isAnalyticsActive(entry: { status: string; disabled_at: string | null }, asOf: Date = new Date()): boolean {
  return entry.status !== 'disabled' && deriveStatusFromDisabledAt(entry.disabled_at, asOf) === 'enabled';
}

export async function getAnalyticsAxes(): Promise<AnalyticsAxis[]> {
  const res = await api.get<{ items: AnalyticsAxis[] }>(ANALYTICS_AXES_ENDPOINT);
  return Array.isArray(res.data?.items) ? res.data.items : [];
}

export async function getAnalyticsAxis(id: string): Promise<AnalyticsAxisDetail> {
  const res = await api.get<AnalyticsAxisDetail>(`${ANALYTICS_AXES_ENDPOINT}/${id}`);
  return res.data;
}

export async function createAnalyticsAxis(body: AnalyticsAxisWrite): Promise<AnalyticsAxisDetail> {
  const res = await api.post<AnalyticsAxisDetail>(ANALYTICS_AXES_ENDPOINT, body);
  return res.data;
}

export async function updateAnalyticsAxis(id: string, patch: AnalyticsAxisPatch): Promise<AnalyticsAxisDetail> {
  const res = await api.patch<AnalyticsAxisDetail>(`${ANALYTICS_AXES_ENDPOINT}/${id}`, patch);
  return res.data;
}

/**
 * Deletes a dimension. Without `force` the server refuses one that still has values; with it the
 * values go too and the budget lines lose their value on it. The default dimension is never deleted.
 */
export async function deleteAnalyticsAxis(id: string, opts?: { force?: boolean }): Promise<void> {
  await api.delete(`${ANALYTICS_AXES_ENDPOINT}/${id}`, opts?.force ? { params: { force: 'true' } } : undefined);
}

/**
 * Puts the dimensions in the order given (`POST /analytics-axes/reorder`). Dimensions left out keep
 * their relative order after the listed ones. Returns every dimension in the new order.
 */
export async function reorderAnalyticsAxes(axisIds: string[]): Promise<AnalyticsAxis[]> {
  const res = await api.post<{ items: AnalyticsAxis[] }>(`${ANALYTICS_AXES_ENDPOINT}/reorder`, { axis_ids: axisIds });
  return Array.isArray(res.data?.items) ? res.data.items : [];
}

export async function getAnalyticsValue(id: string): Promise<AnalyticsValueDetail> {
  const res = await api.get<AnalyticsValueDetail>(`${ANALYTICS_VALUES_ENDPOINT}/${id}`);
  return res.data;
}

export async function createAnalyticsValue(body: AnalyticsValueWrite): Promise<AnalyticsValueDetail> {
  const res = await api.post<AnalyticsValueDetail>(ANALYTICS_VALUES_ENDPOINT, body);
  return res.data;
}

/**
 * `POST /analytics-categories/from-line`: the value of `name` in an open dimension, found regardless
 * of case or created, for the line it goes on (`line_id`) or the place of a line being created.
 */
export type AnalyticsValueFromLine = {
  axis_id: string;
  name: string;
  line_id?: string;
  paying_company_id?: string;
  cost_center_id?: string;
};

export async function createAnalyticsValueFromLine(body: AnalyticsValueFromLine): Promise<AnalyticsValueDetail & { created: boolean }> {
  const res = await api.post<AnalyticsValueDetail & { created: boolean }>(`${ANALYTICS_VALUES_ENDPOINT}/from-line`, body);
  return res.data;
}

export async function updateAnalyticsValue(id: string, patch: AnalyticsValuePatch): Promise<AnalyticsValueDetail> {
  const res = await api.patch<AnalyticsValueDetail>(`${ANALYTICS_VALUES_ENDPOINT}/${id}`, patch);
  return res.data;
}

/** Deletes a value. Without `force` the server refuses one in use; with it the budget lines lose it. */
export async function deleteAnalyticsValue(id: string, opts?: { force?: boolean }): Promise<void> {
  await api.delete(`${ANALYTICS_VALUES_ENDPOINT}/${id}`, opts?.force ? { params: { force: 'true' } } : undefined);
}

/** Query key of every value of a dimension in its order (`getAnalyticsValuesInOrder`). */
export function analyticsValueOrderKey(axisId: string | null) {
  return ['analytics-categories', 'order', axisId] as const;
}

/** The most rows `GET /analytics-categories` returns in one page. */
const VALUES_PAGE_LIMIT = 1000;

/**
 * Every value of a dimension, disabled ones and both line types included, in the dimension's order.
 */
export async function getAnalyticsValuesInOrder(axisId: string, signal?: AbortSignal): Promise<AnalyticsValue[]> {
  const items: AnalyticsValue[] = [];
  for (let page = 1; ; page += 1) {
    const res = await api.get<{ items: AnalyticsValue[]; total: number }>(ANALYTICS_VALUES_ENDPOINT, {
      params: { axis_id: axisId, includeDisabled: '1', sort: ANALYTICS_VALUE_ORDER_SORT, limit: VALUES_PAGE_LIMIT, page },
      signal,
    });
    const batch = Array.isArray(res.data?.items) ? res.data.items : [];
    items.push(...batch);
    if (batch.length < VALUES_PAGE_LIMIT || items.length >= Number(res.data?.total ?? 0)) return items;
  }
}

/**
 * Puts a dimension's values in the order given (`POST /analytics-categories/reorder`). Values left
 * out keep their relative order after the listed ones. Returns the dimension's values in the new order.
 */
export async function reorderAnalyticsValues(axisId: string, valueIds: string[]): Promise<AnalyticsValue[]> {
  const res = await api.post<AnalyticsValue[] | { items: AnalyticsValue[] }>(`${ANALYTICS_VALUES_ENDPOINT}/reorder`, {
    axis_id: axisId,
    value_ids: valueIds,
  });
  const data = res.data;
  return Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
}

/** The recommended dimensions an administrator can add (`/analytics-axes/recommended`), in display order. */
export const RECOMMENDED_DIMENSION_CODES = ['cost_pool', 'it_tower', 'purpose', 'priority', 'recurrence'] as const;
export type RecommendedDimensionCode = (typeof RECOMMENDED_DIMENSION_CODES)[number];

/** A recommended dimension and whether the tenant already has it. `starting`: ticked by default (the others are the optional pack). */
export type RecommendedDimensionState = {
  code: RecommendedDimensionCode;
  present: boolean;
  axis_id: string | null;
  name: string | null;
  starting: boolean;
};

/** One dimension the call created or found. `axis_code` is `default` when the cost pool went on the default dimension. */
export type RecommendedDimensionResult = {
  code: RecommendedDimensionCode;
  axis_code: string;
  axis_id: string;
  name: string | null;
  values_created: number;
};

export async function getRecommendedDimensions(): Promise<RecommendedDimensionState[]> {
  const res = await api.get<{ items: RecommendedDimensionState[] }>(`${ANALYTICS_AXES_ENDPOINT}/recommended`);
  return Array.isArray(res.data?.items) ? res.data.items : [];
}

/** Creates the recommended dimensions of `codes` the tenant lacks, named in `language`. */
export async function addRecommendedDimensions(
  codes: RecommendedDimensionCode[],
  language: string,
): Promise<{ created: RecommendedDimensionResult[]; existing: RecommendedDimensionResult[] }> {
  const res = await api.post<{ created: RecommendedDimensionResult[]; existing: RecommendedDimensionResult[] }>(
    `${ANALYTICS_AXES_ENDPOINT}/recommended`,
    { codes, language },
  );
  return { created: res.data?.created ?? [], existing: res.data?.existing ?? [] };
}
