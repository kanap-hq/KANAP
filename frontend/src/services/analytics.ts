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
  sort_order: number;
  is_default: boolean;
  /** The lines the dimension applies to: OPEX only, CAPEX only, or both when null (always both for the default). */
  applies_to: LineType | null;
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
};

export type AnalyticsAxisWrite = {
  code: string;
  name: string | null;
  description?: string | null;
  sort_order?: number;
  /** Null for OPEX and CAPEX lines. On a patch, null clears it and absent leaves it unchanged. */
  applies_to?: LineType | null;
  status?: AnalyticsStatus;
  disabled_at?: string | null;
};

export type AnalyticsAxisPatch = Partial<AnalyticsAxisWrite>;

export type AnalyticsValue = {
  id: string;
  axis_id: string;
  name: string;
  description: string | null;
  status: AnalyticsStatus;
  disabled_at: string | null;
  created_at?: string;
  updated_at?: string;
};

/** `GET /analytics-categories/:id`, and the create and update responses. */
export type AnalyticsValueDetail = AnalyticsValue & {
  axis_name?: string | null;
  axis_is_default?: boolean;
  opex_count?: number;
  capex_count?: number;
};

export type AnalyticsValueWrite = {
  /** Omitted, the server uses the default dimension. Never changes after create. */
  axis_id?: string;
  name: string;
  description?: string | null;
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

export async function deleteAnalyticsAxis(id: string): Promise<void> {
  await api.delete(`${ANALYTICS_AXES_ENDPOINT}/${id}`);
}

export async function getAnalyticsValue(id: string): Promise<AnalyticsValueDetail> {
  const res = await api.get<AnalyticsValueDetail>(`${ANALYTICS_VALUES_ENDPOINT}/${id}`);
  return res.data;
}

export async function createAnalyticsValue(body: AnalyticsValueWrite): Promise<AnalyticsValueDetail> {
  const res = await api.post<AnalyticsValueDetail>(ANALYTICS_VALUES_ENDPOINT, body);
  return res.data;
}

export async function updateAnalyticsValue(id: string, patch: AnalyticsValuePatch): Promise<AnalyticsValueDetail> {
  const res = await api.patch<AnalyticsValueDetail>(`${ANALYTICS_VALUES_ENDPOINT}/${id}`, patch);
  return res.data;
}

export async function deleteAnalyticsValue(id: string): Promise<void> {
  await api.delete(`${ANALYTICS_VALUES_ENDPOINT}/${id}`);
}
