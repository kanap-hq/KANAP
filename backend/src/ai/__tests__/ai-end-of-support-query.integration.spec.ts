import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Plaid L5 lot 2: the two families of the End of support report (support_gaps, support_deadlines)
// and the application dates of CA3, read through the assistant's and the MCP server's tools.
//
// - `support_gaps` returns exactly the rows of `EndOfSupportService.gaps` (the route's list):
//   same subjects, same kinds; a Business Contributor sees the applications they take part in.
// - `support_deadlines` returns exactly the rows of `EndOfSupportService.deadlines` at the same
//   horizon, filters by subject type and dates them as YYYY-MM-DD.
// - An application's version, go-live date, end of support date and retirement date filter, sort
//   and group through the registry (query_entities), and the end of support groups by year.
// - Without `infrastructure:reader` the two report families are refused; no row carries a UUID.
// The AI surface checks (tenant settings, provider) are not under test: stubbed open.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-end-of-support-query-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

type Harness = { app: any; dataSource: DataSource; executor: any; aggregates: any; tools: any; report: any };
type Seed = {
  tenantId: string;
  users: Record<'full' | 'bc' | 'infra' | 'apps', string>;
  apps: Record<'owned' | 'other', string>;
  dates: Record<string, string>;
};

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-end-of-support-query.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const { AiPolicyService } = require('../ai-policy.service');
  const { EndOfSupportService } = require('../../technologies/reports/end-of-support.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  return {
    app,
    dataSource: app.get(DataSource),
    executor: app.get(AiQueryExecutor),
    aggregates: app.get(AiAggregateExecutor),
    tools: app.get(AiToolRegistry),
    report: app.get(EndOfSupportService),
  };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function useTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

function shift(from: string, days: number): string {
  const date = new Date(`${from}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-support-${tag}`, `AI support ${tag}`],
  );
  await useTenant(runner, tenantId);
  const [{ today }] = await runner.query(`SELECT to_char(CURRENT_DATE, 'YYYY-MM-DD') AS today`);

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
    full: await user('Full', await role('Full report', ['infrastructure', 'applications'])),
    bc: await user('Contributor', await role('Business Contributor', ['infrastructure', 'applications'])),
    infra: await user('Infra', await role('Infra only', ['infrastructure'])),
    apps: await user('Apps', await role('Apps only', ['applications'])),
  };

  const app = (n: number, name: string, endOfSupport: number | null, goLive: number | null, version: string | null, retired: number | null = null) => insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, hosting_model, status, end_of_support_date, go_live_date, version, retired_date)
     VALUES ($1, $2, $3, 'on_premise', 'enabled', $4, $5, $6, $7)`,
    [tenantId, name, `APP-${n}`, endOfSupport == null ? null : shift(today, endOfSupport), goLive == null ? null : shift(today, goLive), version, retired == null ? null : shift(today, retired)]);
  const apps = {
    owned: await app(1, 'Owned application', 45, -200, '16'),
    other: await app(2, 'Other application', 90, -100, '16.4', -10),
  };
  await runner.query(`INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
    [tenantId, apps.owned, users.bc]);

  const technology = (n: number, name: string, family: string) => insertId(runner,
    `INSERT INTO technologies (tenant_id, item_number, name, family, hosting_type, lifecycle)
     VALUES ($1, $2, $3, $4, 'on_prem', 'active')`,
    [tenantId, n, name, family]);
  const postgres = await technology(1, 'PostgreSQL', 'database');
  const linux = await technology(2, 'Linux', 'operating_system');
  const uninstalled = await technology(3, 'Uninstalled', 'database');
  const versioned = await technology(4, 'Versioned', 'database');
  const version = (technologyId: string, label: string, standard: number | null) => insertId(runner,
    `INSERT INTO technology_versions (tenant_id, technology_id, label, standard_support_end) VALUES ($1, $2, $3, $4)`,
    [tenantId, technologyId, label, standard == null ? null : shift(today, standard)]);
  const pg16 = await version(postgres, '16', 30);
  const pg15 = await version(postgres, '15', null);
  const linux24 = await version(linux, '24.04', 60);
  await version(versioned, '1', 120);

  const asset = (name: string, kind: string, endOfLife: number | null = null) => insertId(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment, status, end_of_life_date) VALUES ($1, $2, $3, 'prod', 'active', $4)`,
    [tenantId, name, kind, endOfLife == null ? null : shift(today, endOfLife)]);
  const srv1 = await asset('physical-one', 'physical_server', 20);
  const srv2 = await asset('physical-two', 'physical_server');
  const srv3 = await asset('physical-three', 'physical_server');
  const install = (assetId: string, technologyId: string, versionId: string | null, os = false) => runner.query(
    `INSERT INTO asset_technologies (tenant_id, asset_id, technology_id, technology_version_id, is_operating_system) VALUES ($1, $2, $3, $4, $5)`,
    [tenantId, assetId, technologyId, versionId, os]);
  await install(srv1, postgres, pg16);
  await install(srv2, linux, linux24, true);
  await install(srv3, postgres, pg15);
  await install(srv1, versioned, null);

  return {
    tenantId,
    users,
    apps,
    dates: {
      today,
      aEnd: shift(today, 45), bEnd: shift(today, 90),
      aGoLive: shift(today, -200), bGoLive: shift(today, -100), bRetired: shift(today, -10),
    },
  };
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

const gapKey = (row: any) => [row.gap, row.subject_type, row.subject_reference ?? row.subject_name, row.related_name, row.version].join('|');
const deadlineKey = (row: any) => [row.type, row.item_reference ?? row.item_name, row.version, row.date, row.state].join('|');

async function testSupportGapsMatchTheRoute(harness: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'full');
  const route = await harness.report.gaps({ manager: runner.manager, tenantId: s.tenantId, userId: s.users.full }, { scope: undefined });
  const ai = await harness.executor.execute(context, { entity_type: 'support_gaps', limit: 100 });
  assert.deepEqual(ai.filters_ignored, []);
  assert.equal(ai.total, route.items.length, 'the report row count');
  assert.deepEqual(ai.items.map((item: any) => gapKey({
    gap: item.metadata.gap, subject_type: item.metadata.subject_type, subject_reference: item.ref,
    subject_name: item.metadata.subject_name, related_name: item.metadata.related_name, version: item.metadata.version,
  })).sort(), route.items.map(gapKey).sort(), 'the same subjects and kinds as GET /gaps');
  const kinds = new Set(ai.items.map((item: any) => item.metadata.gap));
  for (const kind of ['application_without_server', 'technology_not_installed', 'link_without_version', 'version_without_end_date']) {
    assert.ok(kinds.has(kind), `the seeded gap ${kind}`);
  }
  assert.doesNotMatch(JSON.stringify(ai.items.map(({ id: _id, ...rest }: any) => rest)), UUID_IN_TEXT, 'references and names only');
  assert.ok(ai.items.every((item: any) => typeof item.id === 'string' && item.id.length > 0), 'the identifier stays in id');

  const grouped = await harness.aggregates.execute(context, { entity_type: 'support_gaps', group_by: 'gap' });
  const expected = new Map<string, number>();
  for (const row of route.items) expected.set(row.gap, (expected.get(row.gap) ?? 0) + 1);
  assert.deepEqual(
    grouped.groups.map((group: any) => [group.key, group.count]).sort((a: any, b: any) => String(a[0]).localeCompare(String(b[0]))),
    [...expected.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    'one group per kind of gap',
  );

  const filterValues = await harness.executor.executeFilterValues(context, { entity_type: 'support_gaps', fields: ['gap', 'subject_type'] });
  assert.deepEqual(filterValues.fields_ignored, []);
  assert.ok(filterValues.values.gap.includes('link_without_version'));
  assert.deepEqual(filterValues.values.subject_type.sort(), ['application', 'asset', 'technology']);
}

async function testSupportGapsFollowTheBusinessContributor(harness: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'bc');
  const route = await harness.report.gaps(
    { manager: runner.manager, tenantId: s.tenantId, userId: s.users.bc },
    { scope: { userId: s.users.bc } },
  );
  const ai = await harness.executor.execute(context, { entity_type: 'support_gaps', limit: 100 });
  assert.deepEqual(ai.filters_ignored, []);
  assert.deepEqual(
    ai.items.map((item: any) => gapKey({
      gap: item.metadata.gap, subject_type: item.metadata.subject_type, subject_reference: item.ref,
      subject_name: item.metadata.subject_name, related_name: item.metadata.related_name, version: item.metadata.version,
    })).sort(),
    route.items.map(gapKey).sort(),
    'a Business Contributor sees the report rows of their applications only',
  );
  assert.ok(ai.items.some((item: any) => item.metadata.subject_type === 'application' && item.ref === 'APP-1'));
  assert.ok(!ai.items.some((item: any) => item.metadata.subject_type === 'application' && item.ref === 'APP-2'),
    'another application is not shown');
}

async function testSupportDeadlinesMatchTheRoute(harness: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'full');
  const route = await harness.report.deadlines(
    { horizon_months: 12 },
    { manager: runner.manager, tenantId: s.tenantId, userId: s.users.full },
    { scope: undefined },
  );
  const ai = await harness.executor.execute(context, { entity_type: 'support_deadlines', filters: { horizon_months: ['12'] }, limit: 100 });
  assert.deepEqual(ai.filters_ignored, []);
  assert.equal(ai.total, route.items.length);
  assert.deepEqual(
    ai.items.map((item: any) => deadlineKey({
      type: item.metadata.subject_type, item_reference: item.ref, item_name: item.metadata.subject_name,
      version: item.metadata.version, date: item.metadata.date, state: item.metadata.state,
    })).sort(),
    route.items.map(deadlineKey).sort(),
    'the same deadlines as GET /technologies/reports/end-of-support',
  );
  const types = new Set(ai.items.map((item: any) => item.metadata.subject_type));
  for (const type of ['technology', 'operating_system', 'application', 'hardware']) assert.ok(types.has(type), `the seeded ${type} deadline`);
  assert.doesNotMatch(JSON.stringify(ai.items.map(({ id: _id, ...rest }: any) => rest)), UUID_IN_TEXT);
  assert.ok(ai.items.every((item: any) => /^\d{4}-\d{2}-\d{2}$/.test(item.metadata.date)), 'dates as YYYY-MM-DD');

  const onlyApplications = await harness.executor.execute(context, {
    entity_type: 'support_deadlines', filters: { horizon_months: ['12'], subject_type: ['application'] }, limit: 100,
  });
  assert.ok(onlyApplications.items.length > 0 && onlyApplications.items.every((item: any) => item.metadata.subject_type === 'application'),
    'the subject type filter');

  const min = await harness.aggregates.execute(context, { entity_type: 'support_deadlines', group_by: 'subject_type', metric: 'date', function: 'min' });
  const expectedMin = new Map<string, string>();
  for (const row of route.items) expectedMin.set(row.type, !expectedMin.has(row.type) || row.date < expectedMin.get(row.type)! ? row.date : expectedMin.get(row.type)!);
  for (const group of min.groups) {
    assert.equal(group.value, expectedMin.get(group.key), `${group.key}: the earliest deadline`);
    assert.match(String(group.value), /^\d{4}-\d{2}-\d{2}$/, 'MIN as YYYY-MM-DD');
  }
  const year = ai.items[0].metadata.date.slice(0, 4);
  const byYear = await harness.aggregates.execute(context, { entity_type: 'support_deadlines', group_by: 'end_of_support_year' });
  assert.equal(Number(byYear.groups.find((group: any) => group.key === year)?.count ?? 0), ai.items.filter((item: any) => item.metadata.date.startsWith(year)).length);
}

async function testReportWithoutApplicationRead(harness: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'infra');
  const gaps = await harness.executor.execute(context, { entity_type: 'support_gaps', limit: 100 });
  assert.ok(gaps.items.every((item: any) => item.metadata.subject_type !== 'application'),
    'a user who does not read applications sees no application gap');
  const deadlines = await harness.executor.execute(context, { entity_type: 'support_deadlines', limit: 100 });
  assert.ok(deadlines.items.every((item: any) => item.metadata.subject_type !== 'application'),
    'nor an application deadline');
  assert.ok(deadlines.items.some((item: any) => item.metadata.subject_type === 'technology'), 'the infrastructure deadlines stay');
}

async function testReportRights(harness: Harness, runner: QueryRunner, s: Seed) {
  const call = (tool: string, input: Record<string, unknown>) => harness.tools.execute(ctx(runner, s, 'apps'), tool, input);
  await rejects(runner, () => call('query_entities', { entity_type: 'support_gaps' }), /infrastructure/, 'query_entities support_gaps');
  await rejects(runner, () => call('query_entities', { entity_type: 'support_deadlines' }), /infrastructure/, 'query_entities support_deadlines');
  await rejects(runner, () => call('aggregate_entities', { entity_type: 'support_gaps', group_by: 'gap' }), /infrastructure/, 'aggregate_entities support_gaps');
  await rejects(runner, () => call('describe_entity_filters', { entity_type: 'support_deadlines' }), /infrastructure/, 'describe_entity_filters support_deadlines');
  await rejects(runner, () => call('get_filter_values', { entity_type: 'support_gaps', fields: ['gap'] }), /infrastructure/, 'get_filter_values support_gaps');
  // No report detail: the tool does not offer the families, and the executor refuses them.
  await rejects(runner, () => call('get_entity_detail', { entity_type: 'support_gaps', entity_id: 'APP-1' }),
    /entity_type/, 'get_entity_detail support_gaps is not in the tool schema');
  await rejects(runner, () => harness.executor.executeDetail(ctx(runner, s, 'full'), { entity_type: 'support_deadlines', entity_id: 'APP-1' }),
    /no detail of its own/, 'the executor still refuses a report detail');
}

async function testApplicationDates(harness: Harness, runner: QueryRunner, s: Seed) {
  const context = ctx(runner, s, 'full');
  const range = await harness.executor.execute(context, {
    entity_type: 'applications',
    filters: { end_of_support_date: { op: 'between', value: s.dates.today, valueTo: shift(s.dates.today, 60) } },
    limit: 100,
  });
  assert.deepEqual(range.filters_ignored, []);
  assert.deepEqual(range.items.map((item: any) => item.ref), ['APP-1'], 'the range takes Alpha, leaves Beta');
  assert.equal(range.items[0].metadata.end_of_support_date, s.dates.aEnd);
  assert.equal(range.items[0].metadata.version, '16');

  const sorted = await harness.executor.execute(context, {
    entity_type: 'applications', sort: { field: 'go_live_date', direction: 'asc' }, limit: 100,
  });
  assert.deepEqual(sorted.sort_ignored, []);
  const sortedRefs = sorted.items.map((item: any) => item.ref);
  assert.ok(sortedRefs.indexOf('APP-1') < sortedRefs.indexOf('APP-2'), 'go_live_date asc');

  const version = await harness.executor.execute(context, {
    entity_type: 'applications', filters: { version: '16.4' }, limit: 100,
  });
  assert.deepEqual(version.items.map((item: any) => item.ref), ['APP-2'], 'the version text filter');

  const byYear = await harness.aggregates.execute(context, { entity_type: 'applications', group_by: 'end_of_support_year' });
  const expectedYears = new Map<string, number>();
  for (const [ref, date] of [['APP-1', s.dates.aEnd], ['APP-2', s.dates.bEnd]] as const) {
    assert.ok(ref);
    const year = date.slice(0, 4);
    expectedYears.set(year, (expectedYears.get(year) ?? 0) + 1);
  }
  assert.deepEqual(
    byYear.groups.map((group: any) => [group.key, group.count]).sort((a: any, b: any) => String(a[0]).localeCompare(String(b[0]))),
    [...expectedYears.entries()].sort((a, b) => a[0].localeCompare(b[0])),
    'one group per end of support year',
  );

  const byVersion = await harness.aggregates.execute(context, { entity_type: 'applications', group_by: 'version' });
  assert.deepEqual(
    byVersion.groups.map((group: any) => [group.key, group.count]).sort(),
    [['16', 1], ['16.4', 1]],
    'one group per recorded version',
  );

  const min = await harness.aggregates.execute(context, { entity_type: 'applications', group_by: 'version', metric: 'end_of_support_date', function: 'min' });
  assert.equal(min.groups.find((group: any) => group.key === '16').value, s.dates.aEnd, 'MIN end_of_support_date as YYYY-MM-DD');
  const max = await harness.aggregates.execute(context, { entity_type: 'applications', group_by: 'version', metric: 'go_live_date', function: 'max' });
  assert.equal(max.groups.find((group: any) => group.key === '16.4').value, s.dates.bGoLive);
  const retired = await harness.aggregates.execute(context, { entity_type: 'applications', group_by: 'version', metric: 'retired_date', function: 'max' });
  assert.equal(retired.groups.find((group: any) => group.key === '16.4').value, s.dates.bRetired);
  assert.equal(retired.groups.find((group: any) => group.key === '16').value, null);
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const seedData = await seed(runner);
      await testSupportGapsMatchTheRoute(harness, runner, seedData);
      await testSupportGapsFollowTheBusinessContributor(harness, runner, seedData);
      await testSupportDeadlinesMatchTheRoute(harness, runner, seedData);
      await testReportWithoutApplicationRead(harness, runner, seedData);
      await testReportRights(harness, runner, seedData);
      await testApplicationDates(harness, runner, seedData);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-end-of-support-query.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
