// @database-spec
import 'dotenv/config';
import AdmZip = require('adm-zip');
import type { QueryRunner } from 'typeorm';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { DEFAULT_HOSTING_TYPES } from '../../it-ops-settings/it-ops-settings.service';
import { writeReportExport } from '../../common/report-export';
import { EndOfSupportService, type ReportOpts } from '../reports/end-of-support.service';
import type { ApplicationsReach } from '../technology-links.service';
import { versionSupportSql } from '../reports/version-support';
import { TechnologyReachService } from '../technology-reach.service';
import { application, asset, assign, contains, installed, member, one, technology, version } from './technologies.fixtures';

// The "End of support" report (lot T4) against a real database, in transactions rolled back at the
// end: each kind of deadline and its state, what it touches, the horizon, the seven gaps, the
// application columns without the applications right, and tenant isolation.

type Ctx = Awaited<ReturnType<typeof seed>>;

function addMonths(day: string, months: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
}

async function seed(runner: QueryRunner, tag: string) {
  const [{ today }]: Array<{ today: string }> = await runner.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`);
  const past = addMonths(today, -12);
  const lastMonth = addMonths(today, -1);
  const soon = addMonths(today, 3);
  const later = addMonths(today, 24);
  const far = addMonths(today, 30);

  const tenantId = await seedTenant(runner, tag);
  const a = (name: string) => asset(runner, tenantId, `${name} ${tag}`);
  const s1 = await a('SRV-SQL16');
  const s2 = await a('SRV-SQL19');
  const s3 = await a('SRV-OLD-OS');
  const s4 = await a('SRV-HW');
  const s5 = await a('SRV-NOVERSION');
  const dbEmpty = await a('DB-EMPTY');
  const vmOrphan = await a('VM-ORPHAN');
  const vmHosted = await a('VM-HOSTED');
  await runner.query(`UPDATE assets SET kind = 'virtual_machine' WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [tenantId, [vmOrphan, vmHosted]]);
  await contains(runner, tenantId, s1, vmHosted);
  await runner.query(`UPDATE assets SET kind = 'physical_server', end_of_life_date = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, s4, soon]);
  // A VM at its end of life is no hardware.
  const vmEol = await a('VM-EOL');
  await runner.query(`UPDATE assets SET end_of_life_date = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, vmEol, soon]);
  // What the host carries is touched too: a VM on the old OS server and one on the hardware.
  const vmOnOs = await a('VM-ON-OS');
  const vmOnHw = await a('VM-ON-HW');
  await contains(runner, tenantId, s3, vmOnOs);
  await contains(runner, tenantId, s4, vmOnHw);
  await runner.query(`INSERT INTO asset_support_info (tenant_id, asset_id, support_expiry) VALUES ($1, $2, $3)`, [tenantId, s4, lastMonth]);
  // A retired asset at its end of life is not in service: left out.
  const retired = await a('SRV-RETIRED');
  await runner.query(`UPDATE assets SET status = 'retired', end_of_life_date = $3 WHERE tenant_id = $1 AND id = $2`, [tenantId, retired, soon]);

  const sql = await technology(runner, tenantId, 1, 'SQL Server', 'database');
  const sql2016 = await version(runner, tenantId, sql, '2016', past);
  await runner.query(`UPDATE technology_versions SET extended_support_end = $2 WHERE id = $1`, [sql2016, lastMonth]);
  const sql2019 = await version(runner, tenantId, sql, '2019', past);
  await runner.query(`UPDATE technology_versions SET extended_support_end = $2 WHERE id = $1`, [sql2019, later]);
  const sql2022 = await version(runner, tenantId, sql, '2022', far);
  // A version nobody uses is not in service: never a deadline.
  await version(runner, tenantId, sql, '2012', past);
  await installed(runner, tenantId, s1, sql, sql2016);
  await installed(runner, tenantId, s2, sql, sql2019);
  await installed(runner, tenantId, s2, sql, sql2022);
  await installed(runner, tenantId, s5, sql, null);
  const tomcat = await technology(runner, tenantId, 2, 'Tomcat', 'application_server');
  const tomcat9 = await version(runner, tenantId, tomcat, '9');
  await installed(runner, tenantId, s2, tomcat, tomcat9);
  // A catalog key of a dated product, with the tenant dates still empty, stays a missing date.
  const tomcat10 = await version(runner, tenantId, tomcat, '10');
  await runner.query(`UPDATE technology_versions SET catalog_key = 'postgresql:19' WHERE id = $1`, [tomcat10]);
  await installed(runner, tenantId, s2, tomcat, tomcat10);
  // WebSphere 9.0.x is shipped with no planned end: in use, and not a missing date.
  const websphere = await technology(runner, tenantId, 10, 'WebSphere', 'application_server');
  const was9 = await version(runner, tenantId, websphere, '9.0.x');
  await runner.query(`UPDATE technology_versions SET catalog_key = 'ibm-websphere:9.0.x' WHERE id = $1`, [was9]);
  await installed(runner, tenantId, s2, websphere, was9);
  const unused = await technology(runner, tenantId, 3, 'Unused', 'other');
  // An installed technology entered without any version: its link without version is a gap.
  const free = await technology(runner, tenantId, 5, 'Free', 'other');
  await installed(runner, tenantId, s2, free, null);
  const entra = await technology(runner, tenantId, 4, 'Entra ID', 'directory');
  await runner.query(`UPDATE technologies SET hosting_type = 'saas' WHERE id = $1`, [entra]);
  // Hosting types (lot H1): colocation is on premises, so a gap on no server; a public cloud service is not.
  const colo = await technology(runner, tenantId, 6, 'Colo', 'other');
  await runner.query(`UPDATE technologies SET hosting_type = 'colocation' WHERE id = $1`, [colo]);
  const cloud = await technology(runner, tenantId, 7, 'Cloud', 'other');
  await runner.query(`UPDATE technologies SET hosting_type = 'public_cloud' WHERE id = $1`, [cloud]);
  // A code out of the catalog: missing data of its own (inferred in the cloud, so not "on no server").
  const untyped = await technology(runner, tenantId, 8, 'Untyped', 'other');
  await runner.query(`UPDATE technologies SET hosting_type = 'gone' WHERE id = $1`, [untyped]);
  // An operating system is a technology of that family, marked on the server. Both dates are past.
  const oldOs = await technology(runner, tenantId, 9, 'Old OS', 'operating_system');
  const oldOsVersion = await version(runner, tenantId, oldOs, '1', '2015-01-01');
  await runner.query(`UPDATE technology_versions SET extended_support_end = '2020-01-01' WHERE id = $1`, [oldOsVersion]);
  await installed(runner, tenantId, s3, oldOs, oldOsVersion);
  await runner.query(
    `UPDATE asset_technologies SET is_operating_system = true WHERE tenant_id = $1 AND asset_id = $2 AND technology_id = $3`,
    [tenantId, s3, oldOs],
  );

  const erp = await application(runner, tenantId, `ERP ${tag}`);
  await assign(runner, tenantId, erp, s1);
  const portal = await application(runner, tenantId, `Portal ${tag}`);
  await assign(runner, tenantId, portal, s3);
  const osVmApp = await application(runner, tenantId, `OS VM app ${tag}`);
  await assign(runner, tenantId, osVmApp, vmOnOs);
  const hwVmApp = await application(runner, tenantId, `HW VM app ${tag}`);
  await assign(runner, tenantId, hwVmApp, vmOnHw);
  const crm = await application(runner, tenantId, `Legacy CRM ${tag}`);
  await runner.query(`UPDATE applications SET end_of_support_date = $2, hosting_model = 'on_premise' WHERE id = $1`, [crm, soon]);
  // A SaaS application without servers is no gap.
  const saas = await application(runner, tenantId, `SaaS ${tag}`);
  await runner.query(`UPDATE applications SET hosting_model = 'saas' WHERE id = $1`, [saas]);

  // Database role: DB-EMPTY carries no database technology, SRV-SQL16 does.
  const dbApp = await application(runner, tenantId, `Warehouse ${tag}`);
  const dbInstance = await one(runner, `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`, [tenantId, dbApp]);
  await runner.query(`INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'db'), ($1, $2, $4, 'db')`, [tenantId, dbInstance, dbEmpty, s1]);
  // A database role of a disabled application is no gap.
  const dbDisabled = await a('DB-DISABLED');
  const oldDbApp = await application(runner, tenantId, `Old warehouse ${tag}`);
  await runner.query(`UPDATE applications SET status = 'disabled' WHERE id = $1`, [oldDbApp]);
  const oldDbInstance = await one(runner, `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`, [tenantId, oldDbApp]);
  await runner.query(`INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'db')`, [tenantId, oldDbInstance, dbDisabled]);

  // SSO: one application without an identity technology, one that declares Entra ID (no version, no gap).
  const ssoBare = await application(runner, tenantId, `SSO bare ${tag}`);
  const ssoOk = await application(runner, tenantId, `SSO ok ${tag}`);
  await runner.query(
    `INSERT INTO app_instances (tenant_id, application_id, environment, sso_enabled) VALUES ($1, $2, 'prod', true), ($1, $3, 'prod', true)`,
    [tenantId, ssoBare, ssoOk],
  );
  await runner.query(`INSERT INTO application_technologies (tenant_id, application_id, technology_id) VALUES ($1, $2, $3)`, [tenantId, ssoOk, entra]);

  return {
    tenantId, today, soon, lastMonth, later, far,
    assets: { s1, s2, s3, s4, s5, dbEmpty, dbDisabled, vmOrphan, vmHosted, retired, vmEol, vmOnOs, vmOnHw },
    tech: { sql, tomcat, unused, entra, free, colo, cloud, untyped, oldOs, websphere },
    versions: { sql2016, sql2019, sql2022, tomcat9, oldOs: oldOsVersion },
    apps: { erp, portal, osVmApp, hwVmApp, crm, saas, dbApp, ssoBare, ssoOk },
  };
}

function service() {
  const itOps = {
    getSettings: async () => ({
      serverKinds: [{ code: 'physical_server', is_physical: true }, { code: 'vm', is_physical: false }, { code: 'virtual_machine', is_physical: false }],
      hostingTypes: DEFAULT_HOSTING_TYPES,
    }),
  };
  return new EndOfSupportService(new TechnologyReachService(), itOps as any);
}

const ALL = { scope: undefined };

/** The export's CSV in English, as the route writes it (common/report-export). */
async function csvFile(query: Record<string, unknown>, opts: ReportOpts, applications: ApplicationsReach) {
  const exp = await service().exportTable(query, 'en', opts, applications);
  const file = writeReportExport(exp, { format: 'csv', language: 'en', timeZone: 'UTC', generatedAt: new Date('2026-10-27T10:00:00Z'), generatedBy: 'Probe' });
  return { filename: file.filename, content: file.body.toString('utf8') };
}

/** The shared rule (`versionSupportSql`) on fixed dates, as the report and the assistant read it. */
async function testSupportState() {
  await inRolledBackTransaction(async (runner) => {
    const support = versionSupportSql('v', `'2026-10-16'::date`);
    const at = async (standard: string | null, extended: string | null) => {
      const [row] = await runner.query(
        `SELECT ${support.state} AS state, to_char(${support.date}, 'YYYY-MM-DD') AS date, to_char(${support.first}, 'YYYY-MM-DD') AS first
           FROM (SELECT $1::date AS standard_support_end, $2::date AS extended_support_end) v`,
        [standard, extended],
      );
      return row;
    };
    assert.deepEqual(await at('2020-01-01', '2025-01-01'), { state: 'out_of_support', date: '2025-01-01', first: '2020-01-01' });
    assert.deepEqual(await at('2020-01-01', '2028-01-01'), { state: 'extended_support', date: '2028-01-01', first: '2020-01-01' });
    assert.deepEqual(await at('2027-01-01', '2030-01-01'), { state: 'supported', date: '2027-01-01', first: '2027-01-01' }, 'dated by the standard end');
    assert.deepEqual(await at(null, '2026-01-01'), { state: 'out_of_support', date: '2026-01-01', first: '2026-01-01' }, 'one date is the end');
    assert.deepEqual(await at('2026-01-01', '2025-01-01'), { state: 'out_of_support', date: '2026-01-01', first: '2026-01-01' }, 'an extended end before the standard one is no later end');
    assert.deepEqual(await at(null, null), { state: null, date: null, first: null });
  });
}

async function testDeadlines() {
  await inRolledBackTransaction(async (runner) => {
    const g: Ctx = await seed(runner, 'eos-deadlines');
    const report = await service().deadlines({}, { manager: runner.manager, tenantId: g.tenantId }, ALL);
    assert.equal(report.horizon_months, 12);
    assert.equal(report.applications_visible, true);
    const byKey = new Map(report.items.map((r) => [r.key, r]));
    assert.deepEqual(report.items.map((r) => r.key).sort(), [
      `technology:${g.versions.sql2016}`,
      `technology:${g.versions.sql2019}`,
      `operating_system:${g.versions.oldOs}`,
      `application:${g.apps.crm}`,
      `hardware:end_of_life:${g.assets.s4}`,
      `hardware:support_contract:${g.assets.s4}`,
    ].sort());

    const sql16 = byKey.get(`technology:${g.versions.sql2016}`)!;
    assert.equal(sql16.state, 'out_of_support');
    assert.equal(sql16.date, g.lastMonth);
    assert.equal(sql16.item_reference, 'TEC-1');
    assert.equal(sql16.version, '2016');
    // The server it is installed on, not the VM that server contains (decision of 2026-10-24); the
    // applications still come through the graph.
    assert.deepEqual(sql16.servers.map((s) => s.id).sort(), [g.assets.s1]);
    assert.equal(sql16.server_count, 1);
    assert.deepEqual(sql16.applications!.map((a) => a.id).sort(), [g.apps.dbApp, g.apps.erp].sort());
    assert.equal(sql16.application_count, 2);

    const sql19 = byKey.get(`technology:${g.versions.sql2019}`)!;
    assert.equal(sql19.state, 'extended_support');
    assert.equal(sql19.date, g.later);

    const os = byKey.get(`operating_system:${g.versions.oldOs}`)!;
    assert.equal(os.state, 'out_of_support');
    assert.equal(os.date, '2020-01-01');
    assert.equal(os.item_name, 'Old OS');
    assert.equal(os.item_reference, 'TEC-9');
    assert.equal(os.version, '1');
    assert.deepEqual(os.servers.map((s) => s.id), [g.assets.s3], 'the server it is installed on, not the VM it contains');
    assert.equal(os.server_count, 1);
    // The applications of the VM it contains are still touched.
    assert.deepEqual(os.applications!.map((a) => a.id).sort(), [g.apps.portal, g.apps.osVmApp].sort());

    const crm = byKey.get(`application:${g.apps.crm}`)!;
    assert.equal(crm.state, 'upcoming');
    assert.equal(crm.date, g.soon);
    assert.equal(crm.server_count, 0);

    assert.equal(byKey.get(`hardware:end_of_life:${g.assets.s4}`)!.state, 'upcoming');
    assert.equal(byKey.get(`hardware:support_contract:${g.assets.s4}`)!.state, 'out_of_support');
    const hardware = byKey.get(`hardware:end_of_life:${g.assets.s4}`)!;
    // What it carries; the piece of hardware is not one of its own servers (K2-7).
    assert.deepEqual(hardware.servers.map((s) => s.id), [g.assets.vmOnHw]);
    assert.equal(hardware.server_count, 1);
    assert.deepEqual(hardware.applications!.map((a) => a.id), [g.apps.hwVmApp]);
    assert.equal(hardware.item_name, `SRV-HW eos-deadlines`);

    // Sorted by date: the oldest end first.
    const dates = report.items.map((r) => r.date);
    assert.deepEqual(dates, [...dates].sort());
  });
}

/**
 * The servers of a deadline as the list counts them (clusters pass, Q3 amended 2026-10-24): a
 * version installed on two hosts of a cluster and carried to a VM the cluster contains has two
 * servers, the hosts; neither the VM nor the cluster; a retired member counts nowhere. A host at its
 * end of life touches the VM, not the cluster.
 */
async function testClusterServers() {
  await inRolledBackTransaction(async (runner) => {
    const g: Ctx = await seed(runner, 'eos-cluster');
    const a = (name: string, cluster = false) => asset(runner, g.tenantId, `${name} eos-cluster`, cluster);
    const h1 = await a('AGT-H1');
    const h2 = await a('AGT-H2');
    const h3 = await a('AGT-H3');
    const cluster = await a('AGT-CL', true);
    const vm = await a('AGT-VM');
    for (const host of [h1, h2, h3]) await member(runner, g.tenantId, cluster, host);
    await contains(runner, g.tenantId, cluster, vm);
    const agent = await technology(runner, g.tenantId, 11, 'Agent', 'other');
    const v1 = await version(runner, g.tenantId, agent, '1.0', g.lastMonth);
    for (const host of [h1, h2, h3]) await installed(runner, g.tenantId, host, agent, v1);
    await runner.query(`UPDATE assets SET status = 'retired' WHERE tenant_id = $1 AND id = $2`, [g.tenantId, h3]);
    await runner.query(`UPDATE assets SET kind = 'physical_server', end_of_life_date = $3 WHERE tenant_id = $1 AND id = $2`, [g.tenantId, h1, g.soon]);

    const report = await service().deadlines({}, { manager: runner.manager, tenantId: g.tenantId }, ALL);
    const byKey = new Map(report.items.map((r) => [r.key, r]));
    const row = byKey.get(`technology:${v1}`)!;
    assert.deepEqual(row.servers.map((s) => s.id).sort(), [h1, h2].sort());
    assert.equal(row.server_count, 2);
    const hardware = byKey.get(`hardware:end_of_life:${h1}`)!;
    assert.deepEqual(hardware.servers.map((s) => s.id), [vm], 'the VM of its cluster, neither the cluster nor itself');
    assert.equal(hardware.server_count, 1);
  });
}

async function testHorizonAndType() {
  await inRolledBackTransaction(async (runner) => {
    const g: Ctx = await seed(runner, 'eos-horizon');
    const opts = { manager: runner.manager, tenantId: g.tenantId };
    const wide = await service().deadlines({ horizon_months: '36' }, opts, ALL);
    const sql22 = wide.items.find((r) => r.key === `technology:${g.versions.sql2022}`);
    assert.equal(sql22?.state, 'upcoming', 'a version ending in 30 months shows at 36');
    assert.equal(sql22?.date, g.far);
    const narrow = await service().deadlines({ horizon_months: 6 }, opts, ALL);
    assert.ok(narrow.items.some((r) => r.key === `application:${g.apps.crm}`), 'three months away is within six');
    assert.ok(!narrow.items.some((r) => r.key === `technology:${g.versions.sql2022}`));
    const hardware = await service().deadlines({ type: 'hardware' }, opts, ALL);
    assert.ok(hardware.items.length === 2 && hardware.items.every((r) => r.type === 'hardware'));
    const onlyOs = await service().deadlines({ type: 'operating_system' }, opts, ALL);
    assert.deepEqual(onlyOs.items.map((r) => r.key), [`operating_system:${g.versions.oldOs}`]);
    const onlyTech = await service().deadlines({ type: 'technology' }, opts, ALL);
    assert.ok(onlyTech.items.every((r) => r.type === 'technology'));
    assert.ok(!onlyTech.items.some((r) => r.key.startsWith('operating_system:')));
    await assert.rejects(service().deadlines({ horizon_months: 5 }, opts, ALL), /horizon_months/);
    await assert.rejects(service().deadlines({ type: 'printer' }, opts, ALL), /type must be/);
  });
}

async function testGaps() {
  await inRolledBackTransaction(async (runner) => {
    const g: Ctx = await seed(runner, 'eos-gaps');
    const { items } = await service().gaps({ manager: runner.manager, tenantId: g.tenantId }, ALL);
    const got = items.map((r) => `${r.gap}|${r.subject_id}|${r.related_id ?? r.version ?? '-'}`).sort();
    assert.deepEqual(got, [
      `application_without_server|${g.apps.crm}|-`,
      `vm_without_host|${g.assets.vmOrphan}|-`,
      `technology_not_installed|${g.tech.unused}|-`,
      `technology_not_installed|${g.tech.colo}|-`,
      `technology_without_hosting_type|${g.tech.untyped}|-`,
      `database_server_without_dbms|${g.assets.dbEmpty}|-`,
      `sso_application_without_identity|${g.apps.ssoBare}|-`,
      `link_without_version|${g.tech.sql}|${g.assets.s5}`,
      `link_without_version|${g.tech.free}|${g.assets.s2}`,
      `version_without_end_date|${g.tech.tomcat}|9`,
      `version_without_end_date|${g.tech.tomcat}|10`,
    ].sort());
    assert.ok(!got.some((line) => line.startsWith(`version_without_end_date|${g.tech.websphere}|`)), 'a version with no planned end is not a missing date');
    const gapsFile = await csvFile({ list: 'gaps' }, { manager: runner.manager, tenantId: g.tenantId }, ALL);
    assert.equal(gapsFile.content.includes('WebSphere'), false);
    assert.equal(gapsFile.content.includes('Tomcat'), true);
    const link = items.find((r) => r.gap === 'link_without_version' && r.subject_id === g.tech.sql)!;
    assert.equal(link.subject_type, 'technology');
    assert.equal(link.subject_reference, 'TEC-1');
    assert.equal(link.related_type, 'asset');
    // Sorted by the order of the gaps.
    assert.equal(items[0].gap, 'application_without_server');
    assert.equal(items[items.length - 1].gap, 'version_without_end_date');
  });
}

async function testWithoutApplications() {
  await inRolledBackTransaction(async (runner) => {
    const g: Ctx = await seed(runner, 'eos-rights');
    const opts = { manager: runner.manager, tenantId: g.tenantId };
    const report = await service().deadlines({}, opts, null);
    assert.equal(report.applications_visible, false);
    assert.ok(report.items.length > 0);
    assert.ok(report.items.every((r) => r.applications === null && r.application_count === null), 'application columns are null');
    assert.ok(!report.items.some((r) => r.type === 'application'), 'no application rows');
    const gaps = await service().gaps(opts, null);
    assert.ok(!gaps.items.some((r) => r.subject_type === 'application' || r.related_type === 'application'));
    assert.ok(gaps.items.some((r) => r.gap === 'vm_without_host'));
    const file = await csvFile({ list: 'deadlines' }, opts, null);
    const header = file.content.replace(/^﻿/, '').split(/\r?\n/)[0];
    assert.ok(!/Application/.test(header), `no application column in the file: ${header}`);
    const gapsFile = await csvFile({ list: 'gaps' }, opts, ALL);
    assert.ok(gapsFile.content.includes('Virtual machine without a host'));
    assert.equal(gapsFile.filename, 'end-of-support-gaps-2026-10-27.csv');
    await assert.rejects(csvFile({ list: 'other' }, opts, ALL), /list must be/);
    await assert.rejects(csvFile({ list: 'gaps', horizon_months: '6' }, opts, ALL), /deadlines list only/);
    // With applications: the columns the file always had, in the screen's words; the end date a date cell.
    const all = await csvFile({ list: 'deadlines', horizon_months: '36' }, opts, ALL);
    assert.equal(
      all.content.replace(/^\uFEFF/, '').split('\n')[0],
      'Type,Reference,Item,Version,End date,State,Servers,Applications,Server names,Application names',
    );
    assert.equal(all.filename, 'end-of-support-36-months-2026-10-27.csv');
    const exp = await service().exportTable({ list: 'deadlines', horizon_months: '36', type: 'technology' }, 'fr', opts, ALL);
    const xlsx = writeReportExport(exp, { format: 'xlsx', language: 'fr', timeZone: 'UTC', generatedAt: new Date('2026-10-27T10:00:00Z'), generatedBy: 'Probe' });
    const zip = new AdmZip(xlsx.body);
    const sheet = zip.readAsText('xl/worksheets/sheet1.xml');
    assert.ok(sheet.includes('>Date de fin<') && sheet.includes('>Technologie<'), 'French headers and type');
    assert.ok(/<c r="E2" s="1"><v>\d+<\/v><\/c>/.test(sheet), 'the end date is a date cell');
    assert.equal(xlsx.rows, exp.tables[0].rows.length);
    assert.ok(exp.tables[0].rows.length > 0 && exp.tables[0].rows.every((row) => row[0] === 'Technologie'), 'the type filter applies');
    assert.deepEqual(exp.parameters, [['Vue du rapport', 'Échéances'], ['Horizon', '36 mois'], ['Type', 'Technologie']]);
  });
}

async function testBusinessContributorScope() {
  await inRolledBackTransaction(async (runner) => {
    const g: Ctx = await seed(runner, 'eos-scope');
    const role = await one(runner, `INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Contributor eos-scope') RETURNING id`, [g.tenantId]);
    const user = await one(
      runner,
      `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, 'Bea', 'Contributor', 'bea.eos-scope@example.invalid', 'enabled') RETURNING id`,
      [g.tenantId, role],
    );
    // The contributor takes part in the portal only.
    await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`, [g.tenantId, g.apps.portal, user]);
    const opts = { manager: runner.manager, tenantId: g.tenantId };
    const scope = { scope: { userId: user } };
    const report = await service().deadlines({}, opts, scope);
    assert.ok(!report.items.some((r) => r.type === 'application'), 'the CRM is outside the scope: no row');
    const byKey = new Map(report.items.map((r) => [r.key, r]));
    assert.deepEqual(byKey.get(`operating_system:${g.versions.oldOs}`)!.applications!.map((a) => a.id), [g.apps.portal], 'only its own application in the columns');
    assert.deepEqual(byKey.get(`technology:${g.versions.sql2016}`)!.applications, []);
    assert.equal(byKey.get(`technology:${g.versions.sql2016}`)!.application_count, 0);
    assert.equal(byKey.get(`technology:${g.versions.sql2016}`)!.server_count, 1, 'servers stay');
    const gaps = await service().gaps(opts, scope);
    assert.ok(!gaps.items.some((r) => r.subject_type === 'application'), 'no gap on an application outside the scope');
    assert.ok(gaps.items.some((r) => r.gap === 'vm_without_host'));
  });
}

async function testTenantIsolation() {
  await inRolledBackTransaction(async (runner) => {
    const a: Ctx = await seed(runner, 'eos-iso-a');
    const b = await seedTenant(runner, 'eos-iso-b');
    await setTenant(runner, b);
    const own = await service().deadlines({}, { manager: runner.manager, tenantId: b }, ALL);
    assert.deepEqual(own.items, [], 'tenant B has nothing');
    const named = await service().deadlines({}, { manager: runner.manager, tenantId: a.tenantId }, ALL);
    assert.deepEqual(named.items, [], 'RLS hides tenant A even when named');
    const gaps = await service().gaps({ manager: runner.manager, tenantId: b }, ALL);
    assert.deepEqual(gaps.items, []);
  });
}

runSpecs('end-of-support.integration.spec', [
  ['support state', testSupportState],
  ['deadlines', testDeadlines],
  ['servers on a cluster', testClusterServers],
  ['horizon and type', testHorizonAndType],
  ['gaps', testGaps],
  ['without the applications right', testWithoutApplications],
  ['Business Contributor scope', testBusinessContributorScope],
  ['tenant isolation', testTenantIsolation],
]).catch((err) => {
  console.error(err);
  process.exit(1);
});
