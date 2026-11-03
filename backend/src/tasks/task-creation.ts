import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { creationCancelExpired, issueCreationToken, verifyCreationToken } from '../common/creation/creation-token';
import {
  assertCreatorAloneSinceCreation,
  countChangesSinceCreation,
  withChildCount,
  type CreationChanges,
} from '../common/creation/creation-changes';
import type { TasksDeleteService } from './tasks-delete.service';

/**
 * "Cancel" of a task being created (lot V4 of the creation frame). Every create route of a task
 * (`POST /tasks/standalone`, `/portfolio/projects/:id/tasks`, `/spend-items/:id/tasks`,
 * `/capex-items/:id/tasks`, `/contracts/:id/tasks`, `/incidents/:id/tasks`) hands its creator a
 * token of the one family `tasks`. `GET /tasks/:id/creation` and `DELETE /tasks/:id/creation`, and
 * for a project task the same pair under its project's route, read and use it.
 *
 * The delete is the task delete (`TasksDeleteService.delete`): its refusals (the origin of a
 * request), its data-access check (`assertTaskDeletable`: a task of a line or a contract goes only
 * for a person who may modify that line or contract, which the creator of a task on it could), its
 * history and its audit entry. No window outside the limited role is needed: the DELETE policy of
 * `tasks` lets a limited person delete a task whose line or contract they may modify.
 */

export const TASK_CREATION_FAMILY = 'tasks';

type Subject = { tenantId: string; userId: string };

/** The created task with the token of its creator. */
export function withTaskCreationToken<T extends { id: string }>(created: T, subject: Subject): T & { creation_token: string } {
  const creation_token = issueCreationToken({ ...subject, family: TASK_CREATION_FAMILY, recordId: created.id });
  return Object.assign(created, { creation_token });
}

/** The token of a task create route for this task, tenant and person, still valid; a 403 otherwise. */
export function assertTaskCreationToken(taskId: string, token: unknown, subject: Subject): void {
  const valid = verifyCreationToken(token, { ...subject, family: TASK_CREATION_FAMILY, recordId: String(taskId ?? '') });
  if (!valid) throw creationCancelExpired();
}

/**
 * Before "Cancel": what was written on the task since its creation (its history's audit rows: its
 * fields, description included, its applications and assets), with its attachments and time
 * entries as they stand, and its comments and decisions (`portfolio_activities`, which is no
 * audit). Nothing is written.
 */
export async function taskCreationChanges(manager: EntityManager, subject: Subject, taskId: string): Promise<CreationChanges> {
  const { tenantId, userId } = subject;
  const [counts]: Array<{ found: number; attachments: number; time_entries: number; comments: number }> = await manager.query(
    `SELECT (SELECT count(*)::int FROM tasks WHERE tenant_id = $1 AND id = $2) AS found,
            (SELECT count(*)::int FROM task_attachments WHERE tenant_id = $1 AND task_id = $2) AS attachments,
            (SELECT count(*)::int FROM task_time_entries WHERE tenant_id = $1 AND task_id = $2) AS time_entries,
            (SELECT count(*)::int FROM portfolio_activities WHERE tenant_id = $1 AND task_id = $2 AND type IN ('comment', 'decision')) AS comments`,
    [tenantId, taskId],
  );
  if (!counts?.found) throw new NotFoundException('Task not found');
  await assertCreatorAloneSinceCreation(manager, tenantId, 'tasks', taskId, userId);
  let changes = await countChangesSinceCreation(manager, tenantId, 'tasks', taskId);
  changes = withChildCount(changes, 'attachment', counts.attachments);
  changes = withChildCount(changes, 'time_entry', counts.time_entries);
  return withChildCount(changes, 'comment', counts.comments);
}

/**
 * "Cancel": the creator deletes the task they just created (token checked by the route first),
 * while nobody else has written on it (403 `CREATION_CANCEL_EXPIRED` otherwise, read under the
 * task's lock), through the task delete.
 */
export async function cancelTaskCreation(
  manager: EntityManager,
  deleter: Pick<TasksDeleteService, 'delete'>,
  subject: Subject,
  taskId: string,
): Promise<void> {
  const { tenantId, userId } = subject;
  const [found] = await manager.query('SELECT 1 FROM tasks WHERE tenant_id = $1 AND id = $2', [tenantId, taskId]);
  if (!found) throw new NotFoundException('Task not found');
  await assertCreatorAloneSinceCreation(manager, tenantId, 'tasks', taskId, userId, { lock: true });
  await deleter.delete(taskId, { manager, userId: userId || null });
}
