// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import {
  DataAccessSession,
  checkDataAccessAvailability,
} from '../data-access-availability';
import {
  APP_URL,
  LIMITED_ROLE,
  PgClient,
  connect,
  roleExists,
} from './data-access-test-helpers';

/**
 * Data-scoped access, lot 5 run 5A (planning/data-scoped-access/spec.md §6.2, §10.6): the policy
 * fingerprint and the partial synchronisation.
 * - Every expected policy carries `kda:<source fingerprint>:<md5 of the deparsed expressions>`,
 *   with the source fingerprint of `data_access_expected_policies()`.
 * - `ALTER POLICY ... USING (true)` or `WITH CHECK (true)`, a missing comment and a dropped policy
 *   are reported different by the availability check; the sync recreates that policy alone, the
 *   other policies keep their oid.
 * - An unexpected policy on the role is dropped; a second sync changes nothing.
 * - Under `search_path = pg_catalog`, the check reports no difference after a sync and the sync
 *   recreates nothing (the deparsed md5 comes from a function with a pinned search path).
 *
 * One transaction, rolled back. Needs the role kanap_data_limited (CI installs it); skipped
 * without it.
 */

let client: PgClient;
let depth = 0;

/** The application connection as a session: its transactions are savepoints of the outer one. */
function session(): DataAccessSession {
  return {
    query: async (sql, params) => (await client.query(sql, params)).rows,
    inTransaction: async (fn, opts) => {
      const name = `data_access_fingerprint_spec_${depth += 1}`;
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


async function sync(): Promise<void> {
  await client.query(`SELECT data_access_sync_policies()`);
}

async function oids(): Promise<Map<string, string>> {
  const { rows } = await client.query(`
    SELECT c.relname || '.' || p.polname AS name, p.oid::text AS oid
    FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND to_regrole($1) = ANY (p.polroles)`, [LIMITED_ROLE]);
  return new Map(rows.map((row) => [row.name, row.oid]));
}

function changed(before: Map<string, string>, after: Map<string, string>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter((key) => before.get(key) !== after.get(key))
    .sort();
}

async function commentsWellFormed(): Promise<void> {
  const { rows } = await client.query(`
    SELECT e.policy_name, e.table_name, e.fingerprint, obj_description(p.oid, 'pg_policy') AS comment
    FROM data_access_expected_policies() e
    JOIN pg_policy p ON p.polname = e.policy_name
    JOIN pg_class c ON c.oid = p.polrelid AND c.relname = e.table_name
    JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = 'public'
    WHERE to_regrole($1) = ANY (p.polroles)`, [LIMITED_ROLE]);
  const expected = (await client.query(`SELECT count(*)::int AS n FROM data_access_expected_policies()`)).rows[0].n;
  assert.equal(rows.length, expected, 'every expected policy carries a comment');
  for (const row of rows) {
    const parts = String(row.comment ?? '').split(':');
    assert.equal(parts.length, 3, `${row.policy_name}: kda:<source>:<deparsed>`);
    assert.equal(parts[0], 'kda', `${row.policy_name}: the kda prefix`);
    assert.equal(parts[1], row.fingerprint, `${row.policy_name}: the source fingerprint of data_access_expected_policies()`);
    assert.match(parts[2], /^[0-9a-f]{32}$/, `${row.policy_name}: the md5 of the deparsed expressions`);
  }
  console.log(`  ${rows.length} policies carry kda:<source>:<deparsed md5>: OK`);
}

async function differentThenRecreated(policy: string, table: string, change: string): Promise<Map<string, string>> {
  const before = await oids();
  await client.query(change);
  const availability = await checkDataAccessAvailability(session());
  assert.equal(availability.available, false, `${policy}: unavailable after ${change}`);
  assert.ok(availability.missing.includes('policies'), `${policy}: reported as policies`);
  await sync();
  const after = await oids();
  assert.deepEqual(changed(before, after), [`${table}.${policy}`], `${policy}: only this policy is recreated`);
  assert.deepEqual(await checkDataAccessAvailability(session()), { available: true, missing: [] }, `${policy}: available again`);
  await commentsWellFormed();
  return after;
}

async function testFingerprint(): Promise<void> {
  await sync();
  await commentsWellFormed();

  const stable = await oids();
  await sync();
  assert.deepEqual(await oids(), stable, 'a second sync changes nothing');

  let baseline = await differentThenRecreated(
    'spend_items_data_access_select',
    'spend_items',
    `ALTER POLICY spend_items_data_access_select ON spend_items USING (true)`,
  );
  baseline = await differentThenRecreated(
    'spend_items_data_access_insert',
    'spend_items',
    `ALTER POLICY spend_items_data_access_insert ON spend_items WITH CHECK (true)`,
  );
  baseline = await differentThenRecreated(
    'tasks_data_access_select',
    'tasks',
    `COMMENT ON POLICY tasks_data_access_select ON tasks IS NULL`,
  );
  baseline = await differentThenRecreated(
    'spend_items_data_access_insert',
    'spend_items',
    `DROP POLICY spend_items_data_access_insert ON spend_items`,
  );

  // An unexpected policy on the role is dropped; no expected policy moves.
  await client.query(`CREATE POLICY companies_data_access_stray ON companies AS RESTRICTIVE FOR SELECT TO ${LIMITED_ROLE} USING (true)`);
  await sync();
  assert.deepEqual(await oids(), baseline, 'a stray policy is dropped, the expected ones keep their oid');
  const stray = (await client.query(`SELECT 1 FROM pg_policy WHERE polname = 'companies_data_access_stray'`)).rows.length;
  assert.equal(stray, 0, 'the stray policy is gone');

  await sync();
  assert.deepEqual(await oids(), baseline, 'a second sync after the scenarios changes nothing');
  console.log('  changed body, missing comment and dropped policy recreated alone; stray dropped; second sync inert: OK');
}

/** The connection's search path changes neither the check nor the sync (review note M3). */
async function testSearchPath(): Promise<void> {
  await sync();
  const before = await oids();
  await client.query(`SET search_path = pg_catalog`);
  try {
    assert.deepEqual(await checkDataAccessAvailability(session()), { available: true, missing: [] },
      'search_path = pg_catalog: no difference after a sync');
    await client.query(`SELECT public.data_access_sync_policies()`);
  } finally {
    await client.query(`RESET search_path`);
  }
  assert.deepEqual(await oids(), before, 'search_path = pg_catalog: the sync recreates nothing');
  console.log('  search_path = pg_catalog: available after a sync, the sync recreates nothing: OK');
}

async function run(): Promise<void> {
  client = await connect(APP_URL);
  try {
    if (!(await roleExists(client))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access policy fingerprint: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('data access policy fingerprint (lot 5, run 5A)');
    await client.query('BEGIN');
    try {
      await testFingerprint();
      await testSearchPath();
    } finally {
      await client.query('ROLLBACK');
    }
    console.log('data access policy fingerprint: all scenarios passed');
  } finally {
    await client.end();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
