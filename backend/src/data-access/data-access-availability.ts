import { DataSource, QueryRunner } from 'typeorm';

/**
 * Data-scoped access: startup synchronisation and availability (planning/data-scoped-access/spec.md
 * §6.2). The availability is informative (screens, logs): `data_access_apply` alone decides, per
 * transaction, and refuses a limited person when something is missing (fail closed).
 *
 * - The lead process (the single process, or worker 1), once per start, after the migrations: when
 *   the limited role exists and a grant or an expected policy is missing, it runs
 *   `data_access_sync_policies()` under a 5 s lock timeout; a failure is logged and retried at the
 *   next start. It then checks the availability, keeps it and logs one line.
 * - Every process reads the availability through `dataAccessAvailability()`: kept in memory for a
 *   minute, then checked again (read-only, no sync). A cluster worker therefore never depends on
 *   the order in which the processes start: a check made before the lead's sync is replaced within
 *   a minute, with no message between processes.
 */

export const DATA_ACCESS_LIMITED_ROLE = 'kanap_data_limited';

/** What makes the function unavailable, in plain words (logs, screens). */
export type DataAccessMissing = 'role' | 'membership' | 'inheritance' | 'schema_create' | 'policies' | 'grants';

export type DataAccessAvailability = { available: boolean; missing: DataAccessMissing[] };

export type DataAccessSyncOutcome = 'no_role' | 'not_needed' | 'done' | 'failed';

/** One dedicated connection: plain queries, and transactions of its own. */
export interface DataAccessSession {
  query(sql: string, params?: unknown[]): Promise<any[]>;
  /** Runs `fn` in a transaction, committed unless `rollback` is set; rolled back when `fn` throws. */
  inTransaction<T>(fn: () => Promise<T>, opts?: { rollback?: boolean }): Promise<T>;
}

export type DataAccessLogger = { log(line: string): void; warn(line: string): void };

const LOG_PREFIX = '[DATA-ACCESS]';
const AVAILABILITY_TTL_MS = 60_000;
const SYNC_LOCK_TIMEOUT = '5s';

type CatalogState = {
  roleExists: boolean;
  inherits: boolean;
  schemaCreateMissing: boolean;
  grantsMissing: boolean;
  policiesMissing: boolean;
};

/**
 * The catalog side of the check. Grants: USAGE on `public`; SELECT, INSERT, UPDATE, DELETE on every
 * table, view and foreign table of `public` the application role owns, USAGE and SELECT on every
 * sequence it owns: the relations of `data_access_grant_targets()`, the same list the sync grants
 * on (a relation of another owner is outside the rule "every KANAP table belongs to the application
 * role"). Policies: every expected policy exists, restrictive, on its command and targeting the
 * role (same test as `data_access_apply`).
 */
async function readCatalogState(session: DataAccessSession): Promise<CatalogState> {
  const [base] = await session.query(
    `SELECT to_regrole($1) IS NOT NULL AS role_exists,
            current_setting('server_version_num')::int < 160000
              AND NOT has_schema_privilege(current_user, 'public', 'CREATE') AS schema_create_missing`,
    [DATA_ACCESS_LIMITED_ROLE],
  );
  const roleExists = base?.role_exists === true;
  const schemaCreateMissing = base?.schema_create_missing === true;
  if (!roleExists) {
    return { roleExists, inherits: false, schemaCreateMissing, grantsMissing: false, policiesMissing: false };
  }
  const [state] = await session.query(
    `WITH lim AS (SELECT to_regrole($1) AS oid)
     SELECT
       pg_has_role(current_user, (SELECT oid FROM lim), 'USAGE') AS inherits,
       NOT has_schema_privilege((SELECT oid FROM lim), 'public', 'USAGE')
       OR EXISTS (
         SELECT 1
         FROM data_access_grant_targets() t
         WHERE CASE
           WHEN t.is_sequence THEN NOT (
             has_sequence_privilege((SELECT oid FROM lim), format('public.%I', t.relname), 'USAGE')
             AND has_sequence_privilege((SELECT oid FROM lim), format('public.%I', t.relname), 'SELECT')
           )
           ELSE NOT (
             has_table_privilege((SELECT oid FROM lim), format('public.%I', t.relname), 'SELECT')
             AND has_table_privilege((SELECT oid FROM lim), format('public.%I', t.relname), 'INSERT')
             AND has_table_privilege((SELECT oid FROM lim), format('public.%I', t.relname), 'UPDATE')
             AND has_table_privilege((SELECT oid FROM lim), format('public.%I', t.relname), 'DELETE')
           )
         END
       ) AS grants_missing,
       EXISTS (
         SELECT 1
         FROM data_access_expected_policies() e
         WHERE NOT EXISTS (
           SELECT 1
           FROM pg_policy p
           JOIN pg_class c ON c.oid = p.polrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public'
             AND c.relname = e.table_name
             AND p.polname = e.policy_name
             AND NOT p.polpermissive
             AND (SELECT oid FROM lim) = ANY (p.polroles)
             AND p.polcmd::text = CASE upper(e.command)
               WHEN 'SELECT' THEN 'r' WHEN 'INSERT' THEN 'a' WHEN 'UPDATE' THEN 'w'
               WHEN 'DELETE' THEN 'd' WHEN 'ALL' THEN '*' END
         )
       ) AS policies_missing`,
    [DATA_ACCESS_LIMITED_ROLE],
  );
  return {
    roleExists,
    inherits: state?.inherits === true,
    schemaCreateMissing,
    grantsMissing: state?.grants_missing === true,
    policiesMissing: state?.policies_missing === true,
  };
}

/** Whether the application role can take the limited role: `SET LOCAL ROLE` in a rolled-back transaction. */
async function canTakeRole(session: DataAccessSession): Promise<boolean> {
  try {
    await session.inTransaction(async () => {
      await session.query(`SET LOCAL ROLE ${DATA_ACCESS_LIMITED_ROLE}`);
    }, { rollback: true });
    return true;
  } catch {
    return false;
  }
}

/** The checks of spec §6.2 "Contrôle de disponibilité", read-only. */
export async function checkDataAccessAvailability(session: DataAccessSession): Promise<DataAccessAvailability> {
  const state = await readCatalogState(session);
  if (!state.roleExists) {
    const missing: DataAccessMissing[] = ['role'];
    if (state.schemaCreateMissing) missing.push('schema_create');
    return { available: false, missing };
  }
  const missing: DataAccessMissing[] = [];
  if (!(await canTakeRole(session))) missing.push('membership');
  if (state.inherits) missing.push('inheritance');
  if (state.schemaCreateMissing) missing.push('schema_create');
  if (state.policiesMissing) missing.push('policies');
  if (state.grantsMissing) missing.push('grants');
  return { available: missing.length === 0, missing };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The startup routine of the lead process: sync when the role exists and a grant or a policy is
 * missing, then check. Never throws: a failed sync or check is logged, and the function stays
 * unavailable until the next start.
 */
export async function synchroniseDataAccess(
  session: DataAccessSession,
  logger: DataAccessLogger = console,
): Promise<{ sync: DataAccessSyncOutcome; availability: DataAccessAvailability }> {
  let sync: DataAccessSyncOutcome = 'no_role';
  try {
    const state = await readCatalogState(session);
    if (state.roleExists) {
      sync = 'not_needed';
      if (state.grantsMissing || state.policiesMissing) {
        try {
          await session.inTransaction(async () => {
            await session.query(`SET LOCAL lock_timeout = '${SYNC_LOCK_TIMEOUT}'`);
            await session.query(`SELECT data_access_sync_policies()`);
          });
          sync = 'done';
          logger.log(`${LOG_PREFIX} grants and policies of ${DATA_ACCESS_LIMITED_ROLE} synchronised`);
        } catch (error) {
          sync = 'failed';
          logger.warn(
            `${LOG_PREFIX} synchronisation of the grants and policies of ${DATA_ACCESS_LIMITED_ROLE} failed `
            + `(${errorMessage(error)}): retried at next start`,
          );
        }
      }
    }
  } catch (error) {
    logger.warn(`${LOG_PREFIX} startup synchronisation not run (${errorMessage(error)}): retried at next start`);
  }

  let availability: DataAccessAvailability;
  try {
    availability = await checkDataAccessAvailability(session);
  } catch (error) {
    logger.warn(`${LOG_PREFIX} availability not checked (${errorMessage(error)}): data-scoped access unavailable`);
    return { sync, availability: { available: false, missing: [] } };
  }
  logger.log(describeAvailability(availability));
  return { sync, availability };
}

/** The startup line. */
export function describeAvailability(availability: DataAccessAvailability): string {
  if (availability.available) return `${LOG_PREFIX} data-scoped access available`;
  if (availability.missing.length === 1 && availability.missing[0] === 'role') {
    return `${LOG_PREFIX} data-scoped access not installed (no ${DATA_ACCESS_LIMITED_ROLE} role): nobody can be limited`;
  }
  return `${LOG_PREFIX} data-scoped access unavailable, missing: ${availability.missing.join(', ')}. `
    + 'Limited persons are refused until it is fixed (infra/scripts/data-access-role.sql, then a restart)';
}

/** A dedicated connection of `dataSource` as a session; released after `fn`. */
async function withDedicatedSession<T>(dataSource: DataSource, fn: (session: DataAccessSession) => Promise<T>): Promise<T> {
  const runner: QueryRunner = dataSource.createQueryRunner();
  await runner.connect();
  const session: DataAccessSession = {
    query: (sql, params) => runner.query(sql, params),
    inTransaction: async (work, opts) => {
      await runner.startTransaction();
      try {
        const result = await work();
        if (opts?.rollback) await runner.rollbackTransaction();
        else await runner.commitTransaction();
        return result;
      } catch (error) {
        if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
        throw error;
      }
    },
  };
  try {
    return await fn(session);
  } finally {
    await runner.release();
  }
}

type CacheEntry = { at: number; value: DataAccessAvailability | null; pending: Promise<DataAccessAvailability> | null };
const cache = new WeakMap<DataSource, CacheEntry>();

function entryOf(dataSource: DataSource): CacheEntry {
  let entry = cache.get(dataSource);
  if (!entry) {
    entry = { at: 0, value: null, pending: null };
    cache.set(dataSource, entry);
  }
  return entry;
}

/** Lead process, once per start, after the migrations (main.ts). Never throws. */
export async function runDataAccessStartup(dataSource: DataSource, logger: DataAccessLogger = console): Promise<DataAccessAvailability> {
  let availability: DataAccessAvailability;
  try {
    availability = (await withDedicatedSession(dataSource, (session) => synchroniseDataAccess(session, logger))).availability;
  } catch (error) {
    logger.warn(`${LOG_PREFIX} startup synchronisation not run (${errorMessage(error)}): retried at next start`);
    availability = { available: false, missing: [] };
  }
  const entry = entryOf(dataSource);
  entry.value = availability;
  entry.at = Date.now();
  return availability;
}

/**
 * The availability as this process knows it: kept for a minute, then checked again (read-only).
 * Never throws: a failed check reads as unavailable, with a warning.
 */
export async function dataAccessAvailability(dataSource: DataSource): Promise<DataAccessAvailability> {
  const entry = entryOf(dataSource);
  if (entry.value && Date.now() - entry.at < AVAILABILITY_TTL_MS) return entry.value;
  if (!entry.pending) {
    entry.pending = withDedicatedSession(dataSource, checkDataAccessAvailability)
      .catch((error) => {
        console.warn(`${LOG_PREFIX} availability not checked (${errorMessage(error)}): read as unavailable`);
        return { available: false, missing: [] } as DataAccessAvailability;
      })
      .then((value) => {
        entry.value = value;
        entry.at = Date.now();
        entry.pending = null;
        return value;
      });
  }
  return entry.pending;
}
