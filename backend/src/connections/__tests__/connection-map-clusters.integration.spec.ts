// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.
import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { DEFAULT_CLASSIFICATION_CATALOG } from '../../it-ops-settings/classification-catalog';
import { Asset } from '../../assets/asset.entity';
import { Connection } from '../connection.entity';
import { ConnectionServer } from '../connection-server.entity';
import { ConnectionProtocol } from '../connection-protocol.entity';
import { ConnectionLeg } from '../connection-leg.entity';
import { ConnectionsListService } from '../services/connections-list.service';
import { seedTenant, setCurrentTenant } from '../../interfaces/__tests__/interface-seed-helpers';

// Clusters pass, lot C1y: the map draws the members in service of every cluster it draws.
// A member only drawn through its cluster is `implicit_member`, a cluster lists its in-service
// members (never a retired one), and a multi-server connection keeps its named server list.

const SETTINGS = {
  lifecycleStates: [{ code: 'active' }],
  serverRoles: [{ code: 'app', graph_tier: 'top' }],
  entities: [],
  connectionTypes: [],
  hostingTypes: [],
};

function service(runner: QueryRunner) {
  const mg = runner.manager;
  const settings = {
    getSettings: async () => SETTINGS,
    getClassificationCatalog: async () => DEFAULT_CLASSIFICATION_CATALOG,
  };
  return new ConnectionsListService(
    mg.getRepository(Connection),
    mg.getRepository(ConnectionServer),
    mg.getRepository(ConnectionProtocol),
    mg.getRepository(ConnectionLeg),
    mg.getRepository(Asset),
    settings as any,
  );
}

async function seedAsset(
  runner: QueryRunner,
  tenantId: string,
  name: string,
  opts: { cluster?: boolean; retired?: boolean } = {},
): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO assets (tenant_id, name, kind, provider, environment, status, is_cluster, created_at, updated_at)
     VALUES ($1, $2, 'physical_server', 'on_premise', 'prod', $3, $4, now(), now()) RETURNING id`,
    [tenantId, name, opts.retired ? 'retired' : 'active', !!opts.cluster],
  );
  return row.id as string;
}

async function addMember(runner: QueryRunner, tenantId: string, clusterId: string, assetId: string) {
  await runner.query(
    `INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3)`,
    [tenantId, clusterId, assetId],
  );
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantA = await seedTenant(runner, 'c1y-map');
    const mg = runner.manager;
    const cluster = await seedAsset(runner, tenantA, 'Cluster One', { cluster: true });
    const memberA = await seedAsset(runner, tenantA, 'Member A');
    const memberB = await seedAsset(runner, tenantA, 'Member B');
    const retired = await seedAsset(runner, tenantA, 'Retired member', { retired: true });
    const emptyCluster = await seedAsset(runner, tenantA, 'Empty cluster', { cluster: true });
    const other = await seedAsset(runner, tenantA, 'Other server');
    await addMember(runner, tenantA, cluster, memberA);
    await addMember(runner, tenantA, cluster, memberB);
    await addMember(runner, tenantA, cluster, retired);

    // The cluster is an endpoint, one member is also named by another connection.
    await runner.query(
      `INSERT INTO connections (tenant_id, name, topology, source_entity_code, destination_asset_id, lifecycle)
       VALUES ($1, 'Entity to cluster', 'server_to_server', 'dmz', $2, 'active')`,
      [tenantA, cluster],
    );
    await runner.query(
      `INSERT INTO connections (tenant_id, name, topology, source_asset_id, source_entity_code, lifecycle)
       VALUES ($1, 'Named member', 'server_to_server', $2, 'dmz', 'active')`,
      [tenantA, memberA],
    );
    await runner.query(
      `INSERT INTO connections (tenant_id, name, topology, source_entity_code, destination_asset_id, lifecycle)
       VALUES ($1, 'Empty cluster flow', 'server_to_server', 'dmz', $2, 'active')`,
      [tenantA, emptyCluster],
    );
    // A multi-server connection names the cluster and another server, never its members.
    const [multi] = await runner.query(
      `INSERT INTO connections (tenant_id, name, topology, lifecycle)
       VALUES ($1, 'Multi list', 'multi_server', 'active') RETURNING id`,
      [tenantA],
    );
    const serverRepo = mg.getRepository(ConnectionServer);
    await serverRepo.save([
      serverRepo.create({ tenant_id: tenantA, connection_id: multi.id, asset_id: cluster }),
      serverRepo.create({ tenant_id: tenantA, connection_id: multi.id, asset_id: other }),
    ]);

    // A role assigned to the cluster gives its implicit members their tier (B1a).
    const [application] = await runner.query(
      `INSERT INTO applications (tenant_id, name) VALUES ($1, 'Map app') RETURNING id`,
      [tenantA],
    );
    const [instance] = await runner.query(
      `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`,
      [tenantA, application.id],
    );
    await runner.query(
      `INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'app')`,
      [tenantA, instance.id, cluster],
    );

    const map = await service(runner).map(tenantA, { environment: 'prod' }, { manager: mg });
    const nodes = new Map<string, any>(map.nodes.map((node: any) => [node.id, node]));

    const clusterNode = nodes.get(cluster);
    assert.equal(clusterNode.kind, 'cluster');
    assert.equal(clusterNode.implicit_member, false);
    assert.deepEqual(clusterNode.member_server_ids, [memberA, memberB]);
    assert.equal(nodes.get(memberA).implicit_member, false, 'named by its own connection');
    assert.equal(nodes.get(memberB).implicit_member, true);
    assert.equal(nodes.get(memberB).kind, 'server');
    assert.equal(nodes.has(retired), false, 'a retired member is not drawn');
    assert.deepEqual(nodes.get(emptyCluster).member_server_ids, []);
    assert.equal(nodes.get(memberB).graph_tier, 'top', 'the member takes the cluster role tier');

    assert.deepEqual(
      (map.clusterMemberships ?? [])
        .filter((row: any) => row.cluster_id === cluster)
        .map((row: any) => row.server_id)
        .sort(),
      [memberA, memberB].sort(),
    );

    const multiDto = map.connections.find((row: any) => row.name === 'Multi list')!;
    assert.deepEqual([...multiDto.server_ids].sort(), [cluster, other].sort());
    assert.equal(multiDto.server_ids.includes(memberA), false);
    assert.equal(multiDto.server_ids.includes(memberB), false);

    // Another tenant's cluster and members never appear.
    const tenantB = await seedTenant(runner, 'c1y-map-b');
    const clusterB = await seedAsset(runner, tenantB, 'Cluster B', { cluster: true });
    const memberB2 = await seedAsset(runner, tenantB, 'Member B2');
    await addMember(runner, tenantB, clusterB, memberB2);
    await runner.query(
      `INSERT INTO connections (tenant_id, name, topology, source_entity_code, destination_asset_id, lifecycle)
       VALUES ($1, 'Tenant B flow', 'server_to_server', 'dmz', $2, 'active')`,
      [tenantB, clusterB],
    );
    await setCurrentTenant(runner, tenantA);
    const mapA = await service(runner).map(tenantA, { environment: 'prod' }, { manager: mg });
    const ids = new Set(mapA.nodes.map((node: any) => node.id));
    assert.equal(ids.has(clusterB), false);
    assert.equal(ids.has(memberB2), false);
    assert.equal(mapA.connections.some((row: any) => row.name === 'Tenant B flow'), false);

  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('connection map clusters integration tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
