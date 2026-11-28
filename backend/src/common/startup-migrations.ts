import { DataSource, Migration, MigrationExecutor, QueryRunner } from 'typeorm';
import { runDataAccessBeforeMigrations } from '../data-access/data-access-availability';
import { isLeadProcess } from './cluster/process-role';
import { withStartupLock } from './cluster/startup-lock';
import { hardenDatabaseRoleBeforeMigrations } from './database-role-safety';

/**
 * The session advisory lock every migration run takes: the image entrypoint
 * (scripts/migrate-and-start.js, `--migrate-only` and the default start) and the API's own start.
 * TypeORM takes no lock of its own, so two runs at once (two pods of a migration Job, a Job and an
 * API started without SKIP_MIGRATIONS during a rolling update) would both apply the same pending
 * migrations: one failed on a catalog conflict, or both applied an idempotent one and recorded it
 * twice. Under the lock they take turns: the later run finds nothing pending.
 *
 * The migrations run on the connection that holds the lock (`runPendingMigrations`): if that
 * session ends (idle_session_timeout, pg_terminate_backend, a lost network), the migration
 * transaction ends with it and rolls back, so no other run migrates while one still does. The lock
 * is released after the run and, failing that, when the connection closes. A run that finds the
 * lock taken says so in one line (`onWait`), then waits for it, with no time limit of its own.
 */
export const MIGRATIONS_LOCK = 'kanap:migrations';

export const migrationLockWaitLine = (prefix: string) =>
  `${prefix} Another instance holds the migration lock, waiting...`;

export function withMigrationLock<T>(
  dataSource: DataSource,
  fn: (lockConnection: QueryRunner) => Promise<T>,
  onWait: () => void = () => console.log(migrationLockWaitLine('[migrations]')),
): Promise<T> {
  return withStartupLock(dataSource, MIGRATIONS_LOCK, fn, onWait);
}

/**
 * Runs the pending migrations on `lockConnection`, the connection `withMigrationLock` holds the
 * lock on, in the data source's transaction mode (TypeORM's default: all of them in one
 * transaction). The image entrypoint calls it too (compiled, from dist/).
 */
export function runPendingMigrations(dataSource: DataSource, lockConnection: QueryRunner): Promise<Migration[]> {
  const executor = new MigrationExecutor(dataSource, lockConnection);
  executor.transaction = dataSource.options.migrationsTransactionMode ?? 'all';
  return executor.executePendingMigrations();
}

/**
 * The migrations the API runs at start (app.module.ts, data source factory), on the connected data
 * source, under the migration lock. The role is checked first (a protected role stops here, another
 * role with SUPERUSER or BYPASSRLS is hardened), then the data-access guard removes the policies of a
 * limited role the application role inherits: no migration runs without row-level security or under
 * those policies. The image entrypoint runs the same steps (scripts/migrate-and-start.js).
 */
export async function runStartupMigrations(
  dataSource: DataSource,
  beforeMigrations: (dataSource: DataSource) => Promise<void> = runDataAccessBeforeMigrations,
  migrate: (dataSource: DataSource, lockConnection: QueryRunner) => Promise<Migration[]> = runPendingMigrations,
): Promise<Migration[]> {
  return withMigrationLock(dataSource, async (lockConnection) => {
    await hardenDatabaseRoleBeforeMigrations(dataSource);
    await beforeMigrations(dataSource);
    return migrate(dataSource, lockConnection);
  });
}

/**
 * How many migrations of this build the database has not run. Reads only: TypeORM's
 * `showMigrations()` would create the `migrations` table when it is missing, this reads it when it
 * exists (an empty database: every migration is pending).
 */
export async function pendingMigrationCount(dataSource: DataSource): Promise<number> {
  return (await new MigrationExecutor(dataSource).getPendingMigrations()).length;
}

/** How many migrations the database recorded, and how many of this build it has not run (reads only). */
async function migrationCounts(dataSource: DataSource): Promise<{ executed: number; pending: number }> {
  const executor = new MigrationExecutor(dataSource);
  const executed = (await executor.getExecutedMigrations()).length;
  return { executed, pending: (await executor.getPendingMigrations()).length };
}

/** The line of an API started with SKIP_MIGRATIONS on a database no migration ever ran on. */
export const NO_SCHEMA_LINE = '[migrations] SKIP_MIGRATIONS is on and the database has no schema: no migration has ever run on it. '
  + 'Run the migration step first (node scripts/migrate-and-start.js --migrate-only, or npm run migrate). The API stops.';

/**
 * The start with SKIP_MIGRATIONS on (app.module.ts, every API process): the migrations are a
 * separate step.
 * - No migration has ever run on the database (the `migrations` table is missing or empty): one
 *   line says so and the process exits 1, before any start-up write, with no stack.
 * - Some are pending: one warning gives their number, and the start goes on; /health/ready answers
 *   503 until the migration step has run.
 * Only the lead process writes (the single process, or worker 1): one line whatever the number of
 * workers. A failure to read the migrations is a warning, never a stop.
 */
export async function warnPendingMigrations(
  dataSource: DataSource,
  {
    env = process.env,
    warn = console.warn,
    error = console.error,
    exit = (code: number) => process.exit(code),
    readMigrations = migrationCounts,
  }: {
    env?: NodeJS.ProcessEnv;
    warn?: (line: string) => void;
    error?: (line: string) => void;
    exit?: (code: number) => void;
    readMigrations?: (dataSource: DataSource) => Promise<{ executed: number; pending: number }>;
  } = {},
): Promise<void> {
  const lead = isLeadProcess(env);
  let executed: number;
  let pending: number;
  try {
    ({ executed, pending } = await readMigrations(dataSource));
  } catch (failure) {
    if (lead) warn(`[migrations] SKIP_MIGRATIONS is on; the pending migrations could not be read (${(failure as Error)?.message || failure})`);
    return;
  }
  if (executed === 0) {
    if (lead) error(NO_SCHEMA_LINE);
    exit(1);
    return;
  }
  if (pending > 0 && lead) {
    warn(`[migrations] SKIP_MIGRATIONS is on and ${pending} migration(s) are pending: run the migration step `
      + '(node scripts/migrate-and-start.js --migrate-only) first. Until it has run, /health/ready answers 503.');
  }
}
