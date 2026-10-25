import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { Asset } from '../asset.entity';
import { AssetsDeleteService } from '../assets-delete.service';

// Asset deletion against a real database. The guard that looks for connections
// using the asset is raw SQL over the connection tables, so a column renamed by
// a migration only shows up here: it broke every asset deletion with a 500
// once connection legs moved to a single equipment column.
// The cascade of a delete (cluster memberships, relations) is audited on the other side, and the
// check before a delete warns about it without refusing (`warnings`).

async function setCurrentTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTenant(runner: QueryRunner): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Asset delete test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `asset-delete-${tenantId.slice(0, 8)}`],
  );
  return tenantId;
}

async function seedAsset(runner: QueryRunner, tenantId: string, name: string): Promise<string> {
  const assetId = randomUUID();
  await runner.query(
    `INSERT INTO assets (id, tenant_id, name, kind, provider, environment, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'physical_server', 'on_premise', 'prod', 'active', now(), now())`,
    [assetId, tenantId, name],
  );
  return assetId;
}

async function seedConnectionThrough(runner: QueryRunner, tenantId: string, hopAssetId: string) {
  const connectionId = randomUUID();
  await runner.query(
    `INSERT INTO connections (id, tenant_id, connection_reference, name, topology)
     VALUES ($1, $2, $3, 'Paris to Gouda', 'server_to_server')`,
    [connectionId, tenantId, `CON-${connectionId.slice(0, 6)}`],
  );
  await runner.query(
    `INSERT INTO connection_legs (tenant_id, connection_id, order_index, equipment_asset_id)
     VALUES ($1, $2, 1, $3)`,
    [tenantId, connectionId, hopAssetId],
  );
}

async function seedAssignment(runner: QueryRunner, tenantId: string, assetId: string, applicationName: string) {
  const applicationId = randomUUID();
  const instanceId = randomUUID();
  await runner.query(`INSERT INTO applications (id, tenant_id, name) VALUES ($1, $2, $3)`, [applicationId, tenantId, applicationName]);
  await runner.query(
    `INSERT INTO app_instances (id, tenant_id, application_id, environment) VALUES ($1, $2, $3, 'prod')`,
    [instanceId, tenantId, applicationId],
  );
  await runner.query(
    `INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'app')`,
    [tenantId, instanceId, assetId],
  );
}

async function seedClusterAndRelations(runner: QueryRunner, tenantId: string) {
  const cluster = await seedAsset(runner, tenantId, 'esx-cluster');
  await runner.query(`UPDATE assets SET is_cluster = true WHERE tenant_id = $1 AND id = $2`, [tenantId, cluster]);
  const node1 = await seedAsset(runner, tenantId, 'esx-01');
  const node2 = await seedAsset(runner, tenantId, 'esx-02');
  const app = await seedAsset(runner, tenantId, 'app-server');
  const vm = await seedAsset(runner, tenantId, 'vm-01');
  await runner.query(
    `INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3), ($1, $2, $4)`,
    [tenantId, cluster, node1, node2],
  );
  // app-server depends on esx-01; esx-01 contains vm-01.
  await runner.query(
    `INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type)
     VALUES ($1, $2, $3, 'depends_on'), ($1, $3, $4, 'contains')`,
    [tenantId, app, node1, vm],
  );
  return { cluster, node1, node2, app, vm };
}

type AuditEntry = { table: string; recordId: string; action: string; before: any; after: any };

/**
 * The applications a member hosts through its cluster: the inherited assignments only, in service
 * on both sides. A removed membership, a retired cluster or a retired member gives none, and
 * another tenant's cluster changes nothing.
 */
async function testStopsHosting(runner: QueryRunner, tenantId: string) {
  const service = new AssetsDeleteService(
    runner.manager.getRepository(Asset),
    { log: async () => undefined } as any,
  );
  const opts = { manager: runner.manager };
  const cluster = await seedAsset(runner, tenantId, 'par-sql-cl01');
  await runner.query(`UPDATE assets SET is_cluster = true WHERE tenant_id = $1 AND id = $2`, [tenantId, cluster]);
  const member = await seedAsset(runner, tenantId, 'par-sql-01');
  const insertMembership = `INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3)`;
  const removeMembership = `DELETE FROM asset_cluster_members WHERE tenant_id = $1 AND cluster_id = $2 AND asset_id = $3`;
  await runner.query(insertMembership, [tenantId, cluster, member]);
  await seedAssignment(runner, tenantId, cluster, 'Sage X3');
  await seedAssignment(runner, tenantId, cluster, 'CheeseTrack');

  // The member stops hosting both applications its cluster carries, sorted.
  const check = await service.deleteCheck([member], tenantId, opts);
  assert.deepEqual(check.refused, []);
  assert.deepEqual(check.warnings.map((warning) => warning.stops_hosting), [['CheeseTrack', 'Sage X3']]);
  // The cluster hosts nothing through a cluster: its rows are direct and refuse its delete.
  const clusterWarning = (await service.deleteCheck([cluster], tenantId, opts)).warnings[0];
  assert.deepEqual(clusterWarning.stops_hosting, []);

  // Taken out of its cluster, the member inherits nothing: no warning is left.
  await runner.query(removeMembership, [tenantId, cluster, member]);
  assert.deepEqual((await service.deleteCheck([member], tenantId, opts)).warnings, []);
  await runner.query(insertMembership, [tenantId, cluster, member]);

  // A retired cluster passes nothing on.
  await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [tenantId, cluster]);
  const retiredCluster = (await service.deleteCheck([member], tenantId, opts)).warnings[0];
  assert.deepEqual(retiredCluster.stops_hosting, []);
  await runner.query(`UPDATE assets SET status = 'active' WHERE tenant_id = $1 AND id = $2`, [tenantId, cluster]);

  // A retired member inherits nothing either.
  await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [tenantId, member]);
  assert.deepEqual((await service.deleteCheck([member], tenantId, opts)).warnings[0].stops_hosting, []);
  await runner.query(`UPDATE assets SET status = 'active' WHERE tenant_id = $1 AND id = $2`, [tenantId, member]);

  // Another tenant with the same shape keeps its own names, and the first tenant keeps its own.
  const otherTenant = await seedTenant(runner);
  await setCurrentTenant(runner, otherTenant);
  try {
    const otherCluster = await seedAsset(runner, otherTenant, 'other-cl01');
    await runner.query(`UPDATE assets SET is_cluster = true WHERE tenant_id = $1 AND id = $2`, [otherTenant, otherCluster]);
    const otherMember = await seedAsset(runner, otherTenant, 'other-01');
    await runner.query(insertMembership, [otherTenant, otherCluster, otherMember]);
    await seedAssignment(runner, otherTenant, otherCluster, 'Other tenant app');
    const otherWarning = (await service.deleteCheck([otherMember], otherTenant, opts)).warnings[0];
    assert.deepEqual(otherWarning.stops_hosting, ['Other tenant app']);
  } finally {
    await setCurrentTenant(runner, tenantId);
  }
  assert.deepEqual(
    (await service.deleteCheck([member], tenantId, opts)).warnings[0].stops_hosting,
    ['CheeseTrack', 'Sage X3'],
  );
  // Leave the cascade test a tenant without memberships of its own.
  await runner.query(removeMembership, [tenantId, cluster, member]);
}

async function testCascade(runner: QueryRunner, tenantId: string, hop: string) {
  const entries: AuditEntry[] = [];
  const service = new AssetsDeleteService(
    runner.manager.getRepository(Asset),
    { log: async (entry: AuditEntry) => void entries.push(entry) } as any,
  );
  const opts = { manager: runner.manager };
  const { cluster, node1, node2, app, vm } = await seedClusterAndRelations(runner, tenantId);

  // The check warns, refuses only what it refused before.
  const check = await service.deleteCheck([node1, cluster, vm, hop], tenantId, opts);
  assert.deepEqual(check.refused.map((r) => [r.id, r.code]), [[hop, 'ASSET_IN_USE']]);
  assert.deepEqual(check.warnings, [
    {
      id: node1, name: 'esx-01',
      member_of: [{ id: cluster, name: 'esx-cluster' }],
      member_count: 0,
      stops_hosting: [],
      relations: [
        { id: app, name: 'app-server', relation_type: 'depends_on', direction: 'incoming' },
        { id: vm, name: 'vm-01', relation_type: 'contains', direction: 'outgoing' },
      ],
      relations_total: 2,
    },
    { id: cluster, name: 'esx-cluster', member_of: [], member_count: 2, stops_hosting: [], relations: [], relations_total: 0 },
    {
      id: vm, name: 'vm-01', member_of: [], member_count: 0, stops_hosting: [],
      relations: [{ id: node1, name: 'esx-01', relation_type: 'contains', direction: 'incoming' }],
      relations_total: 1,
    },
  ]);

  // Deleting a member: its cluster and the asset that held a relation to it are audited.
  await service.deleteAsset(node1, tenantId, null, opts);
  assert.deepEqual(entries.map((e) => `${e.table}:${e.action}:${e.recordId}`), [
    `asset_cluster_members:update:${cluster}`,
    `asset_relations:update:${app}`,
    `assets:delete:${node1}`,
  ]);
  assert.deepEqual(entries[0].before.members.sort(), [node1, node2].sort());
  assert.deepEqual(entries[0].after, { members: [node2] });
  assert.deepEqual(entries[1].before, { relations: [{ related_asset_id: node1, relation_type: 'depends_on' }] });
  assert.deepEqual(entries[1].after, { relations: [] });
  assert.deepEqual(entries[2].before.relations, [{ related_asset_id: vm, relation_type: 'contains' }]);
  assert.equal(entries[2].before.members, undefined);

  // Deleting a cluster, in bulk: its delete entry carries the members it had.
  entries.length = 0;
  const bulk = await service.bulkDelete([cluster], null, tenantId, opts);
  assert.deepEqual(bulk.deleted, [cluster]);
  assert.deepEqual(entries.map((e) => `${e.table}:${e.action}:${e.recordId}`), [`assets:delete:${cluster}`]);
  assert.deepEqual(entries[0].before.members, [node2]);
  const left = await runner.query(`SELECT count(*)::int AS count FROM asset_cluster_members WHERE tenant_id = $1`, [tenantId]);
  assert.equal(left[0].count, 0);
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = await seedTenant(runner);
    await setCurrentTenant(runner, tenantId);
    const service = new AssetsDeleteService(
      runner.manager.getRepository(Asset),
      new AuditService(runner.manager.getRepository(AuditLog)),
    );

    const plain = await seedAsset(runner, tenantId, 'par-spare-01');
    const hop = await seedAsset(runner, tenantId, 'par-fw-01');
    await seedConnectionThrough(runner, tenantId, hop);
    await seedAssignment(runner, tenantId, hop, 'Sage X3');
    await seedAssignment(runner, tenantId, hop, 'CheeseTrack');

    // An asset nothing depends on goes away.
    assert.deepEqual(await service.deleteAsset(plain, tenantId, null, { manager: runner.manager }), { deleted: true });
    const left = await runner.query(`SELECT id FROM assets WHERE tenant_id = $1 AND id = $2`, [tenantId, plain]);
    assert.equal(left.length, 0);

    // An asset a connection passes through is refused, with the connection and the applications named.
    await runner.query('SAVEPOINT hop_delete');
    await assert.rejects(
      () => service.deleteAsset(hop, tenantId, null, { manager: runner.manager }),
      (error: unknown) => error instanceof ConflictException
        && /Paris to Gouda/.test(String((error as Error).message))
        && /CheeseTrack/.test(String((error as Error).message)),
    );
    await runner.query('ROLLBACK TO SAVEPOINT hop_delete');
    const kept = await runner.query(`SELECT id FROM assets WHERE tenant_id = $1 AND id = $2`, [tenantId, hop]);
    assert.equal(kept.length, 1);

    // The check hands the screen the names it words in the interface language.
    const refusal = (await service.deleteCheck([hop], tenantId, { manager: runner.manager })).refused[0];
    assert.deepEqual(refusal.usages, [{ type: 'app_assignments', total: 2 }, { type: 'connections', total: 1 }]);
    assert.deepEqual(refusal.params, undefined);
    assert.deepEqual(refusal.applications, ['CheeseTrack', 'Sage X3']);

    await testStopsHosting(runner, tenantId);
    await testCascade(runner, tenantId, hop);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('assets-delete.integration.spec.ts OK'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
