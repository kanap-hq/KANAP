import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, Repository } from 'typeorm';
import { Department } from './department.entity';
import { parseExportPagination, parsePagination } from '../common/pagination';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import { Company } from '../companies/company.entity';
import { format } from '@fast-csv/format';
import { parseString } from '@fast-csv/parse';
import * as fs from 'fs';
import { decodeCsvBufferUtf8OrThrow } from '../common/encoding';
import {
  buildQuickSearchConditions,
  compileAgFilterCondition,
  createParamNameGenerator,
  FilterTargetConfig,
  CompiledCondition,
} from '../common/ag-grid-filtering';
import { applyStatusFilter, extractStatusFilterFromAgModel } from '../common/status-filter';
import { StatusState, STATUS_STATES, deriveStatusFromDisabledAt, resolveLifecycleState } from '../common/status';
import { csvItemLifecycle, csvLifecycleConflict } from '../spend/item-write.util';
import { DepartmentUpsertDto } from './dto/department.dto';
import { denormalizeCsvRow, neutralizeCsvRow } from '../common/csv/csv-export.service';
import { csvDataRowLines, rowLine } from '../common/csv/csv-row-lines';

type DepartmentLookupItem = { id: string; name: string; company_id: string };

@Injectable()
export class DepartmentsService {
  constructor(
    @InjectRepository(Department) private readonly repo: Repository<Department>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    private readonly audit: AuditService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Department) : this.repo;
  }
  private getCompanyRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Company) : this.companies;
  }

  async list(query: any, opts?: { manager?: EntityManager; exportAll?: boolean }) {
    const repo = this.getRepo(opts?.manager);
    const { page, limit, skip, sort, status, q, filters } = opts?.exportAll
      ? parseExportPagination(query)
      : parsePagination(query);
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = sanitizedFilters ?? filters;
    const effectiveStatus = status ?? statusFromAg;
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';
    const year = query?.year ? Number(query.year) : undefined;

    type DepartmentFilterTarget = FilterTargetConfig & { requiresMetrics?: boolean };
    const filterTargets: Record<string, DepartmentFilterTarget> = {
      id: { expression: 'd.id', dataType: 'string' },
      company_id: { expression: 'd.company_id', dataType: 'string' },
      name: { expression: 'd.name', dataType: 'string' },
      description: { expression: 'd.description', dataType: 'string' },
      status: { expression: 'd.status', textExpression: 'CAST(d.status AS TEXT)', dataType: 'string' },
      company_name: { expression: 'c.name', dataType: 'string' },
      created_at: {
        expression: 'd.created_at',
        textExpression: 'CAST(d.created_at AS TEXT)',
        dataType: 'string',
      },
      updated_at: {
        expression: 'd.updated_at',
        textExpression: 'CAST(d.updated_at AS TEXT)',
        dataType: 'string',
      },
      headcount_year: {
        expression: 'm.headcount',
        numericExpression: 'COALESCE(m.headcount, 0)',
        textExpression: 'CAST(COALESCE(m.headcount, 0) AS TEXT)',
        dataType: 'number',
        requiresMetrics: true,
      },
      metrics_frozen: {
        expression: 'm.is_frozen',
        dataType: 'boolean',
        requiresMetrics: true,
      },
    };

    const nextParam = createParamNameGenerator('f');
    const compiledFilters: CompiledCondition[] = [];
    if (filtersToApply && typeof filtersToApply === 'object') {
      for (const [field, model] of Object.entries(filtersToApply)) {
        const target = filterTargets[field];
        if (!target) continue;
        if (target.requiresMetrics && !year) continue;
        const condition = compileAgFilterCondition(model, target, nextParam);
        if (condition) compiledFilters.push(condition);
      }
    }

    const quickSearchConditions = q
      ? buildQuickSearchConditions(
          q,
          [
            'd.name',
            'd.description',
            'c.name',
            'CAST(d.status AS TEXT)',
            ...(year ? ['CAST(COALESCE(m.headcount, 0) AS TEXT)'] : []),
          ],
          nextParam,
        )
      : [];

    const applyQuickSearch = (builder: ReturnType<typeof repo.createQueryBuilder>) => {
      if (quickSearchConditions.length === 0) return;
      builder.andWhere(
        new Brackets((sub) => {
          quickSearchConditions.forEach((cond, idx) => {
            if (idx === 0) sub.where(cond.sql, cond.params);
            else sub.orWhere(cond.sql, cond.params);
          });
        }),
      );
    };

    const applyCompiledFilters = (builder: ReturnType<typeof repo.createQueryBuilder>) => {
      compiledFilters.forEach((cond) => builder.andWhere(cond.sql, cond.params));
    };

    const qbBase = repo.createQueryBuilder('d');
    const period = year
      ? {
          start: new Date(`${year}-01-01`),
          end: new Date(`${year}-12-31T23:59:59.999Z`),
        }
      : undefined;
    if (effectiveStatus) {
      applyStatusFilter(qbBase, { alias: 'd', explicitStatus: effectiveStatus, period, includeDisabled, matchNone });
    } else {
      applyStatusFilter(qbBase, { alias: 'd', period, includeDisabled, matchNone });
    }
    qbBase.leftJoin(Company, 'c', 'c.id = d.company_id');
    if (year) {
      qbBase.leftJoin(
        (sub) => sub.from('department_metrics', 'm').where('m.fiscal_year = :year', { year }),
        'm',
        'm.department_id = d.id',
      );
    }
    applyQuickSearch(qbBase);
    applyCompiledFilters(qbBase);
    const total = await qbBase.getCount();

    const qb = repo.createQueryBuilder('d');
    if (effectiveStatus) {
      applyStatusFilter(qb, { alias: 'd', explicitStatus: effectiveStatus, period, includeDisabled, matchNone });
    } else {
      applyStatusFilter(qb, { alias: 'd', period, includeDisabled, matchNone });
    }
    qb.leftJoin(Company, 'c', 'c.id = d.company_id');
    qb.addSelect('c.name', 'company_name');
    if (year) {
      qb.leftJoin(
        (sub) => sub.from('department_metrics', 'm').where('m.fiscal_year = :year', { year }),
        'm',
        'm.department_id = d.id',
      );
      qb.addSelect('m.headcount', 'metrics_headcount');
      qb.addSelect('m.is_frozen', 'metrics_is_frozen');
    }
    applyQuickSearch(qb);
    applyCompiledFilters(qb);

    // Sorting: prefer real department columns; if sorting by derived metrics (when year provided), order by selected alias
    const allowedDeptFields = ['id','company_id','name','description','status','created_at','updated_at'];
    const sortField = sort.field;
    const direction: 'ASC' | 'DESC' = sort.direction as any;
    if (allowedDeptFields.includes(sortField)) {
      qb.orderBy(`d.${sortField}`, direction);
    } else if (sortField === 'company_name') {
      qb.addOrderBy('company_name', direction);
    } else if (year) {
      const metricMap: Record<string, string> = {
        headcount_year: 'metrics_headcount',
        metrics_frozen: 'metrics_is_frozen',
      };
      const alias = metricMap[sortField];
      if (alias) {
        const nullsPlacement = direction === 'DESC' ? 'NULLS LAST' : 'NULLS FIRST';
        qb.addOrderBy(alias, direction, nullsPlacement);
      } else {
        qb.orderBy('d.name', 'ASC');
      }
    } else {
      qb.orderBy('d.name', 'ASC');
    }
    qb.skip(skip).take(limit);

    if (year) {
      const { raw, entities } = await qb.getRawAndEntities();
      const items = entities.map((ent, idx) => {
        const r = (raw[idx] || {}) as any;
        return {
          ...ent,
          company_name: r.company_name || null,
          headcount_year: (r.metrics_headcount != null ? Number(r.metrics_headcount) : 0),
          metrics_frozen: r.metrics_is_frozen ?? false,
        } as any;
      });
      return { items, total, page, limit };
    } else {
      const { raw, entities } = await qb.getRawAndEntities();
      const items = entities.map((ent, idx) => {
        const r = (raw[idx] || {}) as any;
        return {
          ...ent,
          company_name: r.company_name || null,
        } as any;
      });
      return { items: items as any, total, page, limit };
    }
  }

  async get(id: string, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const found = await repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException('Department not found');
    return found;
  }

  async lookup(query: any, opts?: { manager?: EntityManager }): Promise<{ items: DepartmentLookupItem[]; total: number; page: number; limit: number }> {
    const repo = this.getRepo(opts?.manager);
    const page = Math.max(1, Number(query?.page) || 1);
    const limit = Math.min(Math.max(1, Number(query?.limit) || 100), 1000);
    const skip = (page - 1) * limit;
    const q = String(query?.q || '').trim();
    const companyId = String(query?.company_id || query?.companyId || '').trim();

    const qbBase = repo.createQueryBuilder('d').select(['d.id', 'd.name', 'd.company_id']);
    applyStatusFilter(qbBase, { alias: 'd' });
    if (companyId) {
      qbBase.andWhere('d.company_id = :companyId', { companyId });
    }
    if (q) {
      qbBase.andWhere('LOWER(d.name) LIKE :q', { q: `%${q.toLowerCase()}%` });
    }

    const total = await qbBase.getCount();
    const items = await qbBase
      .clone()
      .orderBy('LOWER(d.name)', 'ASC')
      .addOrderBy('d.name', 'ASC')
      .skip(skip)
      .take(limit)
      .getMany();

    return {
      items: items.map((department) => ({
        id: department.id,
        name: department.name,
        company_id: department.company_id,
      })),
      total,
      page,
      limit,
    };
  }

  async lookupById(id: string, opts?: { manager?: EntityManager }): Promise<DepartmentLookupItem> {
    const repo = this.getRepo(opts?.manager);
    const found = await repo
      .createQueryBuilder('d')
      .select(['d.id', 'd.name', 'd.company_id'])
      .where('d.id = :id', { id })
      .getOne();
    if (!found) throw new NotFoundException('Department not found');
    return { id: found.id, name: found.name, company_id: found.company_id };
  }

  async create(body: DepartmentUpsertDto, userId?: string, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const repo = this.getRepo(opts?.manager);
    const compRepo = this.getCompanyRepo(opts?.manager);
    if (!body.company_id) throw new BadRequestException('company_id is required');
    if (!body.name) throw new BadRequestException('name is required');
    const comp = await compRepo.findOne({ where: { id: body.company_id as string } });
    if (!comp) throw new BadRequestException('company_id is invalid');
    const { status: statusInput, disabled_at, ...rest } = body ?? {};
    const lifecycle = resolveLifecycleState({ nextStatus: statusInput, nextDisabledAt: disabled_at });
    const entity = repo.create({
      ...rest,
      // These columns are NOT NULL on the entity while the DTO allows null
      company_id: rest.company_id ?? undefined,
      name: rest.name ?? undefined,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    });
    let saved: Department;
    try {
      saved = await repo.save(entity);
    } catch (err: any) {
      if (err && (err.code === '23505' || /unique/i.test(String(err.detail || err.message || '')))) {
        throw new BadRequestException('A department with this name already exists in the selected company.');
      }
      throw err;
    }
    await this.audit.log(
      {
        table: 'departments',
        recordId: saved.id,
        action: 'create',
        before: null,
        after: saved,
        userId,
        source: opts?.audit?.source,
        sourceRef: opts?.audit?.sourceRef ?? null,
      },
      { manager: opts?.manager ?? repo.manager },
    );
    return saved;
  }

  async update(id: string, body: DepartmentUpsertDto, userId?: string, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const repo = this.getRepo(opts?.manager);
    const compRepo = this.getCompanyRepo(opts?.manager);
    const existing = await this.get(id, { manager: opts?.manager });
    if (body.company_id && body.company_id !== existing.company_id) {
      const comp = await compRepo.findOne({ where: { id: body.company_id as string } });
      if (!comp) throw new BadRequestException('company_id is invalid');
    }
    const before = { ...existing };
    const { status: statusInput, disabled_at, ...rest } = body ?? {};
    Object.assign(existing, rest);
    const lifecycle = resolveLifecycleState({
      currentDisabledAt: before.disabled_at,
      nextStatus: statusInput,
      nextDisabledAt: disabled_at,
    });
    existing.status = lifecycle.status;
    existing.disabled_at = lifecycle.disabled_at;
    let saved: Department;
    try {
      saved = await repo.save(existing);
    } catch (err: any) {
      if (err && (err.code === '23505' || /unique/i.test(String(err.detail || err.message || '')))) {
        throw new BadRequestException('A department with this name already exists in the selected company.');
      }
      throw err;
    }
    await this.audit.log(
      {
        table: 'departments',
        recordId: saved.id,
        action: 'update',
        before,
        after: saved,
        userId,
        source: opts?.audit?.source,
        sourceRef: opts?.audit?.sourceRef ?? null,
      },
      { manager: opts?.manager ?? repo.manager },
    );
    return saved;
  }

  async listIds(query: any, opts?: { manager?: EntityManager }): Promise<{ ids: string[]; total: number }> {
    const repo = this.getRepo(opts?.manager);
    const parsed = parsePagination({ ...query, page: 1, limit: query?.limit ?? 10000 });
    const { sort, status, q, filters } = parsed;
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = sanitizedFilters ?? filters;
    const effectiveStatus = status ?? statusFromAg;
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';
    const year = query?.year ? Number(query.year) : undefined;

    type DepartmentFilterTarget = FilterTargetConfig & { requiresMetrics?: boolean };
    const filterTargets: Record<string, DepartmentFilterTarget> = {
      id: { expression: 'd.id', dataType: 'string' },
      company_id: { expression: 'd.company_id', dataType: 'string' },
      name: { expression: 'd.name', dataType: 'string' },
      description: { expression: 'd.description', dataType: 'string' },
      status: { expression: 'd.status', textExpression: 'CAST(d.status AS TEXT)', dataType: 'string' },
      company_name: { expression: 'c.name', dataType: 'string' },
      created_at: {
        expression: 'd.created_at',
        textExpression: 'CAST(d.created_at AS TEXT)',
        dataType: 'string',
      },
      updated_at: {
        expression: 'd.updated_at',
        textExpression: 'CAST(d.updated_at AS TEXT)',
        dataType: 'string',
      },
      headcount_year: {
        expression: 'm.headcount',
        numericExpression: 'COALESCE(m.headcount, 0)',
        textExpression: 'CAST(COALESCE(m.headcount, 0) AS TEXT)',
        dataType: 'number',
        requiresMetrics: true,
      },
      metrics_frozen: {
        expression: 'm.is_frozen',
        dataType: 'boolean',
        requiresMetrics: true,
      },
    };

    const nextParam = createParamNameGenerator('f');
    const compiledFilters: CompiledCondition[] = [];
    if (filtersToApply && typeof filtersToApply === 'object') {
      for (const [field, model] of Object.entries(filtersToApply)) {
        const target = filterTargets[field];
        if (!target) continue;
        if (target.requiresMetrics && !year) continue;
        const condition = compileAgFilterCondition(model, target, nextParam);
        if (condition) compiledFilters.push(condition);
      }
    }

    const quickSearchConditions = q
      ? buildQuickSearchConditions(
          q,
          [
            'd.name',
            'd.description',
            'c.name',
            'CAST(d.status AS TEXT)',
            ...(year ? ['CAST(COALESCE(m.headcount, 0) AS TEXT)'] : []),
          ],
          nextParam,
        )
      : [];

    const qb = repo.createQueryBuilder('d').select('d.id', 'id');
    qb.leftJoin(Company, 'c', 'c.id = d.company_id');
    const period = year
      ? {
          start: new Date(`${year}-01-01`),
          end: new Date(`${year}-12-31T23:59:59.999Z`),
        }
      : undefined;
    if (effectiveStatus) {
      applyStatusFilter(qb, { alias: 'd', explicitStatus: effectiveStatus, period, includeDisabled, matchNone });
    } else {
      applyStatusFilter(qb, { alias: 'd', period, includeDisabled, matchNone });
    }
    if (year) {
      qb.leftJoin(
        (sub) => sub.from('department_metrics', 'm').where('m.fiscal_year = :year', { year }),
        'm',
        'm.department_id = d.id',
      );
      qb.addSelect('COALESCE(m.headcount, 0)', 'headcount_sort');
      qb.addSelect('COALESCE(m.is_frozen, false)', 'is_frozen_sort');
    }

    if (quickSearchConditions.length > 0) {
      qb.andWhere(new Brackets((sub) => {
        quickSearchConditions.forEach((cond, idx) => {
          if (idx === 0) sub.where(cond.sql, cond.params);
          else sub.orWhere(cond.sql, cond.params);
        });
      }));
    }
    compiledFilters.forEach((cond) => qb.andWhere(cond.sql, cond.params));

    // Sorting: prefer real department/company columns; if sorting by derived metrics (when year provided), use aliases
    const allowedFields = ['id','name','description','status','created_at','updated_at','company_name'];
    const sortField = sort.field;
    const direction: 'ASC' | 'DESC' = sort.direction as any;
    if (allowedFields.includes(sortField)) {
      if (sortField === 'company_name') qb.orderBy('c.name', direction);
      else qb.orderBy(`d.${sortField}`, direction);
    } else if (year) {
      const metricMap: Record<string, string> = {
        headcount_year: 'headcount_sort',
        metrics_frozen: 'is_frozen_sort',
      };
      const alias = metricMap[sortField];
      if (alias) qb.addOrderBy(alias, direction);
      else qb.orderBy('d.name', 'ASC');
    } else {
      qb.orderBy('d.name', 'ASC');
    }

    const total = await qb.clone().getCount();
    const limit = Math.min(Number(query?.limit) || 10000, 10000);
    const rows = await qb.take(limit).getRawMany();
    const ids = rows.map((r: any) => String(r.id ?? r.d_id ?? r["d_id"])) as string[];
    return { ids, total };
  }

  async listFilterValues(query: any, opts?: { manager?: EntityManager }): Promise<Record<string, Array<string | null>>> {
    const rawFields = String(query?.fields || query?.field || '')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
    const allowed = new Set(['company_name']);
    const fields = rawFields.filter((field) => allowed.has(field));
    if (fields.length === 0) return {};

    const parseFilters = (value: any): Record<string, any> => {
      if (!value) return {};
      if (typeof value === 'string') {
        try {
          return JSON.parse(value);
        } catch {
          return {};
        }
      }
      return typeof value === 'object' ? { ...value } : {};
    };

    const baseFilters = parseFilters(query?.filters);
    const results: Record<string, Array<string | null>> = {};

    for (const field of fields) {
      const filtersForField = { ...baseFilters };
      delete filtersForField[field];
      const result = await this.list(
        { ...query, page: 1, limit: 10000, filters: filtersForField, sort: 'name:ASC' },
        { ...opts, exportAll: true },
      );
      const values = new Set<string | null>();
      for (const item of result.items || []) {
        const rawValue = (item as any)?.[field];
        values.add(rawValue == null || rawValue === '' ? null : String(rawValue));
      }
      results[field] = Array.from(values).sort((a, b) => {
        if (a == null) return 1;
        if (b == null) return -1;
        return a.localeCompare(b);
      });
    }

    return results;
  }

  private csvHeaders(): string[] {
    return ['company_name', 'name', 'description', 'status', 'disabled_at'];
  }

  async exportCsv(scope: 'template' | 'data' = 'data', opts?: { manager?: EntityManager }): Promise<{ filename: string; content: string }> {
    const headers = this.csvHeaders();
    const delimiter = ';';
    const rows: any[] = [];
    if (scope === 'data') {
      const repo = this.getRepo(opts?.manager);
      const items = await repo.createQueryBuilder('d')
        .leftJoin(Company, 'c', 'c.id = d.company_id')
        .select(['d.id', 'd.name', 'd.description', 'd.status', 'd.disabled_at', 'c.name AS company_name'])
        .orderBy('d.created_at', 'DESC')
        .getRawMany();
      for (const r of items) {
        rows.push({
          company_name: r.company_name ?? '',
          name: r.d_name ?? r.name ?? '',
          description: r.d_description ?? r.description ?? '',
          // Read from the end of validity: a stored status left stale by a passed date never contradicts its own row.
          status: deriveStatusFromDisabledAt(r.d_disabled_at ?? null),
          disabled_at: r.d_disabled_at ? new Date(r.d_disabled_at).toISOString() : '',
        });
      }
    }
    const filename = scope === 'template' ? 'departments_template.csv' : 'departments.csv';
    const chunks: string[] = [];
    await new Promise<void>((resolve, reject) => {
      const stream = format({ headers, delimiter, transform: neutralizeCsvRow });
      stream.on('data', (chunk) => chunks.push(chunk.toString('utf8')));
      stream.on('end', () => resolve());
      stream.on('error', (err) => reject(err));
      if (scope === 'template') {
        const headerLine = headers.join(delimiter) + '\n';
        chunks.push(headerLine);
        stream.end();
      } else {
        for (const row of rows) stream.write(row);
        stream.end();
      }
    });
    const content = '\ufeff' + chunks.join('');
    return { filename, content };
  }

  async importCsv(
    { file, dryRun, userId }: { file: Express.Multer.File; dryRun: boolean; userId?: string | null },
    opts?: { manager?: EntityManager },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const delimiter = ';';
    const expectedHeaders = this.csvHeaders();
    type Row = Record<string, string>;
    const rows: Row[] = [];
    const errors: { row: number; message: string }[] = [];
    let headerOk = false;
    let content = '';
    await new Promise<void>((resolve, reject) => {
      const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : undefined);
      if (!buf) {
        reject(new BadRequestException('Empty upload'));
        return;
      }
      try {
        content = decodeCsvBufferUtf8OrThrow(buf as Buffer);
      } catch {
        reject(new BadRequestException('Invalid file encoding. Please export or save the CSV as UTF-8 (CSV UTF-8) and use semicolons as separators.'));
        return;
      }
      parseString(content, { headers: true, delimiter, ignoreEmpty: true, trim: true })
        .on('headers', (headers: string[]) => {
          const missing = expectedHeaders.filter((h) => !headers.includes(h));
          const extras = headers.filter((h) => !expectedHeaders.includes(h));
          headerOk = missing.length === 0 && extras.length === 0;
          if (!headerOk) {
            errors.push({ row: 0, message: `Header mismatch. Missing: ${missing.join(', ') || '-'}, Extra: ${extras.join(', ') || '-'}` });
          }
        })
        .on('error', (err) => reject(err))
        .on('data', (row: Row) => rows.push(denormalizeCsvRow(row)))
        .on('end', () => resolve());
    });
    if (!headerOk) {
      return { ok: false, dryRun, total: 0, inserted: 0, updated: 0, errors };
    }
    // Errors name the file's own line, blank lines included.
    const rowLines = await csvDataRowLines(content, delimiter);
    // Lookup companies by name once
    const repo = this.getRepo(opts?.manager);
    const companyRepo = this.getCompanyRepo(opts?.manager);
    const companyCache = new Map<string, Company | null>();
    const findCompanyByName = async (name: string): Promise<Company | null> => {
      const key = name.toLowerCase();
      if (companyCache.has(key)) return companyCache.get(key) ?? null;
      const c = await companyRepo.findOne({ where: { name } });
      companyCache.set(key, c ?? null);
      return c ?? null;
    };
    // Validate and normalize rows
    const normalized: Array<DepartmentUpsertDto & { company_id: string; name: string; lifecycle: { status: StatusState | null; disabled_at: string | null } }> = [];
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const line = rowLine(rowLines, i);
      const company_name = (r['company_name'] ?? '').toString().trim();
      const name = (r['name'] ?? '').toString().trim();
      // Blank: enabled for a new department, the stored status on an update (`csvItemLifecycle`).
      const statusRaw = (r['status'] ?? '').toString().trim().toLowerCase();
      const statusValue: StatusState | null = statusRaw
        ? (STATUS_STATES.find((s) => s === statusRaw) ?? null)
        : null;
      const disabledAtRaw = (r['disabled_at'] ?? '').toString().trim();
      let disabled_at_iso: string | null = null;
      if (!company_name) errors.push({ row: line, message: 'company_name is required' });
      if (!name) errors.push({ row: line, message: 'name is required' });
      if (statusRaw && !statusValue) {
        errors.push({ row: line, message: `Invalid status '${statusRaw}'. Use 'enabled' or 'disabled'.` });
        continue;
      }
      if (disabledAtRaw) {
        const parsed = new Date(disabledAtRaw);
        if (Number.isNaN(parsed.getTime())) {
          errors.push({ row: line, message: `Invalid disabled_at '${disabledAtRaw}'. Use ISO 8601 format.` });
          continue;
        }
        disabled_at_iso = parsed.toISOString();
      }
      const lifecycleConflict = csvLifecycleConflict(statusValue, disabled_at_iso);
      if (lifecycleConflict) {
        errors.push({ row: line, message: lifecycleConflict });
        continue;
      }
      if (company_name) {
        const comp = await findCompanyByName(company_name);
        if (!comp) errors.push({ row: line, message: `Unknown company '${company_name}'` });
        else {
          normalized.push({
            company_id: comp.id,
            name,
            description: ((r['description'] ?? '').toString().trim()) || null,
            lifecycle: { status: statusValue, disabled_at: disabled_at_iso },
          });
        }
      }
    }
    if (errors.length > 0) {
      return { ok: false, dryRun, total: rows.length, inserted: 0, updated: 0, errors };
    }
    // Deduplicate by combination of company_id + name (case-insensitive on name)
    const uniqueMap = new Map<string, (typeof normalized)[number]>();
    for (const item of normalized) {
      const key = `${item.company_id}|${item.name.toLowerCase()}`;
      if (!uniqueMap.has(key)) uniqueMap.set(key, item);
    }
    const unique = Array.from(uniqueMap.values());
    // Count inserts/updates by unique key
    let inserted = 0;
    let updated = 0;
    for (const item of unique) {
      const existing = await repo.findOne({ where: { company_id: item.company_id as string, name: item.name as string } });
      if (existing) updated += 1; else inserted += 1;
    }
    if (dryRun) {
      return { ok: true, dryRun: true, total: rows.length, inserted, updated, errors: [] };
    }
    // Commit
    let processed = 0;
    for (const item of unique) {
      const existing = await repo.findOne({ where: { company_id: item.company_id as string, name: item.name as string } });
      // A blank status or date keeps the stored value on an update; `update`/`create` resolve the rest.
      const { lifecycle, ...values } = item;
      const body: DepartmentUpsertDto = { ...values, ...csvItemLifecycle(lifecycle.status, lifecycle.disabled_at, !!existing) };
      if (existing) {
        const saved = await this.update(existing.id, body, userId ?? undefined, { manager: opts?.manager });
        if (saved) processed += 1;
      } else {
        const saved = await this.create(body, userId ?? undefined, { manager: opts?.manager });
        if (saved) processed += 1;
      }
    }
    return { ok: true, dryRun: false, total: rows.length, inserted, updated, processed, errors: [] };
  }
}
