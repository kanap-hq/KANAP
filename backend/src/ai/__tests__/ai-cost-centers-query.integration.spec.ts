// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { PgClient, roleExists, seedNodes, seedPerson, seedRole } from '../../data-access/__tests__/data-access-test-helpers';

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-cost-centers-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

// The `cost_centers` family of Plaid and the MCP server (Plaid L9, lot A), against the database and
// the real services of the application:
// - the rows and their order are those of `CostCentersService.listAll` (every node, the disabled one
//   included, in the tree's order), the detail's counts those of `CostCentersService.get`;
// - `under` gives every level below a group (the group left out), `parent` the nodes directly under it;
// - a group without a budget holder reads null, a holder without a name null too, never their email;
// - `q` follows the screen's quick search (code, name, path), the exact code or name first, each row
//   saying where it matched (`matched_on`);
// - two cost centers of one name under two groups, told apart by code and path;
// - an aggregate by company; the detail by code, with the nodes directly under it;
// - without the cost centers right: refused in words naming the screen;
// - a person in limited access reads the whole tree; the detail's line counts are within their
//   access, marked `data_access: limited`;
// - another tenant's nodes never show.
//
// Tree (sort order puts `CC-X` first at the top level):
//   CC-X  "Group IT support"  cost center, Bravo, disabled, no holder
//   GRP-IT "Group IT"         group, no holder
//     DIV-A "Division A"      group, holder Hélène Holder
//       CC-A1 "Ops"           cost center, Alpha, holder without a name; 2 OPEX lines and 1 CAPEX line
//       CC-A2 "Network"       cost center, Alpha, holder Hélène Holder
//     DIV-B "Division B"      group, no holder
//       CC-B1 "Ops"           cost center, Bravo, no holder

let app: INestApplicationContext;
let dataSource: DataSource;

type Seed = {
  tenantId: string;
  tag: string;
  alphaName: string;
  bravoName: string;
  ids: Record<'CC-X' | 'GRP-IT' | 'DIV-A' | 'CC-A1' | 'CC-A2' | 'DIV-B' | 'CC-B1', string>;
  namelessEmail: string;
  otherId: string;
  otherCode: string;
  admin: string;
  budgetOnly: string;
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

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  return (await runner.query(`${sql} RETURNING id`, params))[0].id;
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

async function seedCompany(runner: QueryRunner, tenantId: string, name: string): Promise<string> {
  return insertId(runner,
    `INSERT INTO companies (tenant_id, name, country_iso, city, status, base_currency) VALUES ($1, $2, 'FR', 'Lyon', 'enabled', 'EUR')`,
    [tenantId, name]);
}

async function seedNode(
  runner: QueryRunner,
  tenantId: string,
  node: { code: string; name: string; kind: 'group' | 'cost_center'; parent?: string; company?: string; owner?: string; order?: number; disabled?: boolean },
): Promise<string> {
  return insertId(runner,
    `INSERT INTO cost_centers (tenant_id, code, kind, name, description, parent_id, company_id, owner_user_id, sort_order, status, disabled_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      tenantId, node.code, node.kind, node.name, `About ${node.code}`, node.parent ?? null, node.company ?? null, node.owner ?? null,
      node.order ?? 0, node.disabled ? 'disabled' : 'enabled', node.disabled ? '2020-01-01T00:00:00Z' : null,
    ]);
}

async function seedLine(runner: QueryRunner, tenantId: string, number: number, nature: 'opex' | 'capex', costCenter: string, payer: string): Promise<void> {
  await runner.query(
    `INSERT INTO spend_items (tenant_id, nature, item_number, product_name, currency, effective_start, status, paying_company_id, cost_center_id)
     VALUES ($1, $2, $3, $4, 'EUR', '2020-01-01', 'enabled', $5, $6)`,
    [tenantId, nature, number, `CC line ${number}`, payer, costCenter]);
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const [{ current }] = await runner.query(`SELECT current_database() AS current`);
  assert.notEqual(current, 'appdb', 'this spec does not write the dev database');

  // Another tenant first, so the tenant of the spec stays the current one.
  const other = await seedTenantRow(runner, 'ai-cost-centers-other');
  const otherCode = `OTHER-${other.slice(0, 8)}`;
  const otherId = await seedNode(runner, other, { code: otherCode, name: 'Group IT', kind: 'group' });

  const tenantId = await seedTenantRow(runner, 'ai-cost-centers');
  const tag = tenantId.slice(0, 8);
  const alphaName = `Alpha ${tag}`;
  const bravoName = `Bravo ${tag}`;
  const alpha = await seedCompany(runner, tenantId, alphaName);
  const bravo = await seedCompany(runner, tenantId, bravoName);
  const client = pg(runner);
  const administrator = await seedRole(client, tenantId, 'Administrator');
  const holder = await insertId(runner,
    `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, status) VALUES ($1, 'Hélène', 'Holder', $2, $3, 'enabled')`,
    [tenantId, `helene-${tag}@example.invalid`, administrator]);
  const namelessEmail = `nameless-${tag}@example.invalid`;
  const nameless = await insertId(runner,
    `INSERT INTO users (tenant_id, first_name, last_name, email, role_id, status) VALUES ($1, '', ' ', $2, $3, 'enabled')`,
    [tenantId, namelessEmail, administrator]);

  const ids = {} as Seed['ids'];
  ids['CC-X'] = await seedNode(runner, tenantId, { code: 'CC-X', name: 'Group IT support', kind: 'cost_center', company: bravo, order: 0, disabled: true });
  ids['GRP-IT'] = await seedNode(runner, tenantId, { code: 'GRP-IT', name: 'Group IT', kind: 'group', order: 1 });
  ids['DIV-A'] = await seedNode(runner, tenantId, { code: 'DIV-A', name: 'Division A', kind: 'group', parent: ids['GRP-IT'], owner: holder });
  ids['CC-A1'] = await seedNode(runner, tenantId, { code: 'CC-A1', name: 'Ops', kind: 'cost_center', parent: ids['DIV-A'], company: alpha, owner: nameless });
  ids['CC-A2'] = await seedNode(runner, tenantId, { code: 'CC-A2', name: 'Network', kind: 'cost_center', parent: ids['DIV-A'], company: alpha, owner: holder, order: 1 });
  ids['DIV-B'] = await seedNode(runner, tenantId, { code: 'DIV-B', name: 'Division B', kind: 'group', parent: ids['GRP-IT'], order: 1 });
  ids['CC-B1'] = await seedNode(runner, tenantId, { code: 'CC-B1', name: 'Ops', kind: 'cost_center', parent: ids['DIV-B'], company: bravo });
  await seedLine(runner, tenantId, 1, 'opex', ids['CC-A1'], alpha);
  await seedLine(runner, tenantId, 2, 'opex', ids['CC-A1'], alpha);
  await seedLine(runner, tenantId, 3, 'capex', ids['CC-A1'], alpha);

  const budgetRole = await seedRole(client, tenantId, 'Budget only');
  await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'budget', 'admin')`, [tenantId, budgetRole]);
  const reader = await seedRole(client, tenantId, 'Cost center reader');
  for (const resource of ['budget', 'cost_centers']) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, 'reader')`, [tenantId, reader, resource]);
  }
  return {
    tenantId, tag, alphaName, bravoName, ids, namelessEmail, otherId, otherCode,
    admin: await seedPerson(client, tenantId, 'all', administrator),
    budgetOnly: await seedPerson(client, tenantId, 'all', budgetRole),
    roles: { reader },
  };
}

function context(runner: QueryRunner, s: Seed, userId: string) {
  return { tenantId: s.tenantId, userId, isPlatformHost: false, surface: 'mcp', authMethod: 'api_key', manager: runner.manager } as any;
}

function executors() {
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { CostCentersService } = require('../../cost-centers/cost-centers.service');
  return { query: app.get(AiQueryExecutor), aggregates: app.get(AiAggregateExecutor), service: app.get(CostCentersService) };
}

async function rejection(fn: () => Promise<unknown>): Promise<any> {
  try {
    await fn();
  } catch (error) {
    return error;
  }
  assert.fail('expected a refusal');
}

const refs = (result: any) => result.items.map((item: any) => item.ref);

async function testAsTheService(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, service } = executors();
    const ctx = context(runner, s, s.admin);
    const rows = await service.listAll({ includeDisabled: 'true' }, { manager: runner.manager, tenantId: s.tenantId });
    const listed: any = await query.execute(ctx, { entity_type: 'cost_centers', limit: 50 });
    assert.equal(listed.total, 7);
    assert.deepEqual(refs(listed), rows.map((row: any) => row.code), 'every node, in the tree order of the service');
    assert.deepEqual(refs(listed), ['CC-X', 'GRP-IT', 'DIV-A', 'CC-A1', 'CC-A2', 'DIV-B', 'CC-B1']);
    for (const [index, item] of listed.items.entries()) {
      const row = rows[index];
      assert.equal(item.id, row.id);
      assert.equal(item.label, row.name);
      assert.deepEqual(
        [item.metadata.kind, item.metadata.parent, item.metadata.parent_code, item.metadata.company, item.metadata.status, item.metadata.depth, item.metadata.path],
        [row.kind, row.parent_name, row.parent_code, row.company_name, row.status, row.depth, row.path],
        `${row.code}: the service's values`,
      );
    }
    const disabled = listed.items.find((item: any) => item.ref === 'CC-X');
    assert.equal(disabled.status, 'disabled', 'the disabled node is listed with its status');
    assert.equal(listed.items.find((item: any) => item.ref === 'GRP-IT').metadata.children, 2, 'its direct children');

    const detail: any = await query.executeDetail(ctx, { entity_type: 'cost_centers', entity_id: s.ids['CC-A1'] });
    const page = await service.get(s.ids['CC-A1'], { manager: runner.manager, tenantId: s.tenantId });
    assert.deepEqual([detail.data.opex_count, detail.data.capex_count, detail.data.description], [page.opex_count, page.capex_count, page.description]);
    assert.deepEqual([detail.data.opex_count, detail.data.capex_count], [2, 1]);
    assert.equal(detail.data_access, undefined, 'a person with access to all data: no note');
  });
  console.log('ok - cost centers: the rows, their order and the detail counts of the service');
}

async function testUnderAndParent(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query } = executors();
    const ctx = context(runner, s, s.admin);
    const under: any = await query.execute(ctx, { entity_type: 'cost_centers', filters: { under: 'GRP-IT' } });
    assert.deepEqual(refs(under), ['DIV-A', 'CC-A1', 'CC-A2', 'DIV-B', 'CC-B1'], 'two levels below the group, the group left out');
    assert.deepEqual(under.filters_applied, ['under']);
    const byName: any = await query.execute(ctx, { entity_type: 'cost_centers', filters: { under: 'division a' } });
    assert.deepEqual(refs(byName), ['CC-A1', 'CC-A2'], 'by name, without case');
    const centers: any = await query.execute(ctx, { entity_type: 'cost_centers', filters: { under: 'Group IT', kind: ['cost_center'] } });
    assert.deepEqual(refs(centers), ['CC-A1', 'CC-A2', 'CC-B1'], 'the cost centers under it, not the one named alike outside');
    const parent: any = await query.execute(ctx, { entity_type: 'cost_centers', filters: { parent: 'GRP-IT' } });
    assert.deepEqual(refs(parent), ['DIV-A', 'DIV-B'], 'parent: the direct children only');
    const unknown: any = await query.execute(ctx, { entity_type: 'cost_centers', filters: { under: 'GRP' } });
    assert.equal(unknown.total, 0, 'a part of a code names no group');
    assert.match(unknown.unmatched_note, /No cost center or group has the code or name given in under "GRP"/);
  });
  console.log('ok - cost centers: under at every level, parent one level');
}

async function testBudgetHolder(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query } = executors();
    const ctx = context(runner, s, s.admin);
    const listed: any = await query.execute(ctx, { entity_type: 'cost_centers', limit: 50 });
    const holder = (code: string) => listed.items.find((item: any) => item.ref === code).metadata.budget_holder;
    assert.equal(holder('GRP-IT'), null, 'a group without a budget holder');
    assert.equal(holder('DIV-A'), 'Hélène Holder');
    assert.equal(holder('CC-A1'), null, 'a holder without a name: null');
    assert.doesNotMatch(JSON.stringify(listed), new RegExp(s.namelessEmail), 'never the email');
    assert.doesNotMatch(JSON.stringify(listed), /owner_user_id|@example\.invalid/, 'no person id or email');
    const none: any = await query.execute(ctx, { entity_type: 'cost_centers', filters: { budget_holder: [null] } });
    assert.deepEqual(refs(none), ['CC-X', 'GRP-IT', 'CC-A1', 'DIV-B', 'CC-B1'], 'the nodes without a named budget holder');
    const values: any = await query.executeFilterValues(ctx, { entity_type: 'cost_centers', fields: ['budget_holder', 'company'] });
    assert.deepEqual(values.values.budget_holder, ['Hélène Holder', null]);
    assert.deepEqual(values.values.company, [s.alphaName, s.bravoName, null]);
    const detail: any = await query.executeDetail(ctx, { entity_type: 'cost_centers', entity_id: s.ids['CC-A1'] });
    assert.equal(detail.data.budget_holder, null, 'the detail too');
    assert.doesNotMatch(JSON.stringify(detail), new RegExp(s.namelessEmail));
  });
  console.log('ok - cost centers: the budget holder is a name or null, never an email');
}

async function testQuickSearch(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, service } = executors();
    const ctx = context(runner, s, s.admin);
    const searched: any = await query.execute(ctx, { entity_type: 'cost_centers', q: 'Group IT', limit: 50 });
    const screen = await service.listAll({ includeDisabled: 'true', q: 'Group IT' }, { manager: runner.manager, tenantId: s.tenantId });
    assert.deepEqual([...refs(searched)].sort(), screen.map((row: any) => row.code).sort(), 'the rows of the screen\'s quick search');
    assert.equal(searched.items[0].ref, 'GRP-IT', 'the exact name first, before the node above it in the tree');
    const on = Object.fromEntries(searched.items.map((item: any) => [item.ref, item.metadata.matched_on]));
    assert.deepEqual(on, { 'GRP-IT': 'name', 'CC-X': 'name', 'DIV-A': 'path', 'CC-A1': 'path', 'CC-A2': 'path', 'DIV-B': 'path', 'CC-B1': 'path' });
    const code: any = await query.execute(ctx, { entity_type: 'cost_centers', q: 'cc-a1' });
    assert.deepEqual(refs(code), ['CC-A1']);
    assert.equal(code.items[0].metadata.matched_on, 'code');
    const plain: any = await query.execute(ctx, { entity_type: 'cost_centers' });
    assert.equal(plain.items[0].metadata.matched_on, undefined, 'no quick search: no matched_on');
  });
  console.log('ok - cost centers: q as the screen, the exact match first with matched_on');
}

async function testSameNameAndAggregate(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, aggregates } = executors();
    const ctx = context(runner, s, s.admin);
    const ops: any = await query.execute(ctx, { entity_type: 'cost_centers', filters: { name: 'Ops' } });
    assert.deepEqual(refs(ops), ['CC-A1', 'CC-B1'], 'two nodes of one name, two codes');
    assert.deepEqual(ops.items.map((item: any) => item.metadata.path), ['Group IT › Division A › Ops', 'Group IT › Division B › Ops']);

    const byCompany: any = await aggregates.execute(ctx, { entity_type: 'cost_centers', group_by: 'company' });
    assert.deepEqual(byCompany.groups, [{ key: null, count: 3 }, { key: s.alphaName, count: 2 }, { key: s.bravoName, count: 2 }]);
    assert.equal(byCompany.total, 7);
    const centers: any = await aggregates.execute(ctx, { entity_type: 'cost_centers', group_by: 'company', filters: { kind: ['cost_center'], status: ['enabled'] } });
    assert.deepEqual(centers.groups, [{ key: s.alphaName, count: 2 }, { key: s.bravoName, count: 1 }]);
    const byParent: any = await aggregates.execute(ctx, { entity_type: 'cost_centers', group_by: 'parent', filters: { under: 'GRP-IT' } });
    assert.deepEqual(byParent.groups, [{ key: 'DIV-A · Division A', count: 2 }, { key: 'GRP-IT · Group IT', count: 2 }, { key: 'DIV-B · Division B', count: 1 }]);
  });
  console.log('ok - cost centers: same names apart, grouped by company and parent');
}

async function testDetailByCode(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query } = executors();
    const ctx = context(runner, s, s.admin);
    const detail: any = await query.executeDetail(ctx, { entity_type: 'cost_centers', entity_id: 'DIV-A' });
    assert.equal(detail.entity.id, s.ids['DIV-A']);
    assert.equal(detail.entity.ref, 'DIV-A');
    assert.equal(detail.data.description, 'About DIV-A');
    assert.equal(detail.data.budget_holder, 'Hélène Holder');
    assert.deepEqual(detail.data.children.map((child: any) => [child.code, child.name, child.kind]), [['CC-A1', 'Ops', 'cost_center'], ['CC-A2', 'Network', 'cost_center']]);
    assert.deepEqual([detail.data.opex_count, detail.data.capex_count], [0, 0]);
    const lower: any = await query.executeDetail(ctx, { entity_type: 'cost_centers', entity_id: 'grp-it' });
    assert.equal(lower.entity.ref, 'GRP-IT', 'the code without case');
    assert.equal(lower.data.budget_holder, null);
  });
  console.log('ok - cost centers: the detail by code, with the nodes directly under it');
}

async function testRight(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, aggregates } = executors();
    const ctx = context(runner, s, s.budgetOnly);
    for (const run of [
      () => query.execute(ctx, { entity_type: 'cost_centers' }),
      () => query.executeDetail(ctx, { entity_type: 'cost_centers', entity_id: s.ids['GRP-IT'] }),
      () => aggregates.execute(ctx, { entity_type: 'cost_centers', group_by: 'company' }),
    ]) {
      const refused = await rejection(run);
      assert.equal(refused?.getStatus?.(), 403);
      assert.equal(
        String(refused?.message),
        'You need the right to read cost centers (the right the Master data › Cost centers screen asks for), which your role does not give. An administrator can add it to your role.',
      );
    }
  });
  console.log('ok - cost centers: refused in words without the cost centers right');
}

async function testLimitedPerson(): Promise<void> {
  await inTransaction(async (runner) => {
    const client = pg(runner);
    if (!(await roleExists(client))) {
      if (process.env.CI) assert.fail('CI installs kanap_data_limited before the migrations');
      console.log('skip - cost centers limited person: kanap_data_limited not installed');
      return;
    }
    const s = await seed(runner);
    const person = await seedPerson(client, s.tenantId, 'limited', s.roles.reader);
    await seedNodes(client, s.tenantId, person, [{ type: 'cost_center', id: s.ids['CC-B1'], access: 'read' }]);
    assert.equal((await runner.query(`SELECT data_access_apply($1) AS mode`, [person]))[0].mode, 'limited');
    const { query, aggregates, service } = executors();
    const ctx = context(runner, s, person);

    const listed: any = await query.execute(ctx, { entity_type: 'cost_centers', limit: 50 });
    assert.equal(listed.total, 7, 'the whole tree, as the screen');
    assert.equal(listed.data_access, undefined, 'the list is the workspace\'s tree: no note');
    const grouped: any = await aggregates.execute(ctx, { entity_type: 'cost_centers', group_by: 'kind' });
    assert.deepEqual(grouped.groups, [{ key: 'cost_center', count: 4 }, { key: 'group', count: 3 }]);
    assert.equal(grouped.data_access, undefined);

    const detail: any = await query.executeDetail(ctx, { entity_type: 'cost_centers', entity_id: 'CC-A1' });
    const page = await service.get(s.ids['CC-A1'], { manager: runner.manager, tenantId: s.tenantId });
    assert.deepEqual([detail.data.opex_count, detail.data.capex_count], [page.opex_count, page.capex_count], 'the counts of the screen for this person');
    assert.ok(detail.data.opex_count < 2, `the lines outside their access are not counted (${detail.data.opex_count})`);
    assert.equal(detail.data_access, 'limited');
    assert.match(detail.data_access_note, /budget line counts of the detail \(.*\) cover only the lines their access lets them see/);
  });
  console.log('ok - cost centers: a limited person reads the whole tree, the line counts within their access');
}

async function testOtherTenant(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query } = executors();
    const ctx = context(runner, s, s.admin);
    const listed: any = await query.execute(ctx, { entity_type: 'cost_centers', q: 'Group IT', limit: 50 });
    assert.doesNotMatch(JSON.stringify(listed), new RegExp(`${s.otherCode}|${s.otherId}`), 'no node of another tenant');
    const refused = await rejection(() => query.executeDetail(ctx, { entity_type: 'cost_centers', entity_id: s.otherId }));
    assert.equal(refused?.getStatus?.(), 404);
    const byCode = await rejection(() => query.executeDetail(ctx, { entity_type: 'cost_centers', entity_id: s.otherCode }));
    assert.equal(byCode?.getStatus?.(), 404);
  });
  console.log('ok - cost centers: another tenant\'s nodes never show');
}

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-cost-centers-query.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  dataSource = app.get(DataSource);
  const failures: string[] = [];
  try {
    for (const [name, test] of [
      ['as the service', testAsTheService],
      ['under and parent', testUnderAndParent],
      ['budget holder', testBudgetHolder],
      ['quick search', testQuickSearch],
      ['same name and aggregate', testSameNameAndAggregate],
      ['detail by code', testDetailByCode],
      ['cost centers right', testRight],
      ['limited person', testLimitedPerson],
      ['other tenant', testOtherTenant],
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
  console.log('ai-cost-centers-query.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
