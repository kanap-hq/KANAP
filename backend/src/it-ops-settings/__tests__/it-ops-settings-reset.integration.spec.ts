import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { Tenant } from '../../tenants/tenant.entity';
import { Location } from '../../locations/location.entity';
import { ItOpsSettings, ItOpsSettingsService } from '../it-ops-settings.service';
import { ItOpsSettingsController } from '../it-ops-settings.controller';
import { CLASSIFICATION_CATALOG_KEYS, resolveClassificationOption } from '../classification-catalog';
import { CATALOG_USAGE, countCatalogUsage, subnetUsageKey, usedCatalogCodes } from '../catalog-usage';

/**
 * Restoring the default lists: a shipped value comes back as shipped (name, own attributes,
 * offered, no translation typed by the workspace), deleted or not; a value the workspace added and
 * records use stays as stored, after the shipped values, in its former relative order; an added
 * value nothing uses goes. Subnets first (an asset address names them), then the network zones
 * those kept subnets carry. A deleted shipped value whose code or name a kept value answers to stays
 * deleted. The operation succeeds on data that predates the write rules, and what it stores reads
 * back as a state the settings page saves as it is. Every row belongs to the spec's own workspaces.
 */
function dirtyItOps(siteA: string, siteB: string) {
  return {
    application_categories: [
      { code: 'line_of_business', label: 'Line-of-business' },
      { code: 'erp', label: 'ERP', translations: { fr: { label: 'PGI' } } },
      { code: 'analytics', label: 'Analyse', deprecated: true, translations: { fr: { label: 'Analyse (FR)' } } },
      { code: 'unused_cat', label: 'Unused category' },
      { code: 'productivity', label: 'Productivity' },
      { code: 'security', label: 'Security' },
      { code: 'integration', label: 'Integration' },
      { code: 'infrastructure', label: 'Infrastructure' },
    ],
    // Case R-a: the shipped "Public Cloud" was renamed, then a value named "Public Cloud" was added and is used.
    hosting_types: [
      { code: 'on_prem', label: 'On-prem', category: 'on_prem' },
      { code: 'public_cloud', label: 'Cloud public', category: 'cloud' },
      { code: 'public_cloud_2', label: 'Public Cloud', category: 'cloud' },
      { code: 'edge', label: 'Edge site', category: 'on_prem' },
      // The shipped "Colocation" was deleted, then a value of that name was added and is used.
      { code: 'colo_dc', label: 'Colocation', category: 'on_prem' },
      { code: 'hybrid', label: 'Hybrid', category: 'cloud' },
      { code: 'private_cloud', label: 'Private Cloud', category: 'cloud' },
      { code: 'saas', label: 'SaaS', category: 'cloud' },
    ],
    server_kinds: [
      { code: 'kiosk_device', label: 'Kiosk device', is_physical: true },
      { code: 'rack', label: 'Baie', is_physical: false, deprecated: true, translations: { de: { label: 'Gestell' } } },
      { code: 'free_kind', label: 'Free kind', is_physical: false },
    ],
    server_roles: [
      { code: 'erp_role', label: 'ERP server', graph_tier: 'bottom' },
      { code: 'web', label: 'Frontal', graph_tier: 'center', deprecated: true },
      { code: 'free_role', label: 'Free role', graph_tier: 'center' },
    ],
    entities: [
      { code: 'internet', label: 'Web', graph_tier: 'bottom' },
      { code: 'supplier_net', label: 'Supplier network', graph_tier: 'upper' },
      { code: 'free_entity', label: 'Free entity', graph_tier: 'top' },
    ],
    connection_types: [
      { code: 'https', label: 'HTTPS secure', category: 'Web', typicalPorts: '8443' },
      { code: 'opcua', label: 'OPC UA', category: 'Industrial', typicalPorts: '4840' },
      { code: 'free_ct', label: 'Free type', category: 'Generic' },
    ],
    domains: [
      { code: 'corp', label: 'Corp', dns_suffix: 'corp.example', forest: 'corp.example', trusts: [{ domain: 'lab', direction: 'two_way' }, { domain: 'dmz-ad', direction: 'outgoing' }] },
      { code: 'lab', label: 'Lab', dns_suffix: 'lab.example' },
      { code: 'dmz-ad', label: 'DMZ AD', dns_suffix: 'dmz.example', account_count: 12 },
    ],
    network_segments: [
      { code: 'dmz', label: 'Zone démilitarisée', translations: { fr: { label: 'DMZ (FR)' } } },
      { code: 'lab_zone', label: 'Lab zone' },
      { code: 'free_zone', label: 'Free zone' },
    ],
    subnets: [
      { location_id: siteA, cidr: '10.1.0.0/24', network_zone: 'lab_zone', vlan_number: 10, description: 'Lab' },
      { location_id: siteA, cidr: '10.2.0.0/24', network_zone: 'free_zone' },
      { location_id: siteB, cidr: '10.1.0.0/24', network_zone: 'lan' },
      { location_id: randomUUID(), cidr: '10.4.0.0/24', network_zone: 'lan' },
    ],
    admin_zones: [
      { code: 'tier_0', label: 'Noyau', admin_group: 'GG-T0', description: 'Ours' },
      { code: 'kept_zone', label: 'Kept zone', admin_group: 'GG-K', deprecated: true },
      { code: 'tier_1', label: 'Tier 1 (servers and applications)', description: 'Business servers, applications, databases and middleware.' },
      { code: 'free_admin', label: 'Free admin zone' },
    ],
    business_criticality_levels: [
      { code: 'vital', label: 'Vital', description: 'Ours', rank: 6, maxMtdMinutes: 60 },
      { code: 'business_critical', label: 'Critical', description: 'The activity tolerates at most four hours of interruption.', rank: 5, maxMtdMinutes: 240 },
      { code: 'high', label: 'Élevé', description: 'Changed', rank: 4, maxMtdMinutes: 600, deprecated: true, translations: { fr: { label: 'Haut' } } },
      // The shipped "Moderate" (medium) was deleted, then a value of that name was added and is used.
      { code: 'moderate', label: 'Moderate', description: '', rank: 3, maxMtdMinutes: null },
      { code: 'minor', label: 'Minor', description: '', rank: 2, maxMtdMinutes: null },
    ],
    recovery_waves: [
      { code: 'foundation', label: 'V0 — Foundation', description: 'Shared prerequisites and foundation services.', order: 0 },
      { code: 'w_extra', label: 'Extra wave', description: '', order: 1 },
      { code: 'vital', label: 'Vitales', description: '', order: 2 },
      { code: 'priority', label: 'V2 — Priority activities', description: 'Restore priority activities.', order: 3 },
      { code: 'free_wave', label: 'Free wave', description: '', order: 4 },
    ],
    interface_protocols: [{ code: 'custom_proto', label: 'Custom protocol' }],
    lifecycle_states: [{ code: 'pilot', label: 'Pilot' }, { code: 'sunset', label: 'Sunset' }],
    // Two names that differ only by case, stored before the alias rule, both used.
    ip_address_types: [{ code: 'host', label: 'Host' }, { code: 'dup_a', label: 'Same' }, { code: 'dup_b', label: 'same' }],
    path_hop_functions: [{ code: 'nat2', label: 'NAT 2' }, { code: 'free_hop', label: 'Free hop' }],
    // A key the lists do not own stays as it is.
    unrelated_key: { keep: true },
  };
}

const codes = (rows: Array<{ code: string }>) => rows.map((row) => row.code);
const pick = (rows: any[], code: string) => rows.find((row) => row.code === code);

async function main() {
  await dataSource.initialize();
  const tenantId = randomUUID();
  const neighbourId = randomUUID();
  const cleanIds = [randomUUID(), randomUUID()];
  const countIds = [randomUUID(), randomUUID()];
  const requestId = randomUUID();
  const allIds = [tenantId, neighbourId, ...cleanIds, ...countIds, requestId];
  const siteA = randomUUID();
  const siteB = randomUUID();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  const audits: any[] = [];
  const settings = new ItOpsSettingsService(runner.manager.getRepository(Tenant), runner.manager.getRepository(Location), { log: async (entry: any) => { audits.push(entry); } } as any);
  const asTenant = (id: string) => runner.query(`SELECT set_config('app.current_tenant', $1, false)`, [id]);
  const stored = async (id: string) => (await runner.query(`SELECT metadata FROM tenants WHERE id = $1`, [id]))[0].metadata;
  const reset = (id: string) => settings.resetToDefaults(id, { manager: runner.manager, userId: null });
  /** Counts the statements `fn` sends through the runner. */
  const counted = async <T>(fn: () => Promise<T>): Promise<{ value: T; count: number }> => {
    const original = runner.query.bind(runner);
    let count = 0;
    runner.query = (async (...args: Parameters<typeof original>) => { count += 1; return original(...args); }) as typeof runner.query;
    try {
      return { value: await fn(), count };
    } finally {
      runner.query = original;
    }
  };
  try {
    for (const id of allIds) {
      await runner.query(`INSERT INTO tenants(id, slug, name, metadata) VALUES ($1, $2, 'Settings reset test', '{}'::jsonb)`, [id, `settings-reset-${id}`]);
    }
    await asTenant(tenantId);
    const dirtyItOpsStored = dirtyItOps(siteA, siteB);
    await runner.query(`UPDATE tenants SET metadata = jsonb_build_object('it_ops', $2::jsonb) WHERE id = $1`, [tenantId, JSON.stringify(dirtyItOpsStored)]);
    await runner.query(`INSERT INTO locations(id, tenant_id, name, hosting_type, location_reference) VALUES ($1, $3, 'Site A', 'edge', 'LOC-A'), ($2, $3, 'Site B', 'on_prem', 'LOC-B')`, [siteA, siteB, tenantId]);
    const [app] = await runner.query(`INSERT INTO applications(tenant_id, name, category, criticality, lifecycle) VALUES ($1, 'ERP', 'erp', 'vital', 'pilot') RETURNING id`, [tenantId]);
    await runner.query(`INSERT INTO applications(tenant_id, name, category, criticality, access_methods) VALUES ($1, 'Moderate app', 'erp', 'moderate', ARRAY['web','vdi'])`, [tenantId]);
    await runner.query(`INSERT INTO technologies(tenant_id, item_number, name, hosting_type, admin_zone, recovery_wave) VALUES ($1, 1, 'Tech', 'public_cloud_2', 'kept_zone', 'w_extra'), ($1, 2, 'Colocated tech', 'colo_dc', NULL, NULL)`, [tenantId]);
    const [asset] = await runner.query(`INSERT INTO assets(tenant_id, name, kind, environment, location_id, domain, ip_addresses) VALUES ($1, 'kiosk-1', 'kiosk_device', 'prod', $2, 'corp', '[{"type":"dup_a","ip":"10.1.0.5","subnet_cidr":"10.1.0.0/24"},{"type":"dup_b","ip":"10.1.0.6","subnet_cidr":null}]'::jsonb) RETURNING id`, [tenantId, siteA]);
    await runner.query(`INSERT INTO assets(tenant_id, name, kind, environment, location_id, domain) VALUES ($1, 'vm-1', 'virtual_machine', 'prod', $2, 'dmz-ad')`, [tenantId, siteB]);
    const [instance] = await runner.query(`INSERT INTO app_instances(tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`, [tenantId, app.id]);
    await runner.query(`INSERT INTO app_asset_assignments(tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'erp_role')`, [tenantId, instance.id, asset.id]);
    const [connection] = await runner.query(`INSERT INTO connections(tenant_id, name, topology, connection_reference, source_entity_code) VALUES ($1, 'Flow', 'point_to_point', 'CONN-1', 'supplier_net') RETURNING id`, [tenantId]);
    await runner.query(`INSERT INTO connection_protocols(tenant_id, connection_id, connection_type_code) VALUES ($1, $2, 'opcua')`, [tenantId, connection.id]);
    await runner.query(`INSERT INTO connection_legs(tenant_id, connection_id, order_index, function_code, protocol_codes) VALUES ($1, $2, 1, 'nat2', ARRAY['https'])`, [tenantId, connection.id]);
    // The sources the rows above leave empty: interface legs and bindings, incidents, instances, access methods.
    await runner.query(`UPDATE app_instances SET lifecycle = 'deprecated' WHERE tenant_id = $1 AND id = $2`, [tenantId, instance.id]);
    const [iface] = await runner.query(`INSERT INTO interfaces(tenant_id, name, business_purpose, source_application_id, target_application_id, data_category, integration_route_type, interface_reference) VALUES ($1, 'Feed', 'Feed', $2, $2, 'master_data', 'direct', 'INT-1') RETURNING id`, [tenantId, app.id]);
    const [leg] = await runner.query(`INSERT INTO interface_legs(tenant_id, interface_id, leg_type, from_role, to_role, trigger_type, integration_pattern, data_format, order_index) VALUES ($1, $2, 'direct', 'source', 'target', 'scheduled', 'file_transfer_batch', 'csv', 0) RETURNING id`, [tenantId, iface.id]);
    await runner.query(`INSERT INTO interface_bindings(tenant_id, interface_id, interface_leg_id, environment, source_instance_id, target_instance_id, status, authentication_mode) VALUES ($1, $2, $3, 'prod', $4, $4, 'retired', 'oauth2')`, [tenantId, iface.id, leg.id, instance.id]);
    await runner.query(`INSERT INTO incidents(tenant_id, item_number, title, severity, category) VALUES ($1, 1, 'Outage', 'minor', 'supplier')`, [tenantId]);
    // The neighbour uses the values the tenant does not: they still go from the tenant's lists.
    await asTenant(neighbourId);
    await runner.query(`UPDATE tenants SET metadata = jsonb_build_object('it_ops', jsonb_build_object('application_categories', '[{"code":"unused_cat","label":"Neighbour"}]'::jsonb)) WHERE id = $1`, [neighbourId]);
    await runner.query(`INSERT INTO applications(tenant_id, name, category) VALUES ($1, 'Neighbour app', 'unused_cat')`, [neighbourId]);
    await runner.query(`INSERT INTO technologies(tenant_id, item_number, name, admin_zone) VALUES ($1, 1, 'Neighbour tech', 'free_admin')`, [neighbourId]);
    const neighbourBefore = await stored(neighbourId);

    await asTenant(tenantId);
    // The grouped read holds a code exactly when the count of one value counts it.
    const before = await settings.getSettings(tenantId, { manager: runner.manager });
    for (const list of Object.keys(CATALOG_USAGE)) {
      const used = await usedCatalogCodes(runner.manager, tenantId, list, before.subnets);
      if (list === 'subnets') {
        const keys = [...before.subnets.map((subnet) => ({ location_id: subnet.location_id, cidr: subnet.cidr })), { location_id: siteB, cidr: '10.1.0.0/24' }];
        for (const key of keys) {
          const total: number = (await countCatalogUsage(runner.manager, tenantId, list, key)).reduce((sum, item) => sum + item.count, 0);
          assert.equal(used.has(subnetUsageKey(key)), total > 0, `${list}: ${subnetUsageKey(key)}`);
        }
        assert.deepEqual([...used], [subnetUsageKey({ location_id: siteA, cidr: '10.1.0.0/24' })]);
        continue;
      }
      const candidates = new Set([...used, ...(((before as any)[list] ?? []) as Array<{ code: string }>).map((row) => row.code), 'unused_cat', 'free_admin']);
      for (const code of candidates) {
        const total: number = (await countCatalogUsage(runner.manager, tenantId, list, { code }, before.subnets)).reduce((sum, item) => sum + item.count, 0);
        assert.equal(used.has(code), total > 0, `${list}: ${code}`);
      }
    }
    assert.equal((await usedCatalogCodes(runner.manager, tenantId, 'applicationCategories')).has('unused_cat'), false, 'the neighbour\'s records are not read');
    assert.deepEqual([...await usedCatalogCodes(runner.manager, tenantId, 'ipAddressTypes')].sort(), ['dup_a', 'dup_b']);
    // Each source the fixture fills gives its code: the equivalence above covers every shape of source.
    const usedBy = async (list: string) => [...await usedCatalogCodes(runner.manager, tenantId, list, before.subnets)].sort();
    assert.deepEqual(await usedBy('accessMethods'), ['vdi', 'web']);
    assert.deepEqual(await usedBy('connectionTypes'), ['https', 'opcua'], 'connection protocols and the protocols of a leg');
    assert.deepEqual(await usedBy('lifecycleStates'), ['active', 'deprecated', 'pilot', 'proposed', 'retired'], 'applications, instances, interfaces, bindings and the defaults of the other records');
    assert.deepEqual(await usedBy('interfaceDataCategories'), ['master_data']);
    assert.deepEqual(await usedBy('interfaceTriggerTypes'), ['scheduled']);
    assert.deepEqual(await usedBy('interfacePatterns'), ['file_transfer_batch']);
    assert.deepEqual(await usedBy('interfaceFormats'), ['csv']);
    assert.deepEqual(await usedBy('interfaceAuthModes'), ['oauth2']);
    assert.deepEqual(await usedBy('incidentCategories'), ['supplier']);

    // The restore runs on the request's manager only (its tenant set): without it, nothing runs.
    await assert.rejects(settings.resetToDefaults(tenantId), /request manager/);
    await assert.rejects(settings.resetToDefaults(tenantId, { userId: null }), /request manager/);
    assert.deepEqual(await stored(tenantId), { it_ops: dirtyItOpsStored }, 'a refused restore stores nothing');

    const { value: result, count: dirtyQueries } = await counted(() => reset(tenantId));
    const read = await settings.getSettings(tenantId, { manager: runner.manager });
    assert.deepEqual(read, result, 'the answer is what the settings read gives');
    const metadata = await stored(tenantId);
    assert.deepEqual(metadata.it_ops.unrelated_key, { keep: true }, 'a key the lists do not own stays');
    assert.equal(audits.length, 1, 'one audit entry');
    assert.equal(audits[0].table, 'tenants');
    assert.equal(audits[0].recordId, tenantId);
    assert.deepEqual(codes(audits[0].after.hostingTypes), codes(result.hostingTypes));
    assert.ok(codes(audits[0].before.hostingTypes).includes('hybrid'));

    // What the restore stores saves back as read: the settings page sends the four catalogs together,
    // then each other list, as GET gives them, and the state read afterwards is the same.
    const controller = new ItOpsSettingsController(settings);
    const request = { tenant: { id: tenantId }, queryRunner: { manager: runner.manager }, user: { sub: null } };
    const http = async <T>(work: Promise<T>): Promise<T> => JSON.parse(JSON.stringify(await work));
    const restoredState: ItOpsSettings = await http(controller.getSettings(request));
    const catalogs = Object.fromEntries(CLASSIFICATION_CATALOG_KEYS.map((key) => [key, (restoredState as any)[key]]));
    await http(controller.updateSettings(catalogs, request));
    assert.deepEqual(await http(controller.getSettings(request)), restoredState, 'the four catalogs save back as read');
    for (const key of Object.keys(ItOpsSettingsService.LIST_META)) {
      if ((CLASSIFICATION_CATALOG_KEYS as readonly string[]).includes(key)) continue;
      if (key === 'ipAddressTypes') {
        // Two names stored before the alias rule, kept as they are: the restore does not make them savable, and adds no clash.
        await assert.rejects(controller.updateSettings({ [key]: (restoredState as any)[key] }, request), /"same" clashes with "Same"/);
        continue;
      }
      await http(controller.updateSettings({ [key]: (restoredState as any)[key] }, request));
      assert.deepEqual(await http(controller.getSettings(request)), restoredState, `${key} saves back as read`);
    }

    // Simple list: shipped order, the renamed, translated and retired value back as shipped, the deleted one back, then the used addition.
    assert.deepEqual(codes(result.applicationCategories), ['line_of_business', 'productivity', 'security', 'analytics', 'development', 'integration', 'infrastructure', 'erp']);
    assert.deepEqual(pick(result.applicationCategories, 'analytics'), { code: 'analytics', label: 'Analytics', deprecated: false });
    assert.deepEqual(pick(result.applicationCategories, 'erp'), { code: 'erp', label: 'ERP', deprecated: false, translations: { fr: { label: 'PGI' } } });
    // Hosting: case R-a, the shipped value keeps its current name; the addition named like the shipped one stays.
    // The deleted "Colocation" stays deleted: a kept addition has its name.
    assert.deepEqual(codes(result.hostingTypes), ['on_prem', 'public_cloud', 'private_cloud', 'saas', 'public_cloud_2', 'edge', 'colo_dc']);
    assert.deepEqual(pick(result.hostingTypes, 'public_cloud'), { code: 'public_cloud', label: 'Cloud public', deprecated: false, category: 'cloud' });
    assert.deepEqual(pick(result.hostingTypes, 'public_cloud_2'), { code: 'public_cloud_2', label: 'Public Cloud', deprecated: false, category: 'cloud' });
    assert.equal(pick(result.hostingTypes, 'edge').label, 'Edge site');
    // Asset types: the shipped value gets its name and its physical flag back.
    assert.deepEqual(codes(result.serverKinds).slice(-2), ['rack', 'kiosk_device']);
    assert.deepEqual(pick(result.serverKinds, 'rack'), { code: 'rack', label: 'Rack', is_physical: true, deprecated: false });
    assert.deepEqual(pick(result.serverKinds, 'kiosk_device'), { code: 'kiosk_device', label: 'Kiosk device', deprecated: false, is_physical: true });
    assert.equal(result.serverKinds.length, 19);
    // Roles and entities: shipped tier back.
    assert.equal(result.serverRoles.length, 15);
    assert.deepEqual(pick(result.serverRoles, 'web'), { code: 'web', label: 'Web server', deprecated: false, graph_tier: 'top' });
    assert.deepEqual(result.serverRoles[14], { code: 'erp_role', label: 'ERP server', deprecated: false, graph_tier: 'bottom' });
    assert.deepEqual(codes(result.entities), ['internal_users', 'external_users', 'internet', 'customers', 'partner_networks', 'supplier_net']);
    assert.deepEqual(pick(result.entities, 'internet'), { code: 'internet', label: 'Internet', deprecated: false, graph_tier: 'top' });
    // Connection types: shipped ports and category back.
    assert.equal(result.connectionTypes.length, 66);
    assert.deepEqual(pick(result.connectionTypes, 'https'), { code: 'https', label: 'HTTPS', deprecated: false, category: 'Application', typicalPorts: '443' });
    assert.deepEqual(result.connectionTypes[65], { code: 'opcua', label: 'OPC UA', deprecated: false, category: 'Industrial', typicalPorts: '4840' });
    // Domains: system entries first; the used domains stay; the trust to the removed one goes.
    assert.deepEqual(codes(result.domains), ['workgroup', 'n-a', 'corp', 'dmz-ad']);
    assert.deepEqual(pick(result.domains, 'corp').trusts, [{ domain: 'dmz-ad', direction: 'outgoing' }]);
    assert.equal(pick(result.domains, 'dmz-ad').account_count, 12);
    // Subnets: only the one an asset address names; then the network zones it carries.
    assert.deepEqual(result.subnets, [{ location_id: siteA, cidr: '10.1.0.0/24', network_zone: 'lab_zone', vlan_number: 10, description: 'Lab', deprecated: false }]);
    assert.deepEqual(codes(result.networkSegments), ['lan', 'dmz', 'industrial_lan', 'wifi', 'public_cloud', 'guest', 'management', 'storage', 'vpn', 'lab_zone']);
    assert.deepEqual(pick(result.networkSegments, 'dmz'), { code: 'dmz', label: 'DMZ', deprecated: false });
    // Administration zones: shipped description back, no group; the used addition stays, retired as stored.
    assert.deepEqual(codes(result.adminZones), ['tier_0', 'tier_1', 'tier_2', 'kept_zone']);
    assert.deepEqual(pick(result.adminZones, 'tier_0'), { code: 'tier_0', label: 'Tier 0 (core of trust)', deprecated: false, description: 'Identity and trust infrastructure: directories such as Active Directory or Entra ID, PKI, identity administration tools, and the systems that host them.' });
    assert.deepEqual(pick(result.adminZones, 'kept_zone'), { code: 'kept_zone', label: 'Kept zone', deprecated: true, admin_group: 'GG-K' });
    // Levels and waves: the used addition takes the lowest rank and the last wave.
    // The deleted "Moderate" (medium) stays deleted: the kept addition has its name, and the name names one level.
    assert.deepEqual(result.businessCriticalityLevels.map((row) => [row.code, row.rank]), [['business_critical', 5], ['high', 4], ['low', 3], ['vital', 2], ['moderate', 1]]);
    assert.equal(resolveClassificationOption('Moderate', result.businessCriticalityLevels), 'moderate');
    assert.deepEqual(pick(result.businessCriticalityLevels, 'high'), { code: 'high', label: 'High', description: 'The activity tolerates more than four hours, up to one day of interruption.', rank: 4, maxMtdMinutes: 1440 });
    assert.deepEqual(pick(result.businessCriticalityLevels, 'vital'), { code: 'vital', label: 'Vital', description: 'Ours', rank: 2, maxMtdMinutes: 60 });
    assert.deepEqual(result.recoveryWaves.map((row) => [row.code, row.order]), [['foundation', 0], ['vital', 1], ['priority', 2], ['normal', 3], ['w_extra', 4]]);
    assert.equal(pick(result.recoveryWaves, 'vital').label, 'V1 — Vital activities');
    // No usage source for the interface protocols: every addition goes.
    assert.deepEqual(codes(result.interfaceProtocols), ['http', 'https', 'ftp', 'sftp', 'smb', 'smtp', 'jdbc', 'odbc', 'amqp', 'ssh', 'other']);
    // Locked statuses first, unchanged; the used addition after them.
    assert.deepEqual(codes(result.lifecycleStates), ['proposed', 'active', 'deprecated', 'retired', 'pilot']);
    // Two used values with the same name are copied as they are.
    assert.deepEqual(result.ipAddressTypes.map((row) => [row.code, row.label]), [['host', 'Host'], ['ipmi', 'IPMI'], ['management', 'Management'], ['iscsi', 'iSCSI'], ['dup_a', 'Same'], ['dup_b', 'same']]);
    assert.deepEqual(codes(result.pathHopFunctions).slice(-2), ['service_mesh', 'nat2']);
    // The other lists are the shipped ones.
    for (const key of ['interfaceDataCategories', 'interfaceTriggerTypes', 'interfacePatterns', 'interfaceFormats', 'interfaceAuthModes', 'accessMethods', 'incidentCategories', 'technologyFamilies', 'serverProviders', 'cyberCriticalityLevels', 'dataClasses']) {
      assert.ok(((result as any)[key] as any[]).length > 0, key);
    }
    // A second restore changes nothing.
    const again = await reset(tenantId);
    assert.deepEqual(again, result, 'a second restore gives the same lists');
    assert.deepEqual(await stored(tenantId), metadata, 'a second restore stores the same metadata');

    // The neighbour did not move.
    await asTenant(neighbourId);
    assert.deepEqual(await stored(neighbourId), neighbourBefore, 'the neighbour workspace is unchanged');

    // A workspace without additions gets the state the restore gave before: the defaults saved in full.
    await asTenant(cleanIds[0]);
    const cleanResult = await reset(cleanIds[0]);
    await asTenant(cleanIds[1]);
    const shipped = await settings.getSettings(cleanIds[1], { manager: runner.manager });
    const savedDefaults = await settings.updateSettings(cleanIds[1], shipped, { manager: runner.manager });
    assert.deepEqual(cleanResult, savedDefaults, 'a workspace without additions gets the defaults');
    assert.deepEqual((await stored(cleanIds[0])).it_ops, (await stored(cleanIds[1])).it_ops, 'and stores them as a full save of the defaults does');

    // The path of a request: a transaction that sets the tenant locally, on a connection of its own,
    // with the real audit service. The usage reads see the tenant's records; one entry in the audit log.
    await asTenant(requestId);
    await runner.query(`UPDATE tenants SET metadata = jsonb_build_object('it_ops', $2::jsonb) WHERE id = $1`, [requestId, JSON.stringify({ application_categories: [{ code: 'kept_cat', label: 'Kept category' }, { code: 'gone_cat', label: 'Gone category' }] })]);
    await runner.query(`INSERT INTO applications(tenant_id, name, category) VALUES ($1, 'Kept app', 'kept_cat')`, [requestId]);
    const viaRequest = await dataSource.transaction(async (manager) => {
      await manager.query(`SELECT set_config('app.current_tenant', $1, true)`, [requestId]);
      const service = new ItOpsSettingsService(manager.getRepository(Tenant), manager.getRepository(Location), new AuditService(manager.getRepository(AuditLog)));
      return service.resetToDefaults(requestId, { manager, userId: null });
    });
    assert.deepEqual(codes(viaRequest.applicationCategories).slice(-1), ['kept_cat'], 'the used addition is seen and kept');
    assert.equal(pick(viaRequest.applicationCategories, 'gone_cat'), undefined, 'the unused addition goes');
    const entries = await runner.query(`SELECT table_name, record_id, action FROM audit_log WHERE tenant_id = $1`, [requestId]);
    assert.deepEqual(entries, [{ table_name: 'tenants', record_id: requestId, action: 'update' }], 'one audit entry on the tenant');

    // The number of queries does not depend on the number of values.
    const queriesFor = async (id: string, added: number) => {
      await asTenant(id);
      const extra = Array.from({ length: added }, (_, index) => ({ code: `extra_${index}`, label: `Extra ${index}` }));
      const itOps = { application_categories: extra, admin_zones: extra, server_roles: extra, subnets: [] as unknown[] };
      await runner.query(`UPDATE tenants SET metadata = jsonb_build_object('it_ops', $2::jsonb) WHERE id = $1`, [id, JSON.stringify(itOps)]);
      await runner.query(`INSERT INTO applications(tenant_id, name, category) VALUES ($1, 'Uses one', 'extra_0')`, [id]);
      return (await counted(() => reset(id))).count;
    };
    const few = await queriesFor(countIds[0], 2);
    const many = await queriesFor(countIds[1], 40);
    assert.equal(many, few, `same number of queries for 2 and 40 added values (${few} and ${many})`);
    console.log(`PASS: restoring the default lists keeps the used additions, restores the shipped values, is idempotent and isolated (${few} queries; ${dirtyQueries} for the workspace with additions in every list)`);
  } finally {
    for (const id of allIds) {
      await asTenant(id).catch(() => undefined);
      for (const sql of ['DELETE FROM interface_bindings WHERE tenant_id = $1', 'DELETE FROM interface_legs WHERE tenant_id = $1', 'DELETE FROM interfaces WHERE tenant_id = $1', 'DELETE FROM incidents WHERE tenant_id = $1', 'DELETE FROM connection_legs WHERE tenant_id = $1', 'DELETE FROM connection_protocols WHERE tenant_id = $1', 'DELETE FROM connections WHERE tenant_id = $1', 'DELETE FROM app_asset_assignments WHERE tenant_id = $1', 'DELETE FROM app_instances WHERE tenant_id = $1', 'DELETE FROM assets WHERE tenant_id = $1', 'DELETE FROM applications WHERE tenant_id = $1', 'DELETE FROM technologies WHERE tenant_id = $1', 'DELETE FROM locations WHERE tenant_id = $1', 'DELETE FROM audit_log WHERE tenant_id = $1', 'DELETE FROM tenants WHERE id = $1']) {
        await runner.query(sql, [id]).catch(() => undefined);
      }
    }
    await runner.release().catch(() => undefined);
    await dataSource.destroy();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
