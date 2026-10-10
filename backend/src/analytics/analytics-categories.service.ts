import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { compileAgFilterCondition, createParamNameGenerator } from '../common/ag-grid-filtering';
import { ICU_COLLATION } from '../common/list-engine/sql-fragments';
import { BulkDeleteResult } from '../common/delete.types';
import { parsePagination } from '../common/pagination';
import { withSavepoint } from '../common/savepoint.util';
import { deriveStatusFromDisabledAt, StatusState } from '../common/status';
import { applyStatusFilter, extractStatusFilterFromAgModel } from '../common/status-filter';
import { AnalyticsCategory } from './analytics-category.entity';
import {
  ANALYTICS_VALUE_ORDER_SQL,
  analyticsAxisInSentence,
  analyticsAxisPhrase,
  analyticsAxisSubject,
  isAxisActive,
  resolveDefaultAxisId,
} from './analytics-axes.util';
import { normalizeAppliesTo } from './analytics-axes.service';
import { AxisAppliesTo } from './analytics-axis.entity';
import {
  AnalyticsCallOptions,
  AnalyticsContext,
  analyticsRefusal,
  firstReturnedRow,
  lineUsageText,
  normalizeAnalyticsDescription,
  normalizeAnalyticsName,
  resolveAnalyticsContext,
  resolveAnalyticsLifecycle,
  sameInstant,
} from './analytics-context';

/** A stored value, as `SELECT *` returns it. */
export interface StoredAnalyticsCategory {
  id: string;
  tenant_id: string;
  axis_id: string;
  name: string;
  description: string | null;
  /** OPEX lines only, CAPEX lines only, or both (null). */
  applies_to: AxisAppliesTo | null;
  /** The position in its dimension (`sort_order`, the name in ICU order, the id); written only by create and reorder. */
  sort_order: number;
  status: StatusState;
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AnalyticsCategoryValues {
  axis_id: string;
  name: string;
  description: string | null;
  applies_to: AxisAppliesTo | null;
  status: StatusState;
  disabled_at: Date | null;
}

export type AnalyticsCategoryDetail = StoredAnalyticsCategory & {
  axis_name: string | null;
  axis_code: string;
  axis_is_default: boolean;
  opex_count: number;
  capex_count: number;
};

/** The dimension a value is written into, as the checks need it. */
export interface AnalyticsAxisRef {
  id: string;
  code: string;
  name: string | null;
  is_default: boolean;
  applies_to: AxisAppliesTo | null;
  status: string;
  disabled_at: Date | string | null;
}

export interface AnalyticsCategoryInput {
  axis_id?: unknown;
  name?: unknown;
  description?: unknown;
  applies_to?: unknown;
  status?: unknown;
  disabled_at?: unknown;
}

const SORT_FIELDS = new Set(['sort_order', 'name', 'description', 'applies_to', 'status', 'created_at', 'updated_at', 'disabled_at']);
/** The list's default: the dimension's own order. */
const DEFAULT_SORT = { field: 'sort_order', direction: 'ASC' as const };
// Grid and AI filter fields and the SQL they compile to (the dimension label as the AI registry shows it).
const FILTER_EXPRESSIONS: Record<string, string> = {
  name: 'cat.name',
  description: 'cat.description',
  applies_to: 'cat.applies_to',
  axis_code: 'ax.code',
  axis_name: `COALESCE(NULLIF(BTRIM(ax.name), ''), 'Analytics dimension')`,
};
const MAX_IDS = 10_000;

export function categoryValuesEqual(stored: StoredAnalyticsCategory, next: AnalyticsCategoryValues): boolean {
  return stored.axis_id === next.axis_id
    && stored.name === next.name
    && (stored.description ?? null) === next.description
    && (stored.applies_to ?? null) === next.applies_to
    // From the stored end of validity: the stored status lags until the hourly sync once that date passes.
    && deriveStatusFromDisabledAt(stored.disabled_at) === next.status
    && sameInstant(stored.disabled_at, next.disabled_at);
}

/**
 * "The Nature de coût dimension is for OPEX lines only.": a value cannot be restricted to the line
 * type its dimension excludes. Null when the value fits its dimension.
 */
export function valueAppliesToConflict(
  axis: { name: string | null; applies_to?: AxisAppliesTo | null },
  appliesTo: AxisAppliesTo | null,
): string | null {
  if (appliesTo === null || axis.applies_to == null || axis.applies_to === appliesTo) return null;
  return `${analyticsAxisSubject(axis)} is for ${axis.applies_to.toUpperCase()} lines only.`;
}

/**
 * Orders the list query by `field`. The position sorts in the dimension order first when the query
 * joins the dimension (`ax`, the list): its position, name, code and id as the dimensions list
 * sorts them, so the values of two dimensions never interleave; then the value's position, its
 * name (ICU order) and id, all in the same direction (descending is the exact reverse). Every
 * other field breaks ties on the id. The keys are selected aliases: with a join, TypeORM pages
 * through a subquery that only orders by columns or selected aliases.
 */
function orderValues<T extends SelectQueryBuilder<any>>(
  qb: T,
  field: string,
  direction: 'ASC' | 'DESC',
  joinsDimension: boolean,
): T {
  if (field !== 'sort_order') {
    return qb.orderBy(`cat.${field}`, direction).addOrderBy('cat.id', 'ASC');
  }
  if (joinsDimension) {
    qb.addSelect('ax.sort_order', 'ax_order_key')
      .addSelect(`lower(coalesce(ax.name, ''))`, 'ax_name_key')
      .addSelect('ax.code', 'ax_code_key')
      .addSelect('ax.id', 'ax_id_key')
      .addOrderBy('ax_order_key', direction)
      .addOrderBy('ax_name_key', direction)
      .addOrderBy('ax_code_key', direction)
      .addOrderBy('ax_id_key', direction);
  }
  return qb.addSelect(`cat.name COLLATE ${ICU_COLLATION}`, 'cat_name_key')
    .addOrderBy('cat.sort_order', direction)
    .addOrderBy('cat_name_key', direction)
    .addOrderBy('cat.id', direction);
}

/**
 * The grid's set filter on `applies_to`: a blank value ('') means "OPEX and CAPEX", stored as NULL,
 * which the set filter matches through a null value.
 */
function withAppliesToBlanks<T>(filters: T): T {
  const model = (filters as any)?.applies_to;
  if (!model || model.filterType !== 'set' || !Array.isArray(model.values)) return filters;
  return { ...filters, applies_to: { ...model, values: model.values.map((value: unknown) => (value === '' ? null : value)) } };
}

export function duplicateValueMessage(name: string, axis: { name: string | null }): string {
  return `A value named ${name} already exists in ${analyticsAxisInSentence(axis)}.`;
}

@Injectable()
export class AnalyticsCategoriesService {
  constructor(
    @InjectRepository(AnalyticsCategory)
    private readonly repo: Repository<AnalyticsCategory>,
    private readonly audit: AuditService,
  ) {}

  /** The request context; older callers pass only the manager and the tenant is read from the transaction. */
  context(opts?: AnalyticsCallOptions, userId: string | null = null): Promise<AnalyticsContext> {
    return resolveAnalyticsContext(opts, this.repo.manager, userId);
  }

  // Reads ------------------------------------------------------------------

  async list(query: any, opts?: AnalyticsCallOptions) {
    const ctx = await this.context(opts);
    const { page, limit, skip, sort } = parsePagination(query ?? {}, DEFAULT_SORT);
    const qb = this.buildQuery(ctx, query ?? {});
    const total = await qb.getCount();
    const field = SORT_FIELDS.has(sort.field) ? sort.field : DEFAULT_SORT.field;
    const items = await orderValues(qb, field, sort.direction, true)
      .skip(skip)
      .take(limit)
      .getMany();
    return { items, total, page, limit };
  }

  async listIds(query: any, opts?: AnalyticsCallOptions): Promise<{ ids: string[]; total: number }> {
    const ctx = await this.context(opts);
    const { sort } = parsePagination({ ...(query ?? {}), page: 1 }, DEFAULT_SORT);
    const qb = this.buildQuery(ctx, query ?? {});
    const total = await qb.clone().getCount();
    const field = SORT_FIELDS.has(sort.field) ? sort.field : DEFAULT_SORT.field;
    const limit = Math.min(Number(query?.limit) || MAX_IDS, MAX_IDS);
    const rows = await orderValues(qb.select('cat.id', 'id'), field, sort.direction, true)
      .limit(limit)
      .getRawMany();
    return { ids: rows.map((row: any) => row.id as string).filter(Boolean), total };
  }

  async get(id: string, opts?: AnalyticsCallOptions): Promise<AnalyticsCategoryDetail> {
    const ctx = await this.context(opts);
    return this.detail(ctx, id);
  }

  // Writes -----------------------------------------------------------------

  async create(body: AnalyticsCategoryInput, userId?: string | null, opts?: AnalyticsCallOptions): Promise<AnalyticsCategoryDetail> {
    const ctx = await this.context(opts, userId ?? null);
    const name = normalizeAnalyticsName(body?.name);
    const axis = await this.resolveAxisForNewValue(ctx, body?.axis_id);
    const lifecycle = resolveAnalyticsLifecycle(null, body);
    const values: AnalyticsCategoryValues = {
      axis_id: axis.id,
      name,
      description: normalizeAnalyticsDescription(body?.description),
      applies_to: normalizeAppliesTo(body?.applies_to),
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    };
    await this.assertNameFree(ctx, values, axis, null);
    const saved = await this.persist(ctx, null, values, axis);
    return this.detail(ctx, saved.id);
  }

  /** PATCH semantics. A value never moves to another dimension. */
  async update(id: string, body: AnalyticsCategoryInput, userId?: string | null, opts?: AnalyticsCallOptions): Promise<AnalyticsCategoryDetail> {
    const ctx = await this.context(opts, userId ?? null);
    const has = (key: keyof AnalyticsCategoryInput) =>
      body != null && Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;
    const [existing] = await this.lockValues(ctx, [id]);
    if (!existing) throw new NotFoundException('Analytics value not found.');
    if (has('axis_id') && body.axis_id !== null && String(body.axis_id) !== existing.axis_id) {
      throw analyticsRefusal('A value cannot move to another dimension.', 'axis_id');
    }
    const lifecycle = resolveAnalyticsLifecycle(existing.disabled_at, body);
    const values: AnalyticsCategoryValues = {
      axis_id: existing.axis_id,
      name: has('name') ? normalizeAnalyticsName(body.name) : existing.name,
      description: has('description') ? normalizeAnalyticsDescription(body.description) : existing.description ?? null,
      // PATCH: null clears it (both), absent keeps it.
      applies_to: has('applies_to') ? normalizeAppliesTo(body.applies_to) : existing.applies_to ?? null,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    };
    if (!categoryValuesEqual(existing, values)) {
      const axis = await this.loadAxis(ctx, existing.axis_id);
      await this.assertNameFree(ctx, values, axis ?? { name: null }, id);
      await this.persist(ctx, existing, values, axis ?? { name: null });
    }
    return this.detail(ctx, id);
  }

  /** Refused with a readable 409 while a line uses the value; disabling stays possible. */
  async delete(id: string, userId?: string | null, opts?: AnalyticsCallOptions): Promise<void> {
    const ctx = await this.context(opts, userId ?? null);
    // The row lock comes before the count: a line linked concurrently either
    // committed first (and is counted) or waits for this delete and then fails its key.
    const [existing] = await this.lockValues(ctx, [id]);
    if (!existing) throw new NotFoundException('Analytics value not found.');
    const usage = await this.countUsage(ctx, [id]);
    const lines = usage.get(id) ?? { opex: 0, capex: 0 };
    if (lines.opex + lines.capex > 0) {
      throw new ConflictException(`${existing.name} is used by ${lineUsageText(lines.opex, lines.capex)}. Disable it instead.`);
    }
    try {
      await ctx.manager.query(`DELETE FROM analytics_categories WHERE tenant_id = $1 AND id = $2`, [ctx.tenantId, id]);
    } catch (err: any) {
      if (err?.code === '23503') throw new ConflictException(`${existing.name} is still used. Disable it instead.`);
      throw err;
    }
    await this.audit.log(
      {
        table: 'analytics_categories',
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

  /**
   * Each value under its own savepoint: a refusal leaves the others deleted and the transaction
   * usable. The values are deleted (and so locked) in id order, as every multi-value lock
   * (`lockValues`); the result lists them in the order asked.
   */
  async bulkDelete(ids: string[], userId?: string | null, opts?: AnalyticsCallOptions): Promise<BulkDeleteResult> {
    const ctx = await this.context(opts, userId ?? null);
    const unique = Array.from(new Set((ids ?? []).map((id) => String(id))));
    const key = (id: string) => id.toLowerCase();
    const lockOrder = [...unique].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
    const outcomes = new Map<string, BulkDeleteResult['failed'][number] | null>();
    for (const id of lockOrder) {
      if (!isUUID(id)) {
        outcomes.set(id, { id, name: 'Unknown', reason: 'Analytics value not found.' });
        continue;
      }
      try {
        await withSavepoint(ctx.manager, () => this.delete(id, ctx.userId ?? null, ctx));
        outcomes.set(id, null);
      } catch (err: any) {
        const [row] = await ctx.manager.query(
          `SELECT name FROM analytics_categories WHERE tenant_id = $1 AND id = $2`,
          [ctx.tenantId, id],
        );
        outcomes.set(id, { id, name: row?.name ?? 'Unknown', reason: err?.message || 'Unknown error' });
      }
    }
    const result: BulkDeleteResult = { deleted: [], failed: [] };
    for (const id of unique) {
      const failure = outcomes.get(id);
      if (failure) result.failed.push(failure);
      else result.deleted.push(id);
    }
    return result;
  }

  /**
   * The manual order of a dimension's values: `valueIds` first, in that order, then the values it
   * leaves out in their current order; the dimension is renumbered 1..n in one statement. Every id
   * must be a value of the dimension, once. Writes one audit row on the dimension (the ordered
   * names before and after) when the order changes; the values keep their `updated_at`.
   *
   * Locks: the dimension's values FOR NO KEY UPDATE, in id order, then the dimension FOR NO KEY
   * UPDATE, which waits for a create in progress (it holds the dimension FOR SHARE); the values are
   * read again under that lock, so a value created meanwhile is numbered too.
   * - A line write takes FOR KEY SHARE on the value it links: NO KEY UPDATE does not conflict with
   *   it, so lines (a budget file load included) are never blocked by a reorder.
   * - Every value write that also locks the dimension locks its existing values first: an update
   *   locks its value (`lockValues`) before `persist` takes the dimension FOR SHARE, and the values
   *   CSV import locks every existing value it writes, in id order, before its first write. A
   *   create locks no existing value. Values before the dimension on every path: no deadlock.
   */
  async reorder(
    axisIdRaw: unknown,
    valueIdsRaw: unknown,
    userId?: string | null,
    opts?: AnalyticsCallOptions,
  ): Promise<{ items: AnalyticsCategory[] }> {
    const ctx = await this.context(opts, userId ?? null);
    const axisId = axisIdRaw == null ? '' : String(axisIdRaw).trim();
    const axis = await this.loadAxis(ctx, axisId);
    if (!axis) throw analyticsRefusal('Dimension not found.', 'axis_id');
    if (!Array.isArray(valueIdsRaw)) throw analyticsRefusal('The values must be a list.', 'value_ids');
    const valueIds = valueIdsRaw.map((id) => String(id ?? '').trim().toLowerCase());
    if (new Set(valueIds).size !== valueIds.length) {
      throw analyticsRefusal('Each value can appear only once in the order.', 'value_ids');
    }

    const dimensionIds = async () => {
      const rows: Array<{ id: string }> = await ctx.manager.query(
        `SELECT id FROM analytics_categories WHERE tenant_id = $1 AND axis_id = $2`,
        [ctx.tenantId, axis.id],
      );
      return rows.map((row) => row.id);
    };
    await this.lockValues(ctx, await dimensionIds(), 'NO KEY UPDATE');
    await ctx.manager.query(
      `SELECT id FROM analytics_axes WHERE tenant_id = $1 AND id = $2 FOR NO KEY UPDATE`,
      [ctx.tenantId, axis.id],
    );
    await this.lockValues(ctx, await dimensionIds(), 'NO KEY UPDATE');

    const current: Array<{ id: string; name: string; sort_order: number }> = await ctx.manager.query(
      `SELECT c.id, c.name, c.sort_order FROM analytics_categories c
        WHERE c.tenant_id = $1 AND c.axis_id = $2
        ORDER BY ${ANALYTICS_VALUE_ORDER_SQL}`,
      [ctx.tenantId, axis.id],
    );
    const byId = new Map(current.map((row) => [row.id, row]));
    if (valueIds.some((id) => !byId.has(id))) {
      throw analyticsRefusal(`Only values of ${analyticsAxisPhrase(axis)} can be ordered in it.`, 'value_ids');
    }
    const listed = new Set(valueIds);
    const next = [...valueIds.map((id) => byId.get(id)!), ...current.filter((row) => !listed.has(row.id))];

    await ctx.manager.query(
      `UPDATE analytics_categories c SET sort_order = n.position::int
         FROM unnest($2::uuid[]) WITH ORDINALITY AS n(id, position)
        WHERE c.tenant_id = $1 AND c.id = n.id AND c.sort_order IS DISTINCT FROM n.position::int`,
      [ctx.tenantId, next.map((row) => row.id)],
    );
    const moved = next.some((row, index) => row.id !== current[index].id);
    if (moved) {
      await this.audit.log(
        {
          table: 'analytics_axes',
          recordId: axis.id,
          action: 'update',
          before: current.map((row) => row.name),
          after: next.map((row) => row.name),
          userId: ctx.userId ?? null,
          source: ctx.audit?.source,
          sourceRef: ctx.audit?.sourceRef ?? null,
        },
        { manager: ctx.manager },
      );
    }

    const items = await orderValues(
      ctx.manager
        .getRepository(AnalyticsCategory)
        .createQueryBuilder('cat')
        .where('cat.tenant_id = :tenantId AND cat.axis_id = :axisId', { tenantId: ctx.tenantId, axisId: axis.id }),
      'sort_order',
      'ASC',
      false,
    ).getMany();
    return { items };
  }

  // Shared with the CSV service ---------------------------------------------

  /**
   * Locks the rows in id order and returns them; unknown ids are absent. FOR UPDATE by default
   * (a delete, an edit); the reorder takes NO KEY UPDATE, which lets lines link the values.
   */
  async lockValues(
    ctx: AnalyticsContext,
    ids: string[],
    mode: 'UPDATE' | 'NO KEY UPDATE' = 'UPDATE',
  ): Promise<StoredAnalyticsCategory[]> {
    const valid = ids.filter((id) => isUUID(String(id)));
    if (valid.length === 0) return [];
    return ctx.manager.query(
      `SELECT * FROM analytics_categories WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR ${mode === 'UPDATE' ? 'UPDATE' : 'NO KEY UPDATE'}`,
      [ctx.tenantId, valid],
    );
  }

  /** OPEX and CAPEX line counts per value, one query. */
  async countUsage(ctx: AnalyticsContext, ids: string[]): Promise<Map<string, { opex: number; capex: number }>> {
    const usage = new Map<string, { opex: number; capex: number }>();
    if (ids.length === 0) return usage;
    const rows: Array<{ id: string; opex: number; capex: number }> = await ctx.manager.query(
      `SELECT c.id,
              (SELECT count(*)::int FROM spend_item_analytics_values v WHERE v.tenant_id = $1 AND v.category_id = c.id) AS opex,
              (SELECT count(*)::int FROM capex_item_analytics_values v WHERE v.tenant_id = $1 AND v.category_id = c.id) AS capex
         FROM analytics_categories c
        WHERE c.tenant_id = $1 AND c.id = ANY($2::uuid[])`,
      [ctx.tenantId, ids],
    );
    for (const row of rows) usage.set(row.id, { opex: Number(row.opex), capex: Number(row.capex) });
    return usage;
  }

  async loadAxis(ctx: AnalyticsContext, axisId: string): Promise<AnalyticsAxisRef | undefined> {
    if (!isUUID(String(axisId))) return undefined;
    const [row] = await ctx.manager.query(
      `SELECT id, code, name, is_default, applies_to, status, disabled_at FROM analytics_axes WHERE tenant_id = $1 AND id = $2::uuid`,
      [ctx.tenantId, axisId],
    );
    return row;
  }

  /** The dimension a new value goes into: the one named, or the default. It must be active. */
  async resolveAxisForNewValue(ctx: AnalyticsContext, axisIdRaw: unknown): Promise<AnalyticsAxisRef> {
    const axisId = axisIdRaw == null || axisIdRaw === ''
      ? await resolveDefaultAxisId(ctx.manager, ctx.tenantId, { create: true })
      : String(axisIdRaw);
    const axis = axisId ? await this.loadAxis(ctx, axisId) : undefined;
    if (!axis) throw analyticsRefusal('Dimension not found.', 'axis_id');
    if (!isAxisActive(axis)) {
      throw analyticsRefusal(`${analyticsAxisSubject(axis)} is disabled. Enable it to add values.`, 'axis_id');
    }
    return axis;
  }

  /**
   * Inserts (existing = null) or updates one value and writes its audit row. Any write of a
   * restriction to one line type first locks the dimension FOR SHARE and checks it against the
   * dimension's own: a concurrent narrowing of the dimension (FOR UPDATE) then either committed
   * first and is seen here, or waits and counts this value. Also when the restriction looks
   * unchanged: `existing` may be an unlocked snapshot (the CSV import), so a transaction that
   * cleared the value and narrowed the dimension meanwhile is only seen under the lock.
   *
   * A new value goes last in its dimension (`max(sort_order) + 1`), under the same FOR SHARE lock
   * of the dimension: a reorder (which takes the dimension FOR NO KEY UPDATE) either committed
   * first and its positions are seen, or waits and numbers this value too. An update never
   * changes the position.
   */
  async persist(
    ctx: AnalyticsContext,
    existing: StoredAnalyticsCategory | null,
    values: AnalyticsCategoryValues,
    axis: { name: string | null },
  ): Promise<StoredAnalyticsCategory> {
    if (values.applies_to !== null || !existing) {
      const [locked] = await ctx.manager.query(
        `SELECT name, applies_to FROM analytics_axes WHERE tenant_id = $1 AND id = $2::uuid FOR SHARE`,
        [ctx.tenantId, values.axis_id],
      );
      const conflict = locked ? valueAppliesToConflict(locked, values.applies_to) : null;
      if (conflict) throw analyticsRefusal(conflict, 'applies_to');
    }
    let saved: StoredAnalyticsCategory | undefined;
    try {
      const rows = existing
        ? await ctx.manager.query(
          `UPDATE analytics_categories
              SET name = $3, description = $4, status = $5, disabled_at = $6, applies_to = $7, updated_at = now()
            WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
          [ctx.tenantId, existing.id, values.name, values.description, values.status, values.disabled_at, values.applies_to],
        )
        : await ctx.manager.query(
          `INSERT INTO analytics_categories (tenant_id, axis_id, name, description, status, disabled_at, applies_to, sort_order)
           VALUES ($1, $2, $3, $4, $5, $6, $7, (
             SELECT coalesce(max(sort_order), 0) + 1 FROM analytics_categories WHERE tenant_id = $1 AND axis_id = $2
           ))
        RETURNING *`,
          [ctx.tenantId, values.axis_id, values.name, values.description, values.status, values.disabled_at, values.applies_to],
        );
      saved = firstReturnedRow<StoredAnalyticsCategory>(rows);
    } catch (err: any) {
      if (err?.code === '23505') throw analyticsRefusal(duplicateValueMessage(values.name, axis), 'name');
      if (err?.code === '23514') {
        // The CHECK constraint mirrors `normalizeAppliesTo`; this only fires on a rule the service missed.
        if (err?.constraint === 'analytics_categories_applies_to_check') {
          throw analyticsRefusal("Used for must be 'opex', 'capex' or empty.", 'applies_to');
        }
        throw analyticsRefusal('This value cannot be saved as it is.');
      }
      throw err;
    }
    if (!saved) throw new NotFoundException('Analytics value not found.');
    await this.audit.log(
      {
        table: 'analytics_categories',
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

  // Internals ----------------------------------------------------------------

  private async detail(ctx: AnalyticsContext, id: string): Promise<AnalyticsCategoryDetail> {
    if (!isUUID(String(id))) throw new NotFoundException('Analytics value not found.');
    const [row] = await ctx.manager.query(
      `SELECT c.*, a.name AS axis_name, a.code AS axis_code, a.is_default AS axis_is_default,
              (SELECT count(*)::int FROM spend_item_analytics_values v WHERE v.tenant_id = $1 AND v.category_id = c.id) AS opex_count,
              (SELECT count(*)::int FROM capex_item_analytics_values v WHERE v.tenant_id = $1 AND v.category_id = c.id) AS capex_count
         FROM analytics_categories c
         JOIN analytics_axes a ON a.id = c.axis_id AND a.tenant_id = c.tenant_id
        WHERE c.tenant_id = $1 AND c.id = $2`,
      [ctx.tenantId, id],
    );
    if (!row) throw new NotFoundException('Analytics value not found.');
    return {
      ...row,
      axis_is_default: row.axis_is_default === true,
      opex_count: Number(row.opex_count ?? 0),
      capex_count: Number(row.capex_count ?? 0),
    };
  }

  private async assertNameFree(
    ctx: AnalyticsContext,
    values: AnalyticsCategoryValues,
    axis: { name: string | null },
    id: string | null,
  ) {
    const [duplicate] = await ctx.manager.query(
      `SELECT id FROM analytics_categories
        WHERE tenant_id = $1 AND axis_id = $2 AND lower(name) = lower($3) AND ($4::uuid IS NULL OR id <> $4::uuid)
        LIMIT 1`,
      [ctx.tenantId, values.axis_id, values.name, id],
    );
    if (duplicate) throw analyticsRefusal(duplicateValueMessage(values.name, axis), 'name');
  }

  /** The list query: tenant, dimension, lifecycle scope, quick search and grid filters. */
  private buildQuery(ctx: AnalyticsContext, query: any) {
    const { status, q, filters } = parsePagination(query);
    const { status: statusFromAg, matchNone, sanitizedFilters: extracted } = extractStatusFilterFromAgModel(filters);
    const sanitizedFilters = withAppliesToBlanks(extracted);
    const effectiveStatus = status ?? statusFromAg;
    const includeDisabled = ['1', 'true'].includes(String(query?.includeDisabled ?? '').toLowerCase());

    const qb = ctx.manager
      .getRepository(AnalyticsCategory)
      .createQueryBuilder('cat')
      .leftJoin('analytics_axes', 'ax', 'ax.id = cat.axis_id AND ax.tenant_id = cat.tenant_id')
      .where('cat.tenant_id = :tenantId', { tenantId: ctx.tenantId });
    const axisId = query?.axis_id == null ? '' : String(query.axis_id).trim();
    if (axisId) {
      // An id that is not a uuid matches nothing (and must not reach a uuid cast).
      if (isUUID(axisId)) qb.andWhere('cat.axis_id = :axisId', { axisId });
      else qb.andWhere('1 = 0');
    }
    if (effectiveStatus) applyStatusFilter(qb, { alias: 'cat', explicitStatus: effectiveStatus as StatusState, includeDisabled, matchNone });
    else applyStatusFilter(qb, { alias: 'cat', includeDisabled, matchNone });
    if (q) {
      qb.andWhere('(cat.name ILIKE :term OR cat.description ILIKE :term)', { term: `%${q}%` });
    }
    const nextParam = createParamNameGenerator('analytics_filter_');
    const models = sanitizedFilters && typeof sanitizedFilters === 'object' ? sanitizedFilters : {};
    for (const [field, raw] of Object.entries(models)) {
      const expression = FILTER_EXPRESSIONS[field];
      if (!expression || !raw || typeof raw !== 'object') continue;
      const combined = (raw.operator === 'AND' || raw.operator === 'OR') && Array.isArray(raw.conditions) && raw.conditions.length > 0;
      const parts = (combined ? raw.conditions : [raw])
        .map((model: any) => compileAgFilterCondition(model, { expression }, nextParam))
        .filter(Boolean) as Array<{ sql: string; params: Record<string, any> }>;
      if (parts.length === 0) continue;
      const params = Object.assign({}, ...parts.map((part) => part.params));
      qb.andWhere(`(${parts.map((part) => `(${part.sql})`).join(combined && raw.operator === 'OR' ? ' OR ' : ' AND ')})`, params);
    }
    return qb;
  }
}
