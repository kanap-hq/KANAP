import { EntityManager } from 'typeorm';

/**
 * Removes the history of tasks being deleted (changes, comments, decisions in
 * `portfolio_activities`). `task_id` there has no foreign key, so nothing
 * cascades: every task delete path calls this before deleting the rows, with
 * the whole set in one statement. Inline images of the removed comments are
 * left to the orphaned-attachment sweep.
 */
export async function deleteTaskActivities(manager: EntityManager, tenantId: string, taskIds: readonly string[]): Promise<void> {
  if (taskIds.length === 0) return;
  await manager.query(
    `DELETE FROM portfolio_activities WHERE tenant_id = $1 AND task_id = ANY($2::uuid[])`,
    [tenantId, [...taskIds]],
  );
}
