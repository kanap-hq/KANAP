import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { countCatalogUsage, usedCatalogCodes } from '../catalog-usage';
import { ItOpsSettingsService } from '../it-ops-settings.service';

/**
 * An asset type that a Netbox role match names is in use: the usage counts the Netbox matches, the
 * save that removes the type is refused, and restoring the default lists keeps it. Without that,
 * the synchronisation would skip the objects of that role once the type is gone. Only the
 * workspace's own Netbox connection counts; matches stored in another shape never break a count.
 */
async function main() {
  await dataSource.initialize();
  const tenantId = randomUUID();
  const neighbourId = randomUUID();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  const settings = new ItOpsSettingsService(runner.manager.getRepository(Tenant), runner.manager.getRepository(Location), { log: async () => undefined } as any);
  const asTenant = (id: string) => runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [id]);
  const netbox = (id: string, metadata: unknown, kind = 'inventory', key = 'netbox') => runner.query(
    `INSERT INTO ai_adapter_configs (tenant_id, provider_kind, provider_key, implementation, environment, enabled, metadata_json)
     VALUES ($1, $2, $3, $3, 'production', false, $4::jsonb)`,
    [id, kind, key, JSON.stringify(metadata)],
  );
  try {
    for (const id of [tenantId, neighbourId]) {
      await runner.query(`INSERT INTO tenants(id, slug, name, metadata) VALUES ($1, $2, 'Netbox role usage', $3::jsonb)`, [
        id,
        `netbox-roles-${id.slice(0, 8)}`,
        JSON.stringify({ it_ops: { server_kinds: [
          { code: 'switch_kind', label: 'Switch kind', is_physical: true },
          { code: 'free_kind', label: 'Free kind', is_physical: false },
        ] } }),
      ]);
    }
    await asTenant(neighbourId);
    await netbox(neighbourId, { role_map: { router: 'free_kind' } });
    await asTenant(tenantId);
    await netbox(tenantId, { role_map: { switch: 'switch_kind', 'core-switch': 'switch_kind' } });
    // Another kind of connection with the same shape is not a Netbox match.
    await netbox(tenantId, { role_map: { probe: 'free_kind' } }, 'monitoring', 'prtg');

    assert.deepEqual(
      await countCatalogUsage(runner.manager, tenantId, 'serverKinds', { code: 'switch_kind' }),
      [{ record: 'netbox_role_matches', count: 1, listPath: undefined }],
    );
    assert.deepEqual(await countCatalogUsage(runner.manager, tenantId, 'serverKinds', { code: 'free_kind' }), [], 'the neighbour and the PRTG row do not count');
    const used = await usedCatalogCodes(runner.manager, tenantId, 'serverKinds');
    assert.equal(used.has('switch_kind'), true);
    assert.equal(used.has('free_kind'), false);

    // The save that removes the type is refused with the Netbox matches named; the other type goes.
    const current = await settings.getSettings(tenantId, { manager: runner.manager });
    await assert.rejects(
      () => settings.updateSettings(tenantId, { serverKinds: current.serverKinds.filter((row) => row.code !== 'switch_kind') }, { manager: runner.manager }),
      (error: any) => {
        const body = error?.getResponse?.();
        return body?.code === 'CATALOG_VALUE_IN_USE'
          && body.usages?.some((usage: any) => usage.type === 'netbox_role_matches')
          && /the Netbox role matches/.test(String(body.message));
      },
    );
    const saved = await settings.updateSettings(tenantId, { serverKinds: current.serverKinds.filter((row) => row.code !== 'free_kind') }, { manager: runner.manager });
    assert.equal(saved.serverKinds.some((row) => row.code === 'free_kind'), false);

    // The restore keeps the type the matches name.
    await runner.query(`UPDATE tenants SET metadata = jsonb_set(metadata, '{it_ops,server_kinds}', $2::jsonb) WHERE id = $1`, [
      tenantId,
      JSON.stringify([{ code: 'switch_kind', label: 'Switch kind', is_physical: true }, { code: 'free_kind', label: 'Free kind', is_physical: false }]),
    ]);
    const restored = await settings.resetToDefaults(tenantId, { manager: runner.manager, userId: null });
    assert.equal(restored.serverKinds.some((row) => row.code === 'switch_kind'), true, 'the matched type stays');
    assert.equal(restored.serverKinds.some((row) => row.code === 'free_kind'), false, 'the free type goes');

    // Matches stored in another shape name nothing and break nothing.
    await runner.query(`UPDATE ai_adapter_configs SET metadata_json = '{"role_map": "switch_kind"}'::jsonb WHERE tenant_id = $1 AND provider_kind = 'inventory'`, [tenantId]);
    assert.deepEqual(await countCatalogUsage(runner.manager, tenantId, 'serverKinds', { code: 'switch_kind' }), []);
    assert.equal((await usedCatalogCodes(runner.manager, tenantId, 'serverKinds')).size, 0);
    console.log('PASS: an asset type named by a Netbox role match counts as used, for the save guard and the restore');
  } finally {
    await runner.rollbackTransaction().catch(() => undefined);
    await runner.release().catch(() => undefined);
    await dataSource.destroy();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
