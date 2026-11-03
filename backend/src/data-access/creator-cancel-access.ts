import { EntityManager } from 'typeorm';
import { applyDataAccess } from './data-access';

/**
 * Data-scoped access: "Cancel" of a budget line or a contract being created, for its creator when
 * their access is limited (`DELETE /budget-lines/:id/creation`, `budget-line-creation.ts`;
 * `DELETE /contracts/:id/creation`, `ContractsDeleteService.cancelCreation`).
 *
 * The delete of a line or a contract is reserved to unscoped persons (spec §2.7): the DELETE policy
 * of `spend_items` and of `contracts` is `false` for `kanap_data_limited`, and so are the deletes of
 * their children. The person who has just created one in their scope may still take it back, with
 * its creation token (tenant, family, record and person, 24 h). `withCreatorCancelAccess` is the
 * window of that one delete, the only write run outside the limited role (inventory:
 * `data-access-inventory.spec.ts`, which checks its two callers):
 * - the caller has checked the token and locked the record FOR UPDATE under the limited role (the
 *   UPDATE policy: a record the person may no longer modify is refused before the window);
 * - the access applied to the transaction is the person's (`app.da_user`, set by
 *   `data_access_apply`, equals `userId`): a window for anyone else throws before leaving the role;
 * - the window opens a savepoint and leaves the limited role (`RESET ROLE`), runs `run` (the delete
 *   of that record, its children and its audit entry), releases the savepoint, then applies the
 *   person's access again (`applyDataAccess`, which takes the limited role back) and checks that the
 *   mode is `limited` again; anything else throws, and the request's transaction rolls back with
 *   the delete;
 * - on an error inside `run`, the savepoint is rolled back, which restores the limited role (a
 *   subtransaction's settings go with it), and the error goes on.
 * The tenant (`app.current_tenant`) never changes: the tenant policies apply inside the window.
 *
 * Outside a limited transaction there is nothing to leave: `run` runs as it is.
 */

const LIMITED_ROLE = 'kanap_data_limited';
const SAVEPOINT = 'data_access_creator_cancel';

/** The window did not give the limited access back: the request must not go on. */
export class CreatorCancelRestoreError extends Error {
  constructor(state: string) {
    super(`withCreatorCancelAccess: after the window the access is ${state}, expected ${LIMITED_ROLE}.`);
    this.name = 'CreatorCancelRestoreError';
  }
}

async function currentRole(manager: EntityManager): Promise<string | null> {
  const rows = await manager.query(`SELECT current_setting('role', true) AS role`);
  return rows?.[0]?.role ?? null;
}

export async function withCreatorCancelAccess<T>(
  manager: EntityManager,
  userId: string,
  run: (manager: EntityManager) => Promise<T>,
): Promise<T> {
  const runner = manager.queryRunner;
  if (!runner || !runner.isTransactionActive) {
    throw new Error('withCreatorCancelAccess runs inside a transaction.');
  }
  if ((await currentRole(manager)) !== LIMITED_ROLE) return run(manager);
  // The window is the person's own: the access the transaction runs under was applied for them.
  const [applied] = await manager.query(`SELECT current_setting('app.da_user', true) AS user_id`);
  const appliedUser = String(applied?.user_id ?? '').toLowerCase();
  if (!appliedUser || appliedUser !== String(userId ?? '').toLowerCase()) {
    throw new Error('withCreatorCancelAccess: the transaction\'s data access is not the person\'s.');
  }

  await manager.query(`SAVEPOINT ${SAVEPOINT}; RESET ROLE`);
  let result: T;
  try {
    result = await run(manager);
  } catch (error) {
    await manager.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}; RELEASE SAVEPOINT ${SAVEPOINT}`);
    const role = await currentRole(manager);
    if (role !== LIMITED_ROLE) throw new CreatorCancelRestoreError(`role ${String(role)}`);
    throw error;
  }
  await manager.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
  // The released savepoint keeps the role reset: the person's access is applied again.
  const mode = await applyDataAccess(manager, userId);
  const role = await currentRole(manager);
  if (mode !== 'limited' || role !== LIMITED_ROLE) throw new CreatorCancelRestoreError(`mode ${mode}, role ${String(role)}`);
  return result;
}
