import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import dataSource from '../../data-source';
import { inRolledBackTransaction, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Asset } from '../asset.entity';
import { AssetsCrudService } from '../services/assets-crud.service';
import { AssetsValidationService } from '../services/assets-validation.service';

// A malformed IP is a 400 `asset_ip_invalid` on create and on update. A valid address is stored.
// An empty entry is skipped. There is no database check on the address text.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const settings = {
  serverKinds: [{ code: 'vm', label: 'Virtual machine' }],
  serverProviders: [{ code: 'other', label: 'Other' }],
  lifecycleStates: [{ code: 'active', label: 'Active' }],
  domains: [],
  adminZones: [],
  ipAddressTypes: [{ code: 'host', label: 'Host' }],
  subnets: [],
};

async function refused(run: () => Promise<unknown>): Promise<{ code: string; params: { value: string } }> {
  try {
    await run();
  } catch (err) {
    assert.ok(err instanceof BadRequestException, String(err));
    assert.equal(err.getStatus(), 400);
    return err.getResponse() as { code: string; params: { value: string } };
  }
  assert.fail('expected a 400');
}

async function run() {
  await dataSource.initialize();
  try {
    await inRolledBackTransaction(async (runner) => {
      const tenantId = await seedTenant(runner, 'asset-ip');
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
      const siteId = randomUUID();
      await runner.query(`INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, 'LOC-0', 'Site', 'on_prem')`, [siteId, tenantId]);
      const base = { name: 'Edge', kind: 'vm', provider: 'other', environment: 'prod', location_id: siteId };

      const created = await refused(() => crud.create(
        { ...base, ip_addresses: [{ type: 'host', ip: '999.999.1.1', subnet_cidr: null }] } as any,
        tenantId,
        null,
        opts,
      ));
      assert.equal(created.code, 'asset_ip_invalid');
      assert.equal(created.params.value, '999.999.1.1');

      const asset = await crud.create(
        { ...base, name: 'Edge ok', ip_addresses: [{ type: 'host', ip: '10.1.2.3', subnet_cidr: null }, { type: 'host', ip: '2001:db8::1', subnet_cidr: null }] } as any,
        tenantId,
        null,
        opts,
      );
      assert.deepEqual(asset.ip_addresses, [
        { type: 'host', ip: '10.1.2.3', subnet_cidr: null },
        { type: 'host', ip: '2001:db8::1', subnet_cidr: null },
      ]);

      const updated = await refused(() => crud.update(
        asset.id,
        { ip_addresses: [{ type: 'host', ip: 'not-an-ip', subnet_cidr: null }] } as any,
        tenantId,
        null,
        opts,
      ));
      assert.equal(updated.code, 'asset_ip_invalid');
      assert.equal(updated.params.value, 'not-an-ip');
      const [stored] = await runner.query(`SELECT ip_addresses FROM assets WHERE id = $1`, [asset.id]);
      assert.equal(stored.ip_addresses[0].ip, '10.1.2.3');

      const blank = await crud.update(
        asset.id,
        { ip_addresses: [{ type: 'host', ip: '   ', subnet_cidr: null }] } as any,
        tenantId,
        null,
        opts,
      );
      assert.equal(blank.ip_addresses, null);
    });
  } finally {
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('asset ip validation integration tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
