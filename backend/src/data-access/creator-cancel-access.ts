import { EntityManager } from 'typeorm';
import { applyDataAccess } from './data-access';

/**
 * Data-scoped access: "Cancel" of a budget line being created, for its creator when their access
 * is limited (`DELETE /budget-lines/:id/creation`, `budget-line-creation.ts`).
 *
 * The delete of a line is reserved to unscoped persons (spec §2.7): the DELETE policy of
 * `spend_items` is `false` for `kanap_data_limited`, and so are the deletes of its children. The
 * person who has just created a line in their scope may still take it back, with the creation token
 * of that line (tenant, family, line and person, 24 h). `withCreatorCancelAccess` is the window of
 * that one delete, the only write run outside the limited role (inventory:
 * `data-access-inventory.spec.ts`, which checks its single caller):
 * - the caller has checked the token and locked the line FOR UPDATE under the limited role (the
 *   UPDATE policy: a line the person may no longer modify is refused before the window);
 * - the window opens a savepoint and leaves the limited role (`RESET ROLE`), runs `run` (the delete
 *   of that line, its children and its audit entry), releases the savepoint, then applies the
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
