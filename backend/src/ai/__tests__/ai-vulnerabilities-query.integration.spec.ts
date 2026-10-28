import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Vulnerabilities in the assistant's and the MCP server's read tools (plan "vulnérabilités dans
// les actifs et les applications", lot 5a): query_entities, aggregate_entities,
// get_filter_values and get_entity_detail on the `vulnerabilities` family.
//
// - One item per technology_vulnerabilities row, with the page's effective severity, score and
//   score source, exploitation, EPSS, state, technology reference, version, sources and alert.
// - servers_reached and applications_reached count direct links only: a VM inside a host that
//   carries the technology is not counted, nor an application hosted on that VM.
// - The asset and application filters keep the rows in those direct links; an unknown asset, or
//   an application unknown or outside the caller's scope, matches nothing.
// - applications_reached and the application filter stay in the caller's read scope (a Business
//   Contributor's own applications; null and nothing without the applications right).
// - Without the infrastructure right: refused. Feed off: refused, and left out of the readable
//   families. Another tenant's rows are never listed, counted or read.
// - Without a state or alerts filter, the list and the aggregates keep the page's default rows
//   (to review, alerting); `all` on either lifts it. The detail keeps every row.
// - The family is listable without the search index: not among the search families.
// - Lot 5b: open_vulnerabilities and severe_vulnerabilities on assets and applications (the counts
//   of the lists' Vulnerabilities column, direct links only, null retired or out of service or with
//   the feed off), in the list, the detail and the aggregate metrics; the `vulnerabilities` filter
//   and sort of the lists' column (severe, any, none);
//   readable with the applications right alone. And the question "which critical applications are
//   touched by an exploited CVE?" replayed with the tools as the model calls them.
// The AI surface checks (tenant settings, provider) are not under test: stubbed open.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-vulnerabilities-query-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

/** Every state and alert setting: lifts the page's default. */
const EVERY_ROW = { state: ['all'], alerts: ['all'] };

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type Harness = { app: any; dataSource: DataSource; executor: any; aggregates: any; tools: any; policy: any; features: any };

type Seed = {
  tenantId: string;
  users: Record<'admin' | 'full' | 'bc' | 'appsOnly' | 'infraOnly', string>;
  assets: Record<'srvA' | 'srvB' | 'srvOld' | 'hostH' | 'vmV', { id: string; ref: string }>;
  cve: Record<'c1' | 'c2' | 'c3' | 'c4', string>;
  rows: Record<'r1' | 'r2' | 'r3' | 'r4' | 'r5', string>;
  apps: Record<'billing' | 'payroll' | 'legacy' | 'portal', string>;
  otherRow: string;
};

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-vulnerabilities-query.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const { AiPolicyService } = require('../ai-policy.service');
  const { Features } = require('../../config/features');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  // The surface checks (tenant AI settings, provider, subscription) are not what this spec tests.
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  return {
    app,
    dataSource: app.get(DataSource),
    executor: app.get(AiQueryExecutor),
    aggregates: app.get(AiAggregateExecutor),
    tools: app.get(AiToolRegistry),
    policy: app.get(AiPolicyService),
    features: Features,
  };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function useTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function seedTenantRow(runner: QueryRunner, tenantId: string, slug: string) {
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, slug, slug],
  );
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  const digits = `${tag.replace(/\D/g, '')}00000`.slice(0, 5);
  const cve = { c1: `CVE-2097-${digits}1`, c2: `CVE-2097-${digits}2`, c3: `CVE-2097-${digits}3`, c4: `CVE-2097-${digits}4` };
  await seedTenantRow(runner, tenantId, `ai-vuln-${tag}`);
  await seedTenantRow(runner, otherTenantId, `ai-vuln-other-${tag}`);

  // The CVE cache is shared by every tenant.
  await runner.query(
    `INSERT INTO vulnerability_cves (cve_id, summary, cvss_score, severity, nvd_status, published_at, cisa_kev, epss)
     VALUES ($1, 'Remote code execution in the server', 9.8, 'critical', 'Analyzed', '2024-03-01T10:00:00Z', true, 0.9),
            ($2, '', NULL, NULL, NULL, '2024-05-10T10:00:00Z', NULL, NULL),
            ($3, 'Denial of service', 5.0, 'medium', 'Analyzed', '2023-01-15T10:00:00Z', false, 0.01),
            ($4, 'Information disclosure', 2.0, 'low', 'Analyzed', '2022-07-01T10:00:00Z', false, NULL)`,
    [cve.c1, cve.c2, cve.c3, cve.c4],
  );
  // c2: known by CVE.org only, which scores it and gives its summary.
  await runner.query(
    `INSERT INTO vulnerability_cve_records (cve_id, state, summary, cvss_score, severity) VALUES ($1, 'published', 'Hypervisor escape', 7.5, 'high')`,
    [cve.c2],
  );

  // The other tenant: the same CVE on its own technology, never seen from the first one.
  await useTenant(runner, otherTenantId);
  const otherTechnology = await insertId(runner, `INSERT INTO technologies (tenant_id, name, item_number) VALUES ($1, 'PostgreSQL', 1)`, [otherTenantId]);
  const otherRow = await insertId(runner,
    `INSERT INTO technology_vulnerabilities (tenant_id, technology_id, cve_id, match_basis) VALUES ($1, $2, $3, 'version_unknown')`,
    [otherTenantId, otherTechnology, cve.c1]);

  await useTenant(runner, tenantId);
  const role = async (name: string, permissions: string[]) => {
    const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, name]);
    for (const resource of permissions) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, 'reader')`, [tenantId, id, resource]);
    }
    return id;
  };
  const user = async (key: string, roleId: string) => insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Tester', $4, 'enabled')`,
    [tenantId, `${key}-${tag}@example.test`, key, roleId]);
  const users = {
    admin: await user('Admin', await role('Administrator', [])),
    full: await user('Full', await role('Infra and apps', ['infrastructure', 'applications'])),
    bc: await user('Contributor', await role('Business Contributor', ['infrastructure', 'applications'])),
    appsOnly: await user('AppsOnly', await role('Apps only', ['applications'])),
    infraOnly: await user('InfraOnly', await role('Infra only', ['infrastructure'])),
  };

  const asset = async (name: string, status = 'active') => {
    const [row] = await runner.query(
      `INSERT INTO assets (tenant_id, name, kind, environment, status) VALUES ($1, $2, 'server', 'prod', $3) RETURNING id, asset_reference`,
      [tenantId, name, status]);
    return { id: row.id as string, ref: row.asset_reference as string };
  };
  const assets = { srvA: await asset('srv-a'), srvB: await asset('srv-b'), srvOld: await asset('srv-old', 'retired'), hostH: await asset('host-h'), vmV: await asset('vm-v') };
  await runner.query(`INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type) VALUES ($1, $2, $3, 'contains')`,
    [tenantId, assets.hostH.id, assets.vmV.id]);

  const technology = (n: number, name: string, family: string, alerts = true) => insertId(runner,
    `INSERT INTO technologies (tenant_id, item_number, name, family, vulnerability_alerts) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, n, name, family, alerts]);
  const tech = {
    pg: await technology(1, 'PostgreSQL', 'database'),
    esxi: await technology(2, 'VMware ESXi', 'virtualization'),
    win: await technology(3, 'Windows Server', 'operating_system', false),
  };
  const version = (technologyId: string, label: string) => insertId(runner,
    `INSERT INTO technology_versions (tenant_id, technology_id, label) VALUES ($1, $2, $3)`, [tenantId, technologyId, label]);
  const pg15 = await version(tech.pg, '15');
  const pg12 = await version(tech.pg, '12');
  const esxi8 = await version(tech.esxi, '8');
  const win2019 = await version(tech.win, '2019');
  const install = (assetId: string, technologyId: string, versionId: string | null) => runner.query(
    `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id) VALUES ($1, $2, $3, $4)`,
    [tenantId, assetId, technologyId, versionId]);
  await install(assets.srvA.id, tech.pg, pg15);
  await install(assets.srvOld.id, tech.pg, pg12);
  await install(assets.hostH.id, tech.esxi, esxi8);
  await install(assets.srvA.id, tech.win, win2019);
  await install(assets.srvB.id, tech.win, win2019);

  const application = (n: number, name: string, status = 'enabled', criticality: string | null = null) => insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, status, criticality) VALUES ($1, $2, $3, $4, $5)`, [tenantId, name, `APP-${n}`, status, criticality]);
  const apps = {
    billing: await application(1, 'Billing', 'enabled', 'high'),
    payroll: await application(2, 'Payroll', 'enabled', 'business_critical'),
    legacy: await application(3, 'Legacy', 'disabled', 'business_critical'),
    // Critical, with no technology: touched by nothing.
    portal: await application(4, 'Portal', 'enabled', 'business_critical'),
  };
  await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
    [tenantId, apps.billing, users.bc]);
  const declare = (applicationId: string, technologyId: string, versionId: string | null) => runner.query(
    `INSERT INTO application_technologies (tenant_id, application_id, technology_id, technology_version_id) VALUES ($1, $2, $3, $4)`,
    [tenantId, applicationId, technologyId, versionId]);
  await declare(apps.billing, tech.pg, null);
  await declare(apps.payroll, tech.pg, pg15);
  await declare(apps.legacy, tech.pg, pg12);
  const host = async (applicationId: string, assetId: string) => {
    const instance = await insertId(runner, `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod')`, [tenantId, applicationId]);
    await runner.query(`INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'app')`, [tenantId, instance, assetId]);
  };
  // Billing runs on the VM, inside the host that carries ESXi: not reached by ESXi's CVE.
  await host(apps.billing, assets.vmV.id);
  await host(apps.payroll, assets.hostH.id);

  const row = (technologyId: string, versionId: string | null, cveId: string, extra: { state?: string; note?: string; sources?: string[] } = {}) => insertId(runner,
    `INSERT INTO technology_vulnerabilities (tenant_id, technology_id, technology_version_id, cve_id, match_basis, state, note, match_sources)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::text[])`,
    [tenantId, technologyId, versionId, cveId, versionId ? 'version_in_range' : 'version_unknown', extra.state ?? 'to_review', extra.note ?? null, extra.sources ?? ['nvd']]);
  const rows = {
    r1: await row(tech.pg, pg15, cve.c1),
    r2: await row(tech.esxi, esxi8, cve.c2, { sources: ['cve_org'] }),
    r3: await row(tech.pg, pg12, cve.c3, { state: 'handled', note: 'Patched in March' }),
    r4: await row(tech.win, win2019, cve.c4, { sources: ['cve_org', 'nvd'] }),
    r5: await row(tech.pg, null, cve.c1),
  };
  return { tenantId, users, assets, cve, rows, otherRow, apps };
}

function ctx(runner: QueryRunner, s: Seed, user: keyof Seed['users']) {
  return {
    tenantId: s.tenantId,
    userId: s.users[user],
    isPlatformHost: false,
    surface: 'mcp' as const,
    authMethod: 'api_key' as const,
    manager: runner.manager,
  };
}

async function list(harness: Harness, runner: QueryRunner, s: Seed, input: Record<string, unknown>, user: keyof Seed['users'] = 'full') {
  const result = await harness.executor.execute(ctx(runner, s, user), { entity_type: 'vulnerabilities', ...input });
  assert.equal(result.status, undefined, `${JSON.stringify(input)}: ${JSON.stringify(result.filters_ignored)}`);
  assert.deepEqual(result.sort_ignored, [], `${JSON.stringify(input)}: sort applied`);
  return result;
}

/** The items as `row key`, in order. */
function keys(s: Seed, result: any): string[] {
  const byId = new Map(Object.entries(s.rows).map(([key, id]) => [id, key]));
  return result.items.map((item: any) => byId.get(item.id) ?? `?${item.id}`);
}

/** Refused or not found, in a savepoint so a failed statement does not end the transaction. */
async function rejects(runner: QueryRunner, fn: () => Promise<unknown>, pattern: RegExp, label: string) {
  await runner.query('SAVEPOINT expected_failure');
  try {
    await fn();
    assert.fail(`${label}: should fail`);
  } catch (error: any) {
    if (error?.code === 'ERR_ASSERTION') throw error;
    const text = `${String(error?.message ?? error)} ${JSON.stringify(error?.response ?? '')}`;
    assert.match(text, pattern, label);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}

async function testList(harness: Harness, runner: QueryRunner, s: Seed) {
  const byDefault = await list(harness, runner, s, {});
  assert.deepEqual(keys(s, byDefault), ['r1', 'r5', 'r2'], 'the page\'s default: to review and alerting (not r3 handled, not r4 quiet)');
  assert.equal(byDefault.total, 3);
  assert.deepEqual(keys(s, await list(harness, runner, s, { filters: { state: ['all'] } })), ['r1', 'r5', 'r2', 'r3'], 'every state, alerting');
  assert.deepEqual(keys(s, await list(harness, runner, s, { filters: { alerts: ['all'] } })), ['r1', 'r5', 'r2', 'r4'], 'to review, every alert setting');
  const all = await list(harness, runner, s, { filters: EVERY_ROW });
  assert.equal(all.total, 5, 'the tenant\'s rows only, every state and alert setting');
  assert.deepEqual(keys(s, all), ['r1', 'r5', 'r2', 'r3', 'r4'], 'exploited first, then the most severe');
  const r1 = all.items[0];
  assert.equal(r1.type, 'vulnerabilities');
  assert.equal(r1.ref, s.cve.c1);
  assert.equal(r1.label, s.cve.c1);
  assert.equal(r1.status, 'to_review');
  assert.equal(r1.summary, 'Remote code execution in the server');
  assert.deepEqual(
    [r1.metadata.severity, r1.metadata.cvss_score, r1.metadata.score_source, r1.metadata.exploited, r1.metadata.epss],
    ['critical', 9.8, 'nvd', true, 0.9],
  );
  assert.deepEqual([r1.metadata.technology, r1.metadata.technology_name, r1.metadata.version], ['TEC-1', 'PostgreSQL', '15']);
  assert.deepEqual([r1.metadata.sources, r1.metadata.alerts, r1.metadata.published_at], ['nvd', true, '2024-03-01']);
  assert.equal(r1.metadata.servers_reached, 1, 'srv-a; the retired server is not counted');
  assert.equal(r1.metadata.applications_reached, 1, 'Payroll declares version 15; Billing declares no version');
  assert.equal(r1.metadata.page_url, `/it/vulnerabilities?q=${s.cve.c1}&technology=TEC-1&version=15&state=all&alerts=all`);

  const byKey = new Map(keys(s, all).map((key, i) => [key, all.items[i]]));
  const r2 = byKey.get('r2');
  assert.deepEqual([r2.metadata.severity, r2.metadata.cvss_score, r2.metadata.score_source, r2.summary], ['high', 7.5, 'cve_org', 'Hypervisor escape'],
    'scored by CVE.org only: its severity, score and summary');
  assert.equal(r2.metadata.servers_reached, 1, 'the host carries ESXi; the VM inside it is not counted (direct links only)');
  assert.equal(r2.metadata.applications_reached, 1, 'Payroll on the host; Billing on the VM is not counted');
  const r3 = byKey.get('r3');
  assert.deepEqual([r3.status, r3.metadata.note, r3.metadata.servers_reached, r3.metadata.applications_reached], ['handled', 'Patched in March', 0, 0],
    'version 12 runs only on a retired server and a disabled application');
  const r4 = byKey.get('r4');
  assert.deepEqual([r4.metadata.alerts, r4.metadata.servers_reached, r4.metadata.sources], [false, 2, 'cve_org, nvd']);
  const r5 = byKey.get('r5');
  assert.deepEqual([r5.metadata.version, r5.metadata.servers_reached, r5.metadata.applications_reached], [null, 0, 1],
    'no version: no server has PostgreSQL without a version; Billing declares it');
  assert.match(r5.metadata.page_url, /version=none/);
  assert.doesNotMatch(JSON.stringify(all.items.map((item: any) => ({ ...item, id: undefined }))), UUID_IN_TEXT, 'no id besides the item\'s own');
}

async function testFilters(harness: Harness, runner: QueryRunner, s: Seed) {
  const cases: Array<[Record<string, unknown>, string[]]> = [
    [{ severity: ['critical'] }, ['r1', 'r5']],
    [{ severity: ['high', 'low'] }, ['r2', 'r4']],
    [{ state: ['handled'] }, ['r3']],
    [{ exploited: ['true'] }, ['r1', 'r5']],
    [{ exploited: ['false'] }, ['r2', 'r3', 'r4']],
    [{ technology: ['TEC-2'] }, ['r2']],
    [{ technology: ['postgresql'] }, ['r1', 'r5', 'r3']],
    [{ version: [null] }, ['r5']],
    [{ version: ['15', '12'] }, ['r1', 'r3']],
    [{ alerts: ['false'] }, ['r4']],
    [{ sources: ['cve_org'] }, ['r2', 'r4']],
    [{ score_source: ['cve_org'] }, ['r2']],
    [{ cve_id: s.cve.c3.toLowerCase() }, ['r3']],
    [{ summary: 'hypervisor' }, ['r2']],
    [{ note: 'march' }, ['r3']],
    [{ cvss_score: { op: 'gte', value: 7 } }, ['r1', 'r5', 'r2']],
    [{ epss: { op: 'gt', value: 0.5 } }, ['r1', 'r5']],
    [{ servers_reached: { op: 'gte', value: 1 } }, ['r1', 'r2', 'r4']],
    [{ applications_reached: { op: 'gt', value: 0 } }, ['r1', 'r5', 'r2']],
    [{ published_at: { op: 'before', value: '2024-01-01' } }, ['r3', 'r4']],
    [{ detected_at: { op: 'after', value: '2000-01-01' } }, ['r1', 'r5', 'r2', 'r3', 'r4']],
    // Direct links only, as the page.
    [{ asset: [s.assets.srvA.ref] }, ['r1', 'r4']],
    [{ asset: [s.assets.hostH.id] }, ['r2']],
    [{ asset: [s.assets.vmV.ref] }, []],
    [{ asset: [s.assets.srvOld.ref] }, []],
    [{ asset: ['AST-99999'] }, []],
    [{ application: ['APP-1'] }, ['r5']],
    [{ application: ['app-2'] }, ['r1', 'r2']],
    [{ application: ['APP-3'] }, []],
    [{ application: ['APP-99'] }, []],
    [{ severity: ['critical'], application: ['APP-2'] }, ['r1']],
  ];
  for (const [own, expected] of cases) {
    const filters = { ...EVERY_ROW, ...own };
    const result = await list(harness, runner, s, { filters });
    assert.deepEqual(result.filters_applied.sort(), Object.keys(filters).sort(), `${JSON.stringify(filters)}: applied`);
    assert.deepEqual(keys(s, result), expected, JSON.stringify(filters));
  }
  assert.deepEqual(keys(s, await list(harness, runner, s, { q: 'hypervisor' })), ['r2'], 'quick search on the summary');
  assert.deepEqual(keys(s, await list(harness, runner, s, { q: 'TEC-3', filters: EVERY_ROW })), ['r4'], 'quick search on the technology reference');
  assert.deepEqual(keys(s, await list(harness, runner, s, { q: 'TEC-3' })), [], 'r4 does not alert: out of the default');
  assert.deepEqual(keys(s, await list(harness, runner, s, { filters: { state: ['handled'] } })), ['r3'], 'a state filter replaces the state default; r3 alerts');
  assert.deepEqual(keys(s, await list(harness, runner, s, { filters: { alerts: ['false'] } })), ['r4'], 'an alerts filter replaces the alert default; r4 is to review');

  // A Business Contributor's application scope.
  assert.deepEqual(keys(s, await list(harness, runner, s, { filters: { application: ['APP-2'] } }, 'bc')), [], 'Payroll is out of its scope');
  assert.deepEqual(keys(s, await list(harness, runner, s, { filters: { application: ['APP-1'] } }, 'bc')), ['r5']);
  const bc = await list(harness, runner, s, { filters: EVERY_ROW }, 'bc');
  assert.deepEqual(bc.items.map((item: any) => item.metadata.applications_reached), [0, 1, 0, 0, 0], 'its own applications only');
  // Without the applications right.
  const infra = await list(harness, runner, s, { filters: EVERY_ROW }, 'infraOnly');
  assert.ok(infra.items.every((item: any) => item.metadata.applications_reached === null), 'null without the applications right, never 0');
  assert.equal((await list(harness, runner, s, { filters: { application: ['APP-1'] } }, 'infraOnly')).total, 0, 'nothing to match');
  assert.equal((await list(harness, runner, s, { filters: { applications_reached: { op: 'gte', value: 0 } } }, 'infraOnly')).total, 0);

  const unknown = await harness.executor.execute(ctx(runner, s, 'full'), { entity_type: 'vulnerabilities', filters: { kev: ['true'] } });
  assert.equal(unknown.status, 'invalid_filter', 'an unknown field is never dropped silently');
}

async function testSorts(harness: Harness, runner: QueryRunner, s: Seed) {
  const order = async (field: string, direction: 'asc' | 'desc') => keys(s, await list(harness, runner, s, { sort: { field, direction }, filters: EVERY_ROW }));
  assert.deepEqual(await order('severity', 'asc'), ['r4', 'r3', 'r2', 'r1', 'r5']);
  assert.deepEqual((await order('servers_reached', 'desc'))[0], 'r4');
  assert.deepEqual(await order('published_at', 'asc'), ['r4', 'r3', 'r1', 'r5', 'r2']);
  assert.deepEqual((await order('technology', 'asc')).slice(0, 3), ['r1', 'r5', 'r3'], 'PostgreSQL first');
  for (const field of ['cve_id', 'cvss_score', 'epss', 'exploited', 'state', 'detected_at', 'applications_reached', 'created_at', 'updated_at', 'label']) {
    assert.equal((await order(field, 'asc')).length, 5, `${field}: sorts`);
  }
  const page = await list(harness, runner, s, { limit: 2, page: 3, filters: EVERY_ROW });
  assert.deepEqual(keys(s, page), ['r4'], 'third page');
  assert.equal(page.total, 5);
}

async function testAggregatesAndFilterValues(harness: Harness, runner: QueryRunner, s: Seed) {
  const aggregate = (input: Record<string, unknown>, user: keyof Seed['users'] = 'full') =>
    harness.aggregates.execute(ctx(runner, s, user), { entity_type: 'vulnerabilities', ...input });
  const bySeverity = await aggregate({ group_by: 'severity', filters: EVERY_ROW });
  assert.equal(bySeverity.total, 5);
  assert.deepEqual(bySeverity.groups.map((g: any) => [g.key, g.count]).sort(), [['critical', 2], ['high', 1], ['low', 1], ['medium', 1]]);
  const byDefault = await aggregate({ group_by: 'severity' });
  assert.deepEqual(byDefault.groups.map((g: any) => [g.key, g.count]).sort(), [['critical', 2], ['high', 1]], 'the page\'s default applies to the aggregates');
  const handled = await aggregate({ group_by: 'state', filters: { state: ['handled', 'not_affected'], alerts: ['all'] } });
  assert.deepEqual(handled.groups.map((g: any) => [g.key, g.count]), [['handled', 1]], 'filters apply to the aggregates');
  const byTechnology = await aggregate({ group_by: 'technology', filters: { ...EVERY_ROW, asset: [s.assets.srvA.ref] } });
  assert.deepEqual(byTechnology.groups.map((g: any) => [g.key, g.count]).sort(), [['PostgreSQL', 1], ['Windows Server', 1]]);
  const servers = await aggregate({ group_by: 'state', metric: 'servers_reached', function: 'sum', filters: EVERY_ROW });
  assert.equal(servers.groups.find((g: any) => g.key === 'to_review').value, 4, 'srv-a, host-h, srv-a and srv-b by row');
  const latest = await aggregate({ group_by: 'exploited', metric: 'published_at', function: 'max', filters: EVERY_ROW });
  assert.equal(latest.groups.find((g: any) => g.key === 'false').value, '2024-05-10');
  const scored = await aggregate({ group_by: 'score_source', metric: 'cvss_score', function: 'max', filters: EVERY_ROW });
  assert.equal(scored.groups.find((g: any) => g.key === 'cve_org').value, 7.5);
  await rejects(runner, () => aggregate({ group_by: 'state', metric: 'applications_reached', function: 'sum' }), /Unsupported metric field/,
    'applications_reached is no metric: an aggregate expression cannot carry the read scope');
  const scoped = await aggregate({ group_by: 'severity', filters: { applications_reached: { op: 'gt', value: 0 } } }, 'bc');
  assert.deepEqual(scoped.groups, [{ key: 'critical', count: 1 }], 'an aggregate filter on applications_reached stays in scope');

  const values = await harness.executor.executeFilterValues(ctx(runner, s, 'full'), {
    entity_type: 'vulnerabilities', fields: ['technology', 'severity', 'state', 'servers_reached'],
  });
  assert.deepEqual(values.values.technology, ['PostgreSQL', 'VMware ESXi', 'Windows Server'], 'this tenant\'s technologies only');
  assert.deepEqual(values.values.state, ['to_review', 'handled', 'not_affected', 'all']);
  assert.deepEqual(values.fields_ignored, ['servers_reached'], 'a number has no value list');
}

async function testDetail(harness: Harness, runner: QueryRunner, s: Seed) {
  const detail = (entityId: string, user: keyof Seed['users'] = 'full') =>
    harness.executor.executeDetail(ctx(runner, s, user), { entity_type: 'vulnerabilities', entity_id: entityId });
  const byCve = await detail(s.cve.c1.toLowerCase());
  assert.equal(byCve.entity.id, s.rows.r1, 'the CVE\'s first row: version 15 before no version');
  assert.equal(byCve.data.cve_id, s.cve.c1);
  assert.deepEqual([byCve.data.cisa_kev, byCve.data.eu_kev, byCve.data.potential], [true, false, false]);
  assert.deepEqual(byCve.data.rows.map((r: any) => [r.technology, r.version, r.servers_reached, r.applications_reached]),
    [['TEC-1', '15', 1, 1], ['TEC-1', null, 0, 1]], 'every row of the CVE');
  assert.doesNotMatch(JSON.stringify(byCve.data), UUID_IN_TEXT, 'references and names only');
  const byRow = await detail(s.rows.r2);
  assert.deepEqual([byRow.entity.ref, byRow.data.severity, byRow.data.cvss_score, byRow.data.score_source, byRow.data.servers_reached],
    [s.cve.c2, 'high', 7.5, 'cve_org', 1]);
  const r5 = await detail(s.rows.r5);
  assert.equal(r5.data.potential, true, 'no version recorded: potentially concerned');
  await rejects(runner, () => detail('CVE-1999-0001'), /No vulnerabilities record matches/, 'a CVE with no row here');
  await rejects(runner, () => detail('PostgreSQL'), /No vulnerabilities record matches/, 'not a CVE id');
  const tool = await harness.tools.execute(ctx(runner, s, 'full'), 'get_entity_detail', { entity_type: 'vulnerabilities', entity_id: s.cve.c3 });
  assert.equal(tool.data.note, 'Patched in March', 'through the tool registry');
}

async function testInfrastructureRight(harness: Harness, runner: QueryRunner, s: Seed) {
  const call = (tool: string, input: Record<string, unknown>) => harness.tools.execute(ctx(runner, s, 'appsOnly'), tool, input);
  await rejects(runner, () => call('query_entities', { entity_type: 'vulnerabilities' }), /infrastructure/, 'query_entities');
  await rejects(runner, () => call('aggregate_entities', { entity_type: 'vulnerabilities', group_by: 'severity' }), /infrastructure/, 'aggregate_entities');
  await rejects(runner, () => call('get_filter_values', { entity_type: 'vulnerabilities', fields: ['state'] }), /infrastructure/, 'get_filter_values');
  await rejects(runner, () => call('describe_entity_filters', { entity_type: 'vulnerabilities' }), /infrastructure/, 'describe_entity_filters');
  await rejects(runner, () => call('get_entity_detail', { entity_type: 'vulnerabilities', entity_id: s.cve.c1 }), /infrastructure/, 'get_entity_detail');
  const readable = await harness.policy.listReadableEntityTypes(ctx(runner, s, 'appsOnly'), ['applications', 'vulnerabilities'], runner.manager);
  assert.deepEqual(readable, ['applications']);
  const ok = await harness.tools.execute(ctx(runner, s, 'infraOnly'), 'query_entities', { entity_type: 'vulnerabilities', filters: EVERY_ROW });
  assert.equal(ok.total, 5, 'the infrastructure right is enough');
}

async function testFeedOff(harness: Harness, runner: QueryRunner, s: Seed) {
  const previous = harness.features.VULNERABILITY_FEED_ENABLED;
  harness.features.VULNERABILITY_FEED_ENABLED = false;
  try {
    for (const [tool, input] of [
      ['query_entities', { entity_type: 'vulnerabilities' }],
      ['aggregate_entities', { entity_type: 'vulnerabilities', group_by: 'severity' }],
      ['get_filter_values', { entity_type: 'vulnerabilities', fields: ['state'] }],
      ['get_entity_detail', { entity_type: 'vulnerabilities', entity_id: s.cve.c1 }],
    ] as const) {
      await rejects(runner, () => harness.tools.execute(ctx(runner, s, 'admin'), tool, input), /vulnerabilityFeed is not available/, `${tool}, feed off`);
    }
    await rejects(runner, () => harness.executor.execute(ctx(runner, s, 'admin'), { entity_type: 'vulnerabilities' }), /vulnerabilityFeed/,
      'the list itself refuses, whatever the caller');
    const readable = await harness.policy.listReadableEntityTypes(ctx(runner, s, 'admin'), ['technologies', 'vulnerabilities'], runner.manager);
    assert.deepEqual(readable, ['technologies'], 'left out of the readable families');
    assert.equal(await harness.policy.canReadEntityType(ctx(runner, s, 'admin'), 'vulnerabilities', runner.manager), false);
  } finally {
    harness.features.VULNERABILITY_FEED_ENABLED = previous;
  }
}

async function testTenantIsolation(harness: Harness, runner: QueryRunner, s: Seed) {
  const c1 = await list(harness, runner, s, { filters: { cve_id: s.cve.c1 } }, 'admin');
  assert.deepEqual(keys(s, c1), ['r1', 'r5'], 'the other tenant\'s row of the same CVE is not listed');
  const counts = await harness.aggregates.execute(ctx(runner, s, 'admin'), { entity_type: 'vulnerabilities', group_by: 'severity' });
  assert.equal(counts.groups.find((g: any) => g.key === 'critical').count, 2, 'nor counted');
  await rejects(runner, () => harness.executor.executeDetail(ctx(runner, s, 'admin'), { entity_type: 'vulnerabilities', entity_id: s.otherRow }),
    /No vulnerabilities record matches/, 'nor read by id');
}

/** The items of an asset or application list as `label: open/severe`, in order. */
function counts(result: any): string[] {
  return result.items.map((item: any) => `${item.label}: ${item.metadata.open_vulnerabilities}/${item.metadata.severe_vulnerabilities}`);
}

async function testAssetAndApplicationCounts(harness: Harness, runner: QueryRunner, s: Seed) {
  const query = async (entity_type: string, input: Record<string, unknown>, user: keyof Seed['users'] = 'full') => {
    const result = await harness.executor.execute(ctx(runner, s, user), { entity_type, ...input });
    assert.equal(result.status, undefined, `${entity_type} ${JSON.stringify(input)}: ${JSON.stringify(result.filters_ignored)}`);
    assert.deepEqual(result.sort_ignored, [], `${entity_type} ${JSON.stringify(input)}: sort applied`);
    return result;
  };
  // Rows that count: r1 (PostgreSQL 15, c1), r2 (ESXi 8, c2), r5 (PostgreSQL, no version, c1).
  // r3 is handled, r4 does not alert: neither counts.
  const assets = await query('assets', { sort: { field: 'label', direction: 'asc' } });
  assert.deepEqual(counts(assets), ['host-h: 1/1', 'srv-a: 1/1', 'srv-b: 0/0', 'srv-old: null/null', 'vm-v: 0/0'],
    'direct links only: the VM inside the host counts nothing; a retired server counts null');
  const apps = await query('applications', { sort: { field: 'label', direction: 'asc' } });
  assert.deepEqual(counts(apps), ['Billing: 1/1', 'Legacy: null/null', 'Payroll: 2/2', 'Portal: 0/0'],
    'declared (Billing: PostgreSQL without version; Payroll: version 15) and hosted on a direct link (Payroll on the host); out of service: null');
  assert.deepEqual(counts(await query('applications', { sort: { field: 'label', direction: 'asc' } }, 'appsOnly')), counts(apps),
    'readable with the applications right alone');

  // The filter of the lists' column: severe, any, none.
  const labels = (result: any) => result.items.map((item: any) => item.label).sort();
  assert.deepEqual(labels(await query('assets', { filters: { vulnerabilities: ['severe'] } })), ['host-h', 'srv-a']);
  assert.deepEqual(labels(await query('assets', { filters: { vulnerabilities: ['none'] } })), ['srv-b', 'vm-v'], 'a retired server is in none of them');
  assert.deepEqual(labels(await query('applications', { filters: { vulnerabilities: ['any'] } })), ['Billing', 'Payroll']);
  assert.deepEqual(labels(await query('applications', { filters: { vulnerabilities: ['none'] } })), ['Portal'], 'out of service: in none of them');

  // Sort: severe, then open; out of service last either way.
  const bySevere = await query('applications', { sort: { field: 'vulnerabilities', direction: 'desc' } });
  assert.deepEqual(bySevere.items.map((item: any) => item.label), ['Payroll', 'Billing', 'Portal', 'Legacy']);
  const ascending = await query('assets', { sort: { field: 'vulnerabilities', direction: 'asc' } });
  assert.equal(ascending.items[ascending.items.length - 1].label, 'srv-old', 'retired last either way');

  // Detail.
  const detail = async (entity_type: string, entity_id: string, user: keyof Seed['users'] = 'full') =>
    harness.executor.executeDetail(ctx(runner, s, user), { entity_type, entity_id });
  const payroll = await detail('applications', 'APP-2', 'appsOnly');
  assert.deepEqual([payroll.data.open_vulnerabilities, payroll.data.severe_vulnerabilities], [2, 2]);
  assert.deepEqual([payroll.entity.metadata.open_vulnerabilities, payroll.entity.metadata.severe_vulnerabilities], [2, 2]);
  const legacy = await detail('applications', 'APP-3');
  assert.deepEqual([legacy.data.open_vulnerabilities, legacy.data.severe_vulnerabilities], [null, null]);
  const host = await detail('assets', s.assets.hostH.ref);
  assert.deepEqual([host.data.open_vulnerabilities, host.data.severe_vulnerabilities, host.entity.metadata.severe_vulnerabilities], [1, 1, 1]);

  // Aggregates: the filters and the metrics.
  const aggregate = (entity_type: string, input: Record<string, unknown>) =>
    harness.aggregates.execute(ctx(runner, s, 'full'), { entity_type, ...input });
  const touched = await aggregate('applications', { group_by: 'criticality', filters: { vulnerabilities: ['severe'] } });
  assert.deepEqual(touched.groups.map((g: any) => [g.key, g.count]).sort(), [['business_critical', 1], ['high', 1]]);
  const open = await aggregate('assets', { group_by: 'status', metric: 'open_vulnerabilities', function: 'sum' });
  assert.equal(open.groups.find((g: any) => g.key === 'active').value, 2, 'srv-a and host-h');
  const severe = await aggregate('applications', { group_by: 'status', metric: 'severe_vulnerabilities', function: 'max' });
  assert.equal(severe.groups.find((g: any) => g.key === 'enabled').value, 2);

  // Feed off: null everywhere, and a filter on the counts keeps nothing.
  const previous = harness.features.VULNERABILITY_FEED_ENABLED;
  harness.features.VULNERABILITY_FEED_ENABLED = false;
  try {
    const off = await query('applications', { sort: { field: 'label', direction: 'asc' } });
    assert.ok(off.items.every((item: any) => item.metadata.open_vulnerabilities === null && item.metadata.severe_vulnerabilities === null), 'null, never 0');
    assert.equal((await query('assets', { filters: { vulnerabilities: ['any'] } })).total, 0);
    assert.equal((await detail('assets', s.assets.srvA.ref)).data.open_vulnerabilities, null);
    const offSum = await aggregate('assets', { group_by: 'status', metric: 'open_vulnerabilities', function: 'sum' });
    assert.equal(offSum.groups.find((g: any) => g.key === 'active').value, null);
  } finally {
    harness.features.VULNERABILITY_FEED_ENABLED = previous;
  }
}

/**
 * "Which critical applications are touched by an exploited CVE?", as the model calls the tools: the
 * critical applications with a severe CVE, then that application's exploited CVE.
 */
async function testCriticalApplicationsQuestion(harness: Harness, runner: QueryRunner, s: Seed) {
  const call = (tool: string, input: Record<string, unknown>) => harness.tools.execute(ctx(runner, s, 'full'), tool, input);
  const critical = await call('query_entities', {
    entity_type: 'applications',
    filters: { criticality: ['business_critical'], vulnerabilities: ['severe'] },
    sort: { field: 'vulnerabilities', direction: 'desc' },
  });
  assert.deepEqual(critical.items.map((item: any) => item.ref), ['APP-2'], 'Payroll; Portal is touched by nothing, Legacy is out of service, Billing is not critical');
  const exploited = await call('query_entities', {
    entity_type: 'vulnerabilities',
    filters: { application: [critical.items[0].ref], exploited: ['true'] },
  });
  assert.deepEqual(exploited.items.map((item: any) => [item.ref, item.metadata.technology, item.metadata.version]), [[s.cve.c1, 'TEC-1', '15']],
    'c1 on PostgreSQL 15; c2 on the host is severe but not exploited');
}

async function testFamilies() {
  const { AI_QUERY_ENTITY_TYPES, AI_SEARCH_ENTITY_TYPES } = require('../ai.types');
  assert.ok(AI_QUERY_ENTITY_TYPES.includes('vulnerabilities'), 'listable and aggregatable');
  assert.ok(!AI_SEARCH_ENTITY_TYPES.includes('vulnerabilities'), 'not searched: no search index for it');
  // A family read without a search index is listed only: the technology versions and the two
  // End of support report lists have none either.
  const listedOnly = new Set(['vulnerabilities', 'technology_versions', 'support_gaps', 'support_deadlines']);
  assert.ok(AI_QUERY_ENTITY_TYPES.includes('technology_versions'), 'listable and aggregatable');
  assert.ok(AI_QUERY_ENTITY_TYPES.includes('support_gaps') && AI_QUERY_ENTITY_TYPES.includes('support_deadlines'), 'listable and aggregatable');
  assert.deepEqual(AI_QUERY_ENTITY_TYPES.filter((type: string) => !listedOnly.has(type)), [...AI_SEARCH_ENTITY_TYPES], 'every searched family is listable');
}

async function run() {
  const harness = await createHarness();
  const feed = harness.features.VULNERABILITY_FEED_ENABLED;
  harness.features.VULNERABILITY_FEED_ENABLED = true;
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testFamilies();
      await testList(harness, runner, s);
      await testFilters(harness, runner, s);
      await testSorts(harness, runner, s);
      await testAggregatesAndFilterValues(harness, runner, s);
      await testDetail(harness, runner, s);
      await testInfrastructureRight(harness, runner, s);
      await testFeedOff(harness, runner, s);
      await testTenantIsolation(harness, runner, s);
      await testAssetAndApplicationCounts(harness, runner, s);
      await testCriticalApplicationsQuestion(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    harness.features.VULNERABILITY_FEED_ENABLED = feed;
    await harness.app.close();
  }
  console.log('ai-vulnerabilities-query.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
