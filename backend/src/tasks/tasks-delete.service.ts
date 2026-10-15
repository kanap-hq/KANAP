import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Task } from './task.entity';
import { AuditService } from '../audit/audit.service';
import { BaseDeleteService } from '../common/base-delete.service';
import { BulkDeleteResult, DeleteOptions } from '../common/delete.types';
import { withSavepoint } from '../common/savepoint.util';
import { UserTimeAggregateService } from '../portfolio/services/user-time-aggregate.service';
import { deleteTaskActivities } from './task-delete-cleanup';
import { checkIds, RecordInUseException, refusalDetails, refusalsFrom, type DeleteRefusal } from '../common/record-in-use';

/**
 * The refusal of each task's delete that is the origin of a request (`TASK_REQUEST_ORIGIN`, the
 * request's reference in `params`), in the order of `tasks`; null for the others.
 */
async function originRefusals(
  manager: EntityManager,
  tasks: ReadonlyArray<{ id: string; title: string | null }>,
): Promise<Array<RecordInUseException | null>> {
  if (tasks.length === 0) return [];
  const rows: Array<{ task_id: string; id: string; item_number: number | null }> = await manager.query(
    `SELECT DISTINCT ON (origin_task_id) origin_task_id::text AS task_id, id::text AS id, item_number
       FROM portfolio_requests
      WHERE tenant_id = app_current_tenant() AND origin_task_id = ANY($1::uuid[])
      ORDER BY origin_task_id, item_number NULLS LAST, id`,
    [tasks.map((task) => task.id)],
  );
  const byTask = new Map(rows.map((row) => [row.task_id, row]));
  return tasks.map((task) => {
    const request = byTask.get(task.id);
    if (!request) return null;
    const reference = request.item_number ? `REQ-${request.item_number}` : request.id;
    return new RecordInUseException('TASK_REQUEST_ORIGIN', 'task', task.title ?? '', [],
      `Cannot delete task because it is the origin of request ${reference}`, { reference });
  });
}

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

    const refusal = (await originRefusals(manager, [existing]))[0] ?? null;
    if (refusal) throw refusal;

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

  /** The check before a delete (`POST /tasks/delete-check`): the tasks of `ids` a request started from, which it would refuse. Nothing is written. */
  async deleteCheck(ids: unknown[], opts?: { manager?: EntityManager }): Promise<{ refused: DeleteRefusal[] }> {
    const manager = opts?.manager ?? this.repository.manager;
    const wanted = checkIds(ids);
    if (wanted.length === 0) return { refused: [] };
    const rows: Array<{ id: string; title: string }> = await manager.query(
      `SELECT id::text AS id, title FROM tasks WHERE tenant_id = app_current_tenant() AND id = ANY($1::uuid[])`,
      [wanted],
    );
    const refusals = await originRefusals(manager, rows);
    const byId = new Map(rows.map((row, index) => [row.id, refusals[index]]));
    return refusalsFrom(wanted, rows, (row) => row.title, async (row) => byId.get(row.id) ?? null);
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
          result.failed.push({ id, name: 'Unknown', reason: 'Not found', code: 'not_found' });
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
        result.failed.push({ id, name, reason: e?.message || 'Unknown error', ...refusalDetails(e) });
      }
    }
    return result;
  }
}
