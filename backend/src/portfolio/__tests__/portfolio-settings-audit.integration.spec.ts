import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { PortfolioClassificationController } from '../portfolio-classification.controller';
import { PortfolioClassificationService } from '../portfolio-classification.service';
import { PortfolioCriteriaController } from '../portfolio-criteria.controller';
import { PortfolioCriteriaService } from '../portfolio-criteria.service';
import { DEFAULT_EMPLOYMENT_TYPES } from '../portfolio-employment-type.entity';
import { PortfolioEmploymentTypesController } from '../portfolio-employment-types.controller';
import { PortfolioEmploymentTypesService } from '../portfolio-employment-types.service';
import { PortfolioSettingsController } from '../portfolio-settings.controller';
import { PortfolioSettingsService } from '../portfolio-settings.service';
import { DEFAULT_SKILLS } from '../portfolio-skill.entity';
import { PortfolioSkillsController } from '../portfolio-skills.controller';
import { PortfolioSkillsService } from '../portfolio-skills.service';
import { DEFAULT_TASK_TYPES } from '../portfolio-task-type.entity';
import { DEFAULT_TEAMS } from '../portfolio-team.entity';
import { PortfolioTeamsController } from '../portfolio-teams.controller';
import { PortfolioTeamsService } from '../portfolio-teams.service';
import { STARTING_PORTFOLIO_CATEGORIES, STARTING_PORTFOLIO_SOURCES } from '../starting-classification.seed';

// Every write of the portfolio settings lists enters the audit log, with the person who made it:
// one row per created, changed (a switch included) or deleted value, the whole row before and
// after, in the tenant of the request. A refused write leaves no row. The writes go through the
// controllers, as a request does: the person comes from the token's `sub`. Each test runs under
// a throwaway tenant in a rolled-back transaction.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file on a database lane.

type Row = {
  table_name: string;
  record_id: string;
  action: string;
  before_json: any;
  after_json: any;
  user_id: string | null;
  source: string;
  tenant_id: string;
};

type Ctx = { runner: QueryRunner; tenantId: string; userId: string; req: any };

async function withRollback(fn: (ctx: Ctx) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Settings audit', 'active', '{"language":"en"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `settings-audit-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const userId = randomUUID();
    const req = { tenant: { id: tenantId }, user: { sub: userId }, queryRunner: runner };
    await fn({ runner, tenantId, userId, req });
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function auditRows(runner: QueryRunner, table: string): Promise<Row[]> {
  return runner.query(
    `SELECT table_name, record_id::text AS record_id, action, before_json, after_json, user_id::text AS user_id, source, tenant_id::text AS tenant_id
       FROM audit_log WHERE tenant_id = app_current_tenant() AND table_name = $1 ORDER BY created_at, id`,
    [table],
  );
}

/** The rows of `table`: one per write, by the person, in the tenant, `user` as their source. */
async function expectRows(ctx: Ctx, table: string, expected: Array<[action: string, recordId: string]>): Promise<Row[]> {
  const rows = await auditRows(ctx.runner, table);
  assert.deepEqual(rows.map((row) => [row.action, row.record_id]), expected, table);
  for (const row of rows) {
    assert.equal(row.user_id, ctx.userId, `${table} ${row.action}: the person`);
    assert.equal(row.source, 'user', `${table} ${row.action}: the source`);
    assert.equal(row.tenant_id, ctx.tenantId, `${table} ${row.action}: the tenant`);
    assert.equal(row.table_name, table);
  }
  return rows;
}

async function rejects(run: () => Promise<unknown>) {
  await assert.rejects(run);
}

function classification() {
  return new PortfolioClassificationController(new PortfolioClassificationService(null as any, null as any, null as any, null as any));
}

/** Create, rename, switch off and delete one value: four rows, the whole value before and after. */
async function lifecycle(
  ctx: Ctx,
  table: string,
  ops: {
    create: () => Promise<any>;
    update: (id: string) => Promise<any>;
    toggle: (id: string) => Promise<any>;
    remove: (id: string) => Promise<any>;
  },
) {
  const created = await ops.create();
  await ops.update(created.id);
  await ops.toggle(created.id);
  await ops.remove(created.id);
  const rows = await expectRows(ctx, table, [
    ['create', created.id],
    ['update', created.id],
    ['update', created.id],
    ['delete', created.id],
  ]);
  const [create, rename, toggle, remove] = rows;
  assert.equal(create.before_json, null);
  assert.equal(create.after_json.name, 'First');
  assert.equal(create.after_json.id, created.id);
  assert.equal(rename.before_json.name, 'First');
  assert.equal(rename.after_json.name, 'Second');
  assert.equal(toggle.before_json.is_active, true);
  assert.equal(toggle.after_json.is_active, false);
  assert.equal(remove.before_json.name, 'Second');
  assert.equal(remove.after_json, null);
}

async function testClassificationLists() {
  await withRollback(async (ctx) => {
    const ctl = classification();
    const { req } = ctx;
    await lifecycle(ctx, 'portfolio_sources', {
      create: () => ctl.createSource({ name: 'First' }, req),
      update: (id) => ctl.updateSource(id, { name: 'Second', description: 'Board' }, req),
      toggle: (id) => ctl.updateSource(id, { is_active: false }, req),
      remove: (id) => ctl.deleteSource(id, req),
    });
    await lifecycle(ctx, 'portfolio_task_types', {
      create: () => ctl.createTaskType({ name: 'First' }, req),
      update: (id) => ctl.updateTaskType(id, { name: 'Second' }, req),
      toggle: (id) => ctl.updateTaskType(id, { is_active: false }, req),
      remove: (id) => ctl.deleteTaskType(id, req),
    });
    const category = await ctl.createCategory({ name: 'Holder' }, req);
    await lifecycle(ctx, 'portfolio_streams', {
      create: () => ctl.createStream({ category_id: category.id, name: 'First' }, req),
      update: (id) => ctl.updateStream(id, { name: 'Second' }, req),
      toggle: (id) => ctl.updateStream(id, { is_active: false }, req),
      remove: (id) => ctl.deleteStream(id, req),
    });
  });
  await withRollback(async (ctx) => {
    const ctl = classification();
    await lifecycle(ctx, 'portfolio_categories', {
      create: () => ctl.createCategory({ name: 'First' }, ctx.req),
      update: (id) => ctl.updateCategory(id, { name: 'Second' }, ctx.req),
      toggle: (id) => ctl.updateCategory(id, { is_active: false }, ctx.req),
      remove: (id) => ctl.deleteCategory(id, ctx.req),
    });
  });
}

async function testCategoryDeleteTakesItsStreams() {
  await withRollback(async (ctx) => {
    const ctl = classification();
    const category = await ctl.createCategory({ name: 'Growth' }, ctx.req);
    const sales = await ctl.createStream({ category_id: category.id, name: 'Sales' }, ctx.req);
    const export_ = await ctl.createStream({ category_id: category.id, name: 'Export' }, ctx.req);
    await ctl.deleteCategory(category.id, ctx.req);

    await expectRows(ctx, 'portfolio_categories', [['create', category.id], ['delete', category.id]]);
    const streams = await expectRows(ctx, 'portfolio_streams', [
      ['create', sales.id],
      ['create', export_.id],
      ['delete', sales.id],
      ['delete', export_.id],
    ]);
    assert.deepEqual(streams.slice(2).map((row) => row.before_json.name).sort(), ['Export', 'Sales']);
    assert.ok(streams.slice(2).every((row) => row.after_json === null));
  });
}

async function testRefusedWritesLeaveNoRow() {
  await withRollback(async (ctx) => {
    const { runner, tenantId, req } = ctx;
    const ctl = classification();
    const source = await ctl.createSource({ name: 'Board' }, req);
    const builtIn = (await runner.query(
      `INSERT INTO portfolio_sources (tenant_id, name, is_system) VALUES ($1, 'Built in', true) RETURNING id`, [tenantId],
    ))[0].id;
    const category = await ctl.createCategory({ name: 'Growth' }, req);
    const other = await ctl.createCategory({ name: 'Other' }, req);
    const stream = await ctl.createStream({ category_id: category.id, name: 'Sales' }, req);
    await runner.query(
      `INSERT INTO portfolio_requests (tenant_id, name, item_number, source_id, category_id, stream_id) VALUES ($1, 'Request', 900001, $2, $3, $4)`,
      [tenantId, source.id, category.id, stream.id],
    );
    const before = (await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = app_current_tenant()`))[0].n;

    await rejects(() => ctl.createSource({ name: 'Board' }, req));
    await rejects(() => ctl.updateSource(builtIn, { name: 'Board' }, req));
    await rejects(() => ctl.deleteSource(builtIn, req));
    await rejects(() => ctl.deleteSource(source.id, req));
    await rejects(() => ctl.deleteCategory(category.id, req));
    await rejects(() => ctl.deleteStream(stream.id, req));
    await rejects(() => ctl.updateStream(stream.id, { category_id: other.id }, req));

    const teams = new PortfolioTeamsController(new PortfolioTeamsService(null as any));
    const team = await teams.create({ name: 'Apps' }, req);
    await teams.create({ name: 'Apps north', parent_id: team.id }, req);
    const types = new PortfolioEmploymentTypesController(new PortfolioEmploymentTypesService(null as any));
    const contractor = await types.create({ name: 'Contractor' }, req);
    const builtInType = (await runner.query(
      `INSERT INTO portfolio_employment_types (tenant_id, name, is_system) VALUES ($1, 'Employee', true) RETURNING id`, [tenantId],
    ))[0].id;
    const kept = (await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = app_current_tenant()`))[0].n;
    assert.equal(kept - before, 3, 'the two teams and the contract type created');
    await rejects(() => teams.create({ name: 'Apps' }, req));
    await rejects(() => teams.delete(team.id, req));
    await rejects(() => types.create({ name: 'Contractor' }, req));
    await rejects(() => types.update(contractor.id, { name: 'Employee' }, req));
    await rejects(() => types.delete(builtInType, req));

    const after = (await runner.query(`SELECT count(*)::int AS n FROM audit_log WHERE tenant_id = app_current_tenant()`))[0].n;
    assert.equal(after, kept, 'no row for a refused write');
    assert.equal((await auditRows(runner, 'portfolio_sources')).length, 1, 'the creation of Board only');
    assert.equal((await auditRows(runner, 'portfolio_streams')).length, 1, 'the creation of Sales only');
  });
}

async function testTeamsAndContractTypes() {
  await withRollback(async (ctx) => {
    const teams = new PortfolioTeamsController(new PortfolioTeamsService(null as any));
    await lifecycle(ctx, 'portfolio_teams', {
      create: () => teams.create({ name: 'First' }, ctx.req),
      update: (id) => teams.update(id, { name: 'Second', description: 'Apps' }, ctx.req),
      toggle: (id) => teams.update(id, { is_active: false }, ctx.req),
      remove: (id) => teams.delete(id, ctx.req),
    });
    const types = new PortfolioEmploymentTypesController(new PortfolioEmploymentTypesService(null as any));
    await lifecycle(ctx, 'portfolio_employment_types', {
      create: () => types.create({ name: 'First' }, ctx.req),
      update: (id) => types.update(id, { name: 'Second' }, ctx.req),
      toggle: (id) => types.update(id, { is_active: false }, ctx.req),
      remove: (id) => types.delete(id, ctx.req),
    });
  });
}

async function testSeedsWriteOneRowPerValue() {
  await withRollback(async (ctx) => {
    const { runner, req } = ctx;
    const teams = new PortfolioTeamsController(new PortfolioTeamsService(null as any));
    assert.deepEqual(await teams.seedDefaults(req), { created: DEFAULT_TEAMS.length });
    const teamRows = await auditRows(runner, 'portfolio_teams');
    assert.equal(teamRows.length, DEFAULT_TEAMS.length);
    assert.ok(teamRows.every((row) => row.action === 'create' && row.user_id === ctx.userId && row.after_json?.id === row.record_id));
    // A second run creates nothing and writes nothing.
    assert.deepEqual(await teams.seedDefaults(req), { created: 0 });
    assert.equal((await auditRows(runner, 'portfolio_teams')).length, DEFAULT_TEAMS.length);

    const types = new PortfolioEmploymentTypesController(new PortfolioEmploymentTypesService(null as any));
    await types.create({ name: DEFAULT_EMPLOYMENT_TYPES[0].name }, req);
    assert.deepEqual(await types.seedDefaults(req), { created: DEFAULT_EMPLOYMENT_TYPES.length - 1 });
    const typeRows = await auditRows(runner, 'portfolio_employment_types');
    assert.equal(typeRows.length, DEFAULT_EMPLOYMENT_TYPES.length);
    assert.ok(typeRows.every((row) => row.action === 'create' && row.user_id === ctx.userId));

    const skills = new PortfolioSkillsController(new PortfolioSkillsService({ manager: runner.manager } as any, new AuditService({ manager: runner.manager } as any)));
    const seeded = await skills.seedDefaults(req);
    assert.equal(seeded.created, DEFAULT_SKILLS.length);
    const skillRows = await auditRows(runner, 'portfolio_skills');
    assert.equal(skillRows.length, DEFAULT_SKILLS.length);
    assert.ok(skillRows.every((row) => row.action === 'create' && row.user_id === ctx.userId && row.source === 'user'));

    const ctl = classification();
    await ctl.createSource({ name: STARTING_PORTFOLIO_SOURCES[0].name.en }, req);
    await ctl.seedDefaults(req);
    // The source created by hand, then the missing ones; every category and task type.
    for (const [table, total] of [
      ['portfolio_sources', STARTING_PORTFOLIO_SOURCES.length],
      ['portfolio_categories', STARTING_PORTFOLIO_CATEGORIES.length],
      ['portfolio_task_types', DEFAULT_TASK_TYPES.length],
    ] as const) {
      const rows = await auditRows(runner, table);
      assert.equal(rows.length, total, table);
      assert.equal(new Set(rows.map((row) => row.record_id)).size, total, `${table}: one row per value`);
      assert.ok(rows.every((row) => row.action === 'create' && row.user_id === ctx.userId && row.source === 'user'
        && row.before_json === null && row.after_json?.id === row.record_id && row.after_json?.name), table);
    }
    // A second run creates nothing and writes nothing.
    await ctl.seedDefaults(req);
    assert.equal((await auditRows(runner, 'portfolio_task_types')).length, DEFAULT_TASK_TYPES.length);
  });
}

async function testSkillsControllerNamesThePerson() {
  await withRollback(async (ctx) => {
    const { runner, req } = ctx;
    const skills = new PortfolioSkillsController(new PortfolioSkillsService({ manager: runner.manager } as any, new AuditService({ manager: runner.manager } as any)));
    const skill = await skills.create({ category: 'Data', name: 'First' }, req);
    await skills.update(skill.id, { name: 'Second' }, req);
    await skills.update(skill.id, { enabled: false }, req);
    await skills.delete(skill.id, req);
    await expectRows(ctx, 'portfolio_skills', [
      ['create', skill.id],
      ['update', skill.id],
      ['update', skill.id],
      ['delete', skill.id],
    ]);
  });
}

async function testMandatoryBypassSetting() {
  await withRollback(async (ctx) => {
    const ctl = new PortfolioSettingsController(new PortfolioSettingsService(null as any));
    const first = await ctl.get(ctx.req);
    await ctl.update({ mandatory_bypass_enabled: true }, ctx.req);
    const [row] = await expectRows(ctx, 'portfolio_settings', [['update', first.id]]);
    assert.equal(row.before_json.mandatory_bypass_enabled, false);
    assert.equal(row.after_json.mandatory_bypass_enabled, true);
  });
}

async function testCriteriaReorder() {
  await withRollback(async (ctx) => {
    const { runner, tenantId } = ctx;
    const ids: string[] = [];
    for (const [index, name] of ['A', 'B', 'C'].entries()) {
      ids.push((await runner.query(
        `INSERT INTO portfolio_criteria (tenant_id, name, display_order) VALUES ($1, $2, $3) RETURNING id`, [tenantId, name, index],
      ))[0].id);
    }
    const svc = new PortfolioCriteriaService(null as any, null as any, null as any, null as any, new AuditService({ manager: runner.manager } as any));
    const ctl = new PortfolioCriteriaController(svc);
    // A stays first; B and C swap.
    await ctl.reorder({ criterion_ids: [ids[0], ids[2], ids[1]] }, ctx.req);
    const rows = await expectRows(ctx, 'portfolio_criteria', [['update', ids[2]], ['update', ids[1]]]);
    assert.deepEqual(rows.map((row) => [row.before_json.display_order, row.after_json.display_order]), [[2, 1], [1, 2]]);
    assert.equal(rows[0].after_json.name, 'C');
    // The same order again changes nothing and writes nothing.
    await ctl.reorder({ criterion_ids: [ids[0], ids[2], ids[1]] }, ctx.req);
    assert.equal((await auditRows(runner, 'portfolio_criteria')).length, 2);
  });
}

async function testUnknownKeysAreIgnored() {
  await withRollback(async (ctx) => {
    const { runner, req } = ctx;
    const other = randomUUID();
    const body = { name: 'Renamed', is_system: true, tenant_id: other, code: 'review', id: randomUUID() } as any;
    const ctl = classification();
    const source = await ctl.createSource({ name: 'Board' }, req);
    const category = await ctl.createCategory({ name: 'Growth' }, req);
    const stream = await ctl.createStream({ category_id: category.id, name: 'Sales' }, req);
    const teams = new PortfolioTeamsController(new PortfolioTeamsService(null as any));
    const team = await teams.create({ name: 'Apps' }, req);
    const types = new PortfolioEmploymentTypesController(new PortfolioEmploymentTypesService(null as any));
    const type = await types.create({ name: 'Contractor' }, req);

    assert.equal((await ctl.updateSource(source.id, body, req)).name, 'Renamed');
    assert.equal((await ctl.updateCategory(category.id, body, req)).name, 'Renamed');
    assert.equal((await ctl.updateStream(stream.id, body, req)).name, 'Renamed');
    assert.equal((await teams.update(team.id, body, req)).name, 'Renamed');
    assert.equal((await types.update(type.id, body, req)).name, 'Renamed');

    for (const [table, id] of [
      ['portfolio_sources', source.id],
      ['portfolio_categories', category.id],
      ['portfolio_teams', team.id],
      ['portfolio_employment_types', type.id],
    ]) {
      const [row] = await runner.query(`SELECT name, is_system, tenant_id::text AS tenant_id FROM ${table} WHERE id = $1`, [id]);
      assert.deepEqual(row, { name: 'Renamed', is_system: false, tenant_id: ctx.tenantId }, table);
    }
    const [streamRow] = await runner.query(`SELECT id::text AS id, name, tenant_id::text AS tenant_id FROM portfolio_streams WHERE id = $1`, [stream.id]);
    assert.deepEqual(streamRow, { id: stream.id, name: 'Renamed', tenant_id: ctx.tenantId });
  });
}

async function run() {
  await dataSource.initialize();
  try {
    await testClassificationLists();
    await testCategoryDeleteTakesItsStreams();
    await testRefusedWritesLeaveNoRow();
    await testTeamsAndContractTypes();
    await testSeedsWriteOneRowPerValue();
    await testSkillsControllerNamesThePerson();
    await testMandatoryBypassSetting();
    await testCriteriaReorder();
    await testUnknownKeysAreIgnored();
    console.log('portfolio-settings-audit.integration.spec: ok');
  } finally {
    await dataSource.destroy();
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
