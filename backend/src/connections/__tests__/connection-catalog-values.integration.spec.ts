import { ConnectionsService } from '../services/connections.service';
import { assert, inP7Tenant, refusedAsRetired, retiredCode, runP7Specs, type P7Harness } from '../../it-ops-settings/__tests__/catalog-p7.fixtures';

// Lot K2c of 26.12.1: rule P7 (maintainer, 2026-11-23) on a connection's catalog values: lifecycle,
// protocols (both forms), entity at an end, and a hop's function, protocols and entity. A retired
// value is refused on a connection (or hop) that does not hold it, kept on the one that holds it.
// @database-spec: boots the app context through catalog-p7.fixtures, so run-ci-tests.js runs this file on a database lane.

async function testRetiredValues(harness: P7Harness) {
  const connections = harness.get<ConnectionsService>(ConnectionsService);
  await inP7Tenant(harness, async ({ tenantId, locationId, runner }) => {
    const opts = { manager: runner.manager, tenantId };
    const asset = async (name: string) => String((await runner.query(
      `INSERT INTO assets (tenant_id, name, kind, environment, location_id) VALUES ($1, $2, 'physical_server', 'prod', $3) RETURNING id`,
      [tenantId, name, locationId],
    ))[0].id);
    const source = await asset('srv-a');
    const target = await asset('srv-b');
    const base = { topology: 'server_to_server', source_asset_id: source, destination_asset_id: target, protocol_codes: ['https'] };
    const protocol = retiredCode('connectionTypes');
    const entity = retiredCode('entities');

    await refusedAsRetired(() => connections.create({ ...base, name: 'c1', lifecycle: retiredCode('lifecycleStates') }, tenantId, null, opts), 'create lifecycle');
    await refusedAsRetired(() => connections.create({ ...base, name: 'c2', protocol_codes: [protocol] }, tenantId, null, opts), 'create protocol');
    await refusedAsRetired(() => connections.create({ ...base, name: 'c3', source_asset_id: null, source_entity_code: entity }, tenantId, null, opts), 'create entity');

    const other = await connections.create({ ...base, name: 'other' }, tenantId, null, opts);
    await refusedAsRetired(() => connections.update(other.id, { lifecycle: retiredCode('lifecycleStates') }, tenantId, null, opts), 'update lifecycle');
    await refusedAsRetired(() => connections.update(other.id, { protocol_codes: ['https', protocol] }, tenantId, null, opts), 'update protocol codes');
    await refusedAsRetired(() => connections.update(other.id, { protocols: [{ code: protocol, port_override: '8443' }] }, tenantId, null, opts), 'update protocols');
    await refusedAsRetired(() => connections.update(other.id, { source_asset_id: null, source_entity_code: entity }, tenantId, null, opts), 'update entity');
    await refusedAsRetired(() => connections.createLeg(other.id, tenantId, { function_code: retiredCode('pathHopFunctions'), protocol_codes: ['https'] }, null, opts), 'hop function');
    await refusedAsRetired(() => connections.createLeg(other.id, tenantId, { protocol_codes: [protocol] }, null, opts), 'hop protocol');
    await refusedAsRetired(() => connections.createLeg(other.id, tenantId, { protocol_codes: ['https'], equipment_entity_code: entity }, null, opts), 'hop entity');

    // The connection and the hop that hold them keep them.
    const holder = await connections.create({ ...base, name: 'holder' }, tenantId, null, opts);
    await runner.query(`UPDATE connections SET lifecycle = $3, source_asset_id = NULL, source_entity_code = $4 WHERE tenant_id = $1 AND id = $2`,
      [tenantId, holder.id, retiredCode('lifecycleStates'), entity]);
    await runner.query(`UPDATE connection_protocols SET connection_type_code = $3 WHERE tenant_id = $1 AND connection_id = $2`, [tenantId, holder.id, protocol]);
    await connections.update(holder.id, { name: 'holder 2', lifecycle: retiredCode('lifecycleStates'), protocol_codes: [protocol, 'https'], source_entity_code: entity }, tenantId, null, opts);
    await connections.update(holder.id, { protocols: [{ code: protocol, port_override: '8443' }] }, tenantId, null, opts);
    const [row] = await runner.query(`SELECT name, lifecycle, source_entity_code FROM connections WHERE id = $1`, [holder.id]);
    assert.deepEqual([row.name, row.lifecycle, row.source_entity_code], ['holder 2', retiredCode('lifecycleStates'), entity]);
    const leg = await connections.createLeg(holder.id, tenantId, { protocol_codes: ['https'] }, null, opts) as any;
    await runner.query(`UPDATE connection_legs SET function_code = $2, protocol_codes = $3, equipment_entity_code = $4 WHERE id = $1`,
      [leg.id, retiredCode('pathHopFunctions'), [protocol], entity]);
    await connections.updateLeg(holder.id, leg.id, tenantId, {
      function_code: retiredCode('pathHopFunctions'), protocol_codes: [protocol], equipment_entity_code: entity, notes: 'Kept',
    }, null, opts);
    const [hop] = await runner.query(`SELECT function_code, protocol_codes, equipment_entity_code FROM connection_legs WHERE id = $1`, [leg.id]);
    assert.deepEqual([hop.function_code, hop.protocol_codes, hop.equipment_entity_code], [retiredCode('pathHopFunctions'), [protocol], entity]);
  });
}

runP7Specs('connection-catalog-values.integration.spec.ts', [['retired values', testRetiredValues]]).catch((error) => {
  console.error(error);
  process.exit(1);
});
