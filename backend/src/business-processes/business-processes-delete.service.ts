import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BusinessProcess } from './business-process.entity';
import { AuditService } from '../audit/audit.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { checkIds, RecordInUseException, refusalDetails, refusalsFrom, type DeleteRefusal, type UsageCount } from '../common/record-in-use';
import { withSavepoint } from '../common/savepoint.util';

/** The applications and interfaces that name each of `ids`: their links would go with the process. */
async function processUsages(manager: EntityManager, ids: string[]): Promise<Map<string, UsageCount[]>> {
  const rows: Array<{ id: string; applications: number; interfaces: number }> = ids.length === 0 ? [] : await manager.query(
    `SELECT bp.id::text AS id,
            (SELECT count(DISTINCT abp.application_id)::int FROM application_business_processes abp
              WHERE abp.tenant_id = bp.tenant_id AND abp.business_process_id = bp.id) AS applications,
            (SELECT count(*)::int FROM interfaces i
              WHERE i.tenant_id = bp.tenant_id AND i.business_process_id = bp.id) AS interfaces
       FROM business_processes bp
      WHERE bp.tenant_id = app_current_tenant() AND bp.id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map(rows.map((row) => {
    const usages: UsageCount[] = [];
    if (row.applications > 0) usages.push({ type: 'applications', total: row.applications });
    if (row.interfaces > 0) usages.push({ type: 'interfaces', total: row.interfaces });
    return [row.id, usages];
  }));
}

/** The refusal of a process's delete (`BUSINESS_PROCESS_IN_USE`: applications and interfaces counted, disable it instead), or null. */
function processRefusal(name: string, usages: UsageCount[] | undefined): RecordInUseException | null {
  if (!usages || usages.length === 0) return null;
  return new RecordInUseException('BUSINESS_PROCESS_IN_USE', 'business process', name, usages);
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
    const existing = await repo.findOne({ where: { id } as any });

    if (!existing) {
      throw new NotFoundException('Business process not found');
    }

    // The links to applications and interfaces would go with the process: counted first, for the refusal.
    const refusal = processRefusal(existing.name, (await processUsages(manager, [id])).get(id));
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

  /** The check before a delete (`POST /business-processes/delete-check`): which of `ids` would be refused, and why. Nothing is written. */
  async deleteCheck(ids: unknown[], opts?: { manager?: EntityManager }): Promise<{ refused: DeleteRefusal[] }> {
    const manager = opts?.manager ?? this.repository.manager;
    const wanted = checkIds(ids);
    if (wanted.length === 0) return { refused: [] };
    const rows: Array<{ id: string; name: string }> = await manager.query(
      `SELECT id::text AS id, name FROM business_processes WHERE tenant_id = app_current_tenant() AND id = ANY($1::uuid[])`,
      [wanted],
    );
    const usages = await processUsages(manager, wanted);
    return refusalsFrom(wanted, rows, (row) => row.name, async (row) => processRefusal(row.name, usages.get(row.id)));
  }

  /**
   * Bulk delete multiple business processes
   */
  async bulkDelete(ids: string[], userId: string | null, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);
    const result: BulkDeleteResult = { deleted: [], failed: [] };

    for (const id of ids) {
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
