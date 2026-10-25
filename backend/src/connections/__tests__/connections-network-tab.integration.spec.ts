import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { Asset } from '../../assets/asset.entity';
import { DEFAULT_CLASSIFICATION_CATALOG } from '../../it-ops-settings/classification-catalog';
import { seedTenant, setCurrentTenant } from '../../interfaces/__tests__/interface-seed-helpers';
import { Connection } from '../connection.entity';
import { ConnectionLeg } from '../connection-leg.entity';
import { ConnectionProtocol } from '../connection-protocol.entity';
import { ConnectionServer } from '../connection-server.entity';
import { ConnectionsListService } from '../services/connections-list.service';

// Clusters pass, lot C1x: the Network tab of an asset (`listByAsset`, GET
// /connections/by-server/:id) reads the effective connection assets, so a member sees the
// connections written on its clusters with their `asset_roles`, `inherited` and `via_clusters`,
// and a multi-server connection carries its named `servers`. A cluster never sees what is written
// on its members; a hop on an asset is a role; retired members inherit nothing; another tenant
// shows nothing. Rows are written directly, in the transaction of the caller, and rolled back.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

function service(manager: EntityManager) {
  const settings = {
    getClassificationCatalog: async () => DEFAULT_CLASSIFICATION_CATALOG,
    getSettings: async () => ({ entities: [], connectionTypes: [] }),
  };
  return new ConnectionsListService(
    manager.getRepository(Connection),
    manager.getRepository(ConnectionServer),
    manager.getRepository(ConnectionProtocol),
    manager.getRepository(ConnectionLeg),
    manager.getRepository(Asset),
    settings as any,
  );
}

async function seedAsset(
  runner: QueryRunner,
  tenantId: string,
  name: string,
  opts: { cluster?: boolean; retired?: boolean; reference?: string } = {},
): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, is_cluster, asset_reference, created_at, updated_at)
     VALUES ($1, $2, 'physical_server', 'on_premise', 'prod', $3, $4, $5, now(), now()) RETURNING id`,
    [tenantId, name, opts.retired ? 'retired' : 'active', !!opts.cluster, opts.reference ?? null],
  );
  return row.id;
}

const addMember = (runner: QueryRunner, tenantId: string, clusterId: string, assetId: string) =>
  runner.query(`INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3)`, [tenantId, clusterId, assetId]);

async function seedConnection(
  runner: QueryRunner,
  tenantId: string,
  name: string,
  opts: { source?: string; destination?: string; topology?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO connections (id, tenant_id, connection_reference, name, topology, source_asset_id, destination_asset_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, tenantId, `CON-${name}`, name, opts.topology ?? 'server_to_server', opts.source ?? null, opts.destination ?? null],
  );
  return id;
}

const addServer = (runner: QueryRunner, tenantId: string, connectionId: string, assetId: string) =>
  runner.query(`INSERT INTO connection_servers (tenant_id, connection_id, asset_id) VALUES ($1, $2, $3)`, [tenantId, connectionId, assetId]);

const addLeg = (runner: QueryRunner, tenantId: string, connectionId: string, orderIndex: number, assetId: string) =>
  runner.query(
    `INSERT INTO connection_legs (tenant_id, connection_id, order_index, equipment_asset_id) VALUES ($1, $2, $3, $4)`,
    [tenantId, connectionId, orderIndex, assetId],
  );

async function run() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantA = await seedTenant(runner, 'network-tab');
    const opts = { manager: runner.manager };
    const svc = service(runner.manager);

    const cluster1 = await seedAsset(runner, tenantA, 'cluster-1', { cluster: true, reference: 'AST-CL1' });
    const cluster2 = await seedAsset(runner, tenantA, 'cluster-2', { cluster: true, reference: 'AST-CL2' });
    const m1 = await seedAsset(runner, tenantA, 'srv-1', { reference: 'AST-01' });
    const m2 = await seedAsset(runner, tenantA, 'srv-2', { reference: 'AST-02' });
    const retired = await seedAsset(runner, tenantA, 'srv-retired', { retired: true });
    const dest = await seedAsset(runner, tenantA, 'srv-dest');
    const firewall = await seedAsset(runner, tenantA, 'par-fw-01');
    const aServer = await seedAsset(runner, tenantA, 'a-srv', { reference: 'AST-A' });
    const zServer = await seedAsset(runner, tenantA, 'z-srv', { reference: 'AST-Z' });
    await addMember(runner, tenantA, cluster1, m1);
    await addMember(runner, tenantA, cluster1, m2);
    await addMember(runner, tenantA, cluster1, retired);
    await addMember(runner, tenantA, cluster2, m2);

    const cSource = await seedConnection(runner, tenantA, 'Source on cluster', { source: cluster1, destination: dest });
    const cDestination = await seedConnection(runner, tenantA, 'Destination on cluster', { source: dest, destination: cluster1 });
    const cServers = await seedConnection(runner, tenantA, 'Multi server on cluster', { topology: 'multi_server' });
    await addServer(runner, tenantA, cServers, cluster1);
    await addServer(runner, tenantA, cServers, zServer);
    await addServer(runner, tenantA, cServers, aServer);
    const cHop = await seedConnection(runner, tenantA, 'Hop through cluster', { source: firewall, destination: dest });
    await addLeg(runner, tenantA, cHop, 1, cluster1);
    await addLeg(runner, tenantA, cHop, 2, firewall);
    // The server list names the cluster and the member itself (older data): the direct row wins.
    const cBoth = await seedConnection(runner, tenantA, 'Both direct and cluster', { topology: 'multi_server' });
    await addServer(runner, tenantA, cBoth, cluster1);
    await addServer(runner, tenantA, cBoth, m1);
    const cOnMember = await seedConnection(runner, tenantA, 'Written on the member', { source: m1, destination: dest });
    // Two clusters on one connection, in two places: the item's via_clusters is their union.
    const cMixed = await seedConnection(runner, tenantA, 'Two clusters in two places', { source: dest, destination: cluster1 });
    await addLeg(runner, tenantA, cMixed, 1, cluster2);

    const of = async (assetId: string, tenantId = tenantA) => {
      const result = await svc.listByAsset(assetId, tenantId, opts);
      return { ...result, byId: new Map(result.items.map((item: any) => [item.id, item])) };
    };

    // --- A member sees the endpoint, server and hop rows written on its cluster.
    const onM1 = await of(m1);
    const m1Source = onM1.byId.get(cSource) as any;
    assert.deepEqual(m1Source.asset_roles, [
      { part: 'source', hop_order: null, inherited: true, via_clusters: [{ id: cluster1, name: 'cluster-1' }] },
    ]);
    assert.equal(m1Source.inherited, true);
    assert.deepEqual(m1Source.via_clusters, [{ id: cluster1, name: 'cluster-1' }]);
    assert.deepEqual(m1Source.servers, [], 'a server-to-server connection names no server list');
    assert.deepEqual((onM1.byId.get(cDestination) as any).asset_roles, [
      { part: 'destination', hop_order: null, inherited: true, via_clusters: [{ id: cluster1, name: 'cluster-1' }] },
    ]);
    const m1Servers = onM1.byId.get(cServers) as any;
    assert.deepEqual(m1Servers.asset_roles, [
      { part: 'server', hop_order: null, inherited: true, via_clusters: [{ id: cluster1, name: 'cluster-1' }] },
    ]);
    assert.equal(m1Servers.inherited, true);
    const m1Hop = onM1.byId.get(cHop) as any;
    assert.deepEqual(m1Hop.asset_roles, [
      { part: 'hop', hop_order: 1, inherited: true, via_clusters: [{ id: cluster1, name: 'cluster-1' }] },
    ]);
    assert.equal(m1Hop.inherited, true);

    // --- A multi-server connection carries its named servers, clusters flagged, sorted by name.
    assert.deepEqual(m1Servers.servers, [
      { id: aServer, name: 'a-srv', asset_reference: 'AST-A', is_cluster: false },
      { id: cluster1, name: 'cluster-1', asset_reference: 'AST-CL1', is_cluster: true },
      { id: zServer, name: 'z-srv', asset_reference: 'AST-Z', is_cluster: false },
    ]);

    // --- Direct and inherited on the same connection: one role, the direct one wins.
    const m1Both = onM1.byId.get(cBoth) as any;
    assert.deepEqual(m1Both.asset_roles, [
      { part: 'server', hop_order: null, inherited: false, via_clusters: [{ id: cluster1, name: 'cluster-1' }] },
    ]);
    assert.equal(m1Both.inherited, false, 'a direct row and an inherited one: the direct one wins');
    assert.deepEqual(m1Both.via_clusters, [{ id: cluster1, name: 'cluster-1' }], 'the cluster stays named');
    assert.deepEqual(m1Both.servers, [
      { id: cluster1, name: 'cluster-1', asset_reference: 'AST-CL1', is_cluster: true },
      { id: m1, name: 'srv-1', asset_reference: 'AST-01', is_cluster: false },
    ]);

    // --- The union of the clusters of every role of one connection, sorted by name.
    const m2Mixed = (await of(m2)).byId.get(cMixed) as any;
    assert.deepEqual(m2Mixed.asset_roles, [
      { part: 'destination', hop_order: null, inherited: true, via_clusters: [{ id: cluster1, name: 'cluster-1' }] },
      { part: 'hop', hop_order: 1, inherited: true, via_clusters: [{ id: cluster2, name: 'cluster-2' }] },
    ]);
    assert.equal(m2Mixed.inherited, true);
    assert.deepEqual(m2Mixed.via_clusters, [
      { id: cluster1, name: 'cluster-1' },
      { id: cluster2, name: 'cluster-2' },
    ]);

    // --- The hop equipment sees its own role, with its order; source sorts before hop.
    const onFirewall = await of(firewall);
    const firewallHop = onFirewall.byId.get(cHop) as any;
    assert.deepEqual(firewallHop.asset_roles, [
      { part: 'source', hop_order: null, inherited: false, via_clusters: [] },
      { part: 'hop', hop_order: 2, inherited: false, via_clusters: [] },
    ]);
    assert.equal(firewallHop.inherited, false);
    assert.deepEqual(firewallHop.via_clusters, []);

    // --- A cluster never sees the connections written on its members.
    const onCluster = await of(cluster1);
    assert.equal(onCluster.byId.has(cSource), true, 'the cluster keeps its own rows');
    assert.equal(onCluster.byId.has(cOnMember), false, 'a cluster sees nothing of its members');
    assert.deepEqual((onCluster.byId.get(cHop) as any).asset_roles, [
      { part: 'hop', hop_order: 1, inherited: false, via_clusters: [] },
    ]);

    // --- A retired member inherits nothing (it has no direct row here).
    assert.deepEqual(await svc.listByAsset(retired, tenantA, opts), { items: [], total: 0 });

    // --- Another tenant sees nothing, and its own rows only.
    const tenantB = await seedTenant(runner, 'network-tab-b');
    const clusterB = await seedAsset(runner, tenantB, 'cluster-b', { cluster: true });
    const memberB = await seedAsset(runner, tenantB, 'srv-b');
    await addMember(runner, tenantB, clusterB, memberB);
    const cB = await seedConnection(runner, tenantB, 'Connection B', { source: clusterB });
    await setCurrentTenant(runner, tenantB);
    const onB = await svc.listByAsset(memberB, tenantB, opts);
    assert.deepEqual(onB.items.map((item: any) => [item.id, item.inherited]), [[cB, true]]);
    await setCurrentTenant(runner, tenantA);
    assert.deepEqual(await svc.listByAsset(memberB, tenantA, opts), { items: [], total: 0 }, 'another tenant member: nothing');
    assert.deepEqual(await svc.listByAsset(m1, tenantB, opts), { items: [], total: 0 }, 'another tenant: nothing either');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

(async () => {
  await dataSource.initialize();
  try {
    await run();
    console.log('connections network tab: ok');
  } finally {
    await dataSource.destroy();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
