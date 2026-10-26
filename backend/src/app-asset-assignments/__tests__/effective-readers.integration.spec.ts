// @database-spec
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AiEntityService } from '../../ai/ai-entity.service';
import { Application } from '../../applications/application.entity';
import { ApplicationsListService } from '../../applications/services/applications-list.service';
import { AuditService } from '../../audit/audit.service';
import { ContractsService } from '../../contracts/contracts.service';
import { CurrencyRateSet } from '../../currency/currency-rate-set.entity';
import { CurrencySettingsService } from '../../currency/currency-settings.service';
import { FxRateService } from '../../currency/fx-rate.service';
import { DEFAULT_HOSTING_TYPES, DEFAULT_TECHNOLOGY_FAMILIES } from '../../it-ops-settings/it-ops-settings.service';
import { KnowledgeService } from '../../knowledge/knowledge.service';
import { readLocationRelations } from '../../locations/location-relations';
import { assert, captureAudit, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';
import { asset, member, one, technology, version } from '../../technologies/__tests__/technologies.fixtures';
import { AdministrationViewService } from '../../technologies/reports/administration-view.service';
import { EndOfSupportService } from '../../technologies/reports/end-of-support.service';
import { TechnologyReachService } from '../../technologies/technology-reach.service';
import { Tenant } from '../../tenants/tenant.entity';
import { applicationCountsSql, applicationLinksSql } from '../../vulnerabilities/vulnerability-reach-counts';

// Clusters pass, lot B2: the reports and the last reads take the effective assignments
// (`effectiveAssignmentsSql`). An application assigned to a cluster takes from its members what it
// would take if they were assigned directly. One tenant: ERP on a cluster without a site, two
// members in service at a SaaS site, a third member retired at an on-premises site. Then, per
// reader: the vulnerabilities of ERP are those of its members (the retired member's left out); the
// end of support of ERP names the cluster and its members; the hosting type comes from the
// members (page, filter, filter values, interface map); the administration view judges a
// domain-controller role and an application on the cluster on its members' zones, like a direct
// assignment; a member's site lists ERP; a contract on a member covers ERP, and a contract of ERP
// sees its cloud hosting; the assistant's and the knowledge context name the members. A
// neighbouring tenant with the same shape sees nothing of it. Rolled back at the end.

const CVE_MEMBER = 'CVE-2096-52001';
const CVE_RETIRED = 'CVE-2096-52002';
const ZONES = [
  { code: 'tier_0', label: 'Tier 0' },
  { code: 'tier_1', label: 'Tier 1' },
];

type Seed = Awaited<ReturnType<typeof seed>>;

async function instanceOf(runner: QueryRunner, tenantId: string, appId: string): Promise<string> {
  return one(runner, `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod') RETURNING id`, [tenantId, appId]);
}

const assign = (runner: QueryRunner, tenantId: string, instanceId: string, assetId: string, role = 'app') =>
  runner.query(`INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, $4)`, [tenantId, instanceId, assetId, role]);

async function seed(runner: QueryRunner, tag: string) {
  const tenantId = await seedTenant(runner, tag);
  const site = (name: string, hosting: string) => one(runner,
    `INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, $2, $3, $4) RETURNING id`,
    [tenantId, `${name} ${tag}`, hosting, `LOC-${name}-${tag}`]);
  const cloud = await site('Cloud', 'saas');
  const room = await site('Room', 'on_prem');
  const place = (id: string, locationId: string | null, zone: string | null, status = 'active') => runner.query(
    `UPDATE assets SET location_id = $3, admin_zone = $4, status = $5, domain = 'corp' WHERE tenant_id = $1 AND id = $2`,
    [tenantId, id, locationId, zone, status]);

  const cluster = await asset(runner, tenantId, `CL ${tag}`, true);
  const m1 = await asset(runner, tenantId, `M1 ${tag}`);
  const m2 = await asset(runner, tenantId, `M2 ${tag}`);
  const m3 = await asset(runner, tenantId, `M3 ${tag}`);
  for (const node of [m1, m2, m3]) await member(runner, tenantId, cluster, node);
  await place(cluster, null, 'tier_0');
  await place(m1, cloud, 'tier_0');
  await place(m2, cloud, 'tier_1');
  await place(m3, room, 'tier_1', 'retired');

  const erp = await one(runner,
    `INSERT INTO applications (tenant_id, name, criticality, end_of_support_date) VALUES ($1, $2, 'business_critical', CURRENT_DATE + 30) RETURNING id`,
    [tenantId, `ERP ${tag}`]);
  const erpProd = await instanceOf(runner, tenantId, erp);
  await assign(runner, tenantId, erpProd, cluster);
  const directory = await one(runner, `INSERT INTO applications (tenant_id, name) VALUES ($1, $2) RETURNING id`, [tenantId, `Directory ${tag}`]);
  await assign(runner, tenantId, await instanceOf(runner, tenantId, directory), cluster, 'domain-controller');

  for (const [id, score, severity] of [[CVE_MEMBER, 9.8, 'critical'], [CVE_RETIRED, 8.1, 'high']] as const) {
    await runner.query(
      `INSERT INTO vulnerability_cves (cve_id, summary, cvss_score, severity, published_at, cisa_kev)
       VALUES ($1, 'Spec flaw', $2, $3, now() - interval '2 days', false) ON CONFLICT (cve_id) DO NOTHING`,
      [id, score, severity]);
  }
  const pg = await technology(runner, tenantId, 1, `PostgreSQL ${tag}`, 'database');
  const v16 = await version(runner, tenantId, pg, '16');
  const redis = await technology(runner, tenantId, 2, `Redis ${tag}`, 'database');
  const finding = (technologyId: string, versionId: string | null, cve: string) => runner.query(
    `INSERT INTO technology_vulnerabilities (tenant_id, technology_id, technology_version_id, cve_id, match_basis, state, detected_at)
     VALUES ($1, $2, $3, $4, $5, 'to_review', now() - interval '1 hour')`,
    [tenantId, technologyId, versionId, cve, versionId ? 'version_in_range' : 'version_unknown']);
  await finding(pg, v16, CVE_MEMBER);
  await finding(redis, null, CVE_RETIRED);
  await runner.query(`INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id, source) VALUES ($1, $2, $3, $4, 'manual')`, [tenantId, m1, pg, v16]);
  await runner.query(`INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id, source) VALUES ($1, $2, $3, NULL, 'manual')`, [tenantId, m3, redis]);

  return { tenantId, cloud, room, cluster, m1, m2, m3, erp, directory, pg, redis };
}

function contracts(runner: QueryRunner): ContractsService {
  const audit = captureAudit();
  const settings = new CurrencySettingsService(runner.manager.getRepository(Tenant), audit as any);
  const fx = new FxRateService(runner.manager.getRepository(CurrencyRateSet), settings);
  const args: any[] = Array.from({ length: 10 }, () => undefined);
  args[4] = audit;
  args[9] = fx;
  return new (ContractsService as any)(...args);
}

function assistant(): AiEntityService {
  return new AiEntityService(
    { getKnowledgeContextForEntity: async () => ({ access: 'granted', total: 0, groups: [] }) } as any,
    {
      listReadableEntityTypes: async (_context: unknown, requested: string[]) => requested,
      canReadKnowledge: async () => true,
      canReadEntityType: async () => true,
      assertEntityTypeReadAccess: async () => undefined,
    } as any,
  );
}

const ids = (rows: Array<{ id: string }>) => rows.map((row) => row.id).sort();

async function testVulnerabilities(runner: QueryRunner, s: Seed, u: Seed) {
  const links: Array<{ technology_id: string }> = await runner.query(
    `SELECT DISTINCT l.technology_id FROM (${applicationLinksSql({ tenant: '$1', ids: '$2' })}) l`, [s.tenantId, [s.erp]]);
  assert.deepEqual(links.map((l) => l.technology_id), [s.pg], 'the links of the members in service, not of the retired one');
  const [counts] = await runner.query(`SELECT * FROM (${applicationCountsSql({ tenant: '$1', ids: '$2' })}) c`, [s.tenantId, [s.erp]]);
  assert.equal(counts.open, 1, 'the vulnerability of a member counts for the application on its cluster');
  assert.equal(counts.critical, 1);
  assert.deepEqual(
    await runner.query(`SELECT 1 FROM (${applicationLinksSql({ tenant: '$1', ids: '$2' })}) l`, [s.tenantId, [u.erp]]),
    [], 'nothing of the neighbouring tenant');
}

async function testEndOfSupport(runner: QueryRunner, s: Seed) {
  const itOps = { getSettings: async () => ({ serverKinds: [{ code: 'vm', is_physical: false }], hostingTypes: DEFAULT_HOSTING_TYPES }) };
  const svc = new EndOfSupportService(new TechnologyReachService(), itOps as any);
  const opts = { manager: runner.manager, tenantId: s.tenantId };
  const report = await svc.deadlines({}, opts, { scope: undefined } as any);
  const row = report.items.find((item) => item.key === `application:${s.erp}`);
  assert.ok(row, 'the application deadline');
  assert.deepEqual(row!.servers.map((server) => server.id).sort(), [s.cluster, s.m1, s.m2].sort(), 'its servers: the cluster and its members in service');
  const gaps = await svc.gaps(opts, { scope: undefined } as any);
  assert.ok(!gaps.items.some((gap) => gap.gap === 'application_without_server' && gap.subject_id === s.erp), 'an application on a cluster has servers');
}

async function testHostingType(runner: QueryRunner, s: Seed) {
  const svc = new ApplicationsListService(runner.manager.getRepository(Application));
  const opts = { manager: runner.manager, tenantId: s.tenantId };
  const page = await svc.list({ include: 'hosting', limit: 50 }, opts);
  const erp = page.items.find((item: any) => item.id === s.erp) as any;
  assert.deepEqual(erp?.hosting_types, ['saas'], 'the cluster has no site: its members give the type, the retired member none');
  const filtered = await svc.list({ limit: 50, filters: JSON.stringify({ hosting_types: { filterType: 'set', values: ['saas'] } }) }, opts);
  assert.deepEqual(filtered.items.map((item: any) => item.id).sort(), [s.directory, s.erp].sort(), 'the hosting filter');
  const onPrem = await svc.list({ limit: 50, filters: JSON.stringify({ hosting_types: { filterType: 'set', values: ['on_prem'] } }) }, opts);
  assert.deepEqual(onPrem.items, [], 'the retired member gives nothing');
  const values = await svc.listFilterValues({ fields: 'hosting_types' }, opts);
  assert.deepEqual(values.hosting_types, ['saas'], 'the filter values');
  const map = await svc.mapSummary(s.erp, opts);
  assert.deepEqual(map.assigned_servers.map((server: any) => [server.id, server.inherited, server.via_clusters.map((via: any) => via.id)]).sort(), [
    [s.cluster, false, []],
    [s.m1, true, [s.cluster]],
    [s.m2, true, [s.cluster]],
  ].sort(), 'the interface map: the cluster and its members, the inherited ones marked');
  assert.deepEqual(map.assigned_servers.filter((server: any) => server.is_cluster).map((server: any) => server.id), [s.cluster], 'only the cluster is marked as one');
}

async function testAdministration(runner: QueryRunner, s: Seed) {
  const settings = { adminZones: ZONES, domains: [], technologyFamilies: DEFAULT_TECHNOLOGY_FAMILIES, serverKinds: [] };
  const svc = new AdministrationViewService({ getSettings: async () => settings } as any, new AuditService({} as any));
  const opts = { manager: runner.manager, tenantId: s.tenantId };
  const filtered = async (key: string) => ids((await svc.assets({ filters: JSON.stringify({ control: { filterType: 'set', values: [key] } }), limit: 50 }, opts)).items);
  assert.deepEqual(await filtered('domain_controllers_outside'), [s.m2], 'the role on the cluster: its Tier 1 member is raised, as if assigned directly');
  assert.deepEqual(await filtered('applications_on_most_sensitive'), [s.cluster, s.m1].sort(), 'the applications on the cluster count on its Tier 0 member');
  const summary = await svc.summary(opts);
  assert.equal(summary.controls.find((control) => control.key === 'domain_controllers_outside')?.count, 1);
  const tier0 = summary.zones.find((zone: any) => zone.code === 'tier_0') as any;
  assert.equal(tier0?.hosted_application_count, 2, 'the zone summary counts the applications its members run');
  const m2 = (await svc.assets({ limit: 50 }, opts)).items.find((row) => row.id === s.m2)!;
  assert.deepEqual(m2.applications.items.map((app) => app.name).sort(), [`Directory b2`, `ERP b2`], 'an asset row names what its cluster runs');
}

async function testLocations(runner: QueryRunner, s: Seed) {
  const ctx = { access: { assets: true, applications: true } } as any;
  const cloud = await readLocationRelations(runner.manager, s.cloud, ctx);
  assert.deepEqual(ids(cloud.applications!), [s.directory, s.erp].sort(), 'a member\'s site lists the applications of its cluster');
  const room = await readLocationRelations(runner.manager, s.room, ctx);
  assert.deepEqual(room.applications, [], 'the retired member\'s site lists nothing');
}

async function testContracts(runner: QueryRunner, s: Seed) {
  const svc = contracts(runner);
  const company = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'B2 company', 'FR', 'Lyon') RETURNING id`, [s.tenantId]);
  const supplier = await one(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'B2 supplier') RETURNING id`, [s.tenantId]);
  const contract = (name: string) => one(runner,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, DATE '2026-01-01') RETURNING id`,
    [s.tenantId, name, company, supplier]);
  const onMember = await contract('Member support');
  await runner.query(`INSERT INTO asset_contracts (tenant_id, asset_id, contract_id) VALUES ($1, $2, $3)`, [s.tenantId, s.m1, onMember]);
  const view = await svc.compliance(onMember, { manager: runner.manager });
  const exit = view.requirements.find((item) => item.requirement === 'exit_plan')!;
  assert.deepEqual(exit.reasons.map((r) => [r.rule, r.application.name, r.asset?.name]), [['business_criticality', 'ERP b2', 'M1 b2']],
    'a contract on a member covers the application on its cluster');
  const ofErp = await contract('ERP licence');
  await runner.query(`INSERT INTO application_contracts (tenant_id, application_id, contract_id) VALUES ($1, $2, $3)`, [s.tenantId, s.erp, ofErp]);
  const location = (await svc.compliance(ofErp, { manager: runner.manager })).requirements.find((item) => item.requirement === 'data_location')!;
  assert.deepEqual(location.reasons.map((r) => [r.rule, r.level?.code]), [['cloud_hosting', 'saas']], 'the cloud hosting of the members');
}

async function testContexts(runner: QueryRunner, s: Seed, u: Seed) {
  const svc = assistant();
  const context = { tenantId: s.tenantId, userId: randomUUID(), isPlatformHost: false, surface: 'chat' as const, authMethod: 'jwt' as const, manager: runner.manager };
  const app = await svc.getEntityContext(context, { entity_type: 'applications', entity_id: s.erp });
  const assets = app.related.find((group) => group.relation === 'linked_assets')!;
  assert.deepEqual(assets.items.map((item) => item.id).sort(), [s.cluster, s.m1, s.m2].sort(),
    'the assistant: the servers of the application, the retired member left out');
  const node = await svc.getEntityContext(context, { entity_type: 'assets', entity_id: s.m1 });
  const apps = node.related.find((group) => group.relation === 'linked_applications');
  assert.ok(apps?.items.some((item) => item.id === s.erp), 'the assistant: a member runs the application of its cluster');
  const retired = await svc.getEntityContext(context, { entity_type: 'assets', entity_id: s.m3 });
  assert.ok(!retired.related.some((group) => group.items.some((item) => item.id === s.erp)), 'a retired member inherits nothing');
  await assert.rejects(svc.getEntityContext(context, { entity_type: 'applications', entity_id: u.erp }), 'the neighbouring tenant is out of reach');

  const knowledge = Object.create(KnowledgeService.prototype) as any;
  const appGroups = await knowledge.getApplicationKnowledgeContextGroupDefinitions(s.erp, runner.manager);
  const appAssets = appGroups.flatMap((group: any) => group.sources).filter((source: any) => source.entity_type === 'assets').map((source: any) => source.entity_id);
  assert.ok([s.cluster, s.m1, s.m2].every((id) => appAssets.includes(id)), 'knowledge: the servers of the application');
  const assetGroups = await knowledge.getAssetKnowledgeContextGroupDefinitions(s.m2, runner.manager);
  const assetApps = assetGroups.flatMap((group: any) => group.sources).filter((source: any) => source.entity_type === 'applications').map((source: any) => source.entity_id);
  assert.ok(assetApps.includes(s.erp), 'knowledge: a member runs the application of its cluster');
}

async function testReaders() {
  await inRolledBackTransaction(async (runner) => {
    const u = await seed(runner, 'b2u');
    const s = await seed(runner, 'b2');
    await setTenant(runner, s.tenantId);
    await testVulnerabilities(runner, s, u);
    await testEndOfSupport(runner, s);
    await testHostingType(runner, s);
    await testAdministration(runner, s);
    await testLocations(runner, s);
    await testContracts(runner, s);
    await testContexts(runner, s, u);
  });
}

void runSpecs('effective assignment readers', [['the reports and reads take the members of a cluster', testReaders]]);
