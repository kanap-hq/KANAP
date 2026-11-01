// @exclusive-db-spec: renames the server-wide role kanap_data_limited and changes its membership inside rolled-back transactions
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { DataSource, QueryRunner } from 'typeorm';
import { DataAccessFoundations1854400000000 } from '../../migrations/1854400000000-data-access-foundations';
import { DataAccessContractPolicies1855400000000 } from '../../migrations/1855400000000-data-access-contract-policies';
import { Onboarding1856010000000 } from '../../migrations/1856010000000-onboarding';
import {
  DataAccessSession,
  checkDataAccessAvailability,
  dataAccessAvailability,
  releaseInheritedDataAccessPolicies,
  runDataAccessStartup,
  synchroniseDataAccess,
} from '../data-access-availability';
import {
  APP_URL,
  LIMITED_ROLE,
  PgClient,
  adminUrlForAppDatabase,
  appRoleName,
  connect,
  roleExists,
} from './data-access-test-helpers';

/**
 * Startup synchronisation and availability (planning/data-scoped-access/spec.md §6.2, §10.6):
 * - grants revoked on a table: the startup routine grants them again, then the function is available;
 * - role missing: no synchronisation, unavailable with `role`;
 * - role inherited by the application role: unavailable with `inheritance`; the step before the
 *   migrations and the startup sync drop every policy on the role;
 * - the synchronisation waits on a lock: after 5 s it gives up, logs one line, never throws, and the
 *   function stays unavailable;
 * - everything in place: available, nothing to synchronise;
 * - a table and a sequence of public owned by another role, with no right for the application
 *   role: the sync, the availability check and the migration's down() then up() skip them.
 *
 * Each scenario runs on an admin connection inside a transaction that is always rolled back, as
 * the application role (`SET LOCAL ROLE`): the routine's own transactions become savepoints, so
 * nothing is ever committed. The role is shared by the whole server: CI runs this spec alone.
 *
 * Needs DATA_ACCESS_ADMIN_DATABASE_URL (a superuser; its database is replaced by the one of
 * DATABASE_URL) and the role installed (infra/scripts/data-access-role.sql); skips otherwise.
 * Locally, against a throwaway server only, never the shared dev server:
 *   DATABASE_URL=postgres://app:app@127.0.0.1:55416/appdb \
 *   DATA_ACCESS_ADMIN_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55416/postgres \
 *   npx ts-node src/data-access/__tests__/data-access-startup.spec.ts
 */

const APP_ROLE = appRoleName();
const AWAY = 'kanap_data_limited_spec_away';

/** The admin connection, inside its outer transaction, as a session: transactions are savepoints. */
function savepointSession(client: PgClient): DataAccessSession {
  let depth = 0;
  return {
    query: async (sql, params) => (await client.query(sql, params as unknown[])).rows,
    inTransaction: async (fn, opts) => {
      const name = `data_access_startup_spec_${depth += 1}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        const result = await fn();
        await client.query(opts?.rollback ? `ROLLBACK TO SAVEPOINT ${name}` : `RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        throw error;
      } finally {
        depth -= 1;
      }
    },
  };
}

function captureLogger() {
  const lines: string[] = [];
  return { lines, logger: { log: (line: string) => lines.push(line), warn: (line: string) => lines.push(line) } };
}

async function inRolledBack(admin: PgClient, fn: () => Promise<void>): Promise<void> {
  await admin.query('BEGIN');
  try {
    await fn();
  } finally {
    await admin.query('ROLLBACK');
  }
}

async function granted(admin: PgClient, table: string): Promise<boolean> {
  const { rows } = await admin.query(
    `SELECT has_table_privilege($1, $2, 'SELECT') AND has_table_privilege($1, $2, 'DELETE') AS granted`,
    [LIMITED_ROLE, table],
  );
  return rows[0].granted === true;
}

async function testEverythingInPlace(admin: PgClient): Promise<void> {
  await inRolledBack(admin, async () => {
    await admin.query(`SET LOCAL ROLE "${APP_ROLE}"`);
    // The role may have been installed after the migrations (the role script spec installs it on
    // a server without it): a first start brings the grants in place.
    const first = await synchroniseDataAccess(savepointSession(admin), captureLogger().logger);
    assert.ok(first.sync === 'done' || first.sync === 'not_needed', `first start: ${first.sync}`);
    const { lines, logger } = captureLogger();
    const outcome = await synchroniseDataAccess(savepointSession(admin), logger);
    assert.equal(outcome.sync, 'not_needed', 'nothing missing: no synchronisation');
    assert.deepEqual(outcome.availability, { available: true, missing: [] });
    assert.deepEqual(lines, ['[DATA-ACCESS] data-scoped access available'], 'one startup line');
  });
  console.log('  everything in place: available, nothing synchronised: OK');
}

async function testGrantsRevoked(admin: PgClient): Promise<void> {
  await inRolledBack(admin, async () => {
    await admin.query(`SET LOCAL ROLE "${APP_ROLE}"`);
    await admin.query(`REVOKE ALL ON companies FROM ${LIMITED_ROLE}`);
    const session = savepointSession(admin);
    assert.deepEqual(await checkDataAccessAvailability(session), { available: false, missing: ['grants'] });

    const { lines, logger } = captureLogger();
    const outcome = await synchroniseDataAccess(session, logger);
    assert.equal(outcome.sync, 'done', 'a missing grant: synchronised');
    assert.equal(await granted(admin, 'companies'), true, 'the grants are back');
    assert.deepEqual(outcome.availability, { available: true, missing: [] });
    assert.equal(lines.length, 2, 'one line for the sync, one for the availability');
  });
  console.log('  grants revoked on a table: granted again at start, available: OK');
}

async function testRoleMissing(admin: PgClient): Promise<void> {
  await inRolledBack(admin, async () => {
    await admin.query(`ALTER ROLE ${LIMITED_ROLE} RENAME TO ${AWAY}`);
    await admin.query(`REVOKE ALL ON companies FROM ${AWAY}`);
    await admin.query(`SET LOCAL ROLE "${APP_ROLE}"`);
    const { lines, logger } = captureLogger();
    const outcome = await synchroniseDataAccess(savepointSession(admin), logger);
    assert.equal(outcome.sync, 'no_role', 'no role: no synchronisation');
    assert.deepEqual(outcome.availability, { available: false, missing: ['role'] });
    const { rows } = await admin.query(`SELECT has_table_privilege($1, 'companies', 'SELECT') AS granted`, [AWAY]);
    assert.equal(rows[0].granted, false, 'nothing granted to the renamed role');
    assert.equal(lines.length, 1, 'one startup line');
    assert.match(lines[0], /not installed/);
  });
  console.log('  role missing: no synchronisation, unavailable (role): OK');
}

async function testRoleInherited(admin: PgClient): Promise<void> {
  const { rows } = await admin.query(`SELECT current_setting('server_version_num')::int >= 160000 AS pg16`);
  await inRolledBack(admin, async () => {
    if (rows[0].pg16) {
      await admin.query(`GRANT ${LIMITED_ROLE} TO "${APP_ROLE}" WITH INHERIT TRUE`);
    } else {
      await admin.query(`ALTER ROLE "${APP_ROLE}" INHERIT`);
    }
    await admin.query(`SET LOCAL ROLE "${APP_ROLE}"`);
    const availability = await checkDataAccessAvailability(savepointSession(admin));
    assert.equal(availability.available, false);
    assert.ok(availability.missing.includes('inheritance'), `inheritance reported: ${availability.missing.join(', ')}`);

    // Before the migrations: the policies on the inherited role go, so no migration runs under them.
    assert.ok(await policiesOnRole(admin) > 0, 'the policies of the limited role exist');
    const { lines, logger } = captureLogger();
    assert.equal(await releaseInheritedDataAccessPolicies(savepointSession(admin), logger), 'done');
    assert.equal(await policiesOnRole(admin), 0, 'before the migrations: every policy on the inherited role dropped');
    assert.equal(lines.length, 1, 'one warning line');
    assert.match(lines[0], /inherits kanap_data_limited: its policies were removed before the migrations/);
    assert.equal(await releaseInheritedDataAccessPolicies(savepointSession(admin), logger), 'not_needed', 'nothing left to remove');
  });
  await inRolledBack(admin, async () => {
    // After the migrations: the startup sync also runs when every policy is in place.
    await setInheritance(admin, rows[0].pg16);
    await admin.query(`SET LOCAL ROLE "${APP_ROLE}"`);
    assert.ok(await policiesOnRole(admin) > 0, 'the policies of the limited role exist');
    const { lines, logger } = captureLogger();
    const result = await synchroniseDataAccess(savepointSession(admin), logger);
    assert.equal(result.sync, 'done', 'the startup sync runs under inheritance');
    assert.equal(await policiesOnRole(admin), 0, 'startup: every policy on the inherited role dropped');
    assert.ok(result.availability.missing.includes('inheritance'));
    assert.ok(lines.some((line) => line.includes('removed: the application role inherits it')), lines.join(' | '));
  });
  await inRolledBack(admin, async () => {
    // Without inheritance, the step before the migrations does nothing.
    await admin.query(`SET LOCAL ROLE "${APP_ROLE}"`);
    const before = await policiesOnRole(admin);
    assert.equal(await releaseInheritedDataAccessPolicies(savepointSession(admin), captureLogger().logger), 'not_needed');
    assert.equal(await policiesOnRole(admin), before, 'no inheritance: the policies stay');
  });
  console.log('  role inherited: unavailable (inheritance), policies dropped before the migrations and at startup: OK');
}

async function setInheritance(admin: PgClient, pg16: boolean): Promise<void> {
  if (pg16) {
    await admin.query(`GRANT ${LIMITED_ROLE} TO "${APP_ROLE}" WITH INHERIT TRUE`);
  } else {
    await admin.query(`ALTER ROLE "${APP_ROLE}" INHERIT`);
  }
}

async function policiesOnRole(admin: PgClient): Promise<number> {
  const { rows } = await admin.query(`SELECT count(*)::int AS n FROM pg_policy WHERE to_regrole($1) = ANY (polroles)`, [LIMITED_ROLE]);
  return rows[0].n;
}

/**
 * Relations of public the application role does not own and has no right on (another
 * application's, created by the admin): the sync, the check, down() and up() leave them alone.
 */
async function testForeignRelations(admin: PgClient): Promise<void> {
  await inRolledBack(admin, async () => {
    await admin.query(`CREATE TABLE data_access_spec_foreign (id int)`);
    await admin.query(`REVOKE ALL ON data_access_spec_foreign FROM PUBLIC`);
    await admin.query(`CREATE SEQUENCE data_access_spec_foreign_seq`);
    await admin.query(`REVOKE ALL ON SEQUENCE data_access_spec_foreign_seq FROM PUBLIC`);
    await admin.query(`SET LOCAL ROLE "${APP_ROLE}"`);
    await admin.query(`SELECT data_access_sync_policies()`);
    assert.deepEqual(
      await checkDataAccessAvailability(savepointSession(admin)),
      { available: true, missing: [] },
      'the sync covers what the application role owns, the check asks for nothing more',
    );

    const queryRunner = {
      query: async (sql: string, params?: unknown[]) => (await admin.query(sql, params)).rows,
    } as unknown as QueryRunner;
    const migration = new DataAccessFoundations1854400000000();
    // Lot 5 policies and triggers depend on contracts.cost_center_id, and the onboarding tables'
    // keys on users (tenant_id, id): both are reverted first, as a real down chain would, then
    // migrated again after lot 1.
    const lotFive = new DataAccessContractPolicies1855400000000();
    const onboarding = new Onboarding1856010000000();
    await onboarding.down(queryRunner);
    await lotFive.down(queryRunner);
    await migration.down(queryRunner);
    const { rows: down } = await admin.query(
      `SELECT count(*)::int AS n FROM pg_class c, aclexplode(c.relacl) a
       WHERE c.relnamespace = 'public'::regnamespace AND a.grantee = to_regrole($1)`,
      [LIMITED_ROLE],
    );
    assert.equal(down[0].n, 0, 'down() revoked the grants of the limited role');
    await migration.up(queryRunner);
    await lotFive.up(queryRunner);
    await onboarding.up(queryRunner);
    assert.equal(await granted(admin, 'companies'), true, 'up() granted again');
    assert.deepEqual(await checkDataAccessAvailability(savepointSession(admin)), { available: true, missing: [] });
    const { rows } = await admin.query(
      `SELECT has_table_privilege($1, 'data_access_spec_foreign', 'SELECT') AS t,
              has_sequence_privilege($1, 'data_access_spec_foreign_seq', 'USAGE') AS s`,
      [LIMITED_ROLE],
    );
    assert.deepEqual(rows[0], { t: false, s: false }, 'the relations of another owner are left alone');
  });
  console.log('  relations of another owner: sync, check, down() and up() skip them: OK');
}

/**
 * GRANT does not wait on a table lock: it waits on the catalog row of a table another transaction
 * changed. The holder takes the table in ACCESS EXCLUSIVE mode and changes its grants, as a
 * concurrent migration would, and keeps its transaction open.
 */
async function testLockTimeout(admin: PgClient, holder: PgClient): Promise<void> {
  await holder.query('BEGIN');
  try {
    await holder.query('LOCK TABLE companies IN ACCESS EXCLUSIVE MODE');
    await holder.query(`GRANT SELECT ON companies TO ${LIMITED_ROLE}`);
    await inRolledBack(admin, async () => {
      await admin.query(`SET LOCAL ROLE "${APP_ROLE}"`);
      await admin.query(`REVOKE ALL ON currencies FROM ${LIMITED_ROLE}`);
      const { lines, logger } = captureLogger();
      const started = Date.now();
      const outcome = await synchroniseDataAccess(savepointSession(admin), logger);
      const elapsed = Date.now() - started;
      assert.equal(outcome.sync, 'failed', 'the lock timeout fails the synchronisation');
      assert.ok(elapsed >= 4500 && elapsed < 30000, `gave up after the 5 s lock timeout (${elapsed} ms)`);
      assert.deepEqual(outcome.availability, { available: false, missing: ['grants'] });
      assert.equal(lines.length, 2);
      assert.match(lines[0], /lock timeout/);
      assert.match(lines[0], /retried at next start/);
    });
  } finally {
    await holder.query('ROLLBACK');
  }
  console.log('  lock timeout: logged, unavailable, no throw: OK');
}

/**
 * The production path: a dedicated connection of the application's pool, then the kept value.
 * This one commits: at most the grants a start would add (the role exists, checked above).
 */
async function testStartupOnDataSource(): Promise<void> {
  const dataSource = new DataSource({ type: 'postgres', url: APP_URL });
  await dataSource.initialize();
  try {
    const { lines, logger } = captureLogger();
    // As a start would, it commits the grants when the role came after the migrations.
    const availability = await runDataAccessStartup(dataSource, logger);
    assert.deepEqual(availability, { available: true, missing: [] });
    assert.equal(lines[lines.length - 1], '[DATA-ACCESS] data-scoped access available');
    assert.ok(lines.length === 1 || /synchronised$/.test(lines[0]), lines.join(' | '));
    assert.equal(await dataAccessAvailability(dataSource), availability, 'kept in memory');
  } finally {
    await dataSource.destroy();
  }
  console.log('  startup on the application pool: available, kept: OK');
}

async function main(): Promise<void> {
  const adminUrl = adminUrlForAppDatabase();
  if (!adminUrl) {
    console.log('data-access-startup.spec: skipped (DATA_ACCESS_ADMIN_DATABASE_URL not set)');
    return;
  }
  const admin = await connect(adminUrl);
  const holder = await connect(adminUrl);
  try {
    if (!(await roleExists(admin))) {
      console.log(`data-access-startup.spec: skipped (role ${LIMITED_ROLE} not installed)`);
      return;
    }
    const { rows } = await admin.query(`SELECT to_regclass('currencies') IS NOT NULL AS present`);
    assert.equal(rows[0].present, true, 'the currencies table exists');
    await testEverythingInPlace(admin);
    await testGrantsRevoked(admin);
    await testRoleMissing(admin);
    await testRoleInherited(admin);
    await testForeignRelations(admin);
    await testLockTimeout(admin, holder);
    await testStartupOnDataSource();
    assert.equal(await roleExists(admin), true, 'the role is still in place');
    console.log('data-access-startup.spec: all passed');
  } finally {
    await holder.end();
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
