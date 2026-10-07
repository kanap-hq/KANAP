import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLogOmitUserSecrets1853870000000 as Migration } from '../../migrations/1853870000000-audit-log-omit-user-secrets';

// Migration 1853870000000 (audit rows without the user password hash and MFA
// secret), against a real database, each case in a transaction that is
// rolled back. The migration runs as migrations do, without a tenant context,
// over rows of two tenants:
// - rows holding the keys, at the top level or nested in objects and arrays,
//   lose them in both tenants and keep every other key and value exactly;
// - other rows are not rewritten (same tuple), including a row whose values
//   mention the key names;
// - row level security on audit_log is left as found (enabled and forced, or
//   enabled only), the helper function is dropped, and the count of changed
//   rows is logged;
// - a second run changes nothing and says so.
// The assertions read this test's own rows, each tenant through its own
// context, never table-wide counts.

const migration = new Migration();
const LOG_PREFIX = '[Migration] AuditLogOmitUserSecrets:';

async function captureLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: any[]) => { lines.push(args.map(String).join(' ')); };
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
}

async function inRolledBackTransaction(fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

/** No tenant context, as when migrations run. */
async function clearTenant(runner: QueryRunner) {
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
}

async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Audit secrets', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `audit-secrets-${tag}-${tenantId.slice(0, 8)}`],
  );
  return tenantId;
}

async function insertAudit(runner: QueryRunner, tenantId: string, table: string, before: string | null, after: string | null): Promise<string> {
  await setTenant(runner, tenantId);
  const [row] = await runner.query(
    `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, source)
     VALUES ($1, $2, $3, 'update', $4::jsonb, $5::jsonb, 'user') RETURNING id`,
    [tenantId, table, randomUUID(), before, after],
  );
  return row.id;
}

/** The rows of one tenant, read through that tenant's context. */
async function rowsOf(runner: QueryRunner, tenantId: string, ids: string[]) {
  await setTenant(runner, tenantId);
  const rows = await runner.query(
    `SELECT id, ctid::text AS ctid, before_json::text AS before_text, after_json::text AS after_text, before_json, after_json
       FROM audit_log WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  assert.equal(rows.length, ids.length, 'every row of the tenant is read');
  return new Map<string, any>(rows.map((row: any) => [row.id, row]));
}

async function rowSecurity(runner: QueryRunner) {
  const [row] = await runner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = 'audit_log'::regclass`,
  );
  return row;
}

const USER_BEFORE = '{"email": "ada@example.com", "status": "disabled", "password_hash": "hash-value-1", "mfa_secret": null}';
const USER_AFTER = '{"email": "ada@example.com", "status": "enabled", "password_hash": "hash-value-1", "mfa_secret": "secret-value", "role": {"role_name": "Reader"}}';

/** Two tenants, the context cleared, audit_log enabled and forced as the migrations leave it. */
async function testCleansEveryTenantWithoutContext() {
  await inRolledBackTransaction(async (runner) => {
    assert.deepEqual(await rowSecurity(runner), { enabled: true, forced: true }, 'the state the migrations leave');
    const tenantA = await seedTenant(runner, 'a');
    const tenantB = await seedTenant(runner, 'b');
    const a = {
      topLevel: await insertAudit(runner, tenantA, 'users', USER_BEFORE, USER_AFTER),
      nested: await insertAudit(
        runner, tenantA, 'tasks',
        null,
        '{"title": "Review", "amount": 12345678901234567890.123456789, "assignee": {"email": "bob@example.com", "password_hash": "hash-value-2"}, "watchers": [{"id": 1, "mfa_secret": "s"}, {"id": 2}, "plain"]}',
      ),
      mentionsOnly: await insertAudit(
        runner, tenantA, 'users',
        '{"email": "eve@example.com", "note": "password_hash"}',
        '{"email": "eve@example.com", "note": "\\"password_hash\\": not a key", "old_password_hash_set": true}',
      ),
      empty: await insertAudit(runner, tenantA, 'suppliers', null, null),
    };
    const b = {
      topLevel: await insertAudit(runner, tenantB, 'users', USER_BEFORE, USER_AFTER),
      untouched: await insertAudit(runner, tenantB, 'contacts', null, '{"email": "carl@example.com"}'),
    };
    const beforeA = await rowsOf(runner, tenantA, Object.values(a));
    const beforeB = await rowsOf(runner, tenantB, Object.values(b));

    await clearTenant(runner);
    const first = await captureLog(() => migration.up(runner));
    const afterA = await rowsOf(runner, tenantA, Object.values(a));
    const afterB = await rowsOf(runner, tenantB, Object.values(b));

    for (const [tenant, topLevel] of [['A', afterA.get(a.topLevel)], ['B', afterB.get(b.topLevel)]]) {
      assert.deepEqual(topLevel.before_json, { email: 'ada@example.com', status: 'disabled' }, `tenant ${tenant}: top-level keys removed (before)`);
      assert.deepEqual(
        topLevel.after_json,
        { email: 'ada@example.com', status: 'enabled', role: { role_name: 'Reader' } },
        `tenant ${tenant}: top-level keys removed (after), the rest kept`,
      );
    }

    const nested = afterA.get(a.nested);
    assert.equal(nested.before_json, null);
    assert.equal(
      nested.after_text,
      '{"title": "Review", "amount": 12345678901234567890.123456789, "assignee": {"email": "bob@example.com"}, "watchers": [{"id": 1}, {"id": 2}, "plain"]}',
      'nested keys removed in objects and arrays, numbers and order of arrays kept exactly',
    );

    for (const [rows, before, id] of [[afterA, beforeA, a.mentionsOnly], [afterA, beforeA, a.empty], [afterB, beforeB, b.untouched]] as const) {
      assert.equal(rows.get(id).ctid, before.get(id).ctid, 'a row without the keys is not rewritten');
      assert.equal(rows.get(id).before_text, before.get(id).before_text);
      assert.equal(rows.get(id).after_text, before.get(id).after_text);
    }

    assert.deepEqual(await rowSecurity(runner), { enabled: true, forced: true }, 'row level security as found');
    const [helper] = await runner.query(`SELECT to_regprocedure('audit_log_omit_user_secrets_1853870000000(jsonb)') AS fn`);
    assert.equal(helper.fn, null, 'the helper function is dropped');

    // The summary counts the whole table (other rows too): it must at least cover these three.
    const summary = first.lines.find((line) => line.startsWith(LOG_PREFIX));
    const counted = Number(/ (\d+) audit row\(s\) cleaned/.exec(summary ?? '')?.[1] ?? 0);
    assert.ok(counted >= 3, `the cleaned rows are counted (${summary})`);
    assert.ok(first.lines.some((line) => /^ {2}users: \d+ row\(s\)$/.test(line)), 'the count per table is logged');
    assert.ok(first.lines.some((line) => /^ {2}tasks: \d+ row\(s\)$/.test(line)), 'the count per table is logged');

    // A second run changes nothing.
    await clearTenant(runner);
    const second = await captureLog(() => migration.up(runner));
    const againA = await rowsOf(runner, tenantA, Object.values(a));
    const againB = await rowsOf(runner, tenantB, Object.values(b));
    for (const id of Object.values(a)) assert.equal(againA.get(id).ctid, afterA.get(id).ctid, 'the second run rewrites no row');
    for (const id of Object.values(b)) assert.equal(againB.get(id).ctid, afterB.get(id).ctid, 'the second run rewrites no row');
    assert.deepEqual(
      second.lines.filter((line) => line.startsWith(LOG_PREFIX)),
      [`${LOG_PREFIX} no audit row holds password_hash or mfa_secret, nothing changed`],
      'the second run says so',
    );
  });
}

/** audit_log with row level security enabled but not forced: cleaned, and left in that state. */
async function testKeepsRowSecurityEnabledNotForced() {
  await inRolledBackTransaction(async (runner) => {
    await runner.query(`ALTER TABLE audit_log NO FORCE ROW LEVEL SECURITY`);
    assert.deepEqual(await rowSecurity(runner), { enabled: true, forced: false }, 'the state before the migration');
    const tenantA = await seedTenant(runner, 'nf-a');
    const tenantB = await seedTenant(runner, 'nf-b');
    const idA = await insertAudit(runner, tenantA, 'users', USER_BEFORE, USER_AFTER);
    const idB = await insertAudit(runner, tenantB, 'users', USER_BEFORE, USER_AFTER);

    await clearTenant(runner);
    await captureLog(() => migration.up(runner));

    assert.deepEqual(await rowSecurity(runner), { enabled: true, forced: false }, 'row level security as found: enabled, not forced');
    for (const [tenantId, id] of [[tenantA, idA], [tenantB, idB]]) {
      const row = (await rowsOf(runner, tenantId, [id])).get(id);
      assert.deepEqual(row.before_json, { email: 'ada@example.com', status: 'disabled' }, 'cleaned (before)');
      assert.deepEqual(row.after_json, { email: 'ada@example.com', status: 'enabled', role: { role_name: 'Reader' } }, 'cleaned (after)');
    }
  });
}

async function run() {
  await dataSource.initialize();
  try {
    await testCleansEveryTenantWithoutContext();
    await testKeepsRowSecurityEnabledNotForced();
  } finally {
    await dataSource.destroy();
  }
  console.log('audit-log-omit-user-secrets-migration.integration.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
