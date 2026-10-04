import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, Repository } from 'typeorm';
import { Company } from './company.entity';
import { ChartOfAccounts } from '../accounts/chart-of-accounts.entity';
import { parseExportPagination, parsePagination } from '../common/pagination';
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
import * as fs from 'fs';
import { CompanyMetricsService } from './company-metrics.service';
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
import { CompanyUpsertDto } from './dto/company.dto';
import { createCompanyStandardCalendar } from '../working-day-profiles/company-standard-calendar';
import {
  cellOf,
  CsvDateOrder,
  CsvLanguage,
  DecimalMark,
  endOfValidityOf,
  formatCsvAmount,
  formatCsvEndOfValidity,
  readMasterDataFile,
  rowProblems,
  writeCsv,
} from '../common/csv-sheet';

type CompanyFilterTarget = FilterTargetConfig & { requiresMetrics?: boolean };
type CompanyLookupItem = { id: string; name: string };

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company) private readonly repo: Repository<Company>,
    private readonly audit: AuditService,
    private readonly companyMetrics: CompanyMetricsService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(Company) : this.repo;
  }

  private normalizeYear(year?: number): number {
    const fallback = new Date().getFullYear();
    if (year == null) return fallback;
    const num = Number(year);
    if (!Number.isFinite(num)) return fallback;
    const intYear = Math.trunc(num);
    if (intYear < 1900 || intYear > 3000) return fallback;
    return intYear;
  }

  private metricYears(baseYear?: number): number[] {
    const normalized = this.normalizeYear(baseYear);
    return [normalized - 1, normalized, normalized + 1];
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

    const filterTargets: Record<string, CompanyFilterTarget> = {
      id: { expression: 'c.id', dataType: 'string' },
      name: { expression: 'c.name', dataType: 'string' },
      country_iso: { expression: 'c.country_iso', dataType: 'string' },
      city: { expression: 'c.city', dataType: 'string' },
      postal_code: { expression: 'c.postal_code', dataType: 'string' },
      address1: { expression: 'c.address1', dataType: 'string' },
      address2: { expression: 'c.address2', dataType: 'string' },
      state: { expression: 'c.state', dataType: 'string' },
      notes: { expression: 'c.notes', dataType: 'string' },
      reg_number: { expression: 'c.reg_number', dataType: 'string' },
      vat_number: { expression: 'c.vat_number', dataType: 'string' },
      base_currency: { expression: 'c.base_currency', dataType: 'string' },
      status: { expression: 'c.status', textExpression: 'CAST(c.status AS TEXT)', dataType: 'string' },
      created_at: {
        expression: 'c.created_at',
        textExpression: 'CAST(c.created_at AS TEXT)',
        dataType: 'string',
      },
      updated_at: {
        expression: 'c.updated_at',
        textExpression: 'CAST(c.updated_at AS TEXT)',
        dataType: 'string',
      },
      headcount_year: {
        expression: 'm.headcount',
        numericExpression: 'COALESCE(m.headcount, 0)',
        textExpression: 'CAST(COALESCE(m.headcount, 0) AS TEXT)',
        dataType: 'number',
        requiresMetrics: true,
      },
      it_users_year: {
        expression: 'm.it_users',
        numericExpression: 'COALESCE(m.it_users, 0)',
        textExpression: 'CAST(COALESCE(m.it_users, 0) AS TEXT)',
        dataType: 'number',
        requiresMetrics: true,
      },
      turnover_year: {
        expression: 'm.turnover',
        numericExpression: 'COALESCE(m.turnover, 0)',
        textExpression: 'CAST(COALESCE(m.turnover, 0) AS TEXT)',
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
            'c.name',
            'c.country_iso',
            'c.city',
            'c.postal_code',
            'c.address1',
            'c.address2',
            'c.state',
            'c.notes',
            'c.reg_number',
            'c.vat_number',
            'c.base_currency',
            'CAST(c.status AS TEXT)',
            ...(year
              ? [
                  'CAST(COALESCE(m.headcount, 0) AS TEXT)',
                  'CAST(COALESCE(m.it_users, 0) AS TEXT)',
                  'CAST(COALESCE(m.turnover, 0) AS TEXT)',
                ]
              : []),
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

    const qbBase = repo.createQueryBuilder('c');
    const period = year
      ? {
          start: new Date(`${year}-01-01`),
          end: new Date(`${year}-12-31T23:59:59.999Z`),
        }
      : undefined;
    if (effectiveStatus) {
      applyStatusFilter(qbBase, { alias: 'c', explicitStatus: effectiveStatus, period, includeDisabled, matchNone });
    } else {
      applyStatusFilter(qbBase, { alias: 'c', period, includeDisabled, matchNone });
    }
    if (year) {
      qbBase.leftJoin(
        (sub) => sub.from('company_metrics', 'm').where('m.fiscal_year = :year', { year }),
        'm',
        'm.company_id = c.id',
      );
    }
    applyQuickSearch(qbBase);
    applyCompiledFilters(qbBase);
    const total = await qbBase.getCount();

    const qb = repo.createQueryBuilder('c');
    if (effectiveStatus) {
      applyStatusFilter(qb, { alias: 'c', explicitStatus: effectiveStatus, period, includeDisabled, matchNone });
    } else {
      applyStatusFilter(qb, { alias: 'c', period, includeDisabled, matchNone });
    }
    if (year) {
      qb.leftJoin(
        (sub) => sub.from('company_metrics', 'm').where('m.fiscal_year = :year', { year }),
        'm',
        'm.company_id = c.id',
      );
      qb.addSelect('m.headcount', 'metrics_headcount');
      qb.addSelect('m.it_users', 'metrics_it_users');
      qb.addSelect('m.turnover', 'metrics_turnover');
      qb.addSelect('m.is_frozen', 'metrics_is_frozen');

      qb.addSelect('COALESCE(m.headcount, 0)', 'headcount_sort');
      qb.addSelect('COALESCE(m.it_users, 0)', 'it_users_sort');
      qb.addSelect('COALESCE(m.turnover, 0)', 'turnover_sort');
      qb.addSelect('COALESCE(m.is_frozen, false)', 'is_frozen_sort');
    }
    applyQuickSearch(qb);
    applyCompiledFilters(qb);

    // Sorting: prefer real company columns; if sorting by derived metrics (when year provided), order by selected alias
    const allowedCompanyFields = ['id','name','country_iso','city','postal_code','address1','address2','state','notes','reg_number','vat_number','base_currency','status','created_at','updated_at'];
    const sortField = sort.field;
    const direction: 'ASC' | 'DESC' = sort.direction as any;
    if (allowedCompanyFields.includes(sortField)) {
      qb.orderBy(`c.${sortField}`, direction);
    } else if (year) {
      const metricMap: Record<string, string> = {
        headcount_year: 'headcount_sort',
        it_users_year: 'it_users_sort',
        turnover_year: 'turnover_sort',
        metrics_frozen: 'is_frozen_sort',
      };
      const alias = metricMap[sortField];
      if (alias) {
        qb.addOrderBy(alias, direction);
      } else {
        qb.orderBy('c.name', 'ASC');
      }
    } else {
      qb.orderBy('c.name', 'ASC');
    }
    qb.skip(skip).take(limit);

    if (year) {
      const { raw, entities } = await qb.getRawAndEntities();
      const items = entities.map((ent, idx) => {
        const r = (raw[idx] || {}) as any;
        return {
          ...ent,
          headcount_year: (r.metrics_headcount != null ? Number(r.metrics_headcount) : 0),
          it_users_year: (r.metrics_it_users != null ? Number(r.metrics_it_users) : 0),
          turnover_year: (r.metrics_turnover != null ? Number(r.metrics_turnover) : 0),
          metrics_frozen: r.metrics_is_frozen ?? false,
        } as any;
      });
      return { items, total, page, limit };
    } else {
      const items = await qb.getMany();
      return { items: items as any, total, page, limit };
    }
  }

  async lookupById(id: string, opts?: { manager?: EntityManager }): Promise<CompanyLookupItem> {
    const repo = this.getRepo(opts?.manager);
    const found = await repo
      .createQueryBuilder('c')
      .select(['c.id', 'c.name'])
      .where('c.id = :id', { id })
      .getOne();
    if (!found) throw new NotFoundException('Company not found');
    return { id: found.id, name: found.name };
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

    const filterTargets: Record<string, CompanyFilterTarget> = {
      id: { expression: 'c.id', dataType: 'string' },
      name: { expression: 'c.name', dataType: 'string' },
      country_iso: { expression: 'c.country_iso', dataType: 'string' },
      city: { expression: 'c.city', dataType: 'string' },
      postal_code: { expression: 'c.postal_code', dataType: 'string' },
      address1: { expression: 'c.address1', dataType: 'string' },
      address2: { expression: 'c.address2', dataType: 'string' },
      state: { expression: 'c.state', dataType: 'string' },
      notes: { expression: 'c.notes', dataType: 'string' },
      reg_number: { expression: 'c.reg_number', dataType: 'string' },
      vat_number: { expression: 'c.vat_number', dataType: 'string' },
      base_currency: { expression: 'c.base_currency', dataType: 'string' },
      status: { expression: 'c.status', textExpression: 'CAST(c.status AS TEXT)', dataType: 'string' },
      created_at: {
        expression: 'c.created_at',
        textExpression: 'CAST(c.created_at AS TEXT)',
        dataType: 'string',
      },
      updated_at: {
        expression: 'c.updated_at',
        textExpression: 'CAST(c.updated_at AS TEXT)',
        dataType: 'string',
      },
      headcount_year: {
        expression: 'm.headcount',
        numericExpression: 'COALESCE(m.headcount, 0)',
        textExpression: 'CAST(COALESCE(m.headcount, 0) AS TEXT)',
        dataType: 'number',
        requiresMetrics: true,
      },
      it_users_year: {
        expression: 'm.it_users',
        numericExpression: 'COALESCE(m.it_users, 0)',
        textExpression: 'CAST(COALESCE(m.it_users, 0) AS TEXT)',
        dataType: 'number',
        requiresMetrics: true,
      },
      turnover_year: {
        expression: 'm.turnover',
        numericExpression: 'COALESCE(m.turnover, 0)',
        textExpression: 'CAST(COALESCE(m.turnover, 0) AS TEXT)',
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
            'c.name',
            'c.country_iso',
            'c.city',
            'c.postal_code',
            'c.address1',
            'c.address2',
            'c.state',
            'c.notes',
            'c.reg_number',
            'c.vat_number',
            'c.base_currency',
            'CAST(c.status AS TEXT)',
            ...(year
              ? [
                  'CAST(COALESCE(m.headcount, 0) AS TEXT)',
                  'CAST(COALESCE(m.it_users, 0) AS TEXT)',
                  'CAST(COALESCE(m.turnover, 0) AS TEXT)',
                ]
              : []),
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

    const qb = repo.createQueryBuilder('c').select('c.id', 'id');
    const period = year
      ? {
          start: new Date(`${year}-01-01`),
          end: new Date(`${year}-12-31T23:59:59.999Z`),
        }
      : undefined;
    if (effectiveStatus) {
      applyStatusFilter(qb, { alias: 'c', explicitStatus: effectiveStatus, period, includeDisabled, matchNone });
    } else {
      applyStatusFilter(qb, { alias: 'c', period, includeDisabled, matchNone });
    }
    if (year) {
      qb.leftJoin(
        (sub) => sub.from('company_metrics', 'm').where('m.fiscal_year = :year', { year }),
        'm',
        'm.company_id = c.id',
      );
      qb.addSelect('COALESCE(m.headcount, 0)', 'headcount_sort');
      qb.addSelect('COALESCE(m.it_users, 0)', 'it_users_sort');
      qb.addSelect('COALESCE(m.turnover, 0)', 'turnover_sort');
      qb.addSelect('COALESCE(m.is_frozen, false)', 'is_frozen_sort');
    }
    applyQuickSearch(qb);
    applyCompiledFilters(qb);

    const allowedCompanyFields = ['id','name','country_iso','city','postal_code','address1','address2','state','notes','reg_number','vat_number','base_currency','status','created_at','updated_at'];
    const sortField = sort.field;
    const direction: 'ASC' | 'DESC' = sort.direction as any;
    if (allowedCompanyFields.includes(sortField)) {
      qb.orderBy(`c.${sortField}`, direction);
    } else if (year) {
      const metricMap: Record<string, string> = {
        headcount_year: 'headcount_sort',
        it_users_year: 'it_users_sort',
        turnover_year: 'turnover_sort',
        metrics_frozen: 'is_frozen_sort',
      };
      const alias = metricMap[sortField];
      if (alias) qb.addOrderBy(alias, direction);
      else qb.orderBy('c.name', 'ASC');
    } else {
      qb.orderBy('c.name', 'ASC');
    }

    const total = await qb.clone().getCount();
    const limit = Math.min(Number(query?.limit) || 10000, 10000);
    const rows = await qb.take(limit).getRawMany();
    const ids = rows.map((r: any) => r.id as string).filter((v) => !!v);
    return { ids, total };
  }

  async listFilterValues(query: any, opts?: { manager?: EntityManager }): Promise<Record<string, Array<string | null>>> {
    const rawFields = String(query?.fields || query?.field || '')
      .split(',')
      .map((field) => field.trim())
      .filter(Boolean);
    const allowed = new Set(['country_iso', 'city', 'state', 'base_currency']);
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

  async totals(query: any, opts?: { manager?: EntityManager }): Promise<{ headcount: number; it_users: number; turnover: number; year: number }> {
    const repo = this.getRepo(opts?.manager);
    const parsed = parsePagination({ ...query, page: 1, limit: 10000 });
    const { status, q, filters } = parsed;
    const { status: statusFromAg, matchNone, sanitizedFilters } = extractStatusFilterFromAgModel(filters);
    const filtersToApply = sanitizedFilters ?? filters;
    const effectiveStatus = status ?? statusFromAg ?? null;
    const includeDisabled =
      String(query.includeDisabled ?? '').toLowerCase() === '1' ||
      String(query.includeDisabled ?? '').toLowerCase() === 'true';
    const inputYear = query?.year ? Number(query.year) : undefined;
    const year = this.normalizeYear(inputYear);

    // Reuse the same filter targets used by list/listIds so filters/search match the grid
    const filterTargets: Record<string, CompanyFilterTarget> = {
      id: { expression: 'c.id', dataType: 'string' },
      name: { expression: 'c.name', dataType: 'string' },
      country_iso: { expression: 'c.country_iso', dataType: 'string' },
      city: { expression: 'c.city', dataType: 'string' },
      postal_code: { expression: 'c.postal_code', dataType: 'string' },
      address1: { expression: 'c.address1', dataType: 'string' },
      address2: { expression: 'c.address2', dataType: 'string' },
      state: { expression: 'c.state', dataType: 'string' },
      notes: { expression: 'c.notes', dataType: 'string' },
      reg_number: { expression: 'c.reg_number', dataType: 'string' },
      vat_number: { expression: 'c.vat_number', dataType: 'string' },
      base_currency: { expression: 'c.base_currency', dataType: 'string' },
      status: { expression: 'c.status', textExpression: 'CAST(c.status AS TEXT)', dataType: 'string' },
      created_at: { expression: 'c.created_at', textExpression: 'CAST(c.created_at AS TEXT)', dataType: 'string' },
      updated_at: { expression: 'c.updated_at', textExpression: 'CAST(c.updated_at AS TEXT)', dataType: 'string' },
      headcount_year: {
        expression: 'm.headcount',
        numericExpression: 'COALESCE(m.headcount, 0)',
        textExpression: 'CAST(COALESCE(m.headcount, 0) AS TEXT)',
        dataType: 'number',
        requiresMetrics: true,
      },
      it_users_year: {
        expression: 'm.it_users',
        numericExpression: 'COALESCE(m.it_users, 0)',
        textExpression: 'CAST(COALESCE(m.it_users, 0) AS TEXT)',
        dataType: 'number',
        requiresMetrics: true,
      },
      turnover_year: {
        expression: 'm.turnover',
        numericExpression: 'COALESCE(m.turnover, 0)',
        textExpression: 'CAST(COALESCE(m.turnover, 0) AS TEXT)',
        dataType: 'number',
        requiresMetrics: true,
      },
      metrics_frozen: { expression: 'm.is_frozen', dataType: 'boolean', requiresMetrics: true },
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
            'c.name',
            'c.country_iso',
            'c.city',
            'c.postal_code',
            'c.address1',
            'c.address2',
            'c.state',
            'c.notes',
            'c.reg_number',
            'c.vat_number',
            'c.base_currency',
            'CAST(c.status AS TEXT)',
            'CAST(COALESCE(m.headcount, 0) AS TEXT)',
            'CAST(COALESCE(m.it_users, 0) AS TEXT)',
            'CAST(COALESCE(m.turnover, 0) AS TEXT)',
          ],
          nextParam,
        )
      : [];

    const qb = repo
      .createQueryBuilder('c')
      .select('SUM(COALESCE(m.headcount, 0))', 'headcount')
      .addSelect('SUM(COALESCE(m.it_users, 0))', 'it_users')
      .addSelect('SUM(COALESCE(m.turnover, 0))', 'turnover');

    // Apply lifecycle status for the year window
    const period = {
      start: new Date(`${year}-01-01`),
      end: new Date(`${year}-12-31T23:59:59.999Z`),
    };
    if (effectiveStatus) {
      applyStatusFilter(qb, { alias: 'c', explicitStatus: effectiveStatus, period, includeDisabled, matchNone });
    } else {
      applyStatusFilter(qb, { alias: 'c', period, includeDisabled, matchNone });
    }

    // Join metrics for the selected fiscal year
    qb.leftJoin(
      (sub) => sub.from('company_metrics', 'm').where('m.fiscal_year = :year', { year }),
      'm',
      'm.company_id = c.id',
    );

    // Apply search and filters
    if (quickSearchConditions.length > 0) {
      qb.andWhere(
        new Brackets((expr) => {
          quickSearchConditions.forEach((cond, idx) => {
            if (idx === 0) expr.where(cond.sql, cond.params);
            else expr.orWhere(cond.sql, cond.params);
          });
        }),
      );
    }
    compiledFilters.forEach((cond) => qb.andWhere(cond.sql, cond.params));

    const raw = (await qb.getRawOne()) as { headcount?: any; it_users?: any; turnover?: any } | undefined;
    const toNum = (v: any) => {
      const n = Number(v ?? 0);
      return Number.isFinite(n) ? n : 0;
    };
    const round3 = (n: number) => Math.round(n * 1000) / 1000;
    const headcount = Math.round(toNum(raw?.headcount));
    const it_users = Math.round(toNum(raw?.it_users));
    const turnover = round3(toNum(raw?.turnover));

    return { headcount, it_users, turnover, year };
  }

  async get(id: string, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const found = await repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException('Company not found');
    return found;
  }

  async create(body: CompanyUpsertDto, userId?: string, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const repo = this.getRepo(opts?.manager);
    const { status: statusInput, disabled_at, ...rest } = body ?? {};
    const lifecycle = resolveLifecycleState({ nextStatus: statusInput, nextDisabledAt: disabled_at });
    const entity = repo.create({
      ...rest,
      // These columns are NOT NULL on the entity while the DTO allows null
      name: rest.name ?? undefined,
      country_iso: rest.country_iso ?? undefined,
      city: rest.city ?? undefined,
      status: lifecycle.status,
      disabled_at: lifecycle.disabled_at,
    });
    // Auto-assign CoA based on country default when available
    try {
      if (!entity.coa_id && entity.country_iso) {
        const manager = opts?.manager ?? repo.manager;
        const coaRepo = manager.getRepository(ChartOfAccounts);
        let coa = await coaRepo.findOne({ where: { country_iso: entity.country_iso, scope: 'COUNTRY', is_default: true } as any });
        if (!coa) {
          coa = await coaRepo.findOne({ where: { scope: 'GLOBAL', is_global_default: true } as any });
        }
        if (coa) entity.coa_id = coa.id;
        else console.warn(`[companies] No default CoA found for country ${entity.country_iso}, and no global default set`);
      }
    } catch (e) {
      console.warn('[companies] CoA auto-assign skipped:', (e as Error)?.message);
    }
    const saved = await repo.save(entity);
    await this.audit.log(
      {
        table: 'companies',
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
    // The standard working-day calendar of the company's country, when the tenant has none yet. Never throws.
    await createCompanyStandardCalendar({
      manager: opts?.manager ?? repo.manager,
      company: saved,
      userId: userId ?? null,
      audit: this.audit,
      auditSource: opts?.audit,
    });
    return saved;
  }

  async update(id: string, body: CompanyUpsertDto, userId?: string, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const repo = this.getRepo(opts?.manager);
    const existing = await this.get(id, { manager: opts?.manager });
    const before = { ...existing };
    const { status: statusInput, disabled_at, ...rest } = body ?? {};
    Object.assign(existing, rest);
    // Auto-assign or adjust CoA when country changes or missing
    try {
      // Respect explicit coa_id if provided; otherwise auto-assign by country default when missing or when country changed
      if ((rest as any)?.coa_id) {
        existing.coa_id = (rest as any).coa_id;
      }
      const nextCountry = (rest as any)?.country_iso ?? existing.country_iso;
      if (!existing.coa_id && nextCountry) {
        const manager = opts?.manager ?? repo.manager;
        const coaRepo = manager.getRepository(ChartOfAccounts);
        let coa = await coaRepo.findOne({ where: { country_iso: nextCountry, scope: 'COUNTRY', is_default: true } as any });
        if (!coa) {
          coa = await coaRepo.findOne({ where: { scope: 'GLOBAL', is_global_default: true } as any });
        }
        if (coa) existing.coa_id = coa.id;
        else console.warn(`[companies] No default CoA found for country ${nextCountry}, and no global default set`);
      }
    } catch (e) {
      console.warn('[companies] CoA auto-assign skipped:', (e as Error)?.message);
    }
    const lifecycle = resolveLifecycleState({
      currentDisabledAt: before.disabled_at,
      nextStatus: statusInput,
      nextDisabledAt: disabled_at,
    });
    existing.status = lifecycle.status;
    existing.disabled_at = lifecycle.disabled_at;
    const saved = await repo.save(existing);
    await this.audit.log(
      {
        table: 'companies',
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

  private csvHeaders(baseYear?: number): string[] {
    const headers = [
      'name',
      'country_iso',
      'address1',
      'address2',
      'postal_code',
      'city',
      'state',
      'reg_number',
      'vat_number',
      'base_currency',
      'status',
      'disabled_at',
      'notes',
    ];
    const years = this.metricYears(baseYear);
    years.forEach((year) => {
      headers.push(`headcount_${year}`);
      headers.push(`it_users_${year}`);
      headers.push(`turnover_${year}`);
    });
    return headers;
  }

  async exportCsv(
    scope: 'template' | 'data' = 'data',
    opts?: { manager?: EntityManager; year?: number; language?: CsvLanguage },
  ): Promise<{ filename: string; content: string }> {
    const language = opts?.language ?? 'en';
    const baseYear = this.normalizeYear(opts?.year);
    const headers = this.csvHeaders(baseYear);
    const rows: string[][] = [];
    if (scope === 'data') {
      const repo = this.getRepo(opts?.manager);
      const items = await repo.find({ order: { created_at: 'DESC' as any } });
      const years = this.metricYears(baseYear);
      const metricsByYear = new Map<number, Map<string, { headcount: number; it_users: number | null; turnover: number | string | null }>>();
      for (const year of years) {
        const { items: metrics } = await this.companyMetrics.list(year, opts);
        metricsByYear.set(
          year,
          new Map(
            metrics.map((m) => [
              m.company_id,
              { headcount: Number(m.headcount ?? 0), it_users: m.it_users != null ? Number(m.it_users) : null, turnover: m.turnover ?? null },
            ]),
          ),
        );
      }
      for (const c of items) {
        const row: string[] = [
          c.name ?? '',
          c.country_iso ?? '',
          c.address1 ?? '',
          c.address2 ?? '',
          c.postal_code ?? '',
          c.city ?? '',
          c.state ?? '',
          c.reg_number ?? '',
          c.vat_number ?? '',
          c.base_currency ?? '',
          // Read from the end of validity: a stored status left stale by a passed date never contradicts its own row.
          deriveStatusFromDisabledAt(c.disabled_at),
          c.disabled_at ? formatCsvEndOfValidity(new Date(c.disabled_at).toISOString(), language) : '',
          c.notes ?? '',
        ];
        years.forEach((year) => {
          const metrics = metricsByYear.get(year)?.get(c.id);
          row.push(metrics ? String(metrics.headcount ?? '') : '');
          row.push(metrics && metrics.it_users != null ? String(metrics.it_users) : '');
          row.push(metrics && metrics.turnover != null ? formatCsvAmount(String(metrics.turnover), language) : '');
        });
        rows.push(row);
      }
    }
    const filename = scope === 'template' ? `companies_template_${baseYear}.csv` : `companies_${baseYear}.csv`;
    return { filename, content: writeCsv({ language, headers, rows }) };
  }

  async importCsv(
    {
      file,
      dryRun,
      userId,
      year,
      language,
      dateOrder,
      decimalMark,
    }: {
      file: Express.Multer.File;
      dryRun: boolean;
      userId?: string | null;
      year?: number;
      language?: CsvLanguage;
      dateOrder?: CsvDateOrder;
      decimalMark?: DecimalMark;
    },
    opts?: { manager?: EntityManager },
  ) {
    if (!file) throw new BadRequestException('No file uploaded');
    const readLanguage = language ?? 'en';
    const baseYear = this.normalizeYear(year);
    const expectedHeaders = this.csvHeaders(baseYear);
    const metricYears = this.metricYears(baseYear);
    const buf = file.buffer ?? ((file as any).path ? fs.readFileSync((file as any).path) : undefined);
    if (!buf) throw new BadRequestException('Empty upload');
    const read = await readMasterDataFile({
      file: buf as Buffer,
      fields: expectedHeaders,
      amounts: [{ measure: 'turnover', names: ['turnover'] }],
      dateFields: ['disabled_at'],
      language: readLanguage,
      dateOrder,
      decimalMark,
    });
    const errors: { row: number; message: string }[] = [];
    if (read.headerError) {
      return {
        ok: false, dryRun, total: 0, inserted: 0, updated: 0,
        errors: [{ row: 0, message: read.headerError }],
        ignoredColumns: read.ignoredColumns, notices: read.notices,
      };
    }
    // Validate and normalize
    type CsvLifecycle = { status: StatusState | null; disabled_at: string | null };
    const normalized: { company: CompanyUpsertDto; metrics: Map<number, { headcount: number; it_users: number | null; turnover: string | null }>; lifecycle: CsvLifecycle }[] = [];
    read.rows.forEach((row) => {
      const line = row.line;
      const problems = rowProblems(row, ['disabled_at']);
      if (problems.length > 0) {
        errors.push(...problems.map((message) => ({ row: line, message })));
        return;
      }
      const name = cellOf(row, 'name');
      const country_iso = cellOf(row, 'country_iso');
      const address1 = cellOf(row, 'address1');
      const address2 = cellOf(row, 'address2');
      const postal_code = cellOf(row, 'postal_code');
      const city = cellOf(row, 'city');
      const state = cellOf(row, 'state');
      // Blank: enabled for a new company, the stored status on an update (`csvItemLifecycle`).
      const statusRaw = cellOf(row, 'status').toLowerCase();
      const statusValue: StatusState | null = statusRaw
        ? (STATUS_STATES.find((s) => s === statusRaw) ?? null)
        : null;
      const disabledAtRaw = cellOf(row, 'disabled_at');
      let disabled_at_iso: string | null = null;
      if (!name) errors.push({ row: line, message: 'name is required' });
      if (!country_iso || country_iso.length !== 2) errors.push({ row: line, message: 'country_iso is required and must be 2 letters' });
      const base_currency = cellOf(row, 'base_currency');
      if (!base_currency || base_currency.length !== 3) errors.push({ row: line, message: 'base_currency is required and must be 3 letters' });
      if (statusRaw && !statusValue) {
        errors.push({ row: line, message: `Invalid status '${statusRaw}'. Use 'enabled' or 'disabled'.` });
        return;
      }
      if (disabledAtRaw) {
        const end = endOfValidityOf(row, 'disabled_at');
        if (end.error) {
          errors.push({ row: line, message: end.error });
          return;
        }
        disabled_at_iso = end.value ? end.value.toISOString() : null;
      }
      const lifecycleConflict = csvLifecycleConflict(statusValue, disabled_at_iso);
      if (lifecycleConflict) {
        errors.push({ row: line, message: lifecycleConflict });
        return;
      }
      const metrics = new Map<number, { headcount: number; it_users: number | null; turnover: string | null }>();
      for (const fy of metricYears) {
        const headcountKey = `headcount_${fy}`;
        const itUsersKey = `it_users_${fy}`;
        const turnoverKey = `turnover_${fy}`;
        const headcountRaw = cellOf(row, headcountKey);
        const itUsersRaw = cellOf(row, itUsersKey);
        const turnoverRaw = cellOf(row, turnoverKey);
        const hasAny = headcountRaw !== '' || itUsersRaw !== '' || turnoverRaw !== '';
        if (!hasAny) continue;
        if (headcountRaw === '') {
          errors.push({ row: line, message: `${headcountKey} is required when providing metrics` });
          continue;
        }
        const headcountVal = Number(headcountRaw);
        if (!Number.isInteger(headcountVal) || headcountVal < 0) {
          errors.push({ row: line, message: `${headcountKey} must be a non-negative integer` });
          continue;
        }
        let itUsersVal: number | null = null;
        if (itUsersRaw !== '') {
          const parsed = Number(itUsersRaw);
          if (!Number.isInteger(parsed) || parsed < 0) {
            errors.push({ row: line, message: `${itUsersKey} must be a non-negative integer` });
          } else {
            itUsersVal = parsed;
          }
        }
        let turnoverVal: string | null = null;
        if (turnoverRaw !== '') {
          // Read by the shared layer under the file's decimal mark (`read.amounts`).
          const parsed = row.amounts[turnoverKey];
          const value = parsed?.kind === 'value' ? parsed.decimal : null;
          if (!value || value.cmp(0) < 0) {
            errors.push({ row: line, message: `${turnoverKey} must be a non-negative number` });
          } else {
            const written = value.toString();
            const decimals = (written.split('.')[1] ?? '').length;
            if (decimals > 3) {
              errors.push({ row: line, message: `${turnoverKey} allows up to 3 decimals` });
            } else {
              turnoverVal = written;
            }
          }
        }
        metrics.set(fy, { headcount: headcountVal, it_users: itUsersVal, turnover: turnoverVal });
      }
      normalized.push({
        company: {
          name,
          country_iso: country_iso.toUpperCase(),
          address1: address1 || null,
          address2: address2 || null,
          postal_code: postal_code || null,
          city: city || null,
          state: state || null,
          reg_number: cellOf(row, 'reg_number') || null,
          vat_number: cellOf(row, 'vat_number') || null,
          base_currency: base_currency.toUpperCase(),
          notes: cellOf(row, 'notes') || null,
        },
        metrics,
        lifecycle: { status: statusValue, disabled_at: disabled_at_iso },
      });
    });
    const total = read.rows.length;
    if (errors.length > 0) {
      return { ok: false, dryRun, total, inserted: 0, updated: 0, errors, ignoredColumns: read.ignoredColumns, notices: read.notices };
    }
    // Deduplicate by company name: keep first occurrence
    const uniqueByName = new Map<string, (typeof normalized)[number]>();
    for (const item of normalized) {
      const key = (item.company.name as string).toLowerCase();
      if (!uniqueByName.has(key)) uniqueByName.set(key, item);
    }
    const unique = Array.from(uniqueByName.values());
    // Count inserts/updates by name
    let inserted = 0;
    let updated = 0;
    const repo = this.getRepo(opts?.manager);
    for (const item of unique) {
      const existing = await repo.findOne({ where: { name: item.company.name as string } });
      if (existing) updated += 1; else inserted += 1;
    }
    if (dryRun) {
      return { ok: true, dryRun: true, total, inserted, updated, errors: [], ignoredColumns: read.ignoredColumns, notices: read.notices };
    }
    // Commit
    let processed = 0;
    for (const item of unique) {
      const existing = await repo.findOne({ where: { name: item.company.name as string } });
      let saved: Company | null = null;
      // A blank status or date keeps the stored value on an update; `update`/`create` resolve the rest.
      const body = { ...item.company, ...csvItemLifecycle(item.lifecycle.status, item.lifecycle.disabled_at, !!existing) };
      if (existing) {
        saved = await this.update(existing.id, body as any, userId ?? undefined, { manager: opts?.manager });
      } else {
        saved = await this.create(body as any, userId ?? undefined, { manager: opts?.manager });
      }
      if (saved) {
        processed += 1;
        for (const [fy, metric] of item.metrics.entries()) {
          await this.companyMetrics.upsertForCompany(saved.id, fy, metric, userId ?? undefined, { manager: opts?.manager });
        }
      }
    }
    return { ok: true, dryRun: false, total, inserted, updated, processed, errors: [], ignoredColumns: read.ignoredColumns, notices: read.notices };
  }
}
