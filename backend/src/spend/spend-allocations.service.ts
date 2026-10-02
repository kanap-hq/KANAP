import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { SpendAllocation } from './spend-allocation.entity';
import { AuditService } from '../audit/audit.service';
import { currentTenantId } from './budget-column-operations';
import { SpendVersion } from './spend-version.entity';
import { AllocationCalculatorService } from './allocation-calculator.service';
import { Company } from '../companies/company.entity';
import { Department } from '../departments/department.entity';
import { DepartmentMetric } from '../departments/department-metric.entity';
import {
  AllocationDriver,
  computeCompanyShares,
  normalizeWeights,
} from './allocation-distribution';
import { sameAllocationRows } from './budget-allocation-operations';
import { lockVersionWithLine } from './budget-locks';

type AllocationInput = {
  company_id: string;
  department_id: string | null;
  allocation_pct?: number;
  driver_type?: string | null;
  driver_note?: string | null;
};

@Injectable()
export class SpendAllocationsService {
  constructor(
    @InjectRepository(SpendAllocation) private readonly repo: Repository<SpendAllocation>,
    @InjectRepository(SpendVersion) private readonly versions: Repository<SpendVersion>,
    private readonly calculator: AllocationCalculatorService,
    private readonly audit: AuditService,
  ) {}

  /** `opts.tenantId` is the request's tenant; without it, the tenant of the request transaction. */
  async bulkUpsert(versionId: string, items: AllocationInput[], userId?: string, opts?: { manager?: EntityManager; tenantId?: string }) {
    const manager = opts?.manager ?? this.repo.manager;
    const repo = manager.getRepository(SpendAllocation);
    const versions = manager.getRepository(SpendVersion);
    if (!Array.isArray(items)) throw new BadRequestException('Invalid payload');

    const tenantId = opts?.tenantId ?? await currentTenantId(manager);
    // Lock order (`budget-locks.ts`): the line, then the version, before its allocations are read
    // or replaced: two saves of one version take turns, so it ends with one split, never both.
    if (!(await lockVersionWithLine(manager, 'opex', tenantId, versionId))) throw new BadRequestException('Invalid version');
    const version = await versions.findOne({ where: { id: versionId, tenant_id: tenantId } });
    if (!version) throw new BadRequestException('Invalid version');
    const method = (version.allocation_method as any) ?? 'default';
    const driver = (version.allocation_driver as any) ?? 'headcount';

    const isManualCompany = method === 'manual_company';
    const isManualDept = method === 'manual_department';
    const isManualPct = method === 'manual_pct';
    const isAuto = !isManualCompany && !isManualDept && !isManualPct; // default/headcount/it_users/turnover

    if ((isManualCompany || isManualDept || isManualPct) && items.length === 0) {
      throw new BadRequestException('No allocations provided for manual method');
    }

    if (isAuto) {
      if (items.length > 0) {
        throw new BadRequestException('Automatic allocation methods do not accept manual rows. Save without overrides.');
      }

      const before = await repo.find({ where: { tenant_id: tenantId, version_id: versionId } });
      if (before.length > 0) {
        await repo.delete({ tenant_id: tenantId, version_id: versionId } as any);
      }

      const computation = await this.calculator.computeForVersions([version], { manager, tenantId });
      const distribution = computation.get(versionId);
      const total = distribution?.shares.reduce((acc, share) => acc + Number(share.allocation_pct || 0), 0) ?? 0;

      await this.audit.log({
        table: 'spend_allocations',
        recordId: null,
        action: 'update',
        before,
        after: [],
        userId,
      }, { manager });

      return { updated: 0, total_pct: Math.round(total * 10000) / 10000 };
    }

    const before = await repo.find({ where: { tenant_id: tenantId, version_id: versionId } });
    let next: SpendAllocation[] = [];

    if (isManualPct) {
      // True manual percentages — persist exactly what the user entered (validated to 100%).
      const rows = items
        .filter((row) => row.company_id)
        .map((row) => ({ company_id: row.company_id, allocation_pct: Number(row.allocation_pct ?? 0) }));
      if (rows.length === 0) {
        throw new BadRequestException('Select at least one company for manual allocation.');
      }
      if (rows.some((row) => !Number.isFinite(row.allocation_pct) || row.allocation_pct < 0)) {
        throw new BadRequestException('Allocation percentages must be zero or positive numbers.');
      }
      const sum = rows.reduce((acc, row) => acc + row.allocation_pct, 0);
      if (sum < 99.99 || sum > 100.01) {
        throw new BadRequestException(`Manual percentages must sum to 100% (currently ${Math.round(sum * 100) / 100}%).`);
      }
      // Every company is resolved in the tenant: a foreign key does not check it.
      const companyIds = Array.from(new Set(rows.map((row) => row.company_id)));
      const found = await manager.getRepository(Company).count({ where: { tenant_id: tenantId, id: In(companyIds) } as any });
      if (found !== companyIds.length) {
        throw new BadRequestException('One or more companies were not found.');
      }
      // One row per company (unique key on version, company, department): a company picked
      // on two lines gets their percentages added, the split it had before.
      const byCompany = new Map<string, number>();
      for (const row of rows) byCompany.set(row.company_id, (byCompany.get(row.company_id) ?? 0) + row.allocation_pct);
      next = Array.from(byCompany, ([company_id, allocation_pct]) => ({ company_id, allocation_pct })).map((row) =>
        repo.create({
          version_id: versionId,
          company_id: row.company_id,
          department_id: null,
          allocation_pct: Math.round(row.allocation_pct * 10000) / 10000,
          is_system_generated: false,
          rule_id: null,
          materialized_from: null,
          tenant_id: tenantId,
        }),
      );
    } else if (isManualCompany) {
      const uniqueCompanyIds = Array.from(new Set(items.map((row) => row.company_id).filter((id): id is string => !!id)));
      if (uniqueCompanyIds.length === 0) {
        throw new BadRequestException('Select at least one company for manual allocation.');
      }

      const distribution = await computeCompanyShares({
        manager,
        tenantId,
        fiscalYear: (version as any).budget_year,
        companyIds: uniqueCompanyIds,
        driver: driver as AllocationDriver,
      });

      next = uniqueCompanyIds.map((companyId) =>
        repo.create({
          version_id: versionId,
          company_id: companyId,
          department_id: null,
          allocation_pct: distribution.get(companyId) ?? 0,
          is_system_generated: false,
          rule_id: null,
          materialized_from: null,
          tenant_id: tenantId,
        }),
      );
    } else if (isManualDept) {
      const selections = items
        .filter((row) => row.company_id && row.department_id)
        .map((row) => ({ company_id: row.company_id, department_id: row.department_id as string }));

      if (selections.length === 0) {
        throw new BadRequestException('Select at least one department for manual allocation.');
      }

      const computed = await this.computeManualDepartmentDistribution({
        manager,
        tenantId,
        fiscalYear: (version as any).budget_year,
        selections,
      });

      next = computed.map((row) =>
        repo.create({
          version_id: versionId,
          company_id: row.company_id,
          department_id: row.department_id,
          allocation_pct: row.allocation_pct,
          is_system_generated: false,
          rule_id: null,
          materialized_from: null,
          tenant_id: tenantId,
        }),
      );
    }

    // The split already stored, saved again, writes nothing: no row replaced, no audit row
    // (and no budget_rev bump of the version, migration 1853740000000).
    let after: SpendAllocation[] = before;
    if (!sameAllocationRows(before, next)) {
      await repo.delete({ tenant_id: tenantId, version_id: versionId } as any);
      after = await repo.save(next);
      await this.audit.log({ table: 'spend_allocations', recordId: null, action: 'update', before, after, userId }, { manager });
    }
    const finalTotal = after.reduce((acc, it) => acc + Number(it.allocation_pct || 0), 0);

    return { updated: after.length, total_pct: Math.round(finalTotal * 10000) / 10000 };
  }

  async listForVersion(versionId: string, opts?: { manager?: EntityManager; tenantId?: string }) {
    const manager = opts?.manager ?? this.repo.manager;
    const tenantId = opts?.tenantId ?? await currentTenantId(manager);
    const version = await manager.getRepository(SpendVersion).findOne({ where: { id: versionId, tenant_id: tenantId } });
    if (!version) throw new BadRequestException('Invalid version');

    const computation = await this.calculator.computeForVersions([version], { manager, tenantId });
    const dist = computation.get(versionId);
    const items = (dist?.shares ?? []).map((share) => ({
      id: share.allocation_id ?? null,
      company_id: share.company_id,
      department_id: share.department_id,
      allocation_pct: share.allocation_pct,
      source: share.source,
    }));
    const total = items.reduce((acc, it) => acc + Number(it.allocation_pct || 0), 0);

    return {
      items,
      total_pct: Math.round(total * 10000) / 10000,
      resolved_method: dist?.resolvedMethod ?? null,
    };
  }

  private async computeManualDepartmentDistribution(args: {
    manager: EntityManager;
    tenantId: string;
    fiscalYear: number;
    selections: Array<{ company_id: string; department_id: string }>;
  }): Promise<Array<{ company_id: string; department_id: string; allocation_pct: number }>> {
    const { manager, tenantId, fiscalYear, selections } = args;
    const uniqueDeptIds = Array.from(new Set(selections.map((s) => s.department_id)));

    const departments = await manager.getRepository(Department).find({
      where: {
        tenant_id: tenantId,
        id: In(uniqueDeptIds) as any,
      } as any,
    });
    if (departments.length !== uniqueDeptIds.length) {
      throw new BadRequestException('Some departments could not be found for manual allocation.');
    }

    const metrics = await manager.getRepository(DepartmentMetric).find({
      where: {
        tenant_id: tenantId,
        fiscal_year: fiscalYear,
        department_id: In(uniqueDeptIds) as any,
      } as any,
    });

    const weights = uniqueDeptIds.map((deptId) => {
      const metric = metrics.find((m) => m.department_id === deptId);
      return { id: deptId, weight: Number(metric?.headcount ?? 0) };
    });

    if (weights.some((entry) => !Number.isFinite(entry.weight) || entry.weight <= 0)) {
      throw new BadRequestException('Provide headcount values for the selected departments.');
    }

    const distribution = normalizeWeights(weights);
    return distribution.map(({ id, pct }) => {
      const department = departments.find((d) => d.id === id)!;
      const provided = selections.find((s) => s.department_id === id);
      if (provided?.company_id && provided.company_id !== department.company_id) {
        throw new BadRequestException('Department does not belong to the selected company.');
      }
      return {
        company_id: department.company_id,
        department_id: id,
        allocation_pct: pct,
      };
    });
  }
}
