import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLogOmitUserSecrets1853870000000 as Migration } from '../../migrations/1853870000000-audit-log-omit-user-secrets';

// Migration 1853870000000 (audit rows without the user password hash and MFA
// secret), against a real database, in a transaction that is rolled back:
// - rows holding the keys, at the top level or nested in objects and arrays,
//   lose them and keep every other key and value exactly;
// - other rows are not rewritten (same tuple), including a row whose values
//   mention the key names;
// - row level security on audit_log is left as found, the helper function is
//   dropped, and the count of changed rows is logged;
// - a second run changes nothing and says so.
// The assertions read this test's own rows, never table-wide counts.

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

async function insertAudit(runner: QueryRunner, tenantId: string, table: string, before: string | null, after: string | null): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO audit_log (tenant_id, table_name, record_id, action, before_json, after_json, source)
     VALUES ($1, $2, $3, 'update', $4::jsonb, $5::jsonb, 'user') RETURNING id`,
    [tenantId, table, randomUUID(), before, after],
  );
  return row.id;
}

async function rowsOf(runner: QueryRunner, ids: string[]) {
  const rows = await runner.query(
    `SELECT id, ctid::text AS ctid, before_json::text AS before_text, after_json::text AS after_text, before_json, after_json
       FROM audit_log WHERE id = ANY($1::uuid[])`,
    [ids],
  );
  return new Map<string, any>(rows.map((row: any) => [row.id, row]));
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Audit secrets', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `audit-secrets-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

    const ids = {
      topLevel: await insertAudit(
        runner, tenantId, 'users',
        '{"email": "ada@example.com", "status": "disabled", "password_hash": "hash-value-1", "mfa_secret": null}',
        '{"email": "ada@example.com", "status": "enabled", "password_hash": "hash-value-1", "mfa_secret": "secret-value", "role": {"role_name": "Reader"}}',
      ),
      nested: await insertAudit(
        runner, tenantId, 'tasks',
        null,
        '{"title": "Review", "amount": 12345678901234567890.123456789, "assignee": {"email": "bob@example.com", "password_hash": "hash-value-2"}, "watchers": [{"id": 1, "mfa_secret": "s"}, {"id": 2}, "plain"]}',
      ),
      mentionsOnly: await insertAudit(
        runner, tenantId, 'users',
        '{"email": "eve@example.com", "note": "password_hash"}',
        '{"email": "eve@example.com", "note": "\\"password_hash\\": not a key", "old_password_hash_set": true}',
      ),
      empty: await insertAudit(runner, tenantId, 'suppliers', null, null),
    };
    const before = await rowsOf(runner, Object.values(ids));

    const first = await captureLog(() => migration.up(runner));
    const after = await rowsOf(runner, Object.values(ids));

    const topLevel = after.get(ids.topLevel);
    assert.deepEqual(topLevel.before_json, { email: 'ada@example.com', status: 'disabled' }, 'top-level keys removed (before)');
    assert.deepEqual(
      topLevel.after_json,
      { email: 'ada@example.com', status: 'enabled', role: { role_name: 'Reader' } },
      'top-level keys removed (after), the rest kept',
    );

    const nested = after.get(ids.nested);
    assert.equal(nested.before_json, null);
    assert.equal(
      nested.after_text,
      '{"title": "Review", "amount": 12345678901234567890.123456789, "assignee": {"email": "bob@example.com"}, "watchers": [{"id": 1}, {"id": 2}, "plain"]}',
      'nested keys removed in objects and arrays, numbers and order of arrays kept exactly',
    );

    for (const id of [ids.mentionsOnly, ids.empty]) {
      assert.equal(after.get(id).ctid, before.get(id).ctid, 'a row without the keys is not rewritten');
      assert.equal(after.get(id).before_text, before.get(id).before_text);
      assert.equal(after.get(id).after_text, before.get(id).after_text);
    }

    const [security] = await runner.query(
      `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = 'audit_log'::regclass`,
    );
    assert.deepEqual(security, { enabled: true, forced: true }, 'row level security as found');
    const [helper] = await runner.query(`SELECT to_regprocedure('audit_log_omit_user_secrets_1853870000000(jsonb)') AS fn`);
    assert.equal(helper.fn, null, 'the helper function is dropped');

    // The summary counts the whole table (other rows too): it must at least cover these two.
    const summary = first.lines.find((line) => line.startsWith(LOG_PREFIX));
    const counted = Number(/ (\d+) audit row\(s\) cleaned/.exec(summary ?? '')?.[1] ?? 0);
    assert.ok(counted >= 2, `the cleaned rows are counted (${summary})`);
    assert.ok(first.lines.some((line) => /^ {2}users: \d+ row\(s\)$/.test(line)), 'the count per table is logged');
    assert.ok(first.lines.some((line) => /^ {2}tasks: \d+ row\(s\)$/.test(line)), 'the count per table is logged');

    // A second run changes nothing.
    const second = await captureLog(() => migration.up(runner));
    const again = await rowsOf(runner, Object.values(ids));
    for (const id of Object.values(ids)) {
      assert.equal(again.get(id).ctid, after.get(id).ctid, 'the second run rewrites no row');
    }
    assert.deepEqual(
      second.lines.filter((line) => line.startsWith(LOG_PREFIX)),
      [`${LOG_PREFIX} no audit row holds password_hash or mfa_secret, nothing changed`],
      'the second run says so',
    );
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
  console.log('audit-log-omit-user-secrets-migration.integration.spec: ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
