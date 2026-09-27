import { HttpException, Logger } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { withSavepoint } from '../common/savepoint.util';
import { ATTACHMENT_TABLES } from '../common/storage-path-refs';
import { StorageService } from '../common/storage/storage.service';
import { UserTimeAggregateService } from '../portfolio/services/user-time-aggregate.service';

// What an item delete removes besides versions, amounts and allocations. Links,
// attachments and contract links have no foreign key to the item, so nothing
// cascades to them; tasks are polymorphic rows. Both item types share this.

export type ItemDeleteScope = 'opex' | 'capex';

const SCOPES = {
  opex: {
    itemColumn: 'spend_item_id',
    links: 'spend_links',
    attachments: 'spend_attachments',
    contractLinks: 'contract_spend_items',
    taskObjectType: 'spend_item',
  },
  capex: {
    itemColumn: 'capex_item_id',
    links: 'capex_links',
    attachments: 'capex_attachments',
    contractLinks: 'contract_capex_items',
    taskObjectType: 'capex_item',
  },
} as const;

export type ItemDependentsDeps = {
  audit: AuditService;
  timeAggregates: UserTimeAggregateService | null | undefined;
  userId: string | null;
};

/**
 * Deletes the item's links, attachment rows, contract links and tasks. Returns
 * the attachment storage paths, whose blobs go once the item's rows are gone
 * (`unreferencedPaths`, then `deleteBlobs`).
 */
export async function deleteItemDependents(
  manager: EntityManager,
  scope: ItemDeleteScope,
  tenantId: string,
  itemId: string,
  deps: ItemDependentsDeps,
): Promise<string[]> {
  const s = SCOPES[scope];

  await manager.query(`DELETE FROM ${s.links} WHERE tenant_id = $1 AND ${s.itemColumn} = $2`, [tenantId, itemId]);

  const attachments: Array<{ storage_path: string }> = await manager.query(
    `SELECT storage_path FROM ${s.attachments} WHERE tenant_id = $1 AND ${s.itemColumn} = $2`,
    [tenantId, itemId],
  );
  await manager.query(`DELETE FROM ${s.attachments} WHERE tenant_id = $1 AND ${s.itemColumn} = $2`, [tenantId, itemId]);

  await manager.query(`DELETE FROM ${s.contractLinks} WHERE tenant_id = $1 AND ${s.itemColumn} = $2`, [tenantId, itemId]);

  await deleteItemTasks(manager, s.taskObjectType, tenantId, itemId, deps);

  return [...new Set(attachments.map((a) => a.storage_path).filter(Boolean))];
}

/**
 * A task turned into a request is the request's `origin_task_id` (RESTRICT):
 * the request keeps its own copy of the task, so only the link is cleared.
 * Task attachment blobs stay: a converted request shares their paths, and the
 * weekly ghost sweep removes the unshared ones.
 */
async function deleteItemTasks(
  manager: EntityManager,
  taskObjectType: string,
  tenantId: string,
  itemId: string,
  deps: ItemDependentsDeps,
): Promise<void> {
  const tasks: Array<{ id: string }> = await manager.query(
    `SELECT id FROM tasks WHERE tenant_id = $1 AND related_object_type = $2 AND related_object_id = $3`,
    [tenantId, taskObjectType, itemId],
  );
  if (tasks.length === 0) return;
  const taskIds = tasks.map((t) => t.id);

  const months: Array<{ user_id: string; year_month: string }> = await manager.query(
    `SELECT DISTINCT user_id, to_char(date_trunc('month', logged_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS year_month
     FROM task_time_entries
     WHERE tenant_id = $1 AND task_id = ANY($2::uuid[]) AND user_id IS NOT NULL`,
    [tenantId, taskIds],
  );

  const requests: Array<{ id: string; origin_task_id: string }> = await manager.query(
    `SELECT id, origin_task_id FROM portfolio_requests WHERE tenant_id = $1 AND origin_task_id = ANY($2::uuid[])`,
    [tenantId, taskIds],
  );
  if (requests.length > 0) {
    await manager.query(
      `UPDATE portfolio_requests SET origin_task_id = NULL WHERE tenant_id = $1 AND id = ANY($2::uuid[])`,
      [tenantId, requests.map((r) => r.id)],
    );
    for (const request of requests) {
      await deps.audit.log(
        {
          table: 'portfolio_requests',
          recordId: request.id,
          action: 'update',
          before: { origin_task_id: request.origin_task_id },
          after: { origin_task_id: null },
          userId: deps.userId,
        },
        { manager },
      );
    }
  }

  await manager.query(`DELETE FROM tasks WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, taskIds]);

  for (const { user_id, year_month } of months) {
    await deps.timeAggregates!.recalculateUserMonth(user_id, new Date(`${year_month}T00:00:00Z`), manager);
  }
}

/**
 * The attachment paths no attachment row of the tenant references any more.
 * Runs with the item's rows, inside its savepoint on a bulk delete, so a
 * failed check fails only that item and no file has been touched yet.
 */
export async function unreferencedPaths(manager: EntityManager, tenantId: string, paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const rows: Array<{ storage_path: string }> = await manager.query(
    ATTACHMENT_TABLES.map(
      (table) => `SELECT storage_path FROM ${table} WHERE tenant_id = $1 AND storage_path = ANY($2::text[])`,
    ).join(' UNION '),
    [tenantId, paths],
  );
  const referenced = new Set(rows.map((r) => r.storage_path));
  return paths.filter((path) => !referenced.has(path));
}

/**
 * Best effort, once the rows are gone: a storage failure is logged, never
 * thrown; the weekly ghost sweep catches what is left.
 */
export async function deleteBlobs(storage: StorageService | null | undefined, paths: string[], logger: Logger): Promise<void> {
  if (!storage) return;
  for (const path of paths) {
    try {
      await storage.deleteObject(path);
    } catch (err: any) {
      logger.warn(`Failed to delete storage object "${path}": ${err?.message || 'Unknown error'}`);
    }
  }
}

/** The request's tenant; every statement of an item delete filters on it. */
export async function currentTenantId(manager: EntityManager): Promise<string> {
  const [row] = await manager.query(`SELECT current_setting('app.current_tenant', true) AS tenant_id`);
  const tenantId = row?.tenant_id as string | null | undefined;
  if (!tenantId) throw new Error('No current tenant for the item delete');
  return tenantId;
}

/**
 * Runs one item of a bulk delete under its own savepoint, so a failing item is
 * undone alone and the request transaction stays usable for the others.
 */
export async function underItemSavepoint<T>(manager: EntityManager, _index: number, fn: () => Promise<T>): Promise<T> {
  return withSavepoint(manager, fn);
}

/** The reason a bulk delete reports for a failed item: an HTTP error's own message, otherwise a plain one. */
export function bulkDeleteFailureReason(error: unknown, logger: Logger, itemId: string): string {
  if (error instanceof HttpException) return error.message;
  logger.error(`Delete of item ${itemId} failed: ${(error as Error)?.message || 'Unknown error'}`);
  return 'This line could not be deleted';
}
