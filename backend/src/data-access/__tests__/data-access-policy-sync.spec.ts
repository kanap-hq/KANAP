// @exclusive-db-spec: drops data-access policies and revokes EXECUTE from the server-wide role kanap_data_limited, and commits one policy drop on its own database
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { DataSource } from 'typeorm';
import {
  DataAccessSession,
  checkDataAccessAvailability,
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
  seedPerson,
  seedRole,
  seedTree,
  sqlStateIn,
} from './data-access-test-helpers';

/**
 * Fail closed with the real policy list (planning/data-scoped-access/spec.md §6.2, §10.6):
 * - one expected policy missing: a limited person is refused with KDA01, an unscoped person is
 *   served; the availability reports `policies` and the startup routine creates it again;
 * - a policy drop committed on this spec's own database: the startup routine on the application
 *   pool recreates it;
 * - EXECUTE missing on a function the policies call (a SECURITY DEFINER access function, and one
 *   PUBLIC holds by default): a limited person's statement fails, the availability reports
 *   `grants` and the startup routine grants it again.
 *
 * The first and third scenarios run on an admin connection inside a transaction that is always
 * rolled back, as the application role (`SET LOCAL ROLE`). The second commits on the database of
 * DATABASE_URL (the lane copy in CI) and restores it in any case. CI runs this spec alone.
 *
 * Needs DATA_ACCESS_ADMIN_DATABASE_URL (a superuser; its database is replaced by the one of
 * DATABASE_URL) and the role installed (infra/scripts/data-access-role.sql); skips otherwise.
 * Locally, against a throwaway server only, never the shared dev server:
 *   DATABASE_URL=postgres://app:app@127.0.0.1:55490/appdb \
 *   DATA_ACCESS_ADMIN_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55490/postgres \
 *   npx ts-node src/data-access/__tests__/data-access-policy-sync.spec.ts
 */

const APP_ROLE = appRoleName();
const DROPPED = { table: 'spend_items', policy: 'spend_items_data_access_select' };
const COMMITTED = { table: 'tasks', policy: 'tasks_data_access_update' };

/** The admin connection, inside its outer transaction, as a session: transactions are savepoints. */
function savepointSession(client: PgClient): DataAccessSession {
  let depth = 0;
  return {
    query: async (sql, params) => (await client.query(sql, params as unknown[])).rows,
    inTransaction: async (fn, opts) => {
      const name = `data_access_policy_sync_spec_${depth += 1}`;
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

const silent = { log: () => undefined, warn: () => undefined };

async function inRolledBack(admin: PgClient, fn: () => Promise<void>): Promise<void> {
  await admin.query('BEGIN');
  try {
    await fn();
  } finally {
    await admin.query('ROLLBACK');
  }
}

async function policyPresent(client: PgClient, table: string, policy: string): Promise<boolean> {
  const { rows } = await client.query(
    `SELECT EXISTS (
       SELECT 1 FROM pg_policy p
       WHERE p.polrelid = to_regclass($1) AND p.polname = $2 AND NOT p.polpermissive
         AND to_regrole($3) = ANY (p.polroles)
     ) AS present`,
    [`public.${table}`, policy, LIMITED_ROLE],
  );
  return rows[0].present === true;
}

/** A tenant with a limited person (no node: nothing readable) and an unscoped one, as the app role. */
async function seedPersons(admin: PgClient): Promise<{ limited: string; unscoped: string }> {
  const tree = await seedTree(admin);
  const roleId = await seedRole(admin, tree.tenantId, 'Reader');
  return {
    limited: await seedPerson(admin, tree.tenantId, 'limited', roleId),
    unscoped: await seedPerson(admin, tree.tenantId, 'all', roleId),
  };
}

async function testPolicyMissing(admin: PgClient): Promise<void> {
  await inRolledBack(admin, async () => {
    await admin.query(`SET LOCAL ROLE "${APP_ROLE}"`);
    const persons = await seedPersons(admin);
    const session = savepointSession(admin);
    assert.deepEqual(await checkDataAccessAvailability(session), { available: true, missing: [] }, 'in place before the drop');

    await admin.query(`DROP POLICY ${DROPPED.policy} ON ${DROPPED.table}`);
    assert.equal(
      await sqlStateIn(admin, () => admin.query(`SELECT data_access_apply($1)`, [persons.limited])),
      'KDA01',
      'a policy missing: the limited person is refused',
    );
    await admin.query('SAVEPOINT unscoped');
    const { rows } = await admin.query(`SELECT data_access_apply($1) AS mode, current_user AS role`, [persons.unscoped]);
    assert.deepEqual(rows[0], { mode: 'all', role: APP_ROLE }, 'a policy missing: the unscoped person is served');
    await admin.query(`SELECT count(*) FROM spend_items`);
    await admin.query('ROLLBACK TO SAVEPOINT unscoped');

    assert.deepEqual(await checkDataAccessAvailability(session), { available: false, missing: ['policies'] });
    const outcome = await synchroniseDataAccess(session, silent);
    assert.equal(outcome.sync, 'done', 'a missing policy: synchronised at start');
    assert.deepEqual(outcome.availability, { available: true, missing: [] });
    assert.equal(await policyPresent(admin, DROPPED.table, DROPPED.policy), true, 'the policy is back');
    const { rows: limited } = await admin.query(`SELECT data_access_apply($1) AS mode`, [persons.limited]);
    assert.equal(limited[0].mode, 'limited', 'the limited person is served again');
  });
  console.log('  one policy missing: limited refused (KDA01), unscoped served, recreated at start: OK');
}

/** The production path: the drop is committed, then the startup routine runs on the application pool. */
async function testCommittedDrop(admin: PgClient): Promise<void> {
  await admin.query(`DROP POLICY ${COMMITTED.policy} ON ${COMMITTED.table}`);
  try {
    assert.equal(await policyPresent(admin, COMMITTED.table, COMMITTED.policy), false, 'the drop is committed');
    const dataSource = new DataSource({ type: 'postgres', url: APP_URL });
    await dataSource.initialize();
    try {
      const lines: string[] = [];
      const availability = await runDataAccessStartup(dataSource, { log: (l) => lines.push(l), warn: (l) => lines.push(l) });
      assert.deepEqual(availability, { available: true, missing: [] });
      assert.match(lines[0] ?? '', /synchronised$/, lines.join(' | '));
    } finally {
      await dataSource.destroy();
    }
    assert.equal(await policyPresent(admin, COMMITTED.table, COMMITTED.policy), true, 'the startup routine recreated it');
  } finally {
    if (!(await policyPresent(admin, COMMITTED.table, COMMITTED.policy))) {
      await admin.query(`SET ROLE "${APP_ROLE}"`);
      await admin.query(`SELECT data_access_sync_policies()`);
      await admin.query('RESET ROLE');
    }
  }
  console.log('  policy drop committed: recreated by the startup routine on the application pool: OK');
}

async function hasExecute(client: PgClient, signature: string): Promise<boolean> {
  const { rows } = await client.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS granted`, [LIMITED_ROLE, signature]);
  return rows[0].granted === true;
}

async function testExecuteMissing(admin: PgClient): Promise<void> {
  const definer = 'data_access_task_visible(uuid)';
  const invoker = 'data_access_placable_line(uuid, uuid)';
  await inRolledBack(admin, async () => {
    await admin.query(`SET LOCAL ROLE "${APP_ROLE}"`);
    const persons = await seedPersons(admin);
    const session = savepointSession(admin);
    await admin.query(`REVOKE EXECUTE ON FUNCTION ${definer} FROM ${LIMITED_ROLE}`);
    assert.equal(await hasExecute(admin, definer), false, 'the scenario revokes EXECUTE');

    // Without it, a statement of a limited person on a table whose policy calls it fails.
    await admin.query('SAVEPOINT limited');
    await admin.query(`SELECT data_access_apply($1)`, [persons.limited]);
    assert.equal(
      await sqlStateIn(admin, () => admin.query(`SELECT count(*) FROM task_attachments`)),
      '42501',
      'EXECUTE missing: the statement fails',
    );
    await admin.query('ROLLBACK TO SAVEPOINT limited');

    assert.deepEqual(await checkDataAccessAvailability(session), { available: false, missing: ['grants'] });
    const outcome = await synchroniseDataAccess(session, silent);
    assert.equal(outcome.sync, 'done', 'EXECUTE missing: synchronised at start');
    assert.deepEqual(outcome.availability, { available: true, missing: [] });
    assert.equal(await hasExecute(admin, definer), true, 'EXECUTE granted again');

    // A function the role reaches through PUBLIC: revoked from PUBLIC, the sync grants it directly.
    await admin.query(`REVOKE EXECUTE ON FUNCTION ${invoker} FROM PUBLIC`);
    assert.equal(await hasExecute(admin, invoker), false, 'the scenario removes the PUBLIC grant');
    assert.deepEqual(await checkDataAccessAvailability(session), { available: false, missing: ['grants'] });
    const again = await synchroniseDataAccess(session, silent);
    assert.equal(again.sync, 'done');
    assert.deepEqual(again.availability, { available: true, missing: [] });
    assert.equal(await hasExecute(admin, invoker), true, 'EXECUTE granted to the role');

    // A disclosure function the application calls directly, outside any policy.
    for (const direct of ['data_access_hidden_count(text, uuid)', 'data_access_reference(text, uuid)', 'data_access_can_read(uuid, text, uuid)']) {
      await admin.query(`REVOKE EXECUTE ON FUNCTION ${direct} FROM ${LIMITED_ROLE}`);
      assert.equal(await hasExecute(admin, direct), false, `the scenario revokes EXECUTE on ${direct}`);
      assert.deepEqual(await checkDataAccessAvailability(session), { available: false, missing: ['grants'] }, `${direct}: grants missing`);
      const restored = await synchroniseDataAccess(session, silent);
      assert.equal(restored.sync, 'done');
      assert.deepEqual(restored.availability, { available: true, missing: [] });
      assert.equal(await hasExecute(admin, direct), true, `EXECUTE on ${direct} granted again`);
    }
  });
  console.log('  EXECUTE missing on a function the policies or the application call: statement refused, granted again at start: OK');
}

async function main(): Promise<void> {
  const adminUrl = adminUrlForAppDatabase();
  if (!adminUrl) {
    console.log('data-access-policy-sync.spec: skipped (DATA_ACCESS_ADMIN_DATABASE_URL not set)');
    return;
  }
  const admin = await connect(adminUrl);
  try {
    if (!(await roleExists(admin))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} (infra/scripts/data-access-role.sql)`);
      console.log(`data-access-policy-sync.spec: skipped (role ${LIMITED_ROLE} not installed)`);
      return;
    }
    // The role may have been installed after the migrations: a first start brings everything in place.
    await admin.query(`SET ROLE "${APP_ROLE}"`);
    await admin.query(`SELECT data_access_sync_policies()`);
    await admin.query('RESET ROLE');
    const { rows } = await admin.query(`SELECT count(*)::int AS n FROM data_access_expected_policies()`);
    assert.ok(rows[0].n > 0, 'the expected list is not empty');
    assert.equal(await policyPresent(admin, DROPPED.table, DROPPED.policy), true);

    await testPolicyMissing(admin);
    await testCommittedDrop(admin);
    await testExecuteMissing(admin);
    assert.equal(await policyPresent(admin, DROPPED.table, DROPPED.policy), true, 'nothing left dropped');
    console.log('data-access-policy-sync.spec: all passed');
  } finally {
    await admin.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
