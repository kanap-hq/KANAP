import { BadRequestException, Injectable } from '@nestjs/common';
import { requestContextMissing } from '../auth/module-right-required';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Company } from '../companies/company.entity';
import { CompanyMetric } from '../companies/company-metric.entity';
import { Department } from '../departments/department.entity';
import { DepartmentMetric } from '../departments/department-metric.entity';
import { CompanyMetricsService } from '../companies/company-metrics.service';
import { DepartmentMetricsService } from '../departments/department-metrics.service';
import { FreezeService } from '../freeze/freeze.service';
import { assertCanManageMasterDataScope, MasterDataAccess } from './master-data-access.util';

const COMPANY_METRIC_KEYS = ['headcount', 'it_users', 'turnover'] as const;
export type CompanyMetricKey = typeof COMPANY_METRIC_KEYS[number];

/** Codes the copy screen words in the user's language. Never an English sentence. */
export const COPY_SKIP_REASONS = {
  noSourceData: 'no_data_for_source_year',
  copyFailed: 'failed_to_copy_metrics',
} as const;

export type CopySkipReason = (typeof COPY_SKIP_REASONS)[keyof typeof COPY_SKIP_REASONS];

type MasterDataCopyRequest = {
  sourceYear: number;
  destinationYear: number;
  includeCompanies: boolean;
  includeDepartments: boolean;
  companyMetrics: string[];
  dryRun: boolean;
  userId: string | null;
  access: MasterDataAccess;
};

type MasterDataCopyResultItem = {
  entityType: 'company' | 'department';
  entityId: string;
  /** A company or department with no row, or no name, is null: the screen words it. */
  entityName: string | null;
  metric: CompanyMetricKey | 'headcount';
  sourceValue: number | null;
  destinationValue: number | null;
  newValue: number | null;
  skipped: boolean;
  /** Skip code from COPY_SKIP_REASONS. Absent when the row will be copied. */
  reason?: CopySkipReason;
};

type MasterDataCopyError = {
  entityType: 'company' | 'department';
  entityId: string;
  /** A company or department with no row, or no name, is null: the screen words it. */
  entityName: string | null;
  message: string;
};

type MasterDataCopyResponse = {
  success: boolean;
  dryRun: boolean;
  summary: {
    totalItems: number;
    processed: number;
    skipped: number;
    errors: number;
  };
  results: MasterDataCopyResultItem[];
  errors: MasterDataCopyError[];
};

function toNumber(value: any): number | null {
  if (value == null) return null;
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num;
}

function toInt(value: any): number {
  const num = Math.round(Number(value ?? 0));
  if (!Number.isFinite(num) || num < 0) return 0;
  return num;
}

function getCompanyMetricValue(row: CompanyMetric | undefined, metric: CompanyMetricKey) {
  if (!row) return null;
  if (metric === 'headcount') return row.headcount;
  if (metric === 'it_users') return row.it_users;
  return row.turnover;
}

/**
 * The name of a department in a copy result. No department, or a blank name, is null:
 * the screen words it in the user's language, as the chargeback report does.
 */
export function departmentCopyName(
  department: { name?: string | null; company?: { name?: string | null } | null } | null | undefined,
): string | null {
  const name = department?.name?.trim();
  if (!name) return null;
  const company = department?.company?.name?.trim();
  return company ? `${name} (${company})` : name;
}

/**
 * The name of a company in a copy result. No company, or a blank name, is null:
 * the screen words it in the user's language, as it does for a department.
 */
export function companyCopyName(
  company: { name?: string | null } | null | undefined,
): string | null {
  const name = company?.name?.trim();
  return name ? name : null;
}

@Injectable()
export class MasterDataOperationsService {
  constructor(
    @InjectRepository(Company) private readonly companyRepo: Repository<Company>,
    @InjectRepository(CompanyMetric) private readonly companyMetricRepo: Repository<CompanyMetric>,
    @InjectRepository(Department) private readonly departmentRepo: Repository<Department>,
    @InjectRepository(DepartmentMetric) private readonly departmentMetricRepo: Repository<DepartmentMetric>,
    private readonly companyMetricsService: CompanyMetricsService,
    private readonly departmentMetricsService: DepartmentMetricsService,
    private readonly freeze: FreezeService,
  ) {}

  private manager(opts?: { manager?: EntityManager }) {
    return opts?.manager ?? this.companyRepo.manager;
  }

  private ensureYears(year: number, label: string) {
    if (!Number.isInteger(year)) {
      throw new BadRequestException(`${label} must be an integer year`);
    }
  }

  async copyMasterData(params: MasterDataCopyRequest, opts?: { manager?: EntityManager }): Promise<MasterDataCopyResponse> {
    const manager = this.manager(opts);
    const { sourceYear, destinationYear, includeCompanies, includeDepartments, companyMetrics, dryRun, userId, access } = params;

    this.ensureYears(sourceYear, 'sourceYear');
    this.ensureYears(destinationYear, 'destinationYear');

    if (!includeCompanies && !includeDepartments) {
      throw new BadRequestException('At least one data source must be selected');
    }

    const rawMetrics = Array.isArray(companyMetrics) ? companyMetrics : [];
    const companyMetricSet = new Set<CompanyMetricKey>();
    for (const raw of rawMetrics) {
      const key = String(raw) as CompanyMetricKey;
      if (!COMPANY_METRIC_KEYS.includes(key)) {
        throw new BadRequestException(`Unsupported company metric '${raw}'`);
      }
      companyMetricSet.add(key);
    }
    if (includeCompanies && companyMetricSet.size === 0) {
      throw new BadRequestException('Select at least one company metric to copy');
    }

    if (!userId) {
      throw requestContextMissing('User context is required');
    }

    if (includeCompanies) {
      assertCanManageMasterDataScope(access, 'companies', 'copy company metrics');
    }
    if (includeDepartments) {
      assertCanManageMasterDataScope(access, 'departments', 'copy department metrics');
    }

    if (includeCompanies) {
      await this.freeze.assertNotFrozen({ scope: 'companies', year: destinationYear, action: 'Copy' }, { manager });
    }
    if (includeDepartments) {
      await this.freeze.assertNotFrozen({ scope: 'departments', year: destinationYear, action: 'Copy' }, { manager });
    }

    if (dryRun) {
      return this.processCopy({
        manager,
        sourceYear,
        destinationYear,
        includeCompanies,
        includeDepartments,
        companyMetricSet,
        applyChanges: false,
        userId,
      });
    }

    return manager.transaction((trx) => this.processCopy({
      manager: trx,
      sourceYear,
      destinationYear,
      includeCompanies,
      includeDepartments,
      companyMetricSet,
      applyChanges: true,
      userId,
    }));
  }

  private async processCopy(params: {
    manager: EntityManager;
    sourceYear: number;
    destinationYear: number;
    includeCompanies: boolean;
    includeDepartments: boolean;
    companyMetricSet: Set<CompanyMetricKey>;
    applyChanges: boolean;
    userId: string | null;
  }): Promise<MasterDataCopyResponse> {
    const { manager, sourceYear, destinationYear, includeCompanies, includeDepartments, companyMetricSet, applyChanges, userId } = params;

    const results: MasterDataCopyResultItem[] = [];
    const errors: MasterDataCopyError[] = [];
    let processed = 0;
    let skipped = 0;

    if (includeCompanies) {
      const companyMetricRepository = manager.getRepository(CompanyMetric);
      const sourceMetrics = await companyMetricRepository.find({ where: { fiscal_year: sourceYear } as any });
      const destinationMetrics = await companyMetricRepository.find({ where: { fiscal_year: destinationYear } as any });
      const sourceMap = new Map<string, CompanyMetric>();
      for (const row of sourceMetrics) sourceMap.set(row.company_id, row);
      const destinationMap = new Map<string, CompanyMetric>();
      for (const row of destinationMetrics) destinationMap.set(row.company_id, row);

      const companyIds = Array.from(new Set([...sourceMap.keys(), ...destinationMap.keys()]));
      if (companyIds.length > 0) {
        const companies = await manager.getRepository(Company).find({ where: { id: In(companyIds) } });
        const companyNameMap = new Map<string, string | null>();
        for (const company of companies) {
          companyNameMap.set(company.id, companyCopyName(company));
        }
        const sortedIds = [...companyIds].sort((a, b) => {
          const nameA = (companyNameMap.get(a) ?? '').toLowerCase();
          const nameB = (companyNameMap.get(b) ?? '').toLowerCase();
          if (nameA < nameB) return -1;
          if (nameA > nameB) return 1;
          return 0;
        });

        for (const companyId of sortedIds) {
          const companyName = companyNameMap.get(companyId) ?? null;
          const source = sourceMap.get(companyId);
          const destination = destinationMap.get(companyId);

          if (!source) {
            for (const metric of companyMetricSet) {
              results.push({
                entityType: 'company',
                entityId: companyId,
                entityName: companyName,
                metric,
                sourceValue: null,
                destinationValue: toNumber(getCompanyMetricValue(destination, metric)) ?? null,
                newValue: null,
                skipped: true,
                reason: COPY_SKIP_REASONS.noSourceData,
              });
              skipped += 1;
            }
            continue;
          }

          const nextHeadcount = companyMetricSet.has('headcount')
            ? toInt(source.headcount)
            : toInt(destination?.headcount ?? source.headcount);
          const nextItUsers = companyMetricSet.has('it_users')
            ? (source.it_users != null ? toInt(source.it_users) : null)
            : (destination?.it_users != null ? toInt(destination.it_users) : null);
          const nextTurnover = companyMetricSet.has('turnover')
            ? (source.turnover != null ? toNumber(source.turnover) : null)
            : (destination?.turnover != null ? toNumber(destination.turnover) : null);

          if (applyChanges) {
            try {
              await this.companyMetricsService.upsertForCompany(companyId, destinationYear, {
                headcount: nextHeadcount,
                it_users: nextItUsers,
                turnover: nextTurnover,
              }, userId ?? undefined, { manager });
            } catch (err: any) {
              errors.push({ entityType: 'company', entityId: companyId, entityName: companyName, message: err?.message ?? 'Unable to copy metrics' });
              for (const metric of companyMetricSet) {
                results.push({
                  entityType: 'company',
                  entityId: companyId,
                  entityName: companyName,
                  metric,
                  sourceValue: toNumber(getCompanyMetricValue(source, metric)) ?? null,
                  destinationValue: toNumber(getCompanyMetricValue(destination, metric)) ?? null,
                  newValue: null,
                  skipped: true,
                  reason: COPY_SKIP_REASONS.copyFailed,
                });
                skipped += 1;
              }
              continue;
            }
          }

          for (const metric of companyMetricSet) {
            const sourceValue = toNumber(getCompanyMetricValue(source, metric)) ?? null;
            const destinationValue = toNumber(getCompanyMetricValue(destination, metric)) ?? null;
            let newValue: number | null = destinationValue;
            if (metric === 'headcount') newValue = nextHeadcount;
            if (metric === 'it_users') newValue = nextItUsers;
            if (metric === 'turnover') newValue = nextTurnover;
            results.push({
              entityType: 'company',
              entityId: companyId,
              entityName: companyName,
              metric,
              sourceValue,
              destinationValue,
              newValue,
              skipped: false,
            });
            processed += 1;
          }
        }
      }
    }

    if (includeDepartments) {
      const departmentMetricRepository = manager.getRepository(DepartmentMetric);
      const sourceMetrics = await departmentMetricRepository.find({ where: { fiscal_year: sourceYear } as any });
      const destinationMetrics = await departmentMetricRepository.find({ where: { fiscal_year: destinationYear } as any });
      const sourceMap = new Map<string, DepartmentMetric>();
      for (const row of sourceMetrics) sourceMap.set(row.department_id, row);
      const destinationMap = new Map<string, DepartmentMetric>();
      for (const row of destinationMetrics) destinationMap.set(row.department_id, row);

      const departmentIds = Array.from(new Set([...sourceMap.keys(), ...destinationMap.keys()]));
      if (departmentIds.length > 0) {
        const departments = await manager.getRepository(Department).find({
          where: { id: In(departmentIds) },
          relations: ['company'],
        });
        const departmentNameMap = new Map<string, string>();
        for (const dept of departments) {
          const label = departmentCopyName(dept);
          if (label) departmentNameMap.set(dept.id, label);
        }
        const sortedIds = [...departmentIds].sort((a, b) => {
          const nameA = (departmentNameMap.get(a) ?? '').toLowerCase();
          const nameB = (departmentNameMap.get(b) ?? '').toLowerCase();
          if (nameA < nameB) return -1;
          if (nameA > nameB) return 1;
          return 0;
        });

        for (const departmentId of sortedIds) {
          const deptName = departmentNameMap.get(departmentId) ?? null;
          const source = sourceMap.get(departmentId);
          const destination = destinationMap.get(departmentId);

          if (!source) {
            results.push({
              entityType: 'department',
              entityId: departmentId,
              entityName: deptName,
              metric: 'headcount',
              sourceValue: null,
              destinationValue: toNumber(destination?.headcount) ?? null,
              newValue: null,
              skipped: true,
              reason: COPY_SKIP_REASONS.noSourceData,
            });
            skipped += 1;
            continue;
          }

          const nextHeadcount = toInt(source.headcount);

          if (applyChanges) {
            try {
              await this.departmentMetricsService.upsertForDepartment(departmentId, destinationYear, {
                headcount: nextHeadcount,
              }, userId ?? undefined, { manager });
            } catch (err: any) {
              errors.push({ entityType: 'department', entityId: departmentId, entityName: deptName, message: err?.message ?? 'Unable to copy metrics' });
              results.push({
                entityType: 'department',
                entityId: departmentId,
                entityName: deptName,
                metric: 'headcount',
                sourceValue: toNumber(source.headcount) ?? null,
                destinationValue: toNumber(destination?.headcount) ?? null,
                newValue: null,
                skipped: true,
                reason: COPY_SKIP_REASONS.copyFailed,
              });
              skipped += 1;
              continue;
            }
          }

          results.push({
            entityType: 'department',
            entityId: departmentId,
            entityName: deptName,
            metric: 'headcount',
            sourceValue: toNumber(source.headcount) ?? null,
            destinationValue: toNumber(destination?.headcount) ?? null,
            newValue: nextHeadcount,
            skipped: false,
          });
          processed += 1;
        }
      }
    }

    const totalItems = results.length;
    return {
      success: errors.length === 0,
      dryRun: !applyChanges,
      summary: {
        totalItems,
        processed,
        skipped,
        errors: errors.length,
      },
      results,
      errors,
    };
  }
}
