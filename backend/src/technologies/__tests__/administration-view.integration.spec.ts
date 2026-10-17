// @database-spec
import 'dotenv/config';
import type { QueryRunner } from 'typeorm';
import { PATH_METADATA } from '@nestjs/common/constants';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import { AdministrationViewController } from '../reports/administration-view.controller';
import { AdministrationViewService } from '../reports/administration-view.service';
import { TechnologyReachService } from '../technology-reach.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { application, asset, contains, installed, one, technology } from './technologies.fixtures';

// The administration view (lot A1a), against a real database in transactions rolled back at the end:
// - a zone lists its attributes, its technologies with the servers that carry them (direct and
//   through the graph), and its directory services; a retired technology and a retired server are
//   left out; a retired zone without technologies is hidden;
// - the technologies without a zone form the last group (`code: null`), counted as data to complete;
// - the domains carry forest, trusts (with the trusted domain's name), typed counts, and the domain
//   controllers deduced from the server role `domain-controller` on an assignment;
// - another tenant's technologies, servers and controllers never appear;
// - both routes require `infrastructure:reader`, the export path ends with /export, and the CSV
//   files carry the same rows.

type Settings = Record<string, unknown>;

function service(settingsByTenant: Map<string, Settings>) {
  const itOps = { getSettings: async (tenantId: string) => settingsByTenant.get(tenantId) ?? { adminZones: [], domains: [], technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES } };
  return new AdministrationViewService(itOps as any, new TechnologyReachService());
}

const ZONES = [
  { code: 'tier_0', label: 'Tier 0', admin_group: 'Domain admins', privilege_level: 'Tier 0', secrets_location: 'Vault A', description: 'Identity core' },
  { code: 'tier_1', label: 'Tier 1', admin_group: 'Server admins', privilege_level: 'Tier 1' },
  { code: 'old', label: 'Old zone', deprecated: true },
];
const DOMAINS = [
  { code: 'workgroup', label: 'Workgroup', dns_suffix: '', system: true },
  { code: 'corp', label: 'Corp', dns_suffix: 'corp.example.com', forest: 'corp.example.com', trusts: [{ domain: 'lab', direction: 'two_way' }], account_count: 1200, machine_count: 300 },
  { code: 'lab', label: 'Lab', dns_suffix: 'lab.example.com' },
];

async function controller(runner: QueryRunner, tenantId: string, name: string, domain: string, role: string, status = 'active') {
  const id = await asset(runner, tenantId, name);
  await runner.query(`UPDATE assets SET domain = $3, status = $4 WHERE tenant_id = $1 AND id = $2`, [tenantId, id, domain, status]);
  const app = await application(runner, tenantId, `App ${name}`);
  const instance = await one(runner, `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`, [tenantId, app]);
  await runner.query(`INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, $4)`, [tenantId, instance, id, role]);
  return id;
}

async function seed(runner: QueryRunner) {
  const a = await seedTenant(runner, 'adm-a');
  const ad = await technology(runner, a, 1, 'Active Directory', 'directory');
  const sql = await technology(runner, a, 2, 'SQL Server', 'database');
  const vsphere = await technology(runner, a, 3, 'vSphere', 'hypervisor');
  const gone = await technology(runner, a, 4, 'Old directory', 'directory');
  await runner.query(`UPDATE technologies SET admin_zone = 'tier_0' WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [a, [ad, sql, gone]]);
  await runner.query(`UPDATE technologies SET lifecycle = 'retired' WHERE tenant_id = $1 AND id = $2`, [a, gone]);
  const dc1 = await controller(runner, a, 'dc1', 'corp', 'domain-controller');
  const dcRetired = await controller(runner, a, 'dc-old', 'corp', 'domain-controller', 'retired');
  const app1 = await controller(runner, a, 'app1', 'corp', 'app');
  const host = await asset(runner, a, 'host1');
  const vm = await asset(runner, a, 'vm1');
  const retiredVm = await asset(runner, a, 'vm-retired');
  await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [a, retiredVm]);
  await contains(runner, a, host, vm);
  await contains(runner, a, host, retiredVm);
  await installed(runner, a, dc1, ad);
  await installed(runner, a, dcRetired, ad);
  await installed(runner, a, app1, sql);
  await installed(runner, a, host, vsphere);

  // Another tenant: same zone and domain codes, its own technology and controller.
  const b = await seedTenant(runner, 'adm-b');
  const other = await technology(runner, b, 1, 'Other AD', 'directory');
  await runner.query(`UPDATE technologies SET admin_zone = 'tier_0' WHERE tenant_id = $1 AND id = $2`, [b, other]);
  const otherDc = await controller(runner, b, 'other-dc', 'corp', 'domain-controller');
  await installed(runner, b, otherDc, other);
  await setTenant(runner, a);

  const settings = new Map<string, Settings>([
    [a, { adminZones: ZONES, domains: DOMAINS, technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES }],
    [b, { adminZones: ZONES, domains: DOMAINS, technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES }],
  ]);
  return { a, b, ad, sql, vsphere, dc1, app1, host, vm, otherDc, settings };
}

async function testView() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner);
    const view = await service(s.settings).view({ manager: runner.manager, tenantId: s.a });

    assert.deepEqual(view.zones.map((zone) => zone.code), ['tier_0', 'tier_1', null], 'catalog zones by name, the retired empty zone hidden, no zone last');
    const [tier0, tier1, none] = view.zones;
    assert.deepEqual(
      { group: tier0.admin_group, level: tier0.privilege_level, secrets: tier0.secrets_location, description: tier0.description },
      { group: 'Domain admins', level: 'Tier 0', secrets: 'Vault A', description: 'Identity core' },
    );
    assert.deepEqual(tier0.technologies.map((t) => [t.reference, t.name, t.servers.map((server) => server.name)]), [
      ['TEC-1', 'Active Directory', ['dc1']],
      ['TEC-2', 'SQL Server', ['app1']],
    ], 'retired technology and retired server left out');
    assert.deepEqual(tier0.directory_services.map((t) => t.name), ['Active Directory']);
    assert.equal(tier0.server_count, 2);
    assert.deepEqual(tier1.technologies, []);
    assert.equal(tier1.secrets_location, null);

    assert.equal(none.label, null);
    assert.deepEqual(none.technologies.map((t) => t.name), ['vSphere']);
    assert.deepEqual(none.technologies[0].servers.map((server) => [server.name, server.via_name]), [['host1', null], ['vm1', 'host1']], 'carried servers keep the carrier');
    assert.equal(view.unplaced_count, 1);

    assert.deepEqual(view.domains.map((domain) => domain.code), ['corp', 'lab'], 'system entries are not domains of the view');
    const [corp, lab] = view.domains;
    assert.deepEqual(
      { forest: corp.forest, trusts: corp.trusts, accounts: corp.account_count, machines: corp.machine_count, dcs: corp.domain_controllers.map((dc) => dc.name) },
      { forest: 'corp.example.com', trusts: [{ domain: 'lab', label: 'Lab', direction: 'two_way' }], accounts: 1200, machines: 300, dcs: ['dc1'] },
      'controllers deduced from the role, retired server and other tenant left out',
    );
    assert.deepEqual({ forest: lab.forest, accounts: lab.account_count, dcs: lab.domain_controllers }, { forest: null, accounts: null, dcs: [] });

    const ids = JSON.stringify(view);
    assert.ok(!ids.includes(s.otherDc) && !ids.includes('Other AD'), 'nothing of the other tenant');

    // The other tenant sees its own technology and controller only.
    await setTenant(runner, s.b);
    const other = await service(s.settings).view({ manager: runner.manager, tenantId: s.b });
    assert.deepEqual(other.zones.find((zone) => zone.code === 'tier_0')?.technologies.map((t) => t.name), ['Other AD']);
    assert.deepEqual(other.domains.find((domain) => domain.code === 'corp')?.domain_controllers.map((dc) => dc.name), ['other-dc']);
    assert.equal(other.unplaced_count, 0);
    assert.equal(other.zones.some((zone) => zone.code === null), false, 'no "no zone" group when every technology is placed');
  });
}

async function testUnknownZoneAndEmptyCatalog() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTenant(runner, 'adm-c');
    const tech = await technology(runner, a, 1, 'Stray', 'other');
    await runner.query(`UPDATE technologies SET admin_zone = 'gone' WHERE tenant_id = $1 AND id = $2`, [a, tech]);
    const view = await service(new Map()).view({ manager: runner.manager, tenantId: a });
    assert.deepEqual(view.zones.map((zone) => [zone.code, zone.label, zone.unknown]), [['gone', 'gone', true]]);
    assert.deepEqual(view.domains, []);
  });
}

async function testCsv() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner);
    const svc = service(s.settings);
    const opts = { manager: runner.manager, tenantId: s.a };
    const zones = await svc.csv({ list: 'zones', language: 'en' }, opts);
    assert.equal(zones.filename, 'administration_view_zones.csv');
    const zoneLines = zones.content.replace(/^﻿/, '').trim().split(/\r?\n/);
    assert.equal(zoneLines[0], 'Zone,Administrator group,Privilege level,Secrets location,Technology reference,Technology,Family,Directory service,Servers');
    assert.ok(zoneLines.includes('Tier 0,Domain admins,Tier 0,Vault A,TEC-1,Active Directory,Directory and identity,Yes,dc1'), zones.content);
    assert.ok(zoneLines.includes('Tier 1,Server admins,Tier 1,,,,,,'), 'a zone without technologies has its own row');
    assert.ok(zoneLines.includes('No zone (to complete),,,,TEC-3,vSphere,Hypervisor,No,"host1, vm1"'), zones.content);
    const domains = await svc.csv({ list: 'domains', language: 'en' }, opts);
    const domainLines = domains.content.replace(/^﻿/, '').trim().split(/\r?\n/);
    assert.equal(domainLines[1], 'Corp,corp.example.com,corp.example.com,Lab (two-way),1200,300,1,dc1');
    assert.equal(domainLines[2], 'Lab,lab.example.com,,,,,0,');
  });
}

async function testRoutes() {
  assert.equal(Reflect.getMetadata(PATH_METADATA, AdministrationViewController), 'technologies/reports/administration');
  const proto = AdministrationViewController.prototype as any;
  assert.equal(Reflect.getMetadata(PATH_METADATA, proto.export), 'export', 'recorded as an export by its path');
  for (const handler of [proto.view, proto.export]) {
    assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, handler), { resource: 'infrastructure', level: 'reader' });
  }
}

void runSpecs('Administration view', [
  ['zones, technologies, servers, domains and tenant isolation', testView],
  ['a zone code the catalog no longer has, an empty catalog', testUnknownZoneAndEmptyCatalog],
  ['CSV export of zones and domains', testCsv],
  ['routes: paths and permission', testRoutes],
]);
