// @database-spec
import 'dotenv/config';
import type { QueryRunner } from 'typeorm';
import { PATH_METADATA } from '@nestjs/common/constants';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import { AdministrationViewController } from '../reports/administration-view.controller';
import { AdministrationViewService } from '../reports/administration-view.service';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { application, asset, assign, contains, installed, member, one, technology } from './technologies.fixtures';

// The administration view (lot A1d), against a real database in transactions rolled back at the end:
// - a zone lists its attributes, its assets (not retired) and the directory services placed in it;
//   a deprecated zone without either is hidden; a code the catalog no longer has is shown when an
//   asset or a directory service still carries it; a technology of another family does not open a zone;
// - the domains carry forest, trusts (with the trusted domain's name), typed counts, and the domain
//   controllers deduced from the server role `domain-controller` on an instance in service, or
//   from an installed directory technology, each server once;
// - the control points: assets without a zone; domain controllers (the role only) and assets that
//   carry a directory technology outside the most sensitive zone; a contained asset whose zone is
//   more sensitive than its container, or a cluster member whose zone is less sensitive than its
//   cluster; a deprecated or unknown zone does not rank; applications hosted in that zone;
//   each point has one case that must stay out;
// - another tenant's assets, technologies and controllers never appear;
// - both routes require `infrastructure:reader`, the export path ends with /export, and the CSV
//   files carry the same rows.

type Settings = Record<string, unknown>;

function service(settingsByTenant: Map<string, Settings>) {
  const itOps = { getSettings: async (tenantId: string) => settingsByTenant.get(tenantId) ?? { adminZones: [], domains: [], technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES } };
  return new AdministrationViewService(itOps as any);
}

const ZONES = [
  { code: 'tier_0', label: 'Tier 0', admin_group: 'Domain admins', description: 'Identity core' },
  { code: 'tier_1', label: 'Tier 1', admin_group: 'Server admins' },
  { code: 'old', label: 'Old zone', deprecated: true },
];
const DOMAINS = [
  { code: 'workgroup', label: 'Workgroup', dns_suffix: '', system: true },
  { code: 'corp', label: 'Corp', dns_suffix: 'corp.example.com', forest: 'corp.example.com', trusts: [{ domain: 'lab', direction: 'two_way' }], account_count: 1200, machine_count: 300 },
  { code: 'lab', label: 'Lab', dns_suffix: 'lab.example.com' },
  { code: 'partner', label: 'Partner', dns_suffix: 'partner.example.com', trusts: [{ domain: 'lab', direction: 'outgoing' }] },
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
  // The role on a disabled application and instance does not count; nor does an installed
  // technology of another family.
  const dcDisabled = await controller(runner, a, 'dc-disabled', 'corp', 'domain-controller');
  await runner.query(`UPDATE app_instances SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE tenant_id = $1 AND id IN (SELECT app_instance_id FROM app_asset_assignments WHERE tenant_id = $1 AND asset_id = $2)`, [a, dcDisabled]);
  await runner.query(`UPDATE applications SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE tenant_id = $1 AND name = 'App dc-disabled'`, [a]);
  await installed(runner, a, dcDisabled, sql);
  // A server carrying Active Directory without any role is a controller of its domain; dc1 has both, counted once.
  const dcByTechnology = await asset(runner, a, 'dc2');
  await runner.query(`UPDATE assets SET domain = 'corp' WHERE tenant_id = $1 AND id = $2`, [a, dcByTechnology]);
  await installed(runner, a, dcByTechnology, ad);
  // A retired directory technology does not make a controller.
  const labDc = await asset(runner, a, 'lab-old');
  await runner.query(`UPDATE assets SET domain = 'lab' WHERE tenant_id = $1 AND id = $2`, [a, labDc]);
  await installed(runner, a, labDc, gone);
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
  const fw1 = await asset(runner, a, 'fw1');
  await runner.query(`UPDATE assets SET admin_zone = 'tier_0' WHERE tenant_id = $1 AND id = $2`, [a, fw1]);
  const fwRetired = await asset(runner, a, 'fw-old');
  await runner.query(`UPDATE assets SET admin_zone = 'tier_0', status = 'retired' WHERE tenant_id = $1 AND id = $2`, [a, fwRetired]);

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

    assert.deepEqual(view.zones.map((zone) => zone.code), ['tier_0', 'tier_1'], 'catalog order, the retired empty zone hidden');
    const [tier0, tier1] = view.zones;
    assert.deepEqual(
      { group: tier0.admin_group, description: tier0.description, unknown: tier0.unknown },
      { group: 'Domain admins', description: 'Identity core', unknown: false },
    );
    assert.deepEqual(tier0.directory_services.map((item) => [item.reference, item.name]), [['TEC-1', 'Active Directory']], 'a database technology in the zone is not a directory service, a retired one is left out');
    assert.deepEqual(tier0.assets.map((item) => [item.reference, item.name, item.kind]), [['AST-10', 'fw1', 'vm']], 'direct assets of the zone, retired left out');
    assert.deepEqual(tier0.asset_counts, [{ kind: 'vm', count: 1 }]);
    assert.equal(tier0.hosted_application_count, 0);
    assert.deepEqual(tier1.assets, []);
    assert.deepEqual(tier1.directory_services, []);
    assert.equal(tier1.admin_group, 'Server admins');
    assert.equal(tier1.hosted_application_count, 0);
    assert.equal(view.zones.some((zone) => zone.code === 'old'), false);

    assert.equal(view.controls.most_sensitive_zone, 'tier_0');
    assert.deepEqual(view.controls.assets_without_zone.map((item) => item.name), ['app1', 'dc-disabled', 'dc1', 'dc2', 'host1', 'lab-old', 'vm1']);
    assert.deepEqual(view.controls.domain_controllers_outside?.map((item) => item.name), ['dc1'], 'the role only: dc2 has no role, the disabled and retired controllers stay out');
    assert.deepEqual(view.controls.directory_assets_outside?.map((item) => item.name), ['dc1', 'dc2'], 'a direct directory link; the retired technology on lab-old does not count');
    assert.deepEqual(view.controls.trust_raised, [], 'neither side of host1/vm1 has a zone');
    assert.deepEqual(view.controls.applications_on_most_sensitive, []);

    assert.deepEqual(view.domains.map((domain) => domain.code), ['corp', 'lab', 'partner'], 'system entries are not domains of the view');
    const [corp, lab] = view.domains;
    assert.deepEqual(
      { forest: corp.forest, trusts: corp.trusts, declared: corp.declared_by, accounts: corp.account_count, machines: corp.machine_count, dcs: corp.domain_controllers.map((dc) => dc.name) },
      { forest: 'corp.example.com', trusts: [{ domain: 'lab', label: 'Lab', direction: 'two_way' }], declared: [], accounts: 1200, machines: 300, dcs: ['dc1', 'dc2'] },
      'role on an instance in service or directory technology, each server once; disabled instance, retired server and other tenant left out',
    );
    assert.deepEqual({ forest: lab.forest, accounts: lab.account_count, dcs: lab.domain_controllers }, { forest: null, accounts: null, dcs: [] });
    assert.deepEqual(lab.declared_by, [
      { domain: 'corp', label: 'Corp', direction: 'two_way' },
      { domain: 'partner', label: 'Partner', direction: 'incoming' },
    ], 'trusts declared on Corp and Partner show on Lab, read only, seen from Lab (Partner trusts Lab: incoming)');

    const ids = JSON.stringify(view);
    assert.ok(!ids.includes(s.otherDc) && !ids.includes('Other AD'), 'nothing of the other tenant');

    // The other tenant sees its own directory service and controller only.
    await setTenant(runner, s.b);
    const other = await service(s.settings).view({ manager: runner.manager, tenantId: s.b });
    assert.deepEqual(other.zones.find((zone) => zone.code === 'tier_0')?.directory_services.map((item) => item.name), ['Other AD']);
    assert.deepEqual(other.domains.find((domain) => domain.code === 'corp')?.domain_controllers.map((dc) => dc.name), ['other-dc']);
    assert.deepEqual(other.controls.assets_without_zone.map((item) => item.name), ['other-dc']);
    assert.deepEqual(other.controls.domain_controllers_outside?.map((item) => item.name), ['other-dc']);
    assert.equal(other.zones.some((zone) => zone.unknown), false);
  });
}

async function testUnknownZoneAndEmptyCatalog() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTenant(runner, 'adm-c');
    const stray = await technology(runner, a, 1, 'Stray', 'directory');
    await runner.query(`UPDATE technologies SET admin_zone = 'gone' WHERE tenant_id = $1 AND id = $2`, [a, stray]);
    const database = await technology(runner, a, 2, 'Leftover DB', 'database');
    await runner.query(`UPDATE technologies SET admin_zone = 'leftover' WHERE tenant_id = $1 AND id = $2`, [a, database]);
    const ghost = await asset(runner, a, 'ghost-srv');
    await runner.query(`UPDATE assets SET admin_zone = 'ghost' WHERE tenant_id = $1 AND id = $2`, [a, ghost]);
    await asset(runner, a, 'plain-srv');
    const view = await service(new Map()).view({ manager: runner.manager, tenantId: a });
    assert.deepEqual(view.zones.map((zone) => [zone.code, zone.label, zone.unknown]), [['ghost', 'ghost', true], ['gone', 'gone', true]]);
    assert.equal(view.zones.some((zone) => zone.code === 'leftover'), false, 'a technology of another family does not open a zone');
    assert.deepEqual(view.zones[0].assets.map((item) => item.name), ['ghost-srv']);
    assert.deepEqual(view.zones[1].directory_services.map((item) => item.name), ['Stray']);
    assert.deepEqual(view.domains, []);
    assert.equal(view.controls.most_sensitive_zone, null);
    assert.deepEqual(view.controls.assets_without_zone.map((item) => item.name), ['plain-srv']);
    assert.equal(view.controls.domain_controllers_outside, null);
    assert.equal(view.controls.directory_assets_outside, null);
    assert.equal(view.controls.trust_raised, null);
    assert.equal(view.controls.applications_on_most_sensitive, null);
  });
}

/** One finding of each control, and one case that must stay out of each. */
async function testControls() {
  await inRolledBackTransaction(async (runner) => {
    const a = await seedTenant(runner, 'adm-d');
    const place = async (name: string, zone: string | null) => {
      const id = await asset(runner, a, name);
      if (zone !== null) await runner.query(`UPDATE assets SET admin_zone = $3 WHERE tenant_id = $1 AND id = $2`, [a, id, zone]);
      return id;
    };
    const hostApp = async (name: string, assetId: string, role = 'app', disabled = false) => {
      const app = await application(runner, a, name);
      const instance = await one(runner, `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`, [a, app]);
      await runner.query(`INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, $4)`, [a, instance, assetId, role]);
      if (disabled) {
        await runner.query(`UPDATE app_instances SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE tenant_id = $1 AND id = $2`, [a, instance]);
        await runner.query(`UPDATE applications SET status = 'disabled', disabled_at = now() - interval '1 day' WHERE tenant_id = $1 AND id = $2`, [a, app]);
      }
      return app;
    };

    const dcHome = await place('dc-home', 'tier_0');
    await hostApp('App dc-home', dcHome, 'domain-controller');
    const dcAway = await place('dc-away', 'tier_1');
    await hostApp('App dc-away', dcAway, 'domain-controller');
    const dcBlank = await place('dc-blank', null);
    await hostApp('App dc-blank', dcBlank, 'domain-controller');
    const dcRetired = await place('dc-retired', 'tier_1');
    await hostApp('App dc-retired', dcRetired, 'domain-controller');
    await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [a, dcRetired]);
    const dcOff = await place('dc-off', 'tier_1');
    await hostApp('App dc-off', dcOff, 'domain-controller', true);

    const ad = await technology(runner, a, 1, 'Active Directory', 'directory');
    await runner.query(`UPDATE technologies SET admin_zone = 'tier_0' WHERE tenant_id = $1 AND id = $2`, [a, ad]);
    const dirHome = await place('dir-home', 'tier_0');
    const dirAway = await place('dir-away', 'tier_1');
    const dirBlank = await place('dir-blank', null);
    await installed(runner, a, dirHome, ad);
    await installed(runner, a, dirAway, ad);
    await installed(runner, a, dirBlank, ad);
    const retiredDir = await technology(runner, a, 2, 'Retired directory', 'directory');
    await runner.query(`UPDATE technologies SET lifecycle = 'retired', admin_zone = 'tier_0' WHERE tenant_id = $1 AND id = $2`, [a, retiredDir]);
    const oldDir = await place('old-dir', 'tier_1');
    await installed(runner, a, oldDir, retiredDir);
    const database = await technology(runner, a, 3, 'SQL Server', 'database');
    await runner.query(`UPDATE technologies SET admin_zone = 'leftover' WHERE tenant_id = $1 AND id = $2`, [a, database]);
    const plain = await place('plain', 'tier_1');
    await installed(runner, a, plain, database);
    await hostApp('Side', plain);
    const bare = await place('bare', null);
    const gap = await place('gap', '   ');

    const guest = await place('guest', 'tier_0');
    const host = await place('host', 'tier_1');
    await contains(runner, a, host, guest);
    const node = await place('node', 'tier_0');
    const rack = await place('rack', 'tier_1');
    await member(runner, a, rack, node);
    // A Tier 1 host that is a member of a Tier 0 cluster carries that cluster in a less sensitive zone.
    const vsphere = await place('vsphere', 'tier_0');
    const esx1 = await place('esx1', 'tier_1');
    await member(runner, a, vsphere, esx1);
    const core = await place('core', 'tier_0');
    const esx0 = await place('esx0', 'tier_0');
    await member(runner, a, core, esx0);
    // A deprecated zone at the head of the catalog does not rank, in either direction.
    const t0Holder = await place('t0-holder', 'tier_0');
    const legacyVm = await place('legacy-vm', 'retired_first');
    await contains(runner, a, t0Holder, legacyVm);
    const domCluster = await place('dom-cluster', 'tier_0');
    const legacyHost = await place('legacy-host', 'retired_first');
    await member(runner, a, domCluster, legacyHost);
    const twin = await place('twin', 'tier_0');
    const peer = await place('peer', 'tier_0');
    await contains(runner, a, peer, twin);
    const child = await place('child', 'tier_1');
    const parent = await place('parent', 'tier_0');
    await contains(runner, a, parent, child);
    const loose = await place('loose', null);
    const shelf = await place('shelf', 'tier_1');
    await contains(runner, a, shelf, loose);
    const guest2 = await place('guest2', 'tier_0');
    const alien = await place('alien', 'ghost');
    await contains(runner, a, alien, guest2);
    const parked = await place('parked', 'ghost');
    const keeper = await place('keeper', 'tier_1');
    await contains(runner, a, keeper, parked);
    const spare = await place('spare', 'tier_0');
    await hostApp('Quiet', spare, 'app', true);
    const portal = await application(runner, a, 'Portal');
    await assign(runner, a, portal, guest);
    await assign(runner, a, portal, node);
    const goneVm = await place('gone-vm', 'tier_0');
    await hostApp('Buried', goneVm);
    await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [a, goneVm]);
    const oldBox = await place('old-box', 'old');
    const ghostBox = await place('ghost-box', 'ghost');
    const goneDir = await technology(runner, a, 4, 'Gone directory', 'directory');
    await runner.query(`UPDATE technologies SET admin_zone = 'gone' WHERE tenant_id = $1 AND id = $2`, [a, goneDir]);

    const b = await seedTenant(runner, 'adm-e');
    const foreign = await asset(runner, b, 'foreign-dc');
    await runner.query(`UPDATE assets SET admin_zone = 'tier_0' WHERE tenant_id = $1 AND id = $2`, [b, foreign]);
    await setTenant(runner, a);

    const catalog = [
      { code: 'retired_first', label: 'Retired first', deprecated: true },
      { code: 'tier_0', label: 'Tier 0', admin_group: 'Domain admins' },
      { code: 'tier_1', label: 'Tier 1', admin_group: 'Server admins' },
      { code: 'old', label: 'Old zone', deprecated: true },
    ];
    const settings = new Map<string, Settings>([
      [a, { adminZones: catalog, domains: [], technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES }],
      [b, { adminZones: catalog, domains: [], technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES }],
    ]);
    const view = await service(settings).view({ manager: runner.manager, tenantId: a });

    assert.equal(view.controls.most_sensitive_zone, 'tier_0', 'the first zone is deprecated, so the next one is the most sensitive');
    assert.deepEqual(view.zones.map((zone) => zone.code), ['retired_first', 'tier_0', 'tier_1', 'old', 'ghost', 'gone']);
    assert.equal(view.zones.some((zone) => zone.code === 'leftover'), false, 'a technology of another family does not open a zone');
    assert.deepEqual(view.zones.find((zone) => zone.code === 'retired_first')?.assets.map((item) => item.name), ['legacy-host', 'legacy-vm']);
    assert.deepEqual(view.zones.find((zone) => zone.code === 'tier_0')?.assets.map((item) => item.name), ['core', 'dc-home', 'dir-home', 'dom-cluster', 'esx0', 'guest', 'guest2', 'node', 'parent', 'peer', 'spare', 't0-holder', 'twin', 'vsphere']);
    assert.deepEqual(view.zones.find((zone) => zone.code === 'tier_0')?.directory_services.map((item) => item.name), ['Active Directory']);
    assert.equal(view.zones.find((zone) => zone.code === 'tier_0')?.hosted_application_count, 2);
    assert.equal(view.zones.find((zone) => zone.code === 'tier_1')?.hosted_application_count, 2);
    assert.deepEqual(view.zones.find((zone) => zone.code === 'old')?.assets.map((item) => item.name), ['old-box']);
    assert.deepEqual(view.zones.find((zone) => zone.code === 'ghost')?.assets.map((item) => item.name), ['alien', 'ghost-box', 'parked']);
    assert.deepEqual(view.zones.find((zone) => zone.code === 'gone')?.directory_services.map((item) => item.name), ['Gone directory']);

    assert.deepEqual(view.controls.assets_without_zone.map((item) => item.name), ['bare', 'dc-blank', 'dir-blank', 'gap', 'loose']);
    assert.deepEqual(view.controls.domain_controllers_outside?.map((item) => item.name), ['dc-away', 'dc-blank']);
    assert.deepEqual(view.controls.directory_assets_outside?.map((item) => item.name), ['dir-away', 'dir-blank']);
    assert.deepEqual(view.controls.trust_raised?.map((item) => [item.holder.name, item.holder_kind, item.asset.name, item.asset_zone, item.holder_zone]), [
      ['host', 'contains', 'guest', 'tier_0', 'tier_1'],
      ['vsphere', 'cluster', 'esx1', 'tier_1', 'tier_0'],
    ]);
    assert.deepEqual(view.controls.applications_on_most_sensitive?.map((item) => [item.name, item.asset.name, item.reference?.startsWith('APP-')]), [
      ['App dc-home', 'dc-home', true],
      ['Portal', 'guest', true],
      ['Portal', 'node', true],
    ]);
    const dumped = JSON.stringify(view);
    for (const absent of ['dc-retired', 'gone-vm', 'Buried', 'Quiet', 'foreign-dc', 'leftover', 'Side']) assert.equal(dumped.includes(absent), false, absent);

    const file = await service(settings).csv({ list: 'zones', language: 'en' }, { manager: runner.manager, tenantId: a });
    const lines = file.content.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    assert.equal(lines[0], 'Record,Zone,Administrator group,Description,Reference,Name,Type,Hosted applications,Note');
    assert.ok(lines.some((line) => line.startsWith('control,Assets in a more sensitive zone than what contains them,') && line.includes(',host,contains,') && line.includes('guest')), file.content);
    assert.ok(lines.some((line) => line.startsWith('control,Applications hosted in the most sensitive zone,') && line.includes(',Portal,')), file.content);
    assert.equal(lines.some((line) => line.includes('Quiet') || line.includes('leftover')), false);

    await setTenant(runner, b);
    const other = await service(settings).view({ manager: runner.manager, tenantId: b });
    assert.deepEqual(other.zones.find((zone) => zone.code === 'tier_0')?.assets.map((item) => item.name), ['foreign-dc']);
    assert.equal(JSON.stringify(other).includes('dc-home'), false);
  });
}

async function testCsv() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner);
    const svc = service(s.settings);
    const opts = { manager: runner.manager, tenantId: s.a };
    const zones = await svc.csv({ list: 'zones', language: 'en' }, opts);
    assert.equal(zones.filename, 'administration_view_zones.csv');
    const zoneLines = zones.content.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    assert.deepEqual(zoneLines, [
      'Record,Zone,Administrator group,Description,Reference,Name,Type,Hosted applications,Note',
      'zone,Tier 0,Domain admins,Identity core,,,,0,vm: 1',
      'asset,Tier 0,,,AST-10,fw1,vm,,',
      'directory,Tier 0,,,TEC-1,Active Directory,,,',
      'zone,Tier 1,Server admins,,,,,0,',
      'control,Assets without an administration zone,,,AST-3,app1,vm,,No zone',
      'control,Assets without an administration zone,,,AST-4,dc-disabled,vm,,No zone',
      'control,Assets without an administration zone,,,AST-1,dc1,vm,,No zone',
      'control,Assets without an administration zone,,,AST-5,dc2,vm,,No zone',
      'control,Assets without an administration zone,,,AST-7,host1,vm,,No zone',
      'control,Assets without an administration zone,,,AST-6,lab-old,vm,,No zone',
      'control,Assets without an administration zone,,,AST-8,vm1,vm,,No zone',
      'control,Domain controllers outside the most sensitive zone,,,AST-1,dc1,vm,,No zone',
      'control,Assets carrying a directory service outside the most sensitive zone,,,AST-1,dc1,vm,,No zone',
      'control,Assets carrying a directory service outside the most sensitive zone,,,AST-5,dc2,vm,,No zone',
    ]);
    const domains = await svc.csv({ list: 'domains', language: 'en' }, opts);
    const domainLines = domains.content.replace(/^\uFEFF/, '').trim().split(/\r?\n/);
    assert.equal(domainLines[0], 'Domain,DNS suffix,Forest,Trusts,Trusts declared by other domains,Accounts,Machines,Domain controllers,Domain controller servers');
    assert.equal(domainLines[1], 'Corp,corp.example.com,corp.example.com,Lab (two-way),,1200,300,2,"dc1, dc2"');
    assert.equal(domainLines[2], 'Lab,lab.example.com,,,"Corp (two-way), Partner (incoming)",,,0,');
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
  ['zones, assets, directory services, domains and tenant isolation', testView],
  ['a zone code the catalog no longer has, an empty catalog', testUnknownZoneAndEmptyCatalog],
  ['each control point, with one case that stays out', testControls],
  ['CSV export of zones and domains', testCsv],
  ['routes: paths and permission', testRoutes],
]);
