import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, In, Repository } from 'typeorm';
import { buildWhereFromAgFilters, parsePagination } from '../common/pagination';
import { User } from '../users/user.entity';
import { AuditLog } from './audit.entity';
import { assertSetFilterModes, compileAgFilterCondition, createParamNameGenerator, normalizeAgFilterModel } from '../common/ag-grid-filtering';
import { neutralizeCsvRow } from '../common/csv/csv-export.service';
import { writeCsvHeader, writeCsvRows } from '../common/csv-sheet/write';
import type { CsvLanguage } from '../common/csv-sheet/types';
import { AUTH_EVENT_TABLE, EXPORT_EVENT_TABLE } from './security-events';

type AuditListItem = {
  id: string;
  tenant_id: string;
  table_name: string;
  record_id: string | null;
  action: string;
  before_json: any | null;
  after_json: any | null;
  user_id: string | null;
  user_email: string | null;
  user_name: string | null;
  source: string;
  source_ref: string | null;
  created_at: Date;
};

const AUDIT_FILTER_VALUE_FIELDS = ['table_name', 'action', 'source'] as const;
type AuditFilterValueField = (typeof AUDIT_FILTER_VALUE_FIELDS)[number];

const AUDIT_SORT_FIELDS = ['created_at', 'table_name', 'action'];

/** The CSV export of the audit log stops after this many rows (in the list's order, newest first by default). */
export const AUDIT_LOG_EXPORT_MAX_ROWS = 100_000;

/**
 * Rows the export reads per query. The file is written batch by batch, so memory holds one batch
 * (a few megabytes with large before and after values), never the whole file.
 */
export const AUDIT_LOG_EXPORT_BATCH_ROWS = 1_000;

/**
 * Set on an export that stopped at the row limit, with that limit as its value: the file holds the
 * first rows of the list's order only.
 */
export const AUDIT_LOG_EXPORT_TRUNCATED_HEADER = 'X-Export-Truncated';

/**
 * The columns of the export, flat and stable: the date (ISO 8601, UTC), the codes as stored, the
 * person as the audit log page shows them (exportUserLabel), the client address and user agent of
 * a sign-in, session or export event, then the values before and after as compact JSON.
 */
export const AUDIT_LOG_EXPORT_HEADERS = [
  'date',
  'action',
  'table',
  'record_id',
  'user',
  'source',
  'source_ref',
  'ip',
  'user_agent',
  'before',
  'after',
] as const;

export type AuditLogExport = {
  filename: string;
  /** More rows matched than `limit`: the file stops there. Known before the first part. */
  truncated: boolean;
  limit: number;
  /**
   * The file in parts, read once and in order: the BOM and the header line, then one part per
   * batch of rows. Each batch is read when the previous part has been taken, in the caller's
   * transaction, so the caller keeps that transaction open until the last part.
   */
  chunks: AsyncIterable<string>;
};

type AuditExportRaw = {
  created_at: Date | string;
  table_name: string | null;
  record_id: string | null;
  action: string | null;
  before_json: unknown;
  after_json: unknown;
  source: string | null;
  source_ref: string | null;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
};

/** A batch row: the export columns, plus the row's place in the order (where the next batch starts). */
type AuditExportBatchRow = AuditExportRaw & { id: string; sort_value: string };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A user filter names a user id (a UUID); anything else is a request error, not a database error. */
function requireUserId(value: string, name: string): string {
  if (!UUID_PATTERN.test(value)) {
    throw new BadRequestException(`The ${name} filter must be a user id.`);
  }
  return value;
}

/** A date the database reads: a real calendar date, year 1 to 9999. */
function isUsableDate(date: Date): boolean {
  if (Number.isNaN(date.getTime())) return false;
  const year = date.getUTCFullYear();
  return year >= 1 && year <= 9999;
}

/** `YYYY-MM-DD`, alone or followed by a time (the date filter of the grid sends `YYYY-MM-DD hh:mm:ss`). */
const DAY_PREFIX = /^(\d{4}-\d{2}-\d{2})(?:[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?)?$/;

/** A day as written: `2026-02-30` is refused, not read as March 2. */
function isCalendarDay(day: string): boolean {
  const date = new Date(`${day}T00:00:00.000Z`);
  return isUsableDate(date) && date.toISOString().slice(0, 10) === day;
}

function compactJson(value: unknown): string {
  if (value == null) return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

function textCell(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isoDate(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toISOString();
}

/**
 * The `user` cell, with the fallbacks of the audit log page (frontend `auditUserLabel`): the
 * person's name, their address only when they have no name, else fixed English codes like the
 * rest of the file: `Unknown account` (a person who is no longer in the workspace, or a sign-in
 * attempt that named no account), `Webhook` or `System`. Never an id.
 */
export function exportUserLabel(row: Pick<AuditExportRaw, 'user_id' | 'first_name' | 'last_name' | 'email' | 'table_name' | 'source'>): string {
  const name = [row.first_name, row.last_name].map((part) => (part ?? '').trim()).filter(Boolean).join(' ');
  if (name) return name;
  const email = (row.email ?? '').trim();
  if (email) return email;
  if (row.user_id || row.table_name === AUTH_EVENT_TABLE) return 'Unknown account';
  if (String(row.source ?? '').toLowerCase() === 'webhook') return 'Webhook';
  return 'System';
}

/** One export row, in the order of AUDIT_LOG_EXPORT_HEADERS. */
export function auditExportRow(row: AuditExportRaw): string[] {
  const after = row.after_json && typeof row.after_json === 'object' && !Array.isArray(row.after_json)
    ? row.after_json as Record<string, unknown>
    : null;
  // Only sign-in, session and export events keep a client address and user agent (security-events.ts);
  // an `ip` field of another table's row is that record's data and stays in `after`.
  const details = row.table_name === AUTH_EVENT_TABLE || row.table_name === EXPORT_EVENT_TABLE ? after : null;
  return [
    isoDate(row.created_at),
    row.action ?? '',
    row.table_name ?? '',
    row.record_id ?? '',
    exportUserLabel(row),
    row.source ?? '',
    row.source_ref ?? '',
    textCell(details?.ip),
    textCell(details?.user_agent),
    compactJson(row.before_json),
    compactJson(row.after_json),
  ];
}

@Injectable()
export class AuditLogsService {
  /** The most rows one export writes (AUDIT_LOG_EXPORT_MAX_ROWS). */
  exportRowLimit = AUDIT_LOG_EXPORT_MAX_ROWS;
  /** Rows read per query by the export (AUDIT_LOG_EXPORT_BATCH_ROWS). */
  exportBatchSize = AUDIT_LOG_EXPORT_BATCH_ROWS;

  constructor(
    @InjectRepository(AuditLog)
    private readonly repo: Repository<AuditLog>,
  ) {}

  private getAuditRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(AuditLog) : this.repo;
  }

  private getUserRepo(manager?: EntityManager) {
    const mg = manager ?? this.repo.manager;
    return mg.getRepository(User);
  }

  /**
   * The `from` and `to` parameters: a day (`YYYY-MM-DD`, `to` included up to the end of that day,
   * UTC) or a full date and time. A value that is not a date is a request error (400).
   */
  private resolveBoundary(raw: unknown, name: 'from' | 'to'): Date | null {
    const text = String(raw ?? '').trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      if (!isCalendarDay(text)) throw new BadRequestException(`"${name}" is not a valid date.`);
      const day = new Date(`${text}T00:00:00.000Z`);
      if (name === 'to') day.setUTCDate(day.getUTCDate() + 1);
      return day;
    }
    const parsed = new Date(text);
    if (!isUsableDate(parsed)) throw new BadRequestException(`"${name}" is not a valid date.`);
    return parsed;
  }

  /**
   * The grid's date filter on the date column (`filters.created_at`, a date model), compiled like
   * the other lists' date filters (by day). Its days must be real dates (400 otherwise); a model of
   * another kind on that column is ignored, as before.
   */
  private applyDateFilter(qb: ReturnType<Repository<AuditLog>['createQueryBuilder']>, filters: any) {
    const raw = filters && typeof filters === 'object' ? filters.created_at : undefined;
    const model = normalizeAgFilterModel(raw);
    if (!model || typeof model !== 'object' || model.filterType !== 'date') return;
    for (const value of [model.dateFrom, model.dateTo]) {
      if (value == null || value === '') continue;
      const match = DAY_PREFIX.exec(String(value).trim());
      if (!match || !isCalendarDay(match[1])) throw new BadRequestException('The date filter is not a valid date.');
    }
    const compiled = compileAgFilterCondition(model, { expression: 'a.created_at' }, createParamNameGenerator('f_created_at_'));
    if (compiled) qb.andWhere(compiled.sql, compiled.params);
  }

  private applyFindOperatorFilter(
    qb: ReturnType<Repository<AuditLog>['createQueryBuilder']>,
    field: string,
    value: any,
    paramBase: string,
  ) {
    if (value == null) return;

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      qb.andWhere(`a.${field} = :${paramBase}`, { [paramBase]: value });
      return;
    }

    const opType = value?._type;
    const opValue = value?._value;

    if (!opType) return;

    switch (opType) {
      case 'in': {
        const list = Array.isArray(opValue) ? opValue : [];
        if (list.length === 0) {
          qb.andWhere('1=0');
        } else {
          qb.andWhere(`a.${field} IN (:...${paramBase})`, { [paramBase]: list });
        }
        return;
      }
      case 'ilike': {
        qb.andWhere(`a.${field} ILIKE :${paramBase}`, { [paramBase]: opValue });
        return;
      }
      case 'like': {
        qb.andWhere(`a.${field} LIKE :${paramBase}`, { [paramBase]: opValue });
        return;
      }
      case 'not': {
        const nestedType = opValue?._type;
        if (nestedType === 'ilike') {
          qb.andWhere(`a.${field} NOT ILIKE :${paramBase}`, { [paramBase]: opValue._value });
        } else if (nestedType === 'like') {
          qb.andWhere(`a.${field} NOT LIKE :${paramBase}`, { [paramBase]: opValue._value });
        } else {
          qb.andWhere(`a.${field} <> :${paramBase}`, { [paramBase]: opValue });
        }
        return;
      }
      case 'raw': {
        const sqlBuilder = value?._getSql;
        if (typeof sqlBuilder === 'function') {
          const sql = sqlBuilder(`a.${field}`);
          const params = value?._objectLiteralParameters ?? {};
          qb.andWhere(sql, params);
        }
        return;
      }
      default:
        return;
    }
  }

  private extractUserIdFilter(filters: any): { equals?: string; in?: string[] } {
    if (!filters || typeof filters !== 'object') return {};
    let model: any = filters.user_id;
    if (!model) return {};

    if (model && model.operator && Array.isArray(model.conditions) && model.conditions.length > 0) {
      model = model.conditions[0];
    }

    const type = String(model?.type ?? model?.filterType ?? '').trim();
    const valRaw = model?.filter ?? model?.value;

    if (type === 'set' && Array.isArray(model?.values)) {
      const values = model.values
        .map((v: any) => String(v ?? '').trim())
        .filter((v: string) => v.length > 0)
        .map((v: string) => requireUserId(v, 'user'));
      return values.length > 0 ? { in: Array.from(new Set(values)) } : {};
    }

    if (type === 'equals' && valRaw != null) {
      const value = String(valRaw).trim();
      return value ? { equals: requireUserId(value, 'user') } : {};
    }

    return {};
  }

  private createFilteredQuery(params: {
    query: any;
    q?: string;
    filters?: any;
    manager?: EntityManager;
    excludeField?: 'table_name' | 'action' | 'source' | 'user_id';
  }) {
    const { query, q, filters, manager, excludeField } = params;
    assertSetFilterModes(filters);
    const repo = this.getAuditRepo(manager);
    const qb = repo
      .createQueryBuilder('a')
      .leftJoin(User, 'u', 'u.id = a.user_id AND u.tenant_id = a.tenant_id');

    const allowedAgFields = ['table_name', 'action', 'source']
      .filter((field) => field !== excludeField);
    const fromAg = buildWhereFromAgFilters(filters, allowedAgFields);
    Object.entries(fromAg).forEach(([field, value], idx) => {
      this.applyFindOperatorFilter(qb, field, value, `f_${field}_${idx}`);
    });
    this.applyDateFilter(qb, filters);

    if (excludeField !== 'user_id') {
      const userIdFilter = this.extractUserIdFilter(filters);
      if (userIdFilter.equals) {
        qb.andWhere('a.user_id = :agUserId', { agUserId: userIdFilter.equals });
      } else if (userIdFilter.in && userIdFilter.in.length > 0) {
        qb.andWhere('a.user_id IN (:...agUserIds)', { agUserIds: userIdFilter.in });
      }
    }

    const tableName = String(query?.table_name ?? '').trim();
    if (tableName && excludeField !== 'table_name') {
      qb.andWhere('a.table_name = :tableName', { tableName });
    }

    const action = String(query?.action ?? '').trim();
    if (action && excludeField !== 'action') {
      qb.andWhere('a.action = :action', { action });
    }

    const userId = String(query?.user_id ?? '').trim();
    if (userId && excludeField !== 'user_id') {
      qb.andWhere('a.user_id = :userId', { userId: requireUserId(userId, 'user_id') });
    }

    const source = String(query?.source ?? '').trim();
    if (source && excludeField !== 'source') {
      qb.andWhere('a.source = :source', { source });
    }

    const from = this.resolveBoundary(query?.from, 'from');
    if (from) qb.andWhere('a.created_at >= :from', { from });

    const toExclusive = this.resolveBoundary(query?.to, 'to');
    if (toExclusive) qb.andWhere('a.created_at < :to', { to: toExclusive });

    if (q) {
      const like = `%${q}%`;
      qb.andWhere(
        new Brackets((sub) => {
          sub.where('a.table_name ILIKE :q', { q: like })
            .orWhere('a.action ILIKE :q', { q: like })
            .orWhere('u.email ILIKE :q', { q: like })
            .orWhere(`concat_ws(' ', coalesce(u.first_name, ''), coalesce(u.last_name, '')) ILIKE :q`, { q: like });
        }),
      );
    }

    return qb;
  }

  private toAuditListItem(entry: AuditLog, userById: Map<string, User>): AuditListItem {
    const user = entry.user_id ? userById.get(entry.user_id) : undefined;
    const first = (user?.first_name ?? '').trim();
    const last = (user?.last_name ?? '').trim();
    const userName = [first, last].filter(Boolean).join(' ').trim() || null;

    return {
      id: entry.id,
      tenant_id: entry.tenant_id,
      table_name: entry.table_name,
      record_id: entry.record_id,
      action: entry.action,
      before_json: entry.before_json,
      after_json: entry.after_json,
      user_id: entry.user_id,
      user_email: user?.email ?? null,
      user_name: userName,
      source: entry.source,
      source_ref: entry.source_ref,
      created_at: entry.created_at,
    };
  }

  private async loadUsersById(userIds: string[], manager?: EntityManager): Promise<Map<string, User>> {
    const unique = Array.from(new Set(userIds.filter(Boolean)));
    if (unique.length === 0) return new Map();

    const users = await this.getUserRepo(manager).find({
      select: ['id', 'email', 'first_name', 'last_name'],
      where: { id: In(unique) } as any,
    });

    return new Map(users.map((u) => [u.id, u]));
  }

  async list(query: any, opts?: { manager?: EntityManager }) {
    const { page, limit, skip, sort, q, filters } = parsePagination(query, {
      field: 'created_at',
      direction: 'DESC',
    });

    const sortField = AUDIT_SORT_FIELDS.includes(sort.field) ? sort.field : 'created_at';

    const qb = this.createFilteredQuery({
      query,
      q,
      filters,
      manager: opts?.manager,
    });

    const total = await qb.clone().getCount();
    const items = await qb
      .orderBy(`a.${sortField}`, sort.direction)
      .skip(skip)
      .take(limit)
      .getMany();

    const usersById = await this.loadUsersById(
      items.map((entry) => entry.user_id).filter((id): id is string => !!id),
      opts?.manager,
    );

    return {
      items: items.map((entry) => this.toAuditListItem(entry, usersById)),
      total,
      page,
      limit,
    };
  }

  /**
   * The rows the list shows for the same query (filters, search, dates, sort), every page, as a
   * CSV file (common/csv-sheet/write.ts, with the formula guard on every cell), up to
   * `exportRowLimit` rows. Limited to the tenant by RLS and by its own `tenant_id` predicate.
   *
   * Counts up to `exportRowLimit + 1` matching rows first (no row loaded), so whether the file
   * stops at the limit is known before its first byte. The rows are then read in batches of
   * `exportBatchSize`, each starting strictly after the last row of the previous one in the
   * list's order (sort column, then id): no row is read twice or skipped, and memory holds one
   * batch. Every batch runs on `opts.manager`, under the tenant of the request.
   */
  async exportCsv(
    query: any,
    opts: { manager: EntityManager; tenantId: string; language: CsvLanguage },
  ): Promise<AuditLogExport> {
    const { sort, q, filters } = parsePagination(query, {
      field: 'created_at',
      direction: 'DESC',
    });
    const sortField = AUDIT_SORT_FIELDS.includes(sort.field) ? sort.field : 'created_at';
    const direction = sort.direction === 'ASC' ? 'ASC' : 'DESC';
    const limit = Math.max(0, Math.floor(this.exportRowLimit));
    const batchSize = Math.max(1, Math.floor(this.exportBatchSize));
    const { manager, tenantId, language } = opts;

    const filtered = () => this.createFilteredQuery({ query, q, filters, manager })
      .andWhere('a.tenant_id = :exportTenantId', { exportTenantId: tenantId });

    const [cappedSql, cappedParams] = filtered().select('a.id', 'id').limit(limit + 1).getQueryAndParameters();
    const counted = await manager.query(`SELECT count(*)::int AS matched FROM (${cappedSql}) AS capped`, cappedParams);
    const truncated = Number(counted?.[0]?.matched ?? 0) > limit;

    const readBatch = (take: number, after: { value: string; id: string } | null) => {
      const qb = filtered()
        .select('a.id', 'id')
        .addSelect(`CAST(a.${sortField} AS text)`, 'sort_value')
        .addSelect('a.created_at', 'created_at')
        .addSelect('a.table_name', 'table_name')
        .addSelect('a.record_id', 'record_id')
        .addSelect('a.action', 'action')
        .addSelect('a.before_json', 'before_json')
        .addSelect('a.after_json', 'after_json')
        .addSelect('a.source', 'source')
        .addSelect('a.source_ref', 'source_ref')
        .addSelect('a.user_id', 'user_id')
        .addSelect('u.first_name', 'first_name')
        .addSelect('u.last_name', 'last_name')
        .addSelect('u.email', 'email');
      if (after) {
        // Strictly after the previous batch's last row; the plain comparison lets the
        // (tenant_id, created_at) index start there.
        const op = direction === 'ASC' ? '>' : '<';
        qb.andWhere(`a.${sortField} ${op}= :afterValue AND (a.${sortField}, a.id) ${op} (:afterValue, :afterId)`, {
          afterValue: after.value,
          afterId: after.id,
        });
      }
      return qb
        .orderBy(`a.${sortField}`, direction)
        .addOrderBy('a.id', direction)
        .limit(take)
        .getRawMany<AuditExportBatchRow>();
    };

    async function* chunks(): AsyncGenerator<string> {
      yield writeCsvHeader(language, AUDIT_LOG_EXPORT_HEADERS);
      let written = 0;
      let after: { value: string; id: string } | null = null;
      while (written < limit) {
        const take = Math.min(batchSize, limit - written);
        const batch = await readBatch(take, after);
        if (batch.length === 0) return;
        const rows = batch.map((row) => neutralizeCsvRow(auditExportRow(row)));
        yield writeCsvRows({ language, headers: AUDIT_LOG_EXPORT_HEADERS, rows });
        written += batch.length;
        if (batch.length < take) return;
        const last = batch[batch.length - 1];
        after = { value: last.sort_value, id: last.id };
      }
    }

    const day = new Date().toISOString().slice(0, 10);
    return { filename: `audit-log-${day}.csv`, truncated, limit, chunks: chunks() };
  }

  async listFilterValues(query: any, opts?: { manager?: EntityManager }): Promise<Record<string, Array<string | null>>> {
    const { q, filters } = parsePagination(query, {
      field: 'created_at',
      direction: 'DESC',
    });
    const rawFields = String(query?.fields ?? query?.field ?? '')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
    const fields = rawFields
      .filter((field): field is AuditFilterValueField => (
        (AUDIT_FILTER_VALUE_FIELDS as readonly string[]).includes(field)
      ));
    if (fields.length === 0) return {};

    const results: Record<string, Array<string | null>> = {};
    for (const field of fields) {
      const qb = this.createFilteredQuery({
        query,
        q,
        filters,
        manager: opts?.manager,
        excludeField: field,
      });
      const rows = await qb
        .select(`a.${field}`, 'value')
        .distinct(true)
        .orderBy(`a.${field}`, 'ASC', 'NULLS FIRST')
        .limit(2000)
        .getRawMany<{ value: string | null }>();
      results[field] = rows.map((row) => row.value ?? null);
    }
    return results;
  }

  async getById(id: string, opts?: { manager?: EntityManager }) {
    const repo = this.getAuditRepo(opts?.manager);
    const found = await repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException('Audit entry not found');

    const usersById = await this.loadUsersById(found.user_id ? [found.user_id] : [], opts?.manager);
    return this.toAuditListItem(found, usersById);
  }
}
