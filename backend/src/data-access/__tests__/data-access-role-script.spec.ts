// @exclusive-db-spec: runs infra/scripts/data-access-role.sql (server-wide role and membership) and creates and drops a database
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { backendPath } from '../../common/__tests__/backend-root';
import { APP_URL, LIMITED_ROLE, adminUrlForAppDatabase, appRoleName, connect } from './data-access-test-helpers';

/**
 * The role script infra/scripts/data-access-role.sql (planning/data-scoped-access/spec.md §9.2,
 * §10.6), run with psql as the admin role:
 * - twice on the database of DATABASE_URL: same final state, and the role and its membership are
 *   right (member, not inherited, can be taken);
 * - in a fresh database created for the test (owned by the application role, from template1),
 *   after the script, the application role still creates a table and a function there (the
 *   PostgreSQL 15 trap: NOINHERIT cuts the implicit pg_database_owner membership). The database
 *   is dropped at the end;
 * - PostgreSQL 15: by default the script neither requires nor grants the direct grant on public of
 *   template1; with -v include_template1=on it grants it there, and a database created afterwards
 *   from template1 lets the application role create before the script runs in it. The template1
 *   grant is put back as it was;
 * - the uninstall by a CREATEROLE role without the privileges of the application role and of the
 *   limited role stops with a message that says what it needs, before changing anything.
 *
 * Needs DATA_ACCESS_ADMIN_DATABASE_URL (a superuser; CI sets it) and psql on the PATH; skips
 * without the variable. Locally, against a throwaway server only, never the shared dev server
 * (the script changes the server's roles):
 *   DATABASE_URL=postgres://app:app@127.0.0.1:55415/appdb \
 *   DATA_ACCESS_ADMIN_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:55415/postgres \
 *   npx ts-node src/data-access/__tests__/data-access-role-script.spec.ts
 * On PostgreSQL 15 the script refuses NOINHERIT until every database the application role owns
 * holds the direct grant on public: run it on each first (see its header).
 */

const SCRIPT = backendPath('..', 'infra', 'scripts', 'data-access-role.sql');
const APP_ROLE = appRoleName();
const FRESH_DB = 'appdb_data_access_role_spec';

function withDatabase(url: string, database: string): string {
  const out = new URL(url);
  out.pathname = `/${database}`;
  return out.toString();
}

function spawnScript(url: string, extra: string[]) {
  return spawnSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-v', `app_role=${APP_ROLE}`, ...extra, '-f', SCRIPT, '-d', url],
    { encoding: 'utf8' },
  );
}

function runScript(adminUrl: string, extra: string[] = []): string {
  const result = spawnSync(
    'psql',
    ['-X', '-v', 'ON_ERROR_STOP=1', '-v', `app_role=${APP_ROLE}`, '-v', 'mode=install', ...extra, '-f', SCRIPT, '-d', adminUrl],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, `the script succeeds\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

async function roleState(adminUrl: string): Promise<Record<string, unknown>> {
  const admin = await connect(adminUrl);
  try {
    const { rows } = await admin.query(`
      SELECT l.rolcanlogin AS limited_login, l.rolsuper AS limited_super, l.rolbypassrls AS limited_bypass,
             a.rolinherit AS app_inherit,
             (SELECT count(*)::int FROM pg_auth_members m WHERE m.roleid = l.oid AND m.member = a.oid) AS grants,
             (SELECT json_agg(to_jsonb(m) - 'oid' - 'grantor' - 'roleid' - 'member')
                FROM pg_auth_members m WHERE m.roleid = l.oid AND m.member = a.oid) AS options,
             pg_has_role(a.oid, l.oid, 'MEMBER') AS member,
             pg_has_role(a.oid, l.oid, 'USAGE') AS inherits,
             has_schema_privilege(a.oid, 'public', 'CREATE') AS app_creates
      FROM pg_roles l, pg_roles a
      WHERE l.rolname = $1 AND a.rolname = $2`, [LIMITED_ROLE, APP_ROLE]);
    assert.equal(rows.length, 1, 'the limited role exists');
    return rows[0];
  } finally {
    await admin.end();
  }
}

async function testTwice(adminUrl: string): Promise<void> {
  runScript(adminUrl);
  const first = await roleState(adminUrl);
  const output = runScript(adminUrl);
  assert.match(output, /final state/);
  assert.deepEqual(await roleState(adminUrl), first, 'a second run leaves the same state');
  assert.equal(first.limited_login, false);
  assert.equal(first.limited_super, false);
  assert.equal(first.limited_bypass, false);
  assert.equal(first.member, true, 'the application role is a member');
  assert.equal(first.inherits, false, 'the application role does not inherit it');
  assert.equal(first.grants, 1);

  // The application role can take it (the test SET ROLE form, valid on 15 and 16).
  const app = await connect(APP_URL);
  try {
    await app.query('BEGIN');
    await app.query(`SET LOCAL ROLE ${LIMITED_ROLE}`);
    const { rows } = await app.query(`SELECT current_user AS u`);
    assert.equal(rows[0].u, LIMITED_ROLE);
    await app.query('ROLLBACK');
  } finally {
    await app.end();
  }
  console.log('  script twice: same state, member, not inherited, can be taken: OK');
}

async function testFreshDatabase(adminUrl: string): Promise<void> {
  const server = await connect(withDatabase(adminUrl, 'postgres'));
  try {
    await server.query(`DROP DATABASE IF EXISTS ${FRESH_DB}`);
    await server.query(`CREATE DATABASE ${FRESH_DB} OWNER "${APP_ROLE}"`);
    try {
      runScript(withDatabase(adminUrl, FRESH_DB));
      const app = await connect(withDatabase(APP_URL, FRESH_DB));
      try {
        await app.query(`CREATE TABLE data_access_role_spec_probe (id int)`);
        await app.query(`CREATE FUNCTION data_access_role_spec_probe() RETURNS int LANGUAGE sql AS 'SELECT 1'`);
        const { rows } = await app.query(`SELECT data_access_role_spec_probe() AS one`);
        assert.equal(rows[0].one, 1);
      } finally {
        await app.end();
      }
    } finally {
      await server.query(`DROP DATABASE IF EXISTS ${FRESH_DB}`);
    }
  } finally {
    await server.end();
  }
  console.log('  fresh database after the script: the application role creates a table and a function: OK');
}

/** One statement on template1, on a connection closed right after (CREATE DATABASE copies template1 only when nobody is connected to it). */
async function onTemplate1(adminUrl: string, sql: string): Promise<any[]> {
  const template1 = await connect(withDatabase(adminUrl, 'template1'));
  try {
    return (await template1.query(sql)).rows;
  } finally {
    await template1.end();
  }
}

async function template1Granted(adminUrl: string): Promise<boolean> {
  const rows = await onTemplate1(adminUrl, `SELECT EXISTS (SELECT 1 FROM pg_namespace n, aclexplode(n.nspacl) a
                    WHERE n.nspname = 'public' AND a.grantee = '"${APP_ROLE}"'::regrole) AS granted`);
  return rows[0].granted === true;
}

async function testTemplate1Option(adminUrl: string): Promise<void> {
  const server = await connect(withDatabase(adminUrl, 'postgres'));
  try {
    const { rows } = await server.query(`SELECT current_setting('server_version_num')::int < 160000 AS pg15`);
    if (!rows[0].pg15) {
      console.log('  include_template1: PostgreSQL 15 only, skipped');
      return;
    }
    const before = await template1Granted(adminUrl);
    try {
      await onTemplate1(adminUrl, `REVOKE USAGE, CREATE ON SCHEMA public FROM "${APP_ROLE}"`);
      runScript(adminUrl);
      assert.equal(await template1Granted(adminUrl), false, 'by default template1 is neither required nor granted');

      runScript(adminUrl, ['-v', 'include_template1=on']);
      assert.equal(await template1Granted(adminUrl), true, 'include_template1=on grants on template1');
      await server.query(`DROP DATABASE IF EXISTS ${FRESH_DB}`);
      await server.query(`CREATE DATABASE ${FRESH_DB} OWNER "${APP_ROLE}"`);
      try {
        const app = await connect(withDatabase(APP_URL, FRESH_DB));
        try {
          await app.query(`CREATE TABLE data_access_role_spec_probe (id int)`);
        } finally {
          await app.end();
        }
      } finally {
        await server.query(`DROP DATABASE IF EXISTS ${FRESH_DB}`);
      }
    } finally {
      await onTemplate1(adminUrl, before
        ? `GRANT USAGE, CREATE ON SCHEMA public TO "${APP_ROLE}"`
        : `REVOKE USAGE, CREATE ON SCHEMA public FROM "${APP_ROLE}"`);
    }
  } finally {
    await server.end();
  }
  console.log('  include_template1: off by default, on grants template1 for databases created later: OK');
}

async function testUninstallRefused(adminUrl: string): Promise<void> {
  const dba = 'data_access_role_spec_dba';
  const server = await connect(withDatabase(adminUrl, 'postgres'));
  try {
    await server.query(`DROP ROLE IF EXISTS ${dba}`);
    await server.query(`CREATE ROLE ${dba} LOGIN PASSWORD '${dba}' CREATEROLE`);
    try {
      const url = new URL(adminUrl);
      url.username = dba;
      url.password = dba;
      const result = spawnScript(url.toString(), ['-v', 'mode=uninstall']);
      assert.notEqual(result.status, 0, 'the uninstall stops');
      assert.match(result.stderr, /uninstall needs a superuser/, `a message that says what it needs: ${result.stderr}`);
      assert.match(result.stderr, /Nothing was changed/);
      const state = await roleState(adminUrl);
      assert.equal(state.member, true, 'the role and its membership are still there');
      const app = await connect(APP_URL);
      try {
        const { rows } = await app.query(`SELECT has_table_privilege($1, 'companies', 'SELECT') AS granted`, [LIMITED_ROLE]);
        assert.equal(rows[0].granted, true, 'the grants are still there');
      } finally {
        await app.end();
      }
    } finally {
      await server.query(`DROP OWNED BY ${dba}`).catch(() => undefined);
      await server.query(`DROP ROLE IF EXISTS ${dba}`);
    }
  } finally {
    await server.end();
  }
  console.log('  uninstall by a CREATEROLE role without the privileges: stops with its message, nothing changed: OK');
}

async function run(): Promise<void> {
  const adminUrl = adminUrlForAppDatabase();
  if (!adminUrl) {
    console.log('data access role script: DATA_ACCESS_ADMIN_DATABASE_URL not set, skipped');
    return;
  }
  console.log('data access role script');
  await testTwice(adminUrl);
  await testFreshDatabase(adminUrl);
  await testTemplate1Option(adminUrl);
  await testUninstallRefused(adminUrl);
  console.log('data access role script: all scenarios passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
