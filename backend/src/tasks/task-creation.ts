import { cancelCreation, readCreationChanges, type CreationContext } from '../common/creation/creation-routes';
import { withChildCount, type CreationChanges } from '../common/creation/creation-changes';
import type { TasksDeleteService } from './tasks-delete.service';

/**
 * "Cancel" of a task being created (lot V4 of the creation frame). Every create route of a task
 * (`POST /tasks/standalone`, `/portfolio/projects/:id/tasks`, `/spend-items/:id/tasks`,
 * `/capex-items/:id/tasks`, `/contracts/:id/tasks`, `/incidents/:id/tasks`) hands its creator a
 * token of the one family `tasks` (`withCreationToken('tasks', ...)`). `GET /tasks/:id/creation`
 * and `DELETE /tasks/:id/creation`, and for a project task the same pair under its project's
 * route, read and use it.
 *
 * The delete is the task delete (`TasksDeleteService.delete`): its refusals (the origin of a
 * request), its data-access check (`assertTaskDeletable`: a task of a line or a contract goes only
 * for a person who may modify that line or contract, which the creator of a task on it could), its
 * history and its audit entry. No window outside the limited role is needed: the DELETE policy of
 * `tasks` lets a limited person delete a task whose line or contract they may modify.
 */

/**
 * Before "Cancel": what was written on the task since its creation (its history's audit rows: its
 * fields, description included, its applications and assets), with its attachments and time
 * entries as they stand, and its comments and decisions (`portfolio_activities`, which is no
 * audit). Nothing is written.
 */
export function readTaskCreationChanges(taskId: string, token: unknown, ctx: CreationContext): Promise<{ changes: CreationChanges }> {
  return readCreationChanges('tasks', taskId, token, ctx, {
    extra: async (changes, manager) => {
      const [counts]: Array<{ attachments: number; time_entries: number; comments: number }> = await manager.query(
        `SELECT (SELECT count(*)::int FROM task_attachments WHERE tenant_id = $1 AND task_id = $2) AS attachments,
                (SELECT count(*)::int FROM task_time_entries WHERE tenant_id = $1 AND task_id = $2) AS time_entries,
                (SELECT count(*)::int FROM portfolio_activities WHERE tenant_id = $1 AND task_id = $2 AND type IN ('comment', 'decision')) AS comments`,
        [ctx.tenantId, taskId],
      );
      changes = withChildCount(changes, 'attachment', counts.attachments);
      changes = withChildCount(changes, 'time_entry', counts.time_entries);
      return withChildCount(changes, 'comment', counts.comments);
    },
  });
}

/**
 * "Cancel": the creator deletes the task they just created, with its token, while nobody else has
 * written on it (403 `CREATION_CANCEL_EXPIRED` otherwise, read under the task's lock), through the
 * task delete.
 */
export function cancelTaskCreation(
  deleter: Pick<TasksDeleteService, 'delete'>,
  taskId: string,
  token: unknown,
  ctx: CreationContext,
): Promise<void> {
  return cancelCreation('tasks', taskId, token, ctx, (manager) => deleter.delete(taskId, { manager, userId: ctx.userId || null }));
}
