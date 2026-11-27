import { InterfacesService } from '../services/interfaces.service';
import { InterfaceBindingsService } from '../../interface-bindings/interface-bindings.service';
import { seedManagedDocsKnowledgeAssets } from '../../knowledge/integrated-document-seed';
import { assert, inP7Tenant, refusedAsRetired, retiredCode, runP7Specs, type P7Harness } from '../../it-ops-settings/__tests__/catalog-p7.fixtures';

// Lot K2c of 26.12.1: rule P7 (maintainer, 2026-11-23) on an interface's catalog values: data
// category, lifecycle, a leg's trigger, pattern and format, a binding's authentication mode and
// status. A retired value is refused on an interface (or binding) that does not hold it, kept on the
// one that holds it. The interface is the record of its legs: a retired value one leg holds stays
// offered to its other legs.
// @database-spec: boots the app context through catalog-p7.fixtures, so run-ci-tests.js runs this file on a database lane.

async function testRetiredValues(harness: P7Harness) {
  const interfaces = harness.get<InterfacesService>(InterfacesService);
  const bindings = harness.get<InterfaceBindingsService>(InterfaceBindingsService);
  await inP7Tenant(harness, async ({ tenantId, runner }) => {
    const opts = { manager: runner.manager, tenantId };
    await seedManagedDocsKnowledgeAssets(runner.manager as any, tenantId);
    const app = async (name: string) => String((await runner.query(
      `INSERT INTO applications (tenant_id, name, status, lifecycle) VALUES ($1, $2, 'enabled', 'active') RETURNING id`, [tenantId, name]))[0].id);
    const source = await app('Orders');
    const target = await app('Billing');
    const instance = async (applicationId: string) => String((await runner.query(
      `INSERT INTO app_instances (tenant_id, application_id, environment, lifecycle, status) VALUES ($1, $2, 'prod', 'active', 'enabled') RETURNING id`,
      [tenantId, applicationId]))[0].id);
    const sourceInstance = await instance(source);
    const targetInstance = await instance(target);
    const base = { business_purpose: 'Invoices', data_category: 'master_data', source_application_id: source, target_application_id: target };

    await refusedAsRetired(() => interfaces.create({ ...base, name: 'i1', data_category: retiredCode('interfaceDataCategories') }, tenantId, null, opts), 'create data category');
    await refusedAsRetired(() => interfaces.create({ ...base, name: 'i2', lifecycle: retiredCode('lifecycleStates') }, tenantId, null, opts), 'create lifecycle');

    const other = await interfaces.create({ ...base, name: 'other' }, tenantId, null, opts) as any;
    await refusedAsRetired(() => interfaces.update(other.id, { data_category: retiredCode('interfaceDataCategories') }, tenantId, null, opts), 'update data category');
    await refusedAsRetired(() => interfaces.update(other.id, { lifecycle: retiredCode('lifecycleStates') }, tenantId, null, opts), 'update lifecycle');
    const [otherLeg] = await runner.query(`SELECT id FROM interface_legs WHERE interface_id = $1 ORDER BY order_index LIMIT 1`, [other.id]);
    for (const [field, list] of [['trigger_type', 'interfaceTriggerTypes'], ['integration_pattern', 'interfacePatterns'], ['data_format', 'interfaceFormats']] as const) {
      await refusedAsRetired(() => interfaces.updateLegs(other.id, { items: [{ id: otherLeg.id, [field]: retiredCode(list) }] }, tenantId, null, opts), `leg ${field}`);
    }
    await refusedAsRetired(() => bindings.create(other.id, {
      interface_leg_id: otherLeg.id, source_instance_id: sourceInstance, target_instance_id: targetInstance, authentication_mode: retiredCode('interfaceAuthModes'),
    }, tenantId, null, { manager: runner.manager }), 'binding authentication mode');
    await refusedAsRetired(() => bindings.create(other.id, {
      interface_leg_id: otherLeg.id, source_instance_id: sourceInstance, target_instance_id: targetInstance, status: retiredCode('lifecycleStates'),
    }, tenantId, null, { manager: runner.manager }), 'binding status');

    // The interface, its legs and its binding that hold them keep them.
    const holder = await interfaces.create({ ...base, name: 'holder' }, tenantId, null, opts) as any;
    await runner.query(`UPDATE interfaces SET data_category = $2, lifecycle = $3 WHERE id = $1`,
      [holder.id, retiredCode('interfaceDataCategories'), retiredCode('lifecycleStates')]);
    await interfaces.update(holder.id, { name: 'holder 2', data_category: retiredCode('interfaceDataCategories'), lifecycle: retiredCode('lifecycleStates') }, tenantId, null, opts);
    const legs = await runner.query(`SELECT id FROM interface_legs WHERE interface_id = $1 ORDER BY order_index`, [holder.id]);
    await runner.query(`UPDATE interface_legs SET trigger_type = $2 WHERE id = $1`, [legs[0].id, retiredCode('interfaceTriggerTypes')]);
    // Every leg of the interface may take the value one of its legs holds.
    await interfaces.updateLegs(holder.id, { items: legs.map((leg: any) => ({ id: leg.id, trigger_type: retiredCode('interfaceTriggerTypes') })) }, tenantId, null, opts);
    const triggers = await runner.query(`SELECT DISTINCT trigger_type FROM interface_legs WHERE interface_id = $1`, [holder.id]);
    assert.deepEqual(triggers.map((row: any) => row.trigger_type), [retiredCode('interfaceTriggerTypes')]);
    const binding = await bindings.create(holder.id, {
      interface_leg_id: legs[0].id, source_instance_id: sourceInstance, target_instance_id: targetInstance,
    }, tenantId, null, { manager: runner.manager }) as any;
    await runner.query(`UPDATE interface_bindings SET authentication_mode = $2, status = $3 WHERE id = $1`,
      [binding.id, retiredCode('interfaceAuthModes'), retiredCode('lifecycleStates')]);
    await bindings.update(binding.id, { authentication_mode: retiredCode('interfaceAuthModes'), status: retiredCode('lifecycleStates'), env_notes: 'Kept' }, tenantId, null, { manager: runner.manager });
    const [row] = await runner.query(`SELECT authentication_mode, status, env_notes FROM interface_bindings WHERE id = $1`, [binding.id]);
    assert.deepEqual([row.authentication_mode, row.status, row.env_notes], [retiredCode('interfaceAuthModes'), retiredCode('lifecycleStates'), 'Kept']);
    const [stored] = await runner.query(`SELECT name, data_category, lifecycle FROM interfaces WHERE id = $1`, [holder.id]);
    assert.deepEqual([stored.name, stored.data_category, stored.lifecycle], ['holder 2', retiredCode('interfaceDataCategories'), retiredCode('lifecycleStates')]);
  });
}

runP7Specs('interface-catalog-values.integration.spec.ts', [['retired values', testRetiredValues]]).catch((error) => {
  console.error(error);
  process.exit(1);
});
