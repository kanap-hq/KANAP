import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Incident reads in Plaid (CA11, AA7), against the AI query and aggregate executors:
//
// - `asset`, `application` and `technology` filter on the link table by exact reference or exact
//   name, case-insensitive: APP-1 never matches APP-12.
// - Grouping by a linked record counts an incident once per link (the group counts add up to more
//   than `total`), and an incident without a link is in no group.
// - `detected_month` and `resolved_month` filter and group on YYYY-MM; `resolution_hours` is the
//   average of the resolved, non-cancelled incidents with a non-negative delay, and a line column.
// - Date metrics answer YYYY-MM-DD, never String(Date).
// - A confidential incident the viewer cannot see enters no list, group or average.
// - A Business Contributor groups and filters only the applications they take part in.
// - Without the infrastructure read, `asset` and `technology` (fields, filters and groups) are
//   absent; without the applications read, `application` is.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-incident-read-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; executor: any; aggregates: any; registries: any; policy: any; incidents: any };

type Seed = {
  tenantId: string;
  reader: string;
  contributor: string;
  records: Record<string, string>;
};

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-incident-read-coverage.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { AiPolicyService } = require('../ai-policy.service');
  const { IncidentsService } = require('../../incidents/services/incidents.service');
  const registries = require('../query/registries');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  // The surface checks (tenant AI settings, provider, subscription) are not what this spec tests.
  const policy = app.get(AiPolicyService);
  policy.assertSurfaceAccess = async () => undefined;
  return {
    app,
    dataSource: app.get(DataSource),
    executor: app.get(AiQueryExecutor),
    aggregates: app.get(AiAggregateExecutor),
    registries,
    policy,
    incidents: app.get(IncidentsService),
  };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-incident-${tag}`, `AI incident ${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);

  const role = async (name: string, resources: string[]) => {
    const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, $2)`, [tenantId, name]);
    for (const resource of resources) {
      await runner.query(
        `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, 'reader')`,
        [tenantId, id, resource],
      );
    }
    return id;
  };
  const user = async (key: string, roleId: string) => insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, $3, 'Tester', $4, 'enabled')`,
    [tenantId, `${key}-${tag}@example.test`, key, roleId]);

  const reader = await user('Reader', await role('Incident Reader', ['incidents', 'applications', 'infrastructure']));
  const contributor = await user('Contributor', await role('Business Contributor', ['incidents', 'applications']));
  const other = await user('Other', await role('Other User', []));

  const application = (name: string, reference: string) => insertId(runner,
    `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, $2, $3, 'enabled')`,
    [tenantId, name, reference]);
  const app1 = await application('Alpha App', 'APP-1');
  const app2 = await application('Beta App', 'APP-12');

  const asset = (name: string, reference: string, hostname: string | null = null) => insertId(runner,
    `INSERT INTO assets (tenant_id, name, kind, environment, asset_reference, hostname)
     VALUES ($1, $2, 'server', 'prod', $3, $4)`,
    [tenantId, name, reference, hostname]);
  const asset1 = await asset('srv-one', 'AST-1', 'db-one.corp.example');
  const asset2 = await asset('srv-twelve', 'AST-12');
  const secretAsset = await asset('secret-asset', 'AST-99');

  const technology = (name: string, itemNumber: number) => insertId(runner,
    `INSERT INTO technologies (tenant_id, name, item_number, editor) VALUES ($1, $2, $3, 'Vendor')`,
    [tenantId, name, itemNumber]);
  const tech1 = await technology('PostgreSQL', 1);
  const tech2 = await technology('Postgres Twelve', 12);
  const secretTech = await technology('Secret Tech', 99);

  const incident = async (
    title: string,
    itemNumber: number,
    values: {
      severity: string;
      status: string;
      detectedAt: string;
      resolvedAt: string | null;
      confidential?: boolean;
      reporter?: string;
      owner?: string;
    },
  ) => insertId(runner,
    `INSERT INTO incidents
       (tenant_id, title, item_number, severity, status, detected_at, resolved_at,
        reporter_user_id, owner_user_id, confidential, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $6, $6)`,
    [
      tenantId, title, itemNumber, values.severity, values.status, values.detectedAt, values.resolvedAt,
      values.reporter ?? reader, values.owner ?? reader, values.confidential ?? false,
    ]);

  // Two incidents share APP-12 / AST-12 / TEC-12; only `one` also carries APP-1 / AST-1 / TEC-1.
  const one = await incident('One', 1, { severity: 'minor', status: 'open', detectedAt: '2026-10-05T10:00:00Z', resolvedAt: null });
  const two = await incident('Two', 2, { severity: 'minor', status: 'open', detectedAt: '2026-09-15T10:00:00Z', resolvedAt: null });
  // The resolution figures: 2 h, 4 h, a cancelled 6 h, an unresolved one and a negative delay.
  const twoHours = await incident('Two hours', 3, { severity: 'major', status: 'resolved', detectedAt: '2026-10-01T08:00:00Z', resolvedAt: '2026-10-01T10:00:00Z' });
  const fourHours = await incident('Four hours', 4, { severity: 'major', status: 'resolved', detectedAt: '2026-09-02T08:00:00Z', resolvedAt: '2026-09-02T12:00:00Z' });
  const cancelled = await incident('Cancelled after six hours', 5, { severity: 'major', status: 'cancelled', detectedAt: '2026-10-03T08:00:00Z', resolvedAt: '2026-10-03T14:00:00Z' });
  const unresolved = await incident('Not resolved', 6, { severity: 'major', status: 'in_progress', detectedAt: '2026-10-04T08:00:00Z', resolvedAt: null });
  const negative = await incident('Negative delay', 7, { severity: 'major', status: 'resolved', detectedAt: '2026-10-05T12:00:00Z', resolvedAt: '2026-10-05T10:00:00Z' });
  const hidden = await incident('Hidden confidential', 8, {
    severity: 'major',
    status: 'resolved',
    detectedAt: '2026-10-06T08:00:00Z',
    resolvedAt: '2026-10-06T12:00:00Z',
    confidential: true,
    reporter: other,
    owner: other,
  });

  const link = (table: string, column: string, incidentId: string, targetId: string) =>
    runner.query(`INSERT INTO ${table} (tenant_id, incident_id, ${column}) VALUES ($1, $2, $3)`, [tenantId, incidentId, targetId]);
  await link('incident_assets', 'asset_id', one, asset1);
  await link('incident_assets', 'asset_id', one, asset2);
  await link('incident_assets', 'asset_id', two, asset2);
  await link('incident_assets', 'asset_id', hidden, secretAsset);
  await link('incident_applications', 'application_id', one, app1);
  await link('incident_applications', 'application_id', one, app2);
  await link('incident_applications', 'application_id', two, app2);
  await link('incident_technologies', 'technology_id', one, tech1);
  await link('incident_technologies', 'technology_id', one, tech2);
  await link('incident_technologies', 'technology_id', two, tech2);
  await link('incident_technologies', 'technology_id', hidden, secretTech);

  // The Business Contributor takes part in Alpha App only.
  await runner.query(
    `INSERT INTO application_owners (tenant_id, application_id, user_id, owner_type) VALUES ($1, $2, $3, 'business')`,
    [tenantId, app1, contributor],
  );

  return {
    tenantId,
    reader,
    contributor,
    records: {
      one, two, twoHours, fourHours, cancelled, unresolved, negative, hidden,
      app1, app2, asset1, asset2, secretAsset, tech1, tech2, secretTech,
    },
  };
}

function context(runner: QueryRunner, seed: Seed, userId = seed.reader) {
  return {
    tenantId: seed.tenantId,
    userId,
    isPlatformHost: false,
    surface: 'mcp' as const,
    authMethod: 'api_key' as const,
    manager: runner.manager,
  };
}

const sorted = (ids: string[]) => [...ids].sort();

async function incidentIds(harness: Harness, ctx: any, input: Record<string, unknown> = {}): Promise<string[]> {
  const result = await harness.executor.execute(ctx, { entity_type: 'incidents', ...input });
  return sorted(result.items.map((item: any) => String(item.id)));
}

function groupCounts(result: any): Record<string, number> {
  return Object.fromEntries(result.groups.map((group: any) => [String(group.key), group.count]));
}

/** One test in a savepoint: a failed statement never poisons the seed transaction. */
async function inSavepoint<T>(runner: QueryRunner, fn: () => Promise<T>): Promise<T> {
  await runner.query('SAVEPOINT incident_read_test');
  try {
    const result = await fn();
    await runner.query('RELEASE SAVEPOINT incident_read_test');
    return result;
  } catch (error) {
    await runner.query('ROLLBACK TO SAVEPOINT incident_read_test');
    throw error;
  }
}

async function testExactLinkFilters(harness: Harness, runner: QueryRunner, s: Seed) {
  const ctx = context(runner, s);
  const r = s.records;
  await inSavepoint(runner, async () => {
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { application: ['APP-1'] } }), [r.one], 'APP-1 does not match APP-12');
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { application: ['app-12'] } }), sorted([r.one, r.two]), 'APP-12 by reference, case-insensitive');
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { application: ['alpha app'] } }), [r.one], 'an application exact name, case-insensitive');
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { application: [null] } }), sorted([r.twoHours, r.fourHours, r.cancelled, r.unresolved, r.negative]), 'no application at all');

    assert.deepEqual(await incidentIds(harness, ctx, { filters: { asset: ['AST-1'] } }), [r.one], 'AST-1 does not match AST-12');
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { asset: ['ast-12'] } }), sorted([r.one, r.two]), 'AST-12 by reference, case-insensitive');
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { asset: ['srv-one'] } }), [r.one], 'an asset exact name, case-insensitive');
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { asset: ['DB-one.corp.example'] } }), [r.one], 'an asset host name, case-insensitive');
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { asset: [null] } }), sorted([r.twoHours, r.fourHours, r.cancelled, r.unresolved, r.negative]), 'no asset at all');

    assert.deepEqual(await incidentIds(harness, ctx, { filters: { technology: ['TEC-1'] } }), [r.one], 'TEC-1 does not match TEC-12');
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { technology: ['tec-12'] } }), sorted([r.one, r.two]), 'TEC-12 by reference, case-insensitive');
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { technology: ['PostgreSQL'] } }), [r.one], 'a technology exact name');
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { technology: ['postgres twelve'] } }), sorted([r.one, r.two]), 'a technology exact name, case-insensitive');
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { technology: [null] } }), sorted([r.twoHours, r.fourHours, r.cancelled, r.unresolved, r.negative]), 'no technology at all');
  });
}

async function testLinkedGroups(harness: Harness, runner: QueryRunner, s: Seed) {
  const ctx = context(runner, s);
  const r = s.records;
  await inSavepoint(runner, async () => {
    const byAsset = await harness.aggregates.execute(ctx, { entity_type: 'incidents', group_by: 'asset' });
    assert.equal(byAsset.total, 7, 'every visible incident is in the total');
    assert.deepEqual(groupCounts(byAsset), { 'srv-one': 1, 'srv-twelve': 2 }, 'an incident counts once per linked asset, and an unlinked one is in no group');
    assert.equal('secret-asset' in groupCounts(byAsset), false, 'the confidential incident is in no group');

    const byApplication = await harness.aggregates.execute(ctx, { entity_type: 'incidents', group_by: 'application' });
    assert.deepEqual(groupCounts(byApplication), { 'Alpha App': 1, 'Beta App': 2 }, 'an incident counts once per linked application');

    const byTechnology = await harness.aggregates.execute(ctx, { entity_type: 'incidents', group_by: 'technology' });
    assert.deepEqual(groupCounts(byTechnology), { PostgreSQL: 1, 'Postgres Twelve': 2 }, 'an incident counts once per linked technology');
    assert.equal('Secret Tech' in groupCounts(byTechnology), false, 'no technology of the confidential incident');
  });
}

async function testMonths(harness: Harness, runner: QueryRunner, s: Seed) {
  const ctx = context(runner, s);
  const r = s.records;
  await inSavepoint(runner, async () => {
    const byMonth = await harness.aggregates.execute(ctx, { entity_type: 'incidents', group_by: 'detected_month' });
    assert.deepEqual(groupCounts(byMonth), { '2026-09': 2, '2026-10': 5 }, 'grouped by detection month');
    assert.equal(byMonth.total, 7, 'the confidential incident is not counted');

    assert.deepEqual(
      await incidentIds(harness, ctx, { filters: { detected_month: '2026-09' } }),
      sorted([r.two, r.fourHours]),
      'filtered on one detection month',
    );
    assert.deepEqual(
      await incidentIds(harness, ctx, { filters: { resolved_month: '2026-10' } }),
      sorted([r.twoHours, r.negative]),
      'filtered on one resolution month: a cancelled incident has none',
    );
    assert.deepEqual(
      await incidentIds(harness, ctx, { filters: { detected_month: ['2026-09', '2026-10'] } }),
      sorted([r.one, r.two, r.twoHours, r.fourHours, r.cancelled, r.unresolved, r.negative]),
      'a set of months filters on each exact month',
    );
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { detected_month: '2026-1' } }), [], 'a partial month matches nothing');
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { detected_month: '2026-11' } }), [], 'a month with no incident matches nothing');
  });
}

async function testResolutionHours(harness: Harness, runner: QueryRunner, s: Seed) {
  const ctx = context(runner, s);
  const r = s.records;
  await inSavepoint(runner, async () => {
    const counts = await harness.aggregates.execute(ctx, { entity_type: 'incidents', group_by: 'severity' });
    assert.deepEqual(groupCounts(counts), { minor: 2, major: 5 }, 'the cancelled, unresolved and negative rows still count as incidents');

    const average = await harness.aggregates.execute(ctx, {
      entity_type: 'incidents',
      group_by: 'severity',
      metric: 'resolution_hours',
      function: 'avg',
    });
    const major = average.groups.find((group: any) => group.key === 'major');
    const minor = average.groups.find((group: any) => group.key === 'minor');
    assert.equal(major.value, 3, '2 h and 4 h average 3.0: the cancelled, unresolved, negative and invisible incidents are left out');
    assert.equal(minor.value, null, 'no resolved incident, no average');

    // The extra rows live in a savepoint: they leave the seed as the other cases expect it.
    await runner.query('SAVEPOINT incident_resolution_extra');
    try {
      // An incident still open with a hand-entered resolution date has no delay and no resolution month.
      await insertId(runner,
        `INSERT INTO incidents (tenant_id, title, item_number, severity, status, detected_at, resolved_at, reporter_user_id, owner_user_id)
         VALUES ($1, 'Open with a date', 20, 'major', 'open', '2026-10-04T08:00:00Z', '2026-10-04T10:00:00Z', $2, $2)`,
        [s.tenantId, s.reader]);
      const withOpen = await harness.aggregates.execute(ctx, {
        entity_type: 'incidents', group_by: 'severity', metric: 'resolution_hours', function: 'avg',
      });
      assert.equal(withOpen.groups.find((group: any) => group.key === 'major').value, 3, 'the open incident with a date is still left out');
      assert.deepEqual(await incidentIds(harness, ctx, { filters: { resolved_month: '2026-10' } }), sorted([r.twoHours, r.negative]),
        'the open incident has no resolution month either');

      // An exact delay is rounded to one decimal in the group and on the line.
      const third = await insertId(runner,
        `INSERT INTO incidents (tenant_id, title, item_number, severity, status, detected_at, resolved_at, reporter_user_id, owner_user_id)
         VALUES ($1, 'Eighty minutes', 21, 'low', 'resolved', '2026-10-05T08:00:00Z', '2026-10-05T09:20:00Z', $2, $2)`,
        [s.tenantId, s.reader]);
      const rounded = await harness.aggregates.execute(ctx, {
        entity_type: 'incidents', group_by: 'severity', metric: 'resolution_hours', function: 'avg',
      });
      assert.equal(rounded.groups.find((group: any) => group.key === 'low').value, 1.3, '1 h 20 rounds to 1.3');
      const rowsAfter = await harness.executor.execute(ctx, { entity_type: 'incidents', filters: { status: ['resolved'] } });
      assert.equal(rowsAfter.items.find((item: any) => String(item.id) === third)?.metadata.resolution_hours, 1.3);
    } finally {
      await runner.query('ROLLBACK TO SAVEPOINT incident_resolution_extra');
      await runner.query('RELEASE SAVEPOINT incident_resolution_extra');
    }

    const rows = await harness.executor.execute(ctx, { entity_type: 'incidents', filters: { status: ['resolved'] } });
    const byId = new Map<string, any>(rows.items.map((item: any) => [String(item.id), item]));
    assert.equal(byId.get(r.twoHours)?.metadata.resolution_hours, 2, 'the line carries its resolution hours');
    assert.equal(byId.get(r.fourHours)?.metadata.resolution_hours, 4);
    assert.equal(byId.get(r.negative)?.metadata.resolution_hours, null, 'a negative delay is null on the line');
    assert.equal(byId.has(r.hidden), false, 'the confidential incident is not listed');

    const detail = await harness.executor.executeDetail(ctx, { entity_type: 'incidents', entity_id: r.twoHours });
    assert.equal(detail.entity.metadata.resolution_hours, 2, 'the detail carries it too');
  });
}

async function testDateMetrics(harness: Harness, runner: QueryRunner, s: Seed) {
  const ctx = context(runner, s);
  await inSavepoint(runner, async () => {
    for (const fn of ['min', 'max']) {
      const result = await harness.aggregates.execute(ctx, {
        entity_type: 'incidents',
        group_by: 'severity',
        metric: 'resolved_at',
        function: fn,
      });
      const major = result.groups.find((group: any) => group.key === 'major');
      assert.equal(major.value, fn === 'min' ? '2026-09-02' : '2026-10-05', `${fn} of resolved_at, the invisible incident left out`);
      assert.match(String(major.value), /^\d{4}-\d{2}-\d{2}$/, `${fn} is a day, never String(Date)`);
    }
  });
}

async function testFilterValues(harness: Harness, runner: QueryRunner, s: Seed) {
  const ctx = context(runner, s);
  await inSavepoint(runner, async () => {
    const values = await harness.executor.executeFilterValues(ctx, {
      entity_type: 'incidents',
      fields: ['asset', 'application', 'technology', 'asset_count'],
    });
    assert.deepEqual(sorted(values.values.asset), ['srv-one', 'srv-twelve'], 'asset values are exact names');
    assert.deepEqual(sorted(values.values.application), ['Alpha App', 'Beta App'], 'application values are exact names');
    assert.deepEqual(sorted(values.values.technology), sorted(['Postgres Twelve', 'PostgreSQL']), 'technology values are exact names');
    assert.equal('asset_count' in values.values, false, 'a count is not a set field');
    assert.deepEqual(values.fields_ignored, ['asset_count'], 'and the answer says so');

    const months = await harness.executor.executeFilterValues(ctx, {
      entity_type: 'incidents',
      fields: ['detected_month', 'resolved_month'],
    });
    assert.deepEqual(sorted(months.values.detected_month), ['2026-09', '2026-10'], 'the detection months, exact values');
    assert.deepEqual(sorted(months.values.resolved_month.filter((value: string | null) => value != null)), ['2026-09', '2026-10'], 'the resolution months');
    assert.ok(months.values.resolved_month.includes(null), 'an unresolved incident has no resolution month to filter on');
  });
}

async function testTextOperatorsAreRefused(harness: Harness, runner: QueryRunner, s: Seed) {
  const opts = {
    manager: runner.manager,
    tenantId: s.tenantId,
    viewer: { userId: s.reader, isAdmin: false },
    technologies: true,
    applications: true,
  };
  await inSavepoint(runner, async () => {
    for (const type of ['startsWith', 'endsWith', 'notContains', 'notEqual']) {
      await assert.rejects(
        () => harness.incidents.list({ filters: { linked_assets: { type, filter: 'srv' } } }, opts),
        /Use equals or contains/,
        type,
      );
    }
    // equals and contains both mean the exact reference or name, never a substring.
    const equals = await harness.incidents.list({ filters: { linked_assets: { type: 'equals', filter: 'AST-1' } } }, opts);
    assert.deepEqual(sorted(equals.items.map((item: any) => String(item.id))), [s.records.one]);
    const contains = await harness.incidents.list({ filters: { linked_assets: { type: 'contains', filter: 'srv' } } }, opts);
    assert.deepEqual(contains.items, [], 'contains is exact too: no partial name');
  });
}

async function testMonthsReadInUtcWhateverTheSession(harness: Harness, runner: QueryRunner, s: Seed) {
  const ctx = context(runner, s);
  await runner.query('SAVEPOINT incident_read_time_zone');
  try {
    // 31 October 23:30 UTC is 1 November 00:30 in Paris: the month stays October.
    const nearMidnight = await insertId(runner,
      `INSERT INTO incidents (tenant_id, title, item_number, severity, status, detected_at, reporter_user_id, owner_user_id)
       VALUES ($1, 'Near midnight', 30, 'minor', 'open', '2026-10-31T23:30:00Z', $2, $2)`,
      [s.tenantId, s.reader]);
    await runner.query(`SET LOCAL TIME ZONE 'Europe/Paris'`);
    const october = await incidentIds(harness, ctx, { filters: { detected_month: '2026-10' } });
    assert.equal(october.length, 6, 'the October incidents stay in October in a Paris session');
    assert.ok(october.includes(nearMidnight), 'the incident at 23:30 UTC is still in October');
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { detected_month: '2026-11' } }), [], 'never November');
    const byMonth = await harness.aggregates.execute(ctx, { entity_type: 'incidents', group_by: 'detected_month' });
    assert.equal(groupCounts(byMonth)['2026-10'], 6, 'the group counts it in October');
    assert.equal('2026-11' in groupCounts(byMonth), false);
    await runner.query("SET LOCAL TIME ZONE 'UTC'");
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT incident_read_time_zone');
    await runner.query('RELEASE SAVEPOINT incident_read_time_zone');
  }
}

async function testUtcDayFilters(harness: Harness, runner: QueryRunner, s: Seed) {
  await runner.query('SAVEPOINT incident_read_day_time_zone');
  try {
    // 31 October 23:30 UTC is 1 November 00:30 in Paris: the screen's day filter stays 31 October.
    const nearMidnight = await insertId(runner,
      `INSERT INTO incidents (tenant_id, title, item_number, severity, status, detected_at, reporter_user_id, owner_user_id)
       VALUES ($1, 'Near midnight day', 31, 'minor', 'open', '2026-10-31T23:30:00Z', $2, $2)`,
      [s.tenantId, s.reader]);
    await runner.query(`SET LOCAL TIME ZONE 'Europe/Paris'`);
    const options = {
      manager: runner.manager,
      tenantId: s.tenantId,
      viewer: { userId: s.reader, isAdmin: false },
      technologies: true,
      applications: true,
    };
    const day = await harness.incidents.list({
      filters: { detected_at: { filterType: 'date', type: 'equals', dateFrom: '2026-10-31' } },
      limit: 100,
    }, options);
    assert.deepEqual(day.items.map((item: any) => item.id), [nearMidnight], 'the UTC day is 31 October, not the Paris day');
    const nextDay = await harness.incidents.list({
      filters: { detected_at: { filterType: 'date', type: 'equals', dateFrom: '2026-11-01' } },
      limit: 100,
    }, options);
    assert.equal(nextDay.total, 0, 'the UTC day is never 1 November');
    const range = await harness.incidents.list({
      filters: { detected_at: { filterType: 'date', type: 'inRange', dateFrom: '2026-10-31', dateTo: '2026-10-31' } },
      limit: 100,
    }, options);
    assert.deepEqual(range.items.map((item: any) => item.id), [nearMidnight], 'a range uses the same UTC days');
    await runner.query("SET LOCAL TIME ZONE 'UTC'");
  } finally {
    await runner.query('ROLLBACK TO SAVEPOINT incident_read_day_time_zone');
    await runner.query('RELEASE SAVEPOINT incident_read_day_time_zone');
  }
}

async function testConfidentialInvisible(harness: Harness, runner: QueryRunner, s: Seed) {
  const ctx = context(runner, s);
  const r = s.records;
  await inSavepoint(runner, async () => {
    const list = await harness.executor.execute(ctx, { entity_type: 'incidents' });
    assert.equal(list.total, 7, 'the confidential incident is not listed');
    assert.equal(list.items.some((item: any) => item.id === r.hidden), false);
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { asset: ['secret-asset'] } }), [], 'nor found through its asset');
  });
}

async function testBusinessContributorScope(harness: Harness, runner: QueryRunner, s: Seed) {
  const ctx = context(runner, s, s.contributor);
  const r = s.records;
  await inSavepoint(runner, async () => {
    const byApplication = await harness.aggregates.execute(ctx, { entity_type: 'incidents', group_by: 'application' });
    assert.deepEqual(groupCounts(byApplication), { 'Alpha App': 1 }, 'only the applications they take part in');
    assert.equal(byApplication.total, 7, 'the incidents themselves are not narrowed');

    assert.deepEqual(await incidentIds(harness, ctx, { filters: { application: ['APP-1'] } }), [r.one], 'an application of theirs filters');
    assert.deepEqual(await incidentIds(harness, ctx, { filters: { application: ['APP-12'] } }), [], 'another application filters nothing');

    const values = await harness.executor.executeFilterValues(ctx, { entity_type: 'incidents', fields: ['application'] });
    assert.deepEqual(values.values.application, ['Alpha App'], 'the values list only their applications');

    assert.deepEqual(
      await incidentIds(harness, ctx, { filters: { application: [null] } }),
      sorted([r.two, r.twoHours, r.fourHours, r.cancelled, r.unresolved, r.negative]),
      'an incident linked only to an application outside their scope has no application',
    );

    // The screen list's count and its search follow the same participation: a hidden link never
    // counts and never makes the incident findable by its application's name.
    const listOptions = {
      manager: runner.manager,
      tenantId: s.tenantId,
      viewer: { userId: s.contributor, isAdmin: false },
      applications: true,
      technologies: true,
      applicationScope: { userId: s.contributor },
    };
    const list = await harness.incidents.list({ limit: 100 }, listOptions);
    const one = list.items.find((item: any) => item.id === r.one);
    const two = list.items.find((item: any) => item.id === r.two);
    assert.equal(Number(one.application_count), 1, 'only the application they take part in counts');
    assert.equal(Number(two.application_count), 0, 'a link outside their scope does not count');
    const hiddenSearch = await harness.incidents.list({ q: 'Beta App', limit: 100 }, listOptions);
    assert.equal(hiddenSearch.total, 0, 'the search does not reveal a link outside their participation');
    const referenceSearch = await harness.incidents.list({ q: 'APP-12', limit: 100 }, listOptions);
    assert.equal(referenceSearch.total, 0, 'nor the application reference');
    const visibleSearch = await harness.incidents.list({ q: 'Alpha App', limit: 100 }, listOptions);
    assert.equal(visibleSearch.total, 1, 'an application of theirs still finds the incident');
  });
}

async function testModuleReads(harness: Harness, runner: QueryRunner, s: Seed) {
  const ctx = context(runner, s, s.contributor);
  await inSavepoint(runner, async () => {
    const bcRegistry = await harness.registries.resolveAiEntityRegistry(ctx, 'incidents', async (type: string) =>
      !!(await harness.policy.canReadEntityType(ctx, type, ctx.manager)));
    assert.equal('application' in bcRegistry.fields, true, 'a reader of applications keeps the application field');
    assert.equal('application' in bcRegistry.aggregate.groupFields, true);
    assert.equal('asset' in bcRegistry.fields, false, 'without the infrastructure read, no asset field');
    assert.equal('technology' in bcRegistry.fields, false, 'nor a technology field');
    assert.equal('asset' in bcRegistry.aggregate.groupFields, false, 'nor their groups');
    assert.equal('technology' in bcRegistry.aggregate.groupFields, false);
    assert.equal('asset_count' in bcRegistry.fields, false, 'nor the asset count');

    await assert.rejects(
      () => harness.aggregates.execute(ctx, { entity_type: 'incidents', group_by: 'technology' }),
      /Unsupported group_by field/,
      'the group is refused',
    );

    // The gating maps each field to its own module, so an asset read without a technology read
    // still hides `technology`, and the other way around.
    const technologyOnly = await harness.registries.resolveAiEntityRegistry(ctx, 'incidents', async (type: string) => type === 'technologies');
    assert.equal('technology' in technologyOnly.fields, true);
    assert.equal('asset' in technologyOnly.fields, false);
    const assetsOnly = await harness.registries.resolveAiEntityRegistry(ctx, 'incidents', async (type: string) => type === 'assets');
    assert.equal('asset' in assetsOnly.fields, true);
    assert.equal('technology' in assetsOnly.fields, false);
    assert.equal('technology' in assetsOnly.aggregate.groupFields, false);
  });
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testExactLinkFilters(harness, runner, s);
      await testLinkedGroups(harness, runner, s);
      await testMonths(harness, runner, s);
      await testResolutionHours(harness, runner, s);
      await testDateMetrics(harness, runner, s);
      await testFilterValues(harness, runner, s);
      await testConfidentialInvisible(harness, runner, s);
      await testBusinessContributorScope(harness, runner, s);
      await testModuleReads(harness, runner, s);
      await testTextOperatorsAreRefused(harness, runner, s);
      await testMonthsReadInUtcWhateverTheSession(harness, runner, s);
      await testUtcDayFilters(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-incident-read-coverage.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
