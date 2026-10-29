import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';

// Plaid L7 lot B: Admin › Data access read through the assistant's and the MCP server's tools.
//
// - `data_access` lists one row per person in limited access and node, as `GET /data-access`:
//   company, cost center, group and `all` nodes; a person without a node gives one row that says
//   they see no budget or contract data; an Administrator stored `limited` is listed nowhere;
//   nobody of another tenant shows. The result carries the availability in words, the counters and
//   the distinct persons. Filters on `node_type` and `node_code`; groups by `node` count rows and
//   persons.
// - `users` gains `roles` (every role, primary first: a person holding Budget Member as an
//   additional role is found, which `primary_role` misses) and `data_access` (the effective mode).
// - The detail of a person carries their access as the Data access tab, the detail of a company
//   who sees it (`full`, `partial`) as its Access tab.
// - The gate: a reader of users reads nothing new, an administrator of users in limited access is
//   refused the family and gets none of the new fields or blocks. The database does not guard the
//   nodes: the code does, here on a real transaction.
// The AI surface checks (tenant settings, provider) are not under test: stubbed open.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-data-access-query-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; tools: any; dataAccess: any };
type PersonKey = 'ulla' | 'victor' | 'alice' | 'bruno' | 'chloe' | 'dan' | 'eva' | 'rita' | 'rob';
type Seed = {
  tenantId: string;
  tag: string;
  companies: { c1: string; c2: string };
  users: Record<PersonKey, string>;
};

const NAMES: Record<PersonKey, [string, string]> = {
  ulla: ['Ulla', 'Unscoped'],
  victor: ['Victor', 'Administrator'],
  alice: ['Alice', 'Company'],
  bruno: ['Bruno', 'Center'],
  chloe: ['Chloe', 'Group'],
  dan: ['Dan', 'Everything'],
  eva: ['Eva', 'Nonode'],
  rita: ['Rita', 'Limited'],
  rob: ['Rob', 'Reader'],
};
const fullName = (key: PersonKey) => NAMES[key].join(' ');

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-data-access-query.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const { AiPolicyService } = require('../ai-policy.service');
  const { DataAccessAdminService } = require('../../data-access/data-access-admin.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  return { app, dataSource: app.get(DataSource), tools: app.get(AiToolRegistry), dataAccess: app.get(DataAccessAdminService) };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function tenant(runner: QueryRunner, label: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-da-${label}-${tenantId.slice(0, 8)}`, `AI data access ${label}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return tenantId;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  // Another tenant first: a limited person with a node nobody of the tenant under test may see.
  const otherTenantId = await tenant(runner, 'other');
  const otherRole = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Budget Member', 'Elsewhere')`, [otherTenantId]);
  const otherUser = await insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, data_access_mode) VALUES ($1, $2, 'Otto', 'Elsewhere', $3, 'enabled', 'limited')`,
    [otherTenantId, `otto-${otherTenantId.slice(0, 8)}@example.test`, otherRole]);
  await runner.query(`INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, access) VALUES ($1, $2, 'all', 'read')`, [otherTenantId, otherUser]);

  const tenantId = await tenant(runner, 'main');
  const tag = tenantId.slice(0, 8);
  const company = (name: string) => insertId(runner,
    `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES ($1, $2, 'FR', 'Lyon', 'enabled')`,
    [tenantId, `${name} ${tag}`]);
  const companies = { c1: await company('Formaggio'), c2: await company('Fromagerie') };
  const center = (code: string, kind: 'group' | 'cost_center', parent: string | null, companyId: string | null) => insertId(runner,
    `INSERT INTO cost_centers (tenant_id, code, kind, name, parent_id, company_id, status) VALUES ($1, $2, $3, $4, $5, $6, 'enabled')`,
    [tenantId, code, kind, `${code} name`, parent, companyId]);
  const g1 = await center('G1', 'group', null, null);
  await center('K1', 'cost_center', g1, companies.c1);
  await center('K2', 'cost_center', g1, companies.c2);
  const k3 = await center('K3', 'cost_center', null, companies.c2);

  const role = async (name: string, permissions: Array<[string, string]>) => {
    const id = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, $2, 'spec')`, [tenantId, name]);
    for (const [resource, level] of permissions) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
    }
    return id;
  };
  const roles = {
    administrator: await role('Administrator', []),
    budget: await role('Budget Member', [['budget', 'member']]),
    landscape: await role('IT Landscape Member', [['applications', 'member']]),
    people: await role('People admin', [['users', 'admin'], ['companies', 'reader'], ['ai_chat', 'reader'], ['ai_mcp', 'reader']]),
    reader: await role('People reader', [['users', 'reader'], ['companies', 'reader'], ['ai_chat', 'reader'], ['ai_mcp', 'reader']]),
  };
  const users = {} as Record<PersonKey, string>;
  const person = async (key: PersonKey, primary: string, extra: string[], mode: 'all' | 'limited', nodes: Array<[string, string | null, string]>) => {
    const [first, last] = NAMES[key];
    const id = await insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, data_access_mode) VALUES ($1, $2, $3, $4, $5, 'enabled', $6)`,
      [tenantId, `${key}-${tag}@example.test`, first, last, primary, mode]);
    await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, id, primary]);
    for (const roleId of extra) {
      await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, false)`, [tenantId, id, roleId]);
    }
    for (const [type, target, access] of nodes) {
      await runner.query(
        `INSERT INTO user_data_access_nodes (tenant_id, user_id, node_type, company_id, cost_center_id, access) VALUES ($1, $2, $3, $4, $5, $6)`,
        [tenantId, id, type, type === 'company' ? target : null, type === 'cost_center' ? target : null, access],
      );
    }
    users[key] = id;
  };
  await person('ulla', roles.people, [], 'all', []);
  // Stored limited, but an Administrator: sees all data, listed nowhere.
  await person('victor', roles.administrator, [], 'limited', []);
  await person('alice', roles.budget, [], 'limited', [['company', companies.c1, 'edit']]);
  // Budget Member as an additional role only.
  await person('bruno', roles.landscape, [roles.budget], 'limited', [['cost_center', k3, 'read']]);
  await person('chloe', roles.budget, [], 'limited', [['cost_center', g1, 'read'], ['company', companies.c2, 'edit']]);
  await person('dan', roles.budget, [], 'limited', [['all', null, 'read']]);
  await person('eva', roles.budget, [], 'limited', []);
  // Users at admin level, in limited access: the screen is closed to her.
  await person('rita', roles.people, [], 'limited', [['company', companies.c1, 'read']]);
  await person('rob', roles.reader, [], 'all', []);
  await runner.query(
    `UPDATE users SET data_access_updated_at = '2026-10-20T08:00:00Z', data_access_updated_by = $2 WHERE id = $1`,
    [users.alice, users.ulla],
  );
  return { tenantId, tag, companies, users };
}

function ctx(runner: QueryRunner, s: Seed, user: PersonKey) {
  return {
    tenantId: s.tenantId,
    userId: s.users[user],
    isPlatformHost: false,
    surface: 'mcp' as const,
    authMethod: 'api_key' as const,
    manager: runner.manager,
  };
}

const persons = (items: any[]) => items.map((item: any) => item.metadata.person);

async function testListIsTheOverview(h: Harness, runner: QueryRunner, s: Seed) {
  const result = await h.tools.execute(ctx(runner, s, 'ulla'), 'query_entities', { entity_type: 'data_access', limit: 50 });
  assert.equal(result.total, 7, 'one row per node, one for the person without a node');
  assert.equal(result.distinct_total, 6, 'six persons in limited access');
  assert.equal(result.distinct_label, 'person');
  assert.deepEqual(result.counters, { limited_persons: 6, lines_without_company: 0 }, 'the screen counters');
  assert.equal(typeof result.available, 'boolean');
  assert.match(result.coverage_note, /budget and the contracts only/);
  assert.deepEqual(
    persons(result.items),
    ['Alice', 'Bruno', 'Chloe', 'Chloe', 'Dan', 'Eva', 'Rita'].map((first) => fullName((Object.keys(NAMES) as PersonKey[]).find((key) => NAMES[key][0] === first)!)),
    'persons by name, each person\'s nodes in the screen order',
  );
  const json = JSON.stringify(result);
  assert.equal(json.includes(fullName('victor')), false, 'an Administrator stored limited is listed nowhere');
  assert.equal(json.includes('Otto'), false, 'another tenant stays out');
  assert.equal(json.includes('@example.test'), false, 'no email');

  const byPerson = (key: PersonKey) => result.items.filter((item: any) => item.id === s.users[key]);
  const [alice] = byPerson('alice');
  assert.deepEqual(
    [alice.metadata.node_type, alice.metadata.node, alice.metadata.access, alice.metadata.changed_by, alice.metadata.roles],
    ['company', `Formaggio ${s.tag}`, 'edit', fullName('ulla'), 'Budget Member'],
    'a company node, who changed it',
  );
  assert.equal(alice.metadata.changed_at, '2026-10-20T08:00:00.000Z');
  const [bruno] = byPerson('bruno');
  assert.deepEqual(
    [bruno.metadata.node_type, bruno.metadata.node, bruno.metadata.node_code, bruno.metadata.node_kind, bruno.metadata.roles],
    ['cost_center', 'K3 K3 name', 'K3', 'cost_center', 'IT Landscape Member, Budget Member'],
    'a cost center node named CODE name, every role primary first',
  );
  assert.deepEqual(byPerson('chloe').map((item: any) => [item.metadata.node_type, item.metadata.node_kind ?? null]), [['company', null], ['cost_center', 'group']], 'a group node');
  assert.deepEqual([byPerson('dan')[0].metadata.node_type, byPerson('dan')[0].metadata.node, byPerson('dan')[0].label], ['all', null, `${fullName('dan')}: all data`]);
  const [eva] = byPerson('eva');
  assert.deepEqual([eva.metadata.node_type, eva.metadata.access, eva.label], [null, null, `${fullName('eva')}: no node`], 'one row without a node');
  assert.equal(eva.summary, 'No node: sees no budget or contract data.');
  assert.match(alice.page_url, /\/admin\/data-access$/, 'a row opens the Data access screen');
}

async function testFiltersAndGroups(h: Harness, runner: QueryRunner, s: Seed) {
  const companies = await h.tools.execute(ctx(runner, s, 'ulla'), 'query_entities', { entity_type: 'data_access', filters: { node_type: ['company'] } });
  assert.deepEqual(persons(companies.items), [fullName('alice'), fullName('chloe'), fullName('rita')], 'the company nodes');
  assert.deepEqual(companies.filters_applied, ['node_type']);
  assert.equal(companies.distinct_total, 3);
  const noNode = await h.tools.execute(ctx(runner, s, 'ulla'), 'query_entities', { entity_type: 'data_access', filters: { node_type: [null] } });
  assert.deepEqual(persons(noNode.items), [fullName('eva')], 'the persons without a node');
  const k3 = await h.tools.execute(ctx(runner, s, 'ulla'), 'query_entities', { entity_type: 'data_access', filters: { node_code: 'k3' } });
  assert.deepEqual(persons(k3.items), [fullName('bruno')], 'who has a node on K3, the code without case');
  const k = await h.tools.execute(ctx(runner, s, 'ulla'), 'query_entities', { entity_type: 'data_access', filters: { node_code: 'K' } });
  assert.equal(k.total, 0, 'a code compares exactly');

  const byNode = await h.tools.execute(ctx(runner, s, 'ulla'), 'aggregate_entities', { entity_type: 'data_access', group_by: 'node' });
  assert.equal(byNode.total, 7, 'rows');
  assert.equal(byNode.distinct_total, 6, 'persons, each once');
  assert.deepEqual(byNode.groups[0], { key: `Formaggio ${s.tag}`, count: 2, distinct_count: 2 }, 'the company node held by two persons first');
  const byType = await h.tools.execute(ctx(runner, s, 'ulla'), 'aggregate_entities', { entity_type: 'data_access', group_by: 'node_type' });
  assert.deepEqual(
    byType.groups,
    [
      { key: 'company', count: 3, distinct_count: 3 },
      { key: 'cost_center', count: 2, distinct_count: 2 },
      { key: 'all', count: 1, distinct_count: 1 },
      { key: null, count: 1, distinct_count: 1 },
    ],
    'nodes by type',
  );
}

async function testUnavailableInWords(h: Harness, runner: QueryRunner, s: Seed) {
  h.dataAccess.availabilityOverride = async () => ({ available: false, missing: ['role', 'policies'] });
  try {
    const result = await h.tools.execute(ctx(runner, s, 'ulla'), 'query_entities', { entity_type: 'data_access' });
    assert.equal(result.available, false);
    assert.deepEqual(result.missing, ['the limited role', 'the access rules'], 'what is missing, in the screen\'s words');
    assert.match(result.unavailable_note, /one-time step on the database/);
    const grouped = await h.tools.execute(ctx(runner, s, 'ulla'), 'aggregate_entities', { entity_type: 'data_access', group_by: 'access' });
    assert.equal(grouped.available, false);
    const detail = await h.tools.execute(ctx(runner, s, 'ulla'), 'get_entity_detail', { entity_type: 'users', entity_id: s.users.alice });
    assert.equal(detail.data.data_access.available, false, 'the person\'s block says it too');
  } finally {
    h.dataAccess.availabilityOverride = undefined;
  }
}

async function testUsersRolesAndMode(h: Harness, runner: QueryRunner, s: Seed) {
  const budget = await h.tools.execute(ctx(runner, s, 'ulla'), 'query_entities', { entity_type: 'users', filters: { roles: ['Budget Member'] }, limit: 50 });
  const budgetNames = budget.items.map((item: any) => item.label).sort();
  assert.deepEqual(budgetNames, ['alice', 'bruno', 'chloe', 'dan', 'eva'].map((key) => fullName(key as PersonKey)).sort(), 'every holder of the role, additional included');
  const primary = await h.tools.execute(ctx(runner, s, 'ulla'), 'query_entities', { entity_type: 'users', filters: { primary_role: ['Budget Member'] }, limit: 50 });
  assert.equal(primary.items.some((item: any) => item.id === s.users.bruno), false, 'primary_role misses an additional role');

  const all = await h.tools.execute(ctx(runner, s, 'ulla'), 'query_entities', { entity_type: 'users', limit: 50 });
  const meta = (key: PersonKey) => all.items.find((item: any) => item.id === s.users[key]).metadata;
  assert.deepEqual([meta('bruno').roles, meta('bruno').data_access], ['IT Landscape Member, Budget Member', 'limited'], 'every role, primary first, and the mode');
  assert.equal(meta('victor').data_access, 'all', 'an Administrator stored limited reads all');
  assert.equal(meta('ulla').data_access, 'all');

  const limited = await h.tools.execute(ctx(runner, s, 'ulla'), 'query_entities', { entity_type: 'users', filters: { data_access: ['limited'] }, limit: 50 });
  assert.equal(limited.total, 6, 'the six persons the screen lists');
  const byMode = await h.tools.execute(ctx(runner, s, 'ulla'), 'aggregate_entities', { entity_type: 'users', group_by: 'data_access' });
  assert.deepEqual(byMode.groups, [{ key: 'limited', count: 6 }, { key: 'all', count: 3 }], 'people by mode');
  const byRole = await h.tools.execute(ctx(runner, s, 'ulla'), 'aggregate_entities', { entity_type: 'users', group_by: 'roles' });
  assert.deepEqual(byRole.groups.find((group: any) => group.key === 'Budget Member'), { key: 'Budget Member', count: 5 }, 'a person counts in each of their roles');
  assert.deepEqual(byRole.groups.find((group: any) => group.key === 'IT Landscape Member'), { key: 'IT Landscape Member', count: 1 });

  const values = await h.tools.execute(ctx(runner, s, 'ulla'), 'get_filter_values', { entity_type: 'users', fields: ['roles', 'data_access'] });
  assert.ok(values.values.roles.includes('Budget Member') && values.values.roles.includes('IT Landscape Member'), JSON.stringify(values.values.roles));
  assert.equal(values.values.roles.includes('Budget Member') && values.values.roles.filter((name: string) => name === 'Budget Member').length, 1, 'each role once, another tenant\'s left out');
  assert.deepEqual(values.values.data_access, ['all', 'limited']);
}

async function testPersonAndCompanyDetails(h: Harness, runner: QueryRunner, s: Seed) {
  const bruno = await h.tools.execute(ctx(runner, s, 'ulla'), 'get_entity_detail', { entity_type: 'users', entity_id: s.users.bruno });
  assert.deepEqual(bruno.data.roles, ['IT Landscape Member', 'Budget Member']);
  assert.equal(bruno.data.data_access.mode, 'limited');
  assert.equal(bruno.data.data_access.is_administrator, false);
  assert.deepEqual(bruno.data.data_access.nodes, [{ type: 'cost_center', kind: 'cost_center', code: 'K3', name: 'K3 K3 name', access: 'read' }], 'the nodes of the Data access tab');
  assert.match(bruno.data.data_access.note, /a group node covers the group, its sub-groups/);
  assert.match(bruno.data.data_access.coverage_note, /budget and the contracts only/);
  assert.equal(bruno.entity.metadata.data_access, 'limited');
  // The row of findById carries no secret (the columns are not selected; the detail drops them anyway).
  const keys = Object.keys(bruno.data);
  assert.equal(keys.some((key) => /password|secret|token|mfa_secret/i.test(key)), false, keys.join(', '));

  // The detail names the primary role, the company and the department, as the users list does
  // (Plaid L7, lot D: `findById` gives the entity, whose relations carry them).
  const department = await insertId(runner, `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, 'Finance')`, [s.tenantId, s.companies.c1]);
  await runner.query(`UPDATE users SET company_id = $2, department_id = $3 WHERE id = $1`, [s.users.bruno, s.companies.c1, department]);
  const placed = await h.tools.execute(ctx(runner, s, 'ulla'), 'get_entity_detail', { entity_type: 'users', entity_id: s.users.bruno });
  assert.deepEqual(
    [placed.entity.metadata.primary_role, placed.entity.metadata.company, placed.entity.metadata.department],
    ['IT Landscape Member', `Formaggio ${s.tag}`, 'Finance'],
  );
  const listed = await h.tools.execute(ctx(runner, s, 'ulla'), 'query_entities', { entity_type: 'users', q: 'Bruno' });
  assert.deepEqual(
    [listed.items[0].metadata.primary_role, listed.items[0].metadata.company, listed.items[0].metadata.department],
    [placed.entity.metadata.primary_role, placed.entity.metadata.company, placed.entity.metadata.department],
    'the detail and the list say the same',
  );

  const victor = await h.tools.execute(ctx(runner, s, 'ulla'), 'get_entity_detail', { entity_type: 'users', entity_id: s.users.victor });
  assert.deepEqual([victor.data.data_access.mode, victor.data.data_access.is_administrator, victor.data.data_access.nodes], ['all', true, []]);
  assert.match(victor.data.data_access.note, /Administrator: sees all data/);
  const eva = await h.tools.execute(ctx(runner, s, 'ulla'), 'get_entity_detail', { entity_type: 'users', entity_id: s.users.eva });
  assert.equal(eva.data.data_access.note, 'No node: sees no budget or contract data.');
  const alice = await h.tools.execute(ctx(runner, s, 'ulla'), 'get_entity_detail', { entity_type: 'users', entity_id: s.users.alice });
  assert.deepEqual([alice.data.data_access.updated_by_name, alice.data.data_access.nodes], [fullName('ulla'), [{ type: 'company', name: `Formaggio ${s.tag}`, access: 'edit' }]]);

  const company = await h.tools.execute(ctx(runner, s, 'ulla'), 'get_entity_detail', { entity_type: 'companies', entity_id: s.companies.c1 });
  assert.deepEqual(
    company.data.data_access.full,
    [
      { person: fullName('alice'), via: `Formaggio ${s.tag}`, via_type: 'company', access: 'edit' },
      { person: fullName('dan'), via: 'all data', via_type: 'all', access: 'read' },
      { person: fullName('rita'), via: `Formaggio ${s.tag}`, via_type: 'company', access: 'read' },
    ],
    'who sees the whole company, as its Access tab',
  );
  assert.deepEqual(company.data.data_access.partial, [{ person: fullName('chloe'), via: 'G1 G1 name', via_type: 'cost_center', access: 'read' }], 'a group covering one of its cost centers');
  assert.match(company.data.data_access.note, /node_code/);

  await assert.rejects(
    () => h.tools.execute(ctx(runner, s, 'ulla'), 'get_entity_detail', { entity_type: 'data_access', entity_id: s.users.alice }),
    /"entity_type" must be one of/,
    'a row of data access has no detail of its own',
  );
}

async function testGate(h: Harness, runner: QueryRunner, s: Seed) {
  // A reader of users: the family needs users at admin level, and nothing new is shown to them.
  await assert.rejects(
    () => h.tools.execute(ctx(runner, s, 'rob'), 'query_entities', { entity_type: 'data_access' }),
    /You need the right to administer users \(the right the Admin › Data access screen asks for\)/,
    'users:reader is refused the family',
  );
  const asReader = await h.tools.execute(ctx(runner, s, 'rob'), 'query_entities', { entity_type: 'users', limit: 50 });
  assert.equal(asReader.items.some((item: any) => 'roles' in item.metadata || 'data_access' in item.metadata), false, 'no roles nor mode to a reader');
  const readerFilter = await h.tools.execute(ctx(runner, s, 'rob'), 'query_entities', { entity_type: 'users', filters: { roles: ['Budget Member'] } });
  assert.deepEqual([readerFilter.items.length, readerFilter.filters_ignored], [0, ['roles']], 'the roles filter is not offered to a reader');
  const readerFields = await h.tools.execute(ctx(runner, s, 'rob'), 'describe_entity_filters', { entity_type: 'users' });
  assert.equal(JSON.stringify(readerFields).includes('"data_access"'), false, 'not described to a reader');

  // users at admin level in limited access: the screen is closed to her, so is every new read.
  for (const [tool, input] of [
    ['query_entities', { entity_type: 'data_access' }],
    ['aggregate_entities', { entity_type: 'data_access', group_by: 'node' }],
    ['describe_entity_filters', { entity_type: 'data_access' }],
    ['get_filter_values', { entity_type: 'data_access', fields: ['node_type'] }],
  ] as const) {
    await assert.rejects(
      () => h.tools.execute(ctx(runner, s, 'rita'), tool, input),
      /reserved to people with access to all data/,
      `${tool} data_access: refused in limited access`,
    );
  }
  const asLimited = await h.tools.execute(ctx(runner, s, 'rita'), 'query_entities', { entity_type: 'users', limit: 50 });
  assert.ok(asLimited.items.some((item: any) => 'job_title' in item.metadata), 'the admin columns stay');
  assert.equal(asLimited.items.some((item: any) => 'roles' in item.metadata || 'data_access' in item.metadata), false, 'no roles nor mode in limited access');
  const limitedGroup = await h.tools.execute(ctx(runner, s, 'rita'), 'aggregate_entities', { entity_type: 'users', group_by: 'status', filters: { data_access: ['limited'] } });
  assert.deepEqual(limitedGroup.filters_ignored, ['data_access'], 'the mode filter is not offered in limited access');
  await assert.rejects(
    () => h.tools.execute(ctx(runner, s, 'rita'), 'aggregate_entities', { entity_type: 'users', group_by: 'roles' }),
    /Unsupported group_by field/,
    'nor the roles group',
  );
  const limitedPerson = await h.tools.execute(ctx(runner, s, 'rita'), 'get_entity_detail', { entity_type: 'users', entity_id: s.users.bruno });
  assert.equal('data_access' in limitedPerson.data || 'roles' in limitedPerson.data, false, 'no access block in limited access');
  const limitedCompany = await h.tools.execute(ctx(runner, s, 'rita'), 'get_entity_detail', { entity_type: 'companies', entity_id: s.companies.c1 });
  assert.equal('data_access' in limitedCompany.data, false, 'no Access tab block in limited access');
  const readerCompany = await h.tools.execute(ctx(runner, s, 'rob'), 'get_entity_detail', { entity_type: 'companies', entity_id: s.companies.c1 });
  assert.equal('data_access' in readerCompany.data, false, 'no Access tab block for a reader of users');
}

/**
 * What the tools say they do not read (Plaid L7, lot D), with the real policy: the full
 * administrator of users reads the two families, so they are not listed; the administrator in
 * limited access and the reader are told what they lack.
 */
async function testTheUnreadListsSayWhatIsMissing(h: Harness, runner: QueryRunner, s: Seed) {
  const unread = async (user: PersonKey) => (await h.tools.execute(ctx(runner, s, user), 'describe_entity_filters', { entity_type: 'users' })).families_not_read as string[];
  const full = await unread('ulla');
  assert.equal(full.some((line) => /^data access|^roles and their rights/.test(line)), false, full.join('\n'));
  const limited = await unread('rita');
  assert.ok(limited.some((line) => /^data access .*this person's access is limited to part of the data\.$/.test(line)), limited.join('\n'));
  assert.ok(limited.some((line) => /^roles and their rights .*this person's access is limited to part of the data\.$/.test(line)), limited.join('\n'));
  const reader = await unread('rob');
  assert.ok(reader.some((line) => /^data access .*which this person's role does not give\.$/.test(line)), reader.join('\n'));
  // A search that asks for the family names it with what is missing.
  const search = await h.tools.execute(ctx(runner, s, 'rita'), 'search_all', { query: 'accès limité aux données' });
  assert.match(search.not_read_here[0].note, /this server does not read them for this person/);
  const fullSearch = await h.tools.execute(ctx(runner, s, 'ulla'), 'search_all', { query: 'accès limité aux données' });
  assert.equal(fullSearch.not_read_here, undefined, 'read by the full administrator of users: nothing to say');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testListIsTheOverview(harness, runner, s);
      await testFiltersAndGroups(harness, runner, s);
      await testUnavailableInWords(harness, runner, s);
      await testUsersRolesAndMode(harness, runner, s);
      await testPersonAndCompanyDetails(harness, runner, s);
      await testGate(harness, runner, s);
      await testTheUnreadListsSayWhatIsMissing(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-data-access-query.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
