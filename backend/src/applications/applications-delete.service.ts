import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Application } from './application.entity';
import { ApplicationAttachment } from './application-attachment.entity';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../common/storage/storage.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';

@Injectable()
export class ApplicationsDeleteService extends BaseDeleteService<Application> {
  protected override readonly logger = new Logger(ApplicationsDeleteService.name);

  constructor(
    @InjectRepository(Application) repository: Repository<Application>,
    audit: AuditService,
    storage: StorageService,
  ) {
    super(repository, storage, audit, {
      entityName: 'Application',
      auditTable: 'applications',
      storagePrefix: 'applications',
      cascadeRelations: [
        {
          repository: ApplicationAttachment,
          foreignKey: 'application_id',
          deleteStrategy: 'cascade',
          storagePathColumn: 'storage_path',
        },
      ],
    });
  }

  /**
   * Override delete to handle attachment cleanup before deletion
   */
  override async delete(applicationId: string, opts?: DeleteOptions): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const appRepo = this.getRepo(manager);

    const app = await appRepo.findOne({ where: { id: applicationId } as any });
    if (!app) {
      throw new NotFoundException('Application not found');
    }

    // Attachment paths are read before the DB cascade removes their rows; the
    // files go only once the delete has gone through, so a failed delete keeps them.
    const attachments = await manager.getRepository(ApplicationAttachment).find({ where: { application_id: applicationId } as any });

    // Delete the base application row (child rows cascade via FKs)
    await appRepo.delete({ id: applicationId } as any);

    // Audit
    if (!opts?.skipAudit) {
      await this.audit.log(
        {
          table: 'applications',
          recordId: applicationId,
          action: 'delete',
          before: app,
          after: null,
          userId: opts?.userId ?? null,
        },
        { manager }
      );
    }

    // Best effort, once the rows are gone
    for (const a of attachments) {
      try {
        await this.storage?.deleteObject((a as any).storage_path);
      } catch (err: any) {
        this.logger.warn(`Failed to delete attachment storage object: ${err?.message || 'Unknown error'}`);
      }
    }
  }

  /**
   * Bulk delete multiple applications
   */
  async bulkDelete(ids: string[], userId: string | null, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const appRepo = this.getRepo(manager);
    const result: BulkDeleteResult = { deleted: [], failed: [] };

    for (const id of ids || []) {
      try {
        await withSavepoint(manager, () => this.delete(id, { manager, userId }));
        result.deleted.push(id);
      } catch (e: any) {
        let name = 'Unknown';
        try {
          const a = await withSavepoint(manager, () => appRepo.findOne({ where: { id } as any }));
          if (a) name = a.name;
        } catch (err: any) {
          this.logger.warn(`Failed to fetch application name for error reporting: ${err?.message || 'Unknown error'}`);
        }
        result.failed.push({ id, name, reason: e?.message || 'Unknown error' });
      }
    }

    return result;
  }
}
