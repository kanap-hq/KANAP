import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { NETBOX_PROVIDER_KEY, NETBOX_PROVIDER_KIND, NetboxConfigService } from '../netbox-config.service';

// Saving a new address or a new token drops the stored connection test, and
// that write touches only the test key. An empty token keeps the stored secret
// and the test that belongs to it, as long as the address stays the same: the
// stored token only goes to the address it was entered for.

const STORED_URL = 'https://netbox.example.com';
// The form the save path writes (an encrypted credential reference) and the service reads.
const STORED_TOKEN = { kind: 'encrypted', ciphertext: 'enc:stored-token', material_shape: 'api_token' };
const LAST_TEST = { ok: true, tested_at: '2026-10-24T19:38:00.000Z' };
// What the runs against the stored server left: the hourly run, the first import read
// by a person and the last run shown on the page.
const SERVER_STATE = {
  auto_sync: true,
  first_manual_sync_at: '2026-10-01T00:00:00.000Z',
  sync_state: { status: 'success', trigger: 'manual', started_at: '2026-10-01T00:00:00.000Z' },
};

function service() {
  return new NetboxConfigService({
    canEncrypt: () => true,
    encrypt: (value: string) => `enc:${value}`,
    decrypt: (value: string) => value.replace(/^enc:/, ''),
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

async function auditRows(runner: QueryRunner, configId: string) {
  return runner.query(
    `SELECT action, before_json, after_json FROM audit_log WHERE table_name = 'ai_adapter_configs' AND record_id = $1`,
    [configId],
  );
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
    await inTransaction('the seeded token is the form the service reads and sends', async (runner) => {
      const { tenantId } = await seed(runner);
      const config = await service().getConfig(runner.manager, tenantId);
      assert.equal(service().toView(config).credential.present, true);
      assert.equal(service().buildConnection(config).token, 'stored-token');
    });

    await inTransaction('a new address drops the stored test and keeps a mapping written during the clear', async (runner) => {
      const { tenantId, configId } = await seed(runner);
      const watch = watchClear(runner, configId);
      const view = await service().save(runner.manager, tenantId, { base_url: 'https://other.example.com/', api_token: 'nbt_other' });
      assert.equal(view.last_test, null);
      assert.equal(view.base_url, 'https://other.example.com');
      assert.equal(watch.sawClear(), true);
      const row = await readRow(runner, configId);
      assert.equal(row.base_url, 'https://other.example.com');
      assert.deepEqual(row.credential_ref_json, { kind: 'encrypted', ciphertext: 'enc:nbt_other', material_shape: 'api_token' });
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
      assert.equal(view.credential.present, true);
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
      assert.deepEqual(row.credential_ref_json, STORED_TOKEN);
    });

    await inTransaction('another spelling of the stored address keeps the token', async (runner) => {
      const { tenantId, configId } = await seed(runner);
      await service().save(runner.manager, tenantId, { base_url: 'HTTPS://NetBox.Example.com:443/' });
      const row = await readRow(runner, configId);
      assert.deepEqual(row.credential_ref_json, STORED_TOKEN);
    });

    await inTransaction('a new address without a token empties the stored one, with a trace', async (runner) => {
      const { tenantId, configId } = await seed(runner);
      const view = await service().save(runner.manager, tenantId, {
        enabled: false,
        base_url: 'https://other.example.com',
      }, { userId: null });
      assert.equal(view.credential.present, false);
      const row = await readRow(runner, configId);
      assert.equal(row.base_url, 'https://other.example.com');
      assert.equal(row.credential_ref_json, null);
      const audits = await auditRows(runner, configId);
      assert.equal(audits.length, 1);
      assert.equal(audits[0].action, 'update');
      assert.equal(audits[0].before_json.base_url, STORED_URL);
      assert.equal(audits[0].before_json.credential.present, true);
      assert.equal(audits[0].after_json.base_url, 'https://other.example.com');
      assert.equal(audits[0].after_json.credential.present, false);
      assert.doesNotMatch(JSON.stringify(audits), /stored-token|ciphertext/);
    });

    await inTransaction('another server starts with a manual review; another spelling keeps the reviewed one', async (runner) => {
      const { tenantId, configId } = await seed(runner);
      await runner.query(
        `UPDATE ai_adapter_configs SET metadata_json = metadata_json || $2::jsonb WHERE id = $1`,
        [configId, JSON.stringify({ ...SERVER_STATE, review_pending: 3 })],
      );
      await service().save(runner.manager, tenantId, { base_url: 'HTTPS://NetBox.Example.com:443/' });
      let row = await readRow(runner, configId);
      assert.equal(row.metadata_json.first_manual_sync_at, SERVER_STATE.first_manual_sync_at);
      assert.equal(row.metadata_json.review_pending, 3);
      assert.deepEqual(row.metadata_json.sync_state, SERVER_STATE.sync_state);

      const view = await service().save(runner.manager, tenantId, { base_url: 'https://other.example.com', api_token: 'nbt_other' });
      assert.equal(view.manual_sync_done, false, 'the hourly run waits for a person to read the new server');
      row = await readRow(runner, configId);
      assert.equal(row.metadata_json.first_manual_sync_at, undefined);
      assert.equal(row.metadata_json.review_pending, undefined);
      assert.equal(row.metadata_json.sync_state, undefined, 'the last run of the previous server is not shown');
      assert.equal(row.metadata_json.auto_sync, true, 'the setting stays; it applies once the review is done');
      assert.deepEqual(row.metadata_json.role_map, { server: 'physical_server' }, 'the matches stay');
    });

    await inTransaction('an enabled connection moved without its token is refused', async (runner) => {
      const { tenantId, configId } = await seed(runner);
      await assert.rejects(
        () => service().save(runner.manager, tenantId, { base_url: 'https://other.example.com' }),
        (error: any) => error?.getResponse?.()?.code === 'netbox_token_needed_for_address',
      );
      const row = await readRow(runner, configId);
      assert.equal(row.base_url, STORED_URL);
      assert.deepEqual(row.credential_ref_json, STORED_TOKEN);
    });

    await inTransaction('an empty address removes the connection, keeps the matches and leaves a trace', async (runner) => {
      const { tenantId, configId } = await seed(runner);
      await runner.query(
        `UPDATE ai_adapter_configs
            SET metadata_json = metadata_json || $2::jsonb
          WHERE id = $1`,
        [configId, JSON.stringify({ ...SERVER_STATE, review_pending: 0 })],
      );
      const view = await service().save(runner.manager, tenantId, { base_url: '', api_token: 'nbt_ignored' }, { userId: null });
      assert.equal(view.configured, false);
      assert.equal(view.enabled, false);
      assert.equal(view.base_url, null);
      assert.equal(view.credential.present, false);
      assert.equal(view.auto_sync, false);
      assert.equal(view.last_test, null);
      const row = await readRow(runner, configId);
      assert.equal(row.base_url, null);
      assert.equal(row.credential_ref_json, null);
      assert.deepEqual(row.metadata_json.role_map, { server: 'physical_server' }, 'the matches stay');
      assert.equal(row.metadata_json.first_manual_sync_at, undefined, 'a new server starts with a manual review');
      assert.equal(row.metadata_json.last_connection_test, undefined);
      assert.equal(row.metadata_json.sync_state, undefined, 'the last run of the removed server is not shown');
      const audits = await auditRows(runner, configId);
      assert.equal(audits.length, 1);
      assert.equal(audits[0].action, 'update');
      assert.equal(audits[0].before_json.base_url, STORED_URL);
      assert.equal(audits[0].before_json.credential.present, true);
      assert.equal(audits[0].after_json.base_url, null);
      assert.equal(audits[0].after_json.credential.present, false);
      assert.doesNotMatch(JSON.stringify(audits), /stored-token|nbt_ignored|ciphertext/);
    });

    await inTransaction('once removed, an empty address is refused again and a typed token is not lost silently', async (runner) => {
      const { tenantId, configId } = await seed(runner);
      await service().save(runner.manager, tenantId, { base_url: '' }, { userId: null });
      await assert.rejects(
        () => service().save(runner.manager, tenantId, { base_url: '', api_token: 'nbt_typed_after' }, { userId: null }),
        (error: any) => error?.getResponse?.()?.code === 'netbox_base_url_invalid',
      );
      const row = await readRow(runner, configId);
      assert.equal(row.credential_ref_json, null);
      assert.equal((await auditRows(runner, configId)).length, 1, 'no entry without a change');
    });

    await inTransaction('an empty address with nothing saved is refused', async (runner) => {
      const tenantId = randomUUID();
      await runner.query(
        `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
         VALUES ($1, $2, 'Netbox empty', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
        [tenantId, `netbox-empty-${tenantId.slice(0, 8)}`],
      );
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
      await assert.rejects(
        () => service().save(runner.manager, tenantId, { base_url: '' }),
        (error: any) => error?.getResponse?.()?.code === 'netbox_base_url_invalid',
      );
    });
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
