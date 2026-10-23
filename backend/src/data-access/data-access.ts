import { EntityManager, QueryRunner } from 'typeorm';

/**
 * Data-scoped access (planning/data-scoped-access/spec.md §6.3): the server side of
 * `data_access_apply`. The access of a person is set per transaction, never per session: the
 * settings and the role die at COMMIT or ROLLBACK, so a pooled connection carries nothing.
 *
 * Call points (and nowhere else): the tenant interceptor, the reconnection of a request
 * (`createTenantQueryRunner`), `AiTenantExecutionService.runWithContext`, and the public routes of
 * the inline attachments.
 */

export type DataAccessMode = 'all' | 'limited';

/**
 * A person whose access is limited cannot run without a transaction: outside one, the access would
 * last one statement, or stay on the pooled connection. A programming error (answered 500).
 */
export class DataAccessTransactionRequiredError extends Error {
  constructor(readonly userId: string) {
    super(
      `Data access: person ${userId} has a limited access and cannot run without a transaction `
      + '(withTenantExecution with { transaction: false }). Run this work in a transaction.',
    );
    this.name = 'DataAccessTransactionRequiredError';
  }
}

function isQueryRunner(target: EntityManager | QueryRunner): target is QueryRunner {
  return typeof (target as QueryRunner).isTransactionActive === 'boolean' && 'manager' in target;
}

function transactionRunnerOf(target: EntityManager | QueryRunner): QueryRunner {
  const runner = isQueryRunner(target) ? target : target.queryRunner;
  if (!runner || !runner.isTransactionActive) {
    throw new Error('applyDataAccess runs inside a transaction: the access would not last otherwise.');
  }
  return runner;
}

/**
 * Sets the access of `userId` for the current transaction, in one round trip. `all` (unscoped
 * person or Administrator) changes nothing; `limited` sets the settings and takes the limited role
 * until the transaction ends. Refusals come from the database: SQLSTATE KDA01 (access unavailable,
 * 503) and KDA02 (person not in the tenant, 401), mapped in `common/filters/database-error.mapping.ts`.
 */
export async function applyDataAccess(target: EntityManager | QueryRunner, userId: string): Promise<DataAccessMode> {
  const runner = transactionRunnerOf(target);
  const rows = await runner.query(`SELECT data_access_apply($1) AS mode`, [userId]);
  const mode = rows?.[0]?.mode;
  if (mode !== 'all' && mode !== 'limited') {
    throw new Error(`data_access_apply returned an unexpected value: ${String(mode)}`);
  }
  return mode;
}

/**
 * Whether the person's access is limited (mode `limited`, not Administrator), read without taking
 * the role, under the tenant already set on the connection. An unknown person reads as not limited:
 * the paths that use it ran without access before and keep doing so.
 */
export async function isDataAccessLimited(manager: EntityManager, userId: string): Promise<boolean> {
  const rows = await manager.query(
    `SELECT EXISTS (
       SELECT 1
       FROM users u
       WHERE u.id = $1
         AND u.tenant_id = app_current_tenant()
         AND u.data_access_mode = 'limited'
         AND NOT EXISTS (
           SELECT 1
           FROM (
             SELECT u.role_id
             UNION
             SELECT ur.role_id FROM user_roles ur WHERE ur.user_id = u.id AND ur.tenant_id = u.tenant_id
           ) assigned
           JOIN roles r ON r.id = assigned.role_id AND r.tenant_id = u.tenant_id
           WHERE lower(trim(r.role_name)) = 'administrator'
         )
     ) AS limited`,
    [userId],
  );
  return rows?.[0]?.limited === true;
}

/** Refuses a run without a transaction for a person whose access is limited. */
export async function assertDataAccessWithoutTransaction(manager: EntityManager, userId: string): Promise<void> {
  if (await isDataAccessLimited(manager, userId)) {
    throw new DataAccessTransactionRequiredError(userId);
  }
}
