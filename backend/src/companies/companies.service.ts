import { BadRequestException, ForbiddenException, HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, EntityManager, In, Repository, SelectQueryBuilder } from 'typeorm';
import { Company } from './company.entity';
import { CompanyMetric } from './company-metric.entity';
import { companyListMetric } from './company-list-metrics';
import { Decimal } from '../common/decimal';
import { sameStoredLifecycle, sameStoredValues } from '../common/csv-sheet/unchanged';
import { ChartOfAccounts } from '../accounts/chart-of-accounts.entity';
import { parseExportPagination, parsePagination, type Sort } from '../common/pagination';
import { orderListQuery } from '../common/list-sort';

const COMPANY_SORT_COLUMNS = new Set(['id', 'name', 'country_iso', 'city', 'postal_code', 'address1', 'address2', 'state', 'notes', 'reg_number', 'vat_number', 'base_currency', 'status', 'created_at', 'updated_at']);
const COMPANY_TEXT_SORTS = new Set(['name', 'country_iso', 'city', 'postal_code', 'address1', 'address2', 'state', 'notes', 'reg_number', 'vat_number', 'base_currency']);
const COMPANY_METRIC_SORTS: Record<string, string> = {
  headcount_year: 'COALESCE(m.headcount, 0)',
  it_users_year: 'COALESCE(m.it_users, 0)',
  turnover_year: 'COALESCE(m.turnover, 0)',
  metrics_frozen: 'COALESCE(m.is_frozen, false)',
};
import { AuditService, AuditSourceOptions } from '../audit/audit.service';
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
import { duplicateNameException } from '../common/duplicate-name';
import {
  cellOf,
  CsvDateOrder,
  CsvLanguage,
  DecimalMark,
  endOfValidityOf,
  keepStoredEndOfValidity,
  formatCsvAmount,
  formatCsvEndOfValidity,
  ImportReportError,
  headerMismatchError,
  nameMatchedWarning,
  readMasterDataFile,
  rowError,
  rowProblemErrors,
  writeCsv,
} from '../common/csv-sheet';
import { uploadedBytes } from '../common/upload';
import { FxRateService } from '../currency/fx-rate.service';
import { convertTurnovers, yearRateSetId } from '../spend/allocation-distribution';

/** A metric column of any year (`headcount_2031`), inside or outside the list's window. */
const METRIC_COLUMN = /^(headcount|it_users|turnover)_(\d{4})$/i;

type CompanyFilterTarget = FilterTargetConfig & { requiresMetrics?: boolean };
type CompanyLookupItem = { id: string; name: string };

@Injectable()
export class CompaniesService {
  constructor(
    @InjectRepository(Company) private readonly repo: Repository<Company>,
    private readonly audit: AuditService,
    private readonly companyMetrics: CompanyMetricsService,
    /** Converts the turnovers of the totals into the reporting currency. */
    private readonly fxRates?: FxRateService,
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
      created_at: { expression: 'c.created_at', dataType: 'date' },
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

    await this.orderList(qb, sort, !!year);
    qb.skip(skip).take(limit);

    if (year) {
      const { raw, entities } = await qb.getRawAndEntities();
      const items = entities.map((ent, idx) => {
        const r = (raw[idx] || {}) as any;
        return {
          ...ent,
          headcount_year: companyListMetric(r.metrics_headcount),
          it_users_year: companyListMetric(r.metrics_it_users),
          turnover_year: companyListMetric(r.metrics_turnover),
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

  /** The list order: a company column (text alphabetically) or a metric of the year; the name by default; then the id. */
  private async orderList(qb: SelectQueryBuilder<Company>, sort: Sort, withYear: boolean) {
    const field = String(sort.field);
    const direction = String(sort.direction).toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    const metric = withYear ? COMPANY_METRIC_SORTS[field] : undefined;
    if (COMPANY_SORT_COLUMNS.has(field)) {
      await orderListQuery(qb, `c.${field}`, direction, { text: COMPANY_TEXT_SORTS.has(field), idExpr: 'c.id' });
    } else if (metric) {
      await orderListQuery(qb, metric, direction, { text: false, idExpr: 'c.id' });
    } else {
      await orderListQuery(qb, 'c.name', 'ASC', { text: true, idExpr: 'c.id' });
    }
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
      created_at: { expression: 'c.created_at', dataType: 'date' },
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

    await this.orderList(qb, sort, !!year);

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

  /**
   * The list's totals for the year. Each company enters its turnover in millions of its base
   * currency: the total is converted into the tenant's reporting currency (`turnover_currency`)
   * at the rates of the year's budget versions: the set the year is frozen at, else the live
   * rates (`yearRateSetId`). A currency without a rate is left out of `turnover` and named in
   * `turnover_fx_missing` (`companies` is how many companies of that currency had a turnover).
   * `headcount`, `it_users` and `turnover` are null when no company has that figure for the year.
   * Entered zeros still total zero.
   * Each row of the list stays in the company's own currency.
   */
  async totals(
    query: any,
    opts: { manager?: EntityManager; tenantId: string },
  ): Promise<{
    headcount: number | null;
    it_users: number | null;
    turnover: number | null;
    turnover_currency: string;
    turnover_fx_missing: Array<{ currency: string; year: number; companies: number }>;
    year: number;
  }> {
    const repo = this.getRepo(opts?.manager);
    const tenantId = opts?.tenantId;
    if (!tenantId) throw new BadRequestException('A tenant is required');
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
      created_at: { expression: 'c.created_at', dataType: 'date' },
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

    // One row per base currency: the turnovers are converted per currency below.
    const qb = repo
      .createQueryBuilder('c')
      .select("NULLIF(UPPER(TRIM(c.base_currency)), '')", 'currency')
      // No COALESCE: SUM of an all-blank group is null, so a year with no figure is not a zero.
      .addSelect('SUM(m.headcount)', 'headcount')
      .addSelect('SUM(m.it_users)', 'it_users')
      .addSelect('SUM(m.turnover)', 'turnover')
      .addSelect('COUNT(*) FILTER (WHERE COALESCE(m.turnover, 0) <> 0)', 'companies')
      .where('c.tenant_id = :tenantId', { tenantId })
      .groupBy("NULLIF(UPPER(TRIM(c.base_currency)), '')");

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
      (sub) => sub.from('company_metrics', 'm').where('m.fiscal_year = :year', { year }).andWhere('m.tenant_id = :tenantId', { tenantId }),
      'm',
      'm.company_id = c.id AND m.tenant_id = c.tenant_id',
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

    const rows = (await qb.getRawMany()) as Array<{ currency?: string | null; headcount?: any; it_users?: any; turnover?: any; companies?: any }>;
    const toNum = (v: any) => {
      const n = Number(v ?? 0);
      return Number.isFinite(n) ? n : 0;
    };
    const round3 = (n: number) => Math.round(n * 1000) / 1000;
    // A blank group (SUM is null) is not a zero. An entered zero still counts.
    const sumEntered = (pick: (row: (typeof rows)[number]) => unknown): number | null => {
      const present = rows.filter((row) => {
        const value = pick(row);
        return value != null && value !== '';
      });
      if (present.length === 0) return null;
      return present.reduce((acc, row) => acc + toNum(pick(row)), 0);
    };
    const headcountSum = sumEntered((row) => row.headcount);
    const itUsersSum = sumEntered((row) => row.it_users);
    const headcount = headcountSum == null ? null : Math.round(headcountSum);
    const it_users = itUsersSum == null ? null : Math.round(itUsersSum);
    const entered = rows.filter((row) => row.turnover != null && row.turnover !== '');
    const groups = entered.filter((row) => toNum(row.turnover) !== 0);
    const converted = await convertTurnovers({
      fxRates: this.fxRates,
      manager: repo.manager,
      tenantId,
      fiscalYear: year,
      rateSetId: await yearRateSetId(repo.manager, tenantId, year),
      // One entry per currency, keyed by its position.
      entries: groups.map((row, idx) => ({ companyId: String(idx), currency: row.currency ?? null, turnover: toNum(row.turnover) })),
    });
    let turnover: number | null = null;
    if (entered.length > 0) {
      let sum = 0;
      converted.values.forEach((value) => { sum += value ?? 0; });
      turnover = round3(sum);
    }
    const turnover_fx_missing = converted.missing
      .map((item) => ({
        currency: item.currency,
        year,
        companies: Math.max(0, Math.round(toNum(groups[Number(item.companyId)]?.companies))),
      }))
      .sort((a, b) => a.currency.localeCompare(b.currency) || a.year - b.year);

    return {
      headcount,
      it_users,
      turnover,
      turnover_currency: converted.reportingCurrency,
      turnover_fx_missing,
      year,
    };
  }

  /**
   * Company names are unique in the tenant whatever their case ("acme" when "Acme" exists): refused
   * with the same answer as the database's unique key (409 `duplicate`).
   */
  private async assertNameFree(manager: EntityManager, name: string | null | undefined, exceptId?: string) {
    if (!name) return;
    const rows: Array<{ id: string }> = await manager.query(
      `SELECT id FROM companies
        WHERE tenant_id = app_current_tenant() AND lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2)
        LIMIT 1`,
      [name, exceptId ?? null],
    );
    if (rows.length > 0) throw duplicateNameException('Another company already has this name.');
  }

  async get(id: string, opts?: { manager?: EntityManager }) {
    const repo = this.getRepo(opts?.manager);
    const found = await repo.findOne({ where: { id } });
    if (!found) throw new NotFoundException('Company not found');
    return found;
  }

  /**
   * Name, country and city are NOT NULL columns: an empty one is refused with a 400 naming the
   * field (`code: 'required'`) before the database. Create requires them; update refuses them
   * only when the body sends them.
   */
  private assertRequiredFields(body: CompanyUpsertDto, mode: 'create' | 'update') {
    for (const [field, label] of [['name', 'Name'], ['country_iso', 'Country'], ['city', 'City']] as const) {
      const value = body[field];
      if (mode === 'update' && value === undefined) continue;
      if (typeof value === 'string' && value.trim() !== '') continue;
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        code: 'required',
        field,
        message: `${label} is required.`,
      });
    }
  }

  async create(body: CompanyUpsertDto, userId?: string, opts?: { manager?: EntityManager; audit?: AuditSourceOptions }) {
    const repo = this.getRepo(opts?.manager);
    this.assertRequiredFields(body ?? {}, 'create');
    const { status: statusInput, disabled_at, ...rest } = body ?? {};
    await this.assertNameFree(repo.manager, rest.name);
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
    this.assertRequiredFields(body ?? {}, 'update');
    const { status: statusInput, disabled_at, ...rest } = body ?? {};
    if (rest.name !== undefined && rest.name !== before.name) await this.assertNameFree(repo.manager, rest.name, id);
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
    years.forEach((year) => headers.push(...this.metricColumns(year)));
    return headers;
  }

  private metricColumns(year: number): string[] {
    return [`headcount_${year}`, `it_users_${year}`, `turnover_${year}`];
  }

  /** Years of the window whose three columns are all in the file. An absent year is left untouched. */
  private yearsInFile(present: readonly string[], metricYears: readonly number[]): number[] {
    return metricYears.filter((year) => this.metricColumns(year).every((column) => present.includes(column)));
  }

  /** A year that has some of its three columns and not the others: the file would otherwise clear the missing ones. */
  private incompleteYearColumns(present: readonly string[], metricYears: readonly number[]): string[] {
    const have = new Set(present);
    const missing: string[] = [];
    for (const year of metricYears) {
      const columns = this.metricColumns(year);
      if (!columns.some((column) => have.has(column))) continue;
      for (const column of columns) if (!have.has(column)) missing.push(column);
    }
    return missing;
  }

  /** Ignored headers, plus metric columns of a year outside the window (`turnover_2031` is read as an amount). */
  private reportedIgnored(
    read: { present: readonly string[]; ignoredColumns: readonly string[] },
    metricYears: readonly number[],
  ): string[] {
    const allowed = new Set(metricYears.flatMap((year) => this.metricColumns(year)));
    const outside = read.present.filter((id) => METRIC_COLUMN.test(id) && !allowed.has(id));
    return [...read.ignoredColumns, ...outside];
  }

  async exportCsv(
    scope: 'template' | 'data' = 'data',
    opts?: { manager?: EntityManager; year?: number; language?: CsvLanguage; listQuery?: Record<string, unknown> },
  ): Promise<{ filename: string; content: string }> {
    const language = opts?.language ?? 'en';
    const baseYear = this.normalizeYear(opts?.year);
    const headers = this.csvHeaders(baseYear);
    const years = this.metricYears(baseYear);
    const rows: string[][] = [];
    if (scope === 'data') {
      const repo = this.getRepo(opts?.manager);
      // What the list shows (its search, filters, scope and sort), or the whole register, newest first.
      const items: Company[] = opts?.listQuery
        ? (await this.list(opts.listQuery, { manager: opts.manager, exportAll: true })).items as Company[]
        : await repo.find({ order: { created_at: 'DESC' as any, id: 'ASC' as any } });
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
    } else {
      // One fictional company so the file shows the shape: enabled, metrics for the list year only.
      const example = ['Example Company', 'FR', '', '', '', 'Paris', '', '', '', 'EUR', 'enabled', '', ''];
      for (const year of years) {
        example.push(...(year === baseYear ? ['120', '40', formatCsvAmount('12.5', language)] : ['', '', '']));
      }
      rows.push(example);
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
    const buf = uploadedBytes(file);
    const read = await readMasterDataFile({
      file: buf as Buffer,
      fields: expectedHeaders,
      // Each year of the window may be absent. A year outside it is reported, not refused.
      optional: metricYears.flatMap((fy) => this.metricColumns(fy)),
      amounts: [{ measure: 'turnover', names: ['turnover'] }],
      dateFields: ['disabled_at'],
      language: readLanguage,
      dateOrder,
      decimalMark,
      noticeUnknown: (header) => METRIC_COLUMN.test(header.trim()),
    });
    const ignoredColumns = this.reportedIgnored(read, metricYears);
    const errors: ImportReportError[] = [];
    if (read.headerError) {
      return {
        ok: false, dryRun, total: 0, inserted: 0, updated: 0,
        errors: [read.headerError],
        ignoredColumns, notices: read.notices,
      };
    }
    // One column of a year without the other two would store nulls for the ones the file omits.
    const incomplete = headerMismatchError(this.incompleteYearColumns(read.present, metricYears), []);
    if (incomplete) {
      return {
        ok: false, dryRun, total: 0, inserted: 0, updated: 0,
        errors: [incomplete],
        ignoredColumns, notices: read.notices,
      };
    }
    const yearsInFile = this.yearsInFile(read.present, metricYears);
    // Years frozen for company metrics: a row that sets one is refused here, not at the load.
    const frozenYears = new Set<number>();
    if (typeof this.companyMetrics?.assertYearOpen === 'function') {
      for (const fy of yearsInFile) {
        try {
          await this.companyMetrics.assertYearOpen(fy, opts);
        } catch (err) {
          if (err instanceof ForbiddenException) frozenYears.add(fy);
          else throw err;
        }
      }
    }
    // Validate and normalize
    type CsvLifecycle = { status: StatusState | null; disabled_at: string | null };
    const normalized: { line: number; company: CompanyUpsertDto; metrics: Map<number, { headcount: number; it_users: number | null; turnover: string | null }>; lifecycle: CsvLifecycle }[] = [];
    // The first line of each name, whatever its case: a company takes one row.
    const firstLineByName = new Map<string, number>();
    read.rows.forEach((row) => {
      const line = row.line;
      const problems = rowProblemErrors(row, ['disabled_at']);
      if (problems.length > 0) {
        errors.push(...problems);
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
      if (!name) errors.push(rowError(line, 'name', 'CSV_VALUE_REQUIRED', 'name is required'));
      else {
        const firstRow = firstLineByName.get(name.toLowerCase());
        if (firstRow === undefined) firstLineByName.set(name.toLowerCase(), line);
        else {
          errors.push(rowError(
            line,
            'name',
            'CSV_COMPANY_NAME_DUPLICATE',
            `'${name}' is already on row ${firstRow}. Keep one row per company.`,
            { name, firstRow },
          ));
        }
      }
      // `city` is NOT NULL, like name: a blank cell is refused for a new company and for an update.
      if (!city) errors.push(rowError(line, 'city', 'CSV_VALUE_REQUIRED', 'city is required'));
      if (!country_iso) errors.push(rowError(line, 'country_iso', 'CSV_VALUE_REQUIRED', 'country_iso is required and must be 2 letters'));
      else if (country_iso.length !== 2) errors.push(rowError(line, 'country_iso', 'CSV_COUNTRY_INVALID', 'country_iso is required and must be 2 letters', { value: country_iso }));
      const base_currency = cellOf(row, 'base_currency');
      if (!base_currency) errors.push(rowError(line, 'base_currency', 'CSV_VALUE_REQUIRED', 'base_currency is required and must be 3 letters'));
      else if (base_currency.length !== 3) errors.push(rowError(line, 'base_currency', 'CSV_CURRENCY_INVALID', 'base_currency is required and must be 3 letters', { value: base_currency }));
      if (statusRaw && !statusValue) {
        errors.push(rowError(line, 'status', 'CSV_ENUM_INVALID', `Invalid status '${statusRaw}'. Use 'enabled' or 'disabled'.`, { value: statusRaw, allowed: 'enabled, disabled' }));
        return;
      }
      if (disabledAtRaw) {
        const end = endOfValidityOf(row, 'disabled_at');
        if (end.error) {
          errors.push(rowError(line, 'disabled_at', 'CSV_DATE_INVALID', end.error, { value: disabledAtRaw }));
          return;
        }
        disabled_at_iso = end.value ? end.value.toISOString() : null;
      }
      const lifecycleConflict = csvLifecycleConflict(statusValue, disabled_at_iso);
      if (lifecycleConflict) {
        errors.push(rowError(line, 'status', statusValue === StatusState.ENABLED ? 'CSV_STATUS_DATE_PASSED' : 'CSV_STATUS_DATE_FUTURE', lifecycleConflict));
        return;
      }
      const metrics = new Map<number, { headcount: number; it_users: number | null; turnover: string | null }>();
      for (const fy of yearsInFile) {
        const headcountKey = `headcount_${fy}`;
        const itUsersKey = `it_users_${fy}`;
        const turnoverKey = `turnover_${fy}`;
        const headcountRaw = cellOf(row, headcountKey);
        const itUsersRaw = cellOf(row, itUsersKey);
        const turnoverRaw = cellOf(row, turnoverKey);
        const hasAny = headcountRaw !== '' || itUsersRaw !== '' || turnoverRaw !== '';
        if (!hasAny) continue;
        if (frozenYears.has(fy)) {
          errors.push({
            row: line,
            message: `Metrics for ${fy} are frozen. A budget administrator can unfreeze them.`,
            code: 'CSV_COMPANY_METRICS_FROZEN',
            params: { year: fy },
          });
          continue;
        }
        if (headcountRaw === '') {
          errors.push(rowError(line, headcountKey, 'CSV_VALUE_REQUIRED', `${headcountKey} is required when providing metrics`));
          continue;
        }
        const headcountVal = Number(headcountRaw);
        if (!Number.isInteger(headcountVal) || headcountVal < 0) {
          errors.push(rowError(line, headcountKey, 'CSV_WHOLE_NUMBER_INVALID', `${headcountKey} must be a non-negative integer`, { value: headcountRaw }));
          continue;
        }
        let itUsersVal: number | null = null;
        if (itUsersRaw !== '') {
          const parsed = Number(itUsersRaw);
          if (!Number.isInteger(parsed) || parsed < 0) {
            errors.push(rowError(line, itUsersKey, 'CSV_WHOLE_NUMBER_INVALID', `${itUsersKey} must be a non-negative integer`, { value: itUsersRaw }));
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
            errors.push(rowError(line, turnoverKey, 'CSV_NUMBER_NEGATIVE_INVALID', `${turnoverKey} must be a non-negative number`, { value: turnoverRaw }));
          } else {
            const written = value.toString();
            const decimals = (written.split('.')[1] ?? '').length;
            if (decimals > 3) {
              errors.push(rowError(line, turnoverKey, 'CSV_DECIMALS_TOO_MANY', `${turnoverKey} allows up to 3 decimals`, { value: turnoverRaw, max: 3 }));
            } else {
              turnoverVal = written;
            }
          }
        }
        metrics.set(fy, { headcount: headcountVal, it_users: itUsersVal, turnover: turnoverVal });
      }
      normalized.push({
        line,
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
      return { ok: false, dryRun, total, inserted: 0, updated: 0, errors, ignoredColumns, notices: read.notices };
    }
    // Count inserts, updates and the companies whose every value and yearly metric is already stored.
    const repo = this.getRepo(opts?.manager);
    // A row matches the company of the same name whatever its case ("acme" updates "Acme"). The
    // stored spelling stays, and the report says which company the row matched.
    const existingByName = new Map<string, Company>();
    const warnings: ImportReportError[] = [];
    for (const item of normalized) {
      const name = item.company.name as string;
      const existing = await repo.createQueryBuilder('c')
        .where('c.tenant_id = app_current_tenant() AND lower(c.name) = lower(:name)', { name })
        .getOne();
      if (!existing) continue;
      const warning = nameMatchedWarning(item.line, 'name', name, existing.name);
      if (warning) warnings.push(warning);
      item.company = { ...item.company, name: existing.name };
      // The stored end of validity's day keeps its time of day: the export writes the day only.
      item.lifecycle = { ...item.lifecycle, disabled_at: keepStoredEndOfValidity(existing.disabled_at, item.lifecycle.disabled_at) };
      existingByName.set(existing.name, existing);
    }
    const existingIds = Array.from(existingByName.values()).map((company) => company.id);
    const storedMetrics = new Map<string, CompanyMetric>();
    if (existingIds.length > 0 && yearsInFile.length > 0) {
      const metricRepo = (opts?.manager ?? repo.manager).getRepository(CompanyMetric);
      for (const metric of await metricRepo.find({ where: { company_id: In(existingIds), fiscal_year: In(yearsInFile) } })) {
        storedMetrics.set(`${metric.company_id}:${metric.fiscal_year}`, metric);
      }
    }
    /** A yearly metric of the file equal to the stored one: not written again. */
    const sameMetric = (companyId: string, fy: number, metric: { headcount: number; it_users: number | null; turnover: string | null }) => {
      const stored = storedMetrics.get(`${companyId}:${fy}`);
      if (!stored || !sameStoredValues(stored as any, { headcount: metric.headcount, it_users: metric.it_users })) return false;
      // numeric(18,3) reads back as '172.000' while the file gives '172': compared as decimals.
      if (stored.turnover == null || metric.turnover == null) return stored.turnover == null && metric.turnover == null;
      return Decimal.from(String(stored.turnover)).cmp(metric.turnover) === 0;
    };
    let inserted = 0;
    let updated = 0;
    let unchanged = 0;
    const toWrite: Array<{ item: (typeof normalized)[number]; existing: Company | undefined }> = [];
    for (const item of normalized) {
      const existing = existingByName.get(item.company.name as string);
      if (!existing) inserted += 1;
      else if (
        sameStoredValues(existing as any, item.company as Record<string, unknown>)
        && sameStoredLifecycle(existing, csvItemLifecycle(item.lifecycle.status, item.lifecycle.disabled_at, true))
        && Array.from(item.metrics.entries()).every(([fy, metric]) => sameMetric(existing.id, fy, metric))
      ) {
        unchanged += 1;
        continue;
      } else updated += 1;
      toWrite.push({ item, existing });
    }
    if (dryRun) {
      return { ok: true, dryRun: true, total, inserted, updated, unchanged, errors: [], warnings, ignoredColumns, notices: read.notices };
    }
    // Commit
    let processed = 0;
    for (const { item, existing } of toWrite) {
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
          if (existing && sameMetric(existing.id, fy, metric)) continue;
          await this.companyMetrics.upsertForCompany(saved.id, fy, metric, userId ?? undefined, { manager: opts?.manager });
        }
      }
    }
    return { ok: true, dryRun: false, total, inserted, updated, unchanged, processed, errors: [], warnings, ignoredColumns, notices: read.notices };
  }
}
