import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BusinessProcess } from './business-process.entity';
import { AuditService } from '../audit/audit.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { checkIds, RecordInUseException, refusalDetails, refusalsFrom, type DeleteRefusal, type UsageCount } from '../common/record-in-use';
import { withSavepoint } from '../common/savepoint.util';
import { businessProcessDepthSql, lockBusinessProcessTree } from './business-process-tree';

/** One process of a selection, with what can hold its delete. */
type ProcessHold = {
  id: string;
  name: string;
  depth: number;
  /** Direct sub-processes whose id is outside the selection. */
  outsideChildren: number;
  /** Direct sub-processes that are in the selection. */
  selectedChildren: string[];
  applications: number;
  interfaces: number;
};

function usageCounts(hold: { applications: number; interfaces: number }): UsageCount[] {
  const usages: UsageCount[] = [];
  if (hold.applications > 0) usages.push({ type: 'applications', total: hold.applications });
  if (hold.interfaces > 0) usages.push({ type: 'interfaces', total: hold.interfaces });
  return usages;
}

/**
 * What holds each process of `selection`: its direct sub-processes outside the selection, its
 * direct sub-processes inside it, and the applications and interfaces that name it. `selectionRefusals`
 * counts a selected sub-process only when that sub-process is refused itself.
 */
async function loadSelectionHolds(manager: EntityManager, selection: readonly string[]): Promise<Map<string, ProcessHold>> {
  const rows: Array<{
    id: string;
    name: string;
    parent_id: string | null;
    depth: number | string;
    outside_children: number | string;
    applications: number | string;
    interfaces: number | string;
  }> = selection.length === 0 ? [] : await manager.query(
    `SELECT bp.id::text AS id,
            bp.name,
            bp.parent_id::text AS parent_id,
            ${businessProcessDepthSql('bp')}::int AS depth,
            (SELECT count(*)::int FROM business_processes c
              WHERE c.tenant_id = bp.tenant_id AND c.parent_id = bp.id
                AND NOT (c.id = ANY($1::uuid[]))) AS outside_children,
            (SELECT count(DISTINCT abp.application_id)::int FROM application_business_processes abp
              WHERE abp.tenant_id = bp.tenant_id AND abp.business_process_id = bp.id) AS applications,
            (SELECT count(*)::int FROM interfaces i
              WHERE i.tenant_id = bp.tenant_id AND i.business_process_id = bp.id) AS interfaces
       FROM business_processes bp
      WHERE bp.tenant_id = app_current_tenant() AND bp.id = ANY($1::uuid[])`,
    [selection],
  );
  const selected = new Set(selection.map((id) => id.toLowerCase()));
  const selectedChildren = new Map<string, string[]>();
  for (const row of rows) {
    const id = row.id.toLowerCase();
    const parentId = row.parent_id?.toLowerCase() ?? null;
    if (parentId && selected.has(parentId)) {
      selectedChildren.set(parentId, [...(selectedChildren.get(parentId) ?? []), id]);
    }
  }
  return new Map(rows.map((row) => {
    const id = row.id.toLowerCase();
    return [id, {
      id,
      name: row.name,
      depth: Number(row.depth) || 0,
      outsideChildren: Number(row.outside_children) || 0,
      selectedChildren: selectedChildren.get(id) ?? [],
      applications: Number(row.applications) || 0,
      interfaces: Number(row.interfaces) || 0,
    }];
  }));
}

/**
 * The refusals of deleting `ids` together, walked deepest first. A sub-process counts when it is
 * outside the selection or refused itself, so a parent whose every sub-process is selected and
 * deleted is not refused. Nothing is written.
 */
function selectionRefusals(holds: Map<string, ProcessHold>, ids: readonly string[]): Map<string, RecordInUseException> {
  const refused = new Map<string, RecordInUseException>();
  const ordered = ids
    .map((id, index) => ({ id: id.toLowerCase(), index, depth: holds.get(id.toLowerCase())?.depth ?? -1 }))
    .sort((a, b) => b.depth - a.depth || a.index - b.index);
  for (const { id } of ordered) {
    const hold = holds.get(id);
    if (!hold) continue;
    const refusedChildren = hold.selectedChildren.filter((childId) => refused.has(childId)).length;
    const refusal = processRefusal(hold.name, { children: hold.outsideChildren + refusedChildren, usages: usageCounts(hold) });
    if (refusal) refused.set(id, refusal);
  }
  return refused;
}

/**
 * Deeper processes first, then in the order asked. The parent key is `ON DELETE NO ACTION`, so a
 * parent selected with its sub-processes can be deleted only once those sub-processes are gone.
 * Unknown ids sort last and keep their place among themselves.
 */
async function deleteOrder(manager: EntityManager, ids: readonly string[]): Promise<string[]> {
  const valid = checkIds(ids);
  const depth = new Map<string, number>();
  if (valid.length > 0) {
    const rows: Array<{ id: string; depth: number | string }> = await manager.query(
      `SELECT bp.id::text AS id, ${businessProcessDepthSql('bp')}::int AS depth
         FROM business_processes bp
        WHERE bp.tenant_id = app_current_tenant() AND bp.id = ANY($1::uuid[])`,
      [valid],
    );
    for (const row of rows) depth.set(row.id.toLowerCase(), Number(row.depth) || 0);
  }
  return ids
    .map((id, index) => ({ id, index, depth: depth.get(String(id).toLowerCase()) ?? -1 }))
    .sort((a, b) => b.depth - a.depth || a.index - b.index)
    .map((entry) => entry.id);
}

/**
 * The refusal of a process's delete, or null: `BUSINESS_PROCESS_HAS_SUB_PROCESSES` while
 * sub-processes sit under it (move or delete them first), else `BUSINESS_PROCESS_IN_USE`
 * (applications and interfaces counted, disable it instead).
 */
function processRefusal(name: string, held: { children: number; usages: UsageCount[] } | undefined): RecordInUseException | null {
  if (!held) return null;
  if (held.children > 0) {
    return new RecordInUseException('BUSINESS_PROCESS_HAS_SUB_PROCESSES', 'business process', name, [{ type: 'sub_processes', total: held.children }],
      `Cannot delete business process "${name}": it has sub-processes. Move or delete them first.`);
  }
  if (held.usages.length === 0) return null;
  return new RecordInUseException('BUSINESS_PROCESS_IN_USE', 'business process', name, held.usages);
}

@Injectable()
export class BusinessProcessesDeleteService extends BaseDeleteService<BusinessProcess> {
  protected override readonly logger = new Logger(BusinessProcessesDeleteService.name);

  constructor(
    @InjectRepository(BusinessProcess) repository: Repository<BusinessProcess>,
    audit: AuditService,
  ) {
    super(repository, null, audit, {
      entityName: 'BusinessProcess',
      auditTable: 'business_processes',
      cascadeRelations: [],
    });
  }

  /**
   * Override delete to handle foreign key constraint errors
   */
  override async delete(id: string, opts?: DeleteOptions): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);
    // Under the tree lock, no sub-process can be created or moved under it between the count and the delete.
    await lockBusinessProcessTree(manager);
    const existing = await repo.findOne({ where: { id } as any });

    if (!existing) {
      throw new NotFoundException('Business process not found');
    }

    // One id: every sub-process counts. The bulk delete has already removed the sub-processes the
    // selection deletes (deepest first), so what remains is exactly what the selection's check counts.
    const holds = await loadSelectionHolds(manager, [existing.id]);
    const refusal = selectionRefusals(holds, [existing.id]).get(existing.id.toLowerCase()) ?? null;
    if (refusal) throw refusal;
    try {
      await repo.delete({ id } as any);
    } catch (error: any) {
      if (error?.code === '23503' || error?.message?.includes('foreign key constraint')) {
        throw new RecordInUseException(
          'RECORD_IN_USE', 'business process', existing.name, [],
          `Cannot delete business process "${existing.name}": it is referenced by other records. You can disable it if it shouldn't be used actively anymore.`,
        );
      }
      throw error;
    }

    if (!opts?.skipAudit) {
      await this.audit.log(
        {
          table: 'business_processes',
          recordId: id,
          action: 'delete',
          before: existing,
          after: null,
          userId: opts?.userId ?? null,
        },
        { manager },
      );
    }
  }

  /**
   * The delete of a process being created (`DELETE /business-processes/:id/creation`, its creator
   * alone since its creation): the application links made meanwhile are removed first, each
   * audited as an unlink, so they do not refuse the delete; then the usual delete.
   */
  async deleteBeingCreated(id: string, opts: { manager: EntityManager; userId: string | null }): Promise<void> {
    const removed: Array<{ application_id: string }> = await opts.manager.query(
      `WITH removed AS (
         DELETE FROM application_business_processes
          WHERE tenant_id = app_current_tenant() AND business_process_id = $1
         RETURNING application_id)
       SELECT application_id::text AS application_id FROM removed`,
      [id],
    );
    for (const link of removed) {
      await this.audit.log({
        table: 'application_business_processes', recordId: id, action: 'update',
        before: { application_id: link.application_id }, after: null, userId: opts.userId,
      }, { manager: opts.manager });
    }
    await this.delete(id, opts);
  }

  /**
   * The check before a delete (`POST /business-processes/delete-check`): which of `ids` the bulk
   * delete would refuse, and why. A sub-process counts when it is outside the selection or refused
   * itself, the same rule as the delete. Nothing is written.
   */
  async deleteCheck(ids: unknown[], opts?: { manager?: EntityManager }): Promise<{ refused: DeleteRefusal[] }> {
    const manager = opts?.manager ?? this.repository.manager;
    const wanted = checkIds(ids);
    if (wanted.length === 0) return { refused: [] };
    const holds = await loadSelectionHolds(manager, wanted);
    const refusals = selectionRefusals(holds, wanted);
    return refusalsFrom(wanted, [...holds.values()], (row) => row.name, async (row) => refusals.get(row.id) ?? null);
  }

  /**
   * Deletes each process under its own savepoint, so a refusal leaves the others deleted and the
   * transaction usable. Deeper processes go first: a parent and its sub-processes selected together
   * are deleted together. A sub-process that stays keeps its parent refused.
   */
  async bulkDelete(ids: string[], userId: string | null, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);
    const result: BulkDeleteResult = { deleted: [], failed: [] };

    for (const id of await deleteOrder(manager, ids)) {
      try {
        await withSavepoint(manager, () => this.delete(id, { manager, userId }));
        result.deleted.push(id);
      } catch (error: any) {
        let name = 'Unknown';
        try {
          const p = await withSavepoint(manager, () => repo.findOne({ where: { id } as any }));
          if (p) name = p.name;
        } catch (err: any) {
          this.logger.warn(`Failed to fetch business process name for error reporting: ${err?.message || 'Unknown error'}`);
        }
        result.failed.push({
          id,
          name,
          reason: error?.message || 'Unknown error',
          ...refusalDetails(error),
        });
      }
    }

    return result;
  }
}
