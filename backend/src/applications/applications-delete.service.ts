import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Application } from './application.entity';
import { ApplicationAttachment } from './application-attachment.entity';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../common/storage/storage.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { checkIds, RecordInUseException, refusalDetails, refusalsFrom, type DeleteRefusal, type UsageCount } from '../common/record-in-use';
import { withSavepoint } from '../common/savepoint.util';
import { IntegratedDocumentsService } from '../knowledge/integrated-documents.service';

@Injectable()
export class ApplicationsDeleteService extends BaseDeleteService<Application> {
  protected override readonly logger = new Logger(ApplicationsDeleteService.name);

  constructor(
    @InjectRepository(Application) repository: Repository<Application>,
    audit: AuditService,
    storage: StorageService,
    private readonly integratedDocuments: IntegratedDocumentsService,
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

  /** The interfaces an application is the source or target of, which refuse its delete (disable it instead). */
  private refusalOf(app: { name: string; interfaces: number }): RecordInUseException | null {
    if (app.interfaces === 0) return null;
    return new RecordInUseException('APPLICATION_HAS_INTERFACES', 'application', app.name, [{ type: 'interfaces', total: app.interfaces }]);
  }

  /** The asked applications of the tenant, with their interface and deployment counts. */
  private async readCounts(ids: string[], manager: EntityManager): Promise<Array<{ id: string; name: string; interfaces: number; deployments: number }>> {
    return manager.query(
      `SELECT a.id, a.name,
              (SELECT count(*)::int FROM interfaces i
                WHERE i.tenant_id = a.tenant_id AND (i.source_application_id = a.id OR i.target_application_id = a.id)) AS interfaces,
              (SELECT count(*)::int FROM app_instances d WHERE d.tenant_id = a.tenant_id AND d.application_id = a.id) AS deployments
         FROM applications a
        WHERE a.tenant_id = app_current_tenant() AND a.id = ANY($1::uuid[])`,
      [ids],
    );
  }

  /**
   * The check before a delete (`POST /applications/delete-check`): the applications of `ids` with
   * interfaces, which the delete refuses, and what the others take with them (`removes`, their
   * deployments counted). Nothing is written.
   */
  async deleteCheck(ids: string[], opts?: { manager?: EntityManager }): Promise<{ refused: DeleteRefusal[]; removes: UsageCount[] }> {
    const manager = opts?.manager ?? this.repository.manager;
    const wanted = checkIds(ids);
    if (wanted.length === 0) return { refused: [], removes: [] };
    const rows = await this.readCounts(wanted, manager);
    const { refused } = await refusalsFrom(wanted, rows, (row) => row.name, async (row) => this.refusalOf(row));
    const deployments = rows.filter((row) => row.interfaces === 0).reduce((total, row) => total + row.deployments, 0);
    return { refused, removes: deployments > 0 ? [{ type: 'app_instances', total: deployments }] : [] };
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
    const [counts] = await this.readCounts([applicationId], manager);
    const refusal = counts ? this.refusalOf(counts) : null;
    if (refusal) throw refusal;

    // Attachment paths are read before the DB cascade removes their rows; the
    // files go only once the delete has gone through, so a failed delete keeps them.
    const attachments = await manager.getRepository(ApplicationAttachment).find({ where: { application_id: applicationId } as any });

    // Its managed documents (overview and the other integrated slots) name it without a foreign
    // key: they go here, as an interface's or a request's do, audited under the actor. The
    // application delete right covers them: the Knowledge library rights are not checked again.
    await this.integratedDocuments.deleteForEntity('applications', applicationId, opts?.userId ?? null, {
      manager,
      checkAccess: false,
    });

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
        result.failed.push({ id, name, reason: e?.message || 'Unknown error', ...refusalDetails(e) });
      }
    }

    return result;
  }
}
