import { EntityManager } from 'typeorm';

/**
 * Data-scoped access, controlled disclosure (planning/data-scoped-access/spec.md §5.2, §6.6): the
 * chargeback report of a company covered by the person's company nodes charges it shares of lines
 * the person cannot read. The shares are computed in TypeScript (`allocation-calculator.service.ts`),
 * so the report reads every line of the year in one window outside the limited role, then shows
 * only what §5.2 allows.
 *
 * `withFullDataAccess` is that window, and the only code besides `data_access_apply` that changes
 * the role (inventory: `data-access-inventory.spec.ts`, which also checks that the chargeback
 * report is its only caller):
 * - it opens a savepoint, makes it read only (`transaction_read_only`), leaves the limited role
 *   (`RESET ROLE`), runs `read`;
 * - then rolls back to the savepoint, which restores the limited role and the read-write mode as
 *   they were (PostgreSQL undoes a subtransaction's settings when it rolls back), and checks that
 *   the role is back. The `app.da_*` settings and the tenant never change.
 * A write inside the window fails (SQLSTATE 25006), and the window closes the same way after an
 * error: the transaction goes on under the limited role.
 *
 * Outside a limited transaction there is nothing to leave: `read` runs as it is, on the same manager.
 */

const LIMITED_ROLE = 'kanap_data_limited';
const SAVEPOINT = 'data_access_full_read';

/** The window did not give the limited role back: the request must not go on. */
export class FullDataAccessRestoreError extends Error {
  constructor(role: string | null) {
    super(`withFullDataAccess: the role after the window is ${String(role)}, expected ${LIMITED_ROLE}.`);
    this.name = 'FullDataAccessRestoreError';
  }
}

async function currentRole(manager: EntityManager): Promise<string | null> {
  const rows = await manager.query(`SELECT current_setting('role', true) AS role`);
  return rows?.[0]?.role ?? null;
}

export async function withFullDataAccess<T>(manager: EntityManager, read: (manager: EntityManager) => Promise<T>): Promise<T> {
  const runner = manager.queryRunner;
  if (!runner || !runner.isTransactionActive) {
    throw new Error('withFullDataAccess runs inside a transaction.');
  }
  if ((await currentRole(manager)) !== LIMITED_ROLE) return read(manager);

  // One round trip: the savepoint, read only, then out of the limited role.
  await manager.query(`SAVEPOINT ${SAVEPOINT}; SET LOCAL transaction_read_only = on; RESET ROLE`);
  let result: T;
  try {
    result = await read(manager);
  } finally {
    await manager.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}; RELEASE SAVEPOINT ${SAVEPOINT}`);
    const role = await currentRole(manager);
    if (role !== LIMITED_ROLE) throw new FullDataAccessRestoreError(role);
  }
  return result;
}
