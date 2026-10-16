import { EntityManager } from 'typeorm';

/**
 * Removes the history of tasks being deleted (changes, comments, decisions in
 * `portfolio_activities`). Every task delete path calls this before deleting
 * the rows, with the whole set in one statement; the foreign key on `task_id`
 * (migration 1854160000000) cascades for any other path. Inline images of the removed comments are
 * left to the orphaned-attachment sweep.
 */
export async function deleteTaskActivities(manager: EntityManager, tenantId: string, taskIds: readonly string[]): Promise<void> {
  if (taskIds.length === 0) return;
  await manager.query(
    `DELETE FROM portfolio_activities WHERE tenant_id = $1 AND task_id = ANY($2::uuid[])`,
    [tenantId, [...taskIds]],
  );
}
