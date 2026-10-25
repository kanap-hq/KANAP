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
import { absorbClusterMembers, type AbsorbedServer } from '../connection-cluster-rules';
import { ConnectionsCrudService } from '../services/connections-crud.service';
import { seedTenant, setCurrentTenant } from '../../interfaces/__tests__/interface-seed-helpers';

// Clusters pass, lot C1y: the writes of a connection whose endpoint or multi-server list holds a
// cluster. Source = destination is refused; a cluster and one of its members pass point to point;
// in a multi-server list the members of a listed cluster are absorbed, and the answer says which.

const SETTINGS = {
  lifecycleStates: [{ code: 'active' }],
  connectionTypes: [{ code: 'https' }],
  entities: [{ code: 'dmz' }],
};

function service(runner: QueryRunner) {
  const mg = runner.manager;
  const settings = {
    getSettingsForWrite: async () => SETTINGS,
    getSettings: async () => SETTINGS,
    getClassificationCatalog: async () => DEFAULT_CLASSIFICATION_CATALOG,
  };
  const audit = { log: async () => undefined };
  return {
    svc: new ConnectionsCrudService(
      mg.getRepository(Connection),
      mg.getRepository(ConnectionServer),
      mg.getRepository(ConnectionProtocol),
      mg.getRepository(ConnectionLeg),
      mg.getRepository(Asset),
      settings as any,
      audit as any,
    ),
    mg,
  };
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

async function storedServers(runner: QueryRunner, connectionId: string): Promise<string[]> {
  const rows = await runner.manager.getRepository(ConnectionServer).find({
    where: { connection_id: connectionId } as any,
  });
  return rows.map((row) => row.asset_id).sort();
}

async function refusal(run: () => Promise<unknown>): Promise<{ status?: number; code?: string; message: string }> {
  try {
    await run();
  } catch (error: any) {
    const body = typeof error?.getResponse === 'function' ? error.getResponse() : null;
    return {
      status: typeof error?.getStatus === 'function' ? error.getStatus() : undefined,
      code: body?.code,
      message: String(error?.message ?? error),
    };
  }
  throw new Error('expected a refusal');
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantA = await seedTenant(runner, 'c1y');
    const { svc, mg } = service(runner);
    const opts = { manager: mg };
    const create = (body: Record<string, unknown>) => svc.create(body, tenantA, null, opts);
    const update = (id: string, body: Record<string, unknown>) => svc.update(id, body, tenantA, null, opts);
    const pointToPoint = (name: string, source: string, destination: string) =>
      create({
        name,
        topology: 'server_to_server',
        protocols: ['https'],
        source_asset_id: source,
        destination_asset_id: destination,
      });
    const multi = (name: string, servers: string[]) =>
      create({ name, topology: 'multi_server', protocols: ['https'], servers });

    const cluster = await seedAsset(runner, tenantA, 'Cluster Alpha', { cluster: true });
    const member = await seedAsset(runner, tenantA, 'Member one');
    const member2 = await seedAsset(runner, tenantA, 'Member two');
    const other = await seedAsset(runner, tenantA, 'Other server');
    const retiredMember = await seedAsset(runner, tenantA, 'Retired member', { retired: true });
    const retiredCluster = await seedAsset(runner, tenantA, 'Retired cluster', { cluster: true, retired: true });
    await addMember(runner, tenantA, cluster, member);
    await addMember(runner, tenantA, cluster, member2);
    await addMember(runner, tenantA, cluster, retiredMember);
    await addMember(runner, tenantA, retiredCluster, other);

    // A point-to-point connection to itself is refused, with a stable code.
    const loop = await refusal(() => pointToPoint('Loop', member, member));
    assert.equal(loop.status, 400);
    assert.equal(loop.code, 'connection_same_endpoint');

    // An update may not move a destination onto its source.
    const plain = await pointToPoint('Plain flow', member, other);
    const loopedUpdate = await refusal(() => update(plain.id, { destination_asset_id: member }));
    assert.equal(loopedUpdate.status, 400);
    assert.equal(loopedUpdate.code, 'connection_same_endpoint');

    // An old looped connection still renames: its couple did not change.
    const [legacyLoop] = await runner.query(
      `INSERT INTO connections (tenant_id, name, topology, source_asset_id, destination_asset_id, lifecycle)
       VALUES ($1, 'Legacy loop', 'server_to_server', $2, $2, 'active') RETURNING id`,
      [tenantA, member],
    );
    const protoRepo = mg.getRepository(ConnectionProtocol);
    await protoRepo.save(
      protoRepo.create({
        tenant_id: tenantA,
        connection_id: legacyLoop.id,
        connection_type_code: 'https',
        port_override: null,
      }),
    );
    const renamed = await update(legacyLoop.id, { name: 'Legacy loop renamed' });
    assert.equal(renamed.name, 'Legacy loop renamed');
    assert.equal(renamed.source_asset_id, member);
    assert.equal(renamed.destination_asset_id, member);
    assert.deepEqual(renamed.absorbed, []);

    // Point to point, a cluster and its member (or two members of a cluster) are replication.
    const clusterToMember = await pointToPoint('Cluster to member', cluster, member);
    assert.equal(clusterToMember.source_asset_id, cluster);
    assert.equal(clusterToMember.destination_asset_id, member);
    assert.deepEqual(clusterToMember.absorbed, []);
    const memberToMember = await pointToPoint('Member to member', member, member2);
    assert.equal(memberToMember.source_asset_id, member);
    assert.equal(memberToMember.destination_asset_id, member2);
    assert.deepEqual(memberToMember.absorbed, []);

    // A multi-server list absorbs the listed member of its list's cluster.
    const absorbedList = await multi('Absorbed list', [cluster, member, other]);
    assert.deepEqual(await storedServers(runner, absorbedList.id), [cluster, other].sort());
    assert.deepEqual(absorbedList.absorbed satisfies AbsorbedServer[], [
      { asset_id: member, name: 'Member one', cluster_id: cluster, cluster_name: 'Cluster Alpha' },
    ]);

    // The list left with one asset is refused with the existing message.
    const tooSmall = await refusal(() => multi('Too small', [cluster, member]));
    assert.equal(tooSmall.status, 400);
    assert.match(tooSmall.message, /Select at least two assets for a multi-server connection/);

    // A retired member is not absorbed; a retired cluster absorbs nothing.
    const withRetiredMember = await multi('Retired member list', [cluster, retiredMember, other]);
    assert.deepEqual(withRetiredMember.absorbed, []);
    assert.deepEqual(await storedServers(runner, withRetiredMember.id), [cluster, retiredMember, other].sort());
    const withRetiredCluster = await multi('Retired cluster list', [retiredCluster, other, member]);
    assert.deepEqual(withRetiredCluster.absorbed, []);
    assert.deepEqual(await storedServers(runner, withRetiredCluster.id), [retiredCluster, other, member].sort());

    // A member of two listed clusters is absorbed once, under the first cluster by name.
    const alpha = await seedAsset(runner, tenantA, 'Alpha cluster', { cluster: true });
    const zulu = await seedAsset(runner, tenantA, 'Zulu cluster', { cluster: true });
    const shared = await seedAsset(runner, tenantA, 'Shared member');
    await addMember(runner, tenantA, alpha, shared);
    await addMember(runner, tenantA, zulu, shared);
    const sharedAbsorbed = await multi('Shared member list', [zulu, alpha, shared, other]);
    assert.deepEqual(sharedAbsorbed.absorbed, [
      { asset_id: shared, name: 'Shared member', cluster_id: alpha, cluster_name: 'Alpha cluster' },
    ]);

    // An update that sends `servers` applies the same absorption.
    const updatedList = await multi('Updated list', [cluster, other]);
    const updateAbsorbed = await update(updatedList.id, { servers: [cluster, member, other] });
    assert.deepEqual(updateAbsorbed.absorbed, [
      { asset_id: member, name: 'Member one', cluster_id: cluster, cluster_name: 'Cluster Alpha' },
    ]);
    assert.deepEqual(await storedServers(runner, updatedList.id), [cluster, other].sort());

    // An update without `servers` leaves the stored list alone, even when it holds a member.
    const untouched = await multi('Untouched list', [cluster, other]);
    const serverRepo = mg.getRepository(ConnectionServer);
    await serverRepo.save(
      serverRepo.create({ tenant_id: tenantA, connection_id: untouched.id, asset_id: member }),
    );
    const renamedList = await update(untouched.id, { name: 'Untouched list renamed' });
    assert.deepEqual(renamedList.absorbed, []);
    assert.equal(renamedList.name, 'Untouched list renamed');
    assert.deepEqual((await storedServers(runner, untouched.id)).sort(), [cluster, member, other].sort());

    // Another tenant's cluster and member are neither read nor absorbed.
    const tenantB = await seedTenant(runner, 'c1y-b');
    const clusterB = await seedAsset(runner, tenantB, 'Cluster B', { cluster: true });
    const memberB = await seedAsset(runner, tenantB, 'Member B');
    await addMember(runner, tenantB, clusterB, memberB);
    await setCurrentTenant(runner, tenantA);
    assert.deepEqual(await absorbClusterMembers(mg, tenantA, [clusterB, memberB]), {
      kept: [clusterB, memberB],
      absorbed: [],
    });
    const foreign = await refusal(() => multi('Foreign member list', [cluster, memberB]));
    assert.match(foreign.message, /Asset not found/);

  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('connection cluster writes integration tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
