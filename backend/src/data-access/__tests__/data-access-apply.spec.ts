// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import { DataAccessFoundations1854400000000 } from '../../migrations/1854400000000-data-access-foundations';
import {
  APP_URL,
  LIMITED_ROLE,
  PgClient,
  appRoleName,
  connect,
  parseUuidArray,
  readSettings,
  roleExists,
  seedNodes,
  seedPerson,
  seedRole,
  seedTree,
  sorted,
  sqlStateIn,
} from './data-access-test-helpers';

/**
 * Data-scoped access, lot 1 (planning/data-scoped-access/spec.md §6.2, §6.3, §10.2, §10.6):
 * `data_access_apply`, `data_access_ctx`, `data_access_sync_policies` and the catalog rules, run as
 * the application role (DATABASE_URL), every scenario in a transaction rolled back (one commits a
 * transaction that writes nothing).
 *
 * With the role kanap_data_limited installed (CI, or infra/scripts/data-access-role.sql), every
 * scenario runs. Without it (a dev database before the script), the scenarios that need the role
 * are skipped and a limited person must be refused with KDA01; in CI a missing role fails.
 * The scenarios that rename the role or change the membership are in
 * data-access-fail-closed.spec.ts (exclusive).
 */

let client: PgClient;
let hasRole = false;
const APP_ROLE = appRoleName();

async function inTransaction(fn: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

async function apply(userId: string): Promise<string> {
  const { rows } = await client.query(`SELECT data_access_apply($1) AS mode`, [userId]);
  return rows[0].mode;
}

async function currentUser(): Promise<string> {
  const { rows } = await client.query(`SELECT current_user AS u`);
  return rows[0].u;
}

async function jit(): Promise<string> {
  const { rows } = await client.query(`SELECT current_setting('jit') AS v`);
  return rows[0].v;
}

async function ctx(): Promise<any> {
  const { rows } = await client.query(`SELECT data_access_ctx() AS c`);
  return rows[0].c;
}

function assertNoSettings(settings: Record<string, string | null>, label: string): void {
  for (const [name, value] of Object.entries(settings)) {
    assert.ok(value === null || value === '', `${label}: ${name} is not set (got ${value})`);
  }
}

async function testExpansion(): Promise<void> {
  await inTransaction(async () => {
    const tree = await seedTree(client);
    const { c1, c2 } = tree.companies;
    const { g1, g1a, k1, k2, k3, k4, k5 } = tree.nodes;
    const roleId = await seedRole(client, tree.tenantId, 'Budget reader');
    const p = await seedPerson(client, tree.tenantId, 'limited', roleId);
    await seedNodes(client, tree.tenantId, p, [
      { type: 'company', id: c1, access: 'read' },
      { type: 'cost_center', id: g1a, access: 'edit' },
      { type: 'cost_center', id: k5, access: 'read' },
    ]);
    const q = await seedPerson(client, tree.tenantId, 'limited', roleId);
    await seedNodes(client, tree.tenantId, q, [
      { type: 'cost_center', id: g1, access: 'read' },
      { type: 'company', id: c2, access: 'edit' },
    ]);

    assert.equal(await apply(p), 'limited');
    assert.equal(await currentUser(), LIMITED_ROLE, 'the transaction runs as the limited role');
    assert.equal(await jit(), 'off', 'jit is off in a limited transaction');
    let s = await readSettings(client);
    assert.equal(s['app.da_mode'], 'limited');
    assert.equal(s['app.da_user'], p);
    assert.equal(s['app.da_read_all'], 'false');
    assert.equal(s['app.da_edit_all'], 'false');
    // Company node: the company, and its centres whatever their group.
    assert.deepEqual(parseUuidArray(s['app.da_read_companies']), [c1]);
    assert.deepEqual(parseUuidArray(s['app.da_edit_companies']), []);
    // Group: itself, its subgroups and their centres; centre: itself; edit nodes also read.
    assert.deepEqual(parseUuidArray(s['app.da_read_nodes']), sorted([k1, k4, g1a, k3, k5]));
    assert.deepEqual(parseUuidArray(s['app.da_edit_nodes']), sorted([g1a, k3]));
    assert.deepEqual(parseUuidArray(s['app.da_edit_node_companies']), [c2]);
    const c = await ctx();
    assert.equal(c.mode, 'limited');
    assert.equal(c.user, p);
    assert.equal(c.read_all, false);
    assert.deepEqual(sorted(c.read_nodes), sorted([k1, k4, g1a, k3, k5]));
    assert.deepEqual(c.edit_node_companies, [c2]);

    // Second call in the same, already limited transaction: re-reads and re-applies.
    assert.equal(await apply(q), 'limited');
    s = await readSettings(client);
    assert.equal(s['app.da_user'], q);
    // Group G1: G1, G1a, their centres whatever their company, the disabled K2 included.
    assert.deepEqual(parseUuidArray(s['app.da_read_nodes']), sorted([g1, g1a, k1, k2, k3]));
    assert.deepEqual(parseUuidArray(s['app.da_read_companies']), [c2]);
    assert.deepEqual(parseUuidArray(s['app.da_edit_companies']), [c2]);
    assert.deepEqual(parseUuidArray(s['app.da_edit_nodes']), sorted([k2, k3]));
    assert.deepEqual(parseUuidArray(s['app.da_edit_node_companies']), [c2]);
  });
  console.log('  expansion, settings, jit, second call: OK');
}

/**
 * A company node does not descend below its centres: K6 (centre, C3) under the centre K1 (C1), a
 * shape the service refuses but no constraint forbids. Company C1 brings K1 and K4, not K6; the
 * centre node K1 brings its subtree.
 */
async function testCompanyNoDescent(): Promise<void> {
  await inTransaction(async () => {
    const tree = await seedTree(client);
    const { c1, c3 } = tree.companies;
    const { k1, k4 } = tree.nodes;
    const { rows } = await client.query(
      `INSERT INTO cost_centers (tenant_id, code, kind, name, parent_id, company_id, status)
       VALUES ($1, 'K6', 'cost_center', 'K6', $2, $3, 'enabled') RETURNING id`,
      [tree.tenantId, k1, c3],
    );
    const k6 = rows[0].id as string;
    const roleId = await seedRole(client, tree.tenantId, 'Reader');
    const byCompany = await seedPerson(client, tree.tenantId, 'limited', roleId);
    await seedNodes(client, tree.tenantId, byCompany, [{ type: 'company', id: c1, access: 'edit' }]);
    const byCentre = await seedPerson(client, tree.tenantId, 'limited', roleId);
    await seedNodes(client, tree.tenantId, byCentre, [{ type: 'cost_center', id: k1, access: 'read' }]);

    assert.equal(await apply(byCompany), 'limited');
    let s = await readSettings(client);
    assert.deepEqual(parseUuidArray(s['app.da_read_nodes']), sorted([k1, k4]), 'company C1: its centres, not K6 below K1');
    assert.deepEqual(parseUuidArray(s['app.da_edit_nodes']), sorted([k1, k4]));
    assert.deepEqual(parseUuidArray(s['app.da_edit_node_companies']), [c1]);

    assert.equal(await apply(byCentre), 'limited');
    s = await readSettings(client);
    assert.deepEqual(parseUuidArray(s['app.da_read_nodes']), sorted([k1, k6]), 'centre node K1: its subtree');
  });
  console.log('  company node: its centres and nothing below them: OK');
}

/** Limited, then an unscoped person or an Administrator in the same transaction: back to none. */
async function testSecondCallAll(): Promise<void> {
  await inTransaction(async () => {
    const tree = await seedTree(client);
    const reader = await seedRole(client, tree.tenantId, 'Reader');
    const admin = await seedRole(client, tree.tenantId, 'Administrator');
    const limited = await seedPerson(client, tree.tenantId, 'limited', reader);
    await seedNodes(client, tree.tenantId, limited, [{ type: 'company', id: tree.companies.c1, access: 'edit' }]);
    const everyone = await seedPerson(client, tree.tenantId, 'all', reader);
    const administrator = await seedPerson(client, tree.tenantId, 'limited', admin);

    for (const [label, id] of [['mode all', everyone], ['administrator', administrator]] as const) {
      assert.equal(await apply(limited), 'limited', `${label}: first call limited`);
      assert.equal(await currentUser(), LIMITED_ROLE);
      assert.equal(await apply(id), 'all', `${label}: second call all`);
      assert.equal(await currentUser(), APP_ROLE, `${label}: back to the application role`);
      assertNoSettings(await readSettings(client), `${label} after a limited call`);
      assert.deepEqual(await ctx(), { mode: 'all' }, `${label}: ctx reads all`);
    }
    // And limited again afterwards.
    assert.equal(await apply(limited), 'limited');
    assert.equal(await currentUser(), LIMITED_ROLE);
  });
  console.log('  second call for an unscoped person or an Administrator: role and settings reset: OK');
}

async function testAllNodesAndEmptyList(): Promise<void> {
  await inTransaction(async () => {
    const tree = await seedTree(client);
    const roleId = await seedRole(client, tree.tenantId, 'Reader');
    const readAll = await seedPerson(client, tree.tenantId, 'limited', roleId);
    await seedNodes(client, tree.tenantId, readAll, [{ type: 'all', access: 'read' }]);
    const editAll = await seedPerson(client, tree.tenantId, 'limited', roleId);
    await seedNodes(client, tree.tenantId, editAll, [{ type: 'all', access: 'edit' }]);
    const empty = await seedPerson(client, tree.tenantId, 'limited', roleId);

    assert.equal(await apply(readAll), 'limited');
    let s = await readSettings(client);
    assert.equal(s['app.da_read_all'], 'true');
    assert.equal(s['app.da_edit_all'], 'false');

    assert.equal(await apply(editAll), 'limited');
    s = await readSettings(client);
    assert.equal(s['app.da_read_all'], 'true');
    assert.equal(s['app.da_edit_all'], 'true');

    // An empty list stays limited, with empty lists: never everything.
    assert.equal(await apply(empty), 'limited');
    s = await readSettings(client);
    assert.equal(s['app.da_mode'], 'limited');
    assert.equal(s['app.da_read_all'], 'false');
    assert.equal(s['app.da_edit_all'], 'false');
    for (const name of ['app.da_read_companies', 'app.da_edit_companies', 'app.da_read_nodes', 'app.da_edit_nodes', 'app.da_edit_node_companies']) {
      assert.equal(s[name], '{}', `${name} is an empty array`);
    }
  });
  console.log('  "all" nodes and empty list: OK');
}

async function testModeAllAdministratorAndUnknown(): Promise<void> {
  await inTransaction(async () => {
    const tree = await seedTree(client);
    const reader = await seedRole(client, tree.tenantId, 'Reader');
    const admin = await seedRole(client, tree.tenantId, ' Administrator ');
    const everyone = await seedPerson(client, tree.tenantId, 'all', reader);
    const primaryAdmin = await seedPerson(client, tree.tenantId, 'limited', admin);
    const secondaryAdmin = await seedPerson(client, tree.tenantId, 'limited', reader);
    await client.query(
      `INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, false)`,
      [tree.tenantId, secondaryAdmin, admin],
    );
    await client.query(`SET LOCAL jit = on`);

    for (const [label, id] of [['mode all', everyone], ['administrator', primaryAdmin], ['secondary administrator', secondaryAdmin]]) {
      assert.equal(await apply(id), 'all', `${label}: all`);
      assert.equal(await currentUser(), APP_ROLE, `${label}: the role is unchanged`);
      assert.equal(await jit(), 'on', `${label}: jit untouched`);
      assertNoSettings(await readSettings(client), label);
      assert.deepEqual(await ctx(), { mode: 'all' });
    }

    // Unknown person, and a person of another tenant: refused, never everything.
    assert.equal(await sqlStateIn(client, () => apply('00000000-0000-4000-8000-000000000000')), 'KDA02');
    const other = await seedTree(client);
    const otherRole = await seedRole(client, other.tenantId, 'Reader');
    const otherPerson = await seedPerson(client, other.tenantId, 'limited', otherRole);
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tree.tenantId]);
    assert.equal(await sqlStateIn(client, () => apply(otherPerson)), 'KDA02');
  });
  console.log('  mode all, administrator, unknown person: OK');
}

async function testEndOfTransaction(): Promise<void> {
  // Rollback: role and settings gone on the same connection.
  let personId = '';
  await inTransaction(async () => {
    const tree = await seedTree(client);
    const roleId = await seedRole(client, tree.tenantId, 'Reader');
    personId = await seedPerson(client, tree.tenantId, 'limited', roleId);
    assert.equal(await apply(personId), 'limited');
    assert.equal(await currentUser(), LIMITED_ROLE);
  });
  assert.equal(await currentUser(), APP_ROLE, 'after ROLLBACK: back to the application role');
  assertNoSettings(await readSettings(client), 'after ROLLBACK');
  assert.deepEqual(await ctx(), { mode: 'all' });

  // Commit: same, with a person committed beforehand and removed afterwards.
  await client.query('BEGIN');
  const tree = await seedTree(client);
  const roleId = await seedRole(client, tree.tenantId, 'Reader');
  personId = await seedPerson(client, tree.tenantId, 'limited', roleId);
  await client.query('COMMIT');
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tree.tenantId]);
    assert.equal(await apply(personId), 'limited');
    assert.equal(await currentUser(), LIMITED_ROLE);
    await client.query('COMMIT');
    assert.equal(await currentUser(), APP_ROLE, 'after COMMIT: back to the application role');
    assertNoSettings(await readSettings(client), 'after COMMIT');
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tree.tenantId]);
    await client.query(`DELETE FROM cost_centers WHERE tenant_id = $1 AND kind = 'cost_center'`, [tree.tenantId]);
    await client.query(`DELETE FROM cost_centers WHERE tenant_id = $1 AND parent_id IS NOT NULL`, [tree.tenantId]);
    await client.query(`DELETE FROM cost_centers WHERE tenant_id = $1`, [tree.tenantId]);
    await client.query(`DELETE FROM users WHERE tenant_id = $1`, [tree.tenantId]);
    await client.query(`DELETE FROM roles WHERE tenant_id = $1`, [tree.tenantId]);
    await client.query(`DELETE FROM companies WHERE tenant_id = $1`, [tree.tenantId]);
    await client.query(`DELETE FROM tenants WHERE id = $1`, [tree.tenantId]);
    await client.query('COMMIT');
  }
  console.log('  role and settings gone after ROLLBACK and COMMIT: OK');
}

async function testExpectedPolicies(): Promise<void> {
  const countExpected = async () => (await client.query(`SELECT count(*)::int AS n FROM data_access_expected_policies()`)).rows[0].n;
  const before = await countExpected();
  // The live function has a fourth column (fingerprint, lot 5): its return type cannot change
  // through CREATE OR REPLACE, so replace it by a DROP then a CREATE. The rollback restores it.
  const setExpected = async (row: string) => {
    await client.query(`DROP FUNCTION IF EXISTS data_access_expected_policies()`);
    await client.query(`
      CREATE FUNCTION data_access_expected_policies()
      RETURNS TABLE (policy_name text, table_name text, command text)
      LANGUAGE sql STABLE SET search_path = public, pg_temp
      AS $fn$ ${row} $fn$`);
  };

  // An expected policy missing: KDA01. DDL is transactional: the rollback restores the function.
  await inTransaction(async () => {
    const tree = await seedTree(client);
    const roleId = await seedRole(client, tree.tenantId, 'Reader');
    const p = await seedPerson(client, tree.tenantId, 'limited', roleId);
    await setExpected(`SELECT 'companies_data_access_select'::text, 'companies'::text, 'SELECT'::text`);
    assert.equal(await sqlStateIn(client, () => apply(p)), 'KDA01', 'missing policy');
  });
  // Present but permissive: KDA01. Present, restrictive, on the role: limited.
  await inTransaction(async () => {
    const tree = await seedTree(client);
    const roleId = await seedRole(client, tree.tenantId, 'Reader');
    const p = await seedPerson(client, tree.tenantId, 'limited', roleId);
    await setExpected(`SELECT 'companies_data_access_select'::text, 'companies'::text, 'SELECT'::text`);
    await client.query(`CREATE POLICY companies_data_access_select ON companies AS PERMISSIVE FOR SELECT TO ${LIMITED_ROLE} USING (true)`);
    assert.equal(await sqlStateIn(client, () => apply(p)), 'KDA01', 'permissive policy');
    await client.query(`DROP POLICY companies_data_access_select ON companies`);
    await client.query(`CREATE POLICY companies_data_access_select ON companies AS RESTRICTIVE FOR SELECT TO ${LIMITED_ROLE} USING (true)`);
    assert.equal(await apply(p), 'limited', 'expected policy in place');
  });
  assert.equal(await countExpected(), before, 'the expected list is restored by the rollback');
  console.log('  expected policies checked (missing, permissive, present): OK');
}

async function testRoleTakenWithoutContext(): Promise<void> {
  await inTransaction(async () => {
    await client.query(`SET LOCAL ROLE ${LIMITED_ROLE}`);
    // Lot 1 has no data-access policy: nothing to deny yet. Lot 2 asserts here that every policy
    // refuses every row when app.da_mode is absent under the limited role.
    assert.deepEqual(await ctx(), { mode: 'all' });
  });
  console.log('  role taken without context reads as mode all (policies come in lot 2): OK');
}

async function aclFingerprint(): Promise<string> {
  const { rows } = await client.query(`
    SELECT coalesce(string_agg(c.relname || '=' || coalesce(c.relacl::text, ''), ';' ORDER BY c.relname), '') AS tables,
           (SELECT coalesce(string_agg(d.defaclobjtype::text || '=' || d.defaclacl::text, ';' ORDER BY d.defaclobjtype), '')
              FROM pg_default_acl d) AS defaults
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p', 'S')`);
  return `${rows[0].tables}|${rows[0].defaults}`;
}

async function testSync(): Promise<void> {
  await client.query(`SELECT data_access_sync_policies()`);
  const first = await aclFingerprint();
  await client.query(`SELECT data_access_sync_policies()`);
  assert.equal(await aclFingerprint(), first, 'a second sync changes nothing');

  const { rows: missing } = await client.query(`
    SELECT c.relname, c.relkind
    FROM pg_class c
    WHERE c.relnamespace = 'public'::regnamespace
      AND CASE WHEN c.relkind IN ('r', 'p')
               THEN NOT has_table_privilege($1, c.oid, 'SELECT,INSERT,UPDATE,DELETE')
                    OR has_table_privilege($1, c.oid, 'TRUNCATE')
               WHEN c.relkind = 'S'
               THEN NOT has_sequence_privilege($1, c.oid, 'USAGE,SELECT')
                    OR has_sequence_privilege($1, c.oid, 'UPDATE')
               ELSE false END`, [LIMITED_ROLE]);
  assert.deepEqual(missing, [], 'every table and sequence granted (no TRUNCATE, no sequence UPDATE)');

  await inTransaction(async () => {
    await client.query(`CREATE TABLE data_access_spec_probe (id bigserial PRIMARY KEY, label text)`);
    const { rows } = await client.query(`
      SELECT has_table_privilege($1, 'data_access_spec_probe', 'SELECT,INSERT,UPDATE,DELETE') AS t,
             has_sequence_privilege($1, 'data_access_spec_probe_id_seq', 'USAGE,SELECT') AS s`, [LIMITED_ROLE]);
    assert.deepEqual(rows[0], { t: true, s: true }, 'default privileges cover a table created afterwards');
  });

  await inTransaction(async () => {
    await client.query(`CREATE POLICY companies_data_access_select ON companies AS RESTRICTIVE FOR SELECT TO ${LIMITED_ROLE} USING (true)`);
    await client.query(`SELECT data_access_sync_policies()`);
    const { rows } = await client.query(`SELECT 1 FROM pg_policy WHERE polname = 'companies_data_access_select'`);
    assert.equal(rows.length, 0, 'a stray policy on the limited role is dropped');
  });
  await inTransaction(async () => {
    await client.query(`CREATE POLICY companies_tenant_spec_probe ON companies AS RESTRICTIVE FOR SELECT USING (true)`);
    await client.query(`SELECT data_access_sync_policies()`);
    const { rows } = await client.query(`SELECT 1 FROM pg_policy WHERE polname = 'companies_tenant_spec_probe'`);
    assert.equal(rows.length, 1, 'a policy on another role is left alone');
  });
  console.log('  sync: grants, default privileges, idempotent, strays dropped: OK');
}

async function testCatalogRules(): Promise<void> {
  // Spec §10.2: a data-access policy (<table>_data_access_<command>) targets the limited role only.
  // (The tenant policy of user_data_access_nodes also contains "_data_access_" in its name.)
  const { rows: wrongTarget } = await client.query(`
    SELECT c.relname, p.polname
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE p.polname ~ '_data_access_(select|insert|update|delete|all)$'
      AND (to_regrole($1) IS NULL OR p.polroles <> ARRAY[to_regrole($1)::oid])`, [LIMITED_ROLE]);
  assert.deepEqual(wrongTarget, [], 'data-access policies target the limited role only');

  // The tenant policies target PUBLIC: a policy TO <app role> would give the limited role no row.
  const { rows: named } = await client.query(`
    SELECT c.relname, p.polname, p.polroles::regrole[]::text AS roles
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    WHERE p.polroles <> '{0}'::oid[]
      AND NOT (to_regrole($1) IS NOT NULL AND p.polroles = ARRAY[to_regrole($1)::oid])
    ORDER BY 1, 2`, [LIMITED_ROLE]);
  assert.deepEqual(named, [], 'every tenant policy targets PUBLIC');

  if (hasRole) {
    const { rows } = await client.query(`SELECT pg_has_role(current_user, $1, 'USAGE') AS inherits`, [LIMITED_ROLE]);
    assert.equal(rows[0].inherits, false, 'the application role does not inherit the limited role');
  }
  console.log('  catalog rules (§10.2, tenant policies TO PUBLIC, no inheritance): OK');
}

async function testRoleAbsent(): Promise<void> {
  await inTransaction(async () => {
    const tree = await seedTree(client);
    const roleId = await seedRole(client, tree.tenantId, 'Reader');
    const p = await seedPerson(client, tree.tenantId, 'limited', roleId);
    assert.equal(await sqlStateIn(client, () => apply(p)), 'KDA01', 'role absent: a limited person is refused');
    assert.equal(await currentUser(), APP_ROLE);
  });
  console.log('  role absent: limited person refused with KDA01: OK');
}

async function testMigrationRerun(): Promise<void> {
  const queryRunner = {
    query: async (sql: string, params?: unknown[]) => (await client.query(sql, params)).rows,
  } as unknown as QueryRunner;
  await inTransaction(async () => {
    await new DataAccessFoundations1854400000000().up(queryRunner);
  });
  console.log('  migration up() reruns on a migrated database: OK');
}

async function run(): Promise<void> {
  client = await connect(APP_URL);
  try {
    hasRole = await roleExists(client);
    console.log(`data_access_apply and sync (role ${hasRole ? 'installed' : 'absent'})`);
    if (!hasRole && process.env.CI) {
      assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
    }
    await testModeAllAdministratorAndUnknown();
    await testCatalogRules();
    await testMigrationRerun();
    if (hasRole) {
      // The grants the API sets at its start (lot 1 run B); the specs do not wait for it.
      await client.query(`SELECT data_access_sync_policies()`);
      await testExpansion();
      await testSecondCallAll();
      await testCompanyNoDescent();
      await testAllNodesAndEmptyList();
      await testEndOfTransaction();
      await testExpectedPolicies();
      await testRoleTakenWithoutContext();
      await testSync();
    } else {
      await testRoleAbsent();
      console.log('  role absent: the scenarios that need it are skipped');
    }
    console.log('data access apply spec: all scenarios passed');
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
