import { DataSource, MigrationExecutor } from 'typeorm';
import { runDataAccessBeforeMigrations } from '../data-access/data-access-availability';
import { withStartupLock } from './cluster/startup-lock';
import { hardenDatabaseRoleBeforeMigrations } from './database-role-safety';

/**
 * The session advisory lock every migration run takes: the image entrypoint
 * (scripts/migrate-and-start.js, `--migrate-only` and the default start) and the API's own start.
 * TypeORM takes no lock of its own, so two runs at once (two pods of a migration Job, a Job and an
 * API started without SKIP_MIGRATIONS during a rolling update) would both apply the same pending
 * migrations: one failed on a catalog conflict, or both applied an idempotent one and recorded it
 * twice. Under the lock they take turns: the later run finds nothing pending. The lock sits on a
 * dedicated connection, released after the run and, failing that, when the connection closes.
 */
export const MIGRATIONS_LOCK = 'kanap:migrations';

export function withMigrationLock<T>(dataSource: DataSource, fn: () => Promise<T>): Promise<T> {
  return withStartupLock(dataSource, MIGRATIONS_LOCK, fn);
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
): Promise<void> {
  await withMigrationLock(dataSource, async () => {
    await hardenDatabaseRoleBeforeMigrations(dataSource);
    await beforeMigrations(dataSource);
    await dataSource.runMigrations({ transaction: dataSource.options.migrationsTransactionMode });
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

/**
 * The start with SKIP_MIGRATIONS on (app.module.ts): the migrations are a separate step. When some
 * are pending, one warning says so before the start goes on; it never throws. On an empty database
 * the start then stops at the first start-up write (the tables are missing) and the process exits:
 * the API serves only once the migration step has run.
 */
export async function warnPendingMigrations(
  dataSource: DataSource,
  warn: (line: string) => void = console.warn,
): Promise<void> {
  try {
    const pending = await pendingMigrationCount(dataSource);
    if (pending > 0) {
      warn(`[migrations] SKIP_MIGRATIONS is on and ${pending} migration(s) are pending: run the migration step `
        + '(node scripts/migrate-and-start.js --migrate-only) first. Until it has run, /health/ready answers 503 '
        + '(on an empty database, the start stops at its first write).');
    }
  } catch (error) {
    warn(`[migrations] SKIP_MIGRATIONS is on; the pending migrations could not be read (${(error as Error)?.message || error})`);
  }
}
