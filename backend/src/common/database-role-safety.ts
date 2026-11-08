import { DataSource, EntityManager, QueryRunner } from 'typeorm';
import { PRODUCT_NAME } from '../config/product';

export type DatabaseRoleSafetyState = {
  currentUser: string;
  isSuperuser: boolean;
  canBypassRls: boolean;
  /** The role that created the cluster (oid 10): PostgreSQL never lets it drop SUPERUSER. */
  isBootstrapRole: boolean;
};

type QueryExecutor = Pick<DataSource | EntityManager | QueryRunner, 'query'>;

function toBoolean(value: boolean | 't' | 'f' | null | undefined): boolean {
  return value === true || value === 't';
}

function formatRoleFlags(state: DatabaseRoleSafetyState): string {
  const flags: string[] = [];
  if (state.isSuperuser) flags.push('SUPERUSER');
  if (state.canBypassRls) flags.push('BYPASSRLS');
  return flags.length > 0 ? flags.join(', ') : 'native RLS enforcement';
}

export function isProtectedDatabaseRole(roleName: string): boolean {
  return roleName === 'postgres' || roleName.startsWith('pg_');
}

/** A protected name, or the bootstrap role whatever its name (POSTGRES_USER of the Docker image). */
function isProtectedState(state: DatabaseRoleSafetyState): boolean {
  return state.isBootstrapRole || isProtectedDatabaseRole(state.currentUser);
}

/** A role name as an SQL identifier, for the commands the messages suggest. */
function quoteRole(roleName: string): string {
  return `"${roleName.replace(/"/g, '""')}"`;
}

export async function getDatabaseRoleSafetyState(
  executor: QueryExecutor,
): Promise<DatabaseRoleSafetyState> {
  const rows = await executor.query(`
    SELECT current_user AS current_user,
           COALESCE(r.rolsuper, false) AS is_superuser,
           COALESCE(r.rolbypassrls, false) AS can_bypass_rls,
           r.oid = 10 AS is_bootstrap_role
    FROM pg_roles r
    WHERE r.rolname = current_user
  `);

  const row = rows?.[0];
  if (!row?.current_user) {
    throw new Error('Unable to determine PostgreSQL role safety for current_user');
  }

  return {
    currentUser: String(row.current_user),
    isSuperuser: toBoolean(row.is_superuser),
    canBypassRls: toBoolean(row.can_bypass_rls),
    isBootstrapRole: toBoolean(row.is_bootstrap_role),
  };
}

export async function assertSafeDatabaseRole(
  executor: QueryExecutor,
  context = 'startup',
): Promise<DatabaseRoleSafetyState> {
  const state = await getDatabaseRoleSafetyState(executor);
  if (!state.isSuperuser && !state.canBypassRls) {
    return state;
  }

  const prefix = `[${context}]`;
  const flags = formatRoleFlags(state);
  if (isProtectedState(state)) {
    throw new Error(
      `${prefix} DATABASE_URL resolves to protected PostgreSQL role "${state.currentUser}" with ${flags}. `
      + `${PRODUCT_NAME} refuses to run with cluster-admin roles because they bypass row-level security. `
      + 'Use a dedicated application role without SUPERUSER or BYPASSRLS.',
    );
  }

  throw new Error(
    `${prefix} DATABASE_URL resolves to PostgreSQL role "${state.currentUser}" with ${flags}. `
    + 'This bypasses tenant isolation. Remove these attributes as a PostgreSQL superuser '
    + `(ALTER ROLE ${quoteRole(state.currentUser)} NOSUPERUSER NOBYPASSRLS) and restart, `
    + 'or update DATABASE_URL to a dedicated application role.',
  );
}

/**
 * Runs before any migration, at each start: the migrations must never run under a role that
 * bypasses row-level security. A protected role stops the start-up. Another role with SUPERUSER or
 * BYPASSRLS is hardened to NOSUPERUSER NOBYPASSRLS, as migration 1844600000000 did once; when
 * PostgreSQL refuses (BYPASSRLS without SUPERUSER), the start-up stops and says what to change.
 * A safe role costs one read.
 */
export async function hardenDatabaseRoleBeforeMigrations(
  executor: QueryExecutor,
  context = 'migrations',
  log: (line: string) => void = console.log,
): Promise<DatabaseRoleSafetyState> {
  const state = await getDatabaseRoleSafetyState(executor);
  if (!state.isSuperuser && !state.canBypassRls) {
    return state;
  }

  const prefix = `[${context}]`;
  const flags = formatRoleFlags(state);
  if (isProtectedState(state)) {
    throw new Error(
      `${prefix} DATABASE_URL resolves to protected PostgreSQL role "${state.currentUser}" with ${flags}. `
      + `${PRODUCT_NAME} runs no migration as a cluster-admin role, because it bypasses row-level security. `
      + 'Create a dedicated application role without SUPERUSER or BYPASSRLS, point DATABASE_URL to it and restart.',
    );
  }

  log(`${prefix} Hardening PostgreSQL role "${state.currentUser}" from ${flags} to NOSUPERUSER NOBYPASSRLS before the migrations`);
  // Only the attributes the role has: PostgreSQL then explains a refusal about that attribute.
  const attributes = [state.isSuperuser ? 'NOSUPERUSER' : '', state.canBypassRls ? 'NOBYPASSRLS' : ''].filter(Boolean).join(' ');
  try {
    await executor.query(`
      DO $$ BEGIN
        EXECUTE format('ALTER ROLE %I ${attributes}', current_user);
      END $$;
    `);
  } catch (error: any) {
    // Another API process starting at the same time may have hardened the role first.
    const now = await getDatabaseRoleSafetyState(executor);
    if (!now.isSuperuser && !now.canBypassRls) {
      log(`${prefix} PostgreSQL role "${now.currentUser}" is ready for native RLS enforcement`);
      return now;
    }
    const reason = [error?.message, error?.detail].filter((part) => typeof part === 'string' && part).join(' ');
    // The code and the driver error stay on the error: a lost connection is retried by the entrypoint.
    throw Object.assign(new Error(
      `${prefix} DATABASE_URL resolves to PostgreSQL role "${state.currentUser}" with ${flags}, `
      + `and ${PRODUCT_NAME} could not remove these attributes (${reason || String(error)}). `
      + `As a PostgreSQL superuser, run ALTER ROLE ${quoteRole(state.currentUser)} NOSUPERUSER NOBYPASSRLS and restart, `
      + 'or point DATABASE_URL to a dedicated application role without them.',
    ), { code: error?.code, driverError: error?.driverError });
  }

  const hardened = await getDatabaseRoleSafetyState(executor);
  if (hardened.isSuperuser || hardened.canBypassRls) {
    throw new Error(
      `${prefix} PostgreSQL role "${hardened.currentUser}" still has ${formatRoleFlags(hardened)} after hardening. `
      + `As a PostgreSQL superuser, run ALTER ROLE ${quoteRole(hardened.currentUser)} NOSUPERUSER NOBYPASSRLS and restart.`,
    );
  }
  log(`${prefix} PostgreSQL role "${hardened.currentUser}" is ready for native RLS enforcement`);
  return hardened;
}
