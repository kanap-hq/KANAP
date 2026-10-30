import type { EntityManager } from 'typeorm';
import type { AnalyticsAxesService, AnalyticsAxisRow } from '../../analytics/analytics-axes.service';
import { ANALYTICS_CSV_PREFIX, axisRequiredFor, DEFAULT_ANALYTICS_AXIS_LABELS } from '../../analytics/analytics-axes.util';
import { AXIS_APPLIES_TO, type AxisAppliesTo } from '../../analytics/analytics-axis.entity';
import { AI_SCREEN_LANGUAGES, type AiScreenLanguage } from '../ai-unread-families';
import { compareText, dateMatch, numberMatch, paged, setMatch, textMatch } from './ai-support.query';

/**
 * Master data › Analytics dimensions as the screen shows them, for the assistant and the MCP
 * server: the family `analytics_axes`, one row per dimension, read through `AnalyticsAxesService`
 * (`list`, `get`: the routes of the screen), never a second formula. Its values are the family
 * `analytics_categories`, filtered on `axis_code`.
 *
 * "Required" is the setting; it applies only while the dimension is enabled, to the natures it
 * applies to (`axisRequiredFor`): `required_for` says where it applies. The list is small (the
 * dimensions of a tenant): filtered, grouped, sorted and paged in memory, here.
 */

export const AI_AXIS_STATUSES = ['enabled', 'disabled'] as const;
export const AI_AXIS_NATURES: readonly AxisAppliesTo[] = AXIS_APPLIES_TO;
export const AI_AXIS_BOOLEANS = ['true', 'false'] as const;

/** The field of `budget_lines` that holds the line's value on the default dimension. */
export const AI_DEFAULT_ANALYTICS_FIELD = 'analytics_category';

export const AI_AXIS_VALUES_NOTE = 'The values of a dimension are the family analytics_categories, filtered on axis_code (the dimension\'s code). '
  + 'A budget line\'s value on a dimension is the budget_lines field named by `field`.';

export type AiAnalyticsAxisRow = {
  id: string;
  code: string;
  /** The name, or the screen's label of the unnamed default dimension in the person's language. */
  name: string;
  description: string | null;
  is_default: boolean;
  /** opex, capex, or null for both natures. */
  applies_to: AxisAppliesTo | null;
  /** The setting, kept on a disabled dimension. */
  required: boolean;
  /** Where the setting applies: the natures of an enabled required dimension; empty otherwise. */
  required_for: AxisAppliesTo[];
  open_values: boolean;
  status: 'enabled' | 'disabled';
  disabled_at: string | null;
  sort_order: number;
  /** The budget_lines field of the dimension; null for a disabled dimension, which budget_lines does not offer. */
  field: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export type AiAnalyticsAxesServices = { axes: Pick<AnalyticsAxesService, 'list' | 'get'> };

export type AiAnalyticsAxesOpts = {
  manager: EntityManager;
  tenantId: string;
  userId?: string | null;
  language: AiScreenLanguage | null;
};

export const ANALYTICS_AXIS_SORTS = new Set(['code', 'name', 'sort_order', 'status', 'created_at', 'updated_at']);

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** The label the screens show for the unnamed default dimension, in the person's language (English when unknown). */
export function defaultAxisLabel(language: AiScreenLanguage | null): string {
  return DEFAULT_ANALYTICS_AXIS_LABELS[Math.max(AI_SCREEN_LANGUAGES.indexOf(language ?? 'en'), 0)];
}

/** A dimension of the screen's service as the family's row. */
export function toAiAnalyticsAxisRow(axis: AnalyticsAxisRow, language: AiScreenLanguage | null): AiAnalyticsAxisRow {
  const name = axis.name && axis.name.trim() ? axis.name : null;
  return {
    id: axis.id,
    code: axis.code,
    name: name ?? defaultAxisLabel(language),
    description: axis.description ?? null,
    is_default: axis.is_default === true,
    applies_to: axis.applies_to ?? null,
    required: axis.required === true,
    required_for: AXIS_APPLIES_TO.filter((scope) => axisRequiredFor(axis, scope)),
    open_values: axis.open_values === true,
    status: axis.status,
    disabled_at: iso(axis.disabled_at),
    sort_order: Number(axis.sort_order ?? 0),
    // The default keeps `analytics_category` whatever its state; another dimension is a field of
    // budget_lines while enabled only (`withAnalyticsAxisFields`).
    field: axis.is_default ? AI_DEFAULT_ANALYTICS_FIELD : axis.status === 'enabled' ? `${ANALYTICS_CSV_PREFIX}${axis.code}` : null,
    created_at: iso(axis.created_at),
    updated_at: iso(axis.updated_at),
  };
}

/** `required_for` as a set filter: a nature named, or null for a dimension required nowhere. */
function requiredForMatch(values: AxisAppliesTo[], model: any): boolean {
  if (!model || model.filterType !== 'set' || !Array.isArray(model.values)) return true;
  const wanted = model.values.filter((entry: unknown): entry is string => typeof entry === 'string');
  const blank = model.values.some((entry: unknown) => entry === null || entry === undefined);
  const matched = values.some((value) => wanted.includes(value)) || (values.length === 0 && blank);
  return model.mode === 'exclude' ? !matched : matched;
}

function filtered(rows: AiAnalyticsAxisRow[], query: Record<string, any>): AiAnalyticsAxisRow[] {
  const filters = query.filters;
  const needle = String(query.q ?? '').trim().toLowerCase();
  return rows.filter((row) => textMatch(row.code, filters?.code)
    && textMatch(row.name, filters?.name)
    && textMatch(row.description, filters?.description)
    && setMatch(String(row.is_default), filters?.is_default)
    && setMatch(row.applies_to, filters?.applies_to)
    && setMatch(String(row.required), filters?.required)
    && requiredForMatch(row.required_for, filters?.required_for)
    && setMatch(String(row.open_values), filters?.open_values)
    && setMatch(row.status, filters?.status)
    && dateMatch(row.disabled_at, filters?.disabled_at)
    && numberMatch(row.sort_order, filters?.sort_order)
    && textMatch(row.field, filters?.field)
    && dateMatch(row.created_at, filters?.created_at)
    && dateMatch(row.updated_at, filters?.updated_at)
    && (!needle || [row.code, row.name, row.description].some((value) => value != null && value.toLowerCase().includes(needle))));
}

function sortValue(row: AiAnalyticsAxisRow, field: string): string | number | null {
  switch (field) {
    case 'code': return row.code;
    case 'name': return row.name;
    case 'sort_order': return row.sort_order;
    case 'status': return row.status;
    case 'created_at': return row.created_at;
    case 'updated_at': return row.updated_at;
    default: return null;
  }
}

function sortRows(rows: AiAnalyticsAxisRow[], sort: string | undefined): AiAnalyticsAxisRow[] {
  const [requested, requestedDirection] = String(sort ?? '').split(':');
  const field = ANALYTICS_AXIS_SORTS.has(requested) ? requested : 'sort_order';
  const descending = String(requestedDirection ?? 'asc').toLowerCase() === 'desc';
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, field) }))
    .sort((a, b) => {
      const order = typeof a.value === 'number' && typeof b.value === 'number'
        ? a.value - b.value
        : compareText(a.value == null ? null : String(a.value), b.value == null ? null : String(b.value));
      // Ties keep the screen's order: position, name, code.
      if (order === 0) return a.index - b.index;
      return descending ? -order : order;
    })
    .map((entry) => entry.row);
}

export async function listAiAnalyticsAxes(
  services: AiAnalyticsAxesServices,
  query: Record<string, any>,
  opts: AiAnalyticsAxesOpts,
  readAll = false,
): Promise<{ items: AiAnalyticsAxisRow[]; total: number; page: number; limit: number }> {
  const { items } = await services.axes.list({ manager: opts.manager, tenantId: opts.tenantId, userId: opts.userId ?? null });
  const rows = items.map((axis) => toAiAnalyticsAxisRow(axis, opts.language));
  return paged(sortRows(filtered(rows, query), query.sort), query, readAll);
}

/** The group key of a row, for the in-memory aggregate; a dimension required for both natures counts in both. */
export function analyticsAxisGroupValues(row: AiAnalyticsAxisRow, groupBy: string): Array<string | null> {
  switch (groupBy) {
    case 'is_default': return [String(row.is_default)];
    case 'applies_to': return [row.applies_to];
    case 'required': return [String(row.required)];
    case 'required_for': return row.required_for.length ? [...row.required_for] : [null];
    case 'open_values': return [String(row.open_values)];
    case 'status': return [row.status];
    default: return [null];
  }
}

/** The dimensions of each group of the filtered rows, most first. */
export function aggregateAnalyticsAxisRows(
  rows: AiAnalyticsAxisRow[],
  groupBy: string,
): Array<{ key: string | null; count: number }> {
  const groups = new Map<string | null, number>();
  for (const row of rows) {
    for (const key of analyticsAxisGroupValues(row, groupBy)) groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  return [...groups.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count || compareText(a.key, b.key));
}
