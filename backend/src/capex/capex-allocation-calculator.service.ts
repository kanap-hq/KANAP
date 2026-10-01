import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Raw, Repository } from 'typeorm';
import { CapexAllocation } from './capex-allocation.entity';
import { CapexVersion } from './capex-version.entity';
import { AllocationRule } from '../spend/allocation-rule.entity';
import {
  DefaultResolution,
  STANDARD_DEFAULT,
  buildDefaultLookup,
  defaultMethodKey,
} from '../spend/allocation-rule-resolver';
import {
  AllocationDriver,
  computeCompanyShares,
  normalizeWeights,
} from '../spend/allocation-distribution';
import { Company } from '../companies/company.entity';
import { CompanyMetric } from '../companies/company-metric.entity';
import { Department } from '../departments/department.entity';
import { DepartmentMetric } from '../departments/department-metric.entity';

export type CapexAllocationSource = 'manual' | 'auto';

export type CapexAllocationShare = {
  allocation_id?: string;
  company_id: string;
  department_id: string | null;
  allocation_pct: number;
  source: CapexAllocationSource;
};

export type CapexAllocationComputation = {
  versionId: string;
  resolvedMethod: 'headcount' | 'it_users' | 'turnover' | 'manual_company' | 'manual_department' | 'manual_pct';
  shares: CapexAllocationShare[];
  error?: string | null;
};

@Injectable()
export class CapexAllocationCalculatorService {
  private readonly logger = new Logger(CapexAllocationCalculatorService.name);
  constructor(
    @InjectRepository(CapexAllocation) private readonly allocations: Repository<CapexAllocation>,
    @InjectRepository(AllocationRule) private readonly rules: Repository<AllocationRule>,
    @InjectRepository(Company) private readonly companies: Repository<Company>,
    @InjectRepository(CompanyMetric) private readonly metrics: Repository<CompanyMetric>,
  ) {}

  /**
   * Shares of the given versions. One call works on one tenant: `opts.tenantId`
   * is the request's tenant, every version must belong to it (a version of
   * another tenant throws), and every read is scoped to it.
   */
  async computeForVersions(
    versions: CapexVersion[],
    opts: { manager?: EntityManager; tenantId: string; suppressErrors?: boolean },
  ): Promise<Map<string, CapexAllocationComputation>> {
    const result = new Map<string, CapexAllocationComputation>();
    if (!versions || versions.length === 0) {
      return result;
    }

    const tenantId = opts?.tenantId;
    if (!tenantId) throw new InternalServerErrorException('Allocations need a tenant.');
    if (versions.some((v) => v.tenant_id !== tenantId)) {
      throw new InternalServerErrorException('Allocations are computed for versions of one tenant only.');
    }
    const manager = opts.manager ?? this.allocations.manager;
    const suppressErrors = opts.suppressErrors ?? false;
    const versionIds = versions.map((v) => v.id);

    const rawAllocations = await manager.getRepository(CapexAllocation).find({
      where: { tenant_id: tenantId, version_id: In(versionIds) as any } as any,
    });
    const manualRowsByVersion = new Map<string, CapexAllocation[]>();
    const persistedRowsByVersion = new Map<string, CapexAllocation[]>();
    for (const row of rawAllocations) {
      const allArr = persistedRowsByVersion.get(row.version_id) ?? [];
      allArr.push(row);
      persistedRowsByVersion.set(row.version_id, allArr);
      if (row.is_system_generated) continue;
      const manualArr = manualRowsByVersion.get(row.version_id) ?? [];
      manualArr.push(row);
      manualRowsByVersion.set(row.version_id, manualArr);
    }

    const autoVersions = versions.filter((v) => !['manual_company', 'manual_department', 'manual_pct'].includes((v as any).allocation_method ?? 'default'));
    // Consider all versions to build the set of distinct years in scope.
    const years = Array.from(new Set(versions.map((v) => v.budget_year))).sort();

    let defaultLookup = new Map<string, DefaultResolution>();
    // A manual company default is identical for every version of one (tenant, fiscal year):
    // compute it once per key instead of once per version (lists and reports run hundreds).
    // The promise is cached so a rejected selection surfaces the same error on each version.
    const manualDefaultShares = new Map<string, Promise<Map<string, number>>>();
    if (years.length > 0) {
      // Global defaults (no tenant) and this tenant's overrides.
      const scope: any[] = [
        { fiscal_year: In(years) as any, tenant_id: IsNull() },
        { fiscal_year: In(years) as any, tenant_id: tenantId },
      ];
      const rules = await manager.getRepository(AllocationRule).find({ where: scope } as any);
      defaultLookup = buildDefaultLookup(rules, [tenantId]);
    }

    // Year-aware enabled filters per year in scope.
    const enabledCompaniesByYear = new Map<number, Company[]>();
    if (years.length > 0) {
      // One read for every year in scope, from the earliest year's start; each year keeps its own.
      const yearStart = (y: number) => new Date(`${String(y).padStart(4, '0')}-01-01T00:00:00.000Z`);
      const companies = await manager.getRepository(Company).find({
        where: {
          tenant_id: tenantId,
          disabled_at: Raw((alias) => `${alias} IS NULL OR ${alias} >= :period_start`, { period_start: yearStart(Math.min(...years)) }),
        },
      } as any);
      for (const y of years) {
        const periodStart = yearStart(y).getTime();
        enabledCompaniesByYear.set(y, companies.filter((c) => c.disabled_at == null || new Date(c.disabled_at).getTime() >= periodStart));
      }
    }

    const allCompanyIds = new Set<string>();
    enabledCompaniesByYear.forEach((list) => list.forEach((c) => allCompanyIds.add(c.id)));
    const companyIds = Array.from(allCompanyIds);
    const metricsByYear = new Map<number, Map<string, CompanyMetric>>();
    if (years.length > 0 && companyIds.length > 0) {
      const metricRows = await manager.getRepository(CompanyMetric).find({
        where: {
          tenant_id: tenantId,
          fiscal_year: In(years) as any,
          company_id: In(companyIds) as any,
        } as any,
      });
      for (const row of metricRows) {
        let byCompany = metricsByYear.get(row.fiscal_year);
        if (!byCompany) {
          byCompany = new Map<string, CompanyMetric>();
          metricsByYear.set(row.fiscal_year, byCompany);
        }
        byCompany.set(row.company_id, row);
      }
    }

    for (const version of versions) {
      const method = ((version as any).allocation_method ?? 'default') as string;
      if (method === 'manual_pct') {
        const rows = manualRowsByVersion.get(version.id) ?? [];
        result.set(version.id, {
          versionId: version.id,
          resolvedMethod: 'manual_pct',
          shares: rows.map((row) => ({
            allocation_id: row.id,
            company_id: row.company_id,
            department_id: row.department_id ?? null,
            allocation_pct: Number(row.allocation_pct || 0),
            source: 'manual' as CapexAllocationSource,
          })),
          error: null,
        });
        continue;
      }
      if (method === 'manual_company' || method === 'manual_department') {
        const rows = manualRowsByVersion.get(version.id) ?? [];
        const fallbackShares = rows.map((row) => ({
          allocation_id: row.id,
          company_id: row.company_id,
          department_id: row.department_id ?? null,
          allocation_pct: Number(row.allocation_pct || 0),
          source: 'manual' as CapexAllocationSource,
        }));

        try {
          if (method === 'manual_company') {
            const companyIds = Array.from(new Set(rows.map((row) => row.company_id).filter((id): id is string => !!id)));
            if (companyIds.length === 0) {
              result.set(version.id, {
                versionId: version.id,
                resolvedMethod: method as any,
                shares: [],
                error: 'Select at least one company for manual allocation.',
              });
              continue;
            }

            const distribution = await computeCompanyShares({
              manager,
              tenantId,
              fiscalYear: version.budget_year,
              companyIds,
              driver: ((version as any).allocation_driver ?? 'headcount') as AllocationDriver,
            });

            const shares = rows.map((row) => ({
              allocation_id: row.id,
              company_id: row.company_id,
              department_id: null,
              allocation_pct: distribution.get(row.company_id) ?? 0,
              source: 'manual' as CapexAllocationSource,
            }));

            result.set(version.id, {
              versionId: version.id,
              resolvedMethod: method as any,
              shares,
              error: null,
            });
            continue;
          }

          if (method === 'manual_department') {
            const deptIds = Array.from(new Set(rows.map((row) => row.department_id).filter((id): id is string => !!id)));
            if (deptIds.length === 0) {
              result.set(version.id, {
                versionId: version.id,
                resolvedMethod: method as any,
                shares: [],
                error: 'Select at least one department for manual allocation.',
              });
              continue;
            }

            const distribution = await this.computeManualDepartmentShares({
              manager,
              tenantId,
              fiscalYear: version.budget_year,
              departmentIds: deptIds,
            });

            const shares = rows.map((row) => {
              const entry = distribution.get(row.department_id ?? '') ?? { company_id: row.company_id, allocation_pct: 0 };
              return {
                allocation_id: row.id,
                company_id: entry.company_id,
                department_id: row.department_id ?? null,
                allocation_pct: entry.allocation_pct,
                source: 'manual' as CapexAllocationSource,
              };
            });

            result.set(version.id, {
              versionId: version.id,
              resolvedMethod: method as any,
              shares,
              error: null,
            });
            continue;
          }
        } catch (err) {
          if (suppressErrors && fallbackShares.length > 0 && err instanceof BadRequestException) {
            this.logger.warn(`Manual allocation computation warning for version ${version.id}: ${err.message}. Using stored allocation.`);
            result.set(version.id, {
              versionId: version.id,
              resolvedMethod: method as any,
              shares: fallbackShares,
              error: err.message,
            });
            continue;
          }
          throw err;
        }
      }

      const resolvedDefault = this.resolveDefault(method, version.budget_year, tenantId, defaultLookup);

      // A tenant-wide manual company selection spreads the driver over the selected
      // companies only. No stored allocation backs it, so an unusable selection surfaces
      // an error instead of silently renormalising the chargeback over other companies.
      if (resolvedDefault.kind === 'manual_company') {
        try {
          const key = defaultMethodKey(tenantId, version.budget_year);
          let pending = manualDefaultShares.get(key);
          if (!pending) {
            pending = computeCompanyShares({
              manager,
              tenantId,
              fiscalYear: version.budget_year,
              companyIds: resolvedDefault.companyIds,
              driver: resolvedDefault.method,
            });
            manualDefaultShares.set(key, pending);
          }
          const distribution = await pending;
          const shares = Array.from(distribution.entries())
            .map(([company_id, allocation_pct]) => ({
              company_id,
              department_id: null,
              allocation_pct,
              source: 'manual' as CapexAllocationSource,
            }))
            .sort((a, b) => b.allocation_pct - a.allocation_pct || a.company_id.localeCompare(b.company_id));
          result.set(version.id, {
            versionId: version.id,
            resolvedMethod: 'manual_company',
            shares,
            error: null,
          });
        } catch (err) {
          if (suppressErrors && err instanceof BadRequestException) {
            this.logger.warn(`Manual default allocation failed for version ${version.id}: ${err.message}`);
            result.set(version.id, {
              versionId: version.id,
              resolvedMethod: 'manual_company',
              shares: [],
              error: err.message,
            });
          } else {
            throw err;
          }
        }
        continue;
      }
      const persistedShares = (persistedRowsByVersion.get(version.id) ?? [])
        .map((row) => ({
          allocation_id: row.id,
          company_id: row.company_id,
          department_id: row.department_id ?? null,
          allocation_pct: Number(row.allocation_pct || 0),
          source: 'auto' as CapexAllocationSource,
        }))
        .filter((share) => Number.isFinite(share.allocation_pct) && Math.abs(share.allocation_pct) > 0);
      const persistedFallback = () => persistedShares.length > 0 ? persistedShares : null;

      const companiesForYear = enabledCompaniesByYear.get(version.budget_year) ?? [];
      if (companiesForYear.length === 0) {
        if (!suppressErrors) {
          throw new BadRequestException('No enabled companies for allocation distribution');
        }
        this.logger.warn(`Allocation computation skipped for version ${version.id}: No enabled companies for allocation distribution`);
        const fallback = persistedFallback();
        if (fallback) {
          result.set(version.id, {
            versionId: version.id,
            resolvedMethod: resolvedDefault.method,
            shares: fallback,
            error: 'No enabled companies for allocation distribution. Using last stored allocation.',
          });
        } else {
          result.set(version.id, {
            versionId: version.id,
            resolvedMethod: resolvedDefault.method,
            shares: [],
            error: 'No enabled companies for allocation distribution',
          });
        }
        continue;
      }

      const metricsForYear = metricsByYear.get(version.budget_year) ?? new Map<string, CompanyMetric>();
      try {
        const shares = this.computeAutoShares({
          companies: companiesForYear,
          metricsForYear,
          method: resolvedDefault.method,
        });
        result.set(version.id, {
          versionId: version.id,
          resolvedMethod: resolvedDefault.method,
          shares,
          error: null,
        });
      } catch (err) {
        if (suppressErrors && err instanceof BadRequestException) {
          const fallback = persistedFallback();
          if (fallback) {
            this.logger.warn(`Allocation computation warning for version ${version.id}: ${err.message}. Falling back to stored allocations.`);
            result.set(version.id, {
              versionId: version.id,
              resolvedMethod: resolvedDefault.method,
              shares: fallback,
              error: `${err.message} (used stored allocation)`,
            });
            continue;
          }
          this.logger.warn(`Allocation computation warning for version ${version.id}: ${err.message}. No stored allocation available.`);
          result.set(version.id, {
            versionId: version.id,
            resolvedMethod: resolvedDefault.method,
            shares: [],
            error: err.message,
          });
          continue;
        }
        throw err;
      }
    }

    return result;
  }

  private resolveDefault(
    method: string,
    year: number,
    tenantId: string | null,
    defaultLookup: Map<string, DefaultResolution>,
  ): DefaultResolution {
    if (method === 'headcount' || method === 'it_users' || method === 'turnover') {
      return { kind: 'auto', method };
    }
    return defaultLookup.get(defaultMethodKey(tenantId, year)) ?? STANDARD_DEFAULT;
  }

  private computeAutoShares(args: {
    companies: Company[];
    metricsForYear: Map<string, CompanyMetric>;
    method: 'headcount' | 'it_users' | 'turnover';
  }): CapexAllocationShare[] {
    const { companies, metricsForYear, method } = args;
    if (!companies || companies.length === 0) {
      throw new BadRequestException('No enabled companies for distribution');
    }

    const extracted: Array<{ company: Company; weight: number }> = [];
    for (const company of companies) {
      const metric = metricsForYear.get(company.id);
      let raw: number | null = null;
      if (method === 'headcount') raw = metric != null && metric.headcount != null ? Number(metric.headcount) : null;
      else if (method === 'it_users') raw = metric != null && metric.it_users != null ? Number(metric.it_users) : null;
      else if (method === 'turnover') raw = metric != null && metric.turnover != null ? Number(metric.turnover) : null;
      if (raw == null || !Number.isFinite(raw) || raw <= 0) {
        continue; // silently exclude companies without usable data
      }
      extracted.push({ company, weight: raw });
    }

    let shares: CapexAllocationShare[] = [];

    const sum = extracted.reduce((acc, it) => acc + Number(it.weight || 0), 0);
    if (sum > 0 && extracted.length > 0) {
      let accumulated = 0;
      for (let i = 0; i < extracted.length; i++) {
        const { company, weight } = extracted[i];
        let pct = (100 * weight) / sum;
        pct = Math.max(0, Math.round(pct * 10000) / 10000);
        if (i === extracted.length - 1) {
          pct = Math.max(0, Math.round((100 - accumulated) * 10000) / 10000);
        } else {
          accumulated += pct;
        }
        if (pct <= 0) continue;
        shares.push({
          company_id: company.id,
          department_id: null,
          allocation_pct: pct,
          source: 'auto',
        });
      }
    } else {
      // No usable metrics -> split evenly across all enabled companies
      const targets = companies.slice();
      if (targets.length === 0) {
        return [];
      }
      let accumulated = 0;
      for (let i = 0; i < targets.length; i++) {
        let pct = 100 / targets.length;
        pct = Math.round(pct * 10000) / 10000;
        if (i === targets.length - 1) {
          pct = Math.max(0, Math.round((100 - accumulated) * 10000) / 10000);
        } else {
          accumulated += pct;
        }
        if (pct <= 0) continue;
        shares.push({
          company_id: targets[i].id,
          department_id: null,
          allocation_pct: pct,
          source: 'auto',
        });
      }
    }

    shares.sort((a, b) => b.allocation_pct - a.allocation_pct || a.company_id.localeCompare(b.company_id));
    return shares;
  }

  private async computeManualDepartmentShares(args: {
    manager: EntityManager;
    tenantId: string;
    fiscalYear: number;
    departmentIds: string[];
  }): Promise<Map<string, { company_id: string; allocation_pct: number }>> {
    const { manager, tenantId, fiscalYear, departmentIds } = args;
    // Year-aware disabled filter for manual department allocations (fiscalYear-aware).
    const periodStart = new Date(`${String(fiscalYear).padStart(4, '0')}-01-01T00:00:00.000Z`);
    const departments = await manager.getRepository(Department).find({
      where: {
        tenant_id: tenantId,
        id: In(departmentIds) as any,
        disabled_at: Raw((alias) => `${alias} IS NULL OR ${alias} >= :period_start`, { period_start: periodStart }),
      } as any,
    });
    if (departments.length !== departmentIds.length) {
      throw new BadRequestException('Some departments could not be found for manual allocation.');
    }

    const metrics = await manager.getRepository(DepartmentMetric).find({
      where: {
        tenant_id: tenantId,
        fiscal_year: fiscalYear,
        department_id: In(departmentIds) as any,
      } as any,
    });

    const weights = departmentIds.map((deptId) => {
      const metric = metrics.find((m) => m.department_id === deptId);
      return { id: deptId, weight: Number(metric?.headcount ?? 0) };
    });

    if (weights.some((entry) => !Number.isFinite(entry.weight) || entry.weight <= 0)) {
      throw new BadRequestException('Provide headcount values for the selected departments.');
    }

    const distribution = normalizeWeights(weights);
    const map = new Map<string, { company_id: string; allocation_pct: number }>();
    distribution.forEach(({ id, pct }) => {
      const department = departments.find((d) => d.id === id)!;
      map.set(id, { company_id: department.company_id, allocation_pct: pct });
    });
    return map;
  }
}
