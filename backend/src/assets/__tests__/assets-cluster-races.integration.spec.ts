// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';
import { withTenantExecution } from '../../common/tenant-runner';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { DEFAULT_HOSTING_TYPES, DEFAULT_TECHNOLOGY_FAMILIES, ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { TechnologyCatalogService } from '../../technologies/catalog/technology-catalog.service';
import { OperatingSystemService, ResolvedOperatingSystem } from '../../technologies/operating-system.service';
import { AssetClusterMember } from '../asset-cluster-member.entity';
import { Asset } from '../asset.entity';
import { AssetsCrudService } from '../services/assets-crud.service';
import { AssetsValidationService } from '../services/assets-validation.service';

// The cluster rules hold when two writers meet on one cluster, on two connections at once: the
// first writer holds the cluster row, the second waits, then decides on what the first committed.
// - an operating system set meanwhile refuses the first member (`cluster_os_with_members`);
// - a cluster switched back to a plain asset meanwhile gets no member (400);
// - a cluster deleted meanwhile answers 404 (no foreign-key 500);
// - and the reverse ways: members added meanwhile refuse the operating system and the switch.

type Seed = { tenantId: string; cluster: string; node: string; ubuntu: ResolvedOperatingSystem };

const logged: string[] = [];
const audit = { log: async (entry: { table: string }) => { logged.push(entry.table); } };
const itOps = { getSettings: async () => ({ technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES, hostingTypes: DEFAULT_HOSTING_TYPES }) };
const os = new OperatingSystemService(audit as any, itOps as any, new TechnologyCatalogService(audit as any, itOps as any));
const crud = new AssetsCrudService(
  dataSource.getRepository(Asset),
  dataSource.getRepository(AssetClusterMember),
  audit as any,
  new AssetsValidationService(new ItOpsSettingsService(dataSource.getRepository(Tenant), dataSource.getRepository(Location), audit as any)),
  { notify: async () => undefined } as any,
  os,
);

async function seedTenant(tag: string): Promise<Seed> {
  const tenantId = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `cl-race-${tag}-${tenantId.slice(0, 8)}`, `Cluster race ${tag}`],
  );
  return withTenantExecution(dataSource, tenantId, async (manager) => {
    const asset = async (name: string, isCluster: boolean) => (await manager.query(
      `INSERT INTO assets (tenant_id, name, kind, environment, status, hostname, is_cluster)
       VALUES ($1, $2, 'vm', 'prod', 'active', $3, $4) RETURNING id`,
      [tenantId, name, isCluster ? null : name, isCluster],
    ))[0].id as string;
    const ubuntu = await os.resolve(manager, tenantId, 'Ubuntu 22.04', { create: true });
    assert.ok(ubuntu);
    return { tenantId, cluster: await asset('esx-cluster', true), node: await asset('esx-01', false), ubuntu: ubuntu! };
  });
}

/**
 * Runs `first` in a transaction and, while it is still open, starts `second` in another one.
 * `second` must still be waiting when `first` commits. Returns how `second` ended.
 */
async function overlap(
  seed: Seed,
  first: (manager: any) => Promise<unknown>,
  second: (manager: any) => Promise<unknown>,
): Promise<{ ok: true } | { ok: false; status?: number; code?: string; message: string }> {
  let settled = false;
  let pending: Promise<unknown> | null = null;
  await withTenantExecution(dataSource, seed.tenantId, async (manager) => {
    await first(manager);
    pending = withTenantExecution(dataSource, seed.tenantId, (other) => second(other));
    pending.then(() => { settled = true; }, () => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 400));
    assert.equal(settled, false, 'the second writer waits for the first to commit');
  });
  try {
    await pending;
    return { ok: true };
  } catch (error: any) {
    const response = typeof error?.getResponse === 'function' ? error.getResponse() : null;
    return {
      ok: false,
      status: typeof error?.getStatus === 'function' ? error.getStatus() : undefined,
      code: response?.code,
      message: String(error?.message ?? error),
    };
  }
}

async function memberCount(seed: Seed): Promise<number> {
  return withTenantExecution(dataSource, seed.tenantId, async (manager) => {
    const [row] = await manager.query(
      `SELECT count(*)::int AS n FROM asset_cluster_members WHERE tenant_id = $1 AND cluster_id = $2`,
      [seed.tenantId, seed.cluster],
    );
    return row.n as number;
  });
}

async function osLabel(seed: Seed): Promise<string | null> {
  return withTenantExecution(dataSource, seed.tenantId, (manager) => os.labelOf(manager, seed.tenantId, seed.cluster));
}

const opts = (manager: any, tenantId: string) => ({ manager, tenantId });

async function main() {
  await dataSource.initialize();
  const made: string[] = [];
  const seedFor = async (tag: string) => {
    const seed = await seedTenant(tag);
    made.push(seed.tenantId);
    return seed;
  };
  try {
    // The operating system first; the first member waits, then is refused.
    {
      const seed = await seedFor('os-first');
      const result = await overlap(
        seed,
        (m) => os.setOperatingSystem(m, seed.tenantId, seed.cluster, seed.ubuntu, 'manual'),
        (m) => crud.replaceClusterMembers(seed.cluster, [seed.node], seed.tenantId, null, opts(m, seed.tenantId)),
      );
      assert.equal(result.ok, false);
      assert.equal((result as any).code, 'cluster_os_with_members');
      assert.equal(await memberCount(seed), 0);
      assert.equal(await osLabel(seed), 'Ubuntu 22.04');
    }

    // Switched back to a plain asset first; the members wait, then are refused.
    {
      const seed = await seedFor('switch-first');
      logged.length = 0;
      const result = await overlap(
        seed,
        (m) => crud.update(seed.cluster, { is_cluster: false } as any, seed.tenantId, null, opts(m, seed.tenantId)),
        (m) => crud.replaceClusterMembers(seed.cluster, [seed.node], seed.tenantId, null, opts(m, seed.tenantId)),
      );
      assert.deepEqual(result.ok ? result : { ok: false, status: (result as any).status }, { ok: false, status: 400 });
      // Refused on the locked row, before any member is written (not by the listing after it).
      assert.deepEqual(logged.filter((table) => table === 'asset_cluster_members'), []);
      assert.equal(await memberCount(seed), 0);
    }

    // Deleted first; the members wait, then get a 404.
    {
      const seed = await seedFor('delete-first');
      const result = await overlap(
        seed,
        (m) => m.query(`DELETE FROM assets WHERE tenant_id = $1 AND id = $2`, [seed.tenantId, seed.cluster]),
        (m) => crud.replaceClusterMembers(seed.cluster, [seed.node], seed.tenantId, null, opts(m, seed.tenantId)),
      );
      assert.deepEqual(result.ok ? result : { ok: false, status: (result as any).status }, { ok: false, status: 404 });
    }

    // Members first; the operating system waits, then is refused.
    {
      const seed = await seedFor('members-then-os');
      const result = await overlap(
        seed,
        (m) => crud.replaceClusterMembers(seed.cluster, [seed.node], seed.tenantId, null, opts(m, seed.tenantId)),
        (m) => os.setOperatingSystem(m, seed.tenantId, seed.cluster, seed.ubuntu, 'manual'),
      );
      assert.equal((result as any).code, 'os_cluster_with_members');
      assert.equal(await memberCount(seed), 1);
      assert.equal(await osLabel(seed), null);
    }

    // Members first; the switch waits, then is refused.
    {
      const seed = await seedFor('members-then-switch');
      const result = await overlap(
        seed,
        (m) => crud.replaceClusterMembers(seed.cluster, [seed.node], seed.tenantId, null, opts(m, seed.tenantId)),
        (m) => crud.update(seed.cluster, { is_cluster: false } as any, seed.tenantId, null, opts(m, seed.tenantId)),
      );
      assert.equal((result as any).code, 'cluster_has_members');
      assert.equal(await memberCount(seed), 1);
    }

    console.log('assets-cluster-races.integration.spec.ts OK');
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
