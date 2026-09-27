import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { BusinessProcess } from './business-process.entity';
import { AuditService } from '../audit/audit.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';

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

    try {
      await repo.delete({ id } as any);
    } catch (error: any) {
      if (error?.code === '23503' || error?.message?.includes('foreign key constraint')) {
        throw new ConflictException(
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
        });
      }
    }

    return result;
  }
}
