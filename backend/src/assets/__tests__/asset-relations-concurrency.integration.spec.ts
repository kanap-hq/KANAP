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
import { AiRelationMutationSupportService } from '../../ai/mutation/ai-relation-mutation-support.service';
import { AiTaskMutationSupportService } from '../../ai/mutation/ai-task-mutation-support.service';

// `addRelation` (the Netbox import attaching a virtual machine to its cluster)
// and `bulkReplaceRelations` (a person saving the cluster's relations) lock the
// cluster row the same way, so on two connections at once one waits for the
// other: no unique violation, and the relations match the order they ran in. The assistant's
// execution takes the same locks in the same order, so a cluster's absorption running at the
// same time cannot leave a host link behind it.

type Seed = { tenantId: string; cluster: string; host: string; vm1: string; vm2: string };

const auditService = new AuditService(dataSource.getRepository(AuditLog));
const service = new AssetsRelationsService(
  dataSource.getRepository(Asset),
  dataSource.getRepository(AssetRelation),
  dataSource.getRepository(AssetSpendItemLink),
  dataSource.getRepository(AssetContractLink),
  auditService,
);
const assistant = new AiRelationMutationSupportService(
  auditService,
  undefined as any,
  new AiTaskMutationSupportService(),
  undefined as any,
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
    const cluster = await asset('PAR-VSPHERE-CL01', true);
    const host = await asset('par-esx-01', false);
    await manager.query(
      `INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3)`,
      [tenantId, cluster, host],
    );
    return {
      tenantId,
      cluster,
      host,
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

/** The virtual machines the member host carries directly, as `vm1`/`vm2`. */
async function hostContained(seed: Seed): Promise<string[]> {
  return withTenantExecution(dataSource, seed.tenantId, async (manager) => {
    const rows: Array<{ related_asset_id: string }> = await manager.query(
      `SELECT related_asset_id FROM asset_relations
       WHERE tenant_id = $1 AND asset_id = $2 AND relation_type = 'contains'`,
      [seed.tenantId, seed.host],
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

/** The audit entries of the member host's relations, oldest first, with the names `vm1`/`vm2`. */
async function hostAudits(seed: Seed): Promise<Array<{ sourceRef: string | null; before: string[]; after: string[] }>> {
  return withTenantExecution(dataSource, seed.tenantId, async (manager) => {
    const rows: Array<{ source_ref: string | null; before_json: any; after_json: any }> = await manager.query(
      `SELECT source_ref, before_json, after_json FROM audit_log
       WHERE tenant_id = $1 AND table_name = 'asset_relations' AND record_id = $2
       ORDER BY created_at, id`,
      [seed.tenantId, seed.host],
    );
    const names: Record<string, string> = { [seed.vm1]: 'vm1', [seed.vm2]: 'vm2' };
    // The relations service logs `{ relations }`, the assistant its items (`payload`).
    const list = (value: any) => (Array.isArray(value) ? value.map((item: any) => item.payload ?? item) : value?.relations ?? [])
      .map((row: any) => `${row.relation_type}:${names[row.related_asset_id]}`)
      .sort();
    return rows.map((row) => ({ sourceRef: row.source_ref, before: list(row.before_json), after: list(row.after_json) }));
  });
}

/** The relations of the member host, as `type:vm`. */
async function hostRelations(seed: Seed): Promise<string[]> {
  return withTenantExecution(dataSource, seed.tenantId, async (manager) => {
    const rows: Array<{ related_asset_id: string; relation_type: string }> = await manager.query(
      `SELECT related_asset_id, relation_type FROM asset_relations WHERE tenant_id = $1 AND asset_id = $2`,
      [seed.tenantId, seed.host],
    );
    const names: Record<string, string> = { [seed.vm1]: 'vm1', [seed.vm2]: 'vm2' };
    return rows.map((row) => `${row.relation_type}:${names[row.related_asset_id]}`).sort();
  });
}

/**
 * The member host already contains vm1 (an old double); the assistant prepares, in its own
 * transaction, a preview on the host that keeps that link and adds `depends_on vm2`. Returns the
 * preview as `executePreview` reads it.
 */
async function hostKeepsLinkPreview(seed: Seed): Promise<any> {
  await withTenantExecution(dataSource, seed.tenantId, (manager) => manager.query(
    `INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type) VALUES ($1, $2, $3, 'contains')`,
    [seed.tenantId, seed.host, seed.vm1],
  ));
  const prepared = await withTenantExecution(dataSource, seed.tenantId, (manager) => assistant.prepareUpdatePreview(
    { manager, tenantId: seed.tenantId, userId: null } as any,
    { entity_type: 'assets', ref: seed.host, relation: 'relations', add: [{ related_asset_ref: seed.vm2, relation_type: 'depends_on' }] },
  ));
  return {
    id: randomUUID(),
    target_entity_type: 'assets',
    target_entity_id: prepared.targetEntityId,
    mutation_input: prepared.mutationInput,
    current_values: prepared.currentValues,
  };
}

const executeAs = (manager: any, seed: Seed, preview: any) =>
  assistant.executePreview({ manager, tenantId: seed.tenantId, userId: null } as any, preview);

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

    // The cluster attaches vm1 first; the member host waits, then is refused (R2): it would add
    // a second container the cluster already carries.
    {
      const seed = await seedTenant('cluster-before-host');
      made.push(seed.tenantId);
      const result = await overlap(
        seed,
        (m) => service.addRelation(seed.cluster, seed.vm1, 'contains', seed.tenantId, null, netboxOpts(m, seed.tenantId)),
        (m) => service.addRelation(seed.host, seed.vm1, 'contains', seed.tenantId, null, { manager: m, tenantId: seed.tenantId }),
      ).then(
        (value) => ({ ok: true as const, value }),
        (error: any) => ({ ok: false as const, error }),
      );
      assert.equal(result.ok, false);
      assert.equal((result as any).error?.getResponse?.().code, 'placement_inherited');
      assert.deepEqual(await contained(seed), ['vm1']);
      assert.deepEqual(await hostContained(seed), []);
    }

    // The member host attaches vm1 first; the cluster waits, then absorbs the host's link,
    // read again after its host lock.
    {
      const seed = await seedTenant('host-before-cluster');
      made.push(seed.tenantId);
      const result = await overlap(
        seed,
        (m) => service.addRelation(seed.host, seed.vm1, 'contains', seed.tenantId, null, netboxOpts(m, seed.tenantId)),
        (m) => service.addRelation(seed.cluster, seed.vm1, 'contains', seed.tenantId, null, { manager: m, tenantId: seed.tenantId }),
      );
      assert.equal(result, true);
      assert.deepEqual(await contained(seed), ['vm1']);
      assert.deepEqual(await hostContained(seed), []);
    }

    // The assistant keeps the host's `contains vm1` and runs first; the cluster's replacement
    // that takes vm1 waits for the cluster lock, then absorbs the link the assistant wrote again.
    // The host's audit entry from the absorption lists the relations the assistant left.
    {
      const seed = await seedTenant('assistant-before-cluster');
      made.push(seed.tenantId);
      const preview = await hostKeepsLinkPreview(seed);
      const result: any = await overlap(
        seed,
        (m) => executeAs(m, seed, preview),
        (m) => service.bulkReplaceRelations(seed.cluster, [{ related_asset_id: seed.vm1, relation_type: 'contains' }],
          seed.tenantId, null, { manager: m, tenantId: seed.tenantId }),
      );
      assert.deepEqual(result.replaced_host_links?.map((link: any) => link.host_id), [seed.host]);
      assert.deepEqual(await contained(seed), ['vm1']);
      assert.deepEqual(await hostRelations(seed), ['depends_on:vm2']);
      const audits = await hostAudits(seed);
      assert.deepEqual(audits.map((entry) => entry.sourceRef), [preview.id, null]);
      assert.deepEqual(audits[1], { sourceRef: null, before: ['contains:vm1', 'depends_on:vm2'], after: ['depends_on:vm2'] });
    }

    // The cluster takes vm1 first and absorbs the host's link; the assistant's execution waits
    // for the cluster lock, then finds the host's relations changed since the preview: refused,
    // nothing written again, and no audit entry from the assistant.
    {
      const seed = await seedTenant('cluster-before-assistant');
      made.push(seed.tenantId);
      const preview = await hostKeepsLinkPreview(seed);
      const result = await overlap(
        seed,
        (m) => service.bulkReplaceRelations(seed.cluster, [{ related_asset_id: seed.vm1, relation_type: 'contains' }],
          seed.tenantId, null, { manager: m, tenantId: seed.tenantId }),
        (m) => executeAs(m, seed, preview),
      ).then(
        () => ({ ok: true as const }),
        (error: any) => ({ ok: false as const, error }),
      );
      assert.equal(result.ok, false);
      assert.equal((result as any).error?.getStatus?.(), 409);
      assert.match(String((result as any).error?.message), /changed after the preview/);
      assert.deepEqual(await contained(seed), ['vm1']);
      assert.deepEqual(await hostRelations(seed), []);
      assert.deepEqual(await hostAudits(seed), [{ sourceRef: null, before: ['contains:vm1'], after: [] }]);
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
