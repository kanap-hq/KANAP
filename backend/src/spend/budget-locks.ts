import { ConflictException, HttpStatus, NotFoundException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import type { AmountScope } from './amounts-write.util';

/**
 * The one lock order of every budget writer, OPEX and CAPEX alike (plan
 * planning/perf-scale, lot 3B):
 *
 *   0. a bulk operation (column copy or clear, allocation copy, item CSV
 *      import, budget rows import, and a freeze or unfreeze that pins or
 *      unpins the year's FX rate set): the tenant's budget-operations
 *      advisory lock (`lockTenantBudgetOperations`), so two of them never run
 *      at once;
 *   1. the line (`spend_items` / `capex_items`) FOR NO KEY UPDATE (FOR UPDATE
 *      for its delete); several lines in id order (`lockBudgetLines`, or
 *      `lockBudgetYear` for every line of a year);
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
 *
 * One known exception, left as it is: deleting a supplier, a company or a
 * user sets the lines that name it to NULL (`ON DELETE SET NULL`), which
 * PostgreSQL does in the order it finds those lines, outside the id order and
 * without the tenant lock, while the delete holds the deleted row. A bulk
 * operation that holds one of those lines and writes a reference to that row
 * meanwhile waits for the delete, which waits for the line: one of the two
 * ends with a deadlock, answered 409 `retry` (lot 1D). Rare (a master data
 * delete during a bulk operation) and retried as is.
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

/**
 * Locks every line of the tenant that has a version of `year`, in id order,
 * then those versions, in id order: what a write over the whole year (the FX
 * pin of a freeze) takes before its UPDATE, after the tenant lock. Returns
 * the ids of the versions locked.
 */
export async function lockBudgetYear(manager: EntityManager, scope: AmountScope, tenantId: string, year: number): Promise<string[]> {
  const t = TABLES[scope];
  await manager.query(
    `SELECT i.id FROM ${t.items} i
      WHERE i.tenant_id = $1
        AND EXISTS (SELECT 1 FROM ${t.versions} v WHERE v.tenant_id = i.tenant_id AND v.${t.itemFk} = i.id AND v.budget_year = $2)
      ORDER BY i.id
        FOR NO KEY UPDATE OF i`,
    [tenantId, year],
  );
  const rows: Array<{ id: string }> = await manager.query(
    `SELECT id FROM ${t.versions} WHERE tenant_id = $1 AND budget_year = $2 ORDER BY id FOR NO KEY UPDATE`,
    [tenantId, year],
  );
  return rows.map((row) => row.id);
}

/** The code of the 409 a bulk budget operation gets while another one runs: not retried by itself (the autosave never sees it). */
export const BUDGET_OPERATION_RUNNING_CODE = 'operation_running';

export const BUDGET_OPERATION_RUNNING =
  'Another budget operation (a column copy or clear, an allocation copy, a CSV import, or a freeze or unfreeze of a year) is running for this workspace. Try again when it has finished.';

/**
 * The advisory lock namespace of the tenant budget-operations lock ("BOPS"):
 * the two-key form, a key space of its own, so it never meets the single-key
 * locks (scheduled tasks, Netbox sync, ingestion) whatever their hash.
 */
const BUDGET_OPERATIONS_LOCK_NAMESPACE = 0x424f5053;

/**
 * The tenant's budget-operations lock: a transaction advisory lock shared by
 * the column copy and clear, the allocation copy, the item CSV imports, the
 * budget rows import and a freeze or unfreeze that pins or unpins FX rates,
 * held until the request transaction ends. A second operation does not wait:
 * it is refused with a 409 `operation_running` (its own code, not the `retry`
 * of a deadlock that a client may send again at once), whose message says
 * what runs.
 */
export async function lockTenantBudgetOperations(manager: EntityManager, tenantId: string): Promise<void> {
  const [row] = await manager.query(
    `SELECT pg_try_advisory_xact_lock($1::int, hashtext($2)) AS locked`,
    [BUDGET_OPERATIONS_LOCK_NAMESPACE, `budget-ops:${tenantId}`],
  );
  if (!row?.locked) {
    throw new ConflictException({
      statusCode: HttpStatus.CONFLICT,
      error: 'Conflict',
      code: BUDGET_OPERATION_RUNNING_CODE,
      message: BUDGET_OPERATION_RUNNING,
    });
  }
}
