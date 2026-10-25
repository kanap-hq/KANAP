import { Injectable } from '@nestjs/common';
import { INCIDENT_REVIEW_SLOT } from '../../knowledge/integrated-document.constants';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { TasksUnifiedService } from '../../tasks/tasks-unified.service';
import { ServiceOpts } from './incidents-base.service';
import { IncidentEntriesService } from './incident-entries.service';
import { IncidentRelationsService } from './incident-relations.service';
import { IncidentsAttachmentsService } from './incidents-attachments.service';
import { IncidentsService } from './incidents.service';

export type IncidentRecordOpts = ServiceOpts & { userId?: string | null };

/**
 * The incident review document, as the record exposes it (planning/incident-review-document.md §3.3).
 * Read-only projection of `integrated_document_bindings → documents`; never repaired here.
 */
export type IncidentRecordReview = {
  document_id: string;
  item_number: number | null;
  content_markdown: string;
  revision: number | null;
  updated_at: Date | string | null;
};

/**
 * One loader for a complete incident record. Chat detail and the PDF report both consume this.
 */
@Injectable()
export class IncidentRecordService {
  constructor(
    private readonly incidents: IncidentsService,
    private readonly entries: IncidentEntriesService,
    private readonly relations: IncidentRelationsService,
    private readonly attachments: IncidentsAttachmentsService,
    private readonly tasks: TasksUnifiedService,
    private readonly knowledge: KnowledgeService,
  ) {}

  async load(id: string, opts: IncidentRecordOpts) {
    // `incidents.get` applies the register permissions and the row visibility;
    // the review is only read once it succeeded.
    const incident = await this.incidents.get(id, opts);
    const [entries, assets, applications, tasks, documents, attachments, review] = await Promise.all([
      this.entries.list(id, { ...opts, order: 'asc' }),
      this.relations.listAssets(id, opts),
      this.relations.listApplications(id, opts),
      this.tasks.listForTarget({ type: 'incident', id }, {
        manager: opts.manager,
        tenantId: opts.tenantId,
        viewer: opts.viewer,
      }),
      this.knowledge.listDocumentsForEntity('incidents', id, {
        manager: opts.manager,
        userId: opts.userId ?? null,
      }),
      this.attachments.listAttachments(id, opts),
      this.loadReview(id, incident.tenant_id, opts),
    ]);
    return { incident, entries, assets, applications, tasks, documents, attachments, review };
  }

  /**
   * Read-only `binding → documents` lookup for the `incidents:review` slot.
   * No repair, no lazy provisioning: a read, a PDF or the chat must never
   * fabricate a review from the current template (§3.2).
   */
  private async loadReview(
    incidentId: string,
    tenantId: string | null | undefined,
    opts: IncidentRecordOpts,
  ): Promise<IncidentRecordReview | null> {
    const manager = opts.manager;
    const tenant = String(tenantId || opts.tenantId || '').trim();
    if (!manager || !tenant) return null;

    const rows: Array<{
      document_id: string;
      item_number: number | null;
      content_markdown: string | null;
      revision: number | null;
      updated_at: Date | string | null;
    }> = await manager.query(
      `SELECT d.id::text AS document_id,
              d.item_number,
              d.content_markdown,
              d.revision,
              d.updated_at
       FROM integrated_document_bindings b
       JOIN documents d ON d.id = b.document_id AND d.tenant_id = b.tenant_id
       WHERE b.tenant_id = $1
         AND b.source_entity_type = '${INCIDENT_REVIEW_SLOT.sourceEntityType}'
         AND b.source_entity_id = $2
         AND b.slot_key = '${INCIDENT_REVIEW_SLOT.slotKey}'
       LIMIT 1`,
      [tenant, incidentId],
    );

    const row = rows[0];
    if (!row) return null;
    return {
      document_id: row.document_id,
      item_number: row.item_number == null ? null : Number(row.item_number),
      content_markdown: row.content_markdown ?? '',
      revision: row.revision == null ? null : Number(row.revision),
      updated_at: row.updated_at ?? null,
    };
  }
}
