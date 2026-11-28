// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { INestApplicationContext } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { PgClient, seedNodes, seedPerson, seedRole } from '../../data-access/__tests__/data-access-test-helpers';
import { assertLocaleLabels } from '../../common/report-export/__tests__/locale-labels';

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.SETTINGS_ENCRYPTION_SECRET ||= process.env.AI_SETTINGS_ENCRYPTION_SECRET || 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-contributors-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

// The family `contributors` of Kad and the MCP server (Portfolio › Contributors, MEM-n), against
// the database and the real services of the screen (`TeamMemberConfigService` and the reads of
// its drawer):
// - an administrator lists, filters, sorts, groups and reads the detail by MEM-n, with the names
//   the list route gives (team, manager, contract type), the skills by name with their level in
//   the person's language, the classification defaults by name and the time logged;
// - a reference names one contributor exactly, in query_entities, the detail and search_all;
// - a reader of the portfolio settings reads them too; without the companies, the default company
//   is withheld and said so (the drawer's company field reads the company lookup);
// - a person without the right on the portfolio settings is refused in words naming the screen,
//   and search_all says it does not read the contributors for them (never "none");
// - a person in limited access sees every contributor, as the screen (the page is not bounded by
//   the companies), under the limited role (`applyDataAccess`, as a request);
// - more than 100 distinct default companies are named (the company lookup takes 100 ids a call);
// - no modification date is kept for a contributor, said in the note; the stream field quotes the
//   screen's label, and the time logged says which figure covers six months and which twelve;
// - a person without a name is named by their MEM-n, never by their email;
// - two skills of the same name in two categories stay two skills, named "category / name";
// - another tenant's contributor never shows, by reference nor by id;
// - a contributor has no History tab: get_record_history says so.
//
// Fixture: Alice (MEM-1: team Platform, manager Bob, skills SAP at 4 and Network at 2, default
// category Infrastructure and stream Run, default company, 80 project hours this month), Bob
// (MEM-2, no team) and Carl (MEM-3, no team, no skill). The other tenant has its own MEM-1, Zoe.

let app: INestApplicationContext;
let dataSource: DataSource;

type Seed = {
  tenantId: string;
  ids: { alice: string; bob: string; carl: string };
  otherContributor: string;
  admin: string;
  french: string;
  reader: string;
  noRight: string;
  limited: string;
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
     VALUES ($1, $2, $3, 'active', '{"reporting_currency":"EUR"}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `${slug}-${tenantId.slice(0, 8)}`, `${slug} ${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return tenantId;
}

function memberService() {
  const { TeamMemberConfigService } = require('../../portfolio/team-member-config.service');
  return app.get(TeamMemberConfigService);
}

async function named(runner: QueryRunner, userId: string, first: string, last: string): Promise<void> {
  await runner.query('UPDATE users SET first_name = $2, last_name = $3 WHERE id = $1', [userId, first, last]);
}

async function grant(runner: QueryRunner, tenantId: string, roleId: string, resource: string, level: string): Promise<void> {
  await runner.query('INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)', [tenantId, roleId, resource, level]);
}

async function seed(runner: QueryRunner): Promise<Seed> {
  const [{ current }] = await runner.query(`SELECT current_database() AS current`);
  assert.notEqual(current, 'appdb', 'this spec does not write the dev database');
  const service = memberService();
  const client = pg(runner);

  // Another tenant first, so the tenant of the spec stays the current one.
  const other = await seedTenantRow(runner, 'ai-mem-other');
  const zoe = await seedPerson(client, other, 'all', await seedRole(client, other, 'Administrator'));
  await named(runner, zoe, 'Zoe', 'Other');
  const otherContributor = (await service.create({ user_id: zoe }, other, zoe, { manager: runner.manager })).id;

  const tenantId = await seedTenantRow(runner, 'ai-mem');
  const administrator = await seedRole(client, tenantId, 'Administrator');
  const admin = await seedPerson(client, tenantId, 'all', administrator);
  const french = await seedPerson(client, tenantId, 'all', administrator);
  await runner.query(`UPDATE users SET locale = 'en' WHERE id = $1`, [admin]);
  await runner.query(`UPDATE users SET locale = 'fr' WHERE id = $1`, [french]);
  const portfolioReader = await seedRole(client, tenantId, 'Portfolio settings reader');
  await grant(runner, tenantId, portfolioReader, 'portfolio_settings', 'reader');
  const reader = await seedPerson(client, tenantId, 'all', portfolioReader);
  const budgetOnly = await seedRole(client, tenantId, 'Budget administrator');
  await grant(runner, tenantId, budgetOnly, 'budget', 'admin');
  const noRight = await seedPerson(client, tenantId, 'all', budgetOnly);
  const limitedRole = await seedRole(client, tenantId, 'Portfolio and companies reader');
  await grant(runner, tenantId, limitedRole, 'portfolio_settings', 'reader');
  await grant(runner, tenantId, limitedRole, 'companies', 'reader');
  const limited = await seedPerson(client, tenantId, 'limited', limitedRole);

  const [{ id: companyId }] = await runner.query(
    `INSERT INTO companies (tenant_id, name, country_iso, city, item_number) VALUES ($1, 'Fromagerie Alpha', 'FR', 'Lyon', 1) RETURNING id`, [tenantId]);
  await seedNodes(client, tenantId, limited, [{ type: 'company', id: companyId, access: 'read' }]);
  const [{ id: teamId }] = await runner.query(`INSERT INTO portfolio_teams (tenant_id, name) VALUES ($1, 'Platform') RETURNING id`, [tenantId]);
  const [{ id: sap }] = await runner.query(`INSERT INTO portfolio_skills (tenant_id, category, name) VALUES ($1, 'ERP', 'SAP') RETURNING id`, [tenantId]);
  const [{ id: network }] = await runner.query(`INSERT INTO portfolio_skills (tenant_id, category, name) VALUES ($1, 'Infrastructure', 'Network') RETURNING id`, [tenantId]);
  const [{ id: categoryId }] = await runner.query(`INSERT INTO portfolio_categories (tenant_id, name) VALUES ($1, 'Infrastructure') RETURNING id`, [tenantId]);
  const [{ id: streamId }] = await runner.query(`INSERT INTO portfolio_streams (tenant_id, category_id, name) VALUES ($1, $2, 'Run') RETURNING id`, [tenantId, categoryId]);

  const aliceUser = await seedPerson(client, tenantId, 'all', portfolioReader);
  const bobUser = await seedPerson(client, tenantId, 'all', portfolioReader);
  const carlUser = await seedPerson(client, tenantId, 'all', portfolioReader);
  await named(runner, aliceUser, 'Alice', 'Martin');
  await named(runner, bobUser, 'Bob', 'Durand');
  await named(runner, carlUser, 'Carl', 'Petit');
  await runner.query(`UPDATE users SET job_title = 'Network engineer' WHERE id = $1`, [aliceUser]);

  // Through the screen's service, which numbers them MEM-1, MEM-2, MEM-3.
  const alice = (await service.create({
    user_id: aliceUser,
    team_id: teamId,
    manager_user_id: bobUser,
    skills: [{ skill_id: sap, proficiency: 4 }, { skill_id: network, proficiency: 2 }],
    project_availability: 12,
    notes: 'Available on Mondays',
    default_category_id: categoryId,
    default_stream_id: streamId,
    default_company_id: companyId,
  }, tenantId, admin, { manager: runner.manager })).id;
  const bob = (await service.create({ user_id: bobUser, project_availability: 8 }, tenantId, admin, { manager: runner.manager })).id;
  const carl = (await service.create({ user_id: carlUser }, tenantId, admin, { manager: runner.manager })).id;
  await runner.query(
    `INSERT INTO user_time_monthly_aggregates (tenant_id, user_id, year_month, project_hours, other_hours, total_hours)
     VALUES ($1, $2, date_trunc('month', now() AT TIME ZONE 'UTC')::date, 80, 16, 96)`, [tenantId, aliceUser]);

  return { tenantId, ids: { alice, bob, carl }, otherContributor, admin, french, reader, noRight, limited };
}

function context(runner: QueryRunner, s: Seed, userId: string) {
  return { tenantId: s.tenantId, userId, isPlatformHost: false, surface: 'mcp', authMethod: 'api_key', manager: runner.manager } as any;
}

function executors() {
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const { AiRecordHistoryService } = require('../ai-record-history.service');
  const { AiEntityService } = require('../ai-entity.service');
  return {
    query: app.get(AiQueryExecutor),
    aggregates: app.get(AiAggregateExecutor),
    history: app.get(AiRecordHistoryService),
    entities: app.get(AiEntityService),
  };
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

function refs(result: any): string[] {
  return result.items.map((item: any) => item.ref);
}

async function testTheAdministratorReadsThemAsTheScreen(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, aggregates } = executors();
    const ctx = context(runner, s, s.admin);

    // The list route's order (first name, last name), every field by name.
    const all: any = await query.execute(ctx, { entity_type: 'contributors' });
    assert.deepEqual(refs(all), ['MEM-1', 'MEM-2', 'MEM-3']);
    assert.equal(all.total, 3);
    assert.match(all.contributor_note, /days per month/);
    assert.equal(all.fields_withheld, undefined, 'an administrator reads the companies');
    const alice = all.items[0];
    assert.equal(alice.type, 'contributors');
    assert.equal(alice.id, s.ids.alice);
    assert.equal(alice.label, 'Alice Martin');
    assert.deepEqual(
      {
        job_title: alice.metadata.job_title,
        team: alice.metadata.team,
        manager: alice.metadata.manager,
        manager_ref: alice.metadata.manager_ref,
        availability_days: alice.metadata.availability_days,
        skills: alice.metadata.skills,
        skill_count: alice.metadata.skill_count,
        avg_project_days: alice.metadata.avg_project_days,
        default_category: alice.metadata.default_category,
        default_stream: alice.metadata.default_stream,
        default_company: alice.metadata.default_company,
      },
      {
        job_title: 'Network engineer',
        team: 'Platform',
        manager: 'Bob Durand',
        manager_ref: 'MEM-2',
        availability_days: 12,
        skills: 'SAP (Expert), Network (Can execute with support)',
        skill_count: 2,
        avg_project_days: 10,
        default_category: 'Infrastructure',
        default_stream: 'Run',
        default_company: 'Fromagerie Alpha',
      },
    );
    assert.doesNotMatch(JSON.stringify(all.items), /@example\.invalid/, 'a person with a name is named, never by email');
    // No modification date is kept for a contributor: none given, and the note says so.
    assert.ok(all.items.every((item: any) => item.updated_at == null), 'no modification date in the list');
    assert.match(all.contributor_note, /no modification date/);
    assert.match(all.contributor_note, /no History tab/);

    // Filters, the quick search and a sort.
    const platform: any = await query.execute(ctx, { entity_type: 'contributors', filters: { team: 'Platf' } });
    assert.deepEqual(refs(platform), ['MEM-1']);
    const sap: any = await query.execute(ctx, { entity_type: 'contributors', filters: { skill: 'sap' } });
    assert.deepEqual(refs(sap), ['MEM-1']);
    const available: any = await query.execute(ctx, { entity_type: 'contributors', filters: { availability_days: { op: 'lt', value: 10 } } });
    assert.deepEqual(refs(available), ['MEM-2', 'MEM-3']);
    const byRef: any = await query.execute(ctx, { entity_type: 'contributors', q: 'MEM-1' });
    assert.deepEqual(refs(byRef), ['MEM-1'], 'a reference names one contributor exactly');
    const byName: any = await query.execute(ctx, { entity_type: 'contributors', q: 'durand' });
    assert.deepEqual(refs(byName), ['MEM-2']);
    const sorted: any = await query.execute(ctx, { entity_type: 'contributors', sort: { field: 'availability_days', direction: 'desc' } });
    assert.deepEqual(refs(sorted), ['MEM-1', 'MEM-2', 'MEM-3']);

    // The detail by MEM-n and by name: the skills with their level, the time logged.
    const detail: any = await query.executeDetail(ctx, { entity_type: 'contributors', entity_id: 'MEM-1' });
    assert.equal(detail.entity.ref, 'MEM-1');
    assert.deepEqual(detail.data.skills, [
      { skill: 'SAP', category: 'ERP', level: 4, level_name: 'Expert' },
      { skill: 'Network', category: 'Infrastructure', level: 2, level_name: 'Can execute with support' },
    ]);
    assert.equal(detail.data.time_logged.average_project_days, 10);
    assert.equal(detail.data.time_logged.monthly.length, 12);
    // The months as the General tab's chart reads them (`GET /portfolio/team-members/:id/time-stats`).
    const screen = await memberService().getTimeStats(s.ids.alice, { manager: runner.manager });
    assert.deepEqual(detail.data.time_logged.monthly.map((month: any) => month.project_days), screen.monthly.map((month: any) => month.projectDays));
    assert.equal(detail.data.notes, 'Available on Mondays');
    assert.equal(detail.data.id, undefined, 'no uuid in the data');
    assert.equal(detail.entity.updated_at ?? null, null, 'no modification date in the detail');
    assert.equal(detail.data.updated_at, undefined);
    assert.match(detail.data.contributor_note, /no modification date/);
    // The average covers six months, the months twelve, as the General tab shows them.
    assert.match(detail.data.time_logged.note, /`average_project_days`[^.;]*last six months/);
    assert.match(detail.data.time_logged.note, /`monthly`[^.;]*last twelve months/);
    assert.doesNotMatch(detail.data.time_logged.note, /six months, and the last twelve/);
    const byPerson: any = await query.executeDetail(ctx, { entity_type: 'contributors', entity_id: 'Carl Petit' });
    assert.equal(byPerson.entity.ref, 'MEM-3');

    // Grouped in memory: by team, by skill (a contributor counts in each skill).
    const byTeam: any = await aggregates.execute(ctx, { entity_type: 'contributors', group_by: 'team' });
    assert.deepEqual(byTeam.groups.map((group: any) => [group.key, group.count]), [[null, 2], ['Platform', 1]]);
    assert.equal(byTeam.total, 3);
    const bySkill: any = await aggregates.execute(ctx, { entity_type: 'contributors', group_by: 'skill' });
    assert.deepEqual(bySkill.groups.map((group: any) => [group.key, group.count]), [[null, 2], ['Network', 1], ['SAP', 1]]);

    // The values of a discoverable field, as get_filter_values gives them.
    const values: any = await query.executeFilterValues(ctx, { entity_type: 'contributors', fields: ['team', 'skill', 'notes'] });
    assert.deepEqual(values.values.team, ['Platform', null]);
    assert.deepEqual(values.values.skill, ['Network', 'SAP', null]);
    assert.deepEqual(values.fields_ignored, ['notes']);
  });
  console.log('ok - contributors: list, filters, detail by MEM-n, groups and values as the screen, for an administrator');
}

async function testTheLanguageAndTheSearch(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, entities } = executors();

    const french: any = await query.executeDetail(context(runner, s, s.french), { entity_type: 'contributors', entity_id: 'MEM-1' });
    assert.deepEqual(french.data.skills.map((skill: any) => skill.level_name), ['Expert', 'Peut exécuter avec accompagnement']);

    // search_all finds a contributor by MEM-n (exactly) and by the person's name.
    const ctx = context(runner, s, s.admin);
    const byRef: any = await withoutSurfaceChecks(() => entities.searchAll(ctx, { query: 'MEM-1' }));
    const found = byRef.items.filter((item: any) => item.type === 'contributors');
    assert.deepEqual(found.map((item: any) => [item.ref, item.label]), [['MEM-1', 'Alice Martin']]);
    const byWords: any = await withoutSurfaceChecks(() => entities.searchAll(ctx, { query: 'contributeur Durand', entity_types: ['contributors'] }));
    assert.deepEqual(byWords.items.map((item: any) => item.ref), ['MEM-2']);
  });
  console.log('ok - contributors: the levels in the person\'s language, search_all by MEM-n and by name');
}

async function testTheRightsOfThePage(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, aggregates, entities } = executors();

    // A reader of the portfolio settings reads them; the default company is withheld, said so.
    const reader = context(runner, s, s.reader);
    const read: any = await query.execute(reader, { entity_type: 'contributors' });
    assert.deepEqual(refs(read), ['MEM-1', 'MEM-2', 'MEM-3']);
    assert.equal(read.items[0].metadata.default_company, null);
    assert.deepEqual(read.fields_withheld.map((entry: any) => entry.field), ['default_company']);
    assert.match(read.fields_withheld[0].reason, /does not mean there is none/);
    const readerDetail: any = await query.executeDetail(reader, { entity_type: 'contributors', entity_id: 'MEM-1' });
    assert.equal(readerDetail.data.default_company, null);
    assert.equal(readerDetail.fields_withheld[0].field, 'default_company');
    assert.equal(readerDetail.data.manager_ref, 'MEM-2', 'the manager is a contributor, which the page links');

    // Without the right on the portfolio settings: refused in words, naming the screen.
    const ctx = context(runner, s, s.noRight);
    for (const run of [
      () => query.execute(ctx, { entity_type: 'contributors' }),
      () => query.executeDetail(ctx, { entity_type: 'contributors', entity_id: 'MEM-1' }),
      () => aggregates.execute(ctx, { entity_type: 'contributors', group_by: 'team' }),
      () => query.executeFilterValues(ctx, { entity_type: 'contributors', fields: ['team'] }),
    ]) {
      const refused = await rejection(run);
      assert.equal(refused?.getStatus?.(), 403);
      assert.match(String(refused?.message), /^You need the right to read portfolio settings \(the right the Portfolio › Contributors screen asks for\)/, String(refused?.message));
    }
    // search_all says the family is not read for this person, never "none".
    const searched: any = await withoutSurfaceChecks(() => entities.searchAll(ctx, { query: 'MEM-1' }));
    assert.equal(searched.items.some((item: any) => item.type === 'contributors'), false);
    const notRead = JSON.stringify(searched.not_read_here ?? searched.families_not_read ?? null);
    assert.match(notRead, /contributors/, notRead);
    assert.match(notRead, /Portfolio settings right/, notRead);
  });
  console.log('ok - contributors: the page\'s right, the company withheld without the companies, limited access as the screen, search says not read');
}

async function testLimitedAccessUnderTheLimitedRole(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query } = executors();
    const { applyDataAccess } = require('../../data-access/data-access');
    // As a request of a person in limited access: the transaction takes the limited role.
    assert.equal(await applyDataAccess(runner.manager, s.limited), 'limited');
    const [{ role }] = await runner.query('SELECT current_user AS role');
    assert.equal(role, 'kanap_data_limited');

    // Every contributor, as the screen; this role reads the companies.
    const limited: any = await query.execute(context(runner, s, s.limited), { entity_type: 'contributors' });
    assert.deepEqual(refs(limited), ['MEM-1', 'MEM-2', 'MEM-3']);
    assert.equal(limited.items[0].metadata.default_company, 'Fromagerie Alpha');
    assert.equal(limited.fields_withheld, undefined);
    const detail: any = await query.executeDetail(context(runner, s, s.limited), { entity_type: 'contributors', entity_id: 'MEM-1' });
    assert.equal(detail.data.time_logged.average_project_days, 10);
  });
  console.log('ok - contributors: limited access under the limited role, as the screen');
}

async function testManyDefaultCompanies(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, aggregates } = executors();
    const client = pg(runner);
    const role = await seedRole(client, s.tenantId, 'Many');
    // 104 distinct default companies with Alice's: more than the 100 ids of one company lookup.
    for (let index = 0; index < 103; index += 1) {
      const [{ id: companyId }] = await runner.query(
        `INSERT INTO companies (tenant_id, name, country_iso, city, item_number) VALUES ($1, $2, 'FR', 'Lyon', $3) RETURNING id`,
        [s.tenantId, `Company ${index}`, 100 + index]);
      const user = await seedPerson(client, s.tenantId, 'all', role);
      await runner.query(
        `INSERT INTO portfolio_team_member_configs (tenant_id, user_id, item_number, default_company_id) VALUES ($1, $2, $3, $4)`,
        [s.tenantId, user, 100 + index, companyId]);
    }
    const ctx = context(runner, s, s.admin);
    const all: any = await query.execute(ctx, { entity_type: 'contributors' });
    assert.equal(all.total, 106);
    const byCompany: any = await aggregates.execute(ctx, { entity_type: 'contributors', group_by: 'default_company' });
    assert.equal(byCompany.groups.filter((group: any) => group.key != null).length, 104, 'every default company is named');
    const one: any = await query.executeDetail(ctx, { entity_type: 'contributors', entity_id: 'MEM-100' });
    assert.equal(one.data.default_company, 'Company 0');
  });
  console.log('ok - contributors: more than 100 distinct default companies');
}

async function testAPersonWithoutANameIsNamedByReference(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, entities } = executors();
    const [{ user_id: carlUser }] = await runner.query('SELECT user_id FROM portfolio_team_member_configs WHERE id = $1', [s.ids.carl]);
    // Carl has no name; he manages Bob. A manager who is no contributor and has no name is said so.
    await named(runner, carlUser, '', '');
    await runner.query('UPDATE portfolio_team_member_configs SET manager_user_id = $2 WHERE id = $1', [s.ids.bob, carlUser]);
    const outsider = await seedPerson(pg(runner), s.tenantId, 'all', await seedRole(pg(runner), s.tenantId, 'Outsider'));
    await named(runner, outsider, '', '');
    await runner.query('UPDATE portfolio_team_member_configs SET manager_user_id = $2 WHERE id = $1', [s.ids.alice, outsider]);
    const ctx = context(runner, s, s.admin);

    const all: any = await query.execute(ctx, { entity_type: 'contributors' });
    const carl = all.items.find((item: any) => item.ref === 'MEM-3');
    assert.equal(carl.label, 'MEM-3');
    assert.equal(carl.metadata.name, 'MEM-3');
    const bob = all.items.find((item: any) => item.ref === 'MEM-2');
    assert.deepEqual([bob.metadata.manager, bob.metadata.manager_ref], ['MEM-3', 'MEM-3']);
    const alice = all.items.find((item: any) => item.ref === 'MEM-1');
    assert.deepEqual([alice.metadata.manager, alice.metadata.manager_ref], ['(person without a name)', null]);
    const detail: any = await query.executeDetail(ctx, { entity_type: 'contributors', entity_id: 'MEM-3' });
    assert.equal(detail.entity.label, 'MEM-3');
    assert.equal(detail.data.name, 'MEM-3');
    const searched: any = await withoutSurfaceChecks(() => entities.searchAll(ctx, { query: 'MEM-3' }));
    assert.deepEqual(searched.items.filter((item: any) => item.type === 'contributors').map((item: any) => [item.ref, item.label]), [['MEM-3', 'MEM-3']]);
    const mentioned: any = await withoutSurfaceChecks(() => entities.searchMentionCandidates(ctx, { query: 'MEM-3', entity_types: ['contributors'], limit: 20 }));
    assert.deepEqual(mentioned.items.map((item: any) => [item.ref, item.label]), [['MEM-3', 'MEM-3']]);
    assert.doesNotMatch(JSON.stringify([all, detail, searched, mentioned]), /@/, 'no email address');
  });
  console.log('ok - contributors: a person without a name is named by their MEM-n');
}

async function testSkillsOfTheSameNameStayApart(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, aggregates } = executors();
    // A second SAP, in another category, held by Bob.
    const [{ id: hostingSap }] = await runner.query(`INSERT INTO portfolio_skills (tenant_id, category, name) VALUES ($1, 'Hosting', 'SAP') RETURNING id`, [s.tenantId]);
    await runner.query(`UPDATE portfolio_team_member_configs SET skills = $2::jsonb WHERE id = $1`, [s.ids.bob, JSON.stringify([{ skill_id: hostingSap, proficiency: 3 }])]);
    const ctx = context(runner, s, s.admin);

    const bySkill: any = await aggregates.execute(ctx, { entity_type: 'contributors', group_by: 'skill' });
    assert.deepEqual(bySkill.groups.map((group: any) => [group.key, group.count]), [['ERP / SAP', 1], ['Hosting / SAP', 1], ['Network', 1], [null, 1]]);
    const values: any = await query.executeFilterValues(ctx, { entity_type: 'contributors', fields: ['skill'] });
    assert.deepEqual(values.values.skill, ['ERP / SAP', 'Hosting / SAP', 'Network', null]);
    const erp: any = await query.execute(ctx, { entity_type: 'contributors', filters: { skill: 'ERP / SAP' } });
    assert.deepEqual(refs(erp), ['MEM-1']);
    const either: any = await query.execute(ctx, { entity_type: 'contributors', filters: { skill: 'SAP' } });
    assert.deepEqual(refs(either), ['MEM-1', 'MEM-2']);
    const detail: any = await query.executeDetail(ctx, { entity_type: 'contributors', entity_id: 'MEM-2' });
    assert.deepEqual(detail.data.skills, [{ skill: 'Hosting / SAP', category: 'Hosting', level: 3, level_name: 'Autonomous' }]);
  });
  console.log('ok - contributors: two skills of the same name stay two skills');
}

/** The stream field quotes the label of the contributor's page, in the four languages of its locale files. */
function testTheStreamFieldQuotesTheScreen(): void {
  const { CONTRIBUTOR_STREAM_LABEL, CONTRIBUTOR_STREAM_LABEL_KEY } = require('../query/ai-contributors.query');
  assertLocaleLabels('portfolio', { stream: CONTRIBUTOR_STREAM_LABEL_KEY }, {
    en: { stream: CONTRIBUTOR_STREAM_LABEL.en },
    fr: { stream: CONTRIBUTOR_STREAM_LABEL.fr },
    de: { stream: CONTRIBUTOR_STREAM_LABEL.de },
    es: { stream: CONTRIBUTOR_STREAM_LABEL.es },
  });
  const { getAiEntityRegistry } = require('../query/registries');
  const description: string = getAiEntityRegistry('contributors').fields.default_stream.description;
  for (const word of ['"Filière"', '"Línea"', '"Stream"']) assert.ok(description.includes(word), `${word} in: ${description}`);
  console.log('ok - contributors: the stream field quotes the screen');
}

async function testTenantAndHistory(): Promise<void> {
  await inTransaction(async (runner) => {
    const s = await seed(runner);
    const { query, history } = executors();
    const admin = context(runner, s, s.admin);

    // The other tenant's MEM-1 (Zoe) never shows, by reference nor by id.
    const all: any = await query.execute(admin, { entity_type: 'contributors', limit: 100 });
    assert.doesNotMatch(JSON.stringify(all), /Zoe/);
    const mem1: any = await query.executeDetail(admin, { entity_type: 'contributors', entity_id: 'MEM-1' });
    assert.equal(mem1.entity.id, s.ids.alice);
    const byIdRefused = await rejection(() => query.executeDetail(admin, { entity_type: 'contributors', entity_id: s.otherContributor }));
    assert.equal(byIdRefused?.getStatus?.(), 404);

    // A contributor has no History tab.
    const refused = await rejection(() => withoutSurfaceChecks(() => history.getRecordHistory(admin, { entity_type: 'contributors', entity_id: 'MEM-1', limit: 20 })));
    assert.match(String(refused?.message), /contributors have no History tab/, String(refused?.message));
  });
  console.log('ok - contributors: another tenant invisible, no history');
}

async function run(): Promise<void> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-contributors-query.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  dataSource = app.get(DataSource);
  const failures: string[] = [];
  try {
    for (const [name, test] of [
      ['administrator', testTheAdministratorReadsThemAsTheScreen],
      ['language and search', testTheLanguageAndTheSearch],
      ['rights of the page', testTheRightsOfThePage],
      ['tenant and history', testTenantAndHistory],
      ['limited role', testLimitedAccessUnderTheLimitedRole],
      ['many default companies', testManyDefaultCompanies],
      ['person without a name', testAPersonWithoutANameIsNamedByReference],
      ['skills of the same name', testSkillsOfTheSameNameStayApart],
      ['stream label', async () => testTheStreamFieldQuotesTheScreen()],
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
  console.log('ai-contributors-query.integration.spec: ok');
}

run().catch((error) => {
  console.error(error?.stack ?? error);
  process.exit(1);
});
