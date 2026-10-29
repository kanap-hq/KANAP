// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { ensureDefaultAnalyticsAxis } from '../../analytics/analytics-axes.util';
import { PgClient, roleExists, seedNodes, seedPerson, seedRole } from '../../data-access/__tests__/data-access-test-helpers';

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-analytics-axes-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

// The family `analytics_axes` of Plaid and the MCP server (Plaid L9, lot C), against the database
// and the real `AnalyticsAxesService` of Master data › Analytics dimensions:
// - the rows of the screen's list, in its order, with the settings it shows; the unnamed default
//   dimension under the screen's label, in the person's language;
// - `required_for` where the setting applies: empty for a required dimension that is disabled,
//   the one nature of a required dimension that applies to it only;
// - `applies_to` filters; `field` is the budget_lines field that really filters the lines;
// - the detail by code: the counts of the screen's page (`get`);
// - refused in words without the right on analytics dimensions;
// - a person in limited access: every dimension listed, the line counts of the lines they read,
//   marked `limited`;
// - another tenant's dimensions never show;
// - the dimension's History tab reads by its code.
//
// Fixture: the default dimension (no name), `tower` (IT tower, values Network and Workplace),
// `capexonly` (CAPEX only, required, no value), `oldreq` (required, disabled). L1 OPEX paid by
// Alpha on Network, L2 OPEX paid by Bravo on Workplace, L3 CAPEX paid by Alpha without a value.

let app: INestApplicationContext;
let dataSource: DataSource;

type Seed = {
  tenantId: string;
  tag: string;
  axes: { default: string; tower: string; capexonly: string; oldreq: string };
  lines: { l1: string; l2: string; l3: string };
  alpha: string;
  otherAxis: string;
  english: string;
  french: string;
  noRight: string;
  roles: { reader: string };
};

async function inTransaction(fn: (runner: QueryRunner) => Promise<void>): Promise<void> {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await fn(runner);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

function pg(runner: QueryRunner): PgClient {
  return {
    connect: async () => undefined,
    end: async () => undefined,
    query: async (sql: string, params?: unknown[]) => ({ rows: await runner.query(sql, params as any[]) }),
  };
}

async function seedTenantRow(runner: QueryRunner, slug: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR","default_spend_currency":"EUR","default_capex_currency":"EUR"}'::jsonb,
             '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `${slug}-${tenantId.slice(0, 8)}`, `${slug} ${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return tenantId;
}

function axesService() {
  const { AnalyticsAxesService } = require('../../analytics/analytics-axes.service');
  return app.get(AnalyticsAxesService);
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const [{ current }] = await runner.query(`SELECT current_database() AS current`);
  assert.notEqual(current, 'appdb', 'this spec does not write the dev database');
  const service = axesService();
  const client = pg(runner);

  // Another tenant first, so the tenant of the spec stays the current one.
  const other = await seedTenantRow(runner, 'ai-axes-other');
  const otherAdmin = await seedPerson(client, other, 'all', await seedRole(client, other, 'Administrator'));
  const otherAxis = (await service.create({ code: 'zulu', name: `Zulu ${other.slice(0, 8)}` }, { manager: runner.manager, tenantId: other, userId: otherAdmin })).id;

  const tenantId = await seedTenantRow(runner, 'ai-axes');
  const tag = tenantId.slice(0, 8);
  const administrator = await seedRole(client, tenantId, 'Administrator');
  const english = await seedPerson(client, tenantId, 'all', administrator);
  const french = await seedPerson(client, tenantId, 'all', administrator);
  await runner.query(`UPDATE users SET locale = 'en' WHERE id = $1`, [english]);
  await runner.query(`UPDATE users SET locale = 'fr' WHERE id = $1`, [french]);
  const budgetOnly = await seedRole(client, tenantId, 'Budget reader');
  await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'budget', 'admin')`, [tenantId, budgetOnly]);
  const noRight = await seedPerson(client, tenantId, 'all', budgetOnly);
  const reader = await seedRole(client, tenantId, 'Analytics reader');
  for (const resource of ['analytics', 'budget']) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, 'reader')`, [tenantId, reader, resource]);
  }

  // Through the screen's service, which writes the History tab's entries.
  const ctx = { manager: runner.manager, tenantId, userId: english };
  const defaultAxis = await ensureDefaultAnalyticsAxis(runner.manager, tenantId);
  const tower = (await service.create({ code: 'tower', name: `IT tower ${tag}`, description: 'Where the cost sits' }, ctx)).id;
  const capexonly = (await service.create({ code: 'capexonly', name: `Capex only ${tag}`, applies_to: 'capex', required: true }, ctx)).id;
  const oldreq = (await service.create({ code: 'oldreq', name: `Old required ${tag}`, required: true, open_values: true }, ctx)).id;
  await runner.query(`UPDATE analytics_axes SET status = 'disabled', disabled_at = '2020-01-01T12:00:00Z' WHERE id = $1`, [oldreq]);
  const network = await insertId(runner, `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Network')`, [tenantId, tower]);
  const workplace = await insertId(runner, `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Workplace')`, [tenantId, tower]);

  const company = (name: string) => insertId(runner,
    `INSERT INTO companies (tenant_id, name, country_iso, city, status, base_currency) VALUES ($1, $2, 'FR', 'Lyon', 'enabled', 'EUR')`, [tenantId, `${name} ${tag}`]);
  const alpha = await company('Alpha');
  const bravo = await company('Bravo');
  const line = (number: number, nature: 'opex' | 'capex', payer: string) => insertId(runner,
    `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status, paying_company_id)
     VALUES ($1, $2, $3, $4, 'EUR', '2020-01-01', 'enabled', $5)`, [tenantId, nature, number, `Axis line ${number} ${tag}`, payer]);
  const l1 = await line(1, 'opex', alpha);
  const l2 = await line(2, 'opex', bravo);
  const l3 = await line(3, 'capex', alpha);
  for (const [item, value] of [[l1, network], [l2, workplace]]) {
    await runner.query(`INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`, [tenantId, item, tower, value]);
  }
  return {
    tenantId, tag, axes: { default: defaultAxis, tower, capexonly, oldreq }, lines: { l1, l2, l3 }, alpha,
    otherAxis, english, french, noRight, roles: { reader },
  };
}

function context(runner: QueryRunner, s: Seed, userId: string) {
  return { tenantId: s.tenantId, userId, isPlatformHost: false, surface: 'mcp', authMethod: 'api_key', manager: runner.manager } as any;
}

function executors() {
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { AiRecordHistoryService } = require('../ai-record-history.service');
  return { query: app.get(AiQueryExecutor), aggregates: app.get(AiAggregateExecutor), history: app.get(AiRecordHistoryService) };
}

async function rejection(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail('expected a refusal');
}

async function withoutSurfaceChecks<T>(fn: () => Promise<T>): Promise<T> {
  const { AiPolicyService } = require('../ai-policy.service');
  const policy = app.get(AiPolicyService);
  const original = policy.assertSurfaceAccess;
  policy.assertSurfaceAccess = async () => undefined;
  try {
    return await fn();
  } finally {
    policy.assertSurfaceAccess = original;
  }
}

const refs = (result: any) => result.items.map((item: any) => item.ref);

async function testListAndDetailAsTheScreen(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query } = executors();
    const ctx = context(runner, s, s.english);
    const service = axesService();
    const sctx = { manager: runner.manager, tenantId: s.tenantId };

    const listed: any = await query.execute(ctx, { entity_type: 'analytics_axes' });
    const screen = (await service.list(sctx)).items;
    assert.deepEqual(listed.items.map((item: any) => item.id), screen.map((axis: any) => axis.id), 'the screen\'s rows, in its order');
    assert.deepEqual(refs(listed), ['default', 'tower', 'capexonly', 'oldreq']);
    for (const axis of screen) {
      const item = listed.items.find((entry: any) => entry.id === axis.id);
      assert.deepEqual(
        [item.metadata.applies_to, item.metadata.required, item.metadata.open_values, item.status, item.metadata.is_default, item.metadata.sort_order],
        [axis.applies_to ?? null, axis.required, axis.open_values, axis.status, axis.is_default, axis.sort_order],
        `${axis.code}: the settings of the screen`,
      );
    }
    assert.match(listed.values_note, /analytics_categories, filtered on axis_code/);
    const byRef = new Map(listed.items.map((item: any) => [item.ref, item]));
    assert.equal((byRef.get('default') as any).label, 'Analytics dimension', 'the unnamed default under the screen\'s label');
    const french: any = await query.execute(context(runner, s, s.french), { entity_type: 'analytics_axes', filters: { is_default: ['true'] } });
    assert.deepEqual(french.items.map((item: any) => item.label), ['Dimension analytique'], 'in the person\'s language');

    // Required: the setting, and where it applies.
    assert.equal((byRef.get('oldreq') as any).status, 'disabled');
    assert.equal((byRef.get('oldreq') as any).metadata.required, true, 'a disabled dimension keeps its setting');
    assert.equal((byRef.get('oldreq') as any).metadata.required_for, null, 'and applies it nowhere');
    assert.equal((byRef.get('capexonly') as any).metadata.required_for, 'capex');
    const mandatory: any = await query.execute(ctx, { entity_type: 'analytics_axes', filters: { required_for: ['opex', 'capex'] } });
    assert.deepEqual(refs(mandatory), ['capexonly'], 'the dimensions required now');
    const setting: any = await query.execute(ctx, { entity_type: 'analytics_axes', filters: { required: ['true'] } });
    assert.deepEqual(refs(setting), ['capexonly', 'oldreq']);
    const capex: any = await query.execute(ctx, { entity_type: 'analytics_axes', filters: { applies_to: ['capex'] } });
    assert.deepEqual(refs(capex), ['capexonly']);
    const both: any = await query.execute(ctx, { entity_type: 'analytics_axes', filters: { applies_to: [null] } });
    assert.deepEqual(refs(both), ['default', 'tower', 'oldreq'], 'null: both natures');

    // The budget_lines field of each dimension, which filters the lines.
    assert.equal((byRef.get('default') as any).metadata.field, 'analytics_category');
    assert.equal((byRef.get('tower') as any).metadata.field, 'analytics:tower');
    assert.equal((byRef.get('oldreq') as any).metadata.field, null, 'a disabled dimension is no budget_lines field');
    const lines: any = await query.execute(ctx, { entity_type: 'budget_lines', filters: { [(byRef.get('tower') as any).metadata.field]: ['Network'] } });
    assert.deepEqual(lines.filters_ignored, []);
    assert.deepEqual(lines.items.map((item: any) => item.id), [s.lines.l1], 'the field filters the budget lines');

    // The detail by code: the counts of the screen's page.
    const detail: any = await query.executeDetail(ctx, { entity_type: 'analytics_axes', entity_id: 'tower' });
    const page = await service.get(s.axes.tower, sctx);
    assert.equal(detail.entity.id, s.axes.tower);
    assert.equal(detail.entity.ref, 'tower');
    for (const key of ['value_count', 'opex_count', 'capex_count', 'opex_missing', 'capex_missing', 'unusable_for']) {
      assert.deepEqual(detail.data[key], (page as any)[key], `tower: ${key} as the screen`);
    }
    assert.deepEqual([detail.data.value_count, detail.data.opex_count, detail.data.capex_missing], [2, 2, 1]);
    assert.equal(detail.data_access, undefined, 'access to all data: no note');
    const capexDetail: any = await query.executeDetail(ctx, { entity_type: 'analytics_axes', entity_id: s.axes.capexonly });
    assert.deepEqual(capexDetail.data.unusable_for, ['capex'], 'no value to choose on CAPEX');
    assert.deepEqual(capexDetail.data.required_for, ['capex']);

    // The aggregate counts the dimensions in memory.
    const { aggregates } = executors();
    const grouped: any = await aggregates.execute(ctx, { entity_type: 'analytics_axes', group_by: 'required_for' });
    assert.deepEqual(grouped.groups.map((group: any) => [group.key, group.count]), [[null, 3], ['capex', 1]]);
    assert.equal(grouped.total, 4);
  });
  console.log('ok - analytics_axes: the screen\'s rows and settings, required_for, applies_to, the budget_lines field, the detail counts');
}

async function testRightTenantAndHistory(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, aggregates, history } = executors();

    const ctx = context(runner, s, s.noRight);
    for (const run of [
      () => query.execute(ctx, { entity_type: 'analytics_axes' }),
      () => query.executeDetail(ctx, { entity_type: 'analytics_axes', entity_id: s.axes.tower }),
      () => aggregates.execute(ctx, { entity_type: 'analytics_axes', group_by: 'status' }),
    ]) {
      const refused = await rejection(run);
      assert.equal(refused?.getStatus?.(), 403);
      assert.match(String(refused?.message), /^You need the right to read analytics dimensions \(the right the Master data › Analytics dimensions screen asks for\)/, String(refused?.message));
    }

    const admin = context(runner, s, s.english);
    const all: any = await query.execute(admin, { entity_type: 'analytics_axes', limit: 100 });
    assert.doesNotMatch(JSON.stringify(all), /zulu|Zulu/);
    assert.equal((await rejection(() => query.executeDetail(admin, { entity_type: 'analytics_axes', entity_id: 'zulu' })))?.getStatus?.(), 404);
    assert.equal((await rejection(() => query.executeDetail(admin, { entity_type: 'analytics_axes', entity_id: s.otherAxis })))?.getStatus?.(), 404);

    const page: any = await withoutSurfaceChecks(() => history.getRecordHistory(admin, { entity_type: 'analytics_axes', entity_id: 'tower', limit: 20 }));
    assert.deepEqual(page.items.map((item: any) => item.action), ['create']);
    assert.equal(page.entity.type, 'analytics_axes');
  });
  console.log('ok - analytics_axes: refused in words without the right, another tenant invisible, history by code');
}

async function testLimitedPerson(): Promise<void> {
  await inTransaction(async (runner) => {
    const client = pg(runner);
    if (!(await roleExists(client))) {
      if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
      console.log('skip - analytics_axes limited person: kanap_data_limited not installed');
      return;
    }
    const s = await seed(runner);
    const person = await seedPerson(client, s.tenantId, 'limited', s.roles.reader);
    await seedNodes(client, s.tenantId, person, [{ type: 'company', id: s.alpha, access: 'read' }]);
    assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [person]))[0].mode, 'limited');
    const { query, aggregates } = executors();
    const ctx = context(runner, s, person);

    const listed: any = await query.execute(ctx, { entity_type: 'analytics_axes' });
    assert.equal(listed.total, 4, 'every dimension, as the screen');
    assert.equal(listed.data_access, 'limited');
    assert.match(listed.data_access_note, /every record of this family is listed/);
    const detail: any = await query.executeDetail(ctx, { entity_type: 'analytics_axes', entity_id: 'tower' });
    assert.equal(detail.data_access, 'limited');
    assert.match(detail.data_access_note, /within your access/);
    assert.deepEqual([detail.data.value_count, detail.data.opex_count, detail.data.capex_missing], [2, 1, 1], 'the lines of Alpha only');
    const grouped: any = await aggregates.execute(ctx, { entity_type: 'analytics_axes', group_by: 'status' });
    assert.equal(grouped.data_access, 'limited');
  });
  console.log('ok - analytics_axes: a limited person reads every dimension, the line counts of their lines, marked limited');
}

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-analytics-axes-query.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  dataSource = app.get(DataSource);
  const failures: string[] = [];
  try {
    for (const [name, test] of [
      ['list and detail as the screen', testListAndDetailAsTheScreen],
      ['right, tenant and history', testRightTenantAndHistory],
      ['limited person', testLimitedPerson],
    ] as Array<[string, () => Promise<void>]>) {
      try {
        await test();
      } catch (error: any) {
        failures.push(`${name}: ${error?.stack ?? error}`);
      }
    }
  } finally {
    await app.close();
  }
  if (failures.length) {
    console.error(failures.join('\n\n'));
    process.exit(1);
  }
  console.log('ai-analytics-axes-query.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
