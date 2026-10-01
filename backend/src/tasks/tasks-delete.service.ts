import { ConflictException, Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Task } from './task.entity';
import { AuditService } from '../audit/audit.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';
import { UserTimeAggregateService } from '../portfolio/services/user-time-aggregate.service';
import { deleteTaskActivities } from './task-delete-cleanup';

@Injectable()
export class TasksDeleteService extends BaseDeleteService<Task> {
  protected override readonly logger = new Logger(TasksDeleteService.name);

  constructor(
    @InjectRepository(Task) repository: Repository<Task>,
    audit: AuditService,
    @Inject(forwardRef(() => UserTimeAggregateService))
    private readonly userTimeAggregateService: UserTimeAggregateService,
  ) {
    super(repository, null, audit, {
      entityName: 'Task',
      auditTable: 'tasks',
      cascadeRelations: [],
    });
  }

  /**
   * Override delete to be idempotent (not throw if already deleted)
   */
  override async delete(taskId: string, opts?: DeleteOptions): Promise<void> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);
    const existing = await repo.findOne({ where: { id: taskId } as any });
    if (!existing) return; // idempotent - no error if not found

    const linkedRequests = await manager.query<Array<{ id: string; item_number: number | null }>>(
      `SELECT id, item_number
       FROM portfolio_requests
       WHERE origin_task_id = $1
       LIMIT 1`,
      [taskId],
    );
    if (linkedRequests.length > 0) {
      const requestRef = linkedRequests[0].item_number
        ? `REQ-${linkedRequests[0].item_number}`
        : linkedRequests[0].id;
      throw new ConflictException(
        `Cannot delete task because it is the origin of request ${requestRef}`,
      );
    }

    const rows = await manager.query(
      `SELECT DISTINCT user_id,\n              date_trunc('month', logged_at AT TIME ZONE 'UTC')::date AS year_month\n       FROM task_time_entries\n       WHERE task_id = $1\n         AND user_id IS NOT NULL`,
      [taskId],
    );

    await super.delete(taskId, opts);

    for (const row of rows) {
      const yearMonth = new Date(row.year_month as string);
      await this.userTimeAggregateService.recalculateUserMonth(row.user_id as string, yearMonth, manager);
    }
  }

  /** The task's history goes with it (no foreign key cascades to it). */
  protected override async beforeDelete(task: Task, manager: EntityManager): Promise<void> {
    await deleteTaskActivities(manager, task.tenant_id, [task.id]);
  }

  /**
   * Legacy method signature for backwards compatibility
   */
  async deleteTask(taskId: string, userId: string | null, opts?: { manager?: EntityManager }): Promise<void> {
    await this.delete(taskId, { manager: opts?.manager, userId });
  }

  /**
   * Bulk delete multiple tasks
   */
  async bulkDelete(taskIds: string[], userId: string | null, opts?: { manager?: EntityManager }): Promise<BulkDeleteResult> {
    const manager = opts?.manager ?? this.repository.manager;
    const repo = this.getRepo(manager);
    const result: BulkDeleteResult = { deleted: [], failed: [] };

    for (const id of taskIds) {
      try {
        const found = await withSavepoint(manager, async () => {
          const before = await repo.findOne({ where: { id } as any });
          if (!before) return false;
          await this.delete(id, { manager, userId });
          return true;
        });
        if (!found) {
          result.failed.push({ id, name: 'Unknown', reason: 'Not found' });
          continue;
        }
        result.deleted.push(id);
      } catch (e: any) {
        let name = 'Unknown';
        try {
          const t = await withSavepoint(manager, () => repo.findOne({ where: { id } as any }));
          if (t) name = t.title || t.id;
        } catch (err: any) {
          this.logger.warn(`Failed to fetch task name for error reporting: ${err?.message || 'Unknown error'}`);
        }
        result.failed.push({ id, name, reason: e?.message || 'Unknown error' });
      }
    }
    return result;
  }
}
