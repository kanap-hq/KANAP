import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AllocationRule, AllocationRuleMode } from './allocation-rule.entity';
import { AuditService } from '../audit/audit.service';
import {
  AllocationMethod,
  DefaultResolution,
  STANDARD_DEFAULT,
  isAllocationMethod,
  isAllocationRuleMode,
  toDefaultResolution,
} from './allocation-rule-resolver';
import { computeCompanyShares } from './allocation-distribution';

export type AllocationRuleShare = { company_id: string; allocation_pct: number };

export type AllocationRuleResolution = {
  fiscal_year: number;
  /** Effective company set: every enabled company (`auto`) or the tenant selection. */
  mode: AllocationRuleMode;
  /** Effective driver (headcount | it_users | turnover) used to weight the companies. */
  method: AllocationMethod;
  source: 'standard' | 'tenant';
  standard_mode: AllocationRuleMode;
  standard_method: AllocationMethod;
  tenant_mode: AllocationRuleMode | null;
  tenant_method: AllocationMethod | null;
  /** Effective company selection, `manual_company` mode only. */
  company_ids: string[] | null;
  /** Computed split of the effective selection; empty in `auto` mode. */
  shares: AllocationRuleShare[];
  /** Why the effective selection cannot be computed (missing metric, disabled company…). */
  preview_error: string | null;
};

export type AllocationRuleInput = {
  mode?: unknown;
  method?: unknown;
  company_ids?: unknown;
};

function assertYear(year: number): void {
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw new BadRequestException('A valid fiscal year is required');
  }
}

@Injectable()
export class AllocationRulesService {
  constructor(
    @InjectRepository(AllocationRule) private readonly repo: Repository<AllocationRule>,
    private readonly audit: AuditService,
  ) {}

  /**
   * Loads the standard row plus the tenant override for one fiscal year.
   *
   * The RLS policy on `allocation_rules` already restricts reads to the global standard
   * rows and the current tenant's overrides; the explicit `tenant_id` predicate keeps
   * callers that run outside a tenant transaction isolated too.
   */
  private async loadRows(
    tenantId: string | null,
    year: number,
    opts?: { manager?: EntityManager },
  ): Promise<AllocationRule[]> {
    const manager = opts?.manager ?? this.repo.manager;
    const where: any[] = [{ fiscal_year: year, tenant_id: null }];
    if (tenantId) where.push({ fiscal_year: year, tenant_id: tenantId });
    return manager.getRepository(AllocationRule).find({ where } as any);
  }

  /** Splits the manual selection with the same code the calculators run. */
  private async computeShares(
    tenantId: string,
    year: number,
    resolution: DefaultResolution,
    manager: EntityManager,
  ): Promise<{ shares: AllocationRuleShare[]; error: string | null }> {
    if (resolution.kind !== 'manual_company') return { shares: [], error: null };
    try {
      const distribution = await computeCompanyShares({
        manager,
        tenantId,
        fiscalYear: year,
        companyIds: resolution.companyIds,
        driver: resolution.method,
      });
      const shares = Array.from(distribution.entries())
        .map(([company_id, allocation_pct]) => ({ company_id, allocation_pct }))
        .sort((a, b) => b.allocation_pct - a.allocation_pct || a.company_id.localeCompare(b.company_id));
      return { shares, error: null };
    } catch (err) {
      return { shares: [], error: err instanceof Error ? err.message : String(err) };
    }
  }

  async resolve(
    tenantId: string | null,
    year: number,
    opts?: { manager?: EntityManager },
  ): Promise<AllocationRuleResolution> {
    assertYear(year);
    const manager = opts?.manager ?? this.repo.manager;
    const rows = await this.loadRows(tenantId, year, opts);
    const standardRow = rows.find((row) => row.tenant_id == null) ?? null;
    const tenantRow = tenantId ? rows.find((row) => row.tenant_id === tenantId) ?? null : null;

    const standard = toDefaultResolution(standardRow);
    const tenant = tenantRow ? toDefaultResolution(tenantRow) : null;
    const effective = tenant ?? standard;

    const { shares, error } =
      effective.kind === 'manual_company' && tenantId
        ? await this.computeShares(tenantId, year, effective, manager)
        : { shares: [], error: null };

    return {
      fiscal_year: year,
      mode: effective.kind,
      method: effective.method,
      source: tenant ? 'tenant' : 'standard',
      standard_mode: standard.kind,
      standard_method: standard.method,
      tenant_mode: tenant ? tenant.kind : null,
      tenant_method: tenant ? tenant.method : null,
      company_ids: effective.kind === 'manual_company' ? effective.companyIds : null,
      shares,
      preview_error: error,
    };
  }

  /**
   * Configures the tenant's default for a fiscal year.
   *
   * A manual company selection is validated with the exact computation the calculators
   * run, so an unusable selection (foreign tenant, company disabled for the year, missing
   * driver value) is rejected here instead of surfacing on every item left on the default.
   */
  async setTenantMethod(
    tenantId: string | null,
    year: number,
    input: AllocationRuleInput,
    userId?: string | null,
    opts?: { manager?: EntityManager },
  ): Promise<AllocationRuleResolution> {
    if (!tenantId) {
      throw new BadRequestException('A tenant is required to configure the default allocation method');
    }
    assertYear(year);

    const mode = input?.mode ?? 'auto';
    if (!isAllocationRuleMode(mode)) {
      throw new BadRequestException('Invalid allocation mode');
    }
    if (!isAllocationMethod(input?.method)) {
      throw new BadRequestException('Invalid allocation method');
    }

    let companyIds: string[] | null = null;
    if (mode === 'manual_company') {
      const raw = Array.isArray(input?.company_ids) ? input.company_ids : [];
      companyIds = Array.from(new Set(raw.filter((id): id is string => typeof id === 'string' && !!id)));
      if (companyIds.length === 0) {
        throw new BadRequestException('Select at least one company for the default allocation');
      }
    }

    const manager = opts?.manager ?? this.repo.manager;
    if (companyIds) {
      // Preflight only: throws when the selection cannot be computed.
      await computeCompanyShares({
        manager,
        tenantId,
        fiscalYear: year,
        companyIds,
        driver: input.method,
      });
    }

    const repo = manager.getRepository(AllocationRule);
    const existing = await repo.findOne({ where: { tenant_id: tenantId, fiscal_year: year } as any });

    const previous = existing
      ? { mode: existing.mode, method: existing.method, company_ids: existing.company_ids, status: existing.status }
      : null;
    // One statement, an upsert on UNIQUE(tenant_id, fiscal_year): two admins setting a year
    // without rule at once both succeed (the second waits for the first, then updates its
    // row), and the year keeps the rule saved last.
    const [saved]: Array<Pick<AllocationRule, 'id' | 'mode' | 'method' | 'company_ids' | 'status'> & { inserted: boolean }> = await manager.query(
      `INSERT INTO allocation_rules (tenant_id, fiscal_year, mode, method, company_ids, status)
       VALUES ($1, $2, $3, $4, $5::uuid[], 'active')
       ON CONFLICT (tenant_id, fiscal_year) DO UPDATE
         SET mode = EXCLUDED.mode, method = EXCLUDED.method, company_ids = EXCLUDED.company_ids,
             status = EXCLUDED.status, updated_at = now()
       RETURNING id, mode, method, company_ids, status, (xmax = 0) AS inserted`,
      [tenantId, year, mode, input.method, companyIds],
    );

    await this.audit.log(
      {
        table: 'allocation_rules',
        recordId: saved.id,
        action: saved.inserted ? 'create' : 'update',
        before: previous ? { fiscal_year: year, ...previous } : null,
        after: {
          fiscal_year: year,
          mode: saved.mode,
          method: saved.method,
          company_ids: saved.company_ids,
          status: saved.status,
        },
        userId: userId ?? null,
      },
      { manager },
    );

    return this.resolve(tenantId, year, opts);
  }

  /** Drops the tenant override so the year falls back to the standard method. */
  async clearTenantMethod(
    tenantId: string | null,
    year: number,
    userId?: string | null,
    opts?: { manager?: EntityManager },
  ): Promise<AllocationRuleResolution> {
    if (!tenantId) {
      throw new BadRequestException('A tenant is required to configure the default allocation method');
    }
    assertYear(year);

    const manager = opts?.manager ?? this.repo.manager;
    const repo = manager.getRepository(AllocationRule);
    const existing = await repo.findOne({ where: { tenant_id: tenantId, fiscal_year: year } as any });

    if (existing) {
      await repo.delete({ id: existing.id } as any);
      await this.audit.log(
        {
          table: 'allocation_rules',
          recordId: existing.id,
          action: 'delete',
          before: {
            fiscal_year: year,
            mode: existing.mode,
            method: existing.method,
            company_ids: existing.company_ids,
            status: existing.status,
          },
          after: null,
          userId: userId ?? null,
        },
        { manager },
      );
    }

    return this.resolve(tenantId, year, opts);
  }
}
