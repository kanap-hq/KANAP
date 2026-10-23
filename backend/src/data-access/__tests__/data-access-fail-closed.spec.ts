// @exclusive-db-spec: renames the server-wide role kanap_data_limited and changes its membership inside rolled-back transactions
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import {
  LIMITED_ROLE,
  PgClient,
  adminUrlForAppDatabase,
  appRoleName,
  connect,
  roleExists,
  seedPerson,
  seedRole,
  seedTree,
  sqlState,
} from './data-access-test-helpers';
import { LABELS, applyPerson, nextItemNumber, seed as seedLines } from './data-access-line-seed';

/**
 * Data-scoped access fails closed (planning/data-scoped-access/spec.md §2.6, §6.3, §10.6): with the
 * limited role missing or inherited by the application role, a limited person is refused with
 * KDA01; the sync does nothing without the role, and drops every policy on it when inherited, so
 * the persons without scope keep everything.
 *
 * Each scenario runs on an admin connection inside a transaction that is always rolled back:
 * `ALTER ROLE ... RENAME` and the membership change are transactional, so nothing is ever
 * committed; `SET ROLE <app role>` then calls the functions as the application role. The role is
 * shared by the whole server: CI runs this spec alone (exclusive).
 *
 * Needs DATA_ACCESS_ADMIN_DATABASE_URL (a superuser; its database is replaced by the one of
 * DATABASE_URL) and the role installed (infra/scripts/data-access-role.sql); skips otherwise.
 * Locally, against a throwaway server only, never the shared dev server:
 *   DATABASE_URL=postgres://app:app@127.0.0.1:55416/appdb \
 *   DATA_ACCESS_ADMIN_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55416/postgres \
 *   npx ts-node src/data-access/__tests__/data-access-fail-closed.spec.ts
 */

const APP_ROLE = appRoleName();
const AWAY = 'kanap_data_limited_spec_away';

async function limitedPerson(admin: PgClient): Promise<string> {
  const tree = await seedTree(admin);
  const roleId = await seedRole(admin, tree.tenantId, 'Reader');
  return seedPerson(admin, tree.tenantId, 'limited', roleId);
}

async function inRolledBack(admin: PgClient, fn: () => Promise<void>): Promise<void> {
  await admin.query('BEGIN');
  try {
    await fn();
  } finally {
    await admin.query('ROLLBACK');
  }
}

async function testRoleMissing(admin: PgClient): Promise<void> {
  await inRolledBack(admin, async () => {
    await admin.query(`ALTER ROLE ${LIMITED_ROLE} RENAME TO ${AWAY}`);
    await admin.query(`SET LOCAL ROLE "${APP_ROLE}"`);
    const person = await limitedPerson(admin);
    await admin.query('SAVEPOINT apply');
    assert.equal(await sqlState(() => admin.query(`SELECT data_access_apply($1)`, [person])), 'KDA01', 'role missing: KDA01');
    await admin.query('ROLLBACK TO SAVEPOINT apply');

    // The sync does nothing without the role: a table it would have covered stays uncovered.
    await admin.query(`CREATE TABLE data_access_spec_probe (id int)`);
    await admin.query(`REVOKE ALL ON data_access_spec_probe FROM ${AWAY}`);
    await admin.query(`SELECT data_access_sync_policies()`);
    const { rows } = await admin.query(`SELECT has_table_privilege($1, 'data_access_spec_probe', 'SELECT') AS granted`, [AWAY]);
    assert.equal(rows[0].granted, false, 'role missing: the sync grants nothing');
  });
  console.log('  role missing: limited person refused, sync does nothing: OK');
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
 * The application role inherits the limited role (§10.6: detected, function unavailable, nothing
 * broken for the persons without scope). The policies on the role then apply to the application
 * role itself, without context, and hide every line from everyone; the sync drops them and creates
 * none, so an unscoped person reads and writes as before and a limited one is refused (KDA01).
 */
async function testRoleInherited(admin: PgClient): Promise<void> {
  const { rows } = await admin.query(`SELECT current_setting('server_version_num')::int >= 160000 AS pg16`);
  await inRolledBack(admin, async () => {
    // The lines first, as the application role: the data exists before the membership changes.
    await admin.query(`SET LOCAL ROLE "${APP_ROLE}"`);
    const s = await seedLines(admin);
    await admin.query('RESET ROLE');
    await setInheritance(admin, rows[0].pg16);
    await admin.query(`SET LOCAL ROLE "${APP_ROLE}"`);
    const { rows: inherit } = await admin.query(`SELECT pg_has_role(current_user, $1, 'USAGE') AS inherits`, [LIMITED_ROLE]);
    assert.equal(inherit[0].inherits, true, 'the scenario makes the application role inherit');
    assert.ok(await policiesOnRole(admin) > 0, 'the policies of the limited role exist');
    const count = async () => (await admin.query(`SELECT count(*)::int AS n FROM spend_items`)).rows[0].n;
    assert.equal(await count(), 0, 'inherited policies: the application role sees no line (the failure the sync removes)');

    await admin.query(`SELECT data_access_sync_policies()`);
    assert.equal(await policiesOnRole(admin), 0, 'role inherited: the sync drops every policy on the role and creates none');

    assert.equal(await applyPerson(admin, s.persons.ulla), 'all', 'unscoped person: everything');
    assert.equal(await count(), LABELS.length, 'unscoped person: every line');
    assert.equal((await admin.query(`SELECT count(*)::int AS n FROM spend_versions`)).rows[0].n, LABELS.length, 'unscoped person: every version');
    const updated = await admin.query(`UPDATE spend_items SET description = 'checked' RETURNING id`);
    assert.equal(updated.rows.length, LABELS.length, 'unscoped person: updates every line');
    await admin.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number)
       VALUES (app_current_tenant(), 'Created under inheritance', 'EUR', '2026-01-01', $1)`,
      [nextItemNumber()],
    );
    assert.equal(await count(), LABELS.length + 1, 'unscoped person: creates a line');

    await admin.query('SAVEPOINT apply');
    assert.equal(await sqlState(() => admin.query(`SELECT data_access_apply($1)`, [s.persons.marta])), 'KDA01', 'role inherited: KDA01');
    await admin.query('ROLLBACK TO SAVEPOINT apply');
  });
  console.log(`  role inherited (${rows[0].pg16 ? 'membership INHERIT TRUE' : 'ALTER ROLE INHERIT'}): sync drops the policies, unscoped person served, limited person refused: OK`);
}

async function run(): Promise<void> {
  const adminUrl = adminUrlForAppDatabase();
  if (!adminUrl) {
    console.log('data access fail closed: DATA_ACCESS_ADMIN_DATABASE_URL not set, skipped');
    return;
  }
  const admin = await connect(adminUrl);
  try {
    if (!(await roleExists(admin))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} (infra/scripts/data-access-role.sql)`);
      console.log(`data access fail closed: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access fail closed');
    await testRoleMissing(admin);
    await testRoleInherited(admin);
    assert.equal(await roleExists(admin), true, 'the role is back after the rollbacks');
    console.log('data access fail closed: all scenarios passed');
  } finally {
    await admin.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
