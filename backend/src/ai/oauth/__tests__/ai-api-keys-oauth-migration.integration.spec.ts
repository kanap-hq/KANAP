import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import { AiApiKeysOauthGrants1854050000000 as Migration } from '../../../migrations/1854050000000-ai-api-keys-oauth-grants';

// Migration 1854050000000 (MCP OAuth grants on ai_api_keys), against a real database, in a
// transaction that is rolled back. It runs as migrations do, without a tenant context:
// - down then up on a table that already holds an API key: the key reads as 'api_key',
//   with no OAuth field set, and nothing else of it changes;
// - a second up changes nothing and does not fail;
// - the credential kind is checked, and an authorization code jti is unique per tenant;
// - row level security of ai_api_keys is untouched.

const migration = new Migration();

async function setTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function clearTenant(runner: QueryRunner) {
  await runner.query(`SELECT set_config('app.current_tenant', '', true)`);
}

async function seed(runner: QueryRunner) {
  const tenantId = randomUUID();
  const roleId = randomUUID();
  const userId = randomUUID();
  const keyId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'OAuth migration', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `oauth-migration-${tenantId.slice(0, 8)}`],
  );
  await setTenant(runner, tenantId);
  await runner.query(
    `INSERT INTO roles (id, tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, $3, 'OAuth migration role', false, false, now(), now())`,
    [roleId, tenantId, `OAuth migration ${tenantId.slice(0, 8)}`],
  );
  await runner.query(
    `INSERT INTO users (id, tenant_id, email, role_id, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, 'enabled', now(), now())`,
    [userId, tenantId, `${tenantId.slice(0, 8)}@example.invalid`, roleId],
  );
  return { tenantId, userId, keyId };
}

async function insertLegacyKey(runner: QueryRunner, ids: { tenantId: string; userId: string; keyId: string }) {
  await setTenant(runner, ids.tenantId);
  await runner.query(
    `INSERT INTO ai_api_keys (id, tenant_id, user_id, key_hash, key_prefix, label, created_by_user_id)
     VALUES ($1, $2, $3, 'legacy-hash', 'abcdef012345', 'Desktop', $3)`,
    [ids.keyId, ids.tenantId, ids.userId],
  );
}

async function keyRow(runner: QueryRunner, tenantId: string, keyId: string) {
  await setTenant(runner, tenantId);
  const [row] = await runner.query(`SELECT * FROM ai_api_keys WHERE tenant_id = $1 AND id = $2`, [tenantId, keyId]);
  return row;
}

async function columns(runner: QueryRunner) {
  const rows: Array<{ column_name: string; is_nullable: string; column_default: string | null }> = await runner.query(
    `SELECT column_name, is_nullable, column_default FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'ai_api_keys'`,
  );
  return new Map(rows.map((row) => [row.column_name, row]));
}

async function rowSecurity(runner: QueryRunner) {
  const [row] = await runner.query(
    `SELECT relrowsecurity AS enabled, relforcerowsecurity AS forced FROM pg_class WHERE oid = 'ai_api_keys'::regclass`,
  );
  return row;
}

async function expectFailure(runner: QueryRunner, sql: string, params: unknown[], code: string) {
  await runner.query('SAVEPOINT expect_failure');
  try {
    await runner.query(sql, params);
    assert.fail(`expected ${code}`);
  } catch (error: any) {
    assert.equal(error?.code ?? error?.driverError?.code, code, String(error?.message));
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT expect_failure');
  }
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const security = await rowSecurity(runner);
    const ids = await seed(runner);

    await clearTenant(runner);
    await migration.down(runner);
    assert.equal((await columns(runner)).has('credential_kind'), false);
    await insertLegacyKey(runner, ids);
    const before = await keyRow(runner, ids.tenantId, ids.keyId);

    for (let pass = 1; pass <= 2; pass += 1) {
      await clearTenant(runner);
      await migration.up(runner);
      const row = await keyRow(runner, ids.tenantId, ids.keyId);
      assert.equal(row.credential_kind, 'api_key', `pass ${pass}`);
      assert.equal(row.oauth_remember, false);
      for (const column of ['oauth_client_id', 'oauth_client_name', 'oauth_redirect_uri', 'oauth_code_jti', 'refresh_rotated_at']) {
        assert.equal(row[column], null, `${column} stays empty`);
      }
      for (const [column, value] of Object.entries(before)) {
        assert.deepEqual(row[column], value, `${column} is untouched`);
      }
    }

    const cols = await columns(runner);
    assert.equal(cols.get('credential_kind')?.is_nullable, 'NO');
    assert.equal(cols.get('oauth_remember')?.is_nullable, 'NO');
    for (const column of ['oauth_client_id', 'oauth_client_name', 'oauth_redirect_uri', 'oauth_code_jti', 'refresh_rotated_at']) {
      assert.equal(cols.get(column)?.is_nullable, 'YES', column);
    }

    await setTenant(runner, ids.tenantId);
    await expectFailure(
      runner,
      `UPDATE ai_api_keys SET credential_kind = 'other' WHERE tenant_id = $1 AND id = $2`,
      [ids.tenantId, ids.keyId],
      '23514',
    );
    const jti = randomUUID();
    await runner.query(
      `INSERT INTO ai_api_keys (tenant_id, user_id, key_hash, key_prefix, label, created_by_user_id, credential_kind, oauth_code_jti)
       VALUES ($1, $2, 'h1', 'aaaaaaaaaaa1', 'Claude', $2, 'oauth', $3)`,
      [ids.tenantId, ids.userId, jti],
    );
    await expectFailure(
      runner,
      `INSERT INTO ai_api_keys (tenant_id, user_id, key_hash, key_prefix, label, created_by_user_id, credential_kind, oauth_code_jti)
       VALUES ($1, $2, 'h2', 'aaaaaaaaaaa2', 'Claude', $2, 'oauth', $3)`,
      [ids.tenantId, ids.userId, jti],
      '23505',
    );
    // Rows without a code (every API key) are not constrained by the index.
    await runner.query(
      `INSERT INTO ai_api_keys (tenant_id, user_id, key_hash, key_prefix, label, created_by_user_id)
       VALUES ($1, $2, 'h3', 'aaaaaaaaaaa3', 'Second key', $2)`,
      [ids.tenantId, ids.userId],
    );

    assert.deepEqual(await rowSecurity(runner), security, 'row level security is untouched');
    // eslint-disable-next-line no-console
    console.log('ai-api-keys-oauth-migration.integration.spec: OK');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
