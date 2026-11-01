import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { inRolledBackTransaction, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Asset } from '../asset.entity';
import { AssetsCrudService } from '../services/assets-crud.service';
import { AssetsValidationService } from '../services/assets-validation.service';

// Changing an asset's site rewrites the provider the way the screen does, unless the request names one.
// The same site leaves the provider as stored. A cloud site keeps its catalog provider; on premises uses other.
// A create without a site, or an update that clears it, is refused (asset_location_required).
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const settings = {
  serverKinds: [{ code: 'vm', label: 'Virtual machine' }],
  serverProviders: [
    { code: 'aws', label: 'AWS' },
    { code: 'azure', label: 'Azure' },
    { code: 'gcp', label: 'GCP' },
    { code: 'other', label: 'Other' },
  ],
  hostingTypes: [
    { code: 'on_prem', label: 'On premises', category: 'on_prem' },
    { code: 'public_cloud', label: 'Public cloud', category: 'cloud' },
  ],
  lifecycleStates: [{ code: 'active', label: 'Active' }],
  domains: [],
  adminZones: [],
  ipAddressTypes: [],
  subnets: [],
};

async function run() {
  await dataSource.initialize();
  try {
    await inRolledBackTransaction(async (runner) => {
      const tenantId = await seedTenant(runner, 'asset-site');
      const itOps = { getSettingsForWrite: async () => settings, getSettings: async () => settings } as any;
      const crud = new AssetsCrudService(
        runner.manager.getRepository(Asset),
        {} as any,
        { log: async () => undefined } as any,
        new AssetsValidationService(itOps),
        {} as any,
        { labelOf: async () => null } as any,
      );
      const opts = { manager: runner.manager, tenantId };
      const onPrem = randomUUID();
      const aws = randomUUID();
      const odd = randomUUID();
      const premAws = randomUUID();
      await runner.query(
        `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type, provider) VALUES
         ($1, $5, 'LOC-1', 'Paris', 'on_prem', NULL),
         ($2, $5, 'LOC-6', 'AWS', 'public_cloud', 'aws'),
         ($3, $5, 'LOC-7', 'Odd cloud', 'public_cloud', 'oracle'),
         ($4, $5, 'LOC-8', 'Cave', 'on_prem', 'aws')`,
        [onPrem, aws, odd, premAws, tenantId],
      );
      const asset = await crud.create(
        { name: 'Edge', kind: 'vm', provider: 'other', environment: 'prod', location_id: onPrem } as any,
        tenantId,
        null,
        opts,
      );
      assert.equal(asset.provider, 'other');

      const moved = await crud.update(asset.id, { location_id: aws } as any, tenantId, null, opts);
      assert.equal(moved.provider, 'aws');
      const unknown = await crud.update(asset.id, { location_id: odd } as any, tenantId, null, opts);
      assert.equal(unknown.provider, 'other');
      const cave = await crud.update(asset.id, { location_id: premAws } as any, tenantId, null, opts);
      assert.equal(cave.provider, 'other');

      const named = await crud.update(asset.id, { provider: 'gcp' } as any, tenantId, null, opts);
      assert.equal(named.provider, 'gcp');
      const sameSite = await crud.update(asset.id, { location_id: premAws } as any, tenantId, null, opts);
      assert.equal(sameSite.provider, 'gcp');
      const explicit = await crud.update(asset.id, { location_id: aws, provider: 'azure' } as any, tenantId, null, opts);
      assert.equal(explicit.provider, 'azure');

      // Every asset has a site: a create without one, or an update that clears it, is refused.
      const code = async (write: () => Promise<unknown>) => {
        try {
          await write();
        } catch (error) {
          return (error as { getResponse?: () => { code?: string } }).getResponse?.().code;
        }
        assert.fail('the write was accepted');
      };
      for (const location_id of [undefined, null, '', '  ']) {
        assert.equal(
          await code(() => crud.create({ name: 'Nowhere', kind: 'vm', provider: 'other', environment: 'prod', location_id } as any, tenantId, null, opts)),
          'asset_location_required',
          `create with location_id ${JSON.stringify(location_id)}`,
        );
        if (location_id === undefined) continue;
        assert.equal(
          await code(() => crud.update(asset.id, { location_id } as any, tenantId, null, opts)),
          'asset_location_required',
          `update with location_id ${JSON.stringify(location_id)}`,
        );
      }
      const [kept] = await runner.query(`SELECT location_id FROM assets WHERE id = $1`, [asset.id]);
      assert.equal(kept.location_id, aws);
      const [none] = await runner.query(`SELECT count(*)::int AS n FROM assets WHERE tenant_id = $1 AND name = 'Nowhere'`, [tenantId]);
      assert.equal(none.n, 0);
    });
  } finally {
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('asset site provider integration tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
