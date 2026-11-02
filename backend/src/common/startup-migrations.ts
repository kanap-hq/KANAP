import { DataSource } from 'typeorm';
import { runDataAccessBeforeMigrations } from '../data-access/data-access-availability';
import { hardenDatabaseRoleBeforeMigrations } from './database-role-safety';

/**
 * The migrations the API runs at start (app.module.ts, data source factory), on the connected data
 * source. The role is checked first (a protected role stops here, another role with SUPERUSER or
 * BYPASSRLS is hardened), then the data-access guard removes the policies of a limited role the
 * application role inherits: no migration runs without row-level security or under those
 * policies. The image entrypoint runs the same steps (scripts/migrate-and-start.js).
 */
export async function runStartupMigrations(
  dataSource: DataSource,
  beforeMigrations: (dataSource: DataSource) => Promise<void> = runDataAccessBeforeMigrations,
): Promise<void> {
  await hardenDatabaseRoleBeforeMigrations(dataSource);
  await beforeMigrations(dataSource);
  await dataSource.runMigrations({ transaction: dataSource.options.migrationsTransactionMode });
}
