import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConnectionsService } from '../../connections/services/connections.service';
import { ContactsService } from '../../contacts/contacts.service';
import { InterfacesService } from '../../interfaces/services/interfaces.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { LocationsService } from '../../locations/locations.service';
import { budgetLineReferenceNumbers, parseItemRef } from '../../common/resolve-item-id';
import { BUDGET_LINE_PREFIX, natureAnd, type BudgetNature } from '../../spend/budget-nature';
import { CapexItemsDeleteService, SpendItemsDeleteService } from '../../spend/spend-items-delete.service';
import { assertTaskDeletable } from '../../tasks/task-data-access';
import { originRefusals, TasksDeleteService } from '../../tasks/tasks-delete.service';
import { RecordInUseException } from '../../common/record-in-use';
import { AiPolicyService } from '../ai-policy.service';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiExecutionContextWithManager } from '../ai.types';
import { AiDeleteImpact } from '../ai-write-texts';
import { buildAiMutationAudit } from './ai-mutation-audit.util';
import { AiBusinessRecordMutationSupportService } from './ai-business-record-mutation-support.service';
import { AiDocumentMutationSupportService } from './ai-document-mutation-support.service';
import { AiMasterDataMutationSupportService } from './ai-master-data-mutation-support.service';
import { AiTaskMutationSupportService } from './ai-task-mutation-support.service';

/** The families a person may delete one record of: the screen's own delete, one record at a time. */
export const AI_DELETE_ENTITY_TYPES = [
  'tasks',
  'contacts',
  'locations',
  'budget_lines',
  'connections',
  'interfaces',
  'documents',
] as const;
export type AiDeleteEntityType = typeof AI_DELETE_ENTITY_TYPES[number];

export type AiDeleteTarget = {
  entityType: AiDeleteEntityType;
  id: string;
  ref: string | null;
  title: string;
  updatedAt: string | null;
};

export type AiPreparedDelete = {
  target: AiDeleteTarget;
  impact: AiDeleteImpact;
};

/** What the person asked besides the record: an interface's bindings may go with it, if they say so. */
export type AiDeleteOptions = {
  deleteRelatedBindings?: boolean;
};

const LABELS: Record<AiDeleteEntityType, string> = {
  tasks: 'Task',
  contacts: 'Contact',
  locations: 'Location',
  budget_lines: 'Budget line',
  connections: 'Connection',
  interfaces: 'Interface',
  documents: 'Document',
};

/** The object type a task of a line carries (`spend/item-delete-cleanup.ts`). */
const TASK_OBJECT_TYPE: Record<BudgetNature, string> = {
  opex: 'spend_item',
  capex: 'capex_item',
};

/** The families a document's links name, with the module that reads them. */
const DOCUMENT_LINK_READS: Readonly<Record<string, string>> = {
  applications: 'applications',
  assets: 'infrastructure',
  projects: 'portfolio_projects',
  requests: 'portfolio_requests',
  tasks: 'tasks',
  locations: 'locations',
  connections: 'infrastructure',
  interfaces: 'applications',
  incidents: 'incidents',
};

/** The families a spend line's links name, with the module that reads them. */
const SPEND_IMPACT_READS: Readonly<Record<string, string>> = {
  tasks: 'tasks',
  request_origins: 'portfolio_requests',
  requests: 'portfolio_requests',
  contracts: 'contracts',
  projects: 'portfolio_projects',
  applications: 'applications',
  assets: 'infrastructure',
  technologies: 'infrastructure',
  contacts: 'contacts',
};

/** One ISO timestamp normalized, or null when the row has none. */
function isoTimestamp(value: unknown): string | null {
  if (!value) return null;
  const time = value instanceof Date ? value.getTime() : new Date(String(value)).getTime();
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

@Injectable()
export class AiDeleteMutationSupportService {
  constructor(
    private readonly taskSupport: AiTaskMutationSupportService,
    private readonly masterData: AiMasterDataMutationSupportService,
    private readonly businessRecords: AiBusinessRecordMutationSupportService,
    private readonly tasksDelete: TasksDeleteService,
    private readonly contacts: ContactsService,
    private readonly locations: LocationsService,
    private readonly opexDelete: SpendItemsDeleteService,
    private readonly capexDelete: CapexItemsDeleteService,
    private readonly connections: ConnectionsService,
    private readonly interfaces: InterfacesService,
    private readonly documentSupport: AiDocumentMutationSupportService,
    private readonly knowledge: KnowledgeService,
    private readonly policy: AiPolicyService,
  ) {}

  /**
   * The record a reference or an exact name names, with the same scope as the screen, and what
   * its delete takes. The screen's refusals run here, before any preview exists: a task that
   * started a request (409, with what to do), a task whose budget line or contract the person may
   * not modify (403, `assertTaskDeletable`), a budget line with amounts in a frozen column (409,
   * `BUDGET_LINE_FROZEN`), an interface whose bindings stay unless the person asks to delete
   * them with it (409, `INTERFACE_HAS_BINDINGS`) and a managed document, which goes with its
   * record (409, `KNOWLEDGE_DOCUMENT_MANAGED`). The document's library write right is checked
   * as its screen route does, on top of the Knowledge admin level.
   */
  async prepare(
    context: AiExecutionContextWithManager,
    entityType: AiDeleteEntityType,
    ref: string,
    options: AiDeleteOptions = {},
  ): Promise<AiPreparedDelete> {
    if (options.deleteRelatedBindings && entityType !== 'interfaces') {
      throw new BadRequestException('delete_related_bindings applies to interfaces only.');
    }
    switch (entityType) {
      case 'tasks': {
        const task = await this.taskSupport.resolveTaskSnapshot(context, ref);
        await assertTaskDeletable(context.manager, task);
        const refusal = (await originRefusals(context.manager, [{ id: task.task_id, title: task.target_title }]))[0] ?? null;
        if (refusal) throw this.originRefusal(refusal);
        return {
          target: {
            entityType,
            id: task.task_id,
            ref: task.target_ref,
            title: task.target_title ?? task.target_ref ?? 'Untitled task',
            updatedAt: task.updated_at,
          },
          impact: await this.taskImpact(context, task.task_id),
        };
      }
      case 'contacts': {
        const found = await this.masterData.resolveRecordReference(context, 'contacts', ref);
        return {
          target: {
            entityType,
            id: found.id,
            // A contact has no business reference: the list and the card show its name only.
            ref: null,
            title: found.label,
            updatedAt: isoTimestamp(found.row.updated_at),
          },
          impact: await this.contactImpact(context, found.id),
        };
      }
      case 'locations': {
        const found = await this.masterData.resolveRecordReference(context, 'locations', ref);
        // The screen's refusal before any preview: a location that still holds assets (`LOCATION_IN_USE`).
        const refusal = await this.locations.deleteRefusal(
          { id: found.id, name: String(found.row.name ?? found.label), tenant_id: context.tenantId },
          context.manager,
        );
        if (refusal) throw refusal;
        return {
          target: {
            entityType,
            id: found.id,
            ref: found.ref,
            title: found.label,
            updatedAt: isoTimestamp(found.row.updated_at),
          },
          impact: await this.locationImpact(context, found.id),
        };
      }
      case 'budget_lines': {
        const found = await this.resolveSpendLine(context, ref);
        // The screen's check before the confirmation, and its refusal before any preview.
        const checker = found.nature === 'opex' ? this.opexDelete : this.capexDelete;
        const refusal = (await checker.deleteCheck([found.id], { manager: context.manager })).refused[0];
        if (refusal) {
          const column = String(refusal.params?.column ?? 'a frozen column');
          const year = refusal.params?.year == null ? '' : ` ${refusal.params.year}`;
          throw new ConflictException({
            statusCode: 409,
            error: 'Conflict',
            code: refusal.code,
            message: `This line has amounts in ${column}${year}, a frozen budget column. Unfreeze the column first, or set an end of validity date instead of deleting the line.`,
            usages: refusal.usages,
            ...(refusal.params ? { params: refusal.params } : {}),
          });
        }
        return {
          target: {
            entityType,
            id: found.id,
            ref: found.ref,
            title: found.title,
            updatedAt: found.updatedAt,
          },
          impact: await this.spendImpact(context, found.nature, found.id),
        };
      }
      case 'connections': {
        const found = await this.businessRecords.resolveRecordReference(context, 'connections', ref);
        return {
          target: {
            entityType,
            id: found.id,
            ref: found.ref,
            title: found.label,
            updatedAt: isoTimestamp(found.row.updated_at),
          },
          impact: await this.connectionImpact(context, found.id),
        };
      }
      case 'interfaces': {
        const found = await this.businessRecords.resolveRecordReference(context, 'interfaces', ref);
        const impact = await this.interfaceImpact(context, found.id);
        const bindings = Number(impact.counts.bindings ?? 0);
        if (bindings > 0 && options.deleteRelatedBindings !== true) {
          throw this.interfaceBindingsRefusal(found.label, bindings);
        }
        return {
          target: {
            entityType,
            id: found.id,
            ref: found.ref,
            title: found.label,
            updatedAt: isoTimestamp(found.row.updated_at),
          },
          impact,
        };
      }
      case 'documents': {
        const document = await this.documentSupport.resolveDocumentSnapshot(context, ref);
        // The route's `knowledge:admin` is already checked; the library write right is the
        // document's own gate, as the Knowledge screen and `KnowledgeService.remove` apply it.
        await this.knowledge.assertDocumentWritable(document.document_id, context.manager, context.userId);
        const refusal = await this.knowledge.managedDocumentRefusal(
          { id: document.document_id, title: document.target_title ?? '' },
          context.manager,
        );
        if (refusal) throw refusal;
        return {
          target: {
            entityType,
            id: document.document_id,
            ref: document.target_ref,
            title: document.target_title ?? 'Untitled document',
            updatedAt: document.updated_at,
          },
          impact: await this.documentImpact(context, document.document_id),
        };
      }
    }
  }

  /**
   * The screen's 409, made actionable for the chat: the same refusal, and what to do about it.
   */
  private originRefusal(refusal: RecordInUseException): ConflictException {
    return new ConflictException(
      `${refusal.message}. Delete the request first, or change its origin task, then delete the task.`,
    );
  }

  /**
   * One statement for what goes with a task, all under its tenant. Applications, assets and
   * documents are named only for a reader of their module, as the task page shows those sections;
   * for anyone else they are counted among the other links, without naming the family.
   */
  private async taskImpact(context: AiExecutionContextWithManager, taskId: string): Promise<AiDeleteImpact> {
    const [row] = await context.manager.query(
      `SELECT
         (SELECT count(*)::int FROM portfolio_activities WHERE tenant_id = $1 AND task_id = $2) AS activities,
         (SELECT count(*)::int FROM task_time_entries WHERE tenant_id = $1 AND task_id = $2) AS time_entries,
         (SELECT count(*)::int FROM task_attachments WHERE tenant_id = $1 AND task_id = $2) AS attachments,
         (SELECT count(*)::int FROM task_applications WHERE tenant_id = $1 AND task_id = $2) AS applications,
         (SELECT count(*)::int FROM task_assets WHERE tenant_id = $1 AND task_id = $2) AS assets,
         (SELECT count(*)::int FROM document_tasks WHERE tenant_id = $1 AND task_id = $2) AS documents`,
      [context.tenantId, taskId],
    );
    const counts: Record<string, number> = {
      activities: Number(row?.activities ?? 0),
      time_entries: Number(row?.time_entries ?? 0),
      attachments: Number(row?.attachments ?? 0),
      applications: Number(row?.applications ?? 0),
      assets: Number(row?.assets ?? 0),
      documents: Number(row?.documents ?? 0),
    };
    const readable = await this.policy.readableResources(
      context,
      ['applications', 'infrastructure', 'knowledge'],
      context.manager,
    );
    let hidden = 0;
    for (const [family, resource] of [
      ['applications', 'applications'],
      ['assets', 'infrastructure'],
      ['documents', 'knowledge'],
    ] as const) {
      if (readable.has(resource)) continue;
      hidden += counts[family];
      delete counts[family];
    }
    return hidden > 0 ? { counts, hidden } : { counts };
  }

  /**
   * A contact's links, one statement over every family (distinct objects, as the usages panel
   * counts them). A family the person cannot read is summed without naming it, as the panel leaves
   * its group out.
   */
  private async contactImpact(context: AiExecutionContextWithManager, contactId: string): Promise<AiDeleteImpact> {
    const rows: Array<{ family: string; total: number }> = await context.manager.query(
      `SELECT 'suppliers' AS family, count(DISTINCT supplier_id)::int AS total
         FROM supplier_contacts WHERE tenant_id = $1 AND contact_id = $2
       UNION ALL
       SELECT 'budget_lines', count(DISTINCT c.spend_item_id)::int
         FROM spend_item_contacts c
         JOIN spend_items i ON i.tenant_id = c.tenant_id AND i.id = c.spend_item_id AND i.nature = 'opex'
        WHERE c.tenant_id = $1 AND c.contact_id = $2
       UNION ALL
       SELECT 'budget_lines', count(DISTINCT c.spend_item_id)::int
         FROM spend_item_contacts c
         JOIN spend_items i ON i.tenant_id = c.tenant_id AND i.id = c.spend_item_id AND i.nature = 'capex'
        WHERE c.tenant_id = $1 AND c.contact_id = $2
       UNION ALL
       SELECT 'contracts', count(DISTINCT contract_id)::int
         FROM contract_contacts WHERE tenant_id = $1 AND contact_id = $2
       UNION ALL
       SELECT 'applications', count(DISTINCT application_id)::int
         FROM application_support_contacts WHERE tenant_id = $1 AND contact_id = $2
       UNION ALL
       SELECT 'assets', count(DISTINCT asset_id)::int
         FROM asset_support_contacts WHERE tenant_id = $1 AND contact_id = $2
       UNION ALL
       SELECT 'technologies', count(DISTINCT technology_id)::int
         FROM technology_support_contacts WHERE tenant_id = $1 AND contact_id = $2
       UNION ALL
       SELECT 'locations', count(DISTINCT location_id)::int
         FROM location_contacts WHERE tenant_id = $1 AND contact_id = $2
       UNION ALL
       SELECT 'projects', count(DISTINCT project_id)::int
         FROM portfolio_project_contacts WHERE tenant_id = $1 AND contact_id = $2
       UNION ALL
       SELECT 'requests', count(DISTINCT request_id)::int
         FROM portfolio_request_contacts WHERE tenant_id = $1 AND contact_id = $2`,
      [context.tenantId, contactId],
    );
    const resources: Record<string, string> = {
      suppliers: 'suppliers',
      budget_lines: 'budget',
      contracts: 'contracts',
      applications: 'applications',
      assets: 'infrastructure',
      technologies: 'infrastructure',
      locations: 'locations',
      projects: 'portfolio_projects',
      requests: 'portfolio_requests',
    };
    const readable = await this.policy.readableResources(context, Array.from(new Set(Object.values(resources))), context.manager);
    const counts: Record<string, number> = {};
    let hidden = 0;
    for (const row of rows) {
      const total = Number(row.total ?? 0);
      if (total <= 0) continue;
      if (readable.has(resources[row.family])) counts[row.family] = (counts[row.family] ?? 0) + total;
      else hidden += total;
    }
    return hidden > 0 ? { counts, hidden } : { counts };
  }

  /**
   * One statement for what a location's delete takes, all under its tenant. A location that holds
   * assets is refused before (`LOCATION_IN_USE`). Documents are named only for a reader of their
   * module, as the documents do; for anyone else they are counted among the other links.
   */
  private async locationImpact(context: AiExecutionContextWithManager, locationId: string): Promise<AiDeleteImpact> {
    const [row] = await context.manager.query(
      `SELECT
         (SELECT count(*)::int FROM location_contacts WHERE tenant_id = $1 AND location_id = $2)
           + (SELECT count(*)::int FROM location_user_contacts WHERE tenant_id = $1 AND location_id = $2) AS contacts,
         (SELECT count(*)::int FROM location_links WHERE tenant_id = $1 AND location_id = $2) AS links,
         (SELECT count(*)::int FROM location_sub_items WHERE tenant_id = $1 AND location_id = $2) AS sub_items,
         (SELECT count(*)::int FROM document_locations WHERE tenant_id = $1 AND location_id = $2) AS documents`,
      [context.tenantId, locationId],
    );
    const counts: Record<string, number> = {
      contacts: Number(row?.contacts ?? 0),
      links: Number(row?.links ?? 0),
      sub_items: Number(row?.sub_items ?? 0),
      documents: Number(row?.documents ?? 0),
    };
    const readable = await this.policy.readableResources(context, ['knowledge'], context.manager);
    if (readable.has('knowledge')) return { counts };
    const hidden = counts.documents;
    delete counts.documents;
    return hidden > 0 ? { counts, hidden } : { counts };
  }

  /**
   * The line a reference names, of either nature: `BL-n` or a bare number its own number, `OPX-n`
   * an OPEX line's legacy number, `CPX-n` a CAPEX line's, as `write_financial_plan` reads them; a
   * UUID or an exact title also works.
   */
  private async resolveSpendLine(
    context: AiExecutionContextWithManager,
    ref: string,
  ): Promise<{ id: string; ref: string; title: string; nature: BudgetNature; updatedAt: string | null }> {
    const normalized = String(ref ?? '').trim();
    if (!normalized) throw new BadRequestException('Budget line reference is required.');
    // A name also works; a reference number follows the one rule (`budgetLineReferenceNumbers`).
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(normalized);
    type Row = { id: string; nature: BudgetNature; product_name: string | null; item_number: number | null; updated_at: Date | string | null };
    let rows: Row[];
    if (uuid) {
      rows = await context.manager.query(
        `SELECT id, nature, product_name, item_number, updated_at
           FROM spend_items
          WHERE tenant_id = $1 AND nature IN ('opex', 'capex') AND id = $2
          LIMIT 1`,
        [context.tenantId, normalized],
      );
    } else {
      const numbers = budgetLineReferenceNumbers(normalized);
      rows = await context.manager.query(
        `SELECT id, nature, product_name, item_number, updated_at
           FROM spend_items
          WHERE tenant_id = $1 AND nature IN ('opex', 'capex')
            AND (LOWER(product_name) = LOWER($2::text) OR item_number = $3 OR legacy_number = $4::text)
          ORDER BY (LOWER(product_name) = LOWER($2::text)) DESC, product_name
          LIMIT 6`,
        [context.tenantId, normalized, numbers.itemNumber, numbers.legacyNumber],
      );
    }
    if (rows.length === 0) throw new NotFoundException(`No budget line found matching "${normalized}".`);
    const exact = uuid
      ? rows
      : rows.filter((row) => String(row.product_name ?? '').toLowerCase() === normalized.toLowerCase());
    const matches = exact.length > 0 ? exact : rows;
    if (matches.length > 1) {
      throw new BadRequestException(`Multiple budget lines matched "${normalized}". Use its BL-n reference.`);
    }
    const row = matches[0];
    return {
      id: row.id,
      ref: `${BUDGET_LINE_PREFIX}-${row.item_number}`,
      title: String(row.product_name || 'Untitled budget line'),
      nature: row.nature === 'capex' ? 'capex' : 'opex',
      updatedAt: isoTimestamp(row.updated_at),
    };
  }

  /**
   * One statement for what a budget line's delete takes, all under its tenant. Links to a family
   * the person does not read are summed without naming it; the line's own versions, amounts,
   * attachments, links and dimension values are part of the budget the deleter reads.
   */
  private async spendImpact(
    context: AiExecutionContextWithManager,
    nature: BudgetNature,
    lineId: string,
  ): Promise<AiDeleteImpact> {
    const objectType = TASK_OBJECT_TYPE[nature];
    const [row] = await context.manager.query(
      `SELECT
         (SELECT count(DISTINCT v.id)::int
            FROM spend_versions v
            JOIN spend_amounts a ON a.tenant_id = v.tenant_id AND a.version_id = v.id
           WHERE v.tenant_id = $1 AND v.spend_item_id = $2
             AND (COALESCE(a.planned, 0) <> 0 OR COALESCE(a.committed, 0) <> 0 OR COALESCE(a.forecast, 0) <> 0
               OR COALESCE(a.actual, 0) <> 0 OR COALESCE(a.expected_landing, 0) <> 0)) AS amount_versions,
         (SELECT count(DISTINCT v.budget_year)::int
            FROM spend_versions v
            JOIN spend_amounts a ON a.tenant_id = v.tenant_id AND a.version_id = v.id
           WHERE v.tenant_id = $1 AND v.spend_item_id = $2
             AND (COALESCE(a.planned, 0) <> 0 OR COALESCE(a.committed, 0) <> 0 OR COALESCE(a.forecast, 0) <> 0
               OR COALESCE(a.actual, 0) <> 0 OR COALESCE(a.expected_landing, 0) <> 0)) AS amount_years,
         (SELECT count(*)::int FROM tasks t
           WHERE t.tenant_id = $1 AND t.related_object_type = $3 AND t.related_object_id = $2) AS tasks,
         (SELECT count(DISTINCT r.id)::int
            FROM portfolio_requests r
            JOIN tasks t ON t.tenant_id = r.tenant_id AND t.id = r.origin_task_id
           WHERE t.tenant_id = $1 AND t.related_object_type = $3 AND t.related_object_id = $2) AS request_origins,
         (SELECT count(*)::int FROM spend_attachments WHERE tenant_id = $1 AND spend_item_id = $2) AS attachments,
         (SELECT count(DISTINCT contract_id)::int FROM contract_spend_items WHERE tenant_id = $1 AND spend_item_id = $2) AS contracts,
         (SELECT count(DISTINCT project_id)::int FROM portfolio_project_opex WHERE tenant_id = $1 AND opex_id = $2) AS projects,
         (SELECT count(DISTINCT request_id)::int FROM portfolio_request_opex WHERE tenant_id = $1 AND opex_id = $2) AS requests,
         (SELECT count(DISTINCT application_id)::int FROM application_spend_items WHERE tenant_id = $1 AND spend_item_id = $2) AS applications,
         (SELECT count(DISTINCT asset_id)::int FROM asset_spend_items WHERE tenant_id = $1 AND spend_item_id = $2) AS assets,
         (SELECT count(DISTINCT technology_id)::int FROM technology_spend_items WHERE tenant_id = $1 AND spend_item_id = $2) AS technologies,
         (SELECT count(DISTINCT contact_id)::int FROM spend_item_contacts WHERE tenant_id = $1 AND spend_item_id = $2) AS contacts,
         (SELECT count(*)::int FROM spend_links WHERE tenant_id = $1 AND spend_item_id = $2) AS links,
         (SELECT count(*)::int FROM spend_item_analytics_values WHERE tenant_id = $1 AND item_id = $2) AS dimension_values`,
      [context.tenantId, lineId, objectType],
    );
    const counts: Record<string, number> = {
      amount_versions: Number(row?.amount_versions ?? 0),
      amount_years: Number(row?.amount_years ?? 0),
      tasks: Number(row?.tasks ?? 0),
      request_origins: Number(row?.request_origins ?? 0),
      attachments: Number(row?.attachments ?? 0),
      contracts: Number(row?.contracts ?? 0),
      projects: Number(row?.projects ?? 0),
      requests: Number(row?.requests ?? 0),
      applications: Number(row?.applications ?? 0),
      assets: Number(row?.assets ?? 0),
      technologies: Number(row?.technologies ?? 0),
      contacts: Number(row?.contacts ?? 0),
      links: Number(row?.links ?? 0),
      dimension_values: Number(row?.dimension_values ?? 0),
    };
    const readable = await this.policy.readableResources(
      context,
      Array.from(new Set(Object.values(SPEND_IMPACT_READS))),
      context.manager,
    );
    let hidden = 0;
    for (const [family, resource] of Object.entries(SPEND_IMPACT_READS)) {
      if (readable.has(resource)) continue;
      hidden += counts[family];
      delete counts[family];
    }
    return hidden > 0 ? { counts, hidden } : { counts };
  }

  /**
   * One statement for what a document's delete takes, all under its tenant: its versions, its
   * attachments, the documents that cite it and that it cites, the records it links to, and the
   * documents created from it (which lose their template). A linked family the person does not
   * read is summed without naming it, as the document page leaves the family out. A review
   * workflow or another person's edit lock is reported in a line, never refused: the Knowledge
   * screen still deletes the document.
   */
  private async documentImpact(context: AiExecutionContextWithManager, documentId: string): Promise<AiDeleteImpact> {
    const [row] = await context.manager.query(
      `SELECT
         (SELECT count(*)::int FROM document_versions WHERE tenant_id = $1 AND document_id = $2) AS versions,
         (SELECT count(*)::int FROM document_attachments WHERE tenant_id = $1 AND document_id = $2) AS attachments,
         (SELECT count(*)::int FROM document_references WHERE tenant_id = $1 AND target_document_id = $2) AS citing_documents,
         (SELECT count(*)::int FROM document_references WHERE tenant_id = $1 AND source_document_id = $2) AS cited_documents,
         (SELECT count(*)::int FROM document_applications WHERE tenant_id = $1 AND document_id = $2) AS applications,
         (SELECT count(*)::int FROM document_assets WHERE tenant_id = $1 AND document_id = $2) AS assets,
         (SELECT count(*)::int FROM document_projects WHERE tenant_id = $1 AND document_id = $2) AS projects,
         (SELECT count(*)::int FROM document_requests WHERE tenant_id = $1 AND document_id = $2) AS requests,
         (SELECT count(*)::int FROM document_tasks WHERE tenant_id = $1 AND document_id = $2) AS tasks,
         (SELECT count(*)::int FROM document_locations WHERE tenant_id = $1 AND document_id = $2) AS locations,
         (SELECT count(*)::int FROM document_connections WHERE tenant_id = $1 AND document_id = $2) AS connections,
         (SELECT count(*)::int FROM document_interfaces WHERE tenant_id = $1 AND document_id = $2) AS interfaces,
         (SELECT count(*)::int FROM document_incidents WHERE tenant_id = $1 AND document_id = $2) AS incidents,
         (SELECT count(*)::int FROM documents WHERE tenant_id = $1 AND template_document_id = $2) AS derived_documents,
         (SELECT count(*)::int FROM document_workflows
           WHERE tenant_id = $1 AND document_id = $2 AND status IN ('pending_review', 'pending_approval')) AS active_workflows,
         (SELECT COALESCE(NULLIF(trim(concat_ws(' ', u.first_name, u.last_name)), ''), u.email)
            FROM document_edit_locks l
            JOIN users u ON u.id = l.holder_user_id AND u.tenant_id = l.tenant_id
           WHERE l.tenant_id = $1 AND l.document_id = $2 AND l.expires_at > now()
             AND l.holder_user_id <> $3::uuid
           LIMIT 1) AS lock_holder`,
      [context.tenantId, documentId, context.userId],
    );
    const counts: Record<string, number> = {
      versions: Number(row?.versions ?? 0),
      attachments: Number(row?.attachments ?? 0),
      citing_documents: Number(row?.citing_documents ?? 0),
      cited_documents: Number(row?.cited_documents ?? 0),
      applications: Number(row?.applications ?? 0),
      assets: Number(row?.assets ?? 0),
      projects: Number(row?.projects ?? 0),
      requests: Number(row?.requests ?? 0),
      tasks: Number(row?.tasks ?? 0),
      locations: Number(row?.locations ?? 0),
      connections: Number(row?.connections ?? 0),
      interfaces: Number(row?.interfaces ?? 0),
      incidents: Number(row?.incidents ?? 0),
      derived_documents: Number(row?.derived_documents ?? 0),
    };
    const readable = await this.policy.readableResources(
      context,
      Array.from(new Set(Object.values(DOCUMENT_LINK_READS))),
      context.manager,
    );
    let hidden = 0;
    for (const [family, resource] of Object.entries(DOCUMENT_LINK_READS)) {
      if (readable.has(resource)) continue;
      hidden += counts[family];
      delete counts[family];
    }
    return {
      counts,
      ...(hidden > 0 ? { hidden } : {}),
      ...(Number(row?.active_workflows ?? 0) > 0 ? { inReview: true } : {}),
      ...(row?.lock_holder ? { lockHolder: String(row.lock_holder) } : {}),
    };
  }

  /**
   * One statement for what a connection's delete takes, all under its tenant. The interfaces
   * that lose it are named only for a reader of the applications, and its linked documents only
   * for a reader of the knowledge library; anyone else sees them counted among the other links.
   */
  private async connectionImpact(context: AiExecutionContextWithManager, connectionId: string): Promise<AiDeleteImpact> {
    const [row] = await context.manager.query(
      `SELECT
         (SELECT count(*)::int FROM connection_legs WHERE tenant_id = $1 AND connection_id = $2) AS hops,
         (SELECT count(*)::int FROM connection_servers WHERE tenant_id = $1 AND connection_id = $2) AS servers,
         (SELECT count(*)::int FROM connection_protocols WHERE tenant_id = $1 AND connection_id = $2) AS protocols,
         (SELECT count(DISTINCT b.interface_id)::int
            FROM interface_connection_links l
            JOIN interface_bindings b ON b.tenant_id = l.tenant_id AND b.id = l.interface_binding_id
           WHERE l.tenant_id = $1 AND l.connection_id = $2) AS interfaces,
         (SELECT count(*)::int FROM document_connections WHERE tenant_id = $1 AND connection_id = $2) AS documents`,
      [context.tenantId, connectionId],
    );
    const counts: Record<string, number> = {
      hops: Number(row?.hops ?? 0),
      servers: Number(row?.servers ?? 0),
      protocols: Number(row?.protocols ?? 0),
      interfaces: Number(row?.interfaces ?? 0),
      documents: Number(row?.documents ?? 0),
    };
    const readable = await this.policy.readableResources(context, ['applications', 'knowledge'], context.manager);
    let hidden = 0;
    for (const [family, resource] of [['interfaces', 'applications'], ['documents', 'knowledge']] as const) {
      if (readable.has(resource)) continue;
      hidden += counts[family];
      delete counts[family];
    }
    return hidden > 0 ? { counts, hidden } : { counts };
  }

  /**
   * One statement for what an interface's delete takes, all under its tenant. Its integrated and
   * linked documents are named only for a reader of the knowledge library; its bindings,
   * connection links, dependencies, attachments and applications belong to the applications
   * module the deleter administers.
   */
  private async interfaceImpact(context: AiExecutionContextWithManager, interfaceId: string): Promise<AiDeleteImpact> {
    const [row] = await context.manager.query(
      `SELECT
         (SELECT count(*)::int FROM interface_bindings WHERE tenant_id = $1 AND interface_id = $2) AS bindings,
         (SELECT count(*)::int
            FROM interface_connection_links l
            JOIN interface_bindings b ON b.tenant_id = l.tenant_id AND b.id = l.interface_binding_id
           WHERE l.tenant_id = $1 AND b.interface_id = $2) AS connection_links,
         (SELECT count(*)::int FROM integrated_document_bindings
           WHERE tenant_id = $1 AND source_entity_type = 'interfaces' AND source_entity_id = $2) AS integrated_documents,
         (SELECT count(*)::int FROM document_interfaces WHERE tenant_id = $1 AND interface_id = $2) AS documents,
         (SELECT count(DISTINCT other.id)::int
            FROM interface_dependencies d
            JOIN interfaces other ON other.tenant_id = d.tenant_id
              AND other.id = CASE WHEN d.interface_id = $2 THEN d.related_interface_id ELSE d.interface_id END
           WHERE d.tenant_id = $1 AND (d.interface_id = $2 OR d.related_interface_id = $2)) AS dependencies,
         (SELECT count(*)::int FROM interface_attachments WHERE tenant_id = $1 AND interface_id = $2) AS attachments,
         (SELECT count(DISTINCT a.id)::int FROM (
            SELECT source_application_id AS id FROM interfaces WHERE tenant_id = $1 AND id = $2
            UNION
            SELECT target_application_id FROM interfaces WHERE tenant_id = $1 AND id = $2
            UNION
            SELECT application_id FROM interface_middleware_applications WHERE tenant_id = $1 AND interface_id = $2
          ) a) AS applications`,
      [context.tenantId, interfaceId],
    );
    const counts: Record<string, number> = {
      bindings: Number(row?.bindings ?? 0),
      connection_links: Number(row?.connection_links ?? 0),
      integrated_documents: Number(row?.integrated_documents ?? 0),
      documents: Number(row?.documents ?? 0),
      dependencies: Number(row?.dependencies ?? 0),
      attachments: Number(row?.attachments ?? 0),
      applications: Number(row?.applications ?? 0),
    };
    const readable = await this.policy.readableResources(context, ['knowledge'], context.manager);
    let hidden = 0;
    for (const family of ['integrated_documents', 'documents'] as const) {
      if (readable.has('knowledge')) continue;
      hidden += counts[family];
      delete counts[family];
    }
    return hidden > 0 ? { counts, hidden } : { counts };
  }

  /**
   * The screen's 409 for an interface with bindings, with their count and what to do: ask again
   * with `delete_related_bindings` set to true, which deletes the bindings and their links to
   * connections with the interface.
   */
  private interfaceBindingsRefusal(name: string, total: number): ConflictException {
    const bindings = total === 1 ? '1 binding' : `${total} bindings`;
    return new ConflictException({
      statusCode: 409,
      error: 'Conflict',
      code: 'INTERFACE_HAS_BINDINGS',
      message: `Cannot delete interface "${name}" because it has ${bindings}. Ask again with delete_related_bindings set to true to delete it with its bindings, or remove them first.`,
      usages: [{ type: 'interface_bindings', total }],
    });
  }

  /**
   * The delete through the screen's service, with the AI audit source. The preview service has
   * already checked the rights, the reservation and the participation scope again; the record is
   * read again here for the drift check, and the task's own service re-checks its delete refusals.
   */
  async execute(context: AiExecutionContextWithManager, preview: AiMutationPreview): Promise<void> {
    const entityType = String(preview.target_entity_type ?? preview.mutation_input?.entity_type ?? '') as AiDeleteEntityType;
    if (!AI_DELETE_ENTITY_TYPES.includes(entityType)) {
      throw new NotFoundException('Record not found.');
    }
    const targetId = preview.target_entity_id;
    if (!targetId) throw new NotFoundException(`${LABELS[entityType]} not found.`);
    const expectedUpdatedAt = isoTimestamp(preview.current_values?.updated_at);
    const audit = buildAiMutationAudit(preview);

    switch (entityType) {
      case 'tasks': {
        const task = await this.taskSupport.resolveTaskSnapshot(context, targetId);
        this.assertNotChanged(entityType, expectedUpdatedAt, task.updated_at);
        this.assertImpactUnchanged(entityType, preview, await this.taskImpact(context, task.task_id));
        try {
          await this.tasksDelete.delete(task.task_id, {
            manager: context.manager,
            userId: context.userId,
            audit,
          });
        } catch (error) {
          // A request that took the task as its origin between the preview and the approval:
          // the screen's refusal, made actionable as it was at the preview.
          if (error instanceof RecordInUseException && error.code === 'TASK_REQUEST_ORIGIN') {
            throw this.originRefusal(error);
          }
          throw error;
        }
        return;
      }
      case 'contacts': {
        const found = await this.masterData.resolveRecordReference(context, 'contacts', targetId);
        this.assertNotChanged(entityType, expectedUpdatedAt, isoTimestamp(found.row.updated_at));
        this.assertImpactUnchanged(entityType, preview, await this.contactImpact(context, found.id));
        await this.contacts.delete(found.id, {
          manager: context.manager,
          tenantId: context.tenantId,
          userId: context.userId,
          audit,
        });
        return;
      }
      case 'locations': {
        const found = await this.masterData.resolveRecordReference(context, 'locations', targetId);
        this.assertNotChanged(entityType, expectedUpdatedAt, isoTimestamp(found.row.updated_at));
        this.assertImpactUnchanged(entityType, preview, await this.locationImpact(context, found.id));
        await this.locations.delete(found.id, context.userId, { manager: context.manager, audit });
        return;
      }
      case 'budget_lines': {
        const found = await this.resolveSpendLine(context, targetId);
        this.assertNotChanged(entityType, expectedUpdatedAt, found.updatedAt);
        this.assertImpactUnchanged(entityType, preview, await this.spendImpact(context, found.nature, found.id));
        const deleter = found.nature === 'opex' ? this.opexDelete : this.capexDelete;
        await deleter.delete(found.id, {
          manager: context.manager,
          userId: context.userId,
          audit,
        });
        return;
      }
      case 'connections': {
        const found = await this.businessRecords.resolveRecordReference(context, 'connections', targetId);
        this.assertNotChanged(entityType, expectedUpdatedAt, isoTimestamp(found.row.updated_at));
        this.assertImpactUnchanged(entityType, preview, await this.connectionImpact(context, found.id));
        await this.connections.delete(found.id, context.userId, { manager: context.manager, audit });
        return;
      }
      case 'interfaces': {
        const found = await this.businessRecords.resolveRecordReference(context, 'interfaces', targetId);
        this.assertNotChanged(entityType, expectedUpdatedAt, isoTimestamp(found.row.updated_at));
        const impact = await this.interfaceImpact(context, found.id);
        this.assertImpactUnchanged(entityType, preview, impact);
        const deleteRelatedBindings = preview.mutation_input?.delete_related_bindings === true;
        const bindings = Number(impact.counts.bindings ?? 0);
        if (bindings > 0 && !deleteRelatedBindings) {
          throw this.interfaceBindingsRefusal(found.label, bindings);
        }
        await this.interfaces.delete(found.id, context.userId, {
          manager: context.manager,
          deleteRelatedBindings,
          audit,
        });
        return;
      }
      case 'documents': {
        const document = await this.documentSupport.resolveDocumentSnapshot(context, targetId);
        this.assertNotChanged(entityType, expectedUpdatedAt, document.updated_at);
        await this.knowledge.assertDocumentWritable(document.document_id, context.manager, context.userId);
        const refusal = await this.knowledge.managedDocumentRefusal(
          { id: document.document_id, title: document.target_title ?? '' },
          context.manager,
        );
        if (refusal) throw refusal;
        this.assertImpactUnchanged(entityType, preview, await this.documentImpact(context, document.document_id));
        await this.knowledge.remove(document.document_id, context.userId, {
          manager: context.manager,
          audit,
        });
        return;
      }
    }
  }

  /**
   * The record moved between the preview and the approval, or the dates cannot prove that it did
   * not: refused, as every other preview. A missing date on either side is treated as a change.
   */
  private assertNotChanged(entityType: AiDeleteEntityType, expected: string | null, live: string | null): void {
    if (expected && live && expected === live) return;
    throw new ConflictException(`${LABELS[entityType]} changed after the preview was created.`);
  }

  /**
   * What the delete takes changed between the preview and the approval (a comment or a time entry
   * added, a link removed) without always moving `updated_at`: refused, like a changed record.
   */
  private assertImpactUnchanged(
    entityType: AiDeleteEntityType,
    preview: AiMutationPreview,
    live: AiDeleteImpact,
  ): void {
    const current = preview.current_values ?? {};
    const expectedCounts = current.counts && typeof current.counts === 'object' && !Array.isArray(current.counts)
      ? current.counts as Record<string, unknown>
      : {};
    const expectedHidden = Number(current.hidden) || 0;
    const expected = Object.fromEntries(
      Object.entries(expectedCounts)
        .map(([key, value]) => [key, Number(value) || 0])
        .filter(([, value]) => Number(value) > 0)
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    );
    const observed = Object.fromEntries(
      Object.entries(live.counts)
        .filter(([, value]) => Number(value) > 0)
        .sort(([left], [right]) => String(left).localeCompare(String(right))),
    );
    if (JSON.stringify(expected) !== JSON.stringify(observed) || expectedHidden !== (live.hidden ?? 0)) {
      throw new ConflictException(`${LABELS[entityType]} changed after the preview was created.`);
    }
  }
}
