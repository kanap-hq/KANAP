// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Asset } from '../asset.entity';
import { AssetClusterMember } from '../asset-cluster-member.entity';
import { AssetsCrudService } from '../services/assets-crud.service';
import { AssetsListService } from '../services/assets-list.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { application, asset, assign, member } from '../../technologies/__tests__/technologies.fixtures';

// The connection map side panel reads this summary. A member returns every IP address, the network
// zone of the first address's subnet (the asset list's segment), and its real clusters by name.
// A cluster, a plain asset and a membership left on an asset that is no longer a cluster do not.
// The panel opens the asset and its applications by their references (SRV-n, APP-n).

async function testMapSummary() {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, 'map-summary');
    const paris = randomUUID();
    await runner.query(
      `INSERT INTO locations (id, tenant_id, location_reference, name, hosting_type) VALUES ($1, $2, 'LOC-P', 'Paris', 'on_prem')`,
      [paris, tenantId],
    );
    await runner.query(
      `UPDATE tenants SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('it_ops', jsonb_build_object('subnets', $2::jsonb)) WHERE id = $1`,
      [tenantId, JSON.stringify([
        { location_id: paris, cidr: '10.1.0.0/24', network_zone: 'dmz' },
        { location_id: '', cidr: '10.9.0.0/24', network_zone: 'mgmt' },
      ])],
    );
    const alpha = await asset(runner, tenantId, 'Alpha-cl', true);
    const beta = await asset(runner, tenantId, 'beta-cl', true);
    const former = await asset(runner, tenantId, 'former-cl', true);
    const node = await asset(runner, tenantId, 'node-1');
    const plain = await asset(runner, tenantId, 'plain');
    await member(runner, tenantId, beta, node);
    await member(runner, tenantId, alpha, node);
    await member(runner, tenantId, former, node);
    await runner.query(`UPDATE assets SET is_cluster = false WHERE tenant_id = $1 AND id = $2`, [tenantId, former]);
    await runner.query(
      `UPDATE assets SET location_id = $3, ip_addresses = $4::jsonb WHERE tenant_id = $1 AND id = $2`,
      [tenantId, node, paris, JSON.stringify([
        { type: 'host', ip: '10.1.0.8', subnet_cidr: '10.1.0.0/24' },
        { type: 'management', ip: '10.9.0.8', subnet_cidr: '10.9.0.0/24' },
      ])],
    );

    await runner.query(`UPDATE assets SET asset_reference = 'SRV-8' WHERE tenant_id = $1 AND id = $2`, [tenantId, node]);
    const crm = await application(runner, tenantId, 'CRM');
    await runner.query(`UPDATE applications SET sequential_id = 'APP-4' WHERE tenant_id = $1 AND id = $2`, [tenantId, crm]);
    await assign(runner, tenantId, crm, node);

    const service = new AssetsListService(runner.manager.getRepository(Asset));
    const opts = { manager: runner.manager, tenantId };
    const summary = await service.mapSummary(node, opts);
    assert.equal(summary.asset_reference, 'SRV-8', 'the panel opens the asset by its reference');
    assert.deepEqual(summary.assigned_applications.map((app: any) => [app.id, app.reference]), [[crm, 'APP-4']], 'and its applications by theirs');
    assert.deepEqual(
      (summary.ip_addresses ?? []).map((entry) => [entry.type, entry.ip, entry.subnet_cidr]),
      [
        ['host', '10.1.0.8', '10.1.0.0/24'],
        ['management', '10.9.0.8', '10.9.0.0/24'],
      ],
    );
    assert.equal(summary.network_segment, 'dmz');
    assert.deepEqual(summary.clusters, [
      { id: alpha, name: 'Alpha-cl' },
      { id: beta, name: 'beta-cl' },
    ]);

    // The Technical tab lists a cluster's members and a member's clusters, opened by their SRV-n.
    await runner.query(`UPDATE assets SET asset_reference = 'SRV-1' WHERE tenant_id = $1 AND id = $2`, [tenantId, alpha]);
    const crud = new AssetsCrudService(runner.manager.getRepository(Asset), runner.manager.getRepository(AssetClusterMember), null as any, null as any, null as any, null as any);
    assert.deepEqual((await crud.listClusterMembers(alpha, opts)).items.map((row) => [row.id, row.asset_reference]), [[node, 'SRV-8']], 'a member by its reference');
    const numbered: Array<{ name: string; asset_reference: string }> = await runner.query(
      `SELECT name, asset_reference FROM assets WHERE tenant_id = $1 AND id = ANY($2::uuid[]) ORDER BY name`, [tenantId, [alpha, beta, former]],
    );
    assert.equal(numbered[0].asset_reference, 'SRV-1');
    assert.deepEqual((await crud.listClustersForAsset(node, opts)).items.map((row) => [row.name, row.reference]), numbered.map((row) => [row.name, row.asset_reference]), 'its clusters by theirs');

    const ofCluster = await service.mapSummary(alpha, opts);
    assert.deepEqual(ofCluster.clusters, []);
    assert.equal(ofCluster.network_segment, null);
    assert.equal(ofCluster.ip_addresses, null);

    const ofPlain = await service.mapSummary(plain, opts);
    assert.deepEqual(ofPlain.clusters, []);
    assert.equal(ofPlain.network_segment, null);
    assert.equal(ofPlain.ip_addresses, null);
  });
}

runSpecs('asset-map-summary.integration.spec.ts', [
  ['mapSummary returns IP addresses, the network segment and the clusters of a member', testMapSummary],
]);
