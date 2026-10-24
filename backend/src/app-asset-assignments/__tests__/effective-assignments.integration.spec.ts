import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AppAssetAssignmentsService } from '../app-asset-assignments.service';
import { AppInstancesService } from '../../app-instances/app-instances.service';
import { AssetsListService } from '../../assets/services/assets-list.service';
import { Asset } from '../../assets/asset.entity';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { Location } from '../../locations/location.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { effectiveAssignmentsSql } from '../effective-assignments';

// Clusters pass, lot B1a: an application assigned to a cluster counts for its members, computed
// when read (`effectiveAssignmentsSql`). The fragment (one row per deployment, server and role,
// inherited rows marked with their clusters, the direct row winning, retired members left out,
// membership changes seen at once, a second tenant seeing nothing), then the reads that use it:
// the Deployments tab (a cluster's row carries its members, the groupable sets), the Operations
// tab of a member and of a cluster, a Business Contributor on an inherited row, the assets list
// count and filter, the asset summary and the connection map preselection. Each test runs under
// throwaway tenants in a rolled-back transaction.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

const noAudit = { log: async () => undefined } as any;

async function newTenant(runner: QueryRunner, label: string): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [id, `eff-asg-${label}-${id.slice(0, 8)}`, `Effective assignments ${label}`],
  );
  return id;
}

const useTenant = (runner: QueryRunner, tenantId: string) => runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(sql, params))[0].id as string;
}

function services(m: any) {
  const settings = new ItOpsSettingsService(m.getRepository(Tenant), m.getRepository(Location), noAudit);
  return {
    assignments: new AppAssetAssignmentsService(null as any, null as any, null as any, noAudit, settings),
    instances: new AppInstancesService(null as any, null as any, null as any, null as any, noAudit, settings),
    assetsList: new AssetsListService(m.getRepository(Asset)),
  };
}

async function seedAsset(runner: QueryRunner, tenantId: string, name: string, opts: { cluster?: boolean; retired?: boolean } = {}) {
  return one(runner,
    `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, is_cluster, created_at, updated_at)
     VALUES ($1, $2, 'physical_server', 'on_premise', 'prod', $3, $4, now(), now()) RETURNING id`,
    [tenantId, name, opts.retired ? 'retired' : 'active', !!opts.cluster]);
}

const addMember = (runner: QueryRunner, tenantId: string, clusterId: string, assetId: string) =>
  runner.query(`INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3)`, [tenantId, clusterId, assetId]);

const assign = (runner: QueryRunner, tenantId: string, instanceId: string, assetId: string, role: string) =>
  one(runner, `INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, instanceId, assetId, role]);

type EffectiveRow = { asset_id: string; role: string; assignment_id: string; inherited: boolean; via_clusters: Array<{ id: string; name: string }> };

async function effective(runner: QueryRunner, tenantId: string, instanceId: string): Promise<EffectiveRow[]> {
  return runner.query(
    `SELECT e.* FROM (${effectiveAssignmentsSql({ tenant: '$1', instances: '$2' })}) e
       JOIN assets a ON a.tenant_id = e.tenant_id AND a.id = e.asset_id
      ORDER BY a.name, e.role`,
    [tenantId, [instanceId]],
  );
}

async function run() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const m = runner.manager;
    const { assignments, instances, assetsList } = services(m);

    // A second tenant with its own cluster row: it sees its rows, and nothing of the first.
    const u = await newTenant(runner, 'other');
    await useTenant(runner, u);
    const uApp = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Other ERP') RETURNING id`, [u]);
    const uProd = (await instances.create(uApp, { environment: 'prod' }, null, { manager: m, tenantId: u })).id;
    const uCluster = await seedAsset(runner, u, 'other-cluster', { cluster: true });
    const uMember = await seedAsset(runner, u, 'other-member');
    await addMember(runner, u, uCluster, uMember);
    await assign(runner, u, uProd, uCluster, 'app');
    assert.equal((await effective(runner, u, uProd)).length, 2, 'the other tenant: its cluster and its member');

    const t = await newTenant(runner, 'main');
    await useTenant(runner, t);
    const opts = { manager: m, tenantId: t };
    const erp = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'ERP') RETURNING id`, [t]);
    const crm = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, 'CRM') RETURNING id`, [t]);
    const p = (await instances.create(erp, { environment: 'prod' }, null, opts)).id;
    const q = (await instances.create(crm, { environment: 'prod' }, null, opts)).id;
    const clA = await seedAsset(runner, t, 'cl-a', { cluster: true });
    const clB = await seedAsset(runner, t, 'cl-b', { cluster: true });
    const m1 = await seedAsset(runner, t, 'srv-1');
    const m2 = await seedAsset(runner, t, 'srv-2');
    const m3 = await seedAsset(runner, t, 'srv-3', { retired: true });
    const solo = await seedAsset(runner, t, 'srv-solo');
    await addMember(runner, t, clA, m1);
    await addMember(runner, t, clA, m2);
    await addMember(runner, t, clA, m3);
    await addMember(runner, t, clB, m2);
    const onA = await assign(runner, t, p, clA, 'app');
    const onB = await assign(runner, t, p, clB, 'app');
    const m1Direct = await assign(runner, t, p, m1, 'app'); // older data: also on its cluster
    await assign(runner, t, p, solo, 'db');
    await assign(runner, t, q, m1, 'app');
    await assign(runner, t, q, m2, 'app');

    // --- The fragment.
    assert.deepEqual(await effective(runner, t, uProd), [], 'the first tenant reads nothing of the second');
    const rows = await effective(runner, t, p);
    const byAsset = new Map(rows.map((row) => [row.asset_id, row]));
    assert.deepEqual(rows.map((row) => row.asset_id), [clA, clB, m1, m2, solo], 'one row per server and role, the retired member left out');
    assert.equal(byAsset.get(clA)!.inherited, false, 'the cluster keeps its own row');
    assert.deepEqual(byAsset.get(clA)!.via_clusters, []);
    assert.equal(byAsset.get(clA)!.assignment_id, onA);
    const viaM2 = byAsset.get(m2)!;
    assert.equal(viaM2.inherited, true, 'a member inherits');
    assert.deepEqual(viaM2.via_clusters, [{ id: clA, name: 'cl-a' }, { id: clB, name: 'cl-b' }], 'a member of two clusters: one row, both named, by name');
    assert.equal(viaM2.assignment_id, onA, 'the row of the first cluster by name');
    const viaM1 = byAsset.get(m1)!;
    assert.equal(viaM1.inherited, false, 'a direct row and an inherited one alike: the direct one wins');
    assert.equal(viaM1.assignment_id, m1Direct);
    assert.deepEqual(viaM1.via_clusters, [{ id: clA, name: 'cl-a' }], 'and still names the cluster');
    assert.ok(onB, 'the second cluster row exists');

    // --- The Deployments tab: a cluster's row carries its members, never rows of their own.
    const listP = await assignments.list(p, opts);
    assert.deepEqual(listP.items.map((item) => item.asset.name), ['cl-a', 'cl-b', 'srv-1', 'srv-solo']);
    const itemA = listP.items.find((item) => item.asset_id === clA)!;
    assert.equal(itemA.asset.is_cluster, true);
    assert.deepEqual(itemA.members.map((member) => member.name), ['srv-1', 'srv-2'], 'the members in service under the cluster row');
    assert.deepEqual(listP.items.find((item) => item.asset_id === clB)!.members.map((member) => member.asset_id), [m2]);
    const itemM1 = listP.items.find((item) => item.asset_id === m1)!;
    assert.equal(itemM1.inherited, false);
    assert.deepEqual(itemM1.via_clusters.map((via) => via.id), [clA]);
    assert.deepEqual(itemM1.members, []);
    assert.deepEqual(listP.groupable, [], 'one member of two carries ERP directly: nothing to group');

    // Groupable: CRM is on both members in service of cl-a (the retired one does not count), and
    // cl-b has a single member.
    const expectedGroup = [{ cluster_id: clA, cluster_name: 'cl-a', app_instance_id: q, role: 'app', application_id: crm, application_name: 'CRM', environment: 'prod', member_ids: [m1, m2] }];
    assert.deepEqual((await assignments.list(q, opts)).groupable, expectedGroup);
    assert.deepEqual((await assignments.listByApplication(crm, opts)).groupable, expectedGroup);

    // --- The Operations tab of a member: direct and inherited rows; of a cluster: its own.
    const ofM2 = await assignments.listByAsset(m2, opts);
    assert.deepEqual(ofM2.map((row) => [row.application.name, row.inherited]), [['CRM', false], ['ERP', true]]);
    const inheritedRow = ofM2.find((row) => row.inherited)!;
    assert.equal(inheritedRow.id, onA, 'an inherited row names the cluster row');
    assert.deepEqual(inheritedRow.via_clusters.map((via) => via.name), ['cl-a', 'cl-b']);
    assert.equal(inheritedRow.groupable, null);
    assert.deepEqual(ofM2.find((row) => !row.inherited)!.groupable, { cluster_id: clA, cluster_name: 'cl-a', member_ids: [m1, m2] });
    const ofA = await assignments.listByAsset(clA, opts);
    assert.ok(Array.isArray(ofA), 'the Operations tab read answers an array (API contract)');
    assert.deepEqual(ofA.map((row) => [row.application.name, row.inherited, row.id]), [['ERP', false, onA]]);
    assert.deepEqual((await assignments.listGroupableByAsset(clA, opts)).items, expectedGroup, 'a cluster: the sets of its members that could move to it');
    assert.deepEqual((await assignments.listGroupableByAsset(clB, opts)).items, [], 'a cluster with one member: nothing to group');
    assert.deepEqual((await assignments.listGroupableByAsset(m2, opts)).items, [], 'a member: no set of its own');
    assert.deepEqual(await assignments.listByAsset(m3, opts), [], 'a retired member inherits nothing');

    // A Business Contributor sees the inherited row of an application they take part in, only.
    const roleId = await one(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Contributor', 'Contributor') RETURNING id`, [t]);
    const userId = await one(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Bea', 'Tester', $3, 'enabled') RETURNING id`,
      [t, `bea-${t.slice(0, 8)}@example.test`, roleId]);
    await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`, [t, erp, userId]);
    const scoped = await assignments.listByAsset(m2, { ...opts, accessScope: { userId } });
    assert.deepEqual((await assignments.listGroupableByAsset(clA, { ...opts, accessScope: { userId } })).items, [],
      'a Business Contributor of ERP sees no set of CRM');
    assert.deepEqual(scoped.map((row) => [row.application.name, row.inherited]), [['ERP', true]]);

    // --- The assets list: count and filter, effective; the summary; the connection map preselection.
    const listed = await assetsList.list({ sort: 'name:ASC', limit: 50 }, opts);
    const counts = Object.fromEntries(listed.items.map((item: any) => [item.name, item.assignments_count]));
    assert.deepEqual(counts, { 'cl-a': 1, 'cl-b': 1, 'srv-1': 2, 'srv-2': 2, 'srv-3': 0, 'srv-solo': 1 });
    const filtered = await assetsList.list({
      filters: JSON.stringify({ assignments_count: { filterType: 'number', type: 'greaterThan', filter: 1 } }), sort: 'name:ASC', limit: 50,
    }, opts);
    assert.deepEqual(filtered.items.map((item: any) => item.name), ['srv-1', 'srv-2']);
    const summary = await assetsList.mapSummary(m2, opts);
    assert.deepEqual(summary.assigned_applications.map((app) => [app.name, app.inherited]), [['CRM', false], ['ERP', true]]);
    const preselected = await assignments.listAssetsByApps([erp], ['prod'], opts);
    assert.deepEqual(preselected.items.map((asset) => asset.name), ['cl-a', 'cl-b', 'srv-1', 'srv-2', 'srv-solo']);

    // --- Membership is read, not stored: a member added inherits at once, one taken out loses it.
    const m4 = await seedAsset(runner, t, 'srv-4');
    await addMember(runner, t, clA, m4);
    const added = (await effective(runner, t, p)).find((row) => row.asset_id === m4);
    assert.equal(added?.inherited, true, 'a member added inherits');
    assert.deepEqual((await assignments.list(q, opts)).groupable, [], 'a third member in service without CRM: nothing to group');
    await runner.query(`DELETE FROM asset_cluster_members WHERE tenant_id = $1 AND cluster_id = $2 AND asset_id = $3`, [t, clA, m4]);
    assert.equal((await effective(runner, t, p)).some((row) => row.asset_id === m4), false, 'a member taken out loses it');
    await runner.query(`DELETE FROM asset_cluster_members WHERE tenant_id = $1 AND cluster_id = $2 AND asset_id = $3`, [t, clB, m2]);
    assert.deepEqual((await effective(runner, t, p)).find((row) => row.asset_id === m2)!.via_clusters.map((via) => via.name), ['cl-a']);

    // --- A retired cluster passes nothing on: it keeps its own row, its members inherit nothing
    // from it, and nothing groups onto it.
    await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [t, clA]);
    const afterRetire = await effective(runner, t, p);
    assert.equal(afterRetire.find((row) => row.asset_id === clA)?.inherited, false, 'the retired cluster keeps its own row');
    assert.equal(afterRetire.some((row) => row.asset_id === m2), false, 'its member inherits nothing from it');
    assert.deepEqual(afterRetire.find((row) => row.asset_id === m1)!.via_clusters, [], 'the direct row of a member names no retired cluster');
    assert.deepEqual((await assignments.list(q, opts)).groupable, [], 'nothing groups onto a retired cluster');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

(async () => {
  await dataSource.initialize();
  try {
    await run();
    console.log('effective assignments: ok');
  } finally {
    await dataSource.destroy();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
