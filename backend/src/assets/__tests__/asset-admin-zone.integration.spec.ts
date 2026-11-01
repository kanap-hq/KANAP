// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import { Asset } from '../asset.entity';
import { AssetClusterMember } from '../asset-cluster-member.entity';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { AssetsCrudService } from '../services/assets-crud.service';
import { AssetsListService } from '../services/assets-list.service';
import { AssetsValidationService } from '../services/assets-validation.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

// The administration zone of an asset: create and PATCH store a catalog code (a name is
// accepted), an unknown value is refused, the list sorts and filters on the column, and a
// zone in use cannot be removed from the catalog.

const audit = { log: async () => undefined };

function services(runner: QueryRunner) {
  const settings = new ItOpsSettingsService(runner.manager.getRepository(Tenant), runner.manager.getRepository(Location), audit as any);
  const validation = new AssetsValidationService(settings);
  const crud = new AssetsCrudService(
    runner.manager.getRepository(Asset),
    runner.manager.getRepository(AssetClusterMember),
    audit as any,
    validation,
    { notify: async () => undefined } as any,
    { labelOf: async () => null } as any,
  );
  const list = new AssetsListService(runner.manager.getRepository(Asset));
  return { settings, validation, crud, list };
}

/** A site for the tenant: every asset has one. */
async function site(runner: QueryRunner, tenantId: string): Promise<string> {
  const id = randomUUID();
  await runner.query(`INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, 'LOC-0', 'Site', 'on_prem')`, [id, tenantId]);
  return id;
}

async function testWriteAndList() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'asset-adz');
    const location_id = await site(runner, tenantId);
    const { settings, crud, list } = services(runner);
    const opts = { manager: runner.manager, tenantId };
    const saved = await settings.updateSettings(tenantId, { adminZones: [{ label: 'Tier 0' }, { label: 'Tier 1' }] as any }, { manager: runner.manager });

    const created = await crud.create(
      { name: 'dc1', kind: 'physical_server', provider: 'other', environment: 'prod', admin_zone: 'Tier 0', location_id },
      tenantId,
      null,
      opts,
    );
    assert.equal(created.admin_zone, 'tier_0');

    await assert.rejects(() => crud.update(created.id, { admin_zone: 'tier_9' } as any, tenantId, null, opts), /Unknown administration zone/);
    const patched = await crud.update(created.id, { admin_zone: 'tier_1' } as any, tenantId, null, opts);
    assert.equal(patched.admin_zone, 'tier_1');
    assert.equal((await crud.get(created.id, opts)).admin_zone, 'tier_1');

    const other = await crud.create(
      { name: 'app1', kind: 'physical_server', provider: 'other', environment: 'prod', admin_zone: 'tier_0', location_id },
      tenantId,
      null,
      opts,
    );
    await crud.create(
      { name: 'bare', kind: 'physical_server', provider: 'other', environment: 'prod', location_id },
      tenantId,
      null,
      opts,
    );

    const filtered = await list.list({ filters: JSON.stringify({ admin_zone: { filterType: 'set', values: ['tier_0'] } }), sort: 'name:ASC', limit: 50 }, opts);
    assert.deepEqual(filtered.items.map((row: any) => row.name), ['app1']);
    const sorted = await list.list({ sort: 'admin_zone:ASC', limit: 50 }, opts);
    assert.deepEqual(sorted.items.map((row: any) => row.name), ['app1', 'dc1', 'bare']);
    const values = await list.listFilterValues({ fields: 'admin_zone' }, opts);
    assert.deepEqual(values.admin_zone, ['tier_0', 'tier_1', null]);

    await assert.rejects(
      () => settings.updateSettings(tenantId, { adminZones: saved.adminZones.filter((zone) => zone.code !== 'tier_0') }, { manager: runner.manager }),
      (error: any) => {
        assert.equal(error.getResponse().code, 'CATALOG_VALUE_IN_USE');
        return true;
      },
    );

    const cleared = await crud.update(other.id, { admin_zone: null } as any, tenantId, null, opts);
    assert.equal(cleared.admin_zone, null);
  });
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTenant(runner, 'asset-adz-a');
    const { crud, list } = services(runner);
    await services(runner).settings.updateSettings(a, { adminZones: [{ label: 'Tier 0' }] as any }, { manager: runner.manager });
    await crud.create({ name: 'ours', kind: 'physical_server', provider: 'other', environment: 'prod', admin_zone: 'tier_0', location_id: await site(runner, a) }, a, null, { manager: runner.manager, tenantId: a });
    const b = await seedTenant(runner, 'asset-adz-b');
    await services(runner).settings.updateSettings(b, { adminZones: [{ label: 'Tier 0' }] as any }, { manager: runner.manager });
    await crud.create({ name: 'theirs', kind: 'physical_server', provider: 'other', environment: 'prod', admin_zone: 'tier_0', location_id: await site(runner, b) }, b, null, { manager: runner.manager, tenantId: b });
    await setTenant(runner, a);
    const result = await list.list({ filters: JSON.stringify({ admin_zone: { filterType: 'set', values: ['tier_0'] } }), limit: 50 }, { manager: runner.manager, tenantId: a });
    assert.deepEqual(result.items.map((row: any) => row.name), ['ours']);
  });
}

void runSpecs('Asset administration zone', [
  ['create, patch, list filter and sort, catalog in use', testWriteAndList],
  ['another tenant is left out of the filter', testTenantIsolation],
]);
