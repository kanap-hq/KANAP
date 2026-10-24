import { TechnologyCpeEvents } from '../technologies/technology-cpe-events';
import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
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
    @Optional() private readonly cpeEvents?: TechnologyCpeEvents,
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

  /**
   * The asked applications of the tenant, with their interface, deployment and managed document
   * counts. The description (the overview slot, created when the page first opens) is no document of
   * its own: `description` is 1 when it holds text, in its document or, before that, in the column.
   */
  private async readCounts(ids: string[], manager: EntityManager): Promise<Array<{ id: string; name: string; interfaces: number; deployments: number; documents: number; description: number }>> {
    return manager.query(
      `SELECT a.id, a.name,
              (SELECT count(*)::int FROM interfaces i
                WHERE i.tenant_id = a.tenant_id AND (i.source_application_id = a.id OR i.target_application_id = a.id)) AS interfaces,
              (SELECT count(*)::int FROM app_instances d WHERE d.tenant_id = a.tenant_id AND d.application_id = a.id) AS deployments,
              (SELECT count(*)::int FROM integrated_document_bindings b
                WHERE b.tenant_id = a.tenant_id AND b.source_entity_type = 'applications' AND b.source_entity_id = a.id
                  AND b.slot_key <> 'overview') AS documents,
              CASE WHEN EXISTS (
                     SELECT 1 FROM integrated_document_bindings b
                       JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
                      WHERE b.tenant_id = a.tenant_id AND b.source_entity_type = 'applications' AND b.source_entity_id = a.id
                        AND b.slot_key = 'overview' AND coalesce(d.content_markdown, '') ~ '\\S')
                     OR (NOT EXISTS (
                           SELECT 1 FROM integrated_document_bindings b
                            WHERE b.tenant_id = a.tenant_id AND b.source_entity_type = 'applications' AND b.source_entity_id = a.id
                              AND b.slot_key = 'overview')
                         AND coalesce(a.description, '') ~ '\\S')
                   THEN 1 ELSE 0 END AS description
         FROM applications a
        WHERE a.tenant_id = app_current_tenant() AND a.id = ANY($1::uuid[])`,
      [ids],
    );
  }

  /**
   * The check before a delete (`POST /applications/delete-check`): the applications of `ids` with
   * interfaces, which the delete refuses, and what the others take with them (`removes`: their
   * descriptions when written, their deployments and other managed documents counted). Nothing is written.
   */
  async deleteCheck(ids: string[], opts?: { manager?: EntityManager }): Promise<{ refused: DeleteRefusal[]; removes: UsageCount[] }> {
    const manager = opts?.manager ?? this.repository.manager;
    const wanted = checkIds(ids);
    if (wanted.length === 0) return { refused: [], removes: [] };
    const rows = await this.readCounts(wanted, manager);
    const { refused } = await refusalsFrom(wanted, rows, (row) => row.name, async (row) => this.refusalOf(row));
    const deleted = rows.filter((row) => row.interfaces === 0);
    const deployments = deleted.reduce((total, row) => total + row.deployments, 0);
    const documents = deleted.reduce((total, row) => total + row.documents, 0);
    const descriptions = deleted.reduce((total, row) => total + row.description, 0);
    const removes: UsageCount[] = [];
    if (descriptions > 0) removes.push({ type: 'descriptions', total: descriptions });
    if (deployments > 0) removes.push({ type: 'app_instances', total: deployments });
    if (documents > 0) removes.push({ type: 'documents', total: documents });
    return { refused, removes };
  }

  /**
   * Override delete to handle attachment cleanup before deletion
   */
  /**
   * `keepManagedDocuments`: its managed documents stay bound, for the caller to release them once
   * the application is gone (the conversion to a technology keeps their text and files).
   */
  override async delete(applicationId: string, opts?: DeleteOptions & { keepManagedDocuments?: boolean }): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const appRepo = this.getRepo(manager);

    const app = await appRepo.findOne({ where: { id: applicationId } as any });
    if (!app) {
      throw new NotFoundException('Application not found');
    }
    const [counts] = await this.readCounts([applicationId], manager);
    const refusal = counts ? this.refusalOf(counts) : null;
    if (refusal) throw refusal;
    // Its technology declarations go with it: those technologies are matched again after the commit.
    if (this.cpeEvents) await this.cpeEvents.emitForSubjects(manager, (app as any).tenant_id, 'application', [applicationId]);

    // Attachment paths are read before the DB cascade removes their rows; the
    // files go only once the delete has gone through, so a failed delete keeps them.
    const attachments = await manager.getRepository(ApplicationAttachment).find({ where: { application_id: applicationId } as any });

    // Its managed documents (overview and the other integrated slots) name it without a foreign
    // key: they go here, as an interface's or a request's do, audited under the actor. The
    // application delete right covers them: the Knowledge library rights are not checked again.
    if (!opts?.keepManagedDocuments) {
      await this.integratedDocuments.deleteForEntity('applications', applicationId, opts?.userId ?? null, {
        manager,
        checkAccess: false,
      });
    }

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
