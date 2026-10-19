// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';
import { AssetContractLink } from '../asset-contract.entity';
import { AssetRelation } from '../asset-relation.entity';
import { AssetSpendItemLink } from '../asset-spend-item.entity';
import { Asset } from '../asset.entity';
import { AssetsRelationsService } from '../services/assets-relations.service';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { withTenantExecution } from '../../common/tenant-runner';

// `addRelation` (the Netbox import attaching a virtual machine to its cluster)
// and `bulkReplaceRelations` (a person saving the cluster's relations) lock the
// cluster row the same way, so on two connections at once one waits for the
// other: no unique violation, and the relations match the order they ran in.

type Seed = { tenantId: string; cluster: string; vm1: string; vm2: string };

const service = new AssetsRelationsService(
  dataSource.getRepository(Asset),
  dataSource.getRepository(AssetRelation),
  dataSource.getRepository(AssetSpendItemLink),
  dataSource.getRepository(AssetContractLink),
  new AuditService(dataSource.getRepository(AuditLog)),
);

async function seedTenant(tag: string): Promise<Seed> {
  const tenantId = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `rel-lock-${tag}-${tenantId.slice(0, 8)}`, `Relation lock ${tag}`],
  );
  return withTenantExecution(dataSource, tenantId, async (manager) => {
    const asset = async (name: string, isCluster: boolean) => (await manager.query(
      `INSERT INTO assets (tenant_id, name, kind, environment, status, hostname, is_cluster)
       VALUES ($1, $2, 'vm', 'prod', 'active', $3, $4) RETURNING id`,
      [tenantId, name, isCluster ? null : name, isCluster],
    ))[0].id as string;
    return {
      tenantId,
      cluster: await asset('PAR-VSPHERE-CL01', true),
      vm1: await asset('par-app-01', false),
      vm2: await asset('par-app-02', false),
    };
  });
}

async function contained(seed: Seed): Promise<string[]> {
  return withTenantExecution(dataSource, seed.tenantId, async (manager) => {
    const rows: Array<{ related_asset_id: string }> = await manager.query(
      `SELECT related_asset_id FROM asset_relations
       WHERE tenant_id = $1 AND asset_id = $2 AND relation_type = 'contains'`,
      [seed.tenantId, seed.cluster],
    );
    const names: Record<string, string> = { [seed.vm1]: 'vm1', [seed.vm2]: 'vm2' };
    return rows.map((row) => names[row.related_asset_id]).sort();
  });
}

/** The `before` of the latest replacement logged for the cluster. */
async function lastReplaceBefore(seed: Seed): Promise<string[]> {
  return withTenantExecution(dataSource, seed.tenantId, async (manager) => {
    const rows: Array<{ before_json: any }> = await manager.query(
      `SELECT before_json FROM audit_log
       WHERE tenant_id = $1 AND table_name = 'asset_relations' AND record_id = $2 AND source_ref IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [seed.tenantId, seed.cluster],
    );
    const names: Record<string, string> = { [seed.vm1]: 'vm1', [seed.vm2]: 'vm2' };
    return (rows[0]?.before_json?.relations ?? []).map((r: any) => names[r.related_asset_id]).sort();
  });
}

/**
 * Runs `first` in a transaction and, while it is still open, starts `second`
 * in another one. `second` must still be waiting when `first` commits.
 */
async function overlap<T>(
  seed: Seed,
  first: (manager: any) => Promise<unknown>,
  second: (manager: any) => Promise<T>,
): Promise<T> {
  let settled = false;
  let pending: Promise<T> | null = null;
  await withTenantExecution(dataSource, seed.tenantId, async (manager) => {
    await first(manager);
    pending = withTenantExecution(dataSource, seed.tenantId, (other) => second(other));
    pending.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(settled, false, 'the second writer waits for the first to commit');
  });
  return pending as unknown as Promise<T>;
}

const netboxOpts = (manager: any, tenantId: string) => ({ manager, tenantId, source: 'system', sourceRef: 'netbox' });

async function main() {
  await dataSource.initialize();
  const made: string[] = [];
  try {
    // A person replaces the relations first; the import adds vm1 meanwhile.
    // The addition waits, then lands next to the replacement.
    {
      const seed = await seedTenant('replace-first');
      made.push(seed.tenantId);
      const added = await overlap(
        seed,
        (m) => service.bulkReplaceRelations(seed.cluster, [{ related_asset_id: seed.vm2, relation_type: 'contains' }],
          seed.tenantId, null, { manager: m, tenantId: seed.tenantId }),
        (m) => service.addRelation(seed.cluster, seed.vm1, 'contains', seed.tenantId, null, netboxOpts(m, seed.tenantId)),
      );
      assert.equal(added, true);
      assert.deepEqual(await contained(seed), ['vm1', 'vm2']);
    }

    // The import adds vm1 first; a replacement saved meanwhile waits, then
    // replaces the relations as they are, vm1 included in its audit entry.
    {
      const seed = await seedTenant('add-first');
      made.push(seed.tenantId);
      await overlap(
        seed,
        (m) => service.addRelation(seed.cluster, seed.vm1, 'contains', seed.tenantId, null, netboxOpts(m, seed.tenantId)),
        (m) => service.bulkReplaceRelations(seed.cluster, [{ related_asset_id: seed.vm2, relation_type: 'contains' }],
          seed.tenantId, null, { manager: m, tenantId: seed.tenantId }),
      );
      assert.deepEqual(await contained(seed), ['vm2']);
      assert.deepEqual(await lastReplaceBefore(seed), ['vm1']);
    }

    // Both write the same relation, import first: the replacement used to meet
    // the uncommitted row and fail on the unique key. It now waits and saves.
    {
      const seed = await seedTenant('same-add-first');
      made.push(seed.tenantId);
      await overlap(
        seed,
        (m) => service.addRelation(seed.cluster, seed.vm1, 'contains', seed.tenantId, null, netboxOpts(m, seed.tenantId)),
        (m) => service.bulkReplaceRelations(seed.cluster, [{ related_asset_id: seed.vm1, relation_type: 'contains' }],
          seed.tenantId, null, { manager: m, tenantId: seed.tenantId }),
      );
      assert.deepEqual(await contained(seed), ['vm1']);
    }

    // Same relation, replacement first: the import finds it there and adds nothing.
    {
      const seed = await seedTenant('same-replace-first');
      made.push(seed.tenantId);
      const added = await overlap(
        seed,
        (m) => service.bulkReplaceRelations(seed.cluster, [{ related_asset_id: seed.vm1, relation_type: 'contains' }],
          seed.tenantId, null, { manager: m, tenantId: seed.tenantId }),
        (m) => service.addRelation(seed.cluster, seed.vm1, 'contains', seed.tenantId, null, netboxOpts(m, seed.tenantId)),
      );
      assert.equal(added, false);
      assert.deepEqual(await contained(seed), ['vm1']);
    }

    console.log('asset-relations-concurrency.integration.spec.ts OK');
  } finally {
    for (const tenantId of made) {
      await withTenantExecution(dataSource, tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES))
        .catch((error) => console.error(`could not purge ${tenantId}:`, error));
      await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId])
        .catch((error) => console.error(`could not delete ${tenantId}:`, error));
    }
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
