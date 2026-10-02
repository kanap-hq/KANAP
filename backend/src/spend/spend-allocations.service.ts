import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { SpendAllocation } from './spend-allocation.entity';
import { SpendVersion } from './spend-version.entity';
import { AuditService } from '../audit/audit.service';
import { currentTenantId } from './budget-column-operations';
import { AllocationCalculatorService } from './allocation-calculator.service';
import {
  AllocationInput,
  allocationSignature,
  bulkUpsertAllocations,
  putVersionAllocations,
  readAllocationState,
} from './allocation-save';

/** A version's allocation; the save logic is shared with the other scope (`spend/allocation-save.ts`, lot 3E). */
@Injectable()
export class SpendAllocationsService {
  constructor(
    @InjectRepository(SpendAllocation) private readonly repo: Repository<SpendAllocation>,
    @InjectRepository(SpendVersion) private readonly versions: Repository<SpendVersion>,
    private readonly calculator: AllocationCalculatorService,
    private readonly audit: AuditService,
  ) {}

  /**
   * The rows save (`POST …/allocations/bulk-upsert`, the AI): the rows are read with the method and
   * driver stored on the version. `opts.tenantId` is the request's tenant; without it, the tenant of
   * the request transaction.
   */
  async bulkUpsert(versionId: string, items: AllocationInput[], userId?: string | null, opts?: { manager?: EntityManager; tenantId?: string }) {
    const manager = opts?.manager ?? this.repo.manager;
    const tenantId = opts?.tenantId ?? await currentTenantId(manager);
    return bulkUpsertAllocations({ manager, audit: this.audit, calculator: this.calculator }, 'opex', tenantId, versionId, items, userId);
  }

  /**
   * The Allocations tab's save (`PUT …/versions/:id/allocations`): method, driver and rows in one
   * request, compared with `base_signature` under the version's lock (`allocation-save.ts`). Answers
   * what is stored, its distribution and its new signature.
   */
  async put(versionId: string, body: unknown, userId?: string | null, opts?: { manager?: EntityManager; tenantId?: string }) {
    const manager = opts?.manager ?? this.repo.manager;
    const tenantId = opts?.tenantId ?? await currentTenantId(manager);
    const saved = await putVersionAllocations({ manager, audit: this.audit, calculator: this.calculator }, 'opex', tenantId, versionId, body, userId);
    const listed = await this.listForVersion(versionId, { manager, tenantId });
    return { ...listed, updated: saved.updated };
  }

  /**
   * The version's distribution, with its stored method and driver and the signature the tab sends
   * back as `base_signature` (read in one statement, so the three belong together).
   */
  async listForVersion(versionId: string, opts?: { manager?: EntityManager; tenantId?: string }) {
    const manager = opts?.manager ?? this.repo.manager;
    const tenantId = opts?.tenantId ?? await currentTenantId(manager);
    const version = await manager.getRepository(SpendVersion).findOne({ where: { id: versionId, tenant_id: tenantId } });
    if (!version) throw new BadRequestException('Invalid version');
    const state = await readAllocationState(manager, 'opex', tenantId, versionId);

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
      method: state?.method ?? 'default',
      driver: state?.driver ?? 'headcount',
      base_signature: state ? allocationSignature(state) : null,
    };
  }
}
