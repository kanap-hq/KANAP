import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import * as assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import dataSource from '../../data-source';
import { inRolledBackTransaction, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { Asset } from '../asset.entity';
import { AssetsDeleteService } from '../assets-delete.service';
import { AssetsCrudService } from '../services/assets-crud.service';
import { AssetsValidationService } from '../services/assets-validation.service';

// GET /assets/AST-n resolves the reference (a suffix is ignored) and answers 404 for an unknown
// one. A value that is not a uuid never reaches a uuid column. Delete uses the same resolution.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const settings = {
  serverKinds: [{ code: 'vm', label: 'Virtual machine' }],
  serverProviders: [{ code: 'other', label: 'Other' }],
  lifecycleStates: [{ code: 'active', label: 'Active' }],
  domains: [],
  adminZones: [],
  ipAddressTypes: [],
  subnets: [],
};

async function missing(run: () => Promise<unknown>): Promise<void> {
  try {
    await run();
  } catch (err) {
    assert.ok(err instanceof NotFoundException, String(err));
    assert.equal((err as NotFoundException).getStatus(), 404);
    return;
  }
  assert.fail('expected a 404');
}

async function run() {
  await dataSource.initialize();
  try {
    await inRolledBackTransaction(async (runner) => {
      const tenantId = await seedTenant(runner, 'asset-ref');
      const otherId = await seedTenant(runner, 'asset-ref-other');
      await setTenant(runner, tenantId);
      const itOps = { getSettingsForWrite: async () => settings, getSettings: async () => settings } as any;
      const repo = runner.manager.getRepository(Asset);
      const crud = new AssetsCrudService(
        repo,
        {} as any,
        { log: async () => undefined } as any,
        new AssetsValidationService(itOps),
        {} as any,
        { labelOf: async () => null } as any,
      );
      const audit = { entries: [] as Array<{ recordId?: string | null }>, log: async (entry: { recordId?: string | null }) => { audit.entries.push(entry); } };
      const remove = new AssetsDeleteService(repo, audit as any);
      const opts = { manager: runner.manager, tenantId };

      const siteId = randomUUID();
      await runner.query(`INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, 'LOC-0', 'Site', 'on_prem')`, [siteId, tenantId]);
      const created = await crud.create(
        { name: 'Edge', kind: 'vm', provider: 'other', environment: 'prod', location_id: siteId } as any,
        tenantId,
        null,
        opts,
      );
      const [stored] = await runner.query(`SELECT asset_reference FROM assets WHERE id = $1`, [created.id]);
      const reference = String(stored.asset_reference);
      assert.match(reference, /^AST-\d+$/);

      await setTenant(runner, otherId);
      await runner.query(
        `INSERT INTO assets (tenant_id, name, kind, provider, environment, status) VALUES ($1, 'Other', 'vm', 'other', 'prod', 'active')`,
        [otherId],
      );
      // Each tenant numbers from AST-1. A reference that exists only next door must stay invisible here.
      await runner.query(`UPDATE assets SET asset_reference = 'AST-88001' WHERE tenant_id = $1`, [otherId]);
      await setTenant(runner, tenantId);

      const byReference = await crud.get(reference, opts);
      assert.equal(byReference.id, created.id);
      const byLower = await crud.get(reference.toLowerCase(), opts);
      assert.equal(byLower.id, created.id);
      const bySuffix = await crud.get(`${reference}-west`, opts);
      assert.equal(bySuffix.id, created.id);

      await missing(() => crud.get('AST-999999', opts));
      await missing(() => crud.get('not-a-uuid', opts));
      await missing(() => crud.get('AST-88001', opts));

      // A version 7 uuid (time-ordered) is an id like any other.
      const v7 = '01927f3e-8c4a-7b21-9d3e-5a6b7c8d9e0f';
      await runner.query(`UPDATE assets SET id = $2 WHERE tenant_id = $1 AND id = $3`, [tenantId, v7, created.id]);
      assert.equal((await crud.get(v7, opts)).id, v7);
      await runner.query(`UPDATE assets SET id = $2 WHERE tenant_id = $1 AND id = $3`, [tenantId, created.id, v7]);

      const deleted = await remove.deleteAsset(reference, tenantId, null, { manager: runner.manager });
      assert.equal(deleted.deleted, true);
      assert.equal(audit.entries[0]?.recordId, created.id);
      const left = await runner.query(`SELECT id FROM assets WHERE id = $1`, [created.id]);
      assert.equal(left.length, 0);
      await missing(() => remove.deleteAsset('AST-999999', tenantId, null, { manager: runner.manager }));
    });
  } finally {
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('asset reference integration tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
