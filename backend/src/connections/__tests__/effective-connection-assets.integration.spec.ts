import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { seedTenant, setCurrentTenant } from '../../interfaces/__tests__/interface-seed-helpers';
import {
  effectiveConnectionAssetsSql,
  type ConnectionAssetPart,
  type ViaCluster,
} from '../effective-connection-assets';

// Clusters pass, lot C1x: an endpoint, a server of a multi-server connection or the equipment of a
// hop written on a cluster counts for its members, computed when read
// (`effectiveConnectionAssetsSql`). The fragment (one row per connection, asset, part and hop
// order, inherited rows marked with their clusters, the direct row winning, retired assets left
// out) and its `connections` / `assets` filters. Each test runs under throwaway tenants in a
// rolled-back transaction.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

type EffectiveRow = {
  connection_id: string;
  asset_id: string;
  part: ConnectionAssetPart;
  hop_order: number | null;
  inherited: boolean;
  via_clusters: ViaCluster[];
};

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
  return row.id;
}

const addMember = (runner: QueryRunner, tenantId: string, clusterId: string, assetId: string) =>
  runner.query(`INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3)`, [tenantId, clusterId, assetId]);

async function seedConnection(
  runner: QueryRunner,
  tenantId: string,
  connectionReference: string,
  opts: { source?: string; destination?: string; topology?: string } = {},
): Promise<string> {
  const id = randomUUID();
  await runner.query(
    `INSERT INTO connections (id, tenant_id, connection_reference, name, topology, source_asset_id, destination_asset_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, tenantId, connectionReference, `Connection ${connectionReference}`, opts.topology ?? 'server_to_server', opts.source ?? null, opts.destination ?? null],
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

function read(runner: QueryRunner, sql: string, params: unknown[]): Promise<EffectiveRow[]> {
  return runner.query(
    `SELECT e.connection_id, e.asset_id, e.part, e.hop_order, e.inherited, e.via_clusters
       FROM (${sql}) e
      ORDER BY e.connection_id, e.asset_id, e.part, e.hop_order`,
    params,
  );
}

const all = (runner: QueryRunner, tenantId: string) =>
  read(runner, effectiveConnectionAssetsSql({ tenant: '$1' }), [tenantId]);

const byAsset = (runner: QueryRunner, tenantId: string, assetId: string) =>
  read(runner, effectiveConnectionAssetsSql({ tenant: '$1', assets: '$2' }), [tenantId, [assetId]]);

const byConnections = (runner: QueryRunner, tenantId: string, connectionIds: string[]) =>
  read(runner, effectiveConnectionAssetsSql({ tenant: '$1', connections: '$2' }), [tenantId, connectionIds]);

const byConnectionAndAsset = (runner: QueryRunner, tenantId: string, connectionIds: string[], assetIds: string[]) =>
  read(runner, effectiveConnectionAssetsSql({ tenant: '$1', connections: '$2', assets: '$3' }), [tenantId, connectionIds, assetIds]);

/** `[part, hop_order, inherited, via cluster names]`, per connection, for a readable assertion. */
function shape(rows: EffectiveRow[], connectionId: string) {
  return rows
    .filter((row) => row.connection_id === connectionId)
    .map((row) => [row.part, row.hop_order, row.inherited, row.via_clusters.map((via) => via.name)]);
}

async function run() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    // A second tenant with its own cluster: its row and its member's inherited row, and nothing
    // from the first tenant.
    const u = await seedTenant(runner, 'other');
    const uCluster = await seedAsset(runner, u, 'other-cluster', { cluster: true });
    const uMember = await seedAsset(runner, u, 'other-member');
    await addMember(runner, u, uCluster, uMember);
    const uConnection = await seedConnection(runner, u, 'CON-U-1', { source: uCluster });
    assert.deepEqual((await all(runner, u)).map((row) => [row.asset_id, row.inherited]).sort(), [
      [uCluster, false],
      [uMember, true],
    ].sort());

    const t = await seedTenant(runner, 'main');
    // Names are reversed against creation order, so `via_clusters` sorted by name is not creation
    // order.
    const clZ = await seedAsset(runner, t, 'cluster-z', { cluster: true });
    const clA = await seedAsset(runner, t, 'cluster-a', { cluster: true });
    const clRetired = await seedAsset(runner, t, 'cluster-retired', { cluster: true, retired: true });
    const s1 = await seedAsset(runner, t, 'srv-1');
    const s2 = await seedAsset(runner, t, 'srv-2');
    const s3 = await seedAsset(runner, t, 'srv-3', { retired: true });
    const s4 = await seedAsset(runner, t, 'srv-4');
    const s5 = await seedAsset(runner, t, 'srv-5');
    const s6 = await seedAsset(runner, t, 'srv-6');
    await addMember(runner, t, clZ, s1);
    await addMember(runner, t, clZ, s2);
    await addMember(runner, t, clZ, s3);
    await addMember(runner, t, clA, s2);
    await addMember(runner, t, clRetired, s4);

    const cSource = await seedConnection(runner, t, 'CON-SRC', { source: clZ, destination: s5 });
    const cDestination = await seedConnection(runner, t, 'CON-DST', { source: s5, destination: clZ });
    // Older data: the server list names the cluster and one of its members.
    const cServer = await seedConnection(runner, t, 'CON-SRV', { topology: 'multi_server' });
    await addServer(runner, t, cServer, clZ);
    await addServer(runner, t, cServer, s1);
    const cHop = await seedConnection(runner, t, 'CON-HOP', { source: s5, destination: s6 });
    await addLeg(runner, t, cHop, 1, clZ);
    await addLeg(runner, t, cHop, 2, s5);
    // The same connection in the same place on two clusters of the same member.
    const cTwo = await seedConnection(runner, t, 'CON-TWO', { topology: 'multi_server' });
    await addServer(runner, t, cTwo, clZ);
    await addServer(runner, t, cTwo, clA);
    const cRetiredCluster = await seedConnection(runner, t, 'CON-RET-CL', { source: clRetired, destination: clZ });
    const cRetiredMember = await seedConnection(runner, t, 'CON-RET-MB', { source: s3, destination: s5 });

    // --- The fragment: direct rows on the cluster, inherited rows on its members in service.
    assert.deepEqual(await all(runner, u), [], 'the first tenant reads nothing of the second');
    assert.deepEqual(await byAsset(runner, t, uMember), [], 'nor the second tenant of the first');
    assert.equal((await all(runner, t)).some((row) => row.asset_id === uMember), false);

    const onCluster = await byAsset(runner, t, clZ);
    assert.deepEqual(shape(onCluster, cSource), [['source', null, false, []]], 'the cluster keeps its own source');
    assert.deepEqual(shape(onCluster, cDestination), [['destination', null, false, []]]);
    assert.deepEqual(shape(onCluster, cServer), [['server', null, false, []]]);
    assert.deepEqual(shape(onCluster, cHop), [['hop', 1, false, []]], 'a hop keeps its order');
    assert.deepEqual(shape(onCluster, cTwo), [['server', null, false, []]]);
    assert.deepEqual(shape(onCluster, cRetiredCluster), [['destination', null, false, []]]);
    assert.equal(onCluster.length, 6, 'one row per part, direct only, no member rows');

    const onS1 = await byAsset(runner, t, s1);
    assert.deepEqual(shape(onS1, cSource), [['source', null, true, ['cluster-z']]]);
    assert.deepEqual(shape(onS1, cDestination), [['destination', null, true, ['cluster-z']]]);
    assert.deepEqual(shape(onS1, cServer), [['server', null, false, ['cluster-z']]],
      'named directly and inherited alike: one row, the direct one wins, the cluster still named');
    assert.deepEqual(shape(onS1, cHop), [['hop', 1, true, ['cluster-z']]], 'the equipment of a hop');
    assert.deepEqual(shape(onS1, cTwo), [['server', null, true, ['cluster-z']]]);
    assert.deepEqual(shape(onS1, cRetiredCluster), [['destination', null, true, ['cluster-z']]]);
    assert.equal(onS1.length, 6);

    const onS2 = await byAsset(runner, t, s2);
    assert.deepEqual(shape(onS2, cTwo), [['server', null, true, ['cluster-a', 'cluster-z']]],
      'a member of two clusters: one row, both named, by name then id');
    assert.deepEqual(shape(onS2, cSource), [['source', null, true, ['cluster-z']]]);
    assert.equal(onS2.length, 6);

    // A retired member inherits nothing, a direct row on it stays as it is.
    const onS3 = await byAsset(runner, t, s3);
    assert.deepEqual(onS3.map((row) => [row.connection_id, row.part, row.inherited]), [[cRetiredMember, 'source', false]],
      'the retired member keeps its direct row only');
    assert.deepEqual(shape(onS3, cSource), [], 'no inherited row for a retired member');
    assert.deepEqual(shape(onS3, cRetiredCluster), []);

    // A retired cluster keeps its own row and passes nothing on.
    assert.deepEqual(shape(await byAsset(runner, t, clRetired), cRetiredCluster), [['source', null, false, []]]);
    assert.deepEqual(await byAsset(runner, t, s4), [], 'a member of a retired cluster inherits nothing');

    const onS5 = await byAsset(runner, t, s5);
    assert.deepEqual(shape(onS5, cHop), [
      ['hop', 2, false, []],
      ['source', null, false, []],
    ], 'a hop order is kept per row');
    assert.deepEqual(shape(onS5, cSource), [['destination', null, false, []]]);
    assert.deepEqual(shape(onS5, cDestination), [['source', null, false, []]]);
    assert.deepEqual(shape(onS5, cRetiredMember), [['destination', null, false, []]]);

    // --- The filters: `connections` scopes the rows, `assets` the effective asset.
    const onSourceConnection = await byConnections(runner, t, [cSource]);
    assert.deepEqual(
      onSourceConnection
        .map((row) => [row.asset_id, row.part, row.inherited])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      [
        [clZ, 'source', false],
        [s1, 'source', true],
        [s2, 'source', true],
        [s5, 'destination', false],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
      'only this connection: its cluster, its members in service and its other end',
    );
    assert.deepEqual(await byConnections(runner, t, [cSource, cDestination]).then((rows) => new Set(rows.map((row) => row.connection_id))),
      new Set([cSource, cDestination]));
    assert.deepEqual(
      (await byConnectionAndAsset(runner, t, [cSource], [s2])).map((row) => [row.connection_id, row.asset_id, row.part, row.hop_order, row.inherited]),
      [[cSource, s2, 'source', null, true]],
    );
    assert.deepEqual(await byConnectionAndAsset(runner, t, [cSource], [uMember]), [], 'another tenant member: nothing');

    // --- Membership is read, not stored: added inherits at once, taken out loses it.
    await addMember(runner, t, clZ, s6);
    assert.deepEqual(
      (await byConnectionAndAsset(runner, t, [cSource], [s6])).map((row) => [row.part, row.inherited, row.via_clusters.map((via) => via.name)]),
      [['source', true, ['cluster-z']]],
      'a member added inherits',
    );
    await runner.query(`DELETE FROM asset_cluster_members WHERE tenant_id = $1 AND cluster_id = $2 AND asset_id = $3`, [t, clZ, s6]);
    assert.deepEqual(await byConnectionAndAsset(runner, t, [cSource], [s6]), [], 'a member taken out loses it');

    // --- The explicit tenant predicate of the fragment, from the other tenant's session too.
    await setCurrentTenant(runner, u);
    assert.deepEqual(await all(runner, t), [], 'the second tenant never sees the first tenant rows');
    await setCurrentTenant(runner, t);
    assert.equal((await all(runner, t)).some((row) => row.connection_id === uConnection), false);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

(async () => {
  await dataSource.initialize();
  try {
    await run();
    console.log('effective connection assets: ok');
  } finally {
    await dataSource.destroy();
  }
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
