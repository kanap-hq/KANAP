import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { Application } from '../../applications/application.entity';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/audit.entity';
import { InterfaceBinding } from '../../interface-bindings/interface-binding.entity';
import type { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { InterfaceEntity } from '../interface.entity';
import { InterfaceLeg } from '../interface-leg.entity';
import { InterfaceMiddlewareApplication } from '../interface-middleware-application.entity';
import { InterfaceBindingsManagementService } from '../services/interface-bindings.service';
import { seedApps, seedInterface, seedTenant } from './interface-seed-helpers';

// The infrastructure connections of an interface (interface map panel, GET
// /interfaces/:id/connection-links) against a real database. The list gathers the
// servers of each connection with raw SQL over the connection tables, so a column
// dropped by a migration only shows up here: it answered 500 for every interface
// linked to a connection once connection legs moved to a single equipment column.

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

async function run() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = await seedTenant(runner, 'conn-links');
    const apps = await seedApps(runner, tenantId);
    const iface = await seedInterface(runner, tenantId, apps, { name: 'Orders to warehouse' });

    const source = await seedAsset(runner, tenantId, 'par-app-01');
    const destination = await seedAsset(runner, tenantId, 'gou-wms-01');
    const firewall = await seedAsset(runner, tenantId, 'par-fw-01');
    const extra = await seedAsset(runner, tenantId, 'par-lb-01');

    const connectionId = randomUUID();
    await runner.query(
      `INSERT INTO connections (id, tenant_id, connection_reference, name, topology, source_asset_id, destination_asset_id)
       VALUES ($1, $2, $3, 'Paris to Gouda', 'server_to_server', $4, $5)`,
      [connectionId, tenantId, `CON-${connectionId.slice(0, 6)}`, source, destination],
    );
    await runner.query(
      `INSERT INTO connection_legs (tenant_id, connection_id, order_index, equipment_asset_id)
       VALUES ($1, $2, 1, $3), ($1, $2, 2, NULL)`,
      [tenantId, connectionId, firewall],
    );
    await runner.query(
      `INSERT INTO connection_servers (tenant_id, connection_id, asset_id) VALUES ($1, $2, $3)`,
      [tenantId, connectionId, extra],
    );
    await runner.query(
      `INSERT INTO interface_connection_links (tenant_id, interface_binding_id, connection_id) VALUES ($1, $2, $3)`,
      [tenantId, iface.bindingId, connectionId],
    );

    const manager = runner.manager;
    const itOpsSettings = { getSettings: async () => ({ entities: [] }) } as unknown as ItOpsSettingsService;
    const service = new InterfaceBindingsManagementService(
      manager.getRepository(InterfaceEntity),
      manager.getRepository(InterfaceLeg),
      manager.getRepository(InterfaceMiddlewareApplication),
      manager.getRepository(Application),
      manager.getRepository(InterfaceBinding),
      itOpsSettings,
      new AuditService(manager.getRepository(AuditLog)),
    );

    const { items } = await service.listConnectionLinksForInterface(iface.id, tenantId, { environment: 'prod' }, { manager });
    assert.equal(items.length, 1);
    assert.equal(items[0].connection.id, connectionId);
    // Its servers: both ends, the equipment of its legs and its extra servers, once each.
    assert.deepEqual(
      [...items[0].connection.server_ids].sort(),
      [source, destination, firewall, extra].sort(),
    );

    // A destination cluster and a hop cluster reach the servers through their members in service;
    // the retired members stay out.
    const destCluster = await seedAsset(runner, tenantId, 'gou-cluster', { cluster: true });
    const destMemberOne = await seedAsset(runner, tenantId, 'gou-wms-02');
    const destMemberTwo = await seedAsset(runner, tenantId, 'gou-wms-03');
    const destRetired = await seedAsset(runner, tenantId, 'gou-wms-retired', { retired: true });
    await addMember(runner, tenantId, destCluster, destMemberOne);
    await addMember(runner, tenantId, destCluster, destMemberTwo);
    await addMember(runner, tenantId, destCluster, destRetired);
    const hopCluster = await seedAsset(runner, tenantId, 'par-cluster', { cluster: true });
    const hopMemberOne = await seedAsset(runner, tenantId, 'par-srv-02');
    const hopMemberTwo = await seedAsset(runner, tenantId, 'par-srv-03');
    const hopRetired = await seedAsset(runner, tenantId, 'par-srv-retired', { retired: true });
    await addMember(runner, tenantId, hopCluster, hopMemberOne);
    await addMember(runner, tenantId, hopCluster, hopMemberTwo);
    await addMember(runner, tenantId, hopCluster, hopRetired);

    const clusterConnectionId = randomUUID();
    await runner.query(
      `INSERT INTO connections (id, tenant_id, connection_reference, name, topology, source_asset_id, destination_asset_id)
       VALUES ($1, $2, $3, 'Paris to the Gouda cluster', 'server_to_server', $4, $5)`,
      [clusterConnectionId, tenantId, `CON-${clusterConnectionId.slice(0, 6)}`, source, destCluster],
    );
    await runner.query(
      `INSERT INTO connection_legs (tenant_id, connection_id, order_index, equipment_asset_id)
       VALUES ($1, $2, 1, $3)`,
      [tenantId, clusterConnectionId, hopCluster],
    );
    await runner.query(
      `INSERT INTO interface_connection_links (tenant_id, interface_binding_id, connection_id) VALUES ($1, $2, $3)`,
      [tenantId, iface.bindingId, clusterConnectionId],
    );

    const clustered = await service.listConnectionLinksForInterface(iface.id, tenantId, { environment: 'prod' }, { manager });
    assert.equal(clustered.items.length, 2);
    const clusterItem = clustered.items.find((item) => item.connection.id === clusterConnectionId)!;
    assert.deepEqual(
      [...clusterItem.connection.server_ids].sort(),
      [source, destCluster, destMemberOne, destMemberTwo, hopCluster, hopMemberOne, hopMemberTwo].sort(),
      'the clusters and their members in service, not the retired members',
    );

    // No link in another environment.
    const other = await service.listConnectionLinksForInterface(iface.id, tenantId, { environment: 'dev' }, { manager });
    assert.equal(other.items.length, 0);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
}

run()
  .then(() => console.log('interface-connection-links.integration.spec.ts OK'))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
