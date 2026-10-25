// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import dataSource from '../../data-source';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';
import { AssetContractLink } from '../../assets/asset-contract.entity';
import { AssetRelation } from '../../assets/asset-relation.entity';
import { AssetSpendItemLink } from '../../assets/asset-spend-item.entity';
import { Asset } from '../../assets/asset.entity';
import { AssetsRelationsService } from '../../assets/services/assets-relations.service';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { withTenantExecution } from '../../common/tenant-runner';
import { TechnologyReachService } from '../../technologies/technology-reach.service';
import { NETBOX_VIRTUAL_MACHINES_SLUG, normalizeNetboxVirtualMachine } from '../netbox-mapper';
import { NetboxConfigService } from '../netbox-config.service';
import { NetboxSyncService } from '../netbox-sync.service';
import { NetboxObject } from '../netbox.types';

// Virtual machines attached to their KANAP cluster by the Netbox import, against
// a real database. The inventory comes from a simulated client; everything else
// (plan, preview, runs, the relation write and its audit entry) is the real
// code. The seed is committed, because a run writes in transactions of its own,
// and every tenant it made is purged at the end.

const BASE_URL = 'https://netbox.example.test';

type Seed = {
  tenantId: string;
  locationId: string;
  clusters: Record<'paris' | 'gouda', string>;
  server: string;
  vms: Record<string, string>;
};

const inventories = new Map<string, NetboxObject[]>();

function vm(id: number, name: string, cluster: { id: number; name: string } | null): NetboxObject {
  return normalizeNetboxVirtualMachine({
    id,
    name,
    status: { value: 'active' },
    site: { slug: 'paris', name: 'Paris DC' },
    cluster,
  }, BASE_URL);
}

const PARIS = { id: 7, name: 'Paris vSphere' };
const GOUDA = { id: 8, name: 'Gouda vSphere' };
const PARMA = { id: 9, name: 'Parma vSphere' };

function buildService(): { sync: NetboxSyncService; config: NetboxConfigService } {
  const audit = new AuditService(dataSource.getRepository(AuditLog));
  const relations = new AssetsRelationsService(
    dataSource.getRepository(Asset),
    dataSource.getRepository(AssetRelation),
    dataSource.getRepository(AssetSpendItemLink),
    dataSource.getRepository(AssetContractLink),
    audit,
  );
  // The asset services the sync calls. The relation is the real service; a
  // creation inserts the bare row a new machine needs; an asset field change
  // is not expected in these scenarios and fails loudly.
  const assets: any = {
    addRelation: relations.addRelation.bind(relations),
    addRelationWithPlacement: relations.addRelationWithPlacement.bind(relations),
    createLink: async () => undefined,
    upsertHardwareInfo: async () => undefined,
    update: async () => {
      throw new Error('no asset field should change in this spec');
    },
    create: async (body: Record<string, unknown>, tenantId: string, _user: unknown, opts: { manager: EntityManager }) => {
      const rows = await opts.manager.query(
        `INSERT INTO assets (tenant_id, name, kind, environment, location_id, status, hostname)
         VALUES ($1, $2, $3, $4, $5, 'active', $6) RETURNING id`,
        [tenantId, body.name, body.kind, body.environment, body.location_id, body.hostname ?? null],
      );
      return { id: rows[0].id };
    },
  };
  const itOpsSettings: any = {
    getSettings: async () => ({
      serverKinds: [{ code: 'vm', label: 'Virtual machine' }],
      serverProviders: [{ code: 'other', label: 'Other' }],
      lifecycleStates: [{ code: 'active', label: 'Active' }],
      ipAddressTypes: [{ code: 'host', label: 'Host' }],
      domains: [],
      subnets: [],
    }),
  };
  const client: any = {
    listDevices: async () => ({ objects: [], complete: true }),
    listVirtualMachines: async (connection: { tenantId: string }) => ({
      objects: inventories.get(connection.tenantId) ?? [],
      complete: true,
    }),
    listLocations: async () => ({ locations: [], complete: true }),
  };
  const config = new NetboxConfigService({ canEncrypt: () => true } as any);
  // The token is never decrypted: the simulated client reads the tenant instead.
  config.buildConnection = ((stored: any) => ({ baseUrl: BASE_URL, token: 'test', tenantId: stored.tenant_id })) as any;
  const sync = new NetboxSyncService(dataSource, config, client, itOpsSettings, assets, {} as any);
  return { sync, config };
}

async function seedTenant(tag: string, clusterMap: (seed: Omit<Seed, 'tenantId'> & { tenantId: string }) => Record<string, string>): Promise<Seed> {
  const tenantId = randomUUID();
  await dataSource.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `netbox-cl-${tag}-${tenantId.slice(0, 8)}`, `Netbox clusters ${tag}`],
  );
  return withTenantExecution(dataSource, tenantId, async (manager) => {
    const one = async (sql: string, params: unknown[]) => (await manager.query(sql, params))[0].id as string;
    const locationId = await one(
      `INSERT INTO locations (tenant_id, name, hosting_type, location_reference)
       VALUES ($1, 'Paris DC', 'on_prem', $2) RETURNING id`,
      [tenantId, `LOC-CL-${tenantId.slice(0, 8)}`],
    );
    const asset = (name: string, isCluster = false) => one(
      `INSERT INTO assets (tenant_id, name, kind, environment, location_id, status, hostname, is_cluster)
       VALUES ($1, $2, 'vm', 'prod', $3, 'active', $4, $5) RETURNING id`,
      [tenantId, name, locationId, isCluster ? null : name, isCluster],
    );
    const clusters = { paris: await asset('PAR-VSPHERE-CL01', true), gouda: await asset('GOU-VSPHERE-CL01', true) };
    const server = await asset('par-esx-01');
    const vms: Record<string, string> = {};
    for (const name of ['par-app-01', 'par-app-02', 'par-app-03', 'gou-app-01', 'pma-app-01']) {
      vms[name] = await asset(name);
    }
    const seed = { tenantId, locationId, clusters, server, vms };
    await manager.query(
      `INSERT INTO ai_adapter_configs
         (tenant_id, provider_kind, provider_key, implementation, environment, enabled, base_url,
          credential_ref_json, live_test_safety, metadata_json)
       VALUES ($1, 'inventory', 'netbox', 'netbox', 'production', true, $2, $3::jsonb, 'mock_only', $4::jsonb)`,
      [
        tenantId,
        BASE_URL,
        JSON.stringify({ kind: 'encrypted', ciphertext: 'not-used' }),
        JSON.stringify({
          role_map: { [NETBOX_VIRTUAL_MACHINES_SLUG]: 'vm' },
          site_map: { paris: locationId },
          cluster_map: clusterMap(seed),
        }),
      ],
    );
    return seed;
  });
}

async function relations(tenantId: string): Promise<string[]> {
  return withTenantExecution(dataSource, tenantId, async (manager) => {
    const rows: Array<{ container: string; content: string }> = await manager.query(
      `SELECT c.name AS container, v.name AS content
       FROM asset_relations r
       JOIN assets c ON c.tenant_id = $1 AND c.id = r.asset_id
       JOIN assets v ON v.tenant_id = $1 AND v.id = r.related_asset_id
       WHERE r.tenant_id = $1 AND r.relation_type = 'contains'
       ORDER BY c.name, v.name`,
      [tenantId],
    );
    return rows.map((row) => `${row.container} > ${row.content}`);
  });
}

async function addContains(tenantId: string, container: string, content: string) {
  await withTenantExecution(dataSource, tenantId, (manager) => manager.query(
    `INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type) VALUES ($1, $2, $3, 'contains')`,
    [tenantId, container, content],
  ));
}

async function preview(sync: NetboxSyncService, tenantId: string) {
  return withTenantExecution(dataSource, tenantId, (manager) => sync.preview(manager, tenantId, {}));
}

/** A manual run that applies everything its preview listed. */
async function manualRun(sync: NetboxSyncService, tenantId: string) {
  const shown = await preview(sync, tenantId);
  const reviewed = new Set(shown.rows.map((row) => `${row.external_type}:${row.external_id}`));
  return (sync as any).executeRun(tenantId, [], reviewed) as Promise<{ counts: Record<string, number>; warnings: any[] }>;
}

async function purge(tenantId: string) {
  await withTenantExecution(dataSource, tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES));
  await dataSource.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
}

async function main() {
  await dataSource.initialize();
  const made: string[] = [];
  try {
    const { sync, config } = buildService();

    // Tenant A: Paris and Gouda matched, Parma not.
    const a = await seedTenant('a', (seed) => ({ [PARIS.id]: seed.clusters.paris, [GOUDA.id]: seed.clusters.gouda }));
    made.push(a.tenantId);
    // par-app-02 was put in its cluster by hand; gou-app-01 sits in Paris in
    // KANAP while Netbox runs it in Gouda.
    await addContains(a.tenantId, a.clusters.paris, a.vms['par-app-02']);
    await addContains(a.tenantId, a.clusters.paris, a.vms['gou-app-01']);
    inventories.set(a.tenantId, [
      vm(50, 'par-app-01', PARIS),
      vm(51, 'par-app-02', PARIS),
      vm(52, 'gou-app-01', GOUDA),
      vm(53, 'pma-app-01', PARMA),
      vm(54, 'new-app-01', PARIS),
    ]);

    // --- the preview -------------------------------------------------------
    {
      const shown = await preview(sync, a.tenantId);
      assert.equal(shown.ok, true);
      const byName = (name: string) => shown.rows.find((row) => row.external_name === name);
      assert.deepEqual(byName('par-app-01')?.diffs, [{ field: 'cluster', before: null, after: 'PAR-VSPHERE-CL01' }]);
      assert.equal(byName('par-app-01')?.action, 'update');
      // Already in its cluster by hand: nothing to show.
      assert.equal(byName('par-app-02'), undefined);
      // Another cluster already holds it: the Netbox one is added, the other pointed out.
      assert.deepEqual(byName('gou-app-01')?.diffs, [{ field: 'cluster', before: 'PAR-VSPHERE-CL01', after: 'GOU-VSPHERE-CL01' }]);
      assert.deepEqual(
        byName('gou-app-01')?.warnings.map((notice) => [notice.code, notice.params.value]),
        [['cluster_other_present', 'PAR-VSPHERE-CL01']],
      );
      // Parma is not matched: one notice for the cluster, nothing on the machine.
      assert.equal(byName('pma-app-01'), undefined);
      assert.deepEqual(shown.notices.map((notice) => [notice.code, notice.params.value]), [['cluster_not_mapped', 'Parma vSphere']]);
      assert.equal(byName('new-app-01')?.action, 'create');
      assert.deepEqual(byName('new-app-01')?.diffs, [{ field: 'cluster', before: null, after: 'PAR-VSPHERE-CL01' }]);
      // A preview writes nothing.
      assert.deepEqual(await relations(a.tenantId), ['PAR-VSPHERE-CL01 > gou-app-01', 'PAR-VSPHERE-CL01 > par-app-02']);
    }

    // --- the manual run, then a second one --------------------------------
    {
      const first = await manualRun(sync, a.tenantId);
      assert.equal(first.counts.update, 2, JSON.stringify(first.counts));
      assert.equal(first.counts.create, 1);
      assert.equal(first.counts.error, 0);
      assert.deepEqual(await relations(a.tenantId), [
        'GOU-VSPHERE-CL01 > gou-app-01',
        'PAR-VSPHERE-CL01 > gou-app-01',
        'PAR-VSPHERE-CL01 > new-app-01',
        'PAR-VSPHERE-CL01 > par-app-01',
        'PAR-VSPHERE-CL01 > par-app-02',
      ]);
      // The write is audited on the cluster, as the Netbox import.
      const audit = await withTenantExecution(dataSource, a.tenantId, (manager) => manager.query(
        `SELECT record_id, source, source_ref, before_json, after_json FROM audit_log
         WHERE tenant_id = $1 AND table_name = 'asset_relations' ORDER BY created_at`,
        [a.tenantId],
      ));
      assert.equal(audit.length, 3);
      assert.ok(audit.every((entry: any) => entry.source === 'system' && entry.source_ref === 'netbox'));
      const gouda = audit.find((entry: any) => entry.record_id === a.clusters.gouda);
      assert.deepEqual(gouda.before_json, { relations: [] });
      assert.deepEqual(gouda.after_json, { relations: [{ related_asset_id: a.vms['gou-app-01'], relation_type: 'contains' }] });

      // The other cluster is pointed out in the preview only: the record keeps no notice for it.
      const kept = await withTenantExecution(dataSource, a.tenantId, (manager) => manager.query(
        `SELECT message_code FROM asset_external_links
         WHERE tenant_id = $1 AND source = 'netbox' AND external_name = 'gou-app-01'`,
        [a.tenantId],
      ));
      assert.deepEqual(kept, [{ message_code: null }]);

      const again = await preview(sync, a.tenantId);
      assert.equal(again.counts.update, 0);
      assert.equal(again.counts.create, 0);
      // Still pointed out, still not removed.
      const gou = again.rows.find((row) => row.external_name === 'gou-app-01');
      assert.equal(gou?.action, 'unchanged');
      assert.equal(gou?.warnings[0]?.code, 'cluster_other_present');
      const second = await manualRun(sync, a.tenantId);
      assert.equal(second.counts.update, 0);
      assert.equal((await relations(a.tenantId)).length, 5);
    }

    // --- the hourly run adds what Netbox reports since --------------------
    {
      inventories.set(a.tenantId, [...(inventories.get(a.tenantId) ?? []), vm(55, 'par-app-03', PARIS)]);
      const scheduled = await sync.runInBackground(a.tenantId, 'scheduled');
      assert.equal(scheduled.status, 'success');
      assert.equal(scheduled.counts?.update, 1);
      assert.ok((await relations(a.tenantId)).includes('PAR-VSPHERE-CL01 > par-app-03'));
    }

    // --- a match that points at an asset unable to take the machines ------
    {
      await withTenantExecution(dataSource, a.tenantId, (manager) => manager.query(
        `UPDATE ai_adapter_configs
         SET metadata_json = jsonb_set(metadata_json, '{cluster_map}', $2::jsonb)
         WHERE tenant_id = $1 AND provider_kind = 'inventory'`,
        [a.tenantId, JSON.stringify({ [PARIS.id]: a.clusters.paris, [GOUDA.id]: a.clusters.gouda, [PARMA.id]: a.server })],
      ));
      const shown = await preview(sync, a.tenantId);
      assert.deepEqual(shown.notices.map((notice) => notice.code), ['cluster_match_invalid']);
      const scheduled = await sync.runInBackground(a.tenantId, 'scheduled');
      assert.equal(scheduled.status, 'success');
      const state = await withTenantExecution(dataSource, a.tenantId, async (manager) => config.readSyncState(await config.getConfig(manager, a.tenantId)));
      assert.ok(state.warnings.some((notice) => notice.code === 'cluster_match_invalid'));
      assert.ok(!(await relations(a.tenantId)).some((entry) => entry.endsWith('pma-app-01')));
    }

    // --- a member host is replaced by its cluster (R1) ---------------------
    // par-app-01 is carried by the member host par-esx-01 in KANAP while Netbox runs it in the
    // Paris cluster: the import replaces the host link, and the preview says `placement`.
    {
      const c = await seedTenant('placement', (seed) => ({ [PARIS.id]: seed.clusters.paris }));
      made.push(c.tenantId);
      await withTenantExecution(dataSource, c.tenantId, (manager) => manager.query(
        `INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3)`,
        [c.tenantId, c.clusters.paris, c.server],
      ));
      await addContains(c.tenantId, c.server, c.vms['par-app-01']);
      await addContains(c.tenantId, c.clusters.paris, c.vms['par-app-02']);
      inventories.set(c.tenantId, [vm(50, 'par-app-01', PARIS), vm(51, 'par-app-02', PARIS)]);

      const shown = await preview(sync, c.tenantId);
      const row = shown.rows.find((entry) => entry.external_name === 'par-app-01');
      assert.equal(row?.action, 'update');
      assert.deepEqual(row?.diffs, [{ field: 'placement', before: 'par-esx-01', after: 'PAR-VSPHERE-CL01' }]);
      assert.equal(row?.warnings.length, 0);
      // Already in the cluster: nothing to show.
      assert.equal(shown.rows.find((entry) => entry.external_name === 'par-app-02'), undefined);
      assert.equal(shown.counts.update, 1);

      const run = await manualRun(sync, c.tenantId);
      assert.equal(run.counts.update, 1, JSON.stringify(run.counts));
      assert.equal(run.counts.error, 0);
      assert.deepEqual(await relations(c.tenantId), [
        'PAR-VSPHERE-CL01 > par-app-01',
        'PAR-VSPHERE-CL01 > par-app-02',
      ]);
      // The cluster link and the removed host link are both audited as the Netbox import.
      const audit = await withTenantExecution(dataSource, c.tenantId, (manager) => manager.query(
        `SELECT record_id, action, source, source_ref, before_json, after_json FROM audit_log
         WHERE tenant_id = $1 AND table_name = 'asset_relations' ORDER BY created_at, table_name`,
        [c.tenantId],
      ));
      assert.equal(audit.length, 2);
      assert.ok(audit.every((entry: any) => entry.source === 'system' && entry.source_ref === 'netbox'));
      const hostEntry = audit.find((entry: any) => String(entry.record_id) === c.server);
      assert.deepEqual(hostEntry.before_json, { relations: [{ related_asset_id: c.vms['par-app-01'], relation_type: 'contains' }] });
      assert.deepEqual(hostEntry.after_json, { relations: [] });
      const clusterEntry = audit.find((entry: any) => String(entry.record_id) === c.clusters.paris);
      assert.deepEqual(clusterEntry.before_json, { relations: [{ related_asset_id: c.vms['par-app-02'], relation_type: 'contains' }] });

      // A second preview and run have nothing left to do.
      const again = await preview(sync, c.tenantId);
      assert.equal(again.counts.update, 0);
      assert.equal(again.rows.find((entry) => entry.external_name === 'par-app-01'), undefined);
      const second = await manualRun(sync, c.tenantId);
      assert.equal(second.counts.update, 0);
      assert.deepEqual(await relations(c.tenantId), [
        'PAR-VSPHERE-CL01 > par-app-01',
        'PAR-VSPHERE-CL01 > par-app-02',
      ]);

      // The mapped cluster is retired: nothing is removed, the host link stays and the notice says
      // why the machine is not attached.
      await withTenantExecution(dataSource, c.tenantId, (manager) => manager.query(
        `UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`,
        [c.tenantId, c.clusters.paris],
      ));
      await addContains(c.tenantId, c.server, c.vms['par-app-03']);
      inventories.set(c.tenantId, [
        vm(50, 'par-app-01', PARIS),
        vm(51, 'par-app-02', PARIS),
        vm(52, 'par-app-03', PARIS),
      ]);
      const retiredPreview = await preview(sync, c.tenantId);
      assert.deepEqual(retiredPreview.notices.map((notice) => notice.code), ['cluster_match_invalid']);
      const scheduled = await sync.runInBackground(c.tenantId, 'scheduled');
      assert.equal(scheduled.status, 'success');
      assert.ok((await relations(c.tenantId)).includes('par-esx-01 > par-app-03'), 'the retired cluster removes nothing');
    }

    // --- isolation: one tenant's match never reads another tenant's assets --
    {
      const b = await seedTenant('b', () => ({ [PARIS.id]: a.clusters.paris }));
      made.push(b.tenantId);
      inventories.set(b.tenantId, [vm(50, 'par-app-01', PARIS)]);
      const before = await relations(a.tenantId);
      const shown = await preview(sync, b.tenantId);
      assert.deepEqual(shown.notices.map((notice) => notice.code), ['cluster_match_invalid']);
      assert.ok(shown.rows.every((row) => row.diffs.every((diff) => diff.field !== 'cluster')));
      const run = await sync.runInBackground(b.tenantId, 'scheduled');
      assert.equal(run.status, 'success');
      assert.deepEqual(await relations(b.tenantId), []);
      assert.deepEqual(await relations(a.tenantId), before);
      // Matching another Netbox cluster to that asset is refused the same way
      // as an asset that does not exist.
      await assert.rejects(
        () => withTenantExecution(dataSource, b.tenantId, (manager) => config.saveMapping(manager, b.tenantId, {
          role_map: {}, site_map: {}, cluster_map: { [GOUDA.id]: a.clusters.paris },
        })),
        (error: unknown) => error instanceof BadRequestException && /not in this workspace/.test((error as Error).message),
      );
      // Its own cluster is accepted.
      const saved = await withTenantExecution(dataSource, b.tenantId, (manager) => config.saveMapping(manager, b.tenantId, {
        role_map: {}, site_map: {}, cluster_map: { [PARIS.id]: b.clusters.paris }, cluster_names: { [PARIS.id]: PARIS.name },
      }));
      assert.deepEqual(saved.cluster_names, { [PARIS.id]: PARIS.name });
    }

    // --- the deductions go through the relation the import added ----------
    // vSphere installed on the Paris cluster reaches par-app-01 (cluster
    // contains VM), and with it the application hosted on that machine.
    await withTenantExecution(dataSource, a.tenantId, async (manager) => {
      const one = async (sql: string, params: unknown[]) => (await manager.query(sql, params))[0].id as string;
      const vsphere = await one(
        `INSERT INTO technologies (tenant_id, item_number, name, family) VALUES ($1, 1, 'vSphere', 'other') RETURNING id`,
        [a.tenantId],
      );
      await manager.query(
        `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, source) VALUES ($1, $2, $3, 'manual')`,
        [a.tenantId, a.clusters.paris, vsphere],
      );
      const erp = await one(`INSERT INTO applications (tenant_id, name) VALUES ($1, 'ERP') RETURNING id`, [a.tenantId]);
      const instance = await one(
        `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`,
        [a.tenantId, erp],
      );
      await manager.query(
        `INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'app')`,
        [a.tenantId, instance, a.vms['par-app-01']],
      );
      const reach = new TechnologyReachService();
      const assets = await reach.assetsOfTechnologies(manager, a.tenantId, [vsphere]);
      assert.ok(assets.some((row) => row.asset_id === a.vms['par-app-01'] && row.via_asset_id === a.clusters.paris));
      const applications = await reach.applicationsOfTechnologies(manager, a.tenantId, [vsphere]);
      assert.deepEqual(
        applications.map((row) => `${row.application_id}|${row.kind}|${row.asset_id}|${row.via_asset_id}`),
        [`${erp}|hosted|${a.vms['par-app-01']}|${a.clusters.paris}`],
      );
    });

    // --- a platform on a cluster that has members ---------------------------
    // The cluster carries no operating system: the platform is left out with a notice and the
    // rest of the patch goes on. A cluster without member keeps it.
    {
      await withTenantExecution(dataSource, a.tenantId, async (manager) => {
        await manager.query(
          `INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3)`,
          [a.tenantId, a.clusters.paris, a.server],
        );
        const skip = (clusterId: string) => {
          const patch: Record<string, unknown> = { operating_system: 'VMware ESXi 8', hostname: 'par-vc' };
          const warnings: any[] = [];
          return (sync as any).skipOperatingSystemOfCluster(manager, a.tenantId, clusterId, patch, warnings)
            .then(() => ({ patch, warnings: warnings.map((notice) => [notice.code, notice.params.value]) }));
        };
        assert.deepEqual(await skip(a.clusters.paris), {
          patch: { hostname: 'par-vc' },
          warnings: [['os_cluster_with_members', 'VMware ESXi 8']],
        });
        assert.deepEqual(await skip(a.clusters.gouda), {
          patch: { operating_system: 'VMware ESXi 8', hostname: 'par-vc' },
          warnings: [],
        });
      });
    }

    console.log('netbox-clusters.integration.spec.ts OK');
  } finally {
    for (const tenantId of made) {
      await purge(tenantId).catch((error) => console.error(`could not purge ${tenantId}:`, error));
    }
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
