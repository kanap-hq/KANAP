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
//   admin_zone, server_count, application_count, support_status, end_of_standard_support,
//   end_of_support, open_vulnerabilities.
// - server_count counts the servers as the technology list does (assets in service the technology
//   is installed on, clusters excluded; what the graph carries does not count);
//   the support fields read the versions in use only, by
//   the End of support report's rule: a version in extended support is not out of support, and
//   the assistant's out of support and extended support versions are the report's.
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
  assert.equal(pg.metadata.end_of_standard_support, '2027-11-11', 'one date: the standard end is the last end');
  assert.match(pg.metadata.versions_in_use, /^15: supported until 2027-11-11, 1 server$|^15: out of support since 2027-11-11, 1 server$/, 'version 12 is not in use');
  assert.equal(pg.metadata.publisher, 'PostgreSQL Global Development Group');
  assert.equal(pg.metadata.open_vulnerabilities, harness.features.VULNERABILITY_FEED_ENABLED ? 1 : null, 'CVE to review, null while the feed is off');
  const win = all.items.find((item: any) => item.label === 'Windows Server');
  assert.equal(win.metadata.server_count, 2);
  assert.equal(win.metadata.application_count, 0, 'deduced applications are not declared ones');
  assert.equal(win.metadata.end_of_support, '2029-01-09', 'the last end: the extended one');
  assert.equal(win.metadata.end_of_standard_support, '2024-01-09', 'the standard end apart');
  assert.match(win.metadata.versions_in_use, /^2019: (extended support until|out of support since) 2029-01-09, 2 servers$/, 'past its standard end: never supported');
  const entra = all.items.find((item: any) => item.label === 'Entra ID');
  assert.equal(entra.metadata.support_status, 'unknown', 'no version');
  assert.equal(entra.metadata.versions_in_use, null);
  const vsphere = all.items.find((item: any) => item.label === 'VMware vSphere');
  assert.equal(vsphere.metadata.support_status, 'unknown', 'a version in use without a date');
  assert.equal(vsphere.metadata.versions_in_use, '8: no end of support date, 1 server', 'the servers of a version: installed on them');
  assert.equal(vsphere.metadata.server_count, 1, 'the host, not the server it contains');
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
    [{ server_count: { op: 'eq', value: 1 } }, ['PostgreSQL', 'VMware vSphere']],
    [{ server_count: { op: 'between', value: 0, valueTo: 0 } }, ['Entra ID']],
    [{ application_count: { op: 'gt', value: 0 } }, ['Entra ID', 'PostgreSQL']],
    [{ application_count: { op: 'lt', value: 1 } }, ['VMware vSphere', 'Windows Server']],
    [{ end_of_support: { op: 'before', value: '2028-01-01' } }, ['PostgreSQL']],
    [{ end_of_support: { op: 'after', value: '2028-01-01' } }, ['Windows Server']],
    [{ end_of_support: { op: 'between', value: '2024-01-01', valueTo: '2029-12-31' } }, ['PostgreSQL', 'Windows Server']],
    [{ end_of_support: { op: 'eq', value: '2029-01-09' } }, ['Windows Server']],
    [{ end_of_support: [null] }, ['Entra ID', 'VMware vSphere']],
    [{ end_of_standard_support: { op: 'before', value: '2025-01-01' } }, ['Windows Server']],
    [{ end_of_standard_support: { op: 'eq', value: '2027-11-11' } }, ['PostgreSQL']],
    [{ end_of_standard_support: [null] }, ['Entra ID', 'VMware vSphere']],
    [{ support_status: ['unknown'] }, ['Entra ID', 'VMware vSphere']],
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
  assert.deepEqual((await order('end_of_support', 'asc')).slice(0, 2), ['PostgreSQL', 'Windows Server'], 'dates first, blanks last');
  assert.deepEqual((await order('end_of_support', 'desc')).slice(0, 2), ['Windows Server', 'PostgreSQL']);
  assert.deepEqual((await order('end_of_standard_support', 'asc')).slice(0, 2), ['Windows Server', 'PostgreSQL']);
  assert.deepEqual((await order('support_status', 'desc')).slice(2).sort(), ['Entra ID', 'VMware vSphere'], 'unknown last');
  if (harness.features.VULNERABILITY_FEED_ENABLED) assert.deepEqual((await order('open_vulnerabilities', 'desc'))[0], 'PostgreSQL');
  for (const field of ['created_at', 'updated_at', 'label', 'open_vulnerabilities', 'support_status', 'end_of_standard_support']) {
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
  await runner.query(`UPDATE technologies SET editor = 'microsoft' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.tech.entra]);
  const mixedCase = await aggregate({ group_by: 'publisher' });
  assert.deepEqual(mixedCase.groups[0], { key: 'Microsoft', count: 2 }, 'publishers group without case, as they filter');
  await runner.query(`UPDATE technologies SET editor = 'Microsoft' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.tech.entra]);
  const earliest = await aggregate({ group_by: 'lifecycle', metric: 'end_of_support', function: 'min' });
  assert.equal(earliest.groups.find((g: any) => g.key === 'active').value, '2027-11-11', 'the last ends');
  const earliestStandard = await aggregate({ group_by: 'lifecycle', metric: 'end_of_standard_support', function: 'min' });
  assert.equal(earliestStandard.groups.find((g: any) => g.key === 'active').value, '2024-01-09');
  const byStatus = await aggregate({ group_by: 'support_status' });
  assert.equal(byStatus.groups.find((g: any) => g.key === 'unknown').count, 2, 'Entra ID and VMware vSphere');
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

async function testApplicationsReachCache(runner: QueryRunner, s: Seed) {
  const { resolveAiApplicationsReach } = require('../query/ai-technologies.query');
  let calls = 0;
  const policy = {
    async canReadEntityType() {
      calls += 1;
      if (calls === 1) throw new Error('database unavailable');
      return false;
    },
  };
  const context = ctx(runner, s, 'full');
  await assert.rejects(resolveAiApplicationsReach(context, policy), /database unavailable/);
  assert.equal(await resolveAiApplicationsReach(context, policy), null, 'a failure is not kept for the next call');
  assert.equal(await resolveAiApplicationsReach(context, policy), null);
  assert.equal(calls, 2, 'a success is kept');
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
  assert.deepEqual(
    detail.data.versions.map((v: any) => [v.label, v.in_use]),
    [['15', true], ['12', false]],
    'version 12 runs only on a retired server and a disabled application',
  );
  const v12 = detail.data.versions.find((v: any) => v.label === '12');
  assert.deepEqual([v12.support_status, v12.support_date], ['out_of_support', '2024-11-14'], 'every version carries its state and date');
  assert.equal(detail.data.end_of_support, '2027-11-11');
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
  // The technology versions follow the technology right, through every read tool.
  await rejects(runner, () => call('query_entities', { entity_type: 'technology_versions' }), /infrastructure/, 'query_entities technology_versions');
  await rejects(runner, () => call('aggregate_entities', { entity_type: 'technology_versions', group_by: 'technology' }), /infrastructure/, 'aggregate_entities technology_versions');
  await rejects(runner, () => call('get_filter_values', { entity_type: 'technology_versions', fields: ['technology'] }), /infrastructure/, 'get_filter_values technology_versions');
  await rejects(runner, () => call('describe_entity_filters', { entity_type: 'technology_versions' }), /infrastructure/, 'describe_entity_filters technology_versions');
  await rejects(runner, () => call('get_entity_detail', { entity_type: 'technology_versions', entity_id: 'TEC-1' }), /infrastructure/, 'get_entity_detail technology_versions');
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
      filters: { end_of_support: { op: 'after', value: '2028-01-01' } },
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
    assert.ok(tool.inputSchema.properties.entity_type.enum.includes('technology_versions'), 'technology_versions is one of its families');
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

/** Adds 26 servers and 26 applications to TEC-4: after the tests that count them. */
async function testContextBounds(harness: Harness, runner: QueryRunner, s: Seed) {
  for (let i = 0; i < 26; i += 1) {
    const assetId = await insertId(runner,
      `INSERT INTO assets (tenant_id, name, kind, environment, status) VALUES ($1, $2, 'server', 'prod', 'active')`, [s.tenantId, `bulk-${String(i).padStart(2, '0')}`]);
    await runner.query(`INSERT INTO asset_technologies (tenant_id, asset_id, technology_id) VALUES ($1, $2, $3)`, [s.tenantId, assetId, s.tech.vsphere]);
    const applicationId = await insertId(runner,
      `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, $2, $3, 'enabled')`, [s.tenantId, `Bulk ${String(i).padStart(2, '0')}`, `APP-${100 + i}`]);
    await runner.query(`INSERT INTO application_technologies (tenant_id, application_id, technology_id) VALUES ($1, $2, $3)`, [s.tenantId, applicationId, s.tech.vsphere]);
  }
  const context = await harness.entities.getEntityContext(ctx(runner, s, 'full'), { entity_type: 'technologies', entity_id: 'TEC-4' });
  const group = (relation: string) => context.related.find((g: any) => g.relation === relation);
  assert.equal(group('servers').items.length, 25);
  assert.equal(group('servers').total, 27, 'host-h and the 26 new servers');
  assert.equal(group('servers').truncated, true);
  assert.equal(group('servers').items[0].label, 'bulk-00', 'the first servers by name');
  assert.equal(group('declared_applications').items.length, 25);
  assert.equal(group('declared_applications').total, 26);
  assert.equal(group('declared_applications').truncated, true);
  assert.equal(context.truncated, true);
  assert.equal(context.complete, false);
  const bc = await harness.entities.getEntityContext(ctx(runner, s, 'bc'), { entity_type: 'technologies', entity_id: 'TEC-4' });
  assert.equal(bc.related.find((g: any) => g.relation === 'declared_applications'), undefined, 'the totals count only the applications in scope');
}

/**
 * Last: support on dates relative to today. Zeta mix runs a version out of support and declares
 * a supported one; Zeta extended runs a version in extended support, and a version out of support
 * only on a retired server and a disabled application; Zeta undated runs a version without date;
 * Zeta many declares 12 versions without date. Then the parity with the End of support report.
 */
/**
 * One servers definition with the technology list (`countsOfTechnologies`): a technology installed on
 * a cluster and on its member counts the member only, the cluster excluded.
 */
async function testServersAsTheTechnologyList(harness: Harness, runner: QueryRunner, s: Seed) {
  const t = s.tenantId;
  const asset = (name: string, cluster: boolean) => insertId(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment, status, is_cluster) VALUES ($1, $2, 'server', 'prod', 'active', $3)`, [t, name, cluster]);
  const cluster = await asset('cluster-c', true);
  const member = await asset('node-m', false);
  await runner.query(`INSERT INTO asset_cluster_members (tenant_id, cluster_id, asset_id) VALUES ($1, $2, $3)`, [t, cluster, member]);
  for (const assetId of [cluster, member]) {
    await runner.query(`INSERT INTO asset_technologies (tenant_id, asset_id, technology_id) VALUES ($1, $2, $3)`, [t, assetId, s.tech.entra]);
  }
  const all = await list(harness, runner, s, { limit: 100 });
  const entra = all.items.find((item: any) => item.label === 'Entra ID');
  assert.equal(entra.metadata.server_count, 1, 'the member only: the cluster is not a server');
  const { TechnologyReachService } = require('../../technologies/technology-reach.service');
  const ids = Object.values(s.tech);
  const counts: Map<string, { servers: number }> = await harness.app.get(TechnologyReachService).countsOfTechnologies(runner.manager, t, ids);
  const seeded = all.items.filter((i: any) => ids.includes(i.id));
  assert.equal(seeded.length, ids.length, 'the four seeded technologies');
  for (const item of seeded) {
    assert.equal(item.metadata.server_count, counts.get(item.id)!.servers, `${item.label}: the technology list's count`);
  }

  // The servers of each version follow the same definition: the host it is installed on, neither
  // the server it contains nor the cluster.
  const [{ id: vs8 }] = await runner.query(
    `SELECT id FROM technology_versions WHERE tenant_id = $1 AND technology_id = $2 AND label = '8'`, [t, s.tech.vsphere]);
  const [{ id: clusterLink }] = await runner.query(
    `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id) VALUES ($1, $2, $3, $4) RETURNING id`,
    [t, cluster, s.tech.vsphere, vs8]);
  const vsphere = (await list(harness, runner, s, { limit: 100 })).items.find((item: any) => item.label === 'VMware vSphere');
  assert.equal(vsphere.metadata.versions_in_use, '8: no end of support date, 1 server');
  const detail = await harness.executor.executeDetail(ctx(runner, s, 'full'), { entity_type: 'technologies', entity_id: 'TEC-4' });
  assert.deepEqual(detail.data.versions.map((v: any) => [v.label, v.server_count]), [['8', 1]], 'the detail counts the same');
  await runner.query(`DELETE FROM asset_technologies WHERE tenant_id = $1 AND id = $2`, [t, clusterLink]);
}

async function testSupportStatus(harness: Harness, runner: QueryRunner, s: Seed) {
  const [{ today }] = await runner.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`);
  const shift = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const t = s.tenantId;
  const technology = (n: number, name: string) => insertId(runner,
    `INSERT INTO technologies (tenant_id, item_number, name, family, editor, hosting_type, lifecycle) VALUES ($1, $2, $3, 'database', 'Zeta', 'on_prem', 'active')`,
    [t, n, name]);
  const version = (technologyId: string, label: string, standard: string | null, extended: string | null) => insertId(runner,
    `INSERT INTO technology_versions (tenant_id, technology_id, label, standard_support_end, extended_support_end) VALUES ($1, $2, $3, $4, $5)`,
    [t, technologyId, label, standard, extended]);
  const install = (assetId: string, technologyId: string, versionId: string) => runner.query(
    `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id) VALUES ($1, $2, $3, $4)`, [t, assetId, technologyId, versionId]);
  const declare = (applicationId: string, technologyId: string, versionId: string) => runner.query(
    `INSERT INTO application_technologies (tenant_id, application_id, technology_id, technology_version_id) VALUES ($1, $2, $3, $4)`, [t, applicationId, technologyId, versionId]);
  const server = (name: string) => insertId(runner, `INSERT INTO assets (tenant_id, name, kind, environment, status) VALUES ($1, $2, 'server', 'prod', 'active')`, [t, name]);
  const [z1, z2] = [await server('zeta-1'), await server('zeta-2')];

  const mix = await technology(11, 'Zeta mix');
  await install(z1, mix, await version(mix, 'old', shift(-900), shift(-300)));
  await declare(s.apps.payroll, mix, await version(mix, 'new', shift(300), shift(900)));
  const extended = await technology(12, 'Zeta extended');
  await install(z2, extended, await version(extended, 'x', shift(-200), shift(600)));
  const gone = await version(extended, 'gone', shift(-2000), shift(-1000));
  await install(s.assets.srvOld, extended, gone);
  await declare(s.apps.legacy, extended, gone);
  const undated = await technology(13, 'Zeta undated');
  await install(z2, undated, await version(undated, 'y', null, null));
  const many = await technology(14, 'Zeta many');
  for (let i = 1; i <= 12; i += 1) await declare(s.apps.payroll, many, await version(many, `v${String(i).padStart(2, '0')}`, null, null));

  const zeta = async (filters: Record<string, unknown> = {}, sort?: Record<string, unknown>) =>
    list(harness, runner, s, { filters: { publisher: ['Zeta'], ...filters }, ...(sort ? { sort } : {}) });
  const byLabel = new Map((await zeta()).items.map((item: any) => [item.label, item.metadata]));
  const m = byLabel.get('Zeta mix') as any;
  assert.equal(m.support_status, 'out_of_support', 'the most severe version in use');
  assert.equal(m.versions_in_use, `old: out of support since ${shift(-300)}, 1 server; new: supported, standard support until ${shift(300)}, 0 servers`,
    'both versions, the most severe first');
  assert.equal(m.end_of_standard_support, shift(-900));
  assert.equal(m.end_of_support, shift(-300));
  const e = byLabel.get('Zeta extended') as any;
  assert.equal(e.support_status, 'extended_support', 'past the standard end only: not out of support');
  assert.equal(e.versions_in_use, `x: extended support until ${shift(600)}, 1 server`, 'the version on a retired server and a disabled application is left out');
  assert.equal(e.end_of_support, shift(600), 'nor dates the technology');
  assert.equal(e.end_of_standard_support, shift(-200));
  const u = byLabel.get('Zeta undated') as any;
  assert.deepEqual([u.support_status, u.end_of_support, u.end_of_standard_support], ['unknown', null, null]);
  assert.equal(u.versions_in_use, 'y: no end of support date, 1 server');
  const many12 = (byLabel.get('Zeta many') as any).versions_in_use as string;
  assert.equal(many12.split('; ').length, 11, 'ten versions and the rest counted');
  assert.match(many12, /^v01: no end of support date, 0 servers; .*; v10: no end of support date, 0 servers; and 2 other versions$/);

  assert.deepEqual(labels(await zeta({ support_status: ['out_of_support'] })), ['Zeta mix']);
  assert.deepEqual(labels(await zeta({ support_status: ['extended_support'] })), ['Zeta extended']);
  assert.deepEqual(labels(await zeta({ support_status: ['unknown'] })), ['Zeta many', 'Zeta undated']);
  assert.deepEqual(labels(await zeta({ support_status: ['out_of_support', 'extended_support'] })), ['Zeta extended', 'Zeta mix']);
  assert.deepEqual(labels(await zeta({ end_of_support: { op: 'before', value: today } })), ['Zeta mix'], 'support over for good');
  assert.deepEqual(labels(await zeta({ end_of_standard_support: { op: 'before', value: today } })), ['Zeta extended', 'Zeta mix'], 'standard support over');
  assert.deepEqual(labels(await zeta({}, { field: 'support_status', direction: 'desc' })).slice(0, 2), ['Zeta mix', 'Zeta extended'], 'the most severe first');
  const groups = await harness.aggregates.execute(ctx(runner, s, 'full'), { entity_type: 'technologies', group_by: 'support_status', filters: { publisher: ['Zeta'] } });
  assert.deepEqual(groups.groups.map((g: any) => [g.key, g.count]).sort(), [['extended_support', 1], ['out_of_support', 1], ['unknown', 2]]);

  const detail = await harness.executor.executeDetail(ctx(runner, s, 'full'), { entity_type: 'technologies', entity_id: 'TEC-12' });
  assert.equal(detail.data.support_status, 'extended_support');
  assert.deepEqual(
    detail.data.versions.map((v: any) => [v.label, v.support_status, v.support_date, v.in_use]).sort(),
    [['gone', 'out_of_support', shift(-1000), false], ['x', 'extended_support', shift(600), true]],
  );

  // Parity: the out of support and extended support versions of the assistant are the report's.
  const { EndOfSupportService } = require('../../technologies/reports/end-of-support.service');
  const report = await harness.app.get(EndOfSupportService, { strict: false })
    .deadlines({ horizon_months: 36 }, { manager: runner.manager, tenantId: t }, { scope: undefined });
  const fromReport = report.items
    .filter((row: any) => (row.type === 'technology' || row.type === 'operating_system') && row.state !== 'upcoming')
    .map((row: any) => `${row.item_reference}|${row.version}|${row.state}|${row.date}`)
    .sort();
  const fromAssistant: string[] = [];
  for (const item of (await list(harness, runner, s, { limit: 100 })).items) {
    const { data } = await harness.executor.executeDetail(ctx(runner, s, 'full'), { entity_type: 'technologies', entity_id: item.ref });
    for (const v of data.versions) {
      if (v.in_use && (v.support_status === 'out_of_support' || v.support_status === 'extended_support')) {
        fromAssistant.push(`${item.ref}|${v.label}|${v.support_status}|${v.support_date}`);
      }
    }
    const worst = ['out_of_support', 'extended_support', 'supported'].find((state) => data.versions.some((v: any) => v.in_use && v.support_status === state)) ?? 'unknown';
    assert.equal(item.metadata.support_status, worst, `${item.ref}: the most severe version in use`);
  }
  fromAssistant.sort();
  assert.ok(fromReport.includes(`TEC-11|old|out_of_support|${shift(-300)}`) && fromReport.includes(`TEC-12|x|extended_support|${shift(600)}`), 'the report sees both');
  assert.deepEqual(fromAssistant, fromReport, 'same versions, states and dates as the End of support report');
}

/**
 * CA12: the version and owner filters (version labels exact without case, owner names exact
 * without case) and the many-to-many owner groups. Every technology here has its own publisher,
 * so the assertions do not depend on the rows the other tests seed.
 */
async function testVersionAndOwnerFilters(harness: Harness, runner: QueryRunner, s: Seed) {
  const t = s.tenantId;
  const technology = (n: number, name: string, editor: string) => insertId(runner,
    `INSERT INTO technologies (tenant_id, item_number, name, family, editor, hosting_type, lifecycle)
     VALUES ($1, $2, $3, 'database', $4, 'on_prem', 'active')`,
    [t, n, name, editor]);
  const version = (technologyId: string, label: string) => insertId(runner,
    `INSERT INTO technology_versions (tenant_id, technology_id, label) VALUES ($1, $2, $3)`,
    [t, technologyId, label]);
  const v16 = await technology(21, 'Version Sixteen', 'Versioned');
  const v164 = await technology(22, 'Version Sixteen Four', 'Versioned');
  const vUpper = await technology(23, 'Version Upper', 'Versioned');
  await version(v16, '16');
  await version(v164, '16.4');
  await version(vUpper, 'V16');

  const byVersion = (value: string) => list(harness, runner, s, { filters: { version: [value] } });
  assert.deepEqual(labels(await byVersion('16')), ['Version Sixteen'], '16 never matches 16.4');
  assert.deepEqual(labels(await byVersion('v16')), ['Version Upper'], 'the label compares without case (V16)');
  assert.deepEqual(labels(await byVersion('V16')), ['Version Upper']);
  assert.deepEqual(labels(await byVersion('16.4')), ['Version Sixteen Four']);
  assert.ok(labels(await byVersion('17')).length === 0);

  const paul = await insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status)
     SELECT $1, $2, 'Paul', 'Tester', role_id, 'enabled' FROM users WHERE tenant_id = $1 AND id = $3`,
    [t, `paul-${t.slice(0, 8)}@example.test`, s.users.full]);
  const owner = (technologyId: string, userId: string, type: 'it' | 'business') => runner.query(
    `INSERT INTO technology_owners (tenant_id, technology_id, user_id, owner_type) VALUES ($1, $2, $3, $4)`,
    [t, technologyId, userId, type]);
  const ownedIt = await technology(24, 'Owned IT', 'Owner Test');
  const ownedBusiness = await technology(25, 'Owned Business', 'Owner Test');
  const ownedTwice = await technology(26, 'Owned Twice', 'Owner Test');
  await technology(27, 'Owned Nobody', 'Owner Test');
  await owner(ownedIt, paul, 'it');
  await owner(ownedBusiness, paul, 'business');
  await owner(ownedTwice, paul, 'it');
  await owner(ownedTwice, s.users.full, 'it');

  const byOwner = (field: 'owner' | 'it_owner' | 'business_owner', value: string) =>
    list(harness, runner, s, { filters: { [field]: [value] } });
  assert.deepEqual(labels(await byOwner('it_owner', 'Paul Tester')), ['Owned IT', 'Owned Twice'], 'only the IT owners');
  assert.deepEqual(labels(await byOwner('business_owner', 'Paul Tester')), ['Owned Business'], 'only the business owners');
  assert.deepEqual(labels(await byOwner('owner', 'Paul Tester')), ['Owned Business', 'Owned IT', 'Owned Twice'], 'any type');
  assert.deepEqual(labels(await byOwner('it_owner', 'paul tester')), ['Owned IT', 'Owned Twice'], 'the name compares without case');
  assert.deepEqual(labels(await byOwner('it_owner', 'Nobody Here')), []);

  const aggregate = (groupBy: string) => harness.aggregates.execute(ctx(runner, s, 'full'), {
    entity_type: 'technologies',
    group_by: groupBy,
    filters: { publisher: ['Owner Test'] },
  });
  const byItOwner = await aggregate('it_owner');
  assert.deepEqual(
    byItOwner.groups.map((g: any) => [g.key, g.count]).sort(),
    [['Full Tester', 1], ['Paul Tester', 2]],
    'a technology counts once in each of its IT owners; one without an IT owner is in no group',
  );
  assert.equal(byItOwner.total, 4, 'the four technologies; the no-owner one is in no group');
  const byBusinessOwner = await aggregate('business_owner');
  assert.deepEqual(byBusinessOwner.groups.map((g: any) => [g.key, g.count]), [['Paul Tester', 1]]);
}

/**
 * LA22: the technology_versions family, one row per version, its support dates and state exactly
 * as the technology detail gives them, its use and servers, and the aggregate metrics and groups.
 */
async function testTechnologyVersions(harness: Harness, runner: QueryRunner, s: Seed) {
  const t = s.tenantId;
  const [{ today }] = await runner.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`);
  const shift = (days: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };
  const technology = await insertId(runner,
    `INSERT INTO technologies (tenant_id, item_number, name, family, editor, hosting_type, lifecycle)
     VALUES ($1, 31, 'Version Family', 'database', 'Versions', 'on_prem', 'active')`, [t]);
  const version = (label: string, standard: string | null, extended: string | null) => insertId(runner,
    `INSERT INTO technology_versions (tenant_id, technology_id, label, standard_support_end, extended_support_end)
     VALUES ($1, $2, $3, $4, $5)`, [t, technology, label, standard, extended]);
  const used = await version('used', shift(300), shift(900));
  await version('unused', '2027-03-31', '2027-12-31');
  await version('undated', null, null);
  const server = await insertId(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment, status) VALUES ($1, 'versions-srv', 'server', 'prod', 'active')`, [t]);
  await runner.query(`INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id) VALUES ($1, $2, $3, $4)`,
    [t, server, technology, used]);

  const versions = (input: Record<string, unknown> = {}, user: keyof Seed['users'] = 'full') =>
    harness.executor.execute(ctx(runner, s, user), { entity_type: 'technology_versions', ...input });
  const all = await versions({ filters: { technology: ['TEC-31'] } });
  assert.equal(all.total, 3, 'the three versions of the technology');
  assert.deepEqual(all.items.map((item: any) => item.ref), ['TEC-31', 'TEC-31', 'TEC-31'], 'a version has no reference of its own');
  const rows = new Map(all.items.map((item: any) => [item.metadata.label, item]));
  const usedRow: any = rows.get('used');
  assert.deepEqual(
    [usedRow.metadata.technology, usedRow.metadata.technology_name, usedRow.metadata.family, usedRow.metadata.lifecycle],
    ['TEC-31', 'Version Family', 'database', 'active'],
  );
  assert.deepEqual(
    [usedRow.metadata.in_use, usedRow.metadata.server_count, usedRow.metadata.support_status, usedRow.metadata.support_date],
    [true, 1, 'supported', shift(300)],
    'installed on a server in service',
  );
  assert.deepEqual([usedRow.metadata.end_of_standard_support, usedRow.metadata.end_of_support], [shift(300), shift(900)]);
  const unusedRow: any = rows.get('unused');
  assert.deepEqual(
    [unusedRow.metadata.in_use, unusedRow.metadata.server_count, unusedRow.metadata.support_date],
    [false, 0, '2027-03-31'],
    'no link: out of use, and its dates stay',
  );
  assert.deepEqual([unusedRow.metadata.end_of_standard_support, unusedRow.metadata.end_of_support], ['2027-03-31', '2027-12-31']);
  const undatedRow: any = rows.get('undated');
  assert.deepEqual(
    [undatedRow.metadata.support_status, undatedRow.metadata.support_date, undatedRow.metadata.end_of_standard_support, undatedRow.metadata.end_of_support, undatedRow.metadata.in_use],
    ['unknown', null, null, null, false],
  );
  assert.doesNotMatch(JSON.stringify(all.items.map((item: any) => ({ ...item, id: undefined }))), UUID_IN_TEXT, 'references and names only');

  // The family and the detail of the technology give the same versions, states and dates.
  const detail = await harness.executor.executeDetail(ctx(runner, s, 'full'), { entity_type: 'technologies', entity_id: 'TEC-31' });
  assert.equal(detail.data.versions.length, 3);
  for (const v of detail.data.versions) {
    const row: any = rows.get(v.label);
    assert.deepEqual(
      [row.metadata.end_of_standard_support, row.metadata.end_of_support, row.metadata.support_status, row.metadata.support_date, row.metadata.in_use, row.metadata.server_count],
      [v.standard_support_end, v.extended_support_end, v.support_status, v.support_date, v.in_use, v.server_count],
      `${v.label}: the detail's figures`,
    );
  }

  const notInUse = await versions({ filters: { technology: ['TEC-31'], in_use: ['false'] } });
  assert.deepEqual(notInUse.items.map((item: any) => item.metadata.label), ['undated', 'unused'], 'in_use false');
  const unknown = await versions({ filters: { technology: ['TEC-31'], support_status: ['unknown'] } });
  assert.deepEqual(unknown.items.map((item: any) => item.metadata.label), ['undated']);
  const label = await versions({ filters: { technology: ['TEC-31'], label: ['unused'] } });
  assert.deepEqual(label.items.map((item: any) => item.metadata.label), ['unused']);
  const byName = await versions({ filters: { technology: ['version family'] } });
  assert.equal(byName.total, 3, 'the exact technology name, without case');

  const aggregate = (input: Record<string, unknown>) => harness.aggregates.execute(ctx(runner, s, 'full'), {
    entity_type: 'technology_versions',
    filters: { technology: ['TEC-31'] },
    ...input,
  });
  const groups = await aggregate({ group_by: 'end_of_support_year' });
  const yearOf = (row: any) => (row.metadata.support_date ? row.metadata.support_date.slice(0, 4) : null);
  const expectedYears = new Map<string | null, number>();
  for (const item of all.items) {
    const year = yearOf(item);
    expectedYears.set(year, (expectedYears.get(year) ?? 0) + 1);
  }
  assert.deepEqual(
    groups.groups.map((g: any) => [g.key, g.count]).sort((a: any, b: any) => String(a[0]).localeCompare(String(b[0]))),
    [...expectedYears.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    'one group per end of support year, 2027 included',
  );
  assert.ok(groups.groups.some((g: any) => g.key === '2027'), 'the version that ends in 2027');
  const min = await aggregate({ group_by: 'technology', metric: 'end_of_support', function: 'min' });
  assert.equal(min.groups[0].value, '2027-12-31', 'MIN of end_of_support as YYYY-MM-DD');
  const max = await aggregate({ group_by: 'technology', metric: 'end_of_standard_support', function: 'max' });
  assert.equal(max.groups[0].value, shift(300));
  const servers = await aggregate({ group_by: 'technology', metric: 'server_count', function: 'sum' });
  assert.equal(servers.groups[0].value, 1);
  const count = await aggregate({ group_by: 'technology' });
  assert.deepEqual(count.groups, [{ key: 'Version Family', count: 3 }], 'one group for the technology, three versions');
  const inUseGroups = await aggregate({ group_by: 'in_use' });
  assert.deepEqual(
    inUseGroups.groups.map((g: any) => [g.key, g.count]).sort(),
    [['false', 2], ['true', 1]],
  );
  const filterValues = await harness.executor.executeFilterValues(ctx(runner, s, 'full'), {
    entity_type: 'technology_versions',
    fields: ['technology', 'family', 'lifecycle', 'end_of_support_year', 'support_status', 'in_use', 'label'],
  });
  assert.ok(filterValues.values.technology.includes('Version Family'), 'the technologies of the tenant');
  assert.ok(filterValues.values.family.includes('database') && filterValues.values.lifecycle.includes('active'));
  assert.ok(filterValues.values.end_of_support_year.includes('2027'), 'the years of the support dates');
  assert.deepEqual(filterValues.values.support_status.sort(), ['extended_support', 'out_of_support', 'supported', 'unknown']);
  assert.deepEqual(filterValues.values.in_use, ['true', 'false']);
  assert.deepEqual(filterValues.fields_ignored, ['label'], 'a label has no value list');

  // The application count follows the caller's application scope, as the technologies family.
  const pgForBc = await versions({ filters: { technology: ['TEC-1'] } }, 'bc');
  assert.ok(pgForBc.items.length > 0 && pgForBc.items.every((item: any) => item.metadata.application_count === 1),
    'a Business Contributor counts its own applications only');
  const pgForFull = await versions({ filters: { technology: ['TEC-1'] } }, 'full');
  assert.ok(pgForFull.items.every((item: any) => item.metadata.application_count === 2));
}

/**
 * The dynamic values of the new technologies filters: the version labels and the owner names of
 * one tenant, never another's.
 */
async function testVersionAndOwnerFilterValues(harness: Harness, runner: QueryRunner, s: Seed) {
  await useTenant(runner, s.otherTenantId);
  const otherRole = await insertId(runner,
    `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Owner role', 'Owner role')`, [s.otherTenantId]);
  const otherUser = await insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status)
     VALUES ($1, $2, 'Other', 'Owner', $3, 'enabled')`,
    [s.otherTenantId, `other-owner-${s.otherTenantId.slice(0, 8)}@example.test`, otherRole]);
  await runner.query(
    `INSERT INTO technology_versions (tenant_id, technology_id, label) VALUES ($1, $2, '99.99')`,
    [s.otherTenantId, s.otherTechnologyId]);
  await runner.query(
    `INSERT INTO technology_owners (tenant_id, technology_id, user_id, owner_type) VALUES ($1, $2, $3, 'it')`,
    [s.otherTenantId, s.otherTechnologyId, otherUser]);
  await useTenant(runner, s.tenantId);

  const values = await harness.executor.executeFilterValues(ctx(runner, s, 'full'), {
    entity_type: 'technologies',
    fields: ['version', 'owner', 'it_owner', 'business_owner'],
  });
  assert.deepEqual(values.fields_ignored, []);
  assert.ok(values.values.version.includes('16'), 'this tenant\'s version labels');
  assert.ok(values.values.version.includes('V16'), 'the label keeps its spelling');
  assert.ok(!values.values.version.includes('99.99'), 'never another tenant\'s labels');
  assert.ok(values.values.it_owner.includes('Paul Tester'));
  assert.ok(values.values.it_owner.includes('Full Tester'));
  assert.ok(!values.values.it_owner.includes('Other Owner'), 'never another tenant\'s owners');
  assert.ok(values.values.owner.includes('Paul Tester') && values.values.owner.includes('Full Tester'));
  assert.deepEqual(values.values.business_owner, ['Paul Tester'], 'the business owners only');

  const isolated = await harness.executor.execute(ctx(runner, s, 'full'), {
    entity_type: 'technology_versions', q: '99.99',
  });
  assert.equal(isolated.total, 0, 'another tenant\'s version is not listed');
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
      await testApplicationsReachCache(runner, s);
      await testContextBounds(harness, runner, s);
      await testSupportStatus(harness, runner, s);
      await testServersAsTheTechnologyList(harness, runner, s);
      await testVersionAndOwnerFilters(harness, runner, s);
      await testTechnologyVersions(harness, runner, s);
      await testVersionAndOwnerFilterValues(harness, runner, s);
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
