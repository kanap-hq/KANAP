import { LocationsService } from '../locations.service';
import { ItOpsSettingsService } from '../../it-ops-settings/it-ops-settings.service';
import { assert, inP7Tenant, refusedAsRetired, retiredCode, runP7Specs, type P7Harness } from '../../it-ops-settings/__tests__/catalog-p7.fixtures';

// Lot K2c of 26.12.1, third pass: rule P7 (maintainer, 2026-11-23) on the hosting type and the
// provider of a site, and on the network zone of a subnet. A retired value is refused on a new site
// and on a site that does not hold it, and kept on the site that holds it; an unknown value is
// refused with the values allowed.
// @database-spec: boots the app context through catalog-p7.fixtures, so run-ci-tests.js runs this file on a database lane.

function codeOf(error: any): string | undefined {
  return error?.getResponse?.().code;
}

async function refusal(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail('the write is refused');
}

async function testSiteValues(harness: P7Harness) {
  const locations = harness.get<LocationsService>(LocationsService);
  await inP7Tenant(harness, async ({ tenantId, runner }) => {
    const opts = { manager: runner.manager };
    const hosting = retiredCode('hostingTypes');
    const provider = retiredCode('serverProviders');

    // API, creation: a retired hosting type or provider is refused, with its coded refusal.
    await refusedAsRetired(() => locations.create({ name: 'New DC', hosting_type: hosting }, tenantId, null, opts), 'a new site, hosting type');
    const retiredRefusal = await refusal(() => locations.create({ name: 'New cloud', hosting_type: 'public_cloud', provider }, tenantId, null, opts));
    assert.equal(codeOf(retiredRefusal), 'catalog_value_retired');
    assert.doesNotMatch(String(retiredRefusal.getResponse().params.allowed), new RegExp(provider), 'the values allowed leave the retired one out');
    // By its name, as the list shows it.
    const byName = await locations.create({ name: 'Named', hosting_type: 'Public Cloud', provider: 'AWS' }, tenantId, null, opts);
    assert.deepEqual([byName.hosting_type, byName.provider], ['public_cloud', 'aws']);
    const unknown = await refusal(() => locations.create({ name: 'Unknown', hosting_type: 'mainframe room' }, tenantId, null, opts));
    assert.equal(codeOf(unknown), 'catalog_value_unknown');
    assert.match(String(unknown.getResponse().params.allowed), /public_cloud \(Public Cloud\)/);

    // API, modification: refused on a site that does not hold it.
    await refusedAsRetired(() => locations.update(byName.id, { hosting_type: hosting }, tenantId, null, opts), 'a site that does not hold the hosting type');
    await refusedAsRetired(() => locations.update(byName.id, { provider }, tenantId, null, opts), 'a site that does not hold the provider');

    // The sites that hold them keep them: saved with their values and a new name.
    const [{ id: onPrem }] = await runner.query(
      `INSERT INTO locations (tenant_id, name, hosting_type) VALUES ($1, 'Old room', $2) RETURNING id`, [tenantId, hosting]);
    const keptType = await locations.update(String(onPrem), { name: 'Old room 2', hosting_type: hosting }, tenantId, null, opts);
    assert.deepEqual([keptType.name, keptType.hosting_type], ['Old room 2', hosting]);
    const [{ id: cloud }] = await runner.query(
      `INSERT INTO locations (tenant_id, name, hosting_type, provider) VALUES ($1, 'Old cloud', 'public_cloud', $2) RETURNING id`, [tenantId, provider]);
    const keptProvider = await locations.update(String(cloud), { name: 'Old cloud 2', provider }, tenantId, null, opts);
    assert.deepEqual([keptProvider.name, keptProvider.provider], ['Old cloud 2', provider]);
  });
}

async function testSubnetZone(harness: P7Harness) {
  const settings = harness.get<ItOpsSettingsService>(ItOpsSettingsService);
  await inP7Tenant(harness, async ({ tenantId, locationId, runner }) => {
    const opts = { manager: runner.manager };
    const zone = retiredCode('networkSegments');
    const segments = async (deprecated: boolean) => {
      const current = await settings.getSettings(tenantId, opts);
      return current.networkSegments.map((item: any) => (item.code === zone ? { ...item, deprecated } : item));
    };
    // A subnet gets the zone while it is offered, then the zone is retired.
    await settings.updateSettings(tenantId, { networkSegments: await segments(false) }, opts);
    const held = { location_id: locationId, cidr: '10.1.0.0/24', network_zone: zone };
    await settings.updateSettings(tenantId, { subnets: [held] }, opts);
    await settings.updateSettings(tenantId, { networkSegments: await segments(true) }, opts);

    // The subnet that holds it keeps it when the list is saved again.
    const saved = await settings.updateSettings(tenantId, { subnets: [{ ...held, description: 'kept' }] }, opts);
    assert.equal(saved.subnets.find((subnet: any) => subnet.cidr === '10.1.0.0/24')?.network_zone, zone);
    // A new subnet cannot take it.
    const refused = await refusal(() => settings.updateSettings(tenantId, {
      subnets: [held, { location_id: locationId, cidr: '10.2.0.0/24', network_zone: zone }],
    }, opts));
    assert.equal(codeOf(refused), 'catalog_value_retired');
    assert.doesNotMatch(String(refused.getResponse().params.allowed), new RegExp(zone));
  });
}

runP7Specs('location-catalog-values.integration.spec.ts', [
  ['hosting type and provider of a site', testSiteValues],
  ['network zone of a subnet', testSubnetZone],
]).catch((error) => {
  console.error(error);
  process.exit(1);
});
