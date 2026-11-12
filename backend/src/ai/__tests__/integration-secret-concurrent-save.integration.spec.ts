import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AiModelConfig } from '../ai-model-config.entity';
import { AiModelConfigService } from '../ai-model-config.service';
import { AiSecretCipherService } from '../ai-secret-cipher.service';
import { AiSettings } from '../ai-settings.entity';
import { AiSettingsService } from '../ai-settings.service';
import { AiAdapterConfigService } from '../control-plane/providers/adapter-config.service';
import { AiMonitoringIntegrationsService } from '../control-plane/providers/ai-monitoring-integrations.service';
import { AiTenantSecretResolverService } from '../control-plane/providers/tenant-secret-resolver.service';
import { AiAdapterConfig } from '../control-plane/providers/adapter-config.entity';
import { NETBOX_PROVIDER_KEY, NETBOX_PROVIDER_KIND, NetboxConfigService } from '../../netbox/netbox-config.service';

// Two saves of one integration at the same time: the second one reads the row while
// the first is still open and writes after it committed. A save never writes back a
// secret its own request did not change, and a secret stays with the address it was
// entered for.

process.env.AI_SETTINGS_ENCRYPTION_SECRET = process.env.AI_SETTINGS_ENCRYPTION_SECRET || 'concurrent-save-spec-secret';

const fakeCipher = { encrypt: (value: string) => `enc:${value}`, canEncrypt: () => true } as any;

function settingsService() {
  return new AiSettingsService(
    dataSource.getRepository(AiSettings),
    { validate: () => [], get: () => true } as any,
    fakeCipher,
    {} as any,
    { readiness: async () => ({ errors: [], errorCode: null, usesBuiltin: false, builtinIdentity: null }) } as any,
  );
}

function modelService() {
  return new AiModelConfigService(
    dataSource.getRepository(AiModelConfig),
    { validate: () => [], get: () => true } as any,
    fakeCipher,
  );
}

const realCipher = new AiSecretCipherService();

function prtgService() {
  return new AiMonitoringIntegrationsService(
    new AiAdapterConfigService(dataSource.getRepository(AiAdapterConfig)),
    new AiTenantSecretResolverService(realCipher),
    realCipher,
    {} as any,
  );
}

function netboxService() {
  return new NetboxConfigService(fakeCipher);
}

async function begin(tenantId: string): Promise<QueryRunner> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return runner;
}

async function inTenant<T>(tenantId: string, fn: (manager: EntityManager) => Promise<T>): Promise<T> {
  const runner = await begin(tenantId);
  try {
    const result = await fn(runner.manager);
    await runner.commitTransaction();
    return result;
  } catch (error) {
    await runner.rollbackTransaction();
    throw error;
  } finally {
    await runner.release();
  }
}

async function seedTenant(): Promise<string> {
  const tenantId = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Concurrent save test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `concurrent-save-${tenantId.slice(0, 8)}`],
  );
  return tenantId;
}

async function cleanup(tenantId: string) {
  await inTenant(tenantId, async (manager) => {
    await manager.query(`DELETE FROM ai_adapter_configs WHERE tenant_id = $1`, [tenantId]);
    await manager.query(`DELETE FROM ai_model_configs WHERE tenant_id = $1`, [tenantId]);
    await manager.query(`DELETE FROM ai_settings WHERE tenant_id = $1`, [tenantId]);
  }).catch(() => undefined);
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]).catch(() => undefined);
}

/**
 * Runs `first` in one transaction, then `second` in another whose first read of `table`
 * happens while `first` is still open and whose writes happen after `first` committed.
 */
async function race(
  tenantId: string,
  table: string,
  first: (manager: EntityManager) => Promise<unknown>,
  second: (manager: EntityManager) => Promise<unknown>,
) {
  const runner1 = await begin(tenantId);
  const runner2 = await begin(tenantId);
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  const original = runner2.query.bind(runner2);
  let gated = false;
  (runner2 as any).query = async (sql: string, params?: unknown[], structured?: boolean) => {
    const result = await original(sql, params, structured as any);
    if (!gated && /^\s*SELECT/i.test(sql) && sql.includes(`"${table}"`)) {
      gated = true;
      await gate;
    }
    return result;
  };
  try {
    await first(runner1.manager);
    const pending = second(runner2.manager).then(
      () => null,
      (error) => error as Error,
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    await runner1.commitTransaction();
    releaseGate();
    const error = await pending;
    if (error) throw error;
    await runner2.commitTransaction();
  } finally {
    releaseGate();
    if (runner1.isTransactionActive) await runner1.rollbackTransaction();
    if (runner2.isTransactionActive) await runner2.rollbackTransaction();
    await runner1.release();
    await runner2.release();
  }
}

async function readSettings(tenantId: string) {
  return inTenant(tenantId, async (manager) => (await manager.query(
    `SELECT glpi_url, glpi_user_token_encrypted, glpi_app_token_encrypted, mcp_enabled FROM ai_settings WHERE tenant_id = $1`,
    [tenantId],
  ))[0]);
}

async function readAdapter(tenantId: string, kind: string, key: string) {
  return inTenant(tenantId, async (manager) => (await manager.query(
    `SELECT base_url, credential_ref_json, metadata_json FROM ai_adapter_configs
      WHERE tenant_id = $1 AND provider_kind = $2 AND provider_key = $3`,
    [tenantId, kind, key],
  ))[0]);
}

const OLD_GLPI = 'https://glpi.example.com/';
const NEW_GLPI = 'https://glpi-new.example.com/';

async function seedGlpi(tenantId: string) {
  await inTenant(tenantId, (manager) => settingsService().update(tenantId, {
    mcp_enabled: true,
    glpi_url: OLD_GLPI,
    glpi_user_token: 'first-user-token',
    glpi_app_token: 'first-app-token',
  }, { manager }));
}

async function testGlpiSaveDoesNotBringBackEmptiedTokens(tenantId: string) {
  await seedGlpi(tenantId);
  await race(
    tenantId,
    'ai_settings',
    (manager) => settingsService().update(tenantId, { glpi_url: NEW_GLPI }, { manager }),
    (manager) => settingsService().update(tenantId, { mcp_enabled: false }, { manager }),
  );
  const row = await readSettings(tenantId);
  assert.equal(row.glpi_url, NEW_GLPI);
  assert.equal(row.mcp_enabled, false);
  assert.equal(row.glpi_user_token_encrypted, null);
  assert.equal(row.glpi_app_token_encrypted, null);
}

async function testGlpiTokenStaysWithTheAddressTypedWithIt(tenantId: string) {
  await seedGlpi(tenantId);
  await race(
    tenantId,
    'ai_settings',
    (manager) => settingsService().update(tenantId, { glpi_url: NEW_GLPI }, { manager }),
    // A page still showing the first address saves a new token with that address.
    (manager) => settingsService().update(tenantId, { glpi_url: OLD_GLPI, glpi_user_token: 'second-user-token' }, { manager }),
  );
  const row = await readSettings(tenantId);
  assert.equal(row.glpi_url, OLD_GLPI);
  assert.equal(row.glpi_user_token_encrypted, 'enc:second-user-token');
  assert.equal(row.glpi_app_token_encrypted, null, 'the app token was emptied with the address change');
}

async function testModelSaveDoesNotBringBackAnEmptiedKey(tenantId: string) {
  const created = await inTenant(tenantId, (manager) => modelService().create(tenantId, {
    name: 'Concurrent model',
    provider: 'custom',
    model: 'gpt-4o-mini',
    endpoint_url: 'https://models.example.com/v1',
    api_key: 'first-key',
  }, { manager }));
  await race(
    tenantId,
    'ai_model_configs',
    (manager) => modelService().update(tenantId, created.id, { endpoint_url: 'https://models-new.example.com/v1' }, { manager }),
    (manager) => modelService().update(tenantId, created.id, { supports_vision: false }, { manager }),
  );
  const row = await inTenant(tenantId, async (manager) => (await manager.query(
    `SELECT endpoint_url, api_key_encrypted, supports_vision FROM ai_model_configs WHERE id = $1`,
    [created.id],
  ))[0]);
  assert.equal(row.endpoint_url, 'https://models-new.example.com/v1');
  assert.equal(row.supports_vision, false);
  assert.equal(row.api_key_encrypted, null);
}

async function testPrtgSaveDoesNotBringBackAReplacedCredential(tenantId: string) {
  const context = (manager: EntityManager) => ({ tenantId, userId: '', manager }) as any;
  await inTenant(tenantId, (manager) => prtgService().savePrtgIntegration(context(manager), {
    base_url: 'https://prtg.example.com', enabled: false, api_token: 'first-token',
  }));
  await race(
    tenantId,
    'ai_adapter_configs',
    (manager) => prtgService().savePrtgIntegration(context(manager), {
      base_url: 'https://prtg-new.example.com', enabled: false, api_token: 'second-token',
    }),
    // A page still showing the first address saves another setting.
    (manager) => prtgService().savePrtgIntegration(context(manager), {
      base_url: 'https://prtg.example.com', enabled: false, server_timezone: 'Europe/Paris',
    }),
  );
  const row = await readAdapter(tenantId, 'monitoring', 'prtg');
  assert.equal(row.base_url, 'https://prtg.example.com');
  assert.equal(row.credential_ref_json, null, 'neither the first nor the second token goes with this address');
}

async function testNetboxSaveDoesNotBringBackAReplacedToken(tenantId: string) {
  await inTenant(tenantId, (manager) => netboxService().save(manager, tenantId, {
    base_url: 'https://netbox.example.com', enabled: false, api_token: 'first-token',
  }));
  await race(
    tenantId,
    'ai_adapter_configs',
    (manager) => netboxService().save(manager, tenantId, {
      base_url: 'https://netbox-new.example.com', api_token: 'second-token',
    }),
    (manager) => netboxService().save(manager, tenantId, {
      base_url: 'https://netbox.example.com', auto_sync: true,
    }),
  );
  const row = await readAdapter(tenantId, NETBOX_PROVIDER_KIND, NETBOX_PROVIDER_KEY);
  assert.equal(row.base_url, 'https://netbox.example.com');
  assert.equal(row.credential_ref_json, null, 'neither the first nor the second token goes with this address');
  assert.equal(row.metadata_json.auto_sync, true);
}

async function main() {
  await dataSource.initialize();
  let failed = 0;
  try {
    const tests: Array<[string, (tenantId: string) => Promise<void>]> = [
      ['GLPI: a concurrent save does not bring back emptied tokens', testGlpiSaveDoesNotBringBackEmptiedTokens],
      ['GLPI: a token typed with an address stays with that address', testGlpiTokenStaysWithTheAddressTypedWithIt],
      ['Model: a concurrent save does not bring back an emptied key', testModelSaveDoesNotBringBackAnEmptiedKey],
      ['PRTG: a concurrent save does not bring back a replaced credential', testPrtgSaveDoesNotBringBackAReplacedCredential],
      ['Netbox: a concurrent save does not bring back a replaced token', testNetboxSaveDoesNotBringBackAReplacedToken],
    ];
    for (const [name, test] of tests) {
      const tenantId = await seedTenant();
      try {
        await test(tenantId);
        console.log(`ok - ${name}`);
      } catch (error) {
        failed += 1;
        console.error(`not ok - ${name}`);
        console.error(error);
      } finally {
        await cleanup(tenantId);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
