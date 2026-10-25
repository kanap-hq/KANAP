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
import { ConnectionsCrudService } from '../services/connections-crud.service';
import { ConnectionsLegsService } from '../services/connections-legs.service';
import { seedTenant } from '../../interfaces/__tests__/interface-seed-helpers';

// Clusters pass, lot C1y: the equipment of a hop comes back with the hop, as the screen reads it.
// A cluster equipment carries `is_cluster`, an entity or no equipment gives null, and the
// connection's servers and endpoints carry the asset reference too.

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
    crud: new ConnectionsCrudService(
      mg.getRepository(Connection),
      mg.getRepository(ConnectionServer),
      mg.getRepository(ConnectionProtocol),
      mg.getRepository(ConnectionLeg),
      mg.getRepository(Asset),
      settings as any,
      audit as any,
    ),
    legs: new ConnectionsLegsService(
      mg.getRepository(Connection),
      mg.getRepository(ConnectionServer),
      mg.getRepository(ConnectionProtocol),
      mg.getRepository(ConnectionLeg),
      mg.getRepository(Asset),
      settings as any,
      audit as any,
    ),
  };
}

async function seedAsset(
  runner: QueryRunner,
  tenantId: string,
  name: string,
  reference: string,
  opts: { cluster?: boolean } = {},
): Promise<string> {
  const [row] = await runner.query(
    `INSERT INTO assets (tenant_id, name, asset_reference, kind, provider, environment, status, is_cluster, created_at, updated_at)
     VALUES ($1, $2, $3, 'physical_server', 'on_premise', 'prod', 'active', $4, now(), now()) RETURNING id`,
    [tenantId, name, reference, !!opts.cluster],
  );
  return row.id as string;
}

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenant = await seedTenant(runner, 'c1y-legs');
    const { crud, legs } = service(runner);
    const opts = { manager: runner.manager };
    const cluster = await seedAsset(runner, tenant, 'Equipment cluster', 'AST-CL-1', { cluster: true });
    const plain = await seedAsset(runner, tenant, 'Equipment server', 'AST-SRV-2');
    const source = await seedAsset(runner, tenant, 'Source server', 'AST-SRC-3');
    const destination = await seedAsset(runner, tenant, 'Destination server', 'AST-DST-4');

    // The endpoints and the multi-server list carry the asset reference.
    const pointToPoint = await crud.create(
      {
        name: 'Equipment flow',
        topology: 'server_to_server',
        protocols: ['https'],
        source_asset_id: source,
        destination_asset_id: destination,
      },
      tenant,
      null,
      opts,
    );
    const multi = await crud.create(
      { name: 'Equipment list', topology: 'multi_server', protocols: ['https'], servers: [source, destination] },
      tenant,
      null,
      opts,
    );
    const pointDetail = await crud.get(pointToPoint.id, tenant, { ...opts, includeLegs: true });
    assert.equal(pointDetail.source_server?.asset_reference, 'AST-SRC-3');
    assert.equal(pointDetail.destination_server?.asset_reference, 'AST-DST-4');
    const multiDetail = await crud.get(multi.id, tenant, opts);
    assert.deepEqual(
      multiDetail.servers.map((server: any) => server.asset_reference).sort(),
      ['AST-DST-4', 'AST-SRC-3'],
    );

    // Three hops: a cluster, a plain server, none, and an entity.
    const clusterLeg = await legs.createLeg(
      pointToPoint.id,
      tenant,
      { equipment_server_id: cluster, protocol_codes: ['https'] },
      null,
      opts,
    );
    assert.deepEqual(clusterLeg.equipment_asset, {
      id: cluster,
      name: 'Equipment cluster',
      asset_reference: 'AST-CL-1',
      environment: 'prod',
      kind: 'physical_server',
      provider: 'on_premise',
      is_cluster: true,
    });
    const plainLeg = await legs.createLeg(
      pointToPoint.id,
      tenant,
      { equipment_server_id: plain, protocol_codes: ['https'] },
      null,
      opts,
    );
    assert.equal(plainLeg.equipment_asset?.asset_reference, 'AST-SRV-2');
    assert.equal(plainLeg.equipment_asset?.is_cluster, false);
    const emptyLeg = await legs.createLeg(
      pointToPoint.id,
      tenant,
      { protocol_codes: ['https'] },
      null,
      opts,
    );
    assert.equal(emptyLeg.equipment_asset, null);
    const entityLeg = await legs.createLeg(
      pointToPoint.id,
      tenant,
      { equipment_entity_code: 'dmz', protocol_codes: ['https'] },
      null,
      opts,
    );
    assert.equal(entityLeg.equipment_asset, null);

    // get with includeLegs returns the same summaries.
    const detail = await crud.get(pointToPoint.id, tenant, { ...opts, includeLegs: true });
    const byId = new Map((detail.legs ?? []).map((leg: any) => [leg.id, leg]));
    assert.equal(byId.get(clusterLeg.id).equipment_asset.is_cluster, true);
    assert.equal(byId.get(clusterLeg.id).equipment_asset.asset_reference, 'AST-CL-1');
    assert.equal(byId.get(plainLeg.id).equipment_asset.asset_reference, 'AST-SRV-2');
    assert.equal(byId.get(emptyLeg.id).equipment_asset, null);
    assert.equal(byId.get(entityLeg.id).equipment_asset, null);

    // listLegs returns them too.
    const listed = await legs.listLegs(pointToPoint.id, tenant, opts);
    assert.equal(listed.length, 4);
    assert.equal(listed.find((leg: any) => leg.id === clusterLeg.id)?.equipment_asset?.is_cluster, true);
    assert.equal(listed.find((leg: any) => leg.id === emptyLeg.id)?.equipment_asset, null);

    // updateLeg answers with the new equipment.
    const moved = await legs.updateLeg(
      pointToPoint.id,
      emptyLeg.id,
      tenant,
      { equipment_server_id: cluster },
      null,
      opts,
    );
    assert.equal(moved.equipment_asset?.id, cluster);
    assert.equal(moved.equipment_asset?.is_cluster, true);
    const cleared = await legs.updateLeg(
      pointToPoint.id,
      plainLeg.id,
      tenant,
      { equipment_server_id: null },
      null,
      opts,
    );
    assert.equal(cleared.equipment_asset, null);

  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('connection leg equipment integration tests passed'))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
