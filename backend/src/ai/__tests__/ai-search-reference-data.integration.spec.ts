// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { PgClient, seedPerson, seedRole } from '../../data-access/__tests__/data-access-test-helpers';

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-search-reference-data-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

// `search_all` searches the reference data too (Plaid L9, lot E, decision 5), without an index:
// the cost centers, working-day calendars and analytics dimensions, by code and by name, through
// the reads of their families, against the database and the real services:
// - "Group IT" finds the group first, at the rank of a reference (an exact name), before the
//   partial matches; the nodes under it, whose path only holds the words, are not found;
// - at most five rows per family, `total` counting every match;
// - a person without the cost centers right receives no cost center; `entity_types` without
//   `cost_centers` receives none either, and `entity_types` with it alone searches it alone;
// - a dimension and a calendar are found by their code, with the link of their page;
// - a search about rates or currencies says the rates are read by query_entities, not searched here;
//   a code alone, a supplier named Devise or a cryptocurrency does not (Plaid L9, lot F, m5);
// - the words that name the family are taken out ("centre de coûts Group IT", "calendrier France"),
//   and a search that names a family without a match says how to read it, for a person who reads
//   it only (lot F, M1);
// - a family that fails is named, in words, and the others still answer.

let app: INestApplicationContext;
let dataSource: DataSource;

type Seed = {
  tenantId: string;
  tag: string;
  reader: string;
  noCostCenters: string;
  ids: { group: string; partial: string; division: string; security: string; axis: string; calendar: string };
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

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
}

async function seedNode(
  runner: QueryRunner,
  tenantId: string,
  node: { code: string; name: string; kind: 'group' | 'cost_center'; parent?: string; company?: string; order?: number },
): Promise<string> {
  return insertId(runner,
    `INSERT INTO cost_centers (tenant_id, code, kind, name, parent_id, company_id, sort_order, status) VALUES ($1, $2, $3, $4, $5, $6, $7, 'enabled')`,
    [tenantId, node.code, node.kind, node.name, node.parent ?? null, node.company ?? null, node.order ?? 0]);
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const [{ current }] = await runner.query(`SELECT current_database() AS current`);
  assert.notEqual(current, 'appdb', 'this spec does not write the dev database');
  const tenantId = randomUUID();
  const tag = tenantId.slice(0, 8);
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-search-reference-${tag}`, `ai-search-reference-${tag}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  const client = pg(runner);
  const role = async (name: string, resources: string[]) => {
    const id = await seedRole(client, tenantId, name);
    for (const resource of resources) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, 'reader')`, [tenantId, id, resource]);
    }
    return id;
  };
  const administrator = await seedPerson(client, tenantId, 'all', await seedRole(client, tenantId, 'Administrator'));
  const reader = await seedPerson(client, tenantId, 'all',
    await role('Reference readers', ['cost_centers', 'analytics', 'working_day_profiles', 'budget', 'applications']));
  const noCostCenters = await seedPerson(client, tenantId, 'all',
    await role('Without cost centers', ['analytics', 'working_day_profiles', 'budget', 'applications']));

  const company = await insertId(runner,
    `INSERT INTO companies (tenant_id, name, country_iso, city, status, base_currency) VALUES ($1, $2, 'FR', 'Lyon', 'enabled', 'EUR')`,
    [tenantId, `Company ${tag}`]);
  const group = await seedNode(runner, tenantId, { code: 'DSI-GRP', name: 'Group IT', kind: 'group', order: 1 });
  const partial = await seedNode(runner, tenantId, { code: 'CC-SUP', name: 'Group IT support', kind: 'cost_center', company, order: 2 });
  const division = await seedNode(runner, tenantId, { code: 'DIV-TRV', name: 'Travel division', kind: 'group', parent: group });
  const security = await seedNode(runner, tenantId, { code: 'FR-TRV-600', name: 'Security', kind: 'cost_center', parent: division, company });
  // Seven nodes named Ops: more than the five a family gives.
  for (let index = 1; index <= 7; index += 1) {
    await seedNode(runner, tenantId, { code: `OPS-${index}`, name: `Ops ${index}`, kind: 'cost_center', parent: division, company, order: index });
  }
  // An application whose name holds the words: a partial match of the index.
  await runner.query(
    `INSERT INTO applications (tenant_id, name, sequential_id, status) VALUES ($1, 'Group IT portal', 'APP-1', 'enabled')`,
    [tenantId],
  );

  const { AnalyticsAxesService } = require('../../analytics/analytics-axes.service');
  const { WorkingDayProfilesService } = require('../../working-day-profiles/working-day-profiles.service');
  const ctx = { manager: runner.manager, tenantId, userId: administrator };
  const axis = (await app.get(AnalyticsAxesService).create({ code: `tower${tag}`, name: 'IT tower' }, ctx)).id;
  const calendar = (await app.get(WorkingDayProfilesService).create({ code: `FR${tag}`, name: 'France', country_iso: 'FR' }, ctx)).id;
  return { tenantId, tag, reader, noCostCenters, ids: { group, partial, division, security, axis, calendar } };
}

function context(runner: QueryRunner, s: Seed, userId: string) {
  return { tenantId: s.tenantId, userId, isPlatformHost: false, surface: 'chat', authMethod: 'jwt', manager: runner.manager } as any;
}

function tools() {
  const { AiToolRegistry } = require('../ai-tool.registry');
  return app.get(AiToolRegistry);
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

const ofType = (result: any, type: string) => result.items.filter((item: any) => item.type === type);

async function testGroupItFirst(): Promise<void> {
  await inTransaction(async (runner) => withoutSurfaceChecks(async () => {
    const s = await seed(runner);
    const result = await tools().execute(context(runner, s, s.reader), 'search_all', { query: 'Group IT' });
    const first = result.items[0];
    assert.equal(first.type, 'cost_centers', JSON.stringify(result.items.map((item: any) => [item.type, item.ref, item.label])));
    assert.equal(first.ref, 'DSI-GRP');
    assert.equal(first.label, 'Group IT');
    assert.equal(first.status, 'enabled');
    assert.equal(first.page_url, `/master-data/cost-centers/${s.ids.group}`);
    assert.equal(first.metadata.matched_on, 'name');
    const centers = ofType(result, 'cost_centers').map((item: any) => item.ref);
    assert.deepEqual(centers, ['DSI-GRP', 'CC-SUP'], 'the exact name, then the partial one; the path does not count');
    const applications = ofType(result, 'applications');
    if (applications.length) {
      // A partial label of the index ranks with the partial cost center, after the exact one.
      assert.ok(result.items.indexOf(applications[0]) > 0);
    }
    assert.ok(result.entity_types.includes('cost_centers'));
    assert.deepEqual(result.failed_entity_types, []);
    assert.equal(result.not_read_here, undefined, 'the cost centers are read');

    // At most five per family, every match counted.
    const ops = await tools().execute(context(runner, s, s.reader), 'search_all', { query: 'Ops', entity_types: ['cost_centers'] });
    assert.equal(ops.items.length, 5);
    assert.equal(ops.total, 7);
    assert.equal(ops.truncated, true);
    assert.deepEqual(ops.entity_types, ['cost_centers'], 'the index is not searched');
  }));
  console.log('  Group IT first, at the rank of a reference: OK');
}

async function testRightsAndEntityTypes(): Promise<void> {
  await inTransaction(async (runner) => withoutSurfaceChecks(async () => {
    const s = await seed(runner);
    const without = await tools().execute(context(runner, s, s.noCostCenters), 'search_all', { query: 'Group IT' });
    assert.deepEqual(ofType(without, 'cost_centers'), [], 'no cost center without the right');
    assert.equal(without.entity_types.includes('cost_centers'), false);
    const asked = await tools().execute(context(runner, s, s.noCostCenters), 'search_all', { query: 'centre de coûts Group IT' });
    const unread = (asked.not_read_here ?? []).find((entry: any) => entry.family === 'cost centers');
    assert.ok(unread, 'a search about cost centers says they are not read for this person');
    assert.match(unread.note, /for a person with the Cost centers right, which this person's role does not give/);

    const applicationsOnly = await tools().execute(context(runner, s, s.reader), 'search_all', { query: 'Group IT', entity_types: ['applications'] });
    assert.deepEqual(ofType(applicationsOnly, 'cost_centers'), [], 'entity_types without cost_centers');
    assert.deepEqual(applicationsOnly.entity_types, ['applications']);
  }));
  console.log('  rights and entity_types: OK');
}

async function testDimensionCalendarAndRates(): Promise<void> {
  await inTransaction(async (runner) => withoutSurfaceChecks(async () => {
    const s = await seed(runner);
    const reader = context(runner, s, s.reader);
    const dimension = await tools().execute(reader, 'search_all', { query: `tower${s.tag}` });
    const axis = ofType(dimension, 'analytics_axes')[0];
    assert.ok(axis, 'the dimension by its code');
    assert.equal(axis.ref, `tower${s.tag}`);
    assert.equal(axis.label, 'IT tower');
    assert.equal(axis.page_url, `/master-data/analytics/dimensions/${s.ids.axis}`);
    assert.equal(dimension.items[0], axis, 'an exact code first');

    const calendars = await tools().execute(reader, 'search_all', { query: `fr${s.tag}` });
    const calendar = ofType(calendars, 'working_day_calendars')[0];
    assert.ok(calendar, 'the calendar by its code, without case');
    assert.equal(calendar.ref, `FR${s.tag}`);
    assert.equal(calendar.page_url, `/master-data/working-day-calendars/${s.ids.calendar}`);

    for (const query of ['taux de change', 'cours EUR', 'EUR/USD']) {
      const rates = await tools().execute(reader, 'search_all', { query });
      assert.equal(rates.not_searched_here?.[0]?.family, 'exchange rates', query);
      assert.equal(rates.not_searched_here[0].note, 'The exchange rates are read by query_entities on exchange_rates, not searched by search_all.');
      assert.equal((rates.not_read_here ?? []).some((entry: any) => entry.family === 'exchange rates'), false, 'read with the budget right');
      if (rates.families_not_read) {
        assert.equal(rates.families_not_read.some((line: string) => /^(cost centers|working-day calendars|analytics dimensions|exchange rates) \(/.test(line)), false);
      }
    }
    for (const query of ['EUR', 'USD Partners', 'Devise Consulting', 'Cryptocurrency wallet']) {
      const other = await tools().execute(reader, 'search_all', { query });
      assert.equal((other.not_searched_here ?? []).some((entry: any) => entry.family === 'exchange rates'), false, query);
    }
  }));
  console.log('  dimension and calendar by code, rates not searched: OK');
}

async function testTheWordsOfTheFamily(): Promise<void> {
  await inTransaction(async (runner) => withoutSurfaceChecks(async () => {
    const s = await seed(runner);
    const reader = context(runner, s, s.reader);
    for (const query of ['centre de coûts Group IT', 'cost center Group IT', 'Centres de couts group it']) {
      const result = await tools().execute(reader, 'search_all', { query });
      const centers = ofType(result, 'cost_centers').map((item: any) => item.ref);
      assert.deepEqual(centers, ['DSI-GRP', 'CC-SUP'], `${query}: ${JSON.stringify(centers)}`);
      assert.equal(result.items[0].ref, 'DSI-GRP', `${query}: the exact name first`);
      assert.equal(result.not_searched_here, undefined, query);
    }
    const france = await tools().execute(reader, 'search_all', { query: 'calendrier France' });
    assert.deepEqual(ofType(france, 'working_day_calendars').map((item: any) => item.ref), [`FR${s.tag}`]);
    const tower = await tools().execute(reader, 'search_all', { query: 'dimension IT tower' });
    assert.deepEqual(ofType(tower, 'analytics_axes').map((item: any) => item.ref), [`tower${s.tag}`]);

    // A family named without a match: how to read it, never "none".
    const missing = await tools().execute(reader, 'search_all', { query: 'centre de coûts Inexistant' });
    assert.deepEqual(ofType(missing, 'cost_centers'), []);
    const note = (missing.not_searched_here ?? []).find((entry: any) => entry.family === 'cost centers');
    assert.ok(note, JSON.stringify(missing.not_searched_here));
    assert.equal(note.note, 'search_all compares the words of the search with the codes and names of the cost centers only. '
      + 'Read them by query_entities on cost_centers with q (a code or a word of a name) before saying whether one exists.');
    assert.doesNotMatch(note.note, /\b(no|none|aucun)\b/i);

    // Without the right: neither a row nor a note that would tell whether one exists.
    const without = await tools().execute(context(runner, s, s.noCostCenters), 'search_all', { query: 'centre de coûts Group IT' });
    const withoutMissing = await tools().execute(context(runner, s, s.noCostCenters), 'search_all', { query: 'centre de coûts Inexistant' });
    for (const result of [without, withoutMissing]) {
      assert.deepEqual(ofType(result, 'cost_centers'), []);
      assert.equal((result.not_searched_here ?? []).some((entry: any) => entry.family === 'cost centers'), false);
      assert.ok((result.not_read_here ?? []).some((entry: any) => entry.family === 'cost centers'));
    }
    const strip = (result: any) => JSON.stringify(result.not_read_here);
    assert.equal(strip(without), strip(withoutMissing), 'the same answer whether a center matches or not');
  }));
  console.log('  the words of the family, and a family named without a match: OK');
}

async function testAFamilyThatFails(): Promise<void> {
  await inTransaction(async (runner) => withoutSurfaceChecks(async () => {
    const s = await seed(runner);
    const { AiQueryExecutor } = require('../query/ai-query.executor');
    const executor = app.get(AiQueryExecutor);
    const original = executor.searchReferenceData;
    executor.searchReferenceData = async function (this: any, ctx: any, type: string, ...rest: any[]) {
      if (type === 'cost_centers') {
        // A failed statement: the savepoint keeps the transaction usable for the others.
        await ctx.manager.query('SELECT * FROM no_such_table_for_this_spec');
      }
      return original.call(this, ctx, type, ...rest);
    };
    try {
      const result = await tools().execute(context(runner, s, s.reader), 'search_all', { query: `tower${s.tag}` });
      assert.deepEqual(result.failed_entity_types, ['cost_centers']);
      assert.equal(result.complete, false);
      assert.match(result.warnings[0].message, /^The cost centers could not be searched \(.*\): a match may exist, and query_entities on cost_centers with q lists them\.$/);
      assert.ok(ofType(result, 'analytics_axes').length === 1, 'the other families still answer');
    } finally {
      executor.searchReferenceData = original;
    }
  }));
  console.log('  a family that fails is named: OK');
}

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-search-reference-data.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  dataSource = app.get(DataSource);
  const failures: string[] = [];
  try {
    for (const [name, test] of [
      ['Group IT first', testGroupItFirst],
      ['rights and entity_types', testRightsAndEntityTypes],
      ['dimension, calendar and rates', testDimensionCalendarAndRates],
      ['the words of the family', testTheWordsOfTheFamily],
      ['a family that fails', testAFamilyThatFails],
    ] as Array<[string, () => Promise<void>]>) {
      try {
        await test();
      } catch (error) {
        failures.push(name);
        console.error(`  ${name}: FAILED`, error);
      }
    }
  } finally {
    await app.close();
  }
  if (failures.length) throw new Error(`ai-search-reference-data.integration.spec: ${failures.length} failed (${failures.join(', ')})`);
  console.log('ai-search-reference-data.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
