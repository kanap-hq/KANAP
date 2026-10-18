import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException, ConflictException } from '@nestjs/common';
import dataSource from '../../data-source';
import { Tenant } from '../../tenants/tenant.entity';
import { Location } from '../../locations/location.entity';
import { ItOpsSettingsService } from '../it-ops-settings.service';

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

/** Real SQL counts for every usage shape, the PATCH guard, the write lock in both orders, and generated codes. */
async function main() {
  if (!process.env.DATABASE_URL?.endsWith('/kanap_classification_v1_test')) throw new Error('Only isolated kanap_classification_v1_test is allowed');
  await dataSource.initialize();
  const tenantId = randomUUID();
  const setup = dataSource.createQueryRunner();
  const publisher = dataSource.createQueryRunner();
  const writer = dataSource.createQueryRunner();
  const cleanup = dataSource.createQueryRunner();
  for (const runner of [setup, publisher, writer, cleanup]) await runner.connect();
  const setTenant = (runner: any) => runner.query(`SELECT set_config('app.current_tenant', $1, false)`, [tenantId]);
  const service = (runner: any, audit: any = { log: async () => undefined }) => new ItOpsSettingsService(runner.manager.getRepository(Tenant), runner.manager.getRepository(Location), audit);
  const ids = { locationA: randomUUID(), locationB: randomUUID(), connection: randomUUID() };
  try {
    await setup.startTransaction();
    await setup.query(`INSERT INTO tenants(id, slug, name, metadata) VALUES ($1, $2, 'Settings usage test', '{}'::jsonb)`, [tenantId, `settings-usage-${tenantId}`]);
    await setTenant(setup);
    await setup.query(`INSERT INTO locations(id, tenant_id, name, hosting_type, location_reference) VALUES ($1, $2, 'Site A', 'on_prem', 'LOC-A'), ($3, $2, 'Site B', 'on_prem', 'LOC-B')`, [ids.locationA, tenantId, ids.locationB]);
    // A technology hosted in SaaS (lot H1): the hosting types count the technologies too.
    await setup.query(`INSERT INTO technologies(tenant_id, item_number, name, hosting_type) VALUES ($1, 1, 'Entra ID', 'saas')`, [tenantId]);
    await setup.query(`INSERT INTO applications(tenant_id, name, category, access_methods) VALUES ($1, 'Cat app', 'analytics', ARRAY['web','vdi']), ($1, 'Other app', 'security', ARRAY['web'])`, [tenantId]);
    // One asset with two IPs of the same type and the same subnet: counted once. A second asset on another site shares the CIDR.
    await setup.query(`INSERT INTO assets(tenant_id, name, kind, environment, location_id, ip_addresses) VALUES
      ($1, 'srv-a', 'vm', 'prod', $2, '[{"type":"ipmi","ip":"10.0.0.1","subnet_cidr":"10.0.0.0/24"},{"type":"ipmi","ip":"10.0.0.2","subnet_cidr":"10.0.0.0/24"}]'::jsonb),
      ($1, 'srv-b', 'vm', 'prod', $3, '[{"type":"host","ip":"10.0.0.3","subnet_cidr":"10.0.0.0/24"}]'::jsonb)`, [tenantId, ids.locationA, ids.locationB]);
    // One connection citing the same entity as source, destination and on a leg: counted once. Protocols on both tables too.
    await setup.query(`INSERT INTO connections(id, tenant_id, name, topology, connection_reference, source_entity_code, destination_entity_code) VALUES ($1, $2, 'Flow', 'point_to_point', 'CONN-1', 'internet', 'internet')`, [ids.connection, tenantId]);
    await setup.query(`INSERT INTO connection_legs(tenant_id, connection_id, order_index, equipment_entity_code, protocol_codes, function_code) VALUES ($1, $2, 1, 'internet', ARRAY['https'], 'firewall')`, [tenantId, ids.connection]);
    await setup.query(`INSERT INTO connection_protocols(tenant_id, connection_id, connection_type_code) VALUES ($1, $2, 'https')`, [tenantId, ids.connection]);
    await setup.commitTransaction();
    await Promise.all([setTenant(publisher), setTenant(writer)]);

    const settings = service(publisher);
    const usage = (list: string, key: any) => settings.getCatalogUsage(tenantId, list, key, { manager: publisher.manager });
    assert.deepEqual(await usage('applicationCategories', { code: 'analytics' }), { total: 1, usage: [{ record: 'applications', count: 1, listPath: '/it/applications?filters=%7B%22category%22%3A%7B%22filterType%22%3A%22set%22%2C%22values%22%3A%5B%22analytics%22%5D%7D%7D&appScope=all' }] });
    assert.equal((await usage('accessMethods', { code: 'web' })).total, 2);
    assert.equal((await usage('accessMethods', { code: 'vdi' })).total, 1);
    assert.deepEqual((await usage('ipAddressTypes', { code: 'ipmi' })).usage.map((item) => [item.record, item.count]), [['assets', 1]], 'two IPs of one asset count once');
    assert.equal((await usage('subnets', { location_id: ids.locationA, cidr: '10.0.0.0/24' })).total, 1, 'subnet identity is site + CIDR');
    assert.equal((await usage('subnets', { location_id: randomUUID(), cidr: '10.0.0.0/24' })).total, 0);
    assert.deepEqual((await usage('entities', { code: 'internet' })).usage.map((item) => [item.record, item.count]), [['connections', 1]], 'three references to one connection count once');
    assert.equal((await usage('connectionTypes', { code: 'https' })).total, 1, 'protocol rows and leg arrays count the same connection once');
    assert.equal((await usage('pathHopFunctions', { code: 'firewall' })).total, 1);
    assert.equal((await usage('hostingTypes', { code: 'on_prem' })).total, 2);
    assert.deepEqual((await usage('hostingTypes', { code: 'saas' })).usage.map((item) => [item.record, item.count]), [['technologies', 1]]);
    assert.equal((await usage('serverKinds', { code: 'vm' })).usage[0].listPath, '/it/assets?filters=%7B%22kind%22%3A%7B%22filterType%22%3A%22set%22%2C%22values%22%3A%5B%22vm%22%5D%7D%7D');
    assert.equal((await usage('interfaceProtocols', { code: 'anything' })).total, 0);
    await assert.rejects(() => usage('nope', { code: 'x' }), BadRequestException);

    // Removing a used value is refused with the same counts the endpoint returns; retiring it is fine.
    const current = await settings.getSettings(tenantId, { manager: publisher.manager });
    const withoutAnalytics = current.applicationCategories.filter((item) => item.code !== 'analytics');
    await assert.rejects(() => settings.updateSettings(tenantId, { applicationCategories: withoutAnalytics }, { manager: publisher.manager }), (error: any) => {
      // A 409 the interface translates: `errors:CATALOG_VALUE_IN_USE` with the value and the counts per kind.
      assert.ok(error instanceof ConflictException);
      const body: any = error.getResponse();
      assert.equal(body.statusCode, 409);
      assert.equal(body.code, 'CATALOG_VALUE_IN_USE');
      assert.deepEqual(body.params, { value: 'Analytics' });
      assert.deepEqual(body.usages, [{ type: 'applications', total: 1 }]);
      assert.match(body.message, /"Analytics" is still used by 1 application\. Mark it as no longer offered/);
      assert.deepEqual([body.list, body.value_code, body.usage[0].count], ['applicationCategories', 'analytics', 1]);
      return true;
    });
    const retired = current.applicationCategories.map((item) => item.code === 'analytics' ? { ...item, deprecated: true } : item);
    assert.equal((await settings.updateSettings(tenantId, { applicationCategories: retired }, { manager: publisher.manager })).applicationCategories.find((item) => item.code === 'analytics')?.deprecated, true);
    const unusedRemoved = current.applicationCategories.filter((item) => item.code !== 'development');
    assert.equal((await settings.updateSettings(tenantId, { applicationCategories: unusedRemoved }, { manager: publisher.manager })).applicationCategories.some((item) => item.code === 'development'), false);
    // A network zone referenced by a settings subnet cannot be removed either (default zones are re-added by the server anyway).
    const withZone = await settings.updateSettings(tenantId, { networkSegments: [...current.networkSegments, { label: 'Lab zone' }] as any }, { manager: publisher.manager });
    assert.ok(withZone.networkSegments.some((item) => item.code === 'lab_zone'));
    const zoned = await settings.updateSettings(tenantId, { subnets: [{ location_id: ids.locationA, cidr: '10.0.0.0/24', network_zone: 'lab_zone' }] as any }, { manager: publisher.manager });
    assert.equal(zoned.subnets.length, 1);
    await assert.rejects(() => settings.updateSettings(tenantId, { networkSegments: zoned.networkSegments.filter((item) => item.code !== 'lab_zone') }, { manager: publisher.manager }), (error: any) => {
      assert.equal(error.getResponse().code, 'CATALOG_VALUE_IN_USE');
      assert.deepEqual(error.getResponse().usages, [{ type: 'subnets', total: 1 }]);
      assert.match(error.message, /"Lab zone" is still used by 1 subnet\./);
      return true;
    });

    // Generated codes: names only in, stable slugs out, order preserved, aliases unique across code and name.
    const generated = await settings.updateSettings(tenantId, { serverProviders: [{ label: 'Scaleway Élite' }, { code: 'aws', label: 'AWS' }, { label: 'AWS Gov' }] as any }, { manager: publisher.manager });
    assert.deepEqual(generated.serverProviders.map((item) => [item.code, item.label]), [['scaleway_elite', 'Scaleway Élite'], ['aws', 'AWS'], ['aws_gov', 'AWS Gov']]);
    await assert.rejects(() => settings.updateSettings(tenantId, { serverProviders: [{ code: 'aws', label: 'Amazon' }, { label: 'aws' }] as any }, { manager: publisher.manager }), /clashes with/);
    await assert.rejects(() => settings.updateSettings(tenantId, { accessMethods: [{ label: 'Web, mobile' }] as any }, { manager: publisher.manager }), /comma/);
    // Reads stay tolerant: a stored duplicate name is served, and only refused when that list is saved again.
    await publisher.query(`UPDATE tenants SET metadata = jsonb_set(metadata, '{it_ops,ip_address_types}', '[{"code":"a","label":"Same"},{"code":"b","label":"same"}]'::jsonb) WHERE id = $1`, [tenantId]);
    const tolerant = await settings.getSettings(tenantId, { manager: publisher.manager });
    assert.equal(tolerant.ipAddressTypes.length, 2);
    await assert.rejects(() => settings.updateSettings(tenantId, { ipAddressTypes: tolerant.ipAddressTypes }, { manager: publisher.manager }), /clashes with/);
    assert.equal((await settings.updateSettings(tenantId, { ipAddressTypes: [{ code: 'a', label: 'Same' }, { code: 'b', label: 'Other' }] as any }, { manager: publisher.manager })).ipAddressTypes[1].label, 'Other');

    // Translations: saving only a translation persists it, survives a reload and becomes an import alias.
    const providers = (await settings.getSettings(tenantId, { manager: publisher.manager })).serverProviders;
    const translatedProviders = providers.map((item) => item.code === 'aws' ? { ...item, translations: { fr: { label: 'Amazon Web Services (FR)' }, de: { description: 'Nur Beschreibung' } } } : item);
    const savedTranslations = await settings.updateSettings(tenantId, { serverProviders: translatedProviders }, { manager: publisher.manager });
    assert.deepEqual(savedTranslations.serverProviders.find((item) => item.code === 'aws')?.translations, { fr: { label: 'Amazon Web Services (FR)' }, de: { description: 'Nur Beschreibung' } });
    const reloaded = await service(writer).getSettings(tenantId, { manager: writer.manager });
    assert.equal(reloaded.serverProviders.find((item) => item.code === 'aws')?.translations?.fr?.label, 'Amazon Web Services (FR)');
    assert.equal(reloaded.serverProviders.find((item) => item.code === 'aws')?.label, 'AWS', 'the base name is untouched');
    await assert.rejects(() => settings.updateSettings(tenantId, { serverProviders: [...reloaded.serverProviders, { label: 'Amazon Web Services (FR)' }] as any }, { manager: publisher.manager }), /clashes with/);

    // Order 1: a writer holding the shared lock delays the removal, which then sees the new reference and refuses.
    await writer.startTransaction();
    const writerSettings = await service(writer).getSettingsForWrite(tenantId, writer.manager);
    assert.ok(writerSettings.applicationCategories.some((item) => item.code === 'productivity'));
    let removalFinished = false;
    const removal = settings.updateSettings(tenantId, { applicationCategories: writerSettings.applicationCategories.filter((item) => item.code !== 'productivity') }, { manager: publisher.manager }).then(() => 'removed', (error) => error).finally(() => { removalFinished = true; });
    await delay(150);
    assert.equal(removalFinished, false, 'the settings PATCH must wait for the writer that validated against the catalog');
    await writer.query(`INSERT INTO applications(tenant_id, name, category) VALUES ($1, 'Late app', 'productivity')`, [tenantId]);
    await writer.commitTransaction();
    const outcome = await removal;
    assert.ok(outcome instanceof ConflictException, 'after the writer commits, the removal counts the new reference');

    // Order 2: a removal in progress blocks the writer's read; the writer then sees the catalog without the value.
    const gate = deferred(); const reached = deferred();
    const gatedSettings = service(publisher, { log: async (entry: any) => { if (entry.table === 'tenants') { reached.resolve(); await gate.promise; } } });
    const removal2 = gatedSettings.updateSettings(tenantId, { applicationCategories: writerSettings.applicationCategories.filter((item) => item.code !== 'infrastructure') }, { manager: publisher.manager });
    await reached.promise;
    await writer.startTransaction();
    let readFinished = false;
    const read = service(writer).getSettingsForWrite(tenantId, writer.manager).finally(() => { readFinished = true; });
    await delay(150);
    assert.equal(readFinished, false, 'the writer waits for the removal to commit');
    gate.resolve();
    await removal2;
    assert.equal((await read).applicationCategories.some((item) => item.code === 'infrastructure'), false, 'the writer validates against the published catalog');
    await writer.rollbackTransaction();
    console.log('PASS: isolated PostgreSQL catalog usage counts, removal guard, generated codes, tolerant reads and write-lock ordering');
  } finally {
    for (const runner of [setup, writer]) if (runner.isTransactionActive) await runner.rollbackTransaction().catch(() => undefined);
    await setTenant(cleanup).catch(() => undefined);
    for (const sql of ['DELETE FROM connection_protocols WHERE tenant_id = $1', 'DELETE FROM connection_legs WHERE tenant_id = $1', 'DELETE FROM connections WHERE tenant_id = $1', 'DELETE FROM assets WHERE tenant_id = $1', 'DELETE FROM applications WHERE tenant_id = $1', 'DELETE FROM technologies WHERE tenant_id = $1', 'DELETE FROM locations WHERE tenant_id = $1', 'DELETE FROM audit_log WHERE tenant_id = $1', 'DELETE FROM tenants WHERE id = $1']) {
      await cleanup.query(sql, [tenantId]).catch(() => undefined);
    }
    for (const runner of [setup, publisher, writer, cleanup]) await runner.release().catch(() => undefined);
    await dataSource.destroy();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
