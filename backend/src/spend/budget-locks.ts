import { ConflictException, HttpStatus, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { AmountScope } from './amounts-write.util';

/**
 * The one lock order of every budget writer, OPEX and CAPEX alike (plan
 * planning/perf-scale, lot 3B):
 *
 *   0. a bulk operation (column copy or clear, allocation copy, item CSV
 *      import, budget rows import): the tenant's budget-operations advisory
 *      lock (`lockTenantBudgetOperations`), so two of them never run at once;
 *   1. the line (`spend_items` / `capex_items`) FOR NO KEY UPDATE (FOR UPDATE
 *      for its delete); several lines in id order (`lockBudgetLines`);
 *   2. its versions FOR NO KEY UPDATE; several in id order (`lockBudgetVersions`);
 *   3. the months of a version, created then locked in period order
 *      (`amounts-write.util.ts`, which locks the version again first);
 *   4. the round-input records in column order, then their costed lines
 *      (`round-inputs.util.ts`);
 *   5. allocations, links, applications, projects and contacts of the line.
 *
 * Every writer of a line's budget takes the line first, so writers of one line
 * take turns and none holds a child while waiting for the line or the
 * version. The database triggers that keep the freshness counters (migration
 * 1853740000000) update the version (`budget_rev`) and the line
 * (`row_version`) after their children: that is deadlock-free only because
 * the writer already holds both. A new writer must follow this order.
 */

// Table names come only from here: never from the caller.
const TABLES = {
  opex: { items: 'spend_items', versions: 'spend_versions', itemFk: 'spend_item_id' },
  capex: { items: 'capex_items', versions: 'capex_versions', itemFk: 'capex_item_id' },
} as const;

/** Locks the line (FOR NO KEY UPDATE, or FOR UPDATE before its delete); false when it is gone. */
export async function lockBudgetLine(
  manager: EntityManager,
  scope: AmountScope,
  tenantId: string,
  itemId: string,
  mode: 'no key update' | 'update' = 'no key update',
): Promise<boolean> {
  const rows = await manager.query(
    `SELECT 1 FROM ${TABLES[scope].items} WHERE tenant_id = $1 AND id = $2 FOR ${mode === 'update' ? 'UPDATE' : 'NO KEY UPDATE'}`,
    [tenantId, itemId],
  );
  return rows.length > 0;
}

/** Locks the lines in id order (one statement); returns the ids of those still there. */
export async function lockBudgetLines(manager: EntityManager, scope: AmountScope, tenantId: string, itemIds: Iterable<string>): Promise<Set<string>> {
  const ids = Array.from(new Set(Array.from(itemIds).filter(Boolean)));
  if (ids.length === 0) return new Set();
  const rows: Array<{ id: string }> = await manager.query(
    `SELECT id FROM ${TABLES[scope].items} WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR NO KEY UPDATE`,
    [tenantId, ids],
  );
  return new Set(rows.map((row) => row.id));
}

/** Locks the versions in id order (one statement), once their lines are held; returns the ids still there. */
export async function lockBudgetVersions(manager: EntityManager, scope: AmountScope, tenantId: string, versionIds: Iterable<string>): Promise<Set<string>> {
  const ids = Array.from(new Set(Array.from(versionIds).filter(Boolean)));
  if (ids.length === 0) return new Set();
  const rows: Array<{ id: string }> = await manager.query(
    `SELECT id FROM ${TABLES[scope].versions} WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR NO KEY UPDATE`,
    [tenantId, ids],
  );
  return new Set(rows.map((row) => row.id));
}

/**
 * Locks a version by its id alone: its line first, then the version. The
 * version's line is read without a lock (a version never changes line); the
 * version is read again under the lock. Null when the version or its line is
 * gone (deleted meanwhile).
 */
export async function lockVersionWithLine(
  manager: EntityManager,
  scope: AmountScope,
  tenantId: string,
  versionId: string,
): Promise<{ itemId: string } | null> {
  const t = TABLES[scope];
  const [found]: Array<{ item_id: string }> = await manager.query(
    `SELECT ${t.itemFk} AS item_id FROM ${t.versions} WHERE tenant_id = $1 AND id = $2`,
    [tenantId, versionId],
  );
  if (!found) return null;
  if (!(await lockBudgetLine(manager, scope, tenantId, found.item_id))) return null;
  const locked = await lockBudgetVersions(manager, scope, tenantId, [versionId]);
  return locked.has(versionId) ? { itemId: found.item_id } : null;
}

/** `lockVersionWithLine`, refusing a missing version with a 404. */
export async function lockVersionWithLineOrFail(manager: EntityManager, scope: AmountScope, tenantId: string, versionId: string): Promise<{ itemId: string }> {
  const locked = await lockVersionWithLine(manager, scope, tenantId, versionId);
  if (!locked) throw new NotFoundException('Version not found');
  return locked;
}

export const BUDGET_OPERATION_RUNNING =
  'Another budget operation (a column copy or clear, an allocation copy or a CSV import) is running for this workspace. Try again when it has finished.';

/**
 * The tenant's budget-operations lock: a transaction advisory lock shared by
 * the column copy and clear, the allocation copy, the item CSV imports and
 * the budget rows import, held until the request transaction ends. A second
 * operation does not wait: it is refused with a 409 (`retry`, the code a
 * client may try again on), whose message says what runs.
 */
export async function lockTenantBudgetOperations(manager: EntityManager, tenantId: string): Promise<void> {
  const [row] = await manager.query(`SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked`, [`budget-ops:${tenantId}`]);
  if (!row?.locked) {
    throw new ConflictException({ statusCode: HttpStatus.CONFLICT, error: 'Conflict', code: 'retry', message: BUDGET_OPERATION_RUNNING });
  }
}
