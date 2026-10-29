import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Task, TaskPriorityLevel } from './task.entity';
import { TaskTimeEntry } from './task-time-entry.entity';
import { AuditService } from '../audit/audit.service';
import { ItemNumberService } from '../common/item-number.service';
import { PortfolioProjectPhase } from '../portfolio/portfolio-project-phase.entity';
import { PortfolioActivity } from '../portfolio/portfolio-activity.entity';
import { UserTimeAggregateService } from '../portfolio/services/user-time-aggregate.service';
import { PortfolioProjectsService } from '../portfolio/services';
import { NotificationsService } from '../notifications/notifications.service';
import { ShareItemDto } from '../notifications/dto/share-item.dto';
import { shareRecipientsOf } from '../notifications/share-recipients';
import { displayName } from '../common/display-name';
import { TaskActivitiesService } from './task-activities.service';
import { TaskAttachmentsService } from './task-attachments.service';
import { detectChanges, resolveDisplayNames, TASK_TRACKED_FIELDS, FieldConfig } from '../common/change-detection';
import { normalizeMarkdownRichText } from '../common/markdown-worker';
import { assertTaskModifiable, prepareTaskWrite } from './task-data-access';
import { assertLinesEditable } from '../data-access/line-write-checks';
import { assertContractsEditable } from '../data-access/contract-write-checks';
import { writeTaskColumns } from './task-column-write';
import { ParticipationAccessScope, taskParticipantCondition } from '../auth/business-contributor-scope';
import { shareRecipientsWhoCannotOpen } from '../data-access/can-read';
import {
  IncidentViewer,
  taskIncidentVisibilityQueryBuilderClause,
  taskIncidentVisibilitySql,
} from '../incidents/incident-visibility';

export type RelatedType = 'spend_item' | 'contract' | 'capex_item' | 'project' | 'incident' | null;
type ProjectDefaults = {
  source_id: string | null;
  category_id: string | null;
  stream_id: string | null;
  company_id: string | null;
};

type TaskAuditOptions = {
  source?: string;
  sourceRef?: string | null;
};

type TaskMutationOptions = {
  manager?: EntityManager;
  tenantId?: string;
  audit?: TaskAuditOptions;
};

type TaskRelationPayload = Partial<Task> & {
  application_ids?: string[];
  asset_ids?: string[];
};

@Injectable()
export class TasksUnifiedService {
  private readonly logger = new Logger(TasksUnifiedService.name);

  constructor(
    @InjectRepository(Task) private readonly repo: Repository<Task>,
    private readonly audit: AuditService,
    private readonly dataSource: DataSource,
    private readonly userTimeAggregateService: UserTimeAggregateService,
    private readonly notifications: NotificationsService,
    private readonly itemNumberService: ItemNumberService,
    private readonly taskActivitiesSvc: TaskActivitiesService,
    private readonly taskAttachmentsSvc: TaskAttachmentsService,
    private readonly portfolioProjectsService: PortfolioProjectsService,
  ) {}

  /**
   * Check if a task has any time logged
   */
  private async hasTimeLogged(taskId: string, manager: EntityManager): Promise<boolean> {
    const repo = manager.getRepository(TaskTimeEntry);
    const count = await repo.count({ where: { task_id: taskId } });
    return count > 0;
  }

  private isNonProjectLinked(type: RelatedType): type is 'spend_item' | 'contract' | 'capex_item' | 'incident' {
    return type === 'spend_item' || type === 'contract' || type === 'capex_item' || type === 'incident';
  }

  private getRelatedProjectId(task: Pick<Task, 'related_object_type' | 'related_object_id'>): string | null {
    return task.related_object_type === 'project' && task.related_object_id ? task.related_object_id : null;
  }

  private hasOwn(payload: Partial<Task>, key: keyof Task): boolean {
    return Object.prototype.hasOwnProperty.call(payload, key);
  }

  private hasPayloadKey(payload: Record<string, unknown>, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(payload, key);
  }

  private normalizeLinkIds(value: unknown, fieldName: string): string[] {
    if (value == null) return [];
    if (!Array.isArray(value)) {
      throw new BadRequestException(`${fieldName} must be an array`);
    }
    const normalized = value.map((item) => String(item || '').trim()).filter(Boolean);
    return Array.from(new Set(normalized));
  }

  private async getTaskTenant(taskId: string, manager: EntityManager): Promise<string> {
    const rows: Array<{ tenant_id: string }> = await manager.query(
      `SELECT tenant_id::text AS tenant_id
       FROM tasks
       WHERE id = $1
       LIMIT 1`,
      [taskId],
    );
    const tenantId = rows[0]?.tenant_id;
    if (!tenantId) throw new NotFoundException('Task not found');
    return tenantId;
  }

  private async resolveLinkNames(
    table: 'applications' | 'assets',
    ids: string[],
    tenantId: string,
    manager: EntityManager,
  ): Promise<string[]> {
    if (ids.length === 0) return [];
    const rows: Array<{ id: string; name: string | null }> = await manager.query(
      `SELECT id::text AS id, name
       FROM ${table}
       WHERE tenant_id = $1
         AND id = ANY($2::uuid[])
       ORDER BY name ASC NULLS LAST, id ASC`,
      [tenantId, ids],
    );
    const byId = new Map(rows.map((row) => [row.id, row.name || row.id]));
    return ids.map((id) => byId.get(id) || id);
  }

  private async validateLinkedIds(
    table: 'applications' | 'assets',
    ids: string[],
    tenantId: string,
    manager: EntityManager,
    fieldName: string,
  ): Promise<void> {
    if (ids.length === 0) return;
    const rows: Array<{ id: string }> = await manager.query(
      `SELECT id::text AS id
       FROM ${table}
       WHERE tenant_id = $1
         AND id = ANY($2::uuid[])`,
      [tenantId, ids],
    );
    const found = new Set(rows.map((row) => row.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Invalid ${fieldName}: ${missing.join(', ')}`);
    }
  }

  private async syncTaskLinks(params: {
    taskId: string;
    ids: string[];
    table: 'task_applications' | 'task_assets';
    targetTable: 'applications' | 'assets';
    targetColumn: 'application_id' | 'asset_id';
    fieldName: 'application_ids' | 'asset_ids';
    changedField: 'linked_applications' | 'linked_assets';
    tenantId?: string;
    userId?: string | null;
    audit?: TaskAuditOptions;
    manager: EntityManager;
  }): Promise<void> {
    const tenantId = params.tenantId || await this.getTaskTenant(params.taskId, params.manager);
    const ids = this.normalizeLinkIds(params.ids, params.fieldName);
    // Elements of a task: the task modifiable (policy of task_applications and task_assets).
    await assertTaskModifiable(params.manager, params.taskId);
    await this.validateLinkedIds(params.targetTable, ids, tenantId, params.manager, params.fieldName);

    const existingRows: Array<{ id: string }> = await params.manager.query(
      `SELECT ${params.targetColumn}::text AS id
       FROM ${params.table}
       WHERE tenant_id = $1
         AND task_id = $2`,
      [tenantId, params.taskId],
    );
    const existingIds = existingRows.map((row) => row.id);
    const existingSet = new Set(existingIds);
    const nextSet = new Set(ids);
    const toInsert = ids.filter((id) => !existingSet.has(id));
    const toDelete = existingIds.filter((id) => !nextSet.has(id));

    if (toInsert.length === 0 && toDelete.length === 0) {
      return;
    }

    const beforeNames = await this.resolveLinkNames(params.targetTable, existingIds, tenantId, params.manager);
    const afterNames = await this.resolveLinkNames(params.targetTable, ids, tenantId, params.manager);

    if (toDelete.length > 0) {
      await params.manager.query(
        `DELETE FROM ${params.table}
         WHERE tenant_id = $1
           AND task_id = $2
           AND ${params.targetColumn} = ANY($3::uuid[])`,
        [tenantId, params.taskId, toDelete],
      );
    }

    if (toInsert.length > 0) {
      await params.manager.query(
        `INSERT INTO ${params.table} (tenant_id, task_id, ${params.targetColumn})
         SELECT $1::uuid, $2::uuid, unnest($3::uuid[])
         ON CONFLICT (task_id, ${params.targetColumn}) DO NOTHING`,
        [tenantId, params.taskId, toInsert],
      );
    }

    // One audit row per set changed, the task in `record_id` and the sorted ids before and after
    // (`setOwnedLink`): the task's history reads it by `record_id`. The feed entry stays below.
    await this.audit.log({
      table: params.table,
      recordId: params.taskId,
      action: 'update',
      before: { ids: [...existingIds].sort() },
      after: { ids: [...ids].sort() },
      userId: params.userId ?? null,
      source: params.audit?.source,
      sourceRef: params.audit?.sourceRef ?? null,
    }, { manager: params.manager });

    await this.taskActivitiesSvc.logChange(
      params.taskId,
      { [params.changedField]: [beforeNames, afterNames] },
      tenantId,
      params.userId ?? null,
      { manager: params.manager },
    );
  }

  async setApplicationLinks(taskId: string, applicationIds: string[], opts?: { manager?: EntityManager; tenantId?: string; userId?: string | null; audit?: TaskAuditOptions }): Promise<void> {
    const manager = opts?.manager ?? this.repo.manager;
    const run = (mg: EntityManager) => this.syncTaskLinks({
      taskId,
      ids: applicationIds,
      table: 'task_applications',
      targetTable: 'applications',
      targetColumn: 'application_id',
      fieldName: 'application_ids',
      changedField: 'linked_applications',
      tenantId: opts?.tenantId,
      userId: opts?.userId,
      audit: opts?.audit,
      manager: mg,
    });
    if (opts?.manager) return run(manager);
    return this.dataSource.transaction(run);
  }

  async setAssetLinks(taskId: string, assetIds: string[], opts?: { manager?: EntityManager; tenantId?: string; userId?: string | null; audit?: TaskAuditOptions }): Promise<void> {
    const manager = opts?.manager ?? this.repo.manager;
    const run = (mg: EntityManager) => this.syncTaskLinks({
      taskId,
      ids: assetIds,
      table: 'task_assets',
      targetTable: 'assets',
      targetColumn: 'asset_id',
      fieldName: 'asset_ids',
      changedField: 'linked_assets',
      tenantId: opts?.tenantId,
      userId: opts?.userId,
      audit: opts?.audit,
      manager: mg,
    });
    if (opts?.manager) return run(manager);
    return this.dataSource.transaction(run);
  }

  async listApplicationsForTask(taskId: string, opts?: { manager?: EntityManager; tenantId?: string }) {
    const manager = opts?.manager ?? this.repo.manager;
    const tenantId = opts?.tenantId || await this.getTaskTenant(taskId, manager);
    return manager.query(
      `SELECT a.id, a.name, a.sequential_id, a.lifecycle, a.criticality
       FROM task_applications ta
       JOIN applications a ON a.id = ta.application_id AND a.tenant_id = ta.tenant_id
       WHERE ta.tenant_id = $1
         AND ta.task_id = $2
       ORDER BY a.name ASC, a.id ASC`,
      [tenantId, taskId],
    );
  }

  async listAssetsForTask(taskId: string, opts?: { manager?: EntityManager; tenantId?: string }) {
    const manager = opts?.manager ?? this.repo.manager;
    const tenantId = opts?.tenantId || await this.getTaskTenant(taskId, manager);
    return manager.query(
      `SELECT a.id, a.name, a.asset_reference, a.hostname, a.environment, a.status
       FROM task_assets ta
       JOIN assets a ON a.id = ta.asset_id AND a.tenant_id = ta.tenant_id
       WHERE ta.tenant_id = $1
         AND ta.task_id = $2
       ORDER BY a.name ASC, a.id ASC`,
      [tenantId, taskId],
    );
  }

  async listRelatedTasksForApplication(
    applicationId: string,
    query?: any,
    opts?: { manager?: EntityManager; tenantId?: string; accessScope?: ParticipationAccessScope; viewer?: IncidentViewer | null },
  ) {
    return this.listRelatedTasksByLink({
      linkTable: 'task_applications',
      targetColumn: 'application_id',
      targetId: applicationId,
      query,
      opts,
    });
  }

  async listRelatedTasksForAsset(
    assetId: string,
    query?: any,
    opts?: { manager?: EntityManager; tenantId?: string; accessScope?: ParticipationAccessScope; viewer?: IncidentViewer | null },
  ) {
    return this.listRelatedTasksByLink({
      linkTable: 'task_assets',
      targetColumn: 'asset_id',
      targetId: assetId,
      query,
      opts,
    });
  }

  async bulkReplaceTasksForApplication(
    applicationId: string,
    taskIds: string[],
    opts?: { manager?: EntityManager; tenantId?: string; userId?: string | null; accessScope?: ParticipationAccessScope },
  ) {
    return this.bulkReplaceTargetTaskLinks({
      linkTable: 'task_applications',
      targetTable: 'applications',
      targetColumn: 'application_id',
      targetId: applicationId,
      fieldName: 'application_ids',
      changedField: 'linked_applications',
      taskIds,
      opts,
    });
  }

  async bulkReplaceTasksForAsset(
    assetId: string,
    taskIds: string[],
    opts?: { manager?: EntityManager; tenantId?: string; userId?: string | null; accessScope?: ParticipationAccessScope },
  ) {
    return this.bulkReplaceTargetTaskLinks({
      linkTable: 'task_assets',
      targetTable: 'assets',
      targetColumn: 'asset_id',
      targetId: assetId,
      fieldName: 'asset_ids',
      changedField: 'linked_assets',
      taskIds,
      opts,
    });
  }

  private async bulkReplaceTargetTaskLinks(params: {
    linkTable: 'task_applications' | 'task_assets';
    targetTable: 'applications' | 'assets';
    targetColumn: 'application_id' | 'asset_id';
    targetId: string;
    fieldName: 'application_ids' | 'asset_ids';
    changedField: 'linked_applications' | 'linked_assets';
    taskIds: string[];
    opts?: { manager?: EntityManager; tenantId?: string; userId?: string | null; accessScope?: ParticipationAccessScope };
  }): Promise<{ task_ids: string[] }> {
    const manager = params.opts?.manager ?? this.repo.manager;
    const run = async (mg: EntityManager) => {
      const tenantId = params.opts?.tenantId || await this.getTaskTenantContext(mg);
      const taskIds = this.normalizeLinkIds(params.taskIds, 'task_ids');
      await this.validateTaskIds(taskIds, tenantId, mg, params.opts?.accessScope);

      const existingQueryParams: unknown[] = [tenantId, params.targetId];
      const accessScopeSql = params.opts?.accessScope
        ? (() => {
          existingQueryParams.push(params.opts.accessScope.userId);
          return `AND ${taskParticipantCondition('t', `$${existingQueryParams.length}`)}`;
        })()
        : '';
      const existingRows: Array<{ id: string }> = await mg.query(
        `SELECT rel.task_id::text AS id
         FROM ${params.linkTable} rel
         JOIN tasks t ON t.id = rel.task_id AND t.tenant_id = rel.tenant_id
         WHERE rel.tenant_id = $1
           AND rel.${params.targetColumn} = $2
           ${accessScopeSql}`,
        existingQueryParams,
      );

      const existingIds = existingRows.map((row) => row.id);
      const nextTaskSet = new Set(taskIds);
      const affectedTaskIds = Array.from(new Set([...existingIds, ...taskIds]));

      for (const taskId of affectedTaskIds) {
        const currentTargetIds = await this.listTaskLinkedTargetIds({
          linkTable: params.linkTable,
          targetColumn: params.targetColumn,
          taskId,
          tenantId,
          manager: mg,
        });
        const nextTargetIds = nextTaskSet.has(taskId)
          ? Array.from(new Set([...currentTargetIds, params.targetId]))
          : currentTargetIds.filter((id) => id !== params.targetId);

        await this.syncTaskLinks({
          taskId,
          ids: nextTargetIds,
          table: params.linkTable,
          targetTable: params.targetTable,
          targetColumn: params.targetColumn,
          fieldName: params.fieldName,
          changedField: params.changedField,
          tenantId,
          userId: params.opts?.userId,
          manager: mg,
        });
      }

      return { task_ids: taskIds };
    };

    if (params.opts?.manager) return run(manager);
    return this.dataSource.transaction(run);
  }

  private async validateTaskIds(
    ids: string[],
    tenantId: string,
    manager: EntityManager,
    accessScope?: ParticipationAccessScope,
  ): Promise<void> {
    if (ids.length === 0) return;
    const queryParams: unknown[] = [tenantId, ids];
    const accessScopeSql = accessScope
      ? (() => {
        queryParams.push(accessScope.userId);
        return `AND ${taskParticipantCondition('t', `$${queryParams.length}`)}`;
      })()
      : '';
    const rows: Array<{ id: string }> = await manager.query(
      `SELECT t.id::text AS id
       FROM tasks t
       WHERE t.tenant_id = $1
         AND t.id = ANY($2::uuid[])
         ${accessScopeSql}`,
      queryParams,
    );
    const found = new Set(rows.map((row) => row.id));
    const missing = ids.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new BadRequestException(`Invalid task_ids: ${missing.join(', ')}`);
    }
  }

  private async listTaskLinkedTargetIds(params: {
    linkTable: 'task_applications' | 'task_assets';
    targetColumn: 'application_id' | 'asset_id';
    taskId: string;
    tenantId: string;
    manager: EntityManager;
  }): Promise<string[]> {
    const rows: Array<{ id: string }> = await params.manager.query(
      `SELECT ${params.targetColumn}::text AS id
       FROM ${params.linkTable}
       WHERE tenant_id = $1
         AND task_id = $2
       ORDER BY ${params.targetColumn} ASC`,
      [params.tenantId, params.taskId],
    );
    return rows.map((row) => row.id);
  }

  private async listRelatedTasksByLink(params: {
    linkTable: 'task_applications' | 'task_assets';
    targetColumn: 'application_id' | 'asset_id';
    targetId: string;
    query?: any;
    opts?: { manager?: EntityManager; tenantId?: string; accessScope?: ParticipationAccessScope; viewer?: IncidentViewer | null };
  }) {
    const manager = params.opts?.manager ?? this.repo.manager;
    const tenantId = params.opts?.tenantId || await this.getTaskTenantContext(manager);
    const page = Math.max(Number(params.query?.page) || 1, 1);
    const limit = Math.min(Math.max(Number(params.query?.limit) || 20, 1), 100);
    const skip = (page - 1) * limit;
    const sortRaw = String(params.query?.sort || 'updated_at:DESC');
    const [field, directionRaw] = sortRaw.split(':');
    const direction = directionRaw?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    const sortFieldMap: Record<string, string> = {
      title: 't.title',
      status: 't.status',
      due_date: 't.due_date',
      created_at: 't.created_at',
      updated_at: 't.updated_at',
      item_number: 't.item_number',
    };
    const sortField = sortFieldMap[field] || 't.updated_at';

    const baseParams: unknown[] = [tenantId, params.targetId];
    const accessScopeSql = params.opts?.accessScope
      ? (() => {
        baseParams.push(params.opts.accessScope.userId);
        return `AND ${taskParticipantCondition('t', `$${baseParams.length}`)}`;
      })()
      : '';
    // A task of an incident the reader cannot see is absent from the other record's tab too.
    const incidentVisibilitySql = taskIncidentVisibilitySql('t', params.opts?.viewer, baseParams);

    const countRows: Array<{ count: number }> = await manager.query(
      `SELECT COUNT(*)::int AS count
       FROM ${params.linkTable} rel
       JOIN tasks t ON t.id = rel.task_id AND t.tenant_id = rel.tenant_id
       WHERE rel.tenant_id = $1
         AND rel.${params.targetColumn} = $2
         ${accessScopeSql}
         ${incidentVisibilitySql}`,
      baseParams,
    );

    const itemParams = [...baseParams, limit, skip];
    const items = await manager.query(
      `SELECT t.id,
              t.tenant_id,
              t.item_number,
              t.title,
              t.description,
              t.status,
              t.due_date,
              t.start_date,
              t.created_at,
              t.updated_at,
              t.assignee_user_id,
              COALESCE(NULLIF(TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))), ''), u.email) AS assignee_name,
              t.related_object_type,
              t.related_object_id
       FROM ${params.linkTable} rel
       JOIN tasks t ON t.id = rel.task_id AND t.tenant_id = rel.tenant_id
       LEFT JOIN users u ON u.id = t.assignee_user_id AND u.tenant_id = t.tenant_id
       WHERE rel.tenant_id = $1
         AND rel.${params.targetColumn} = $2
         ${accessScopeSql}
         ${incidentVisibilitySql}
       ORDER BY ${sortField} ${direction}, t.id ASC
       LIMIT $${baseParams.length + 1} OFFSET $${baseParams.length + 2}`,
      itemParams,
    );

    return { items, total: countRows[0]?.count || 0, page, limit };
  }

  private async getTaskTenantContext(manager: EntityManager): Promise<string> {
    const rows: Array<{ tenant_id: string }> = await manager.query(`SELECT app_current_tenant()::text AS tenant_id`);
    const tenantId = rows[0]?.tenant_id;
    if (!tenantId) throw new BadRequestException('Tenant context is required');
    return tenantId;
  }

  private notifyTaskAssignedSafely(params: Parameters<NotificationsService['notifyTaskAssigned']>[0]): void {
    void this.notifications.notifyTaskAssigned(params).catch((error) => {
      this.logger.error(`Failed to notify task assignment for task ${params.taskId}: ${error}`);
    });
  }

  private notifyStatusChangeSafely(params: Parameters<NotificationsService['notifyStatusChange']>[0]): void {
    void this.notifications.notifyStatusChange(params).catch((error) => {
      this.logger.error(`Failed to notify task status change for task ${params.itemId}: ${error}`);
    });
  }

  private async queueTaskAssignmentNotification(
    saved: Task,
    previousAssigneeId: string | null,
    userId: string | undefined,
    tenantId: string | undefined,
    manager: EntityManager,
  ): Promise<void> {
    if (!tenantId || !saved.assignee_user_id || previousAssigneeId === saved.assignee_user_id) {
      return;
    }

    const assignee = await manager.query(
      `SELECT u.email, u.locale FROM users u
       JOIN roles ro ON ro.id = u.role_id
       WHERE u.id = $1 AND u.status = 'enabled'
         AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
      [saved.assignee_user_id],
    );

    if (assignee.length === 0) return;

    const assigner = userId
      ? await manager.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId])
      : [];
    const assignerName = displayName(assigner[0], 'Someone');

    this.notifyTaskAssignedSafely({
      taskId: saved.id,
      taskTitle: saved.title,
      assigneeId: saved.assignee_user_id,
      assigneeEmail: assignee[0].email,
      assignerName,
      dueDate: saved.due_date ? String(saved.due_date).split('T')[0] : undefined,
      tenantId,
      manager,
      locale: assignee[0].locale,
    });
  }

  private async resolveRelatedObjectName(
    type: RelatedType,
    id: string | null,
    manager: EntityManager,
  ): Promise<string | null> {
    if (!type || !id) return null;

    if (type === 'project') {
      const [row] = await manager.query(
        'SELECT item_number, name FROM portfolio_projects WHERE id = $1 LIMIT 1',
        [id],
      );
      if (!row) return id;
      const prefix = row.item_number ? `PRJ-${row.item_number}: ` : '';
      return `${prefix}${row.name}`;
    }

    if (type === 'spend_item') {
      const [row] = await manager.query(
        // An OPEX line only (`spend/budget-nature.ts`).
        `SELECT product_name FROM spend_items WHERE id = $1 AND nature = 'opex' LIMIT 1`,
        [id],
      );
      if (!row) return id;
      return `Spend: ${row.product_name}`;
    }

    if (type === 'contract') {
      const [row] = await manager.query(
        'SELECT name FROM contracts WHERE id = $1 LIMIT 1',
        [id],
      );
      if (!row) return id;
      return `Contract: ${row.name}`;
    }

    if (type === 'capex_item') {
      const [row] = await manager.query(
        // A CAPEX line only (lot Z1: in `spend_items`, its title in `product_name`).
        `SELECT product_name FROM spend_items WHERE id = $1 AND nature = 'capex' LIMIT 1`,
        [id],
      );
      if (!row) return id;
      return `CAPEX: ${row.product_name}`;
    }

    if (type === 'incident') {
      const [row] = await manager.query(
        'SELECT item_number, title, confidential FROM incidents WHERE id = $1 LIMIT 1',
        [id],
      );
      if (!row) return id;
      return row.confidential ? `INC-${row.item_number}` : `INC-${row.item_number} · ${row.title}`;
    }

    return id;
  }

  /**
   * The object a task is created on or moved to: it exists (a line of the type's nature), or 404.
   * Callers check a line with `assertLinesEditable` first: the lock below passes the UPDATE policy
   * of the lines, so a read-only line must answer 403 before it, and a hidden one 404 here.
   */
  private async resolveTargetContext(
    target: { type: RelatedType; id: string | null },
    manager: EntityManager,
  ): Promise<{ type: RelatedType; id: string | null; projectDefaults?: ProjectDefaults }> {
    if (target.type === null) {
      if (target.id !== null) {
        throw new BadRequestException('related_object_id must be null when related_object_type is null');
      }
      return { type: null, id: null };
    }

    if (!target.id) {
      throw new BadRequestException('related_object_id is required when related_object_type is set');
    }

    if (target.type === 'project') {
      const [project] = await manager.query(
        'SELECT id, source_id, category_id, stream_id, company_id FROM portfolio_projects WHERE id = $1 LIMIT 1',
        [target.id],
      );
      if (!project) throw new NotFoundException('Project not found');
      return {
        type: 'project',
        id: target.id,
        projectDefaults: {
          source_id: project.source_id ?? null,
          category_id: project.category_id ?? null,
          stream_id: project.stream_id ?? null,
          company_id: project.company_id ?? null,
        },
      };
    }

    // `where`: a `spend_item` task names an OPEX line, a `capex_item` task a CAPEX line, both in
    // `spend_items` (`spend/budget-nature.ts`), never a line of the other nature. `lock`: the line is
    // read FOR SHARE, so a change of its type (lot M, which holds it FOR NO KEY UPDATE and moves its
    // tasks to the other type) is waited for: the task is then refused for a line of the other
    // nature (404) instead of being written with a type nobody reads. Only a task created on the
    // line or moved to it comes here: a task that keeps its object writes no relation.
    const tableByType: Record<'spend_item' | 'contract' | 'capex_item' | 'incident', { table: string; label: string; where?: string; lock?: string }> = {
      spend_item: { table: 'spend_items', label: 'Spend item', where: ` AND nature = 'opex'`, lock: ' FOR SHARE' },
      contract: { table: 'contracts', label: 'Contract' },
      capex_item: { table: 'spend_items', label: 'CAPEX item', where: ` AND nature = 'capex'`, lock: ' FOR SHARE' },
      incident: { table: 'incidents', label: 'Incident' },
    };
    const targetMeta = tableByType[target.type];
    const [row] = await manager.query(`SELECT id FROM ${targetMeta.table} WHERE id = $1${targetMeta.where ?? ''} LIMIT 1${targetMeta.lock ?? ''}`, [target.id]);
    if (!row) throw new NotFoundException(`${targetMeta.label} not found`);
    return { type: target.type, id: target.id };
  }

  listForTarget(
    target: { type: RelatedType; id: string | null },
    opts?: { manager?: EntityManager; tenantId?: string | null; viewer?: IncidentViewer | null },
  ) {
    const repo = (opts?.manager ?? this.repo.manager).getRepository(Task);
    // RLS already scopes the manager; the explicit tenant predicate is the
    // project-wide rule for every query (callers pass it when they have it).
    const qb = repo.createQueryBuilder('t');
    if (opts?.tenantId) qb.andWhere('t.tenant_id = :tenantId', { tenantId: opts.tenantId });
    if (target.type === null) {
      // List standalone tasks (IsNull: a plain null would match every task).
      qb.andWhere('t.related_object_type IS NULL');
    } else {
      qb.andWhere('t.related_object_type = :relatedType', { relatedType: target.type })
        .andWhere('t.related_object_id = :relatedId', { relatedId: target.id });
    }
    // Only an incident's own task list can hold a task of that incident: another
    // target (contract, project, budget line) never needs the predicate.
    if (target.type === 'incident') {
      const incidentVisibility = taskIncidentVisibilityQueryBuilderClause('t', opts?.viewer);
      if (incidentVisibility.clause) {
        qb.andWhere(incidentVisibility.clause, incidentVisibility.params);
      }
    }
    return qb.orderBy('t.created_at', 'DESC').getMany();
  }

  async createForTarget(target: { type: RelatedType; id: string | null; payload: TaskRelationPayload }, userId?: string, opts?: TaskMutationOptions) {
    const manager = opts?.manager ?? this.repo.manager;
    const repo = manager.getRepository(Task);
    const { payload } = target;
    const payloadRecord = payload as Record<string, unknown>;
    const hasApplicationIds = this.hasPayloadKey(payloadRecord, 'application_ids');
    const hasAssetIds = this.hasPayloadKey(payloadRecord, 'asset_ids');
    const applicationIds = hasApplicationIds ? this.normalizeLinkIds(payloadRecord.application_ids, 'application_ids') : [];
    const assetIds = hasAssetIds ? this.normalizeLinkIds(payloadRecord.asset_ids, 'asset_ids') : [];
    if (!payload?.title || !payload.title.toString().trim()) throw new BadRequestException('title required');
    // A task of a budget line: the line of the type's nature, read FOR SHARE until the task is saved,
    // so a change of the line's type (lot M) never leaves it with the type of before (see
    // `resolveTargetContext`). A task names only a line the person may modify (the placement
    // trigger of the tasks): a plain read first, so a read-only line answers the clear 403 and a
    // hidden one 404, as the lock alone would answer both.
    if (target.type === 'spend_item' || target.type === 'capex_item') {
      await assertLinesEditable(manager, [target.id]);
      await this.resolveTargetContext(target, manager);
    }
    // A task of a contract: the contract must be modifiable (the task's INSERT policy asks it);
    // a hidden contract is 404 as a missing one, a read-only one the clear 403.
    if (target.type === 'contract') {
      await assertContractsEditable(manager, [target.id]);
      await this.resolveTargetContext(target, manager);
    }

    const isStandalone = target.type === null;

    // Validate phase belongs to project for project tasks
    if (target.type === 'project' && target.id && payload.phase_id) {
      const phaseRepo = manager.getRepository(PortfolioProjectPhase);
      const phase = await phaseRepo.findOne({ where: { id: payload.phase_id, project_id: target.id } });
      if (!phase) throw new BadRequestException('Phase does not belong to specified project');
    }

    // Validate classification fields - only allowed for standalone and project tasks
    const canEditClassification = isStandalone || target.type === 'project';
    if (!canEditClassification) {
      if (payload.source_id !== undefined || payload.company_id !== undefined ||
          payload.category_id !== undefined || payload.stream_id !== undefined) {
        throw new BadRequestException('Classification fields can only be set on standalone or project tasks');
      }
    }

    // Default classification from project if not explicitly provided
    let defaults = { source_id: null as any, category_id: null as any, stream_id: null as any, company_id: null as any };
    if (target.type === 'project' && target.id) {
      const [project] = await manager.query(
        'SELECT source_id, category_id, stream_id, company_id FROM portfolio_projects WHERE id = $1',
        [target.id],
      );
      if (project) defaults = project;
    }

    // Build entity with new fields
    const entity = repo.create({
      related_object_type: target.type,
      related_object_id: target.id,
      title: payload.title,
      description: await normalizeMarkdownRichText(payload.description, { fieldName: 'description' }) as any,
      status: ((payload.status as any) ?? 'open') as any,
      due_date: (payload.due_date ?? null) as any,
      assignee_user_id: (payload.assignee_user_id ?? null) as any,
      // Task type
      task_type_id: (payload.task_type_id ?? null) as any,
      // Fields for project tasks
      phase_id: (payload.phase_id ?? null) as any,
      priority_level: (payload.priority_level ?? 'normal') as TaskPriorityLevel,
      start_date: (payload.start_date ?? null) as any,
      labels: payload.labels ?? [],
      // Classification fields (populated for standalone and project tasks)
      source_id: canEditClassification ? (payload.source_id !== undefined ? payload.source_id : defaults.source_id) as any : null,
      category_id: canEditClassification ? (payload.category_id !== undefined ? payload.category_id : defaults.category_id) as any : null,
      stream_id: canEditClassification ? (payload.stream_id !== undefined ? payload.stream_id : defaults.stream_id) as any : null,
      company_id: canEditClassification ? (payload.company_id !== undefined ? payload.company_id : defaults.company_id) as any : null,
      creator_id: (payload.creator_id ?? userId ?? null) as any,
      owner_ids: payload.owner_ids ?? [],
      viewer_ids: payload.viewer_ids ?? [],
    });
    if (opts?.tenantId) {
      entity.item_number = await this.itemNumberService.nextItemNumber('task', opts.tenantId, manager);
    }
    const saved = await repo.save(entity);
    await this.audit.log({
      table: 'tasks',
      recordId: saved.id,
      action: 'create',
      before: null,
      after: saved,
      userId,
      source: opts?.audit?.source,
      sourceRef: opts?.audit?.sourceRef ?? null,
    }, { manager });

    if (target.type === 'project' && target.id) {
      if (!opts?.tenantId) throw new BadRequestException('tenantId is required for project task activity logging');
      if (!userId) throw new BadRequestException('userId is required for project task activity logging');
      await manager.getRepository(PortfolioActivity).save({
        project_id: target.id,
        tenant_id: opts.tenantId,
        author_id: userId,
        type: 'change',
        changed_fields: { task_created: [null, saved.title] },
      });
    }

    await this.queueTaskAssignmentNotification(saved, null, userId, opts?.tenantId, manager);

    if (hasApplicationIds) {
      await this.setApplicationLinks(saved.id, applicationIds, { manager, tenantId: opts?.tenantId, userId, audit: opts?.audit });
    }
    if (hasAssetIds) {
      await this.setAssetLinks(saved.id, assetIds, { manager, tenantId: opts?.tenantId, userId, audit: opts?.audit });
    }

    return saved;
  }

  async updateForTarget(target: { type: RelatedType; id: string | null; payload: TaskRelationPayload & { id: string } }, userId?: string, opts?: TaskMutationOptions) {
    const manager = opts?.manager ?? this.repo.manager;
    const tenantId = opts?.tenantId;
    const repo = manager.getRepository(Task);
    const { payload } = target;
    const payloadRecord = payload as Record<string, unknown>;
    const hasApplicationIds = this.hasPayloadKey(payloadRecord, 'application_ids');
    const hasAssetIds = this.hasPayloadKey(payloadRecord, 'asset_ids');
    const applicationIds = hasApplicationIds ? this.normalizeLinkIds(payloadRecord.application_ids, 'application_ids') : [];
    const assetIds = hasAssetIds ? this.normalizeLinkIds(payloadRecord.asset_ids, 'asset_ids') : [];
    delete (payload as any).application_ids;
    delete (payload as any).asset_ids;
    if (!payload?.id) throw new BadRequestException('id is required');
    const existing = await repo.findOne({ where: { id: payload.id } });
    if (!existing) throw new NotFoundException('Task not found');

    const normalizedDescription = this.hasOwn(payload, 'description')
      ? await normalizeMarkdownRichText(payload.description, { fieldName: 'description' })
      : undefined;

    // Capture "before" state for notification comparison
    const before = { ...existing };

    const isStandalone = existing.related_object_type === null;

    // Validate task belongs to target (skip for standalone tasks)
    if (!isStandalone) {
      if (existing.related_object_type !== target.type || existing.related_object_id !== target.id) {
        throw new BadRequestException('Task does not belong to target');
      }
    }

    // Strip classification fields for non-standalone, non-project tasks (defense in depth)
    const canEditClassification = isStandalone || existing.related_object_type === 'project';
    if (!canEditClassification) {
      delete payload.source_id;
      delete payload.company_id;
      delete payload.category_id;
      delete payload.stream_id;
    }

    // Validate phase belongs to project for project tasks
    if (target.type === 'project' && target.id && payload.phase_id !== undefined && payload.phase_id !== null) {
      const phaseRepo = manager.getRepository(PortfolioProjectPhase);
      const phase = await phaseRepo.findOne({ where: { id: payload.phase_id, project_id: target.id } });
      if (!phase) throw new BadRequestException('Phase does not belong to specified project');
    }

    // Validate: Cannot mark task as "done" without time logged (only for project tasks)
    if (target.type === 'project' && payload.status === 'done' && existing.status !== 'done') {
      const hasTime = await this.hasTimeLogged(payload.id, manager);
      if (!hasTime) {
        throw new BadRequestException('Cannot mark task as done without logging time');
      }
    }

    // The fields the body sends, and those only (`task-column-write.ts`): the task read above may be
    // older than its relation, which this route never changes (a move goes through `updateById`).
    const { id: _id, related_object_type: _type, related_object_id: _relatedId, ...fields } = payload as Record<string, unknown>;
    void _id; void _type; void _relatedId;
    if (this.hasOwn(payload, 'description')) fields.description = normalizedDescription;
    // Data-scoped access (`task-data-access.ts`): a read-only task refused, a handover keeps the person as observer.
    const write = await prepareTaskWrite(manager, existing, fields);
    const saved = await writeTaskColumns(repo, existing, write.changes);
    await this.audit.log({
      table: 'tasks',
      recordId: saved.id,
      action: 'update',
      before: existing,
      after: saved,
      userId,
      source: opts?.audit?.source,
      sourceRef: opts?.audit?.sourceRef ?? null,
    }, { manager });

    if (this.hasOwn(payload, 'description') && before.description !== saved.description) {
      await this.taskAttachmentsSvc.cleanupOrphanedImages(saved.id, 'description', before.description, saved.description, {
        manager,
      });
    }

    const changes = detectChanges(before as unknown as Record<string, unknown>, saved as unknown as Record<string, unknown>, TASK_TRACKED_FIELDS);
    if (changes.length > 0) {
      if (!tenantId) throw new BadRequestException('tenantId is required for task change activity logging');
      if (!userId) throw new BadRequestException('userId is required for task change activity logging');
      const changedFields = await resolveDisplayNames(changes, TASK_TRACKED_FIELDS, manager);
      await this.taskActivitiesSvc.logChange(saved.id, changedFields, tenantId, userId, { manager });
    }

    // Fire-and-forget notifications
    if (tenantId) {
      await this.queueTaskAssignmentNotification(saved, before.assignee_user_id, userId, tenantId, manager);

      // Notify on status change
      if (before.status !== saved.status) {
        const recipients = await this.notifications.getTaskRecipients(saved.id, manager);
        this.notifyStatusChangeSafely({
          itemType: 'task',
          itemId: saved.id,
          itemName: saved.title,
          oldStatus: before.status,
          newStatus: saved.status,
          recipients,
          tenantId,
          excludeUserId: userId,
          manager,
        });
      }
    }

    if (hasApplicationIds) {
      await this.setApplicationLinks(saved.id, applicationIds, { manager, tenantId, userId, audit: opts?.audit });
    }
    if (hasAssetIds) {
      await this.setAssetLinks(saved.id, assetIds, { manager, tenantId, userId, audit: opts?.audit });
    }

    return write.stillFollowing ? Object.assign(saved, { stillFollowing: true as const }) : saved;
  }

  /**
   * Update a task directly by ID (for standalone tasks or general updates)
   */
  async updateById(taskId: string, payload: TaskRelationPayload, userId?: string, opts?: TaskMutationOptions) {
    const manager = opts?.manager ?? this.repo.manager;
    const tenantId = opts?.tenantId;
    const repo = manager.getRepository(Task);
    const payloadRecord = payload as Record<string, unknown>;
    const hasApplicationIds = this.hasPayloadKey(payloadRecord, 'application_ids');
    const hasAssetIds = this.hasPayloadKey(payloadRecord, 'asset_ids');
    const applicationIds = hasApplicationIds ? this.normalizeLinkIds(payloadRecord.application_ids, 'application_ids') : [];
    const assetIds = hasAssetIds ? this.normalizeLinkIds(payloadRecord.asset_ids, 'asset_ids') : [];
    delete (payload as any).application_ids;
    delete (payload as any).asset_ids;

    const existing = await repo.findOne({ where: { id: taskId } });
    if (!existing) throw new NotFoundException('Task not found');

    // Capture "before" state for notification comparison
    const before = { ...existing };

    const nextPayload = { ...payload } as Partial<Task>;
    const hasRelatedType = this.hasOwn(nextPayload, 'related_object_type');
    const hasRelatedId = this.hasOwn(nextPayload, 'related_object_id');
    if (hasRelatedType !== hasRelatedId) {
      throw new BadRequestException('related_object_type and related_object_id must be provided together');
    }

    const requestedTarget = hasRelatedType
      ? {
          type: (nextPayload.related_object_type ?? null) as RelatedType,
          id: (nextPayload.related_object_id ?? null) as string | null,
        }
      : { type: existing.related_object_type as RelatedType, id: existing.related_object_id };
    const relationChanged =
      requestedTarget.type !== existing.related_object_type ||
      requestedTarget.id !== existing.related_object_id;

    let resolvedTarget: { type: RelatedType; id: string | null; projectDefaults?: ProjectDefaults };
    if (relationChanged) {
      // A new object that is a line: one the person may modify (placement trigger of the tasks),
      // read plainly before the lock (`resolveTargetContext`): read only 403, hidden 404.
      if (requestedTarget.type === 'spend_item' || requestedTarget.type === 'capex_item') {
        await assertLinesEditable(manager, [requestedTarget.id]);
      }
      resolvedTarget = await this.resolveTargetContext(requestedTarget, manager);
    } else {
      // The task keeps its object: no relation is written (`task-column-write.ts`), so nothing to
      // look up or lock. Its assignee or owner may not read it, or only read it, and still updates
      // or hands over the task (`prepareTaskWrite`, spec §6.8).
      resolvedTarget = requestedTarget;
    }

    if (this.hasOwn(nextPayload, 'description')) {
      nextPayload.description = await normalizeMarkdownRichText(nextPayload.description, { fieldName: 'description' }) as any;
    }

    delete nextPayload.related_object_type;
    delete nextPayload.related_object_id;

    // Strip classification fields for non-standalone, non-project tasks (defense in depth)
    const canEditClassification = resolvedTarget.type === null || resolvedTarget.type === 'project';
    if (!canEditClassification) {
      delete nextPayload.source_id;
      delete nextPayload.company_id;
      delete nextPayload.category_id;
      delete nextPayload.stream_id;
    }

    if (relationChanged) {
      if (existing.related_object_type === 'project' && resolvedTarget.type !== 'project') {
        nextPayload.phase_id = null;
      }

      if (resolvedTarget.type === null) {
        nextPayload.phase_id = null;
      }

      if (this.isNonProjectLinked(resolvedTarget.type)) {
        nextPayload.phase_id = null;
        nextPayload.source_id = null;
        nextPayload.category_id = null;
        nextPayload.stream_id = null;
        nextPayload.company_id = null;
      }

      if (resolvedTarget.type === 'project' && resolvedTarget.id) {
        const defaults = resolvedTarget.projectDefaults ?? {
          source_id: null,
          category_id: null,
          stream_id: null,
          company_id: null,
        };
        const isDifferentProject = existing.related_object_type !== 'project' || existing.related_object_id !== resolvedTarget.id;
        if (isDifferentProject && nextPayload.phase_id === undefined) {
          nextPayload.phase_id = null;
        }

        const classificationKeys: Array<'source_id' | 'category_id' | 'stream_id' | 'company_id'> = [
          'source_id', 'category_id', 'stream_id', 'company_id',
        ];
        for (const key of classificationKeys) {
          if ((nextPayload as any)[key] !== undefined) continue;
          const currentValue = (existing as any)[key];
          if (currentValue !== null && currentValue !== undefined) continue;
          const defaultValue = (defaults as any)[key];
          if (defaultValue !== null && defaultValue !== undefined) {
            (nextPayload as any)[key] = defaultValue;
          }
        }
      }
    }

    // Validate phase if updating project task
    if (resolvedTarget.type === 'project' && resolvedTarget.id && nextPayload.phase_id !== undefined && nextPayload.phase_id !== null) {
      const phaseRepo = manager.getRepository(PortfolioProjectPhase);
      const phase = await phaseRepo.findOne({ where: { id: nextPayload.phase_id, project_id: resolvedTarget.id } });
      if (!phase) throw new BadRequestException('Phase does not belong to specified project');
    }

    // Validate: Cannot mark task as "done" without time logged (only for project tasks)
    if (resolvedTarget.type === 'project' && nextPayload.status === 'done' && existing.status !== 'done') {
      const hasTime = await this.hasTimeLogged(taskId, manager);
      if (!hasTime) {
        throw new BadRequestException('Cannot mark task as done without logging time');
      }
    }

    // The fields the body changes, and the relation only when it moves, checked above under the
    // target's lock (`task-column-write.ts`): never the rest of the task read above.
    // Data-scoped access (`task-data-access.ts`): a read-only task refused, a handover keeps the person as observer.
    const write = await prepareTaskWrite(manager, existing, {
      ...nextPayload,
      ...(relationChanged ? { related_object_type: resolvedTarget.type, related_object_id: resolvedTarget.id } : {}),
    } as Record<string, unknown>);
    const saved = await writeTaskColumns(repo, existing, write.changes);
    await this.audit.log({
      table: 'tasks',
      recordId: saved.id,
      action: 'update',
      before: existing,
      after: saved,
      userId,
      source: opts?.audit?.source,
      sourceRef: opts?.audit?.sourceRef ?? null,
    }, { manager });

    const changes = detectChanges(before as unknown as Record<string, unknown>, saved as unknown as Record<string, unknown>, TASK_TRACKED_FIELDS);
    if (relationChanged) {
      const oldRelated = await this.resolveRelatedObjectName(before.related_object_type as RelatedType, before.related_object_id, manager);
      const newRelated = await this.resolveRelatedObjectName(saved.related_object_type as RelatedType, saved.related_object_id, manager);
      if (oldRelated !== newRelated) {
        changes.push({ field: 'related_to', before: oldRelated, after: newRelated });
      }
    }
    if (changes.length > 0) {
      if (!tenantId) throw new BadRequestException('tenantId is required for task change activity logging');
      if (!userId) throw new BadRequestException('userId is required for task change activity logging');
      const taskChangeFields: FieldConfig[] = [...TASK_TRACKED_FIELDS, { field: 'related_to' }];
      const changedFields = await resolveDisplayNames(changes, taskChangeFields, manager);
      await this.taskActivitiesSvc.logChange(saved.id, changedFields, tenantId, userId, { manager });
    }

    if (relationChanged) {
      await this.userTimeAggregateService.recalculateForTask(saved.id, manager);
      const projectIds = new Set<string>();
      const previousProjectId = this.getRelatedProjectId(before);
      const nextProjectId = this.getRelatedProjectId(saved);
      if (previousProjectId) projectIds.add(previousProjectId);
      if (nextProjectId) projectIds.add(nextProjectId);
      for (const projectId of projectIds) {
        await this.portfolioProjectsService.recalculateActualEffort(projectId, manager);
      }
    }

    // Fire-and-forget notifications
    if (tenantId) {
      await this.queueTaskAssignmentNotification(saved, before.assignee_user_id, userId, tenantId, manager);

      // Notify on status change
      if (before.status !== saved.status) {
        const recipients = await this.notifications.getTaskRecipients(saved.id, manager);
        this.notifyStatusChangeSafely({
          itemType: 'task',
          itemId: saved.id,
          itemName: saved.title,
          oldStatus: before.status,
          newStatus: saved.status,
          recipients,
          tenantId,
          excludeUserId: userId,
          manager,
        });
      }
    }

    if (hasApplicationIds) {
      await this.setApplicationLinks(saved.id, applicationIds, { manager, tenantId, userId, audit: opts?.audit });
    }
    if (hasAssetIds) {
      await this.setAssetLinks(saved.id, assetIds, { manager, tenantId, userId, audit: opts?.audit });
    }

    return write.stillFollowing ? Object.assign(saved, { stillFollowing: true as const }) : saved;
  }

  async moveTask(
    params: { id: string; next: { type: RelatedType; id: string | null } },
    userId?: string | null,
    opts?: { manager?: EntityManager; tenantId?: string },
  ) {
    return this.updateById(
      params.id,
      {
        related_object_type: params.next.type as any,
        related_object_id: params.next.id,
      } as Partial<Task>,
      userId ?? undefined,
      { manager: opts?.manager ?? this.repo.manager, tenantId: opts?.tenantId },
    );
  }

  async share(taskId: string, dto: ShareItemDto, tenantId: string, userId: string, opts?: { manager?: EntityManager }) {
    const { userIds, rawEmails } = shareRecipientsOf(dto);

    const manager = opts?.manager ?? this.repo.manager;

    const task = await manager.findOne(Task, { where: { id: taskId }, select: ['id', 'title'] });
    if (!task) throw new NotFoundException('Task not found');

    const senderRows = await manager.query(
      'SELECT first_name, last_name FROM users WHERE id = $1',
      [userId],
    );
    const senderName = displayName(senderRows[0], 'Someone');

    const recipientRows = userIds.length > 0
      ? await manager.query(
          `SELECT u.id AS "userId", u.email, u.first_name AS "firstName", u.last_name AS "lastName", u.locale
           FROM users u
           JOIN roles ro ON ro.id = u.role_id
           WHERE u.id = ANY($1) AND u.status = 'enabled'
             AND (ro.is_system = false OR LOWER(ro.role_name) = 'administrator')`,
          [userIds],
        )
      : [];

    if (recipientRows.length > 0 || rawEmails.length > 0) {
      this.notifications.notifyShare({
        itemType: 'task',
        itemId: taskId,
        itemName: task.title,
        senderName,
        message: dto.message,
        recipients: recipientRows,
        rawEmails,
        tenantId,
      });
    }

    // The chosen persons who cannot open the task: the screen warns the sender (spec §5.6). No list
    // when the task's line is hidden to the sender.
    const cannotOpen = await shareRecipientsWhoCannotOpen(manager, 'task', taskId, recipientRows);
    return cannotOpen ? { success: true, cannot_open: cannotOpen } : { success: true };
  }
}
