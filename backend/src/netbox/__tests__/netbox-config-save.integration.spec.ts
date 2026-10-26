import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { NETBOX_PROVIDER_KEY, NETBOX_PROVIDER_KIND, NetboxConfigService } from '../netbox-config.service';

// Saving a new address or a new token drops the stored connection test, and
// that write touches only the test key. An empty token keeps the stored secret
// and the test that belongs to it.

const STORED_URL = 'https://netbox.example.com';
const STORED_TOKEN = { kind: 'secret', ciphertext: 'stored-token' };
const LAST_TEST = { ok: true, tested_at: '2026-10-24T19:38:00.000Z' };

function service() {
  return new NetboxConfigService({
    canEncrypt: () => true,
    encrypt: (value: string) => `enc:${value}`,
  } as any);
}

async function seed(runner: QueryRunner): Promise<{ tenantId: string; configId: string }> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Netbox test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `netbox-save-${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const rows = await runner.query(
    `INSERT INTO ai_adapter_configs
       (tenant_id, provider_kind, provider_key, implementation, environment, enabled, base_url,
        credential_ref_json, metadata_json, updated_at)
     VALUES ($1, $2, $3, 'netbox', 'production', true, $4, $5::jsonb, $6::jsonb, '2026-01-01T00:00:00Z')
     RETURNING id`,
    [
      tenantId,
      NETBOX_PROVIDER_KIND,
      NETBOX_PROVIDER_KEY,
      STORED_URL,
      JSON.stringify(STORED_TOKEN),
      JSON.stringify({ role_map: { server: 'physical_server' }, last_connection_test: LAST_TEST }),
    ],
  );
  return { tenantId, configId: rows[0].id };
}

async function readRow(runner: QueryRunner, configId: string) {
  const rows = await runner.query(
    `SELECT base_url, credential_ref_json, metadata_json, updated_at FROM ai_adapter_configs WHERE id = $1`,
    [configId],
  );
  return rows[0];
}

/** Runs `fn` on the clear statement, which removes only the test key. */
function watchClear(runner: QueryRunner, configId: string): { sawClear: () => boolean } {
  const original = runner.manager.query.bind(runner.manager);
  let saw = false;
  runner.manager.query = (async (sql: string, params?: unknown[]) => {
    const text = String(sql);
    if (!saw && text.includes('last_connection_test') && text.includes('-')) {
      saw = true;
      assert.equal(text.includes('base_url'), false);
      assert.equal(text.includes('credential_ref_json'), false);
      assert.equal(text.includes('updated_at'), false);
      assert.equal(text.includes('tenant_id'), true);
      // A mapping written while the save is in flight must survive the clear.
      await original(
        `UPDATE ai_adapter_configs
            SET metadata_json = jsonb_set(metadata_json, '{role_map}', '{"server":"virtual_machine"}'::jsonb)
          WHERE id = $1`,
        [configId],
      );
    }
    return original(sql, params);
  }) as typeof runner.manager.query;
  return { sawClear: () => saw };
}

async function inTransaction(name: string, fn: (runner: QueryRunner) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
    console.log(`ok - ${name}`);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function main() {
  await dataSource.initialize();
  try {
    await inTransaction('a new address drops the stored test and keeps a mapping written during the clear', async (runner) => {
      const { tenantId, configId } = await seed(runner);
      const watch = watchClear(runner, configId);
      const view = await service().save(runner.manager, tenantId, { base_url: 'https://other.example.com/' });
      assert.equal(view.last_test, null);
      assert.equal(view.base_url, 'https://other.example.com');
      assert.equal(watch.sawClear(), true);
      const row = await readRow(runner, configId);
      assert.equal(row.base_url, 'https://other.example.com');
      assert.deepEqual(row.credential_ref_json, STORED_TOKEN);
      assert.equal(row.metadata_json.last_connection_test, undefined);
      assert.deepEqual(row.metadata_json.role_map, { server: 'virtual_machine' });
    });

    await inTransaction('a new token drops the stored test and keeps the address', async (runner) => {
      const { tenantId, configId } = await seed(runner);
      const view = await service().save(runner.manager, tenantId, { api_token: 'nbt_new' });
      assert.equal(view.last_test, null);
      assert.equal(view.base_url, STORED_URL);
      const row = await readRow(runner, configId);
      assert.equal(row.base_url, STORED_URL);
      assert.deepEqual(row.credential_ref_json, { kind: 'encrypted', ciphertext: 'enc:nbt_new', material_shape: 'api_token' });
      assert.equal(row.metadata_json.last_connection_test, undefined);
      assert.deepEqual(row.metadata_json.role_map, { server: 'physical_server' });
    });

    await inTransaction('an empty token on the same address keeps the stored test', async (runner) => {
      const { tenantId, configId } = await seed(runner);
      const view = await service().save(runner.manager, tenantId, { api_token: '   ', auto_sync: true });
      assert.deepEqual(view.last_test, LAST_TEST);
      assert.equal(view.auto_sync, true);
      const row = await readRow(runner, configId);
      assert.equal(row.base_url, STORED_URL);
      assert.deepEqual(row.credential_ref_json, STORED_TOKEN);
      assert.deepEqual(row.metadata_json.last_connection_test, LAST_TEST);
      assert.equal(row.metadata_json.auto_sync, true);
    });

    await inTransaction('sending the stored address again keeps the test', async (runner) => {
      const { tenantId, configId } = await seed(runner);
      const view = await service().save(runner.manager, tenantId, { base_url: `${STORED_URL}/` });
      assert.deepEqual(view.last_test, LAST_TEST);
      const row = await readRow(runner, configId);
      assert.equal(row.base_url, STORED_URL);
      assert.deepEqual(row.metadata_json.last_connection_test, LAST_TEST);
    });
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
