import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { ContactsService } from '../../contacts/contacts.service';
import { LocationsService } from '../../locations/locations.service';
import { assertTaskDeletable } from '../../tasks/task-data-access';
import { originRefusals, TasksDeleteService } from '../../tasks/tasks-delete.service';
import { RecordInUseException } from '../../common/record-in-use';
import { AiPolicyService } from '../ai-policy.service';
import { AiMutationPreview } from '../ai-mutation-preview.entity';
import { AiExecutionContextWithManager } from '../ai.types';
import { AiDeleteImpact } from '../ai-write-texts';
import { buildAiMutationAudit } from './ai-mutation-audit.util';
import { AiMasterDataMutationSupportService } from './ai-master-data-mutation-support.service';
import { AiTaskMutationSupportService } from './ai-task-mutation-support.service';

/** The families a person may delete one record of, in this lot. Lots 2 and 3 add the others. */
export const AI_DELETE_ENTITY_TYPES = ['tasks', 'contacts', 'locations'] as const;
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

const LABELS: Record<AiDeleteEntityType, string> = {
  tasks: 'Task',
  contacts: 'Contact',
  locations: 'Location',
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
    private readonly tasksDelete: TasksDeleteService,
    private readonly contacts: ContactsService,
    private readonly locations: LocationsService,
    private readonly policy: AiPolicyService,
  ) {}

  /**
   * The record a reference or an exact name names, with the same scope as the screen, and what
   * its delete takes. The screen's refusals run here, before any preview exists: a task that
   * started a request (409, with what to do) and a task whose budget line or contract the person
   * may not modify (403, `assertTaskDeletable`).
   */
  async prepare(
    context: AiExecutionContextWithManager,
    entityType: AiDeleteEntityType,
    ref: string,
  ): Promise<AiPreparedDelete> {
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
          impact: { counts: await this.taskImpact(context.manager, context.tenantId, task.task_id) },
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
        return {
          target: {
            entityType,
            id: found.id,
            ref: found.ref,
            title: found.label,
            updatedAt: isoTimestamp(found.row.updated_at),
          },
          impact: { counts: await this.locationImpact(context.manager, context.tenantId, found.id) },
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

  /** One statement per family of what goes with a task, all under its tenant. */
  private async taskImpact(manager: EntityManager, tenantId: string, taskId: string): Promise<Record<string, number>> {
    const [row] = await manager.query(
      `SELECT
         (SELECT count(*)::int FROM portfolio_activities WHERE tenant_id = $1 AND task_id = $2) AS activities,
         (SELECT count(*)::int FROM task_time_entries WHERE tenant_id = $1 AND task_id = $2) AS time_entries,
         (SELECT count(*)::int FROM task_attachments WHERE tenant_id = $1 AND task_id = $2) AS attachments,
         (SELECT count(*)::int FROM task_applications WHERE tenant_id = $1 AND task_id = $2)
           + (SELECT count(*)::int FROM task_assets WHERE tenant_id = $1 AND task_id = $2)
           + (SELECT count(*)::int FROM document_tasks WHERE tenant_id = $1 AND task_id = $2) AS links`,
      [tenantId, taskId],
    );
    return {
      activities: Number(row?.activities ?? 0),
      time_entries: Number(row?.time_entries ?? 0),
      attachments: Number(row?.attachments ?? 0),
      links: Number(row?.links ?? 0),
    };
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
       SELECT 'budget_lines', count(DISTINCT spend_item_id)::int
         FROM spend_item_contacts WHERE tenant_id = $1 AND contact_id = $2
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
      if (readable.has(resources[row.family])) counts[row.family] = total;
      else hidden += total;
    }
    return hidden > 0 ? { counts, hidden } : { counts };
  }

  /** One statement for what a location's delete takes, all under its tenant. */
  private async locationImpact(manager: EntityManager, tenantId: string, locationId: string): Promise<Record<string, number>> {
    const [row] = await manager.query(
      `SELECT
         (SELECT count(*)::int FROM assets WHERE tenant_id = $1 AND location_id = $2) AS assets,
         (SELECT count(*)::int FROM location_contacts WHERE tenant_id = $1 AND location_id = $2)
           + (SELECT count(*)::int FROM location_user_contacts WHERE tenant_id = $1 AND location_id = $2) AS contacts,
         (SELECT count(*)::int FROM location_links WHERE tenant_id = $1 AND location_id = $2) AS links,
         (SELECT count(*)::int FROM location_sub_items WHERE tenant_id = $1 AND location_id = $2) AS sub_items,
         (SELECT count(*)::int FROM document_locations WHERE tenant_id = $1 AND location_id = $2) AS documents`,
      [tenantId, locationId],
    );
    return {
      assets: Number(row?.assets ?? 0),
      contacts: Number(row?.contacts ?? 0),
      links: Number(row?.links ?? 0),
      sub_items: Number(row?.sub_items ?? 0),
      documents: Number(row?.documents ?? 0),
    };
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
        await this.tasksDelete.delete(task.task_id, {
          manager: context.manager,
          userId: context.userId,
          audit,
        });
        return;
      }
      case 'contacts': {
        const found = await this.masterData.resolveRecordReference(context, 'contacts', targetId);
        this.assertNotChanged(entityType, expectedUpdatedAt, isoTimestamp(found.row.updated_at));
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
        await this.locations.delete(found.id, context.userId, { manager: context.manager, audit });
        return;
      }
    }
  }

  /** The record moved between the preview and the approval: refused, as every other preview. */
  private assertNotChanged(entityType: AiDeleteEntityType, expected: string | null, live: string | null): void {
    if (!expected || !live || expected === live) return;
    throw new ConflictException(`${LABELS[entityType]} changed after the preview was created.`);
  }
}
