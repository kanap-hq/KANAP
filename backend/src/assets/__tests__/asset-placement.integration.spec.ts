// @database-spec
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { ConflictException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import {
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedTenant,
  setTenant,
} from '../../spend/__tests__/round-inputs.fixtures';
import {
  assertNotPlacedByCluster,
  doubleContainersOf,
  hostLinksToReplace,
  placementInheritedRefusal,
  replaceHostLinks,
  type ReplacedHostLink,
} from '../placement-rules';

// The placement rules of a virtual machine carried by a cluster (clusters pass, lot C1b), on the
// rules alone: R1 absorption by a cluster of its members' `contains`, R2 refusal of a member's
// link towards what its cluster already contains, R3 reporting of the other double containers.
// The writes of the relations service and of the assistant are covered by their own specs.

type AuditEntry = {
  table: string;
  recordId: string;
  action: string;
  before?: any;
  after?: any;
  userId?: string | null;
  source?: string;
  sourceRef?: string | null;
};

const assetSql = `INSERT INTO assets (tenant_id, name, kind, environment, status, is_cluster, created_at, updated_at)
  VALUES ($1, $2, 'physical_server', 'prod', $3, $4, now(), now()) RETURNING id`;

async function asset(
  runner: QueryRunner,
  tenantId: string,
  name: string,
  opts: { cluster?: boolean; retired?: boolean } = {},
): Promise<string> {
  const rows = await runner.query(assetSql, [tenantId, name, opts.retired ? 'retired' : 'active', !!opts.cluster]);
  return rows[0].id as string;
}

async function addMember(runner: QueryRunner, tenantId: string, clusterId: string, hostId: string): Promise<void> {
  await runner.query(
    `INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3)`,
    [tenantId, clusterId, hostId],
  );
}

let relationSeq = 0;

/** Inserted with an increasing `created_at`, so the reads ordered by it are deterministic. */
async function contains(runner: QueryRunner, tenantId: string, container: string, content: string, type = 'contains'): Promise<void> {
  relationSeq += 1;
  const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, relationSeq)).toISOString();
  await runner.query(
    `INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, container, content, type, createdAt],
  );
}

/** The `contains` containers of one asset, as `container>content`, sorted. */
async function storedContains(runner: QueryRunner, tenantId: string): Promise<string[]> {
  const rows: Array<{ asset_id: string; related_asset_id: string }> = await runner.query(
    `SELECT asset_id, related_asset_id FROM asset_relations WHERE tenant_id = $1 AND relation_type = 'contains'`,
    [tenantId],
  );
  return rows.map((row) => `${row.asset_id}>${row.related_asset_id}`).sort();
}

async function relationsOf(runner: QueryRunner, tenantId: string, assetId: string): Promise<any[]> {
  return runner.query(
    `SELECT related_asset_id, relation_type FROM asset_relations
      WHERE tenant_id = $1 AND asset_id = $2 ORDER BY created_at, id`,
    [tenantId, assetId],
  );
}

async function refusal(run: () => Promise<unknown>, runner: QueryRunner): Promise<{ status?: number; code?: string; params?: unknown; message: string }> {
  await runner.query('SAVEPOINT refusal');
  try {
    await run();
  } catch (error: any) {
    await runner.query('ROLLBACK TO SAVEPOINT refusal');
    const body = typeof error?.getResponse === 'function' ? error.getResponse() : null;
    return {
      status: typeof error?.getStatus === 'function' ? error.getStatus() : undefined,
      code: body?.code,
      params: body?.params,
      message: String(error?.message ?? error),
    };
  }
  throw new Error('expected a refusal');
}

const sortLinks = (links: ReplacedHostLink[]) => links
  .map((link) => `${link.host_name}>${link.asset_name}|${link.cluster_name}`)
  .sort();

/** R1: one link, several links, one audit per host with its exact relations, and idempotence. */
async function testAbsorption() {
  await inRolledBackTransaction(async (runner) => {
    const t = await seedTenant(runner, 'placement-absorb');
    const audit = captureAudit();
    const cluster = await asset(runner, t, 'PAR-VSPHERE-CL01', { cluster: true });
    const h1 = await asset(runner, t, 'par-esx-01');
    const h2 = await asset(runner, t, 'par-esx-02');
    const retiredHost = await asset(runner, t, 'par-esx-old', { retired: true });
    const other = await asset(runner, t, 'par-esx-other');
    const vm1 = await asset(runner, t, 'par-app-01');
    const vm2 = await asset(runner, t, 'par-app-02');
    for (const host of [h1, h2, retiredHost]) await addMember(runner, t, cluster, host);

    await contains(runner, t, h1, vm1);
    await contains(runner, t, h2, vm1);
    await contains(runner, t, h1, vm2);
    await contains(runner, t, h1, vm2, 'depends_on');
    await contains(runner, t, other, vm2);
    await contains(runner, t, retiredHost, vm1);

    // Read only: nothing removed, the links of the retired host and of a non-member stay.
    const planned = await hostLinksToReplace(runner.manager, t, { id: cluster, name: 'PAR-VSPHERE-CL01' }, [vm1, vm2]);
    assert.deepEqual(sortLinks(planned), [
      'par-esx-01>par-app-01|PAR-VSPHERE-CL01',
      'par-esx-01>par-app-02|PAR-VSPHERE-CL01',
      'par-esx-02>par-app-01|PAR-VSPHERE-CL01',
    ]);
    assert.equal((await storedContains(runner, t)).length, 5);

    // Both hosts, both assets in one write: one audit entry per host.
    const removed = await replaceHostLinks(runner.manager, audit as any, t, { id: cluster, name: 'PAR-VSPHERE-CL01' }, [vm1, vm2], 'user-1');
    assert.deepEqual(sortLinks(removed), [
      'par-esx-01>par-app-01|PAR-VSPHERE-CL01',
      'par-esx-01>par-app-02|PAR-VSPHERE-CL01',
      'par-esx-02>par-app-01|PAR-VSPHERE-CL01',
    ]);
    assert.deepEqual(removed.find((link) => link.host_id === h1 && link.asset_id === vm1), {
      host_id: h1, host_name: 'par-esx-01', asset_id: vm1, asset_name: 'par-app-01',
      cluster_id: cluster, cluster_name: 'PAR-VSPHERE-CL01',
    });
    assert.deepEqual(await storedContains(runner, t), [
      `${other}>${vm2}`,
      `${retiredHost}>${vm1}`,
    ].sort(), 'the retired host keeps its link, the non-member too');

    // One entry per host, with all its relations before and after, even when it lost two links.
    assert.equal(audit.entries.length, 2);
    const h1Entry = audit.entries.find((entry) => entry.recordId === h1) as AuditEntry;
    assert.deepEqual({ table: h1Entry.table, action: h1Entry.action, userId: h1Entry.userId }, {
      table: 'asset_relations', action: 'update', userId: 'user-1',
    });
    assert.deepEqual(h1Entry.before, {
      relations: [
        { related_asset_id: vm1, relation_type: 'contains' },
        { related_asset_id: vm2, relation_type: 'contains' },
        { related_asset_id: vm2, relation_type: 'depends_on' },
      ],
    });
    assert.deepEqual(h1Entry.after, {
      relations: [{ related_asset_id: vm2, relation_type: 'depends_on' }],
    });
    const h2Entry = audit.entries.find((entry) => entry.recordId === h2) as AuditEntry;
    assert.deepEqual(h2Entry.before, { relations: [{ related_asset_id: vm1, relation_type: 'contains' }] });
    assert.deepEqual(h2Entry.after, { relations: [] });

    // Nothing left to absorb: no write, no audit.
    assert.deepEqual(await replaceHostLinks(runner.manager, audit as any, t, { id: cluster, name: 'PAR-VSPHERE-CL01' }, [vm1, vm2], null), []);
    assert.equal(audit.entries.length, 2);
  });
}

/** R1 only touches the members of the cluster that writes, both in service. */
async function testAbsorptionScope() {
  await inRolledBackTransaction(async (runner) => {
    const t = await seedTenant(runner, 'placement-scope');
    const audit = captureAudit();
    const retiredCluster = await asset(runner, t, 'cl-retired', { cluster: true, retired: true });
    const cluster = await asset(runner, t, 'cl-main', { cluster: true });
    const otherCluster = await asset(runner, t, 'cl-other', { cluster: true });
    const host = await asset(runner, t, 'host-shared');
    const retiredHost = await asset(runner, t, 'host-retired', { retired: true });
    const outsider = await asset(runner, t, 'host-outsider');
    const vm1 = await asset(runner, t, 'vm-1');
    const vm2 = await asset(runner, t, 'vm-2');
    // The shared host belongs to both clusters, the retired one too.
    await addMember(runner, t, cluster, host);
    await addMember(runner, t, otherCluster, host);
    await addMember(runner, t, retiredCluster, host);
    await addMember(runner, t, cluster, retiredHost);
    await contains(runner, t, host, vm1);
    await contains(runner, t, retiredHost, vm1);
    await contains(runner, t, outsider, vm1);
    await contains(runner, t, otherCluster, vm2);

    // A retired cluster absorbs nothing.
    assert.deepEqual(await replaceHostLinks(runner.manager, audit as any, t, { id: retiredCluster, name: 'cl-retired' }, [vm1], null), []);
    assert.equal((await relationsOf(runner, t, host)).length, 1);

    // The cluster that does not contain the asset absorbs nothing, even though its member does.
    assert.deepEqual(await replaceHostLinks(runner.manager, audit as any, t, { id: cluster, name: 'cl-main' }, [vm2], null), []);
    assert.equal((await relationsOf(runner, t, host)).length, 1);
    assert.equal((await relationsOf(runner, t, otherCluster)).length, 1, 'the other cluster keeps its own relation');

    // The cluster that contains it absorbs; the other cluster's relation is left alone.
    const removed = await replaceHostLinks(runner.manager, audit as any, t, { id: otherCluster, name: 'cl-other' }, [vm1], null);
    assert.deepEqual(sortLinks(removed), ['host-shared>vm-1|cl-other']);
    assert.deepEqual(await relationsOf(runner, t, host), []);
    assert.deepEqual(await relationsOf(runner, t, otherCluster), [{ related_asset_id: vm2, relation_type: 'contains' }]);
    // The retired host and the non-member keep theirs.
    assert.deepEqual(await storedContains(runner, t), [
      `${otherCluster}>${vm2}`,
      `${outsider}>${vm1}`,
      `${retiredHost}>${vm1}`,
    ].sort());

    assert.equal(audit.entries.length, 1);
  });
}

/** R2: a member's link towards what one of its clusters in service contains is refused. */
async function testRefusal() {
  await inRolledBackTransaction(async (runner) => {
    const t = await seedTenant(runner, 'placement-refusal');
    const cluster = await asset(runner, t, 'PAR-VSPHERE-CL01', { cluster: true });
    const retiredCluster = await asset(runner, t, 'cl-retired', { cluster: true, retired: true });
    const host = await asset(runner, t, 'par-esx-01');
    const retiredHost = await asset(runner, t, 'par-esx-old', { retired: true });
    const outsider = await asset(runner, t, 'par-esx-other');
    const vm1 = await asset(runner, t, 'par-app-01');
    const vm2 = await asset(runner, t, 'par-app-02');
    await addMember(runner, t, cluster, host);
    await addMember(runner, t, cluster, retiredHost);
    await addMember(runner, t, retiredCluster, host);
    await contains(runner, t, cluster, vm1);

    assert.deepEqual(await refusal(() => assertNotPlacedByCluster(runner.manager, t, host, [vm1]), runner), {
      status: 409,
      code: 'placement_inherited',
      params: { cluster: 'PAR-VSPHERE-CL01' },
      message: 'This asset is already contained by the cluster PAR-VSPHERE-CL01, which one of its hosts belongs to.',
    });

    // One cluster is enough when a host belongs to several; an asset the clusters do not contain passes.
    assert.equal((await refusal(() => assertNotPlacedByCluster(runner.manager, t, host, [vm2, vm1]), runner)).code, 'placement_inherited');
    await assertNotPlacedByCluster(runner.manager, t, host, [vm2]);
    await assertNotPlacedByCluster(runner.manager, t, host, []);

    // A retired cluster absorbs nothing, so it refuses nothing; a retired host inherits nothing.
    await assertNotPlacedByCluster(runner.manager, t, retiredHost, [vm1]);
    await contains(runner, t, retiredCluster, vm2);
    await assertNotPlacedByCluster(runner.manager, t, host, [vm2]);
    // A host outside the cluster is not concerned.
    await assertNotPlacedByCluster(runner.manager, t, outsider, [vm1]);

    // The refusal is the coded conflict, on its own.
    const coded = placementInheritedRefusal('cl-x');
    assert.ok(coded instanceof ConflictException);
    assert.deepEqual(coded.getResponse(), {
      code: 'placement_inherited',
      message: 'This asset is already contained by the cluster cl-x, which one of its hosts belongs to.',
      params: { cluster: 'cl-x' },
    });
  });
}

/** R3: only the assets with at least two containers in service are reported. */
async function testDoubleContainers() {
  await inRolledBackTransaction(async (runner) => {
    const t = await seedTenant(runner, 'placement-double');
    const cluster = await asset(runner, t, 'cl-alpha', { cluster: true });
    const cluster2 = await asset(runner, t, 'cl-beta', { cluster: true });
    const host = await asset(runner, t, 'host-gamma');
    const host2 = await asset(runner, t, 'host-delta');
    const retired = await asset(runner, t, 'cl-retired', { cluster: true, retired: true });
    const vmDouble = await asset(runner, t, 'vm-double');
    const vmSingle = await asset(runner, t, 'vm-single');
    const vmRetired = await asset(runner, t, 'vm-retired-container');
    await contains(runner, t, cluster, vmDouble);
    await contains(runner, t, host, vmDouble);
    await contains(runner, t, cluster2, vmDouble);
    await contains(runner, t, host2, vmRetired);
    await contains(runner, t, retired, vmRetired);
    await contains(runner, t, host, vmSingle);
    await contains(runner, t, host2, vmSingle, 'depends_on');

    const doubles = await doubleContainersOf(runner.manager, t, [vmDouble, vmSingle, vmRetired]);
    assert.deepEqual(doubles, [{
      asset_id: vmDouble,
      asset_name: 'vm-double',
      containers: [
        { id: cluster, name: 'cl-alpha' },
        { id: cluster2, name: 'cl-beta' },
        { id: host, name: 'host-gamma' },
      ],
    }]);
    assert.deepEqual(await doubleContainersOf(runner.manager, t, [vmSingle]), []);
    assert.deepEqual(await doubleContainersOf(runner.manager, t, []), []);
  });
}

/** Every query carries the tenant: an identical tenant is left untouched. */
async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const t1 = await seedTenant(runner, 'placement-t1');
    const audit = captureAudit();
    const seed = async (tenantId: string) => {
      const cluster = await asset(runner, tenantId, 'cl-shared', { cluster: true });
      const host = await asset(runner, tenantId, 'host-shared');
      const vm = await asset(runner, tenantId, 'vm-shared');
      await addMember(runner, tenantId, cluster, host);
      await contains(runner, tenantId, host, vm);
      await contains(runner, tenantId, cluster, vm);
      return { cluster, host, vm };
    };
    const a = await seed(t1);
    const t2 = await seedTenant(runner, 'placement-t2');
    const b = await seed(t2);

    // The write reads the cluster of the tenant; the other tenant keeps its own links.
    await setTenant(runner, t1);
    await replaceHostLinks(runner.manager, audit as any, t1, { id: a.cluster, name: 'cl-shared' }, [a.vm], null);
    assert.deepEqual(await relationsOf(runner, t1, a.host), []);
    await setTenant(runner, t2);
    assert.deepEqual(await relationsOf(runner, t2, b.host), [{ related_asset_id: b.vm, relation_type: 'contains' }]);

    // The reads answer for their tenant only.
    assert.deepEqual(await hostLinksToReplace(runner.manager, t2, { id: b.cluster, name: 'cl-shared' }, [a.vm]), []);
    assert.deepEqual(await doubleContainersOf(runner.manager, t2, [a.vm]), []);
    assert.deepEqual((await doubleContainersOf(runner.manager, t2, [b.vm])).map((entry) => entry.asset_id), [b.vm]);

    await setTenant(runner, t1);
    assert.deepEqual(await doubleContainersOf(runner.manager, t1, [a.vm]), []);
  });
}

void runSpecs('asset-placement.integration.spec', [
  ['testAbsorption', testAbsorption],
  ['testAbsorptionScope', testAbsorptionScope],
  ['testRefusal', testRefusal],
  ['testDoubleContainers', testDoubleContainers],
  ['testTenantIsolation', testTenantIsolation],
]);
