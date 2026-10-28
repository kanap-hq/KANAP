import { DataSource, QueryRunner } from 'typeorm';

/**
 * Data-scoped access: startup synchronisation and availability (planning/data-scoped-access/spec.md
 * §6.2). The availability is informative (screens, logs): `data_access_apply` alone decides, per
 * transaction, and refuses a limited person when something is missing (fail closed).
 *
 * - Before the migrations (scripts/migrate-and-start.js, app.module.ts): when the application role
 *   inherits the limited role and policies on that role exist, `data_access_sync_policies()` drops
 *   them, so no migration runs under them (they would refuse everything to everyone without
 *   context, spec §10.6).
 * - The lead process (the single process, or worker 1), once per start, after the migrations: when
 *   the limited role exists and a grant or an expected policy is missing or different, or the
 *   application role inherits it, it runs `data_access_sync_policies()` under a 5 s lock timeout
 *   (under inheritance
 *   the sync drops every policy on the role and creates none); a failure is logged and retried at
 *   the next start. It then checks the availability, keeps it and logs one line.
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

/**
 * The SECURITY DEFINER functions the application calls as the limited role outside any policy
 * (disclosure, spec §6.6): EXECUTE is revoked from PUBLIC and granted by the sync, so the check
 * tests them by name. A function not created yet is not a missing grant.
 */
const DIRECT_CALL_FUNCTIONS = [
  'data_access_hidden_count(text, uuid)',
  'data_access_hidden_category_count(uuid, uuid[])',
  'data_access_reference(text, uuid)',
  'data_access_can_read(uuid, text, uuid)',
];

type CatalogState = {
  roleExists: boolean;
  inherits: boolean;
  schemaCreateMissing: boolean;
  grantsMissing: boolean;
  policiesMissing: boolean;
  policiesDifferent: boolean;
};

/**
 * The catalog side of the check. Grants: USAGE on `public`; SELECT, INSERT, UPDATE, DELETE on every
 * table, view and foreign table of `public` the application role owns, USAGE and SELECT on every
 * sequence it owns: the relations of `data_access_grant_targets()`, the same list the sync grants
 * on (a relation of another owner is outside the rule "every KANAP table belongs to the application
 * role"). EXECUTE on every function a policy of the role calls (its dependencies in `pg_depend`:
 * the access functions, revoked from PUBLIC when SECURITY DEFINER); without it, every statement of
 * a limited person on that table fails. EXECUTE also on the disclosure functions the application
 * calls directly (DIRECT_CALL_FUNCTIONS). Policies: every expected policy exists, restrictive, on
 * its command and targeting the role (same test as `data_access_apply`), and its body is the
 * expected one: the comment carries `kda:<source fingerprint>:<md5 of the deparsed expressions>`,
 * compared with the fingerprint of `data_access_expected_policies()` and the expressions read now
 * (spec §6.2, lot 5), deparsed by `data_access_policy_deparsed_md5()` under the search path the sync
 * uses. The functions are qualified: the check reads the same whatever the connection's search path.
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
    return {
      roleExists,
      inherits: false,
      schemaCreateMissing,
      grantsMissing: false,
      policiesMissing: false,
      policiesDifferent: false,
    };
  }
  const [state] = await session.query(
    `WITH lim AS (SELECT to_regrole($1) AS oid)
     SELECT
       pg_has_role(current_user, (SELECT oid FROM lim), 'USAGE') AS inherits,
       NOT has_schema_privilege((SELECT oid FROM lim), 'public', 'USAGE')
       OR EXISTS (
         SELECT 1
         FROM public.data_access_grant_targets() t
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
       )
       OR EXISTS (
         SELECT 1
         FROM pg_policy p
         JOIN pg_depend d
           ON d.classid = 'pg_policy'::regclass AND d.objid = p.oid AND d.refclassid = 'pg_proc'::regclass
         WHERE (SELECT oid FROM lim) = ANY (p.polroles)
           AND NOT has_function_privilege((SELECT oid FROM lim), d.refobjid, 'EXECUTE')
       )
       OR EXISTS (
         SELECT 1
         FROM unnest($2::text[]) f(signature)
         WHERE to_regprocedure('public.' || f.signature) IS NOT NULL
           AND NOT has_function_privilege((SELECT oid FROM lim), to_regprocedure('public.' || f.signature)::oid, 'EXECUTE')
       ) AS grants_missing,
       EXISTS (
         SELECT 1
         FROM public.data_access_expected_policies() e
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
       ) AS policies_missing,
       EXISTS (
         SELECT 1
         FROM public.data_access_expected_policies() e
         JOIN pg_policy p ON p.polname = e.policy_name
         JOIN pg_class c ON c.oid = p.polrelid AND c.relname = e.table_name
         JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
         WHERE NOT p.polpermissive
           AND (SELECT oid FROM lim) = ANY (p.polroles)
           AND p.polcmd::text = CASE upper(e.command)
             WHEN 'SELECT' THEN 'r' WHEN 'INSERT' THEN 'a' WHEN 'UPDATE' THEN 'w'
             WHEN 'DELETE' THEN 'd' WHEN 'ALL' THEN '*' END
           AND coalesce(obj_description(p.oid, 'pg_policy'), '') IS DISTINCT FROM
               'kda:' || e.fingerprint || ':' ||
               public.data_access_policy_deparsed_md5(p.oid)
       ) AS policies_different`,
    [DATA_ACCESS_LIMITED_ROLE, DIRECT_CALL_FUNCTIONS],
  );
  return {
    roleExists,
    inherits: state?.inherits === true,
    schemaCreateMissing,
    grantsMissing: state?.grants_missing === true,
    policiesMissing: state?.policies_missing === true,
    policiesDifferent: state?.policies_different === true,
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
  if (state.policiesMissing || state.policiesDifferent) missing.push('policies');
  if (state.grantsMissing) missing.push('grants');
  return { available: missing.length === 0, missing };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `data_access_sync_policies()` in a transaction of its own, under the 5 s lock timeout, then
 * EXECUTE on the functions the application calls directly (DIRECT_CALL_FUNCTIONS, those that
 * exist): the sync of migration 1854500000000 grants only the functions it knows, and a later one
 * (`data_access_can_read`, lot 4) would stay missing on a database where the role came after it.
 */
async function runSync(session: DataAccessSession): Promise<void> {
  await session.inTransaction(async () => {
    await session.query(`SET LOCAL lock_timeout = '${SYNC_LOCK_TIMEOUT}'`);
    await session.query(`SELECT public.data_access_sync_policies()`);
    await session.query(`
      DO $$
      DECLARE v_signature text;
      BEGIN
        FOREACH v_signature IN ARRAY ARRAY[${DIRECT_CALL_FUNCTIONS.map((f) => `'${f}'`).join(', ')}]::text[] LOOP
          IF to_regprocedure('public.' || v_signature) IS NOT NULL THEN
            EXECUTE format('GRANT EXECUTE ON FUNCTION public.%s TO ${DATA_ACCESS_LIMITED_ROLE}', v_signature);
          END IF;
        END LOOP;
      END
      $$`);
  });
}

/**
 * Before the migrations: when the application role inherits the limited role and policies on that
 * role exist, the sync drops them (its inheritance rule), so the migrations never run under them.
 * Nothing to do on a database without the role, the sync function (before lot 1) or such policies.
 * Never throws: a failure is logged, and the sync after the migrations tries again.
 */
export async function releaseInheritedDataAccessPolicies(
  session: DataAccessSession,
  logger: DataAccessLogger = console,
): Promise<'not_needed' | 'done' | 'failed'> {
  try {
    const [state] = await session.query(
      `WITH lim AS (SELECT to_regrole($1) AS oid)
       SELECT to_regprocedure('public.data_access_sync_policies()') IS NOT NULL
              AND (SELECT oid FROM lim) IS NOT NULL
              AND current_user <> $1
              AND pg_has_role(current_user, (SELECT oid FROM lim), 'USAGE')
              AND EXISTS (SELECT 1 FROM pg_policy p WHERE (SELECT oid FROM lim) = ANY (p.polroles)) AS needed`,
      [DATA_ACCESS_LIMITED_ROLE],
    );
    if (state?.needed !== true) return 'not_needed';
    await runSync(session);
    logger.warn(
      `${LOG_PREFIX} the application role inherits ${DATA_ACCESS_LIMITED_ROLE}: its policies were removed before the `
      + 'migrations. Limited persons are refused until it is fixed (infra/scripts/data-access-role.sql, then a restart)',
    );
    return 'done';
  } catch (error) {
    logger.warn(`${LOG_PREFIX} policies of an inherited ${DATA_ACCESS_LIMITED_ROLE} not removed before the migrations (${errorMessage(error)})`);
    return 'failed';
  }
}

/** Before the migrations, on a dedicated connection of `dataSource`. Never throws. */
export async function runDataAccessBeforeMigrations(
  dataSource: DataSource,
  logger: DataAccessLogger = console,
): Promise<void> {
  try {
    await withDedicatedSession(dataSource, (session) => releaseInheritedDataAccessPolicies(session, logger));
  } catch (error) {
    logger.warn(`${LOG_PREFIX} policies of an inherited ${DATA_ACCESS_LIMITED_ROLE} not removed before the migrations (${errorMessage(error)})`);
  }
}

/**
 * The startup routine of the lead process: sync when the role exists and a grant or a policy is
 * missing or different, or the application role inherits it, then check. Never throws: a failed sync or check is logged, and the function stays
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
      if (state.grantsMissing || state.policiesMissing || state.policiesDifferent || state.inherits) {
        try {
          await runSync(session);
          sync = 'done';
          logger.log(state.inherits
            ? `${LOG_PREFIX} policies of ${DATA_ACCESS_LIMITED_ROLE} removed: the application role inherits it`
            : `${LOG_PREFIX} grants and policies of ${DATA_ACCESS_LIMITED_ROLE} synchronised`);
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
  // A check that could not run (it reports nothing missing) is not kept: the next read checks again.
  if (availability.available || availability.missing.length > 0) {
    const entry = entryOf(dataSource);
    entry.value = availability;
    entry.at = Date.now();
  }
  return availability;
}

/**
 * The availability as this process knows it: kept for a minute, then checked again (read-only),
 * one check at a time. Never throws: a check that fails for a technical reason (pool full, timeout)
 * reads as unavailable, with a warning, and is not kept: the next read checks again.
 */
export async function dataAccessAvailability(dataSource: DataSource): Promise<DataAccessAvailability> {
  const entry = entryOf(dataSource);
  if (entry.value && Date.now() - entry.at < AVAILABILITY_TTL_MS) return entry.value;
  if (!entry.pending) {
    entry.pending = withDedicatedSession(dataSource, checkDataAccessAvailability)
      .then(
        (value) => {
          entry.value = value;
          entry.at = Date.now();
          return value;
        },
        (error) => {
          console.warn(`${LOG_PREFIX} availability not checked (${errorMessage(error)}): read as unavailable`);
          return { available: false, missing: [] } as DataAccessAvailability;
        },
      )
      .finally(() => {
        entry.pending = null;
      });
  }
  return entry.pending;
}
