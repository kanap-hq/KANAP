import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, In, Repository } from 'typeorm';
import { buildWhereFromAgFilters, parsePagination } from '../common/pagination';
import { User } from '../users/user.entity';
import { AuditLog } from './audit.entity';
import { assertSetFilterModes } from '../common/ag-grid-filtering';

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

@Injectable()
export class AuditLogsService {
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

  private parseDate(raw: unknown): Date | null {
    const text = String(raw ?? '').trim();
    if (!text) return null;
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed;
  }

  private resolveFrom(raw: unknown): Date | null {
    const text = String(raw ?? '').trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return new Date(`${text}T00:00:00.000Z`);
    }
    return this.parseDate(text);
  }

  private resolveToExclusive(raw: unknown): Date | null {
    const text = String(raw ?? '').trim();
    if (!text) return null;
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const day = new Date(`${text}T00:00:00.000Z`);
      day.setUTCDate(day.getUTCDate() + 1);
      return day;
    }
    return this.parseDate(text);
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
        .filter((v: string) => v.length > 0);
      return values.length > 0 ? { in: Array.from(new Set(values)) } : {};
    }

    if (type === 'equals' && valRaw != null) {
      const value = String(valRaw).trim();
      return value ? { equals: value } : {};
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
      .leftJoin(User, 'u', 'u.id = a.user_id');

    const allowedAgFields = ['table_name', 'action', 'source']
      .filter((field) => field !== excludeField);
    const fromAg = buildWhereFromAgFilters(filters, allowedAgFields);
    Object.entries(fromAg).forEach(([field, value], idx) => {
      this.applyFindOperatorFilter(qb, field, value, `f_${field}_${idx}`);
    });

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
      qb.andWhere('a.user_id = :userId', { userId });
    }

    const source = String(query?.source ?? '').trim();
    if (source && excludeField !== 'source') {
      qb.andWhere('a.source = :source', { source });
    }

    const from = this.resolveFrom(query?.from);
    if (from) qb.andWhere('a.created_at >= :from', { from });

    const toExclusive = this.resolveToExclusive(query?.to);
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

    const sortField = ['created_at', 'table_name', 'action'].includes(sort.field)
      ? sort.field
      : 'created_at';

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
