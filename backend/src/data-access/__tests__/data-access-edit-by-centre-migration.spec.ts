// @database-spec
// @exclusive-db-spec: renames the server-wide role kanap_data_limited inside a rolled-back transaction (the migration without the role)
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import { DataAccessEditByCentre1856250000000 } from '../../migrations/1856250000000-data-access-edit-by-centre';
import { DataAccessContractPolicies1855400000000 } from '../../migrations/1855400000000-data-access-contract-policies';
import { DataAccessLineEditable1854600000000 } from '../../migrations/1854600000000-data-access-line-editable';
import { DataAccessSession, checkDataAccessAvailability } from '../data-access-availability';
import {
  APP_URL,
  LIMITED_ROLE,
  PgClient,
  adminUrlForAppDatabase,
  appRoleName,
  connect,
  lockOwnTables,
  roleExists,
} from './data-access-test-helpers';

/**
 * Migration 1856250000000 (data-scoped access, edit through the centre, spec §6.4): on the migrated
 * database, inside a transaction always rolled back, as the application role:
 * - after up(): the expected policies are the policies in place (fingerprints and bodies), 132 of
 *   them, and the availability check is clean;
 * - a second up() recreates no policy (same oids) and leaves every function as it was;
 * - down() restores the rule of 1855400000000: a replay of 1855400000000 up() and of
 *   1854600000000 up() then changes nothing, the depth functions call the placement functions
 *   again, and the count of policies is unchanged;
 * - up() after down() ends in the state of the first up();
 * - the security mode, the search path and the grants of the redefined functions, before and after;
 * - without the limited role (renamed, admin connection): up() redefines the functions and creates
 *   no policy.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI. The scenario
 * without the role needs DATA_ACCESS_ADMIN_DATABASE_URL and is skipped without it.
 */

const APP_ROLE = appRoleName();
const AWAY = 'kanap_data_limited_spec_centre_away';
const MIGRATION_NAME = 'DataAccessEditByCentre1856250000000';
const FUNCTIONS = [
  'data_access_expected_policies',
  'data_access_sync_policies',
  'data_access_line_editable',
  'data_access_contract_modifiable',
  'data_access_task_modifiable',
  'data_access_tasks_placement',
];

function runnerOf(client: PgClient): QueryRunner {
  return { query: async (sql: string, params?: unknown[]) => (await client.query(sql, params)).rows } as unknown as QueryRunner;
}

/** The connection, inside its outer transaction, as a session: transactions are savepoints. */
function savepointSession(client: PgClient): DataAccessSession {
  let depth = 0;
  return {
    query: async (sql, params) => (await client.query(sql, params as unknown[])).rows,
    inTransaction: async (fn, opts) => {
      const name = `edit_by_centre_spec_${depth += 1}`;
      await client.query(`SAVEPOINT ${name}`);
      try {
        const result = await fn();
        await client.query(opts?.rollback ? `ROLLBACK TO SAVEPOINT ${name}` : `RELEASE SAVEPOINT ${name}`);
        return result;
      } catch (error) {
        await client.query(`ROLLBACK TO SAVEPOINT ${name}`);
        throw error;
      }
    },
  };
}

type FunctionState = { fn: string; definer: boolean; volatility: string; config: string[] | null; acl: string | null; src: string };
type State = {
  functions: FunctionState[];
  /** Policy name, its oid and its comment (source fingerprint and deparsed md5). */
  policies: Array<{ name: string; oid: string; comment: string | null }>;
  expected: Array<{ name: string; fingerprint: string }>;
};

async function readState(client: PgClient): Promise<State> {
  const functions = (await client.query(
    `SELECT p.oid::regprocedure::text AS fn, p.prosecdef AS definer, p.provolatile::text AS volatility,
            p.proconfig AS config, p.proacl::text AS acl, md5(p.prosrc) AS src
       FROM pg_proc p
      WHERE p.pronamespace = 'public'::regnamespace AND p.proname = ANY ($1::text[])
      ORDER BY 1`,
    [FUNCTIONS],
  )).rows;
  const policies = (await client.query(
    `SELECT c.relname || '.' || p.polname AS name, p.oid::text AS oid, obj_description(p.oid, 'pg_policy') AS comment
       FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      WHERE to_regrole($1) = ANY (p.polroles)
      ORDER BY 1`,
    [LIMITED_ROLE],
  )).rows;
  const expected = (await client.query(
    `SELECT policy_name AS name, fingerprint FROM data_access_expected_policies() ORDER BY 1`,
  )).rows;
  return { functions, policies, expected };
}

/** Every expected policy in place, with the comment of its source fingerprint and of its body. */
async function assertPoliciesClean(client: PgClient, label: string): Promise<void> {
  const [row] = (await client.query(
    `SELECT count(*)::int AS expected,
            count(*) FILTER (WHERE p.oid IS NULL
              OR obj_description(p.oid, 'pg_policy') IS DISTINCT FROM 'kda:' || e.fingerprint || ':' || data_access_policy_deparsed_md5(p.oid))::int AS different,
            (SELECT count(*)::int FROM pg_policy x WHERE to_regrole($1) = ANY (x.polroles)) AS in_place
       FROM data_access_expected_policies() e
       LEFT JOIN pg_class c ON c.relnamespace = 'public'::regnamespace AND c.relname = e.table_name
       LEFT JOIN pg_policy p ON p.polrelid = c.oid AND p.polname = e.policy_name AND to_regrole($1) = ANY (p.polroles)`,
    [LIMITED_ROLE],
  )).rows;
  assert.deepEqual(row, { expected: 132, different: 0, in_place: 132 }, `${label}: 132 expected policies, all in place and unchanged`);
  assert.deepEqual(await checkDataAccessAvailability(savepointSession(client)), { available: true, missing: [] }, `${label}: availability clean`);
}

function byName(state: State): Map<string, FunctionState> {
  return new Map(state.functions.map((f) => [f.fn, f]));
}

async function body(client: PgClient, signature: string): Promise<string> {
  return (await client.query(`SELECT prosrc FROM pg_proc WHERE oid = $1::regprocedure`, [signature])).rows[0].prosrc;
}

/** The security mode and search path of each redefined function (spec §6.4, AGENTS.md "SECURITY DEFINER"). */
function assertModes(state: State, label: string): void {
  const f = byName(state);
  const pinned = ['search_path=public, pg_temp'];
  const expect: Record<string, { definer: boolean; config: string[] | null; volatility: string }> = {
    'data_access_line_editable(uuid,uuid,uuid,uuid)': { definer: false, config: null, volatility: 's' },
    'data_access_contract_modifiable(uuid)': { definer: true, config: pinned, volatility: 's' },
    'data_access_task_modifiable(uuid)': { definer: true, config: pinned, volatility: 's' },
    'data_access_tasks_placement()': { definer: false, config: pinned, volatility: 'v' },
    'data_access_expected_policies()': { definer: false, config: pinned, volatility: 's' },
    'data_access_sync_policies()': { definer: false, config: pinned, volatility: 'v' },
  };
  assert.equal(f.size, Object.keys(expect).length, `${label}: the six functions exist`);
  for (const [fn, mode] of Object.entries(expect)) {
    const actual = f.get(fn);
    assert.ok(actual, `${label}: ${fn} exists`);
    assert.deepEqual({ definer: actual!.definer, config: actual!.config, volatility: actual!.volatility }, mode, `${label}: ${fn} security mode, search path, volatility`);
  }
}

async function testUpDownUp(client: PgClient): Promise<void> {
  const runner = runnerOf(client);
  const migration = new DataAccessEditByCentre1856250000000();
  const migrated = (await client.query(`SELECT count(*)::int AS n FROM migrations WHERE name = $1`, [MIGRATION_NAME])).rows[0].n;
  assert.equal(migrated, 1, 'the database is migrated with 1856250000000');

  const up = await readState(client);
  await assertPoliciesClean(client, 'after up()');
  assertModes(up, 'after up()');
  const editable = await body(client, 'data_access_line_editable(uuid,uuid,uuid,uuid)');
  assert.ok(!editable.includes('data_access_placable_line'), 'after up(): data_access_line_editable no longer calls data_access_placable_line');
  assert.ok(!/\(\s*SELECT/i.test(editable.replace(/^\s*SELECT CASE/, '')), 'after up(): data_access_line_editable has no subquery (inlinable)');
  for (const fn of ['data_access_contract_modifiable(uuid)', 'data_access_task_modifiable(uuid)', 'data_access_tasks_placement()']) {
    const text = await body(client, fn);
    assert.ok(!/data_access_placable_(line|contract)/.test(text), `after up(): ${fn} embeds no placement function`);
  }

  // A second up(): nothing recreated, nothing changed.
  await migration.up(runner);
  assert.deepEqual(await readState(client), up, 'a second up() recreates no policy and changes no function');

  // down(): the rule of 1855400000000, the same number of policies.
  await migration.down(runner);
  const down = await readState(client);
  await assertPoliciesClean(client, 'after down()');
  assertModes(down, 'after down()');
  assert.equal(down.policies.length, up.policies.length, 'down(): the number of policies is unchanged');
  const changed = down.expected.filter((row, i) => row.fingerprint !== up.expected[i].fingerprint).map((row) => row.name);
  assert.equal(changed.length, 53, 'down(): the 53 policies built from modifiable_ligne and modifiable_contrat change');
  assert.ok(changed.includes('spend_items_data_access_update') && changed.includes('contracts_data_access_update'), 'down(): the UPDATE policies of lines and contracts change');
  assert.ok(!changed.some((name) => name.endsWith('_data_access_select')), 'down(): no SELECT policy changes');
  for (const [name, upFn] of byName(up)) {
    assert.equal(byName(down).get(name)!.acl, upFn.acl, `down(): ${name} keeps its grants`);
  }
  assert.match(await body(client, 'data_access_contract_modifiable(uuid)'), /data_access_placable_contract\(c\.company_id, c\.cost_center_id\)/, 'down(): contract_modifiable calls the placement again');
  assert.match(await body(client, 'data_access_task_modifiable(uuid)'), /data_access_placable_line\(i\.paying_company_id, i\.cost_center_id\)/, 'down(): task_modifiable calls the placement again');
  assert.match(await body(client, 'data_access_tasks_placement()'), /data_access_placable_line\(i\.paying_company_id, i\.cost_center_id\)/, 'down(): tasks_placement calls the placement again');
  // The previous migrations, replayed, find their own bodies in place.
  await new DataAccessContractPolicies1855400000000().up(runner);
  await new DataAccessLineEditable1854600000000().up(runner);
  const replayed = await readState(client);
  assert.deepEqual(replayed.expected, down.expected, 'down(): the expected list is the one of 1855400000000');
  assert.deepEqual(replayed.policies, down.policies, 'down(): 1855400000000 up() recreates no policy');
  assert.equal(byName(replayed).get('data_access_line_editable(uuid,uuid,uuid,uuid)')!.src, byName(down).get('data_access_line_editable(uuid,uuid,uuid,uuid)')!.src,
    'down(): data_access_line_editable is the body of 1854600000000');
  assert.equal(byName(replayed).get('data_access_sync_policies()')!.src, byName(down).get('data_access_sync_policies()')!.src,
    'down(): data_access_sync_policies is the body of 1855400000000');

  // up() again: the state of the first up(), policy oids aside (53 recreated).
  await migration.up(runner);
  const again = await readState(client);
  await assertPoliciesClean(client, 'after down() then up()');
  assert.deepEqual(again.functions, up.functions, 'down() then up(): the functions of the first up(), grants included');
  assert.deepEqual(again.expected, up.expected, 'down() then up(): the expected list of the first up()');
  assert.deepEqual(again.policies.map(({ name, comment }) => ({ name, comment })), up.policies.map(({ name, comment }) => ({ name, comment })),
    'down() then up(): the same policies, with the same fingerprints and bodies');
  console.log('  up() twice, down(), up(): policies and functions as expected, grants and security modes kept: OK');
}

async function testWithoutRole(adminUrl: string): Promise<void> {
  const admin = await connect(adminUrl);
  try {
    await admin.query('BEGIN');
    try {
      await admin.query(`ALTER ROLE ${LIMITED_ROLE} RENAME TO ${AWAY}`);
      await admin.query(`SET LOCAL ROLE "${APP_ROLE}"`);
      await lockOwnTables((sql) => admin.query(sql));
      const runner = runnerOf(admin);
      await new DataAccessEditByCentre1856250000000().down(runner);
      const policiesBefore = (await admin.query(`SELECT count(*)::int AS n FROM pg_policy p WHERE to_regrole($1) = ANY (p.polroles)`, [AWAY])).rows[0].n;
      await new DataAccessEditByCentre1856250000000().up(runner);
      const editable = (await admin.query(`SELECT prosrc FROM pg_proc WHERE oid = 'data_access_line_editable(uuid,uuid,uuid,uuid)'::regprocedure`)).rows[0].prosrc;
      assert.ok(!editable.includes('data_access_placable_line'), 'no role: up() redefines data_access_line_editable');
      const policiesAfter = (await admin.query(`SELECT count(*)::int AS n FROM pg_policy p WHERE to_regrole($1) = ANY (p.polroles)`, [AWAY])).rows[0].n;
      assert.equal(policiesAfter, policiesBefore, 'no role: the sync creates, drops and recreates no policy');
    } finally {
      await admin.query('ROLLBACK');
    }
  } finally {
    await admin.end();
  }
  console.log('  limited role absent: functions redefined, no policy touched, no error: OK');
}

async function run(): Promise<void> {
  const client = await connect(APP_URL);
  try {
    if (!(await roleExists(client))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access edit by centre migration: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access edit by centre migration');
    await client.query('BEGIN');
    try {
      // The sync grants and drops or creates policies on these tables: locked first (see the helper).
      await lockOwnTables((sql) => client.query(sql));
      await testUpDownUp(client);
    } finally {
      await client.query('ROLLBACK');
    }
  } finally {
    await client.end();
  }
  const adminUrl = adminUrlForAppDatabase();
  if (adminUrl) await testWithoutRole(adminUrl);
  else console.log('  limited role absent: DATA_ACCESS_ADMIN_DATABASE_URL not set, skipped');
  console.log('data access edit by centre migration: all scenarios passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
