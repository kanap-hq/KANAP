import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { deriveStatusFromDisabledAt, StatusState } from '../common/status';
import {
  AnalyticsContext,
  analyticsRefusal,
  firstReturnedRow,
  normalizeAnalyticsDescription,
  normalizeAnalyticsName,
  plural,
  resolveAnalyticsLifecycle,
  sameInstant,
} from './analytics-context';
import { axisAppliesTo, isAxisActive, isReservedAnalyticsAxisName, resolveDefaultAxisId } from './analytics-axes.util';
import { AXIS_APPLIES_TO, AxisAppliesTo } from './analytics-axis.entity';

/** A stored row, as `SELECT *` returns it. */
export interface StoredAnalyticsAxis {
  id: string;
  tenant_id: string;
  code: string;
  name: string | null;
  description: string | null;
  sort_order: number;
  is_default: boolean;
  applies_to: AxisAppliesTo | null;
  required: boolean;
  status: StatusState;
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AnalyticsAxisValues {
  code: string;
  name: string | null;
  description: string | null;
  sort_order: number;
  applies_to: AxisAppliesTo | null;
  required: boolean;
  status: StatusState;
  disabled_at: Date | null;
}

export type AnalyticsAxisRow = Omit<StoredAnalyticsAxis, 'status'> & { status: 'enabled' | 'disabled' };

export type AnalyticsAxisDetail = AnalyticsAxisRow & {
  value_count: number;
  opex_count: number;
  capex_count: number;
  /** OPEX / CAPEX lines (all statuses) with no value on it; 0 for a type it does not apply to. */
  opex_missing: number;
  capex_missing: number;
  /** The line types it applies to on which none of its enabled values can be chosen. */
  unusable_for: AxisAppliesTo[];
};

export interface AnalyticsAxisInput {
  code?: unknown;
  name?: unknown;
  description?: unknown;
  sort_order?: unknown;
  applies_to?: unknown;
  required?: unknown;
  status?: unknown;
  disabled_at?: unknown;
}

export const ANALYTICS_AXIS_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

export const DEFAULT_AXIS_LOCKED_MESSAGE = 'This dimension cannot be disabled: older files and AI questions use it.';
export const DEFAULT_AXIS_DELETE_MESSAGE = 'This dimension cannot be deleted: older files and AI questions use it.';
export const RESERVED_AXIS_NAME_MESSAGE = 'This name is reserved for the default dimension.';
export const DEFAULT_AXIS_APPLIES_MESSAGE = 'The default dimension applies to OPEX and CAPEX lines.';

/** The name of a dimension other than the default: required, and never one of the default's labels. */
function normalizeOtherAxisName(raw: unknown): string {
  const name = normalizeAnalyticsName(raw);
  if (isReservedAnalyticsAxisName(name)) throw analyticsRefusal(RESERVED_AXIS_NAME_MESSAGE, 'name');
  return name;
}

export function normalizeAnalyticsAxisCode(raw: unknown): string {
  const code = typeof raw === 'string' ? raw.trim() : raw == null ? '' : String(raw).trim();
  if (!code) throw analyticsRefusal('Code is required.', 'code');
  if (!ANALYTICS_AXIS_CODE_PATTERN.test(code)) {
    throw analyticsRefusal('Use lowercase letters, digits, - or _ (40 at most).', 'code');
  }
  return code;
}

function normalizeSortOrder(raw: unknown): number {
  const value = Number(raw);
  if (raw === '' || raw == null || !Number.isInteger(value) || value < INT_MIN || value > INT_MAX) {
    throw analyticsRefusal('Order must be a whole number.', 'sort_order');
  }
  return value;
}

/**
 * `opex`, `capex`, or null (OPEX and CAPEX lines), for a dimension or a value. The DTO checks the
 * shape; this covers other callers.
 */
export function normalizeAppliesTo(raw: unknown): AxisAppliesTo | null {
  if (raw == null) return null;
  const value = String(raw).trim().toLowerCase();
  if (value === '') return null;
  if (!(AXIS_APPLIES_TO as readonly string[]).includes(value)) {
    throw analyticsRefusal("Used for must be 'opex', 'capex' or empty.", 'applies_to');
  }
  return value as AxisAppliesTo;
}

/** Whether a new line must hold a value on the dimension. The DTO checks the shape; this covers other callers. */
export function normalizeRequired(raw: unknown): boolean {
  if (raw == null) return false;
  if (typeof raw === 'boolean') return raw;
  const value = String(raw).trim().toLowerCase();
  if (value === 'true') return true;
  if (value === 'false' || value === '') return false;
  throw analyticsRefusal('Required must be true or false.', 'required');
}

/**
 * "2 values of this dimension are for CAPEX lines only (Matériel, Projet). Set them to OPEX and
 * CAPEX first.": up to three names in name order, then "and N more". The names matter because the
 * count includes disabled values, which the values grid hides by default.
 */
export function otherTypeValuesMessage(count: number, other: AxisAppliesTo, names: string[]): string {
  const type = other.toUpperCase();
  const shown = names.slice(0, 3).join(', ');
  const more = count > 3 ? ` and ${count - 3} more` : '';
  return count === 1
    ? `1 value of this dimension is for ${type} lines only (${shown}). Set it to OPEX and CAPEX first.`
    : `${count} values of this dimension are for ${type} lines only (${shown}${more}). Set them to OPEX and CAPEX first.`;
}

/** The effective status, as every lifecycle list shows it. */
function toRow(stored: StoredAnalyticsAxis): AnalyticsAxisRow {
  return {
    ...stored,
    sort_order: Number(stored.sort_order ?? 0),
    applies_to: stored.applies_to ?? null,
    required: stored.required === true,
    status: isAxisActive(stored) ? 'enabled' : 'disabled',
  };
}

function valuesEqual(stored: StoredAnalyticsAxis, next: AnalyticsAxisValues): boolean {
  return stored.code === next.code
    && (stored.name ?? null) === next.name
    && (stored.description ?? null) === next.description
    && Number(stored.sort_order) === next.sort_order
    && (stored.applies_to ?? null) === next.applies_to
    && (stored.required === true) === next.required
    // From the stored end of validity: the stored status lags until the hourly sync once that date passes.
    && deriveStatusFromDisabledAt(stored.disabled_at) === next.status
    && sameInstant(stored.disabled_at, next.disabled_at);
}

@Injectable()
export class AnalyticsAxesService {
  constructor(private readonly audit: AuditService) {}

  // Reads ------------------------------------------------------------------

  /** Every dimension of the tenant, disabled included, in display order. */
  async list(ctx: AnalyticsContext): Promise<{ items: AnalyticsAxisRow[] }> {
    const rows: StoredAnalyticsAxis[] = await ctx.manager.query(
      `SELECT * FROM analytics_axes
        WHERE tenant_id = $1
        ORDER BY sort_order ASC, lower(coalesce(name, '')) ASC, code ASC, id ASC`,
      [ctx.tenantId],
    );
    return { items: rows.map(toRow) };
  }

  /**
   * One dimension with its counts. `opex_missing` / `capex_missing`: the lines of every status
   * with no value on it (as the list link with every status shows them), 0 for a type it does
   * not apply to. `unusable_for`: the types it applies to with no enabled value usable on them.
   * Both are computed whether or not the dimension is required.
   */
  async get(id: string, ctx: AnalyticsContext): Promise<AnalyticsAxisDetail> {
    const [row] = await ctx.manager.query(
      `SELECT a.*,
              (SELECT count(*)::int FROM analytics_categories c WHERE c.tenant_id = $1 AND c.axis_id = a.id) AS value_count,
              (SELECT count(*)::int FROM spend_item_analytics_values v WHERE v.tenant_id = $1 AND v.axis_id = a.id) AS opex_count,
              (SELECT count(*)::int FROM capex_item_analytics_values v WHERE v.tenant_id = $1 AND v.axis_id = a.id) AS capex_count,
              CASE WHEN a.applies_to IS NULL OR a.applies_to = 'opex' THEN (
                SELECT count(*)::int FROM spend_items i
                 WHERE i.tenant_id = $1
                   AND NOT EXISTS (
                     SELECT 1 FROM spend_item_analytics_values v
                      WHERE v.tenant_id = $1 AND v.item_id = i.id AND v.axis_id = a.id
                   )
              ) ELSE 0 END AS opex_missing,
              CASE WHEN a.applies_to IS NULL OR a.applies_to = 'capex' THEN (
                SELECT count(*)::int FROM capex_items i
                 WHERE i.tenant_id = $1
                   AND NOT EXISTS (
                     SELECT 1 FROM capex_item_analytics_values v
                      WHERE v.tenant_id = $1 AND v.item_id = i.id AND v.axis_id = a.id
                   )
              ) ELSE 0 END AS capex_missing,
              EXISTS (
                SELECT 1 FROM analytics_categories c
                 WHERE c.tenant_id = $1 AND c.axis_id = a.id
                   AND c.status = 'enabled' AND (c.disabled_at IS NULL OR c.disabled_at > now())
                   AND (c.applies_to IS NULL OR c.applies_to = 'opex')
              ) AS opex_usable,
              EXISTS (
                SELECT 1 FROM analytics_categories c
                 WHERE c.tenant_id = $1 AND c.axis_id = a.id
                   AND c.status = 'enabled' AND (c.disabled_at IS NULL OR c.disabled_at > now())
                   AND (c.applies_to IS NULL OR c.applies_to = 'capex')
              ) AS capex_usable
         FROM analytics_axes a
        WHERE a.tenant_id = $1 AND a.id = $2`,
      [ctx.tenantId, id],
    );
    if (!row) throw new NotFoundException('Dimension not found.');
    const { value_count, opex_count, capex_count, opex_missing, capex_missing, opex_usable, capex_usable, ...stored } = row;
    const axis = toRow(stored as StoredAnalyticsAxis);
    const usable: Record<AxisAppliesTo, boolean> = { opex: opex_usable === true, capex: capex_usable === true };
    return {
      ...axis,
      value_count: Number(value_count ?? 0),
      opex_count: Number(opex_count ?? 0),
      capex_count: Number(capex_count ?? 0),
      opex_missing: Number(opex_missing ?? 0),
      capex_missing: Number(capex_missing ?? 0),
      unusable_for: AXIS_APPLIES_TO.filter((scope) => axisAppliesTo(axis, scope) && !usable[scope]),
    };
  }

  // Writes -----------------------------------------------------------------

  async create(body: AnalyticsAxisInput, ctx: AnalyticsContext): Promise<AnalyticsAxisDetail> {
    // The default comes first: a tenant inserted without the bootstrap gets it before any other dimension.
    await resolveDefaultAxisId(ctx.manager, ctx.tenantId, { create: true });
    const lifecycle = resolveAnalyticsLifecycle(null, body);
    let sortOrder: number;
    if (body?.sort_order !== undefined && body?.sort_order !== null) sortOrder = normalizeSortOrder(body.sort_order);
    else {
      const [row] = await ctx.manager.query(
        `SELECT coalesce(max(sort_order), 0) + 1 AS next FROM analytics_axes WHERE tenant_id = $1`,
        [ctx.tenantId],
      );
      sortOrder = Math.min(Number(row?.next ?? 1), INT_MAX);
    }
    const values: AnalyticsAxisValues = {
      code: normalizeAnalyticsAxisCode(body?.code),
      name: normalizeOtherAxisName(body?.name),
      description: normalizeAnalyticsDescription(body?.description),
      sort_order: sortOrder,
      applies_to: normalizeAppliesTo(body?.applies_to),
      required: normalizeRequired(body?.required),
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    };
    await this.assertUnique(ctx, values, null);
    const saved = await this.persist(ctx, null, values);
    return this.get(saved.id, ctx);
  }

  /** PATCH semantics: an absent key keeps the stored value. `is_default` is never written. */
  async update(id: string, body: AnalyticsAxisInput, ctx: AnalyticsContext): Promise<AnalyticsAxisDetail> {
    const has = (key: keyof AnalyticsAxisInput) =>
      body != null && Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
    const existing = await this.lock(ctx, id);
    if (!existing) throw new NotFoundException('Dimension not found.');

    const lifecycle = resolveAnalyticsLifecycle(existing.disabled_at, body);
    if (existing.is_default && (lifecycle.status !== StatusState.ENABLED || lifecycle.disabled_at !== null)) {
      throw analyticsRefusal(DEFAULT_AXIS_LOCKED_MESSAGE, 'status');
    }
    // PATCH: null clears it (both), absent keeps it. The default always applies to both.
    const appliesTo = has('applies_to') ? normalizeAppliesTo(body.applies_to) : existing.applies_to ?? null;
    if (existing.is_default && appliesTo !== null) throw analyticsRefusal(DEFAULT_AXIS_APPLIES_MESSAGE, 'applies_to');
    if (appliesTo !== null && appliesTo !== (existing.applies_to ?? null)) {
      // The row lock above serialises this count with a value write, which locks the dimension FOR SHARE.
      await this.assertNoValueOfOtherType(ctx, id, appliesTo);
    }
    let name = existing.name ?? null;
    if (has('name')) {
      const blank = body.name === null || (typeof body.name === 'string' && body.name.trim() === '');
      // The default dimension may go back to no name (every screen then shows the translated label).
      if (blank && existing.is_default) name = null;
      else name = existing.is_default ? normalizeAnalyticsName(body.name) : normalizeOtherAxisName(body.name);
    }
    const values: AnalyticsAxisValues = {
      code: has('code') ? normalizeAnalyticsAxisCode(body.code) : existing.code,
      name,
      description: has('description') ? normalizeAnalyticsDescription(body.description) : existing.description ?? null,
      sort_order: has('sort_order') ? normalizeSortOrder(body.sort_order) : Number(existing.sort_order),
      applies_to: appliesTo,
      // PATCH: absent (or null) keeps it.
      required: has('required') && body.required !== null ? normalizeRequired(body.required) : existing.required === true,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    };
    if (!valuesEqual(existing, values)) {
      await this.assertUnique(ctx, values, id);
      await this.persist(ctx, existing, values);
    }
    return this.get(id, ctx);
  }

  /**
   * The order of the dimensions: `axisIds` first, in that order, then the dimensions it leaves out
   * in their current order, renumbered 1..n in one statement that writes only the positions that
   * change. Every id must be a dimension of the tenant, once. One audit row per dimension whose
   * position changes (`sort_order` before and after); the dimensions keep their `updated_at`.
   *
   * Locks every dimension of the tenant FOR NO KEY UPDATE, in id order: a dimension update (FOR
   * UPDATE) and a value write (which holds its dimension FOR SHARE) wait for the reorder or it
   * waits for them. Line writes never lock a dimension, so they are never blocked.
   */
  async reorder(axisIdsRaw: unknown, ctx: AnalyticsContext): Promise<{ items: AnalyticsAxisRow[] }> {
    if (!Array.isArray(axisIdsRaw)) throw analyticsRefusal('The dimensions must be a list.', 'axis_ids');
    const axisIds = axisIdsRaw.map((id) => String(id ?? '').trim().toLowerCase());
    if (new Set(axisIds).size !== axisIds.length) {
      throw analyticsRefusal('Each dimension can appear only once in the order.', 'axis_ids');
    }
    await ctx.manager.query(
      `SELECT id FROM analytics_axes WHERE tenant_id = $1 ORDER BY id FOR NO KEY UPDATE`,
      [ctx.tenantId],
    );
    const { items: current } = await this.list(ctx);
    const byId = new Map(current.map((axis) => [axis.id, axis]));
    if (axisIds.some((id) => !byId.has(id))) {
      throw analyticsRefusal('A dimension in this order does not exist. Reload the page and try again.', 'axis_ids');
    }
    const listed = new Set(axisIds);
    const next = [...axisIds.map((id) => byId.get(id)!), ...current.filter((axis) => !listed.has(axis.id))];

    // The rows locked above, read under the lock: exactly the rows the UPDATE writes.
    const moved = next
      .map((axis, index) => ({ id: axis.id, before: axis.sort_order, after: index + 1 }))
      .filter((row) => row.before !== row.after);
    if (moved.length === 0) return { items: next };

    await ctx.manager.query(
      `UPDATE analytics_axes a SET sort_order = n.position::int
         FROM unnest($2::uuid[]) WITH ORDINALITY AS n(id, position)
        WHERE a.tenant_id = $1 AND a.id = n.id AND a.sort_order IS DISTINCT FROM n.position::int`,
      [ctx.tenantId, next.map((axis) => axis.id)],
    );
    for (const row of moved) {
      await this.audit.log(
        {
          table: 'analytics_axes',
          recordId: row.id,
          action: 'update',
          before: { sort_order: row.before },
          after: { sort_order: row.after },
          userId: ctx.userId ?? null,
          source: ctx.audit?.source,
          sourceRef: ctx.audit?.sourceRef ?? null,
        },
        { manager: ctx.manager },
      );
    }
    return this.list(ctx);
  }

  /** Refused for the default dimension and while the dimension holds values. */
  async delete(id: string, ctx: AnalyticsContext): Promise<void> {
    // The row lock comes first: a value created concurrently either committed
    // before (and is counted) or waits for this delete and then fails its key.
    const existing = await this.lock(ctx, id);
    if (!existing) throw new NotFoundException('Dimension not found.');
    if (existing.is_default) throw new ConflictException(DEFAULT_AXIS_DELETE_MESSAGE);
    const [count] = await ctx.manager.query(
      `SELECT count(*)::int AS n FROM analytics_categories WHERE tenant_id = $1 AND axis_id = $2`,
      [ctx.tenantId, id],
    );
    const values = Number(count?.n ?? 0);
    if (values > 0) {
      throw new ConflictException(
        `${existing.name || 'This dimension'} still has ${plural(values, 'value', 'values')}. Delete them first.`,
      );
    }
    try {
      await ctx.manager.query(`DELETE FROM analytics_axes WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, id]);
    } catch (err: any) {
      if (err?.code === '23503') {
        throw new ConflictException(`${existing.name || 'This dimension'} still has values. Delete them first.`);
      }
      throw err;
    }
    await this.audit.log(
      {
        table: 'analytics_axes',
        recordId: id,
        action: 'delete',
        before: existing,
        after: null,
        userId: ctx.userId ?? null,
        source: ctx.audit?.source,
        sourceRef: ctx.audit?.sourceRef ?? null,
      },
      { manager: ctx.manager },
    );
  }

  // Internals ----------------------------------------------------------------

  private async lock(ctx: AnalyticsContext, id: string): Promise<StoredAnalyticsAxis | undefined> {
    const [row] = await ctx.manager.query(
      `SELECT * FROM analytics_axes WHERE tenant_id = $1 AND id = $2::uuid FOR UPDATE`,
      [ctx.tenantId, id],
    );
    return row;
  }

  /** A dimension restricted to one line type cannot hold values restricted to the other. */
  private async assertNoValueOfOtherType(ctx: AnalyticsContext, id: string, appliesTo: AxisAppliesTo) {
    const other: AxisAppliesTo = appliesTo === 'opex' ? 'capex' : 'opex';
    // Disabled values included: the count, and the first three names to find them by.
    const rows: Array<{ name: string; total: number }> = await ctx.manager.query(
      `SELECT name, count(*) OVER ()::int AS total FROM analytics_categories
        WHERE tenant_id = $1 AND axis_id = $2 AND applies_to = $3
        ORDER BY lower(name), name, id
        LIMIT 3`,
      [ctx.tenantId, id, other],
    );
    const count = Number(rows[0]?.total ?? 0);
    if (count > 0) {
      throw analyticsRefusal(otherTypeValuesMessage(count, other, rows.map((row) => row.name)), 'applies_to');
    }
  }

  /** A readable refusal before the unique indexes (which stay the guarantee). */
  private async assertUnique(ctx: AnalyticsContext, values: AnalyticsAxisValues, id: string | null) {
    const rows: Array<{ code: string; name: string | null }> = await ctx.manager.query(
      `SELECT code, name FROM analytics_axes
        WHERE tenant_id = $1 AND ($2::uuid IS NULL OR id <> $2::uuid)
          AND (lower(code) = lower($3) OR ($4::text IS NOT NULL AND lower(name) = lower($4::text)))`,
      [ctx.tenantId, id, values.code, values.name],
    );
    if (rows.some((row) => row.code.toLowerCase() === values.code.toLowerCase())) {
      throw analyticsRefusal(`A dimension with code ${values.code} already exists.`, 'code');
    }
    if (values.name && rows.some((row) => (row.name ?? '').toLowerCase() === values.name!.toLowerCase())) {
      throw analyticsRefusal(`A dimension named ${values.name} already exists.`, 'name');
    }
  }

  private async persist(
    ctx: AnalyticsContext,
    existing: StoredAnalyticsAxis | null,
    values: AnalyticsAxisValues,
  ): Promise<StoredAnalyticsAxis> {
    let saved: StoredAnalyticsAxis | undefined;
    try {
      const rows = existing
        ? await ctx.manager.query(
          `UPDATE analytics_axes
              SET code = $3, name = $4, description = $5, sort_order = $6, status = $7, disabled_at = $8,
                  applies_to = $9, required = $10, updated_at = now()
            WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
          [
            ctx.tenantId, existing.id, values.code, values.name, values.description, values.sort_order,
            values.status, values.disabled_at, values.applies_to, values.required,
          ],
        )
        : await ctx.manager.query(
          `INSERT INTO analytics_axes (tenant_id, code, name, description, sort_order, is_default, status, disabled_at, applies_to, required)
           VALUES ($1, $2, $3, $4, $5, false, $6, $7, $8, $9)
        RETURNING *`,
          [
            ctx.tenantId, values.code, values.name, values.description, values.sort_order,
            values.status, values.disabled_at, values.applies_to, values.required,
          ],
        );
      saved = firstReturnedRow<StoredAnalyticsAxis>(rows);
    } catch (err: any) {
      if (err?.code === '23505') {
        if (String(err?.constraint ?? '').includes('name')) {
          throw analyticsRefusal(`A dimension named ${values.name} already exists.`, 'name');
        }
        throw analyticsRefusal(`A dimension with code ${values.code} already exists.`, 'code');
      }
      if (err?.code === '23514') {
        // The CHECK constraints mirror the rules above; this only fires on a rule the service missed.
        if (err?.constraint === 'analytics_axes_default_applies_check') {
          throw analyticsRefusal(DEFAULT_AXIS_APPLIES_MESSAGE, 'applies_to');
        }
        throw analyticsRefusal('This dimension cannot be saved as it is.');
      }
      throw err;
    }
    if (!saved) throw new NotFoundException('Dimension not found.');
    await this.audit.log(
      {
        table: 'analytics_axes',
        recordId: saved.id,
        action: existing ? 'update' : 'create',
        before: existing,
        after: saved,
        userId: ctx.userId ?? null,
        source: ctx.audit?.source,
        sourceRef: ctx.audit?.sourceRef ?? null,
      },
      { manager: ctx.manager },
    );
    return saved;
  }
}
