import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { validate as isUuid } from 'uuid';
import { AuditService } from '../../audit/audit.service';
import { BulkDeleteResult } from '../../common/delete.types';
import { RecordInUseException, refusalDetails, type DeleteRefusal } from '../../common/record-in-use';
import { withSavepoint } from '../../common/savepoint.util';
import { StorageService } from '../../common/storage/storage.service';
import { IntegratedDocumentsService } from '../../knowledge/integrated-documents.service';
import { UserTimeAggregateService } from '../../portfolio/services/user-time-aggregate.service';
import { currentTenantId, deleteBlobs, deleteItemTasks, unreferencedPaths } from '../../spend/item-delete-cleanup';
import { Incident } from '../incident.entity';

/**
 * What deleting incidents removes, for the confirmation, counted over the `incidents` that can go.
 * Removed with them: their review documents, tasks, timeline entries and attachments. Linked
 * objects that stay and only lose the link: applications, assets and Knowledge documents.
 * `blocked`: the incidents refused for their regulatory reporting data (`refused`, in the order asked).
 */
export type IncidentDeleteImpact = {
  incidents: number;
  review_documents: number;
  tasks: number;
  entries: number;
  attachments: number;
  applications: number;
  assets: number;
  documents: number;
  blocked: number;
  refused: DeleteRefusal[];
};

/** The refusal's code, worded by the screens (`errors:INCIDENT_HAS_REGULATORY_RECORDS`). */
export const INCIDENT_HAS_REGULATORY_RECORDS = 'INCIDENT_HAS_REGULATORY_RECORDS';

/**
 * The regulatory reporting fields an incident holds, counted: personal data affected, authority
 * notification required, a notification date, notified parties. Any of them makes the incident
 * audit evidence (NIS2 authority notification, GDPR art. 33(5) breach documentation).
 */
const regulatoryCount = (alias = '') =>
  `((${alias}personal_data_affected IS TRUE)::int + (${alias}authority_notification_required IS TRUE)::int
    + (${alias}authority_notified_at IS NOT NULL)::int + (NULLIF(btrim(${alias}notified_parties), '') IS NOT NULL)::int)`;

/** The managed review document of an incident (`knowledge/incident-review-provisioning.ts`). */
const SOURCE_TYPE = 'incidents';

/**
 * Deletes incidents (incident administrators only, checked by the routes). An incident holding
 * regulatory reporting data is refused (`RecordInUseException`, 409,
 * `INCIDENT_HAS_REGULATORY_RECORDS`): it is cancelled or closed instead. What belongs to the
 * incident goes with it: its review document (and any other managed document, through
 * `deleteForEntity`), its tasks, then the row, whose timeline entries, attachment rows and links to
 * applications, assets and Knowledge documents cascade (the documents stay). The search entry goes
 * with the row (trigger). Attachment files go last, once no attachment row of the tenant uses them.
 */
@Injectable()
export class IncidentsDeleteService {
  private readonly logger = new Logger(IncidentsDeleteService.name);

  constructor(
    @InjectRepository(Incident) private readonly repository: Repository<Incident>,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    private readonly integratedDocuments: IntegratedDocumentsService,
    private readonly timeAggregates: UserTimeAggregateService,
  ) {}

  async deleteCheck(ids: string[], opts?: { manager?: EntityManager }): Promise<IncidentDeleteImpact> {
    const manager = opts?.manager ?? this.repository.manager;
    const tenantId = await currentTenantId(manager);
    const wanted = Array.from(new Set((ids || []).map((id) => String(id || '').trim().toLowerCase()).filter((id) => isUuid(id))));
    const [row]: Array<Record<Exclude<keyof IncidentDeleteImpact, 'refused'>, number>> = await manager.query(
      `WITH asked AS (SELECT id, ${regulatoryCount()} AS recorded FROM incidents WHERE tenant_id = $1 AND id = ANY($2::uuid[])),
       i AS (SELECT id FROM asked WHERE recorded = 0)
       SELECT
         (SELECT count(*)::int FROM i) AS incidents,
         (SELECT count(*)::int FROM asked WHERE recorded > 0) AS blocked,
         (SELECT count(*)::int FROM integrated_document_bindings
           WHERE tenant_id = $1 AND source_entity_type = '${SOURCE_TYPE}' AND source_entity_id IN (SELECT id FROM i)) AS review_documents,
         (SELECT count(*)::int FROM tasks WHERE tenant_id = $1 AND related_object_type = 'incident' AND related_object_id IN (SELECT id FROM i)) AS tasks,
         (SELECT count(*)::int FROM incident_entries WHERE tenant_id = $1 AND incident_id IN (SELECT id FROM i)) AS entries,
         (SELECT count(*)::int FROM incident_attachments WHERE tenant_id = $1 AND incident_id IN (SELECT id FROM i) AND deleted_at IS NULL) AS attachments,
         (SELECT count(DISTINCT application_id)::int FROM incident_applications WHERE tenant_id = $1 AND incident_id IN (SELECT id FROM i)) AS applications,
         (SELECT count(DISTINCT asset_id)::int FROM incident_assets WHERE tenant_id = $1 AND incident_id IN (SELECT id FROM i)) AS assets,
         (SELECT count(DISTINCT d.document_id)::int FROM document_incidents d
           WHERE d.tenant_id = $1 AND d.incident_id IN (SELECT id FROM i)
             AND NOT EXISTS (
               SELECT 1 FROM integrated_document_bindings b
                WHERE b.tenant_id = d.tenant_id AND b.document_id = d.document_id
                  AND b.source_entity_type = '${SOURCE_TYPE}' AND b.source_entity_id = d.incident_id
             )) AS documents`,
      [tenantId, wanted],
    );
    return { ...row, refused: await this.refusedIncidents(manager, tenantId, wanted) };
  }

  /** The asked incidents holding regulatory reporting data, with the number of fields set. */
  private async refusedIncidents(manager: EntityManager, tenantId: string, ids: string[]): Promise<DeleteRefusal[]> {
    if (ids.length === 0) return [];
    const rows: Array<{ id: string; item_number: number; title: string; total: number }> = await manager.query(
      `SELECT id, item_number, title, ${regulatoryCount()} AS total
         FROM incidents WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, ids],
    );
    const byId = new Map(rows.filter((row) => row.total > 0).map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [this.refusalOf(row).details(id)] : [];
    });
  }

  private refusalOf(row: { item_number: number; title: string; total: number }) {
    const name = `INC-${row.item_number} ${row.title}`;
    const usages = [{ type: 'regulatory_records' as const, total: row.total }];
    return {
      exception: () => new RecordInUseException(
        INCIDENT_HAS_REGULATORY_RECORDS,
        'incident',
        name,
        usages,
        `Cannot delete incident "${name}": it holds regulatory reporting data. Cancel or close it instead.`,
      ),
      details: (id: string): DeleteRefusal => ({ id, name, code: INCIDENT_HAS_REGULATORY_RECORDS, usages }),
    };
  }

  async delete(id: string, opts: { manager?: EntityManager; userId?: string | null }): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const paths = await this.deleteOne(id, manager, opts?.userId ?? null);
    await deleteBlobs(this.storage, paths, this.logger);
  }

  async bulkDelete(ids: string[], userId: string | null, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const result: BulkDeleteResult = { deleted: [], failed: [] };
    const paths: string[] = [];
    for (const id of ids || []) {
      try {
        paths.push(...await withSavepoint(manager, () => this.deleteOne(id, manager, userId)));
        result.deleted.push(id);
      } catch (error: any) {
        let name = 'Unknown';
        if (isUuid(String(id))) {
          try {
            const found = await withSavepoint(manager, () => manager.getRepository(Incident).findOne({ where: { id } as any }));
            if (found) name = `INC-${found.item_number} ${found.title}`;
          } catch (err: any) {
            this.logger.warn(`Failed to fetch incident name for error reporting: ${err?.message || 'Unknown error'}`);
          }
        }
        result.failed.push({ id, name, reason: error?.message || 'Unknown error', ...refusalDetails(error) });
      }
    }
    await deleteBlobs(this.storage, paths, this.logger);
    return result;
  }

  /** Removes one incident and what belongs to it; returns the attachment files no row uses any more. */
  private async deleteOne(id: string, manager: EntityManager, userId: string | null): Promise<string[]> {
    const tenantId = await currentTenantId(manager);
    if (!isUuid(String(id))) throw new NotFoundException('Incident not found.');
    const locked: Array<{ total: number }> = await manager.query(
      `SELECT ${regulatoryCount()} AS total FROM incidents WHERE tenant_id = $1 AND id = $2 FOR UPDATE`,
      [tenantId, id],
    );
    if (locked.length === 0) throw new NotFoundException('Incident not found.');
    const incident = await manager.getRepository(Incident).findOne({ where: { id, tenant_id: tenantId } as any });
    if (!incident) throw new NotFoundException('Incident not found.');
    // Regulatory reporting data is audit evidence: the incident is cancelled or closed, not deleted.
    if (locked[0].total > 0) {
      throw this.refusalOf({ item_number: incident.item_number, title: incident.title, total: locked[0].total }).exception();
    }

    const attachments: Array<{ storage_path: string }> = await manager.query(
      `SELECT storage_path FROM incident_attachments WHERE tenant_id = $1 AND incident_id = $2`,
      [tenantId, id],
    );
    // Its managed documents (the review) name it without a foreign key: they go here, audited
    // under the actor. The incident delete right covers them.
    await this.integratedDocuments.deleteForEntity(SOURCE_TYPE, id, userId, { manager, checkAccess: false });
    await deleteItemTasks(manager, 'incident', tenantId, id, { audit: this.audit, timeAggregates: this.timeAggregates, userId });
    // Entries, attachment rows and the links to applications, assets and documents cascade.
    await manager.query(`DELETE FROM incidents WHERE tenant_id = $1 AND id = $2`, [tenantId, id]);

    await this.audit.log({ table: 'incidents', recordId: id, action: 'delete', before: incident, after: null, userId }, { manager });

    return unreferencedPaths(manager, tenantId, [...new Set(attachments.map((a) => a.storage_path).filter(Boolean))]);
  }
}
