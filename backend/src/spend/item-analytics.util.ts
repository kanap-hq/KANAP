import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { validate as isUuid } from 'uuid';
import { isActiveAt } from '../common/status';
import { withSavepoint } from '../common/savepoint.util';
import { normalizeAnalyticsName } from '../analytics/analytics-context';
import {
  ANALYTICS_CSV_PREFIX,
  ANALYTICS_LINK_TABLES,
  AnalyticsAxisInfo,
  isAxisActive,
  loadAnalyticsAxes,
  resolveDefaultAxisId,
} from '../analytics/analytics-axes.util';

/**
 * The analytics values of OPEX and CAPEX lines: one value per line and
 * dimension, stored in the link tables (`spend_item_analytics_values`,
 * `capex_item_analytics_values`). The item column `analytics_category_id` is
 * no longer read or written; the legacy API field, CSV header and AI key of
 * that name address the default dimension (`is_default`) through the links.
 *
 * Resolution is called by the write gate (`item-write.util.ts`); the services
 * apply the resolved changes with `writeItemAnalyticsValues` after the line is
 * saved, in the request transaction. Every query carries its tenant predicate.
 */

export type ItemAnalyticsScope = 'opex' | 'capex';

/** One value of a line, as the detail and the create/update responses return it (dimension order). */
export interface ItemAnalyticsValue {
  axis_id: string;
  axis_code: string;
  axis_name: string | null;
  is_default: boolean;
  category_id: string;
  category_name: string;
}

/** A resolved change of one dimension of a line: a value to set, or null to clear it. */
export interface ItemAnalyticsChange {
  axis_id: string;
  category_id: string | null;
}

const LEGACY_ANALYTICS_FIELD = 'analytics_category_id';
const ANALYTICS_VALUES_FIELD = 'analytics_values';

const CONFLICT_MESSAGE = 'Send the analytics category once: analytics_category_id and analytics_values disagree.';
const DISABLED_VALUE_MESSAGE = 'This value is disabled.';

type ValueRow = { id: string; axis_id: string; name: string; status: string; disabled_at: Date | string | null };

function isValueActive(row: { status: string; disabled_at: Date | string | null }): boolean {
  return String(row.status ?? '').toLowerCase() !== 'disabled' && isActiveAt(row.disabled_at);
}

/** "the Nature dimension", or "the analytics dimension" (in-sentence form) for the default one while it has no name. */
function dimensionPhrase(axis: { name: string | null }): string {
  return axis.name && axis.name.trim() ? `the ${axis.name} dimension` : 'the analytics dimension';
}

function capitalized(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function disabledDimensionMessage(axis: { name: string | null }): string {
  return `${capitalized(dimensionPhrase(axis))} is disabled. Enable it or leave it out.`;
}

/** An id cell: null for null or blank, the lower-cased uuid otherwise; anything else names nothing. */
function idOrNull(value: unknown, notFound: string): string | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !isUuid(value)) throw new BadRequestException(notFound);
  return value.toLowerCase();
}

/**
 * The link changes an item body asks for, checked in the tenant:
 * - `analytics_values: { [axis_id]: category_id | null }`: omitted dimensions
 *   are untouched, null clears one;
 * - the legacy `analytics_category_id` addresses the default dimension; sent
 *   with a different value for it in `analytics_values`, the body is refused;
 * - a dimension must be the tenant's and enabled (on a disabled one, the
 *   line's unchanged value, or null where it has none, passes as a no-op);
 *   a value must be the tenant's and belong to that dimension; a disabled
 *   value is refused unless it is the line's current one.
 * Returns [] when the body names neither field. Throws a 400 on the first problem.
 */
export async function resolveItemAnalyticsChanges(
  manager: EntityManager,
  scope: ItemAnalyticsScope,
  tenantId: string,
  input: Record<string, unknown>,
  existingItemId: string | null,
): Promise<ItemAnalyticsChange[]> {
  const supplied = (key: string) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;
  const valuesSupplied = supplied(ANALYTICS_VALUES_FIELD);
  const legacySupplied = supplied(LEGACY_ANALYTICS_FIELD);
  if (!valuesSupplied && !legacySupplied) return [];

  // axis id → requested value; `legacy` only chooses the not-found wording.
  const requested = new Map<string, { categoryId: string | null; legacy: boolean }>();
  if (valuesSupplied) {
    const raw = input[ANALYTICS_VALUES_FIELD];
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
      throw new BadRequestException('Analytics values must map each dimension to a value or null.');
    }
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value === undefined) continue;
      const axisId = idOrNull(key, 'Analytics dimension not found.');
      if (!axisId) throw new BadRequestException('Analytics dimension not found.');
      requested.set(axisId, { categoryId: idOrNull(value, 'Analytics value not found.'), legacy: false });
    }
  }

  let axes: AnalyticsAxisInfo[] = await loadAnalyticsAxes(manager, tenantId);
  if (legacySupplied) {
    const legacyId = idOrNull(input[LEGACY_ANALYTICS_FIELD], 'Analytics category not found.');
    let defaultAxisId = axes.find((axis) => axis.is_default)?.id ?? null;
    if (!defaultAxisId && legacyId) {
      // A tenant inserted without its bootstrap: create its default dimension (write paths only).
      defaultAxisId = await resolveDefaultAxisId(manager, tenantId, { create: true });
      axes = await loadAnalyticsAxes(manager, tenantId);
    }
    if (defaultAxisId) {
      const sent = requested.get(defaultAxisId);
      if (sent && sent.categoryId !== legacyId) throw new BadRequestException(CONFLICT_MESSAGE);
      if (!sent) requested.set(defaultAxisId, { categoryId: legacyId, legacy: true });
    }
  }
  if (requested.size === 0) return [];

  const axisById = new Map(axes.map((axis) => [axis.id, axis]));
  const disabledAxisIds: string[] = [];
  for (const axisId of requested.keys()) {
    const axis = axisById.get(axisId);
    if (!axis) throw new BadRequestException('Analytics dimension not found.');
    if (axis.status !== 'enabled') disabledAxisIds.push(axisId);
  }
  if (disabledAxisIds.length > 0) {
    // A client echoing the line's values may name a disabled dimension: only a real change is refused.
    const current = new Map<string, string>();
    if (existingItemId) {
      const rows: Array<{ axis_id: string; category_id: string }> = await manager.query(
        `SELECT axis_id::text AS axis_id, category_id::text AS category_id
           FROM ${ANALYTICS_LINK_TABLES[scope]}
          WHERE tenant_id = $1 AND item_id = $2 AND axis_id = ANY($3::uuid[])`,
        [tenantId, existingItemId, disabledAxisIds],
      );
      for (const row of rows) current.set(row.axis_id, row.category_id);
    }
    for (const axisId of disabledAxisIds) {
      if ((current.get(axisId) ?? null) !== requested.get(axisId)!.categoryId) {
        throw new BadRequestException(disabledDimensionMessage(axisById.get(axisId)!));
      }
      requested.delete(axisId);
    }
    if (requested.size === 0) return [];
  }

  const categoryIds = Array.from(new Set(Array.from(requested.values()).map((r) => r.categoryId).filter((id): id is string => !!id)));
  const found = new Map<string, ValueRow & { is_current: boolean }>();
  if (categoryIds.length > 0) {
    // Table names come from ANALYTICS_LINK_TABLES only. FOR KEY SHARE: a value deleted meanwhile
    // makes this read wait, then find nothing (a 400), instead of failing the link insert later.
    const rows: Array<ValueRow & { is_current: boolean }> = await manager.query(
      `SELECT c.id::text AS id, c.axis_id::text AS axis_id, c.name, c.status::text AS status, c.disabled_at,
              EXISTS (
                SELECT 1 FROM ${ANALYTICS_LINK_TABLES[scope]} v
                 WHERE v.tenant_id = c.tenant_id AND v.item_id = $3::uuid AND v.axis_id = c.axis_id AND v.category_id = c.id
              ) AS is_current
         FROM analytics_categories c
        WHERE c.tenant_id = $1 AND c.id = ANY($2::uuid[])
          FOR KEY SHARE OF c`,
      [tenantId, categoryIds, existingItemId],
    );
    for (const row of rows) found.set(row.id, row);
  }

  const changes: ItemAnalyticsChange[] = [];
  for (const axis of axes) {
    const request = requested.get(axis.id);
    if (!request) continue;
    if (!request.categoryId) {
      changes.push({ axis_id: axis.id, category_id: null });
      continue;
    }
    const value = found.get(request.categoryId);
    if (!value) throw new BadRequestException(request.legacy ? 'Analytics category not found.' : 'Analytics value not found.');
    if (value.axis_id !== axis.id) throw new BadRequestException(`${value.name} is not a value of ${dimensionPhrase(axis)}.`);
    if (!value.is_current && !isValueActive(value)) throw new BadRequestException(DISABLED_VALUE_MESSAGE);
    changes.push({ axis_id: axis.id, category_id: value.id });
  }
  return changes;
}

/** Applies resolved changes to one line: one upsert for the values set, one delete for the dimensions cleared. */
export async function writeItemAnalyticsValues(
  manager: EntityManager,
  scope: ItemAnalyticsScope,
  tenantId: string,
  itemId: string,
  changes: ItemAnalyticsChange[],
): Promise<void> {
  const table = ANALYTICS_LINK_TABLES[scope];
  const sets = changes.filter((change) => !!change.category_id);
  const clears = changes.filter((change) => !change.category_id).map((change) => change.axis_id);
  if (sets.length > 0) {
    await manager.query(
      `INSERT INTO ${table} (tenant_id, item_id, axis_id, category_id)
       SELECT $1, $2, x.axis_id, x.category_id
         FROM unnest($3::uuid[], $4::uuid[]) AS x(axis_id, category_id)
       ON CONFLICT (tenant_id, item_id, axis_id)
       DO UPDATE SET category_id = EXCLUDED.category_id, updated_at = now()
       WHERE ${table}.category_id IS DISTINCT FROM EXCLUDED.category_id`,
      [tenantId, itemId, sets.map((change) => change.axis_id), sets.map((change) => change.category_id)],
    );
  }
  if (clears.length > 0) {
    await manager.query(
      `DELETE FROM ${table} WHERE tenant_id = $1 AND item_id = $2 AND axis_id = ANY($3::uuid[])`,
      [tenantId, itemId, clears],
    );
  }
}

/** The values of the given lines (every dimension holding one, disabled ones included), in dimension order. */
export async function loadItemAnalyticsValues(
  manager: EntityManager,
  scope: ItemAnalyticsScope,
  tenantId: string,
  itemIds: string[],
): Promise<Map<string, ItemAnalyticsValue[]>> {
  const result = new Map<string, ItemAnalyticsValue[]>();
  const ids = Array.from(new Set(itemIds.filter(Boolean)));
  if (ids.length === 0) return result;
  const rows: Array<ItemAnalyticsValue & { item_id: string }> = await manager.query(
    `SELECT v.item_id::text AS item_id, v.axis_id::text AS axis_id, ax.code AS axis_code, ax.name AS axis_name,
            ax.is_default, v.category_id::text AS category_id, c.name AS category_name
       FROM ${ANALYTICS_LINK_TABLES[scope]} v
       JOIN analytics_axes ax ON ax.tenant_id = v.tenant_id AND ax.id = v.axis_id
       JOIN analytics_categories c ON c.tenant_id = v.tenant_id AND c.id = v.category_id
      WHERE v.tenant_id = $1 AND v.item_id = ANY($2::uuid[])
      ORDER BY ax.sort_order ASC, lower(coalesce(ax.name, '')) ASC, ax.code ASC, ax.id ASC`,
    [tenantId, ids],
  );
  for (const { item_id, ...value } of rows) {
    const list = result.get(item_id) ?? [];
    list.push({ ...value, axis_name: value.axis_name ?? null, is_default: value.is_default === true });
    result.set(item_id, list);
  }
  return result;
}

/** The analytics fields of a detail or a create/update response. */
export function itemAnalyticsFields(values: ItemAnalyticsValue[]) {
  const main = values.find((value) => value.is_default) ?? null;
  return {
    analytics_values: values,
    analytics_category_id: main?.category_id ?? null,
    analytics_category_name: main?.category_name ?? null,
  };
}

/** The analytics fields of an audit snapshot: values by dimension id, and the default dimension's. */
export function itemAnalyticsAuditFields(values: ItemAnalyticsValue[]) {
  return {
    analytics_values: Object.fromEntries(values.map((value) => [value.axis_id, value.category_id])),
    analytics_category_id: values.find((value) => value.is_default)?.category_id ?? null,
  };
}

/* ---- Item CSVs (both types) ---- */

/** The legacy header of the default dimension, kept in exports and templates. */
export const CSV_ANALYTICS_ALIAS = 'analytics_category';

export type CsvAnalyticsValue = ValueRow;

/** An analytics column of an imported file and the values of its dimension, by lower-cased name. */
export interface CsvAnalyticsColumn {
  header: string;
  /** Null only in a dry run of a tenant that has no default dimension yet (it is created by the load). */
  axisId: string | null;
  valuesByName: Map<string, CsvAnalyticsValue>;
}

/** One analytics cell of a row: a blank name clears the dimension; `value` is null for a name to create. */
export interface CsvAnalyticsCell {
  column: CsvAnalyticsColumn;
  name: string | null;
  value: CsvAnalyticsValue | null;
}

export function isCsvAnalyticsHeader(header: string): boolean {
  return header === CSV_ANALYTICS_ALIAS || header.startsWith(ANALYTICS_CSV_PREFIX);
}

/**
 * The analytics columns of a file: `analytics_category` is the default
 * dimension, `analytics:<code>` any dimension by code. An unknown or disabled
 * dimension, or two columns for one dimension, refuse the file. Without
 * `create` (a dry run) a missing default dimension is not created.
 */
export async function readCsvAnalyticsColumns(
  manager: EntityManager,
  tenantId: string,
  fileHeaders: string[],
  opts: { create: boolean },
): Promise<{ columns: CsvAnalyticsColumn[]; errors: string[] }> {
  const headers = fileHeaders.filter(isCsvAnalyticsHeader);
  if (headers.length === 0) return { columns: [], errors: [] };
  const axes = await loadAnalyticsAxes(manager, tenantId);
  const byCode = new Map(axes.map((axis) => [axis.code.toLowerCase(), axis]));
  const errors: string[] = [];
  const columns: CsvAnalyticsColumn[] = [];
  const headerByAxis = new Map<string, string>();
  for (const header of headers) {
    let axis: { id: string | null; name: string | null; status: string } | undefined;
    if (header === CSV_ANALYTICS_ALIAS) {
      axis = axes.find((candidate) => candidate.is_default);
      if (!axis) {
        const id = await resolveDefaultAxisId(manager, tenantId, { create: opts.create });
        axis = { id, name: null, status: 'enabled' };
      }
    } else {
      const code = header.slice(ANALYTICS_CSV_PREFIX.length).trim().toLowerCase();
      axis = byCode.get(code);
      if (!axis) {
        errors.push(`The column ${header} names no dimension. Check the dimension code or remove the column.`);
        continue;
      }
    }
    if (axis.status !== 'enabled') {
      errors.push(disabledDimensionMessage(axis));
      continue;
    }
    const key = axis.id ?? '(default)';
    const first = headerByAxis.get(key);
    if (first !== undefined) {
      errors.push(`The file has two columns for ${dimensionPhrase(axis)}: ${first} and ${header}. Keep one.`);
      continue;
    }
    headerByAxis.set(key, header);
    columns.push({ header, axisId: axis.id, valuesByName: new Map() });
  }
  if (errors.length > 0) return { columns: [], errors };

  const axisIds = columns.map((column) => column.axisId).filter((id): id is string => !!id);
  if (axisIds.length > 0) {
    const rows: ValueRow[] = await manager.query(
      `SELECT id::text AS id, axis_id::text AS axis_id, name, status::text AS status, disabled_at
         FROM analytics_categories
        WHERE tenant_id = $1 AND axis_id = ANY($2::uuid[])`,
      [tenantId, axisIds],
    );
    const byAxis = new Map(columns.map((column) => [column.axisId, column]));
    for (const row of rows) byAxis.get(row.axis_id)?.valuesByName.set(row.name.toLowerCase(), row);
  }
  return { columns, errors: [] };
}

/**
 * The analytics cells of one row: blank clears, a name is looked up within its
 * own dimension. A name to create follows the value name rules (the API's
 * messages, as row errors of the dry run); a stored value is matched as it is.
 */
export function readCsvAnalyticsCells(
  columns: CsvAnalyticsColumn[],
  row: Record<string, unknown>,
): { cells: CsvAnalyticsCell[]; errors: string[] } {
  const errors: string[] = [];
  const cells = columns.map((column) => {
    const name = String(row[column.header] ?? '').trim() || null;
    const value = name ? column.valuesByName.get(name.toLowerCase()) ?? null : null;
    if (name && !value) {
      try {
        normalizeAnalyticsName(name);
      } catch (err) {
        errors.push((err as Error).message);
      }
    }
    return { column, name, value };
  });
  return { cells, errors };
}

/** A disabled value stays on the line that already has it, and is a row error as a new assignment. */
export function csvAnalyticsDisabledErrors(cells: CsvAnalyticsCell[], current: ItemAnalyticsValue[] | undefined): string[] {
  const errors: string[] = [];
  for (const cell of cells) {
    if (!cell.value || isValueActive(cell.value)) continue;
    const isCurrent = (current ?? []).some((value) => value.axis_id === cell.column.axisId && value.category_id === cell.value!.id);
    if (!isCurrent) errors.push(`${cell.value.name} is disabled. Pick an enabled value.`);
  }
  return errors;
}

/** True when a row names a disabled value, so the lines' current values are needed. */
export function csvAnalyticsNamesDisabled(cells: CsvAnalyticsCell[]): boolean {
  return cells.some((cell) => !!cell.value && !isValueActive(cell.value));
}

type AuditLike = { log: (entry: any, opts?: { manager?: EntityManager }) => Promise<unknown> };

/**
 * The `analytics_values` of a row for the write gate, creating a name its
 * dimension does not have yet (enabled, audited; a concurrent create of the
 * same name is read back). Undefined when the file has no analytics column.
 */
export async function csvAnalyticsBodyValues(
  manager: EntityManager,
  tenantId: string,
  cells: CsvAnalyticsCell[],
  audit: AuditLike,
  userId: string | null | undefined,
): Promise<Record<string, string | null> | undefined> {
  if (cells.length === 0) return undefined;
  const values: Record<string, string | null> = {};
  for (const cell of cells) {
    const axisId = cell.column.axisId;
    if (!axisId) continue;
    if (!cell.name) {
      values[axisId] = null;
      continue;
    }
    const key = cell.name.toLowerCase();
    let value = cell.column.valuesByName.get(key) ?? null;
    if (!value) {
      value = await createCsvAnalyticsValue(manager, tenantId, axisId, cell.name, audit, userId);
      cell.column.valuesByName.set(key, value);
    }
    values[axisId] = value.id;
  }
  return values;
}

async function createCsvAnalyticsValue(
  manager: EntityManager,
  tenantId: string,
  axisId: string,
  name: string,
  audit: AuditLike,
  userId: string | null | undefined,
): Promise<CsvAnalyticsValue> {
  try {
    const [row] = await withSavepoint(manager, () => manager.query(
      `INSERT INTO analytics_categories (tenant_id, axis_id, name, status)
       VALUES ($1, $2, $3, 'enabled')
       RETURNING *`,
      [tenantId, axisId, name],
    ));
    await audit.log({ table: 'analytics_categories', recordId: row.id, action: 'create', before: null, after: row, userId: userId ?? null }, { manager });
    return { id: row.id, axis_id: row.axis_id, name: row.name, status: row.status, disabled_at: row.disabled_at };
  } catch (err: any) {
    if (err?.code !== '23505') throw err;
    const [row] = await manager.query(
      `SELECT id::text AS id, axis_id::text AS axis_id, name, status::text AS status, disabled_at
         FROM analytics_categories
        WHERE tenant_id = $1 AND axis_id = $2 AND lower(name) = lower($3)`,
      [tenantId, axisId, name],
    );
    if (!row) throw err;
    return row;
  }
}

/** The analytics columns of an export or a template: `analytics_category`, then each enabled non-default dimension. */
export interface CsvAnalyticsExport {
  /** The base headers with one `analytics:<code>` column per enabled non-default dimension right after `analytics_category`. */
  headers(base: readonly string[]): string[];
  /** The analytics cells of one line. */
  cells(itemId: string): Record<string, string>;
}

export async function loadCsvAnalyticsExport(
  manager: EntityManager,
  scope: ItemAnalyticsScope,
  tenantId: string,
  itemIds: string[],
): Promise<CsvAnalyticsExport> {
  const axes = await loadAnalyticsAxes(manager, tenantId);
  const extra = axes.filter((axis) => !axis.is_default && isAxisActive(axis));
  const extraHeaders = extra.map((axis) => `${ANALYTICS_CSV_PREFIX}${axis.code}`);
  const valuesByItem = await loadItemAnalyticsValues(manager, scope, tenantId, itemIds);
  return {
    headers(base) {
      const at = base.indexOf(CSV_ANALYTICS_ALIAS);
      if (at < 0) return [...base, ...extraHeaders];
      return [...base.slice(0, at + 1), ...extraHeaders, ...base.slice(at + 1)];
    },
    cells(itemId) {
      const values = valuesByItem.get(itemId) ?? [];
      const cells: Record<string, string> = {
        [CSV_ANALYTICS_ALIAS]: values.find((value) => value.is_default)?.category_name ?? '',
      };
      extra.forEach((axis, index) => {
        cells[extraHeaders[index]] = values.find((value) => value.axis_id === axis.id)?.category_name ?? '';
      });
      return cells;
    },
  };
}
