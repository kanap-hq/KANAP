import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { NETBOX_PROVIDER_KEY, NETBOX_PROVIDER_KIND, NetboxConfigService } from '../netbox-config.service';
import { NetboxSyncService } from '../netbox-sync.service';

// The connection test calls Netbox, which can take minutes, then keeps its
// outcome on the configuration. That write must touch only the outcome: a save
// made during the call (address, token, mappings) survives it, and an outcome
// about values that changed meanwhile, or about values typed in the dialog and
// not saved, is not recorded.

const STORED_URL = 'https://netbox.example.com';
const STORED_TOKEN = { kind: 'secret', ciphertext: 'stored-token' };

async function seed(runner: QueryRunner): Promise<{ tenantId: string; configId: string }> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Netbox test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `netbox-test-${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const rows = await runner.query(
    `INSERT INTO ai_adapter_configs
       (tenant_id, provider_kind, provider_key, implementation, environment, enabled, base_url,
        credential_ref_json, metadata_json, updated_at)
     VALUES ($1, $2, $3, 'netbox', 'production', true, $4, $5::jsonb,
             '{"role_map":{"server":"physical_server"}}'::jsonb, '2026-01-01T00:00:00Z')
     RETURNING id`,
    [tenantId, NETBOX_PROVIDER_KIND, NETBOX_PROVIDER_KEY, STORED_URL, JSON.stringify(STORED_TOKEN)],
  );
  return { tenantId, configId: rows[0].id };
}

function services(onCall: () => Promise<void>) {
  const config = new NetboxConfigService({ canEncrypt: () => true } as any);
  (config as any).buildConnection = () => ({});
  const client = { getVersion: async () => { await onCall(); return '4.1.0'; } };
  const sync = new NetboxSyncService({} as any, config, client as any, {} as any, {} as any, {} as any);
  return { config, sync };
}

async function readRow(runner: QueryRunner, configId: string) {
  const rows = await runner.query(
    `SELECT base_url, credential_ref_json, metadata_json, updated_at FROM ai_adapter_configs WHERE id = $1`,
    [configId],
  );
  return rows[0];
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
    await inTransaction('a mapping saved during the test survives, the outcome is recorded', async (runner) => {
      const { tenantId, configId } = await seed(runner);
      const { sync } = services(async () => {
        await runner.query(
          `UPDATE ai_adapter_configs SET metadata_json = jsonb_set(metadata_json, '{role_map}', '{"server":"virtual_machine"}'::jsonb) WHERE id = $1`,
          [configId],
        );
      });
      const result: any = await sync.testConnection(runner.manager, tenantId, {});
      assert.equal(result.ok, true);
      assert.equal(result.persisted, true);
      const row = await readRow(runner, configId);
      assert.deepEqual(row.metadata_json.role_map, { server: 'virtual_machine' });
      assert.equal(row.metadata_json.last_connection_test.ok, true);
      assert.equal(row.metadata_json.last_connection_test.tested_at, result.tested_at);
      assert.equal(new Date(row.updated_at).toISOString(), '2026-01-01T00:00:00.000Z');
    });

    await inTransaction('a token saved during the test survives, the stale outcome is dropped', async (runner) => {
      const { tenantId, configId } = await seed(runner);
      const newToken = { kind: 'secret', ciphertext: 'new-token' };
      const { sync } = services(async () => {
        await runner.query(`UPDATE ai_adapter_configs SET credential_ref_json = $2::jsonb WHERE id = $1`, [
          configId,
          JSON.stringify(newToken),
        ]);
      });
      const result: any = await sync.testConnection(runner.manager, tenantId, {});
      assert.equal(result.persisted, false);
      const row = await readRow(runner, configId);
      assert.deepEqual(row.credential_ref_json, newToken);
      assert.equal(row.metadata_json.last_connection_test, undefined);
    });

    await inTransaction('an address saved during the test survives, the stale outcome is dropped', async (runner) => {
      const { tenantId, configId } = await seed(runner);
      const { sync } = services(async () => {
        await runner.query(`UPDATE ai_adapter_configs SET base_url = 'https://other.example.com' WHERE id = $1`, [configId]);
      });
      const result: any = await sync.testConnection(runner.manager, tenantId, {});
      assert.equal(result.persisted, false);
      const row = await readRow(runner, configId);
      assert.equal(row.base_url, 'https://other.example.com');
      assert.deepEqual(row.credential_ref_json, STORED_TOKEN);
      assert.equal(row.metadata_json.last_connection_test, undefined);
    });

    await inTransaction('values typed in the dialog are tested without recording the outcome', async (runner) => {
      const { tenantId, configId } = await seed(runner);
      const { sync } = services(async () => undefined);
      const typedToken: any = await sync.testConnection(runner.manager, tenantId, { api_token: 'typed' });
      assert.equal(typedToken.ok, true);
      assert.equal(typedToken.persisted, false);
      const typedUrl: any = await sync.testConnection(runner.manager, tenantId, { base_url: 'https://typed.example.com' });
      assert.equal(typedUrl.persisted, false);
      assert.equal((await readRow(runner, configId)).metadata_json.last_connection_test, undefined);
      const sameUrl: any = await sync.testConnection(runner.manager, tenantId, { base_url: STORED_URL });
      assert.equal(sameUrl.persisted, true);
    });
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
