import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import * as express from 'express';
import { HttpException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Technologies in the assistant's and the MCP server's read tools (lot C2b of
// planning/cartographie-technologies): query_entities, aggregate_entities, get_filter_values,
// get_entity_detail and get_entity_context on the `technologies` family, and the technology
// sections of the asset and application contexts.
//
// - Every field filters and sorts: reference, name, family, publisher, hosting_type, lifecycle,
//   admin_zone, server_count, application_count, end_of_support, open_vulnerabilities.
// - server_count leaves retired assets out; end_of_support reads the versions in use only.
// - application_count and the application sections stay in the caller's read scope: a Business
//   Contributor's own applications, none (null, section absent) without the applications right.
// - A user without the infrastructure right is refused, and sees no technology section.
// - Another tenant's technologies are never listed, counted or read.
// - Through the tool registry on the MCP surface, query_entities is read only.
// The AI surface checks (tenant settings, provider) are not under test: stubbed open.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-technologies-query-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type Harness = { app: any; dataSource: DataSource; executor: any; aggregates: any; entities: any; tools: any; features: any };

type Seed = {
  tenantId: string;
  otherTenantId: string;
  otherTechnologyId: string;
  users: Record<'admin' | 'full' | 'bc' | 'appsOnly' | 'infraOnly', string>;
  tech: Record<'pg' | 'win' | 'entra' | 'vsphere', string>;
  assets: Record<'srvA' | 'srvB' | 'srvOld' | 'hostH', string>;
  apps: Record<'billing' | 'payroll' | 'legacy', string>;
};

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-technologies-query.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { AiEntityService } = require('../ai-entity.service');
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
    entities: app.get(AiEntityService),
    tools: app.get(AiToolRegistry),
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

async function seed(runner: QueryRunner, harness: Harness): Promise<Seed> {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await seedTenantRow(runner, tenantId, `ai-tech-${tag}`);
  await seedTenantRow(runner, otherTenantId, `ai-tech-other-${tag}`);

  // The other tenant: same names and references, never seen from the first one.
  await useTenant(runner, otherTenantId);
  const otherTechnologyId = await insertId(runner,
    `INSERT INTO technologies (tenant_id, name, item_number, family, editor) VALUES ($1, 'PostgreSQL', 1, 'database', 'Other vendor')`,
    [otherTenantId]);
  const otherAsset = await insertId(runner, `INSERT INTO assets (tenant_id, name, kind, environment) VALUES ($1, 'other-srv', 'server', 'prod')`, [otherTenantId]);
  await runner.query(`INSERT INTO asset_technologies (tenant_id, asset_id, technology_id) VALUES ($1, $2, $3)`, [otherTenantId, otherAsset, otherTechnologyId]);

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

  const asset = (name: string, status = 'active') => insertId(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment, status) VALUES ($1, $2, 'server', 'prod', $3)`, [tenantId, name, status]);
  const assets = { srvA: await asset('srv-a'), srvB: await asset('srv-b'), srvOld: await asset('srv-old', 'retired'), hostH: await asset('host-h') };
  await runner.query(`INSERT INTO asset_relations (tenant_id, asset_id, related_asset_id, relation_type) VALUES ($1, $2, $3, 'contains')`,
    [tenantId, assets.hostH, assets.srvB]);

  const technology = (n: number, name: string, family: string, editor: string, extra: Record<string, string> = {}) => insertId(runner,
    `INSERT INTO technologies (tenant_id, item_number, name, family, editor, hosting_type, lifecycle, admin_zone)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [tenantId, n, name, family, editor, extra.hosting_type ?? 'on_prem', extra.lifecycle ?? 'active', extra.admin_zone ?? null]);
  const tech = {
    pg: await technology(1, 'PostgreSQL', 'database', 'PostgreSQL Global Development Group'),
    win: await technology(2, 'Windows Server', 'operating_system', 'Microsoft'),
    entra: await technology(3, 'Entra ID', 'identity', 'Microsoft', { hosting_type: 'saas', lifecycle: 'phase_out', admin_zone: 'Tier 0' }),
    vsphere: await technology(4, 'VMware vSphere', 'virtualization', 'VMware'),
  };
  const version = (technologyId: string, label: string, standard: string | null, extended: string | null = null) => insertId(runner,
    `INSERT INTO technology_versions (tenant_id, technology_id, label, standard_support_end, extended_support_end) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, technologyId, label, standard, extended]);
  const pg15 = await version(tech.pg, '15', '2027-11-11');
  const pg12 = await version(tech.pg, '12', '2024-11-14');
  const win2019 = await version(tech.win, '2019', '2024-01-09', '2029-01-09');
  const vs8 = await version(tech.vsphere, '8', null);
  const install = (assetId: string, technologyId: string, versionId: string | null, os = false) => runner.query(
    `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id, is_operating_system) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, assetId, technologyId, versionId, os]);
  await install(assets.srvA, tech.pg, pg15);
  await install(assets.srvOld, tech.pg, pg12);
  await install(assets.srvA, tech.win, win2019, true);
  await install(assets.srvB, tech.win, win2019, true);
  await install(assets.hostH, tech.vsphere, vs8);

  const application = (n: number, name: string, status = 'enabled') => insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, $2, $3, $4)`, [tenantId, name, `APP-${n}`, status]);
  const apps = { billing: await application(1, 'Billing'), payroll: await application(2, 'Payroll'), legacy: await application(3, 'Legacy', 'disabled') };
  await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
    [tenantId, apps.billing, users.bc]);
  const declare = (applicationId: string, technologyId: string, versionId: string | null) => runner.query(
    `INSERT INTO application_technologies (tenant_id, application_id, technology_id, technology_version_id) VALUES ($1, $2, $3, $4)`,
    [tenantId, applicationId, technologyId, versionId]);
  await declare(apps.billing, tech.pg, null);
  await declare(apps.payroll, tech.pg, pg15);
  await declare(apps.payroll, tech.entra, null);
  await declare(apps.legacy, tech.pg, pg12);
  const host = async (applicationId: string, assetId: string) => {
    const instance = await insertId(runner, `INSERT INTO app_instances (tenant_id, application_id, environment) VALUES ($1, $2, 'prod')`, [tenantId, applicationId]);
    await runner.query(`INSERT INTO app_asset_assignments (tenant_id, app_instance_id, asset_id, role) VALUES ($1, $2, $3, 'app')`, [tenantId, instance, assetId]);
  };
  await host(apps.billing, assets.srvB);
  await host(apps.payroll, assets.srvA);

  await runner.query(`INSERT INTO technology_owners (tenant_id, technology_id, user_id, owner_type) VALUES ($1, $2, $3, 'it')`, [tenantId, tech.pg, users.full]);
  const company = await insertId(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Company', 'FR', 'Paris')`, [tenantId]);
  const supplier = await insertId(runner, `INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Supplier')`, [tenantId]);
  const contract = await insertId(runner,
    `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'PG support', $2, $3, '2026-01-01')`, [tenantId, company, supplier]);
  await runner.query(`INSERT INTO technology_contracts (tenant_id, technology_id, contract_id) VALUES ($1, $2, $3)`, [tenantId, tech.pg, contract]);

  if (harness.features.VULNERABILITY_FEED_ENABLED) {
    const cve = `CVE-2099-${tag.replace(/\D/g, '').padEnd(5, '1').slice(0, 5)}`;
    await runner.query(`INSERT INTO vulnerability_cves (cve_id) VALUES ($1) ON CONFLICT DO NOTHING`, [cve]);
    await runner.query(
      `INSERT INTO technology_vulnerabilities (tenant_id, technology_id, cve_id, match_basis, state) VALUES ($1, $2, $3, 'version_unknown', 'to_review')`,
      [tenantId, tech.pg, cve]);
  }

  return { tenantId, otherTenantId, otherTechnologyId, users, tech, assets, apps };
}

function ctx(runner: QueryRunner, seedData: Seed, user: keyof Seed['users']) {
  return {
    tenantId: seedData.tenantId,
    userId: seedData.users[user],
    isPlatformHost: false,
    surface: 'mcp' as const,
    authMethod: 'api_key' as const,
    manager: runner.manager,
  };
}

async function list(harness: Harness, runner: QueryRunner, s: Seed, input: Record<string, unknown>, user: keyof Seed['users'] = 'full') {
  const result = await harness.executor.execute(ctx(runner, s, user), { entity_type: 'technologies', ...input });
  assert.equal(result.status, undefined, `${JSON.stringify(input)}: ${JSON.stringify(result.filters_ignored)}`);
  assert.deepEqual(result.sort_ignored, [], `${JSON.stringify(input)}: sort applied`);
  return result;
}

const labels = (result: any) => result.items.map((item: any) => item.label);

/** Refused or not found, in a savepoint so a failed statement does not end the transaction. */
async function rejects(runner: QueryRunner, fn: () => Promise<unknown>, pattern: RegExp, label: string) {
  await runner.query('SAVEPOINT expected_failure');
  try {
    await fn();
    assert.fail(`${label}: should fail`);
  } catch (error: any) {
    if (error?.code === 'ERR_ASSERTION') throw error;
    assert.match(String(error?.message ?? error), pattern, label);
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}

async function testListAndFigures(harness: Harness, runner: QueryRunner, s: Seed) {
  const all = await list(harness, runner, s, {});
  assert.equal(all.total, 4, 'the tenant\'s technologies only');
  assert.deepEqual(labels(all), ['Entra ID', 'PostgreSQL', 'VMware vSphere', 'Windows Server'], 'by name by default');
  const pg = all.items.find((item: any) => item.label === 'PostgreSQL');
  assert.equal(pg.ref, 'TEC-1');
  assert.equal(pg.type, 'technologies');
  assert.equal(pg.metadata.server_count, 1, 'the retired server is not counted');
  assert.equal(pg.metadata.application_count, 2, 'Billing and Payroll; the disabled application is not counted');
  assert.equal(pg.metadata.end_of_support, '2027-11-11', 'version 12 runs only on a retired server and a disabled application: not in use');
  assert.equal(pg.metadata.publisher, 'PostgreSQL Global Development Group');
  assert.equal(pg.metadata.open_vulnerabilities, harness.features.VULNERABILITY_FEED_ENABLED ? 1 : null, 'CVE to review, null while the feed is off');
  const win = all.items.find((item: any) => item.label === 'Windows Server');
  assert.equal(win.metadata.server_count, 2);
  assert.equal(win.metadata.application_count, 0, 'deduced applications are not declared ones');
  assert.equal(win.metadata.end_of_support, '2024-01-09', 'the standard end, not the extended one');
  const metadataText = JSON.stringify(all.items.map((item: any) => ({ ...item, id: undefined })));
  assert.doesNotMatch(metadataText, UUID_IN_TEXT, 'no id besides the item\'s own');
}

async function testEveryFilter(harness: Harness, runner: QueryRunner, s: Seed) {
  const cases: Array<[Record<string, unknown>, string[]]> = [
    [{ reference: ['tec-2'] }, ['Windows Server']],
    [{ name: 'post' }, ['PostgreSQL']],
    [{ family: ['database', 'identity'] }, ['Entra ID', 'PostgreSQL']],
    [{ publisher: ['microsoft'] }, ['Entra ID', 'Windows Server']],
    [{ hosting_type: ['saas'] }, ['Entra ID']],
    [{ lifecycle: ['phase_out'] }, ['Entra ID']],
    [{ admin_zone: ['Tier 0'] }, ['Entra ID']],
    [{ admin_zone: [null] }, ['PostgreSQL', 'VMware vSphere', 'Windows Server']],
    [{ server_count: { op: 'gte', value: 1 } }, ['PostgreSQL', 'VMware vSphere', 'Windows Server']],
    [{ server_count: { op: 'eq', value: 2 } }, ['Windows Server']],
    [{ server_count: { op: 'between', value: 0, valueTo: 0 } }, ['Entra ID']],
    [{ application_count: { op: 'gt', value: 0 } }, ['Entra ID', 'PostgreSQL']],
    [{ application_count: { op: 'lt', value: 1 } }, ['VMware vSphere', 'Windows Server']],
    [{ end_of_support: { op: 'before', value: '2025-01-01' } }, ['Windows Server']],
    [{ end_of_support: { op: 'after', value: '2025-01-01' } }, ['PostgreSQL']],
    [{ end_of_support: { op: 'between', value: '2024-01-01', valueTo: '2027-12-31' } }, ['PostgreSQL', 'Windows Server']],
    [{ end_of_support: { op: 'eq', value: '2027-11-11' } }, ['PostgreSQL']],
    [{ end_of_support: [null] }, ['Entra ID', 'VMware vSphere']],
    [{ publisher: ['microsoft'], server_count: { op: 'gt', value: 0 } }, ['Windows Server']],
  ];
  if (harness.features.VULNERABILITY_FEED_ENABLED) cases.push([{ open_vulnerabilities: { op: 'gte', value: 1 } }, ['PostgreSQL']]);
  for (const [filters, expected] of cases) {
    const result = await list(harness, runner, s, { filters });
    assert.deepEqual(result.filters_applied.sort(), Object.keys(filters).sort(), `${JSON.stringify(filters)}: applied`);
    assert.deepEqual(labels(result), expected, JSON.stringify(filters));
  }
  const quick = await list(harness, runner, s, { q: 'TEC-4' });
  assert.deepEqual(labels(quick), ['VMware vSphere'], 'quick search on the reference');
  const alias = await harness.executor.execute(ctx(runner, s, 'full'), { entity_type: 'technologies', filters: { mode: ['saas'] } });
  assert.equal(alias.status, 'invalid_filter', 'an unknown field is never dropped silently');
  assert.equal(alias.suggested_repairs[0].field, 'hosting_type', 'the alias points to the field');
}

async function testEverySort(harness: Harness, runner: QueryRunner, s: Seed) {
  const order = async (field: string, direction: 'asc' | 'desc') => labels(await list(harness, runner, s, { sort: { field, direction } }));
  assert.deepEqual(await order('reference', 'desc'), ['VMware vSphere', 'Entra ID', 'Windows Server', 'PostgreSQL']);
  assert.deepEqual(await order('name', 'desc'), ['Windows Server', 'VMware vSphere', 'PostgreSQL', 'Entra ID']);
  assert.deepEqual(await order('family', 'asc'), ['PostgreSQL', 'Entra ID', 'Windows Server', 'VMware vSphere']);
  assert.deepEqual((await order('publisher', 'asc')).slice(0, 2).sort(), ['Entra ID', 'Windows Server'], 'Microsoft first');
  assert.deepEqual((await order('hosting_type', 'desc'))[0], 'Entra ID', 'saas after on_prem');
  assert.deepEqual((await order('lifecycle', 'desc'))[0], 'Entra ID', 'phase_out after active');
  assert.deepEqual((await order('admin_zone', 'asc'))[0], 'Entra ID', 'the only zone first, blanks last');
  assert.deepEqual((await order('server_count', 'desc'))[0], 'Windows Server');
  assert.deepEqual((await order('server_count', 'asc'))[0], 'Entra ID');
  assert.deepEqual((await order('application_count', 'desc'))[0], 'PostgreSQL');
  assert.deepEqual((await order('end_of_support', 'asc')).slice(0, 2), ['Windows Server', 'PostgreSQL'], 'dates first, blanks last');
  assert.deepEqual((await order('end_of_support', 'desc')).slice(0, 2), ['PostgreSQL', 'Windows Server']);
  if (harness.features.VULNERABILITY_FEED_ENABLED) assert.deepEqual((await order('open_vulnerabilities', 'desc'))[0], 'PostgreSQL');
  for (const field of ['created_at', 'updated_at', 'label', 'open_vulnerabilities']) {
    assert.equal((await order(field, 'asc')).length, 4, `${field}: sorts`);
  }
  const page = await list(harness, runner, s, { limit: 3, page: 2 });
  assert.deepEqual(labels(page), ['Windows Server'], 'second page');
  assert.equal(page.total, 4);
}

async function testApplicationScope(harness: Harness, runner: QueryRunner, s: Seed) {
  const bc = await list(harness, runner, s, {}, 'bc');
  const byLabel = (result: any, label: string) => result.items.find((item: any) => item.label === label);
  assert.equal(byLabel(bc, 'PostgreSQL').metadata.application_count, 1, 'a Business Contributor counts its own applications only');
  assert.equal(byLabel(bc, 'Entra ID').metadata.application_count, 0, 'Payroll is out of its scope');
  const filtered = await list(harness, runner, s, { filters: { application_count: { op: 'gt', value: 0 } } }, 'bc');
  assert.deepEqual(labels(filtered), ['PostgreSQL'], 'the filter stays in scope');
  const sorted = await list(harness, runner, s, { sort: { field: 'application_count', direction: 'desc' } }, 'bc');
  assert.equal(sorted.items[0].label, 'PostgreSQL');

  const infraOnly = await list(harness, runner, s, {}, 'infraOnly');
  assert.ok(infraOnly.items.every((item: any) => item.metadata.application_count === null), 'null without the applications right, never 0');
  const none = await list(harness, runner, s, { filters: { application_count: { op: 'gte', value: 0 } } }, 'infraOnly');
  assert.equal(none.total, 0, 'a count the user cannot see matches nothing');

  const detail = await harness.executor.executeDetail(ctx(runner, s, 'bc'), { entity_type: 'technologies', entity_id: 'TEC-1' });
  assert.equal(detail.data.application_count, 1);
}

async function testAggregatesAndFilterValues(harness: Harness, runner: QueryRunner, s: Seed) {
  const aggregate = (input: Record<string, unknown>, user: keyof Seed['users'] = 'full') =>
    harness.aggregates.execute(ctx(runner, s, user), { entity_type: 'technologies', ...input });
  const byFamily = await aggregate({ group_by: 'family' });
  assert.equal(byFamily.total, 4);
  assert.deepEqual(byFamily.groups.map((g: any) => [g.key, g.count]).sort(), [['database', 1], ['identity', 1], ['operating_system', 1], ['virtualization', 1]]);
  const byPublisher = await aggregate({ group_by: 'publisher' });
  assert.deepEqual(byPublisher.groups[0], { key: 'Microsoft', count: 2 });
  const byLifecycle = await aggregate({ group_by: 'lifecycle', filters: { server_count: { op: 'gt', value: 0 } } });
  assert.deepEqual(byLifecycle.groups, [{ key: 'active', count: 3 }], 'filters apply to the aggregates');
  const servers = await aggregate({ group_by: 'publisher', metric: 'server_count', function: 'sum' });
  assert.equal(servers.groups.find((g: any) => g.key === 'Microsoft').value, 2);
  const earliest = await aggregate({ group_by: 'lifecycle', metric: 'end_of_support', function: 'min' });
  assert.equal(earliest.groups.find((g: any) => g.key === 'active').value, '2024-01-09');
  await rejects(runner, () => aggregate({ group_by: 'family', metric: 'application_count', function: 'sum' }), /Unsupported metric field/,
    'application_count is no metric: an aggregate expression cannot carry the read scope');
  const scoped = await aggregate({ group_by: 'family', filters: { application_count: { op: 'gt', value: 0 } } }, 'bc');
  assert.deepEqual(scoped.groups, [{ key: 'database', count: 1 }], 'an aggregate filter on application_count stays in scope');

  const values = await harness.executor.executeFilterValues(ctx(runner, s, 'full'), {
    entity_type: 'technologies', fields: ['family', 'publisher', 'hosting_type', 'lifecycle', 'admin_zone', 'server_count'],
  });
  assert.deepEqual(values.values.family, ['database', 'identity', 'operating_system', 'virtualization']);
  assert.deepEqual(values.values.publisher, ['Microsoft', 'PostgreSQL Global Development Group', 'VMware'], 'this tenant\'s publishers only');
  assert.deepEqual(values.values.admin_zone, ['Tier 0', null]);
  assert.deepEqual(values.fields_ignored, ['server_count'], 'a number has no value list');
}

async function testDetail(harness: Harness, runner: QueryRunner, s: Seed) {
  const detail = await harness.executor.executeDetail(ctx(runner, s, 'full'), { entity_type: 'technologies', entity_id: 'TEC-1' });
  assert.equal(detail.entity.ref, 'TEC-1');
  assert.equal(detail.data.server_count, 1);
  assert.equal(detail.data.application_count, 2);
  assert.equal(detail.data.contract_count, null, 'no number of contracts without the contracts read right, as on the technology page');
  const infraDetail = await harness.executor.executeDetail(ctx(runner, s, 'infraOnly'), { entity_type: 'technologies', entity_id: 'TEC-1' });
  assert.equal(infraDetail.data.contract_count, null, 'infrastructure alone: no number of contracts');
  const adminDetail = await harness.executor.executeDetail(ctx(runner, s, 'admin'), { entity_type: 'technologies', entity_id: 'TEC-1' });
  assert.equal(adminDetail.data.contract_count, 1, 'a contracts reader sees the number of contracts');
  assert.deepEqual(detail.data.it_owners, ['Full Tester'], 'owners by name');
  assert.deepEqual(detail.data.business_owners, []);
  assert.deepEqual(
    detail.data.versions.map((v: any) => [v.label, v.standard_support_end, v.server_count]),
    [['15', '2027-11-11', 1], ['12', '2024-11-14', 0]],
    'servers in service per version',
  );
  assert.doesNotMatch(JSON.stringify(detail.data), UUID_IN_TEXT, 'references and names only');
  const byName = await harness.executor.executeDetail(ctx(runner, s, 'full'), { entity_type: 'technologies', entity_id: 'Entra ID' });
  assert.equal(byName.data.admin_zone, 'Tier 0', 'found by name');
}

async function testContexts(harness: Harness, runner: QueryRunner, s: Seed) {
  const group = (context: any, relation: string) => context.related.find((g: any) => g.relation === relation);
  const winContext = await harness.entities.getEntityContext(ctx(runner, s, 'full'), { entity_type: 'technologies', entity_id: 'TEC-2' });
  assert.equal(winContext.entity.ref, 'TEC-2');
  assert.equal(winContext.entity.metadata.family, 'operating_system');
  const servers = group(winContext, 'servers');
  assert.deepEqual(servers.items.map((item: any) => [item.label, item.metadata.version, item.metadata.operating_system]),
    [['srv-a', '2019', true], ['srv-b', '2019', true]]);
  assert.equal(servers.total, 2);
  assert.equal(servers.truncated, false);
  assert.deepEqual(group(winContext, 'deduced_applications').items.map((item: any) => [item.label, item.metadata.servers]),
    [['Billing', 'srv-b'], ['Payroll', 'srv-a']], 'deduced through the servers');
  assert.equal(group(winContext, 'declared_applications'), undefined, 'nothing declares it');

  const pgContext = await harness.entities.getEntityContext(ctx(runner, s, 'full'), { entity_type: 'technologies', entity_id: 'TEC-1' });
  assert.deepEqual(group(pgContext, 'servers').items.map((item: any) => item.label), ['srv-a'], 'the retired server is left out');
  assert.deepEqual(group(pgContext, 'declared_applications').items.map((item: any) => [item.label, item.metadata.version]),
    [['Billing', null], ['Payroll', '15']], 'the disabled application is left out');

  const assetContext = await harness.entities.getEntityContext(ctx(runner, s, 'full'), { entity_type: 'assets', entity_id: s.assets.srvB });
  assert.deepEqual(group(assetContext, 'technologies').items.map((item: any) => [item.ref, item.label, item.metadata.version, item.metadata.operating_system, item.metadata.link]),
    [['TEC-2', 'Windows Server', '2019', true, 'installed'], ['TEC-4', 'VMware vSphere', '8', false, 'carried']]);

  const appContext = await harness.entities.getEntityContext(ctx(runner, s, 'full'), { entity_type: 'applications', entity_id: 'APP-1' });
  assert.deepEqual(group(appContext, 'declared_technologies').items.map((item: any) => item.ref), ['TEC-1']);
  assert.deepEqual(group(appContext, 'deduced_technologies').items.map((item: any) => [item.ref, item.metadata.servers]).sort(),
    [['TEC-2', 'srv-b'], ['TEC-4', 'srv-b']], 'declared and deduced kept apart');
  assert.doesNotMatch(JSON.stringify([...appContext.related].map((g: any) => g.items.map((i: any) => ({ ...i, id: undefined })))), UUID_IN_TEXT);

  const appsOnlyContext = await harness.entities.getEntityContext(ctx(runner, s, 'appsOnly'), { entity_type: 'applications', entity_id: 'APP-1' });
  assert.equal(group(appsOnlyContext, 'declared_technologies'), undefined, 'no technology section without the infrastructure right');
  assert.equal(group(appsOnlyContext, 'deduced_technologies'), undefined);
  await rejects(runner, () => harness.tools.execute(ctx(runner, s, 'appsOnly'), 'get_entity_context', { entity_type: 'technologies', entity_id: 'TEC-1' }),
    /infrastructure/, 'get_entity_context of a technology without the infrastructure right');

  const bcContext = await harness.entities.getEntityContext(ctx(runner, s, 'bc'), { entity_type: 'technologies', entity_id: 'TEC-1' });
  assert.deepEqual(group(bcContext, 'declared_applications').items.map((item: any) => item.label), ['Billing'], 'Payroll is never listed');
  assert.equal(group(bcContext, 'deduced_applications'), undefined, 'Payroll, hosted on srv-a, is out of scope');
  const infraContext = await harness.entities.getEntityContext(ctx(runner, s, 'infraOnly'), { entity_type: 'technologies', entity_id: 'TEC-1' });
  assert.deepEqual(infraContext.related.map((g: any) => g.relation), ['servers'], 'no application section without the applications right');

  await rejects(runner, () => harness.entities.getEntityContext(ctx(runner, s, 'admin'), { entity_type: 'technologies', entity_id: s.otherTechnologyId }),
    /not found/i, 'another tenant\'s technology has no context here');
}

async function testInfrastructureRight(harness: Harness, runner: QueryRunner, s: Seed) {
  const call = (tool: string, input: Record<string, unknown>) => harness.tools.execute(ctx(runner, s, 'appsOnly'), tool, input);
  await rejects(runner, () => call('query_entities', { entity_type: 'technologies' }), /infrastructure/, 'query_entities');
  await rejects(runner, () => call('aggregate_entities', { entity_type: 'technologies', group_by: 'family' }), /infrastructure/, 'aggregate_entities');
  await rejects(runner, () => call('get_filter_values', { entity_type: 'technologies', fields: ['family'] }), /infrastructure/, 'get_filter_values');
  await rejects(runner, () => call('describe_entity_filters', { entity_type: 'technologies' }), /infrastructure/, 'describe_entity_filters');
  await rejects(runner, () => call('get_entity_detail', { entity_type: 'technologies', entity_id: 'TEC-1' }), /infrastructure/, 'get_entity_detail');
}

async function testTenantIsolation(harness: Harness, runner: QueryRunner, s: Seed) {
  const all = await list(harness, runner, s, { filters: { name: 'PostgreSQL' } }, 'admin');
  assert.deepEqual(all.items.map((item: any) => item.id), [s.tech.pg], 'the other tenant\'s PostgreSQL is not listed');
  const counts = await harness.aggregates.execute(ctx(runner, s, 'admin'), { entity_type: 'technologies', group_by: 'publisher' });
  assert.equal(counts.groups.some((g: any) => g.key === 'Other vendor'), false, 'nor counted');
  await rejects(runner, () => harness.executor.executeDetail(ctx(runner, s, 'admin'), { entity_type: 'technologies', entity_id: s.otherTechnologyId }),
    /not found/i, 'nor read by id');
  const detail = await harness.executor.executeDetail(ctx(runner, s, 'admin'), { entity_type: 'technologies', entity_id: 'TEC-1' });
  assert.equal(detail.entity.id, s.tech.pg, 'TEC-1 is this tenant\'s');
}

async function testMcpReadOnly(harness: Harness, runner: QueryRunner, s: Seed) {
  const definition = harness.tools.listRegisteredTools().find((tool: any) => tool.name === 'query_entities');
  assert.equal(definition.readOnly, true, 'query_entities is a read-only tool');
  const statements: string[] = [];
  const original = runner.query.bind(runner);
  (runner as any).query = (sql: string, ...rest: unknown[]) => {
    statements.push(sql);
    return original(sql, ...(rest as [any]));
  };
  let result: any;
  try {
    result = await harness.tools.execute(ctx(runner, s, 'full'), 'query_entities', {
      entity_type: 'technologies',
      filters: { end_of_support: { op: 'before', value: '2025-01-01' } },
    });
  } finally {
    (runner as any).query = original;
  }
  assert.deepEqual(result.items.map((item: any) => item.ref), ['TEC-2'], 'the MCP surface answers');
  const writes = statements.filter((sql) => /^\s*(INSERT|UPDATE|DELETE|MERGE|TRUNCATE)\b/i.test(sql) || /\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM)\b/i.test(sql));
  assert.deepEqual(writes, [], 'and writes nothing');
}

/**
 * tools/call of query_entities on technologies through the MCP endpoint: the real controller,
 * exposure policy and dispatcher, on this transaction (the tenant executor is the only stub).
 * The tool is advertised read only, answers, and writes no business table.
 */
async function testMcpToolsCall(harness: Harness, runner: QueryRunner, s: Seed) {
  const { AiMcpController } = require('../ai-mcp.controller');
  const { AiCapabilityDispatcherService } = require('../control-plane/dispatcher/ai-capability-dispatcher.service');
  const { AiMcpExposureService } = require('../control-plane/mcp/ai-mcp-exposure.service');
  const { AiMcpAuditService } = require('../control-plane/mcp/ai-mcp-audit.service');
  const controller = new AiMcpController(
    harness.app.get(AiCapabilityDispatcherService),
    harness.app.get(AiMcpExposureService),
    harness.app.get(AiMcpAuditService),
    { assertAllowed: () => undefined },
    { runWithContext: async (context: any, fn: (ctx: any) => Promise<unknown>) => fn({ ...context, manager: runner.manager }) },
  );
  const server = express();
  server.use(express.json());
  server.post('/ai/mcp', (req: any, res, next) => {
    req.tenant = { id: s.tenantId };
    req.user = { sub: s.users.full, aiApiKeyId: null };
    req.aiApiKey = {
      id: null,
      tenant_id: s.tenantId,
      user_id: s.users.full,
      mcp_scopes: ['mcp:tools:list', 'mcp:tools:execute'],
      mcp_allowed_capabilities: ['kanap.read.core'],
      mcp_denied_capabilities: [],
      mcp_max_effect: 'read',
      mcp_rate_limit_per_minute: 60,
    };
    controller.handlePost(req, res).catch(next);
  });
  server.use((error: any, _req: any, res: any, _next: any) => {
    res.status(error instanceof HttpException ? error.getStatus() : 500).json({ message: String(error?.message ?? error) });
  });
  const listener = server.listen(0);
  await new Promise((resolve) => listener.once('listening', resolve));
  const url = `http://127.0.0.1:${(listener.address() as AddressInfo).port}/ai/mcp`;
  const rpc = async (body: unknown) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    assert.equal(response.status, 200, text);
    const data = text.split('\n').find((line) => line.startsWith('data: '));
    return JSON.parse(data ? data.slice('data: '.length) : text);
  };
  const statements: string[] = [];
  const original = runner.query.bind(runner);
  (runner as any).query = (sql: string, ...rest: unknown[]) => {
    statements.push(sql);
    return original(sql, ...(rest as [any]));
  };
  try {
    const listed = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const tool = listed.result.tools.find((t: any) => t.name === 'query_entities');
    assert.ok(tool, 'query_entities is exposed over MCP');
    assert.equal(tool.annotations.readOnlyHint, true, 'read only');
    assert.ok(tool.inputSchema.properties.entity_type.enum.includes('technologies'), 'technologies is one of its families');
    const called = await rpc({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'query_entities', arguments: { entity_type: 'technologies', filters: { publisher: ['Microsoft'] } } },
    });
    assert.equal(called.result.isError, undefined, JSON.stringify(called.result));
    const output = JSON.parse(called.result.content[0].text);
    assert.deepEqual(output.items.map((item: any) => item.ref), ['TEC-3', 'TEC-2']);
  } finally {
    (runner as any).query = original;
    await new Promise((resolve) => listener.close(resolve));
  }
  const businessWrites = statements.filter((sql) => /\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"?(technolog|asset|application|app_|contract)/i.test(sql));
  assert.deepEqual(businessWrites, [], 'no business table is written');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner, harness);
      await testListAndFigures(harness, runner, s);
      await testEveryFilter(harness, runner, s);
      await testEverySort(harness, runner, s);
      await testApplicationScope(harness, runner, s);
      await testAggregatesAndFilterValues(harness, runner, s);
      await testDetail(harness, runner, s);
      await testInfrastructureRight(harness, runner, s);
      await testTenantIsolation(harness, runner, s);
      await testContexts(harness, runner, s);
      await testMcpReadOnly(harness, runner, s);
      await testMcpToolsCall(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-technologies-query.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
