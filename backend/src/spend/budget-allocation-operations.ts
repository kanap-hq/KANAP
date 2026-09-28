import { BadRequestException } from '@nestjs/common';
import { DeepPartial, EntityManager, In } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { CapexAllocation } from '../capex/capex-allocation.entity';
import { CapexVersion } from '../capex/capex-version.entity';
import { AmountScope } from './amounts-write.util';
import { formatAllocationMethodLabel } from './allocation-utils';
import { currentTenantId, loadItemsValidIn, loadVersions } from './budget-column-operations';
import { SpendAllocation } from './spend-allocation.entity';
import { SpendVersion } from './spend-version.entity';

/**
 * Copy allocations from one year to another, for OPEX and CAPEX alike.
 *
 * Runs inside the request transaction and is all or nothing: an error on any
 * item fails the request. Only a dry run lists an item whose allocation rules
 * refuse it. Manual methods copy their non-system rows; automatic methods only
 * take the source method, their shares are recomputed from the metrics. The
 * allocation driver is not copied.
 */

// Table and entity names come only from here: never from the caller.
const SCOPES = {
  opex: {
    itemFk: 'spend_item_id',
    versions: 'spend_versions', allocations: 'spend_allocations',
    versionEntity: SpendVersion, allocationEntity: SpendAllocation,
  },
  capex: {
    itemFk: 'capex_item_id',
    versions: 'capex_versions', allocations: 'capex_allocations',
    versionEntity: CapexVersion, allocationEntity: CapexAllocation,
  },
} as const;

const MANUAL_METHODS = new Set(['manual_company', 'manual_department', 'manual_pct']);

type AllocationVersion = SpendVersion | CapexVersion;
type AllocationRow = SpendAllocation | CapexAllocation;

export type AllocationOperationDeps = {
  manager: EntityManager;
  audit: Pick<AuditService, 'log'>;
  /** The scope's allocation calculator: throws a BadRequestException when a version's rules refuse it. */
  calculator: {
    computeForVersions(versions: any[], opts: { manager: EntityManager }): Promise<Map<string, { shares: unknown[] }>>;
  };
};

export type CopyAllocationsOperation = {
  sourceYear: number;
  destinationYear: number;
  overwrite?: boolean;
  dryRun?: boolean;
};

type AllocationAction = 'copy' | 'skip_missing_source_version' | 'skip_no_source_allocations' | 'skip_destination_has_data' | 'error';

type AllocationPreview = {
  itemId: string;
  itemName: string;
  sourceMethod: string | null;
  sourceMethodLabel: string;
  destinationMethod: string | null;
  destinationMethodLabel: string;
  resultMethod: string | null;
  resultMethodLabel: string;
  sourceAllocationsCount: number;
  destinationAllocationsCount: number;
  action: AllocationAction;
  message?: string;
};

function emptyPreview(itemId: string, itemName: string, action: AllocationAction, message: string): AllocationPreview {
  return {
    itemId,
    itemName,
    sourceMethod: null,
    sourceMethodLabel: '',
    destinationMethod: null,
    destinationMethodLabel: '',
    resultMethod: null,
    resultMethodLabel: '',
    sourceAllocationsCount: 0,
    destinationAllocationsCount: 0,
    action,
    message,
  };
}

const methodOf = (version: AllocationVersion) => (version.allocation_method as string | undefined) ?? 'default';

/**
 * Shares per source version, computed in one pass. When the rules refuse one
 * version, each version is computed on its own so the refusal lands on its
 * item only (a dry run lists it; a real copy fails with it).
 */
async function sourceShares(
  deps: AllocationOperationDeps,
  versions: AllocationVersion[],
): Promise<Map<string, number | BadRequestException>> {
  const counts = new Map<string, number | BadRequestException>();
  if (versions.length === 0) return counts;
  try {
    const computed = await deps.calculator.computeForVersions(versions, { manager: deps.manager });
    for (const version of versions) counts.set(version.id, computed.get(version.id)?.shares.length ?? 0);
    return counts;
  } catch (error) {
    if (!(error instanceof BadRequestException)) throw error;
  }
  for (const version of versions) {
    try {
      const computed = await deps.calculator.computeForVersions([version], { manager: deps.manager });
      counts.set(version.id, computed.get(version.id)?.shares.length ?? 0);
    } catch (error) {
      if (!(error instanceof BadRequestException)) throw error;
      counts.set(version.id, error);
    }
  }
  return counts;
}

/**
 * Copy the allocations of `sourceYear` to `destinationYear` for every item
 * valid in the destination year (see `validityInYear`), reading the newest
 * version of each item and year (the one the budget tab shows). A missing
 * destination version is created with the source's grain, method and notes.
 */
export async function copyAllocations(
  deps: AllocationOperationDeps,
  scope: AmountScope,
  operation: CopyAllocationsOperation,
  userId: string | null,
) {
  const mg = deps.manager;
  const t = SCOPES[scope];
  const sourceYear = Number(operation?.sourceYear);
  const destinationYear = Number(operation?.destinationYear);
  const overwrite = Boolean(operation?.overwrite);
  const dryRun = Boolean(operation?.dryRun);
  if (!Number.isInteger(sourceYear) || !Number.isInteger(destinationYear)) {
    throw new BadRequestException('sourceYear and destinationYear are required integer values');
  }
  if (sourceYear === destinationYear) {
    throw new BadRequestException('Source year and destination year must be different');
  }

  const tenantId = await currentTenantId(mg);
  const items = await loadItemsValidIn(mg, scope, tenantId, destinationYear);
  const picked = await loadVersions(mg, scope, tenantId, items.map((i) => i.id), [sourceYear, destinationYear]);
  const versionIds = Array.from(picked.values()).map((v) => v.id);
  const versionRepo = mg.getRepository<AllocationVersion>(t.versionEntity);
  const allocationRepo = mg.getRepository<AllocationRow>(t.allocationEntity);
  const entities = versionIds.length
    ? await versionRepo.find({ where: { tenant_id: tenantId, id: In(versionIds) } as any })
    : [];
  const versionById = new Map(entities.map((v) => [v.id, v]));
  const version = (itemId: string, year: number) => {
    const row = picked.get(`${itemId}:${year}`);
    return row ? versionById.get(row.id) : undefined;
  };
  const allocationRows = versionIds.length
    ? await allocationRepo.find({ where: { tenant_id: tenantId, version_id: In(versionIds) } as any })
    : [];
  const manualRows = new Map<string, AllocationRow[]>();
  for (const row of allocationRows) {
    if (row.is_system_generated) continue;
    manualRows.set(row.version_id, [...(manualRows.get(row.version_id) ?? []), row]);
  }
  const sources = items.map((item) => version(item.id, sourceYear)).filter((v): v is AllocationVersion => !!v);
  const shares = await sourceShares(deps, sources);

  const results: AllocationPreview[] = [];
  const recompute: AllocationVersion[] = [];
  let processed = 0;
  let skipped = 0;
  let errors = 0;

  for (const item of items) {
    const sourceVersion = version(item.id, sourceYear);
    if (!sourceVersion) {
      if (dryRun) results.push(emptyPreview(item.id, item.name, 'skip_missing_source_version', `No allocation data for ${sourceYear}`));
      skipped++;
      continue;
    }
    const shareCount = shares.get(sourceVersion.id) ?? 0;
    if (shareCount instanceof BadRequestException) {
      if (!dryRun) throw shareCount;
      errors++;
      results.push(emptyPreview(item.id, item.name, 'error', shareCount.message));
      continue;
    }

    const sourceManual = manualRows.get(sourceVersion.id) ?? [];
    const sourceMethod = methodOf(sourceVersion);
    let destinationVersion = version(item.id, destinationYear);
    const destinationManual = destinationVersion ? manualRows.get(destinationVersion.id) ?? [] : [];
    const destinationMethod = destinationVersion ? methodOf(destinationVersion) : null;
    const isManual = MANUAL_METHODS.has(sourceMethod);

    let action: AllocationAction = 'copy';
    if (isManual && sourceManual.length === 0) action = 'skip_no_source_allocations';
    else if (!overwrite && destinationManual.length > 0) action = 'skip_destination_has_data';
    const resultMethod = action === 'copy' ? sourceMethod : destinationMethod;

    if (dryRun) {
      results.push({
        itemId: item.id,
        itemName: item.name,
        sourceMethod,
        sourceMethodLabel: formatAllocationMethodLabel(sourceMethod),
        destinationMethod,
        destinationMethodLabel: formatAllocationMethodLabel(destinationMethod),
        resultMethod,
        resultMethodLabel: formatAllocationMethodLabel(resultMethod),
        sourceAllocationsCount: shareCount,
        destinationAllocationsCount: destinationManual.length,
        action,
        message: action === 'skip_destination_has_data'
          ? 'Destination already has allocations'
          : action === 'skip_no_source_allocations'
            ? 'No allocations in source year'
            : undefined,
      });
      if (action === 'copy') processed++;
      else skipped++;
      continue;
    }
    if (action !== 'copy') {
      skipped++;
      continue;
    }

    if (!destinationVersion) {
      destinationVersion = await versionRepo.save(versionRepo.create({
        [t.itemFk]: item.id,
        budget_year: destinationYear,
        version_name: `Y${destinationYear}`,
        input_grain: sourceVersion.input_grain ?? 'annual',
        is_approved: false,
        as_of_date: `${destinationYear}-01-01`,
        allocation_method: sourceMethod,
        tenant_id: item.tenant_id,
        notes: sourceVersion.notes ?? null,
      } as unknown as DeepPartial<AllocationVersion>));
      await deps.audit.log(
        { table: t.versions, recordId: destinationVersion.id, action: 'create', before: null, after: destinationVersion, userId },
        { manager: mg },
      );
    } else if (destinationMethod !== sourceMethod) {
      const beforeMethod = destinationVersion.allocation_method;
      await versionRepo.update({ id: destinationVersion.id, tenant_id: tenantId } as any, { allocation_method: sourceMethod } as any);
      await deps.audit.log({
        table: t.versions,
        recordId: destinationVersion.id,
        action: 'update',
        before: { allocation_method: beforeMethod },
        after: { allocation_method: sourceMethod, operation: 'allocation_copy', sourceYear, destinationYear },
        userId,
      }, { manager: mg });
      destinationVersion.allocation_method = sourceMethod as AllocationVersion['allocation_method'];
    }

    if (destinationManual.length > 0) {
      await allocationRepo.delete({ tenant_id: tenantId, version_id: destinationVersion.id } as any);
    }
    if (isManual) {
      const target = destinationVersion;
      await allocationRepo.save(sourceManual.map((row) => allocationRepo.create({
        tenant_id: target.tenant_id,
        version_id: target.id,
        company_id: row.company_id,
        department_id: row.department_id ?? null,
        allocation_pct: Number(row.allocation_pct || 0),
        is_system_generated: false,
        rule_id: null,
        materialized_from: null,
      } as DeepPartial<AllocationRow>)));
    } else {
      recompute.push(destinationVersion);
    }

    await deps.audit.log({
      table: t.allocations,
      recordId: destinationVersion.id,
      action: 'update',
      before: { count: destinationManual.length },
      after: { count: isManual ? sourceManual.length : 0, operation: 'allocation_copy', sourceYear, destinationYear, overwrite },
      userId,
    }, { manager: mg });
    processed++;
  }

  // Automatic methods: the destination rules must accept them; a refusal fails the whole copy.
  if (recompute.length > 0) await deps.calculator.computeForVersions(recompute, { manager: mg });

  return {
    success: errors === 0,
    dryRun,
    summary: { totalItems: items.length, processed, skipped, errors },
    results: dryRun ? results : [],
  };
}
