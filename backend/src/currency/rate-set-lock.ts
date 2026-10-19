import { EntityManager } from 'typeorm';

/** Transaction lock that serializes rate-set writes of one tenant and year. */
export function rateSetLockKey(tenantId: string, year: number): string {
  return `fx-rate-set:${tenantId}:${year}`;
}

/**
 * Held until the caller's transaction ends. `saveRateSet` and a manual entry
 * both take it before they read the latest set, so neither can commit a copy
 * of a set the other has already replaced.
 *
 * Both callers already run inside a transaction: the refresh through
 * `withTenantExecution(..., { transaction: true })` (or the request
 * transaction when a manager is passed in), and the manual write through the
 * request transaction. An xact lock taken outside a transaction would end
 * with the statement.
 */
export async function lockRateSetWrite(manager: EntityManager, tenantId: string, year: number): Promise<void> {
  await manager.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [rateSetLockKey(tenantId, year)]);
}
