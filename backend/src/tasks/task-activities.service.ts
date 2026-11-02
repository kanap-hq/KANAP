import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { codedForbidden } from '../auth/module-right-required';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager } from 'typeorm';
import { PortfolioActivity, ActivityType } from '../portfolio/portfolio-activity.entity';
import { Task, TaskStatus, TASK_STATUSES } from './task.entity';
import { NotificationsService } from '../notifications/notifications.service';
import { TaskTimeEntriesService } from './task-time-entries.service';
import { AuditService } from '../audit/audit.service';
import { displayName } from '../common/display-name';
import { normalizeMarkdownRichText } from '../common/markdown-worker';
import { writeTaskColumns } from './task-column-write';

export interface TaskActivityItem {
  id: string;
  type: ActivityType;
  content: string | null;
  context: string | null;
  author_id: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  decision_outcome: string | null;
  changed_fields: Record<string, [unknown, unknown]> | null;
  created_at: Date;
  updated_at: Date | null;
}

export interface CreateTaskActivityDto {
  type: 'comment' | 'change';
  content?: string;
  context?: string;
  changed_fields?: Record<string, [unknown, unknown]>;
}

export interface CreateUnifiedActivityDto {
  type: 'unified';
  content?: string;
  status?: TaskStatus;
  time_hours?: number;
  time_category?: 'it' | 'business';
}

export interface CreateImportedTaskCommentDto {
  content: string;
  context?: string | null;
  created_at?: Date | string | null;
}

export type ActivityBodyDto = CreateTaskActivityDto | CreateUnifiedActivityDto;

type TaskActivityAuditOptions = {
  source?: string;
  sourceRef?: string | null;
};

type TaskActivityMutationOptions = {
  manager?: EntityManager;
  isAdmin?: boolean;
  audit?: TaskActivityAuditOptions;
};

function parseImportedCreatedAt(value: Date | string | null | undefined): Date | undefined {
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    return value;
  }
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value.trim().replace(' ', 'T'));
    if (Number.isFinite(parsed.getTime())) {
      return parsed;
    }
  }
  return undefined;
}

@Injectable()
export class TaskActivitiesService {
  private readonly logger = new Logger(TaskActivitiesService.name);

  constructor(
    @InjectRepository(PortfolioActivity)
    private readonly activityRepo: Repository<PortfolioActivity>,
    @InjectRepository(Task)
    private readonly taskRepo: Repository<Task>,
    private readonly notifications: NotificationsService,
    private readonly timeEntriesSvc: TaskTimeEntriesService,
    private readonly audit: AuditService,
  ) {}

  private notifyCommentSafely(params: Parameters<NotificationsService['notifyComment']>[0]): void {
    void this.notifications.notifyComment(params).catch((error) => {
      this.logger.error(`Failed to notify task comment for task ${params.itemId}: ${error}`);
    });
  }

  private notifyUnifiedActionSafely(params: Parameters<NotificationsService['notifyUnifiedAction']>[0]): void {
    void this.notifications.notifyUnifiedAction(params).catch((error) => {
      this.logger.error(`Failed to notify unified task activity for task ${params.taskId}: ${error}`);
    });
  }

  private async logActivityAuditIfNeeded(
    activity: PortfolioActivity,
    userId: string | null,
    opts: TaskActivityMutationOptions | undefined,
    manager: EntityManager,
  ): Promise<void> {
    if (!opts?.audit) {
      return;
    }

    await this.audit.log({
      table: 'portfolio_activities',
      recordId: activity.id,
      action: 'create',
      before: null,
      after: activity,
      userId,
      source: opts.audit.source,
      sourceRef: opts.audit.sourceRef ?? null,
    }, { manager });
  }

  /**
   * List activities for a task
   */
  async listForTask(
    taskId: string,
    opts?: { manager?: EntityManager },
  ): Promise<TaskActivityItem[]> {
    const mg = opts?.manager ?? this.activityRepo.manager;

    // The history of a task the person can read only (spec §5.6): the task first, under the
    // person's access (the tasks policy hides a task of a line or contract out of access), the same
    // 404 for a hidden task and an unknown id. `portfolio_activities` itself carries no policy.
    const visible = await mg.query(`SELECT 1 FROM tasks WHERE id = $1 AND tenant_id = app_current_tenant()`, [taskId]);
    if (visible.length === 0) throw new NotFoundException('Task not found');

    const rows = await mg.query<Array<{
      id: string;
      type: ActivityType;
      content: string | null;
      context: string | null;
      author_id: string | null;
      first_name: string | null;
      last_name: string | null;
      email: string | null;
      decision_outcome: string | null;
      changed_fields: Record<string, [unknown, unknown]> | null;
      created_at: Date;
      updated_at: Date | null;
    }>>(
      `SELECT
        a.id,
        a.type,
        a.content,
        a.context,
        a.author_id,
        u.first_name,
        u.last_name,
        u.email,
        a.decision_outcome,
        a.changed_fields,
        a.created_at,
        a.updated_at
      FROM portfolio_activities a
      LEFT JOIN users u ON a.author_id = u.id
      WHERE a.task_id = $1
        AND a.tenant_id = app_current_tenant()
      ORDER BY a.created_at DESC`,
      [taskId],
    );

    return rows;
  }

  /**
   * Create a comment or change activity for a task
   */
  async create(
    taskId: string,
    dto: CreateTaskActivityDto,
    tenantId: string,
    userId: string | null,
    opts?: TaskActivityMutationOptions,
  ): Promise<PortfolioActivity> {
    const mg = opts?.manager ?? this.activityRepo.manager;

    // Verify task exists
    const task = await mg.getRepository(Task).findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const repo = mg.getRepository(PortfolioActivity);
    const normalizedContent = await normalizeMarkdownRichText(dto.content, { fieldName: 'content' });
    const activity = repo.create({
      task_id: taskId,
      tenant_id: tenantId,
      author_id: userId,
      type: dto.type || 'comment',
      content: normalizedContent,
      context: dto.context?.trim() || null,
      changed_fields: dto.changed_fields || null,
    });

    const saved = await repo.save(activity);
    await this.logActivityAuditIfNeeded(saved, userId, opts, mg);

    // Fire-and-forget notification for comments
    if (dto.type === 'comment' && normalizedContent && userId) {
      const author = await mg.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
      const authorName = displayName(author[0], 'Someone');
      const recipients = await this.notifications.getTaskRecipients(taskId, mg);
      this.notifyCommentSafely({
        itemType: 'task',
        itemId: taskId,
        itemName: task.title,
        authorId: userId,
        authorName,
        commentContent: normalizedContent,
        recipients: recipients.map(r => ({ userId: r.userId, email: r.email, locale: r.locale })),
        tenantId,
        manager: mg,
      });
    }

    return saved;
  }

  /**
   * Create an externally imported comment without notifying task recipients.
   */
  async createImportedComment(
    taskId: string,
    dto: CreateImportedTaskCommentDto,
    tenantId: string,
    userId: string | null,
    opts?: TaskActivityMutationOptions,
  ): Promise<PortfolioActivity> {
    const mg = opts?.manager ?? this.activityRepo.manager;

    const task = await mg.getRepository(Task).findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    const repo = mg.getRepository(PortfolioActivity);
    const normalizedContent = await normalizeMarkdownRichText(dto.content, { fieldName: 'content' });
    const createdAt = parseImportedCreatedAt(dto.created_at);
    const activity = repo.create({
      task_id: taskId,
      tenant_id: tenantId,
      author_id: null,
      type: 'comment',
      content: normalizedContent,
      context: dto.context?.trim() || null,
      changed_fields: null,
      ...(createdAt ? { created_at: createdAt } : {}),
    });

    const saved = await repo.save(activity);
    await this.logActivityAuditIfNeeded(saved, userId, opts, mg);
    return saved;
  }

  /**
   * Create a unified activity action (comment + status + time entry)
   */
  async createUnified(
    taskId: string,
    dto: CreateUnifiedActivityDto,
    tenantId: string,
    userId: string | null,
    opts?: TaskActivityMutationOptions,
  ): Promise<PortfolioActivity> {
    const mg = opts?.manager ?? this.activityRepo.manager;
    const taskRepo = mg.getRepository(Task);
    const activityRepo = mg.getRepository(PortfolioActivity);

    const task = await taskRepo.findOne({ where: { id: taskId } });
    if (!task) {
      throw new NotFoundException('Task not found');
    }

    if (dto.status !== undefined && !TASK_STATUSES.includes(dto.status)) {
      throw new BadRequestException(`Invalid status. Allowed values: ${TASK_STATUSES.join(', ')}`);
    }

    const normalizedContent = await normalizeMarkdownRichText(dto.content, { fieldName: 'content' }) ?? '';
    const hasComment = normalizedContent.length > 0;

    const normalizedHours = dto.time_hours == null ? 0 : Number(dto.time_hours);
    if (!Number.isInteger(normalizedHours) || normalizedHours < 0 || normalizedHours > 8) {
      throw new BadRequestException('time_hours must be an integer between 0 and 8');
    }
    if (dto.time_category !== undefined && dto.time_category !== 'it' && dto.time_category !== 'business') {
      throw new BadRequestException('time_category must be "it" or "business"');
    }
    const hasTimeEntry = normalizedHours > 0;

    const hasStatusChange = dto.status !== undefined && dto.status !== task.status;
    if (!hasComment && !hasStatusChange && !hasTimeEntry) {
      throw new BadRequestException('At least one action is required (comment, status change, or time log)');
    }

    let changeActivity: PortfolioActivity | null = null;
    let commentActivity: PortfolioActivity | null = null;
    let oldStatus: string | undefined;
    let newStatus: string | undefined;

    if (hasStatusChange && dto.status) {
      if (dto.status === 'done' && task.related_object_type === 'project') {
        const existingTime = await this.timeEntriesSvc.sumForTask(task.id, { manager: mg });
        if (existingTime + normalizedHours <= 0) {
          throw new BadRequestException('Cannot mark task as done without logging time');
        }
      }

      const before = { ...task };
      oldStatus = task.status;
      // The status alone: the task read above may be older than its relation (`task-column-write.ts`).
      const savedTask = await writeTaskColumns(taskRepo, task, { status: dto.status });
      newStatus = savedTask.status;

      await this.audit.log(
        {
          table: 'tasks',
          recordId: savedTask.id,
          action: 'update',
          before,
          after: savedTask,
          userId,
        },
        { manager: mg },
      );

      changeActivity = await activityRepo.save(
        activityRepo.create({
          task_id: taskId,
          tenant_id: tenantId,
          author_id: userId,
          type: 'change',
          changed_fields: { status: [oldStatus, newStatus] },
          content: null,
          context: null,
        }),
      );
      await this.logActivityAuditIfNeeded(changeActivity, userId, opts, mg);
    }

    if (hasTimeEntry) {
      await this.timeEntriesSvc.create(
        taskId,
        {
          hours: normalizedHours,
          category: dto.time_category ?? 'it',
          logged_at: new Date(),
          user_id: userId,
        },
        userId ?? undefined,
        opts?.isAdmin === true,
        { manager: mg },
      );
    }

    if (hasComment) {
      commentActivity = await activityRepo.save(
        activityRepo.create({
          task_id: taskId,
          tenant_id: tenantId,
          author_id: userId,
          type: 'comment',
          content: normalizedContent,
          context: null,
          // A status changed with the comment rides on it, as on a project's comment
          // (`portfolio-status.service.ts`): the feed shows it beside the text. The `change` entry
          // above stays, for the dashboard tiles.
          changed_fields: hasStatusChange && oldStatus !== undefined && newStatus !== undefined
            ? { status: [oldStatus, newStatus] }
            : null,
        }),
      );
      await this.logActivityAuditIfNeeded(commentActivity, userId, opts, mg);
    }

    if (tenantId && userId && (hasStatusChange || hasComment)) {
      const recipients = await this.notifications.getTaskRecipients(taskId, mg);
      const author = await mg.query('SELECT first_name, last_name FROM users WHERE id = $1', [userId]);
      const authorName = displayName(author[0], 'Someone');

      this.notifyUnifiedActionSafely({
        taskId,
        taskTitle: task.title,
        oldStatus,
        newStatus,
        authorId: userId,
        authorName,
        commentContent: hasComment ? normalizedContent : undefined,
        recipients,
        tenantId,
        manager: mg,
      });
    }

    if (commentActivity) return commentActivity;
    if (changeActivity) return changeActivity;

    // Time-only submit: persist a standard change activity for a consistent response shape.
    const timeActivity = await activityRepo.save(
      activityRepo.create({
        task_id: taskId,
        tenant_id: tenantId,
        author_id: userId,
        type: 'change',
        changed_fields: { time_hours: [0, normalizedHours] },
        content: null,
        context: 'unified_time_log',
      }),
    );
    await this.logActivityAuditIfNeeded(timeActivity, userId, opts, mg);
    return timeActivity;
  }

  /**
   * Log a field change activity (internal use)
   */
  async logChange(
    taskId: string,
    changedFields: Record<string, [unknown, unknown]>,
    tenantId: string,
    userId: string | null,
    opts?: { manager?: EntityManager },
  ): Promise<PortfolioActivity> {
    return this.create(
      taskId,
      {
        type: 'change',
        changed_fields: changedFields,
      },
      tenantId,
      userId,
      opts,
    );
  }

  /**
   * Update a comment activity (author-only)
   */
  async updateComment(
    taskId: string,
    activityId: string,
    content: string,
    userId: string,
    opts?: { manager?: EntityManager },
  ): Promise<PortfolioActivity> {
    const mg = opts?.manager ?? this.activityRepo.manager;
    const repo = mg.getRepository(PortfolioActivity);

    // Find the activity
    const activity = await repo.findOne({ where: { id: activityId, task_id: taskId } });
    if (!activity) {
      throw new NotFoundException('Comment not found');
    }

    // Only allow editing comments, not decisions or changes
    if (activity.type !== 'comment') {
      throw new BadRequestException('Only comments can be edited');
    }

    // Only allow the author to edit
    if (activity.author_id !== userId) {
      throw codedForbidden('OWN_COMMENTS_ONLY', 'You can only edit your own comments');
    }

    activity.content = await normalizeMarkdownRichText(content, { fieldName: 'content' });
    activity.updated_at = new Date();

    return repo.save(activity);
  }
}
