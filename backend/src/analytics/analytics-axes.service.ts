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
import { isAxisActive, isReservedAnalyticsAxisName, resolveDefaultAxisId } from './analytics-axes.util';

/** A stored row, as `SELECT *` returns it. */
export interface StoredAnalyticsAxis {
  id: string;
  tenant_id: string;
  code: string;
  name: string | null;
  description: string | null;
  sort_order: number;
  is_default: boolean;
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
  status: StatusState;
  disabled_at: Date | null;
}

export type AnalyticsAxisRow = Omit<StoredAnalyticsAxis, 'status'> & { status: 'enabled' | 'disabled' };

export type AnalyticsAxisDetail = AnalyticsAxisRow & {
  value_count: number;
  opex_count: number;
  capex_count: number;
};

export interface AnalyticsAxisInput {
  code?: unknown;
  name?: unknown;
  description?: unknown;
  sort_order?: unknown;
  status?: unknown;
  disabled_at?: unknown;
}

export const ANALYTICS_AXIS_CODE_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const INT_MIN = -2147483648;
const INT_MAX = 2147483647;

export const DEFAULT_AXIS_LOCKED_MESSAGE = 'This dimension cannot be disabled: older files and AI questions use it.';
export const DEFAULT_AXIS_DELETE_MESSAGE = 'This dimension cannot be deleted: older files and AI questions use it.';
export const RESERVED_AXIS_NAME_MESSAGE = 'This name is reserved for the default dimension.';

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

/** The effective status, as every lifecycle list shows it. */
function toRow(stored: StoredAnalyticsAxis): AnalyticsAxisRow {
  return { ...stored, sort_order: Number(stored.sort_order ?? 0), status: isAxisActive(stored) ? 'enabled' : 'disabled' };
}

function valuesEqual(stored: StoredAnalyticsAxis, next: AnalyticsAxisValues): boolean {
  return stored.code === next.code
    && (stored.name ?? null) === next.name
    && (stored.description ?? null) === next.description
    && Number(stored.sort_order) === next.sort_order
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

  async get(id: string, ctx: AnalyticsContext): Promise<AnalyticsAxisDetail> {
    const [row] = await ctx.manager.query(
      `SELECT a.*,
              (SELECT count(*)::int FROM analytics_categories c WHERE c.tenant_id = $1 AND c.axis_id = a.id) AS value_count,
              (SELECT count(*)::int FROM spend_item_analytics_values v WHERE v.tenant_id = $1 AND v.axis_id = a.id) AS opex_count,
              (SELECT count(*)::int FROM capex_item_analytics_values v WHERE v.tenant_id = $1 AND v.axis_id = a.id) AS capex_count
         FROM analytics_axes a
        WHERE a.tenant_id = $1 AND a.id = $2`,
      [ctx.tenantId, id],
    );
    if (!row) throw new NotFoundException('Dimension not found.');
    const { value_count, opex_count, capex_count, ...stored } = row;
    return {
      ...toRow(stored as StoredAnalyticsAxis),
      value_count: Number(value_count ?? 0),
      opex_count: Number(opex_count ?? 0),
      capex_count: Number(capex_count ?? 0),
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
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    };
    if (!valuesEqual(existing, values)) {
      await this.assertUnique(ctx, values, id);
      await this.persist(ctx, existing, values);
    }
    return this.get(id, ctx);
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
              SET code = $3, name = $4, description = $5, sort_order = $6, status = $7, disabled_at = $8, updated_at = now()
            WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
          [ctx.tenantId, existing.id, values.code, values.name, values.description, values.sort_order, values.status, values.disabled_at],
        )
        : await ctx.manager.query(
          `INSERT INTO analytics_axes (tenant_id, code, name, description, sort_order, is_default, status, disabled_at)
           VALUES ($1, $2, $3, $4, $5, false, $6, $7)
        RETURNING *`,
          [ctx.tenantId, values.code, values.name, values.description, values.sort_order, values.status, values.disabled_at],
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
