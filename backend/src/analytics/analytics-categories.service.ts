import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { isUUID } from 'class-validator';
import { Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { compileAgFilterCondition, createParamNameGenerator } from '../common/ag-grid-filtering';
import { BulkDeleteResult } from '../common/delete.types';
import { parsePagination } from '../common/pagination';
import { withSavepoint } from '../common/savepoint.util';
import { StatusState } from '../common/status';
import { applyStatusFilter, extractStatusFilterFromAgModel } from '../common/status-filter';
import { AnalyticsCategory } from './analytics-category.entity';
import { analyticsAxisInSentence, analyticsAxisSubject, isAxisActive, resolveDefaultAxisId } from './analytics-axes.util';
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
  status: StatusState;
  disabled_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export interface AnalyticsCategoryValues {
  axis_id: string;
  name: string;
  description: string | null;
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
  status: string;
  disabled_at: Date | string | null;
}

export interface AnalyticsCategoryInput {
  axis_id?: unknown;
  name?: unknown;
  description?: unknown;
  status?: unknown;
  disabled_at?: unknown;
}

const SORT_FIELDS = new Set(['name', 'description', 'status', 'created_at', 'updated_at', 'disabled_at']);
// Grid and AI filter fields and the SQL they compile to (the dimension label as the AI registry shows it).
const FILTER_EXPRESSIONS: Record<string, string> = {
  name: 'cat.name',
  description: 'cat.description',
  axis_code: 'ax.code',
  axis_name: `COALESCE(NULLIF(BTRIM(ax.name), ''), 'Analytics dimension')`,
};
const MAX_IDS = 10_000;

export function categoryValuesEqual(stored: StoredAnalyticsCategory, next: AnalyticsCategoryValues): boolean {
  return stored.axis_id === next.axis_id
    && stored.name === next.name
    && (stored.description ?? null) === next.description
    && stored.status === next.status
    && sameInstant(stored.disabled_at, next.disabled_at);
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
    const { page, limit, skip, sort } = parsePagination(query ?? {}, { field: 'name', direction: 'ASC' });
    const qb = this.buildQuery(ctx, query ?? {});
    const total = await qb.getCount();
    const field = SORT_FIELDS.has(sort.field) ? sort.field : 'name';
    const items = await qb
      .orderBy(`cat.${field}`, sort.direction)
      .addOrderBy('cat.id', 'ASC')
      .skip(skip)
      .take(limit)
      .getMany();
    return { items, total, page, limit };
  }

  async listIds(query: any, opts?: AnalyticsCallOptions): Promise<{ ids: string[]; total: number }> {
    const ctx = await this.context(opts);
    const { sort } = parsePagination({ ...(query ?? {}), page: 1 }, { field: 'name', direction: 'ASC' });
    const qb = this.buildQuery(ctx, query ?? {});
    const total = await qb.clone().getCount();
    const field = SORT_FIELDS.has(sort.field) ? sort.field : 'name';
    const limit = Math.min(Number(query?.limit) || MAX_IDS, MAX_IDS);
    const rows = await qb
      .select('cat.id', 'id')
      .orderBy(`cat.${field}`, sort.direction)
      .addOrderBy('cat.id', 'ASC')
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

  /** Each value under its own savepoint: a refusal leaves the others deleted and the transaction usable. */
  async bulkDelete(ids: string[], userId?: string | null, opts?: AnalyticsCallOptions): Promise<BulkDeleteResult> {
    const ctx = await this.context(opts, userId ?? null);
    const result: BulkDeleteResult = { deleted: [], failed: [] };
    const unique = Array.from(new Set((ids ?? []).map((id) => String(id))));
    for (const id of unique) {
      if (!isUUID(id)) {
        result.failed.push({ id, name: 'Unknown', reason: 'Analytics value not found.' });
        continue;
      }
      try {
        await withSavepoint(ctx.manager, () => this.delete(id, ctx.userId ?? null, ctx));
        result.deleted.push(id);
      } catch (err: any) {
        const [row] = await ctx.manager.query(
          `SELECT name FROM analytics_categories WHERE tenant_id = $1 AND id = $2`,
          [ctx.tenantId, id],
        );
        result.failed.push({ id, name: row?.name ?? 'Unknown', reason: err?.message || 'Unknown error' });
      }
    }
    return result;
  }

  // Shared with the CSV service ---------------------------------------------

  /** Locks the rows (FOR UPDATE, stable order) and returns them; unknown ids are absent. */
  async lockValues(ctx: AnalyticsContext, ids: string[]): Promise<StoredAnalyticsCategory[]> {
    const valid = ids.filter((id) => isUUID(String(id)));
    if (valid.length === 0) return [];
    return ctx.manager.query(
      `SELECT * FROM analytics_categories WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
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
      `SELECT id, code, name, is_default, status, disabled_at FROM analytics_axes WHERE tenant_id = $1 AND id = $2::uuid`,
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

  /** Inserts (existing = null) or updates one value and writes its audit row. */
  async persist(
    ctx: AnalyticsContext,
    existing: StoredAnalyticsCategory | null,
    values: AnalyticsCategoryValues,
    axis: { name: string | null },
  ): Promise<StoredAnalyticsCategory> {
    let saved: StoredAnalyticsCategory | undefined;
    try {
      const rows = existing
        ? await ctx.manager.query(
          `UPDATE analytics_categories
              SET name = $3, description = $4, status = $5, disabled_at = $6, updated_at = now()
            WHERE tenant_id = $1 AND id = $2
        RETURNING *`,
          [ctx.tenantId, existing.id, values.name, values.description, values.status, values.disabled_at],
        )
        : await ctx.manager.query(
          `INSERT INTO analytics_categories (tenant_id, axis_id, name, description, status, disabled_at)
           VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *`,
          [ctx.tenantId, values.axis_id, values.name, values.description, values.status, values.disabled_at],
        );
      saved = firstReturnedRow<StoredAnalyticsCategory>(rows);
    } catch (err: any) {
      if (err?.code === '23505') throw analyticsRefusal(duplicateValueMessage(values.name, axis), 'name');
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
    const { status: statusFromAg, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
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
    if (effectiveStatus) applyStatusFilter(qb, { alias: 'cat', explicitStatus: effectiveStatus as StatusState, includeDisabled });
    else applyStatusFilter(qb, { alias: 'cat', includeDisabled });
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
