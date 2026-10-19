// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { AuditService } from '../../audit/audit.service';
import { DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import {
  AdministrationViewService,
  BULK_MAX_ROWS,
  type AdministrationAssetRow,
  type AdministrationSummary,
  type ControlKey,
} from '../reports/administration-view.service';
import { AdministrationViewController } from '../reports/administration-view.controller';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { application, asset, assign, contains, installed, member, one, technology, version } from './technologies.fixtures';

// The administration view (lot A1e), against a real database in transactions rolled back at the end.
// The five controls keep the rules reviewed in lot A1d. The summary and the asset page report counts
// and findings. Trust counts pairs. Applications in the most sensitive zone count one row per
// application and hosting asset. The asset page lists each asset once.

type Settings = Record<string, unknown>;

function service(settingsByTenant: Map<string, Settings>) {
  const itOps = {
    getSettings: async (tenantId: string) => settingsByTenant.get(tenantId) ?? {
      adminZones: [], domains: [], technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES, serverKinds: [],
    },
  };
  return new AdministrationViewService(itOps as any, new AuditService({} as any));
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

const setFilter = (column: string, values: unknown[]) => JSON.stringify({ [column]: { filterType: 'set', values } });

function countOf(summary: AdministrationSummary, key: ControlKey): number | null {
  return summary.controls.find((control) => control.key === key)?.count ?? null;
}

function named(items: AdministrationAssetRow[], name: string): AdministrationAssetRow {
  const row = items.find((item) => item.name === name);
  assert.ok(row, name);
  return row!;
}

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
    [a, { adminZones: ZONES, domains: DOMAINS, technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES, serverKinds: [{ code: 'vm', label: 'Virtual machine' }] }],
    [b, { adminZones: ZONES, domains: DOMAINS, technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES, serverKinds: [{ code: 'vm', label: 'Virtual machine' }] }],
  ]);
  return { a, b, ad, sql, vsphere, dc1, app1, host, vm, otherDc, settings };
}

async function testSummary() {
  await inRolledBackTransaction(async (runner) => {
    const s = await seed(runner);
    const svc = service(s.settings);
    const opts = { manager: runner.manager, tenantId: s.a };
    const view = await svc.summary(opts);

    assert.equal(view.most_sensitive, 'tier_0');
    assert.deepEqual(view.zones.map((zone) => zone.code), ['tier_0', 'tier_1'], 'catalog order, the empty deprecated zone hidden');
    const [tier0, tier1] = view.zones;
    assert.deepEqual(
      { group: tier0.admin_group, description: tier0.description, deprecated: tier0.deprecated, unknown: tier0.unknown },
      { group: 'Domain admins', description: 'Identity core', deprecated: false, unknown: false },
    );
    assert.equal('assets' in tier0, false, 'the summary counts the assets, it does not list them');
    assert.deepEqual(tier0.directory_services.map((item) => [item.reference, item.name]), [['TEC-1', 'Active Directory']], 'a database technology in the zone is not a directory service, a retired one is left out');
    assert.deepEqual(tier0.asset_counts, [{ kind: 'vm', count: 1 }]);
    assert.equal(tier0.hosted_application_count, 0);
    assert.deepEqual(tier1.directory_services, []);
    assert.deepEqual(tier1.asset_counts, []);
    assert.equal(tier1.admin_group, 'Server admins');
    assert.equal(tier1.hosted_application_count, 0);
    assert.equal(view.zones.some((zone) => zone.code === 'old'), false);
    assert.equal(view.without_zone.asset_count, 7);
    assert.deepEqual(view.controls.map((control) => [control.key, control.count]), [
      ['assets_without_zone', 7],
      ['domain_controllers_outside', 1],
      ['directory_assets_outside', 2],
      ['trust_raised', 0],
      ['applications_on_most_sensitive', 0],
    ]);
    assert.equal(countOf(view, 'assets_without_zone'), view.without_zone.asset_count);

    const listed = await svc.assets({ limit: 50 }, opts);
    assert.deepEqual(listed.items.map((item) => item.name), ['app1', 'dc-disabled', 'dc1', 'dc2', 'fw1', 'host1', 'lab-old', 'vm1']);
    assert.equal(listed.items.some((item) => item.name === 'vm-retired' || item.name === 'fw-old' || item.name === 'dc-old'), false);
    assert.deepEqual(named(listed.items, 'dc1').findings, ['assets_without_zone', 'domain_controllers_outside', 'directory_assets_outside']);
    assert.deepEqual(named(listed.items, 'dc2').findings, ['assets_without_zone', 'directory_assets_outside']);
    assert.deepEqual(named(listed.items, 'fw1').findings, []);
    assert.equal(named(listed.items, 'fw1').zone, 'tier_0');

    const ids = JSON.stringify({ view, listed });
    assert.ok(!ids.includes(s.otherDc) && !ids.includes('Other AD'), 'nothing of the other tenant');

    await setTenant(runner, s.b);
    const otherOpts = { manager: runner.manager, tenantId: s.b };
    const other = await svc.summary(otherOpts);
    assert.deepEqual(other.zones.find((zone) => zone.code === 'tier_0')?.directory_services.map((item) => item.name), ['Other AD']);
    assert.deepEqual(other.zones.find((zone) => zone.code === 'tier_0')?.asset_counts, []);
    assert.equal(other.without_zone.asset_count, 1);
    assert.deepEqual(other.controls.map((control) => control.count), [1, 1, 1, 0, 0]);
    assert.equal(JSON.stringify(other).includes('dc1'), false);
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
    const svc = service(new Map());
    const opts = { manager: runner.manager, tenantId: a };
    const view = await svc.summary(opts);
    assert.deepEqual(view.zones.map((zone) => [zone.code, zone.label, zone.unknown, zone.deprecated]), [
      ['ghost', 'ghost', true, false],
      ['gone', 'gone', true, false],
    ]);
    assert.equal(view.zones.some((zone) => zone.code === 'leftover'), false, 'a technology of another family does not open a zone');
    assert.deepEqual(view.zones[0].asset_counts, [{ kind: 'vm', count: 1 }]);
    assert.deepEqual(view.zones[1].directory_services.map((item) => item.name), ['Stray']);
    assert.equal(view.most_sensitive, null);
    assert.equal(view.without_zone.asset_count, 1);
    assert.deepEqual(view.controls.map((control) => [control.key, control.count]), [
      ['assets_without_zone', 1],
      ['domain_controllers_outside', null],
      ['directory_assets_outside', null],
      ['trust_raised', null],
      ['applications_on_most_sensitive', null],
    ]);
    const outside = await svc.assets({ filters: setFilter('control', ['domain_controllers_outside']) }, opts);
    assert.equal(outside.total, 0, 'a control that does not apply matches nothing');
    const bare = await svc.assets({ filters: setFilter('control', ['assets_without_zone']) }, opts);
    assert.deepEqual(bare.items.map((item) => item.name), ['plain-srv']);
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
    // The same content on a second holder: the control counts both pairs, the asset page lists guest once.
    const hostB = await place('host-b', 'tier_1');
    await contains(runner, a, hostB, guest);
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
    const extra = await application(runner, a, 'Extra');
    await assign(runner, a, extra, guest);
    const goneVm = await place('gone-vm', 'tier_0');
    await hostApp('Buried', goneVm);
    await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [a, goneVm]);
    await place('old-box', 'old');
    await place('ghost-box', 'ghost');
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
    const svc = service(settings);
    const opts = { manager: runner.manager, tenantId: a };
    const view = await svc.summary(opts);

    assert.equal(view.most_sensitive, 'tier_0', 'the first zone is deprecated, so the next one is the most sensitive');
    assert.deepEqual(view.zones.map((zone) => zone.code), ['retired_first', 'tier_0', 'tier_1', 'old', 'ghost', 'gone']);
    assert.equal(view.zones.some((zone) => zone.code === 'leftover'), false, 'a technology of another family does not open a zone');
    assert.equal(view.zones.find((zone) => zone.code === 'retired_first')?.deprecated, true);
    assert.equal(view.zones.find((zone) => zone.code === 'ghost')?.unknown, true);
    assert.deepEqual(view.zones.find((zone) => zone.code === 'tier_0')?.asset_counts, [{ kind: 'vm', count: 14 }]);
    assert.deepEqual(view.zones.find((zone) => zone.code === 'tier_0')?.directory_services.map((item) => item.name), ['Active Directory']);
    assert.deepEqual(view.zones.find((zone) => zone.code === 'gone')?.directory_services.map((item) => item.name), ['Gone directory']);
    assert.equal(view.zones.find((zone) => zone.code === 'old')?.asset_counts[0]?.count, 1);
    assert.equal(view.zones.find((zone) => zone.code === 'tier_0')?.hosted_application_count, 3, 'Portal, Extra and App dc-home, each once');
    assert.equal(view.zones.find((zone) => zone.code === 'tier_1')?.hosted_application_count, 2);
    assert.equal(view.without_zone.asset_count, 5);
    assert.equal(countOf(view, 'assets_without_zone'), 5);
    assert.equal(countOf(view, 'domain_controllers_outside'), 2);
    assert.equal(countOf(view, 'directory_assets_outside'), 2);
    assert.equal(countOf(view, 'trust_raised'), 3, 'guest depends on host and host-b, and esx1 on vsphere: three pairs');
    assert.equal(countOf(view, 'applications_on_most_sensitive'), 4, 'Portal on guest and node, Extra on guest, App dc-home on dc-home');

    const page = await svc.assets({ limit: 200 }, opts);
    assert.equal(page.total, page.items.length);
    const row = (name: string) => named(page.items, name);
    assert.deepEqual(page.items.map((item) => item.name).filter((name) => ['bare', 'dc-blank', 'dir-blank', 'gap', 'loose'].includes(name)).sort(), ['bare', 'dc-blank', 'dir-blank', 'gap', 'loose']);
    assert.equal(row('gap').zone, null, 'a blank zone is no zone');
    assert.deepEqual(row('dc-home').findings, ['applications_on_most_sensitive']);
    assert.deepEqual(row('dc-away').findings, ['domain_controllers_outside']);
    assert.deepEqual(row('dc-blank').findings, ['assets_without_zone', 'domain_controllers_outside']);
    assert.deepEqual(row('dc-off').findings, [], 'a disabled application and instance do not make a controller');
    assert.deepEqual(row('dir-home').findings, []);
    assert.deepEqual(row('dir-away').findings, ['directory_assets_outside']);
    assert.deepEqual(row('dir-blank').findings, ['assets_without_zone', 'directory_assets_outside']);
    assert.deepEqual(row('old-dir').technologies.items.map((item) => item.name), ['Retired directory']);
    assert.deepEqual(row('old-dir').findings, [], 'a retired directory technology does not count');
    assert.deepEqual(row('plain').findings, []);
    assert.deepEqual(row('plain').applications.items.map((item) => item.name), ['Side']);
    assert.deepEqual(row('spare').applications, { total: 0, items: [] });
    assert.deepEqual(row('spare').findings, []);
    assert.deepEqual(row('guest').findings, ['trust_raised', 'applications_on_most_sensitive']);
    assert.deepEqual(row('guest').depends_on.map((item) => [item.name, item.zone, item.relation]), [
      ['host', 'tier_1', 'contains'],
      ['host-b', 'tier_1', 'contains'],
    ]);
    assert.deepEqual(row('guest').application_references, row('guest').applications.items.map((item) => item.reference));
    assert.deepEqual(row('guest').applications.items.map((item) => item.name), ['Extra', 'Portal']);
    assert.deepEqual(row('host').findings, [], 'the holder is not the finding');
    assert.deepEqual(row('host-b').findings, []);
    assert.deepEqual(row('esx1').findings, ['trust_raised']);
    assert.deepEqual(row('esx1').depends_on.map((item) => [item.name, item.zone, item.relation]), [['vsphere', 'tier_0', 'cluster']]);
    assert.deepEqual(row('node').findings, ['applications_on_most_sensitive'], 'a member more sensitive than its cluster stays out of the trust control');
    assert.deepEqual(row('esx0').findings, []);
    assert.deepEqual(row('child').findings, []);
    assert.deepEqual(row('guest2').findings, []);
    assert.deepEqual(row('parked').findings, []);
    assert.deepEqual(row('legacy-vm').findings, []);
    assert.deepEqual(row('legacy-host').findings, []);
    assert.deepEqual(row('twin').findings, []);
    assert.equal(page.items.some((item) => item.name === 'dc-retired' || item.name === 'gone-vm'), false);

    const trust = await svc.assets({ filters: setFilter('control', ['trust_raised']), limit: 50 }, opts);
    assert.deepEqual(trust.items.map((item) => item.name), ['esx1', 'guest']);
    assert.equal(trust.total, 2, 'two assets, three pairs');
    const apps = await svc.assets({ filters: setFilter('control', ['applications_on_most_sensitive']), limit: 50 }, opts);
    assert.deepEqual(apps.items.map((item) => item.name), ['dc-home', 'guest', 'node']);
    assert.equal(apps.total, 3, 'three assets, four application rows');
    const controllers = await svc.assets({ filters: setFilter('control', ['domain_controllers_outside']) }, opts);
    assert.deepEqual(controllers.items.map((item) => item.name), ['dc-away', 'dc-blank']);
    const directories = await svc.assets({ filters: setFilter('control', ['directory_assets_outside']) }, opts);
    assert.deepEqual(directories.items.map((item) => item.name), ['dir-away', 'dir-blank']);
    const bareRows = await svc.assets({ filters: setFilter('control', ['assets_without_zone']) }, opts);
    assert.deepEqual(bareRows.items.map((item) => item.name), ['bare', 'dc-blank', 'dir-blank', 'gap', 'loose']);
    assert.equal(row('old-box').zone, 'old');
    assert.equal(row('ghost-box').zone, 'ghost');

    await setTenant(runner, b);
    const other = await svc.summary({ manager: runner.manager, tenantId: b });
    assert.deepEqual(other.zones.find((zone) => zone.code === 'tier_0')?.asset_counts, [{ kind: 'vm', count: 1 }]);
    assert.equal(JSON.stringify(other).includes('dc-home'), false);
    const otherAssets = await svc.assets({ limit: 50 }, { manager: runner.manager, tenantId: b });
    assert.deepEqual(otherAssets.items.map((item) => item.name), ['foreign-dc']);
  });
}

async function testRoutes() {
  assert.equal(Reflect.getMetadata(PATH_METADATA, AdministrationViewController), 'technologies/reports/administration');
  const proto = AdministrationViewController.prototype as any;
  assert.equal(Reflect.getMetadata(PATH_METADATA, proto.export), 'export', 'recorded as an export by its path');
  assert.equal(Reflect.getMetadata(PATH_METADATA, proto.assets), 'assets');
  assert.equal(Reflect.getMetadata(PATH_METADATA, proto.directories), 'directories');
  assert.equal(Reflect.getMetadata(PATH_METADATA, proto.assignZone), 'assets/zone');
  for (const handler of [proto.view, proto.assets, proto.directories, proto.export]) {
    assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, handler), { resource: 'infrastructure', level: 'reader' });
  }
  assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, proto.assignZone), { resource: 'infrastructure', level: 'member' });
}

void runSpecs('Administration view', [
  ['summary counts, directories and tenant isolation', testSummary],
  ['a zone code the catalog no longer has, an empty catalog', testUnknownZoneAndEmptyCatalog],
  ['each control point, with one case that stays out', testControls],
  ['routes: paths and permission', testRoutes],
]);
