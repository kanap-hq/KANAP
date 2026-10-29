import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import { aiPermissionLevelLabel } from '../ai-role-labels';

// Plaid L7 lot A: the roles and their rights of Admin › Roles (`roles`, `role_permissions`), read
// through the assistant's and the MCP server's tools.
//
// - `roles` lists every role of the tenant with the kind of the screen's badge and `user_count`,
//   equal to the count `GET /roles` gives; nobody of another tenant shows.
// - The detail of a role (by name or id) is the matrix `GET /roles/:id/permissions` gives: every
//   right, null where the role gives none, a former name folded into today's (`opex` and `capex`
//   into `budget`, the higher level), the contacts right a suppliers contributor gets. No person
//   is named.
// - `role_permissions` lists one row per role and right it gives, filters on the right and the
//   level, and groups by level. A right and a level carry the Roles screen's words, in the
//   language of the person's profile, or in the four languages when it sets none.
// - The gate on a real transaction: users at admin level with access to all data reads, the same
//   right in limited access is refused with the reserved message.
// The AI surface checks (tenant settings, provider) are not under test: stubbed open.

process.env.STRIPE_SECRET_KEY = '';
process.env.JWT_SECRET ||= 'test-jwt-secret';
process.env.AI_SETTINGS_ENCRYPTION_SECRET ||= 'test-ai-secret';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9';
process.env.S3_BUCKET ||= 'ai-roles-query-spec';
process.env.AWS_ACCESS_KEY_ID ||= 'test';
process.env.AWS_SECRET_ACCESS_KEY ||= 'test';

type Harness = { app: any; dataSource: DataSource; tools: any; rolesRoute: any; query: any; aggregate: any };
type Seed = {
  tenantId: string;
  otherTenantId: string;
  roles: Record<'admin' | 'finance' | 'reader' | 'contact' | 'users', string>;
  users: Record<'admin' | 'unlimited' | 'limited', string>;
};

async function createHarness(): Promise<Harness> {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required for ai-roles-query.integration.spec.ts.');
  const { AppModule } = require('../../app.module');
  const { AiToolRegistry } = require('../ai-tool.registry');
  const { AiPolicyService } = require('../ai-policy.service');
  const { RolesController } = require('../../roles/roles.controller');
  const { AiQueryExecutor } = require('../query/ai-query.executor');
  const { AiAggregateExecutor } = require('../query/ai-aggregate.executor');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: false, abortOnError: false });
  app.get(AiPolicyService).assertSurfaceAccess = async () => undefined;
  return {
    app,
    dataSource: app.get(DataSource),
    tools: app.get(AiToolRegistry),
    rolesRoute: app.get(RolesController),
    query: app.get(AiQueryExecutor),
    aggregate: app.get(AiAggregateExecutor),
  };
}

async function insertId(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const rows = await runner.query(`${sql} RETURNING id`, params);
  return rows[0].id;
}

async function useTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

async function tenant(runner: QueryRunner, label: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `ai-roles-${label}-${tenantId.slice(0, 8)}`, `AI roles ${label}`],
  );
  return tenantId;
}

async function seed(runner: QueryRunner): Promise<Seed> {
  // Another tenant first: a role and a person nobody of the tenant under test may see.
  const otherTenantId = await tenant(runner, 'other');
  await useTenant(runner, otherTenantId);
  const otherRole = await insertId(runner, `INSERT INTO roles (tenant_id, role_name, role_description) VALUES ($1, 'Other tenant role', 'Elsewhere')`, [otherTenantId]);
  await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'budget', 'admin')`, [otherTenantId, otherRole]);
  const otherUser = await insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Other', 'Tenant', $3, 'enabled')`,
    [otherTenantId, `other-${otherTenantId.slice(0, 8)}@example.test`, otherRole]);
  await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [otherTenantId, otherUser, otherRole]);

  const tenantId = await tenant(runner, 'main');
  await useTenant(runner, tenantId);
  const tag = tenantId.slice(0, 8);
  const role = async (name: string, flags: { system?: boolean; builtIn?: boolean }, permissions: Array<[string, string]>) => {
    const id = await insertId(runner,
      `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in) VALUES ($1, $2, $3, $4, $5)`,
      [tenantId, name, `${name} description`, flags.system === true, flags.builtIn === true]);
    for (const [resource, level] of permissions) {
      await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, id, resource, level]);
    }
    return id;
  };
  const roles = {
    admin: await role('Administrator', { system: true }, [['budget', 'admin'], ['users', 'admin']]),
    // Stored under the former names: read as budget, at the higher of the two levels. A suppliers
    // contributor reads the contacts without a row of its own.
    finance: await role('Finance custom', {}, [['opex', 'member'], ['capex', 'admin'], ['suppliers', 'contributor']]),
    reader: await role('Budget Reader', { builtIn: true }, [['budget', 'reader'], ['contracts', 'reader']]),
    contact: await role('Contact', { system: true }, []),
    users: await role('People admin', {}, [['users', 'admin'], ['ai_chat', 'reader'], ['ai_mcp', 'reader']]),
  };
  const user = async (key: string, primary: string, extra: string[], mode: 'all' | 'limited' = 'all') => {
    const id = await insertId(runner,
      `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status, data_access_mode) VALUES ($1, $2, $3, 'Tester', $4, 'enabled', $5)`,
      [tenantId, `${key}-${tag}@example.test`, key, primary, mode]);
    await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [tenantId, id, primary]);
    for (const roleId of extra) {
      await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, false)`, [tenantId, id, roleId]);
    }
    return id;
  };
  const users = {
    admin: await user('Admin', roles.admin, []),
    unlimited: await user('Unlimited', roles.users, [roles.finance, roles.reader]),
    limited: await user('Limited', roles.users, [roles.reader], 'limited'),
  };
  return { tenantId, otherTenantId, roles, users };
}

function ctx(runner: QueryRunner, s: Seed, user: keyof Seed['users']) {
  return {
    tenantId: s.tenantId,
    userId: s.users[user],
    isPlatformHost: false,
    surface: 'mcp' as const,
    authMethod: 'api_key' as const,
    manager: runner.manager,
  };
}

/** The route's answer, in the spec's transaction (the request's query runner). */
function routeRequest(runner: QueryRunner) {
  return { queryRunner: { manager: runner.manager } };
}

async function testRolesListMatchesTheRoute(h: Harness, runner: QueryRunner, s: Seed) {
  const route = await h.rolesRoute.getRoles(routeRequest(runner));
  const result = await h.tools.execute(ctx(runner, s, 'unlimited'), 'query_entities', { entity_type: 'roles', limit: 50 });
  assert.equal(result.total, 5, 'every role of the tenant, none of the other');
  assert.deepEqual(
    result.items.map((item: any) => [item.label, item.metadata.user_count]),
    route.items.map((role: any) => [role.role_name, role.user_count]),
    'the names in the screen order and the counts of GET /roles',
  );
  const byName = new Map(result.items.map((item: any) => [item.label, item]));
  assert.deepEqual(
    ['Administrator', 'Budget Reader', 'Contact', 'Finance custom', 'People admin'].map((name) => (byName.get(name) as any).metadata.type),
    ['system', 'built_in', 'system', 'custom', 'custom'],
    'the kind of the screen badge',
  );
  assert.deepEqual(
    ['Administrator', 'Budget Reader', 'Contact', 'Finance custom', 'People admin'].map((name) => (byName.get(name) as any).metadata.user_count),
    [1, 2, 0, 1, 2],
    'primary and additional roles counted',
  );
  assert.equal(JSON.stringify(result).includes('Other tenant role'), false, 'another tenant stays out');
  assert.match((byName.get('Budget Reader') as any).page_url, /\/admin\/roles$/, 'a role opens the Roles screen');

  const custom = await h.tools.execute(ctx(runner, s, 'unlimited'), 'query_entities', {
    entity_type: 'roles',
    filters: { type: ['custom'] },
    sort: { field: 'user_count', direction: 'desc' },
  });
  assert.deepEqual(custom.items.map((item: any) => item.label), ['People admin', 'Finance custom'], 'custom roles, most given first');
  assert.deepEqual(custom.filters_applied, ['type']);
  const byType = await h.tools.execute(ctx(runner, s, 'unlimited'), 'aggregate_entities', { entity_type: 'roles', group_by: 'type' });
  assert.deepEqual(byType.groups, [{ key: 'custom', count: 2 }, { key: 'system', count: 2 }, { key: 'built_in', count: 1 }], 'roles by kind');
}

async function testRoleDetailIsTheMatrix(h: Harness, runner: QueryRunner, s: Seed) {
  const route = await h.rolesRoute.getRolePermissions(s.roles.finance, routeRequest(runner));
  const detail = await h.tools.execute(ctx(runner, s, 'unlimited'), 'get_entity_detail', { entity_type: 'roles', entity_id: 'finance custom' });
  assert.equal(detail.entity.id, s.roles.finance, 'found by its name, without case');
  assert.deepEqual(detail.data.permissions, route, 'the matrix of GET /roles/:id/permissions');
  assert.equal(detail.data.permissions.budget, 'admin', 'opex and capex read as budget, at the higher level');
  assert.equal(detail.data.permissions.contacts, 'reader', 'a suppliers contributor reads the contacts');
  assert.equal(detail.data.permissions.projects, null, 'a right the role does not give is null');
  assert.equal('opex' in detail.data.permissions || 'capex' in detail.data.permissions, false, 'no former name');
  assert.equal(Object.keys(detail.data.permissions).length, 32, 'every right of the screen');
  assert.equal(detail.data.user_count, 1);
  assert.match(detail.data.permissions_note, /never the codes/);
  // The rights it gives, with the screen's words: no profile language, so the four of the menus.
  assert.deepEqual(
    detail.data.rights.map((right: any) => [right.resource, right.level]),
    [['budget', 'admin'], ['suppliers', 'contributor'], ['contacts', 'reader']],
  );
  assert.equal(detail.data.rights[0].resource_label, 'en: Budget; fr: Budget; de: Budget; es: Presupuesto');
  assert.equal(detail.data.rights[0].level_label, 'en: Admin; fr: Administrateur; de: Administrator; es: Administrador');
  assert.equal(JSON.stringify(detail).includes('Unlimited'), false, 'no person is named');

  const byId = await h.tools.execute(ctx(runner, s, 'unlimited'), 'get_entity_detail', { entity_type: 'roles', entity_id: s.roles.reader });
  assert.equal(byId.data.name, 'Budget Reader', 'found by its id');
  await assert.rejects(
    () => h.tools.execute(ctx(runner, s, 'unlimited'), 'get_entity_detail', { entity_type: 'roles', entity_id: 'Other tenant role' }),
    /No roles record matches "Other tenant role"/,
    'a role of another tenant is not found',
  );
  await assert.rejects(
    () => h.tools.execute(ctx(runner, s, 'unlimited'), 'get_entity_detail', { entity_type: 'role_permissions', entity_id: s.roles.reader }),
    /"entity_type" must be one of/,
    'a right of a role has no detail: not a family of get_entity_detail',
  );
}

async function testRolePermissionsRows(h: Harness, runner: QueryRunner, s: Seed) {
  const budgetAdmin = await h.tools.execute(ctx(runner, s, 'unlimited'), 'query_entities', {
    entity_type: 'role_permissions',
    filters: { resource: ['budget'], level: ['admin'] },
  });
  assert.deepEqual(budgetAdmin.items.map((item: any) => item.metadata.role), ['Administrator', 'Finance custom'], 'which roles give budget admin');
  assert.deepEqual(budgetAdmin.items.map((item: any) => [item.metadata.resource, item.metadata.level]), [['budget', 'admin'], ['budget', 'admin']]);

  const finance = await h.tools.execute(ctx(runner, s, 'unlimited'), 'query_entities', { entity_type: 'role_permissions', filters: { role: 'Finance' } });
  assert.deepEqual(
    finance.items.map((item: any) => [item.metadata.resource, item.metadata.level]),
    [['budget', 'admin'], ['suppliers', 'contributor'], ['contacts', 'reader']],
    'the rights the role gives, in the screen order, the derived one included',
  );

  const all = await h.tools.execute(ctx(runner, s, 'unlimited'), 'query_entities', { entity_type: 'role_permissions', limit: 50 });
  assert.equal(all.total, 2 + 3 + 2 + 3, 'one row per right given, none for Contact');
  assert.equal(JSON.stringify(all).includes('Other tenant role'), false, 'another tenant stays out');

  const byLevel = await h.tools.execute(ctx(runner, s, 'unlimited'), 'aggregate_entities', { entity_type: 'role_permissions', group_by: 'level' });
  const level = (key: 'reader' | 'contributor' | 'member' | 'admin', count: number) => ({ key, count, label: aiPermissionLevelLabel(key, null) });
  assert.deepEqual(byLevel.groups, [level('admin', 4), level('reader', 5), level('contributor', 1)].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)), 'rights by level, named as the screen');
  assert.equal(byLevel.total, 10);
  const budgetByLevel = await h.tools.execute(ctx(runner, s, 'unlimited'), 'aggregate_entities', {
    entity_type: 'role_permissions',
    group_by: 'level',
    filters: { resource: ['budget'] },
  });
  assert.deepEqual(budgetByLevel.groups, [level('admin', 2), level('reader', 1)], 'the budget right by level');
}

async function testGateOnARealTransaction(h: Harness, runner: QueryRunner, s: Seed) {
  // An Administrator reads.
  const asAdmin = await h.tools.execute(ctx(runner, s, 'admin'), 'query_entities', { entity_type: 'roles' });
  assert.equal(asAdmin.total, 5);
  // users at admin level in limited access: the screen is closed to them, so is the family.
  for (const [tool, input] of [
    ['query_entities', { entity_type: 'roles' }],
    ['get_entity_detail', { entity_type: 'roles', entity_id: 'Administrator' }],
    ['aggregate_entities', { entity_type: 'role_permissions', group_by: 'level' }],
    ['describe_entity_filters', { entity_type: 'role_permissions' }],
  ] as const) {
    await assert.rejects(
      () => h.tools.execute(ctx(runner, s, 'limited'), tool, input),
      /reserved to people with access to all data/,
      `${tool} ${input.entity_type}: refused in limited access`,
    );
  }
}

/**
 * `user_count` is the Roles screen's count (`user_roles`), and says the users list filtered on
 * `roles` may count more: that filter also reads the primary role kept on the person's record
 * (Plaid L7, lot E; the data is not repaired).
 */
async function testTheUserCountIsTheScreens(h: Harness, runner: QueryRunner, s: Seed) {
  await runner.query(
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Recordonly', 'Tester', $3, 'enabled')`,
    [s.tenantId, `recordonly-${s.tenantId.slice(0, 8)}@example.test`, s.roles.reader],
  );
  const route = await h.rolesRoute.getRoles(routeRequest(runner));
  const roles = await h.tools.execute(ctx(runner, s, 'unlimited'), 'query_entities', { entity_type: 'roles', filters: { name: 'Budget Reader' } });
  assert.equal(roles.items[0].metadata.user_count, route.items.find((role: any) => role.role_name === 'Budget Reader').user_count, 'the count of the screen');
  assert.equal(roles.items[0].metadata.user_count, 2);
  const people = await h.tools.execute(ctx(runner, s, 'unlimited'), 'query_entities', { entity_type: 'users', filters: { roles: ['Budget Reader'] } });
  assert.equal(people.total, 3, 'the users list also reads the primary role of the record');
  const described = await h.tools.execute(ctx(runner, s, 'unlimited'), 'describe_entity_filters', { entity_type: 'roles' });
  const description = JSON.stringify(described);
  assert.match(description, /the count of the Roles screen, to quote as such/);
  assert.match(description, /filtered on `roles` also counts a person whose primary role it is on their own record only/);
}

/**
 * The executors check the right again, the tool not being the only gate (Plaid L7, lot E): a
 * direct call without users at admin level, or in limited access, is refused in words.
 */
async function testTheExecutorsCheckTheRight(h: Harness, runner: QueryRunner, s: Seed) {
  const budgetReader = await insertId(runner,
    `INSERT INTO users (tenant_id, email, first_name, last_name, role_id, status) VALUES ($1, $2, 'Budget', 'Only', $3, 'enabled')`,
    [s.tenantId, `budget-only-${s.tenantId.slice(0, 8)}@example.test`, s.roles.reader]);
  await runner.query(`INSERT INTO user_roles (tenant_id, user_id, role_id, is_primary) VALUES ($1, $2, $3, true)`, [s.tenantId, budgetReader, s.roles.reader]);
  const withoutRight = { ...ctx(runner, s, 'admin'), userId: budgetReader };
  const calls = (context: any) => [
    ['query roles', () => h.query.execute(context, { entity_type: 'roles' })],
    ['query role_permissions', () => h.query.execute(context, { entity_type: 'role_permissions' })],
    ['detail of a role', () => h.query.executeDetail(context, { entity_type: 'roles', entity_id: 'Administrator' })],
    ['aggregate roles', () => h.aggregate.execute(context, { entity_type: 'roles', group_by: 'type' })],
    ['aggregate role_permissions', () => h.aggregate.execute(context, { entity_type: 'role_permissions', group_by: 'level' })],
  ] as const;
  for (const [name, call] of calls(withoutRight)) {
    await assert.rejects(call, /You need the right to administer users \(the right the Admin › Roles screen asks for\)/, `${name}: refused without the right`);
  }
  for (const [name, call] of calls(ctx(runner, s, 'limited'))) {
    await assert.rejects(call, /reserved to people with access to all data/, `${name}: refused in limited access`);
  }
  const allowed = await h.query.execute(ctx(runner, s, 'unlimited'), { entity_type: 'roles' });
  assert.ok(allowed.total >= 5, 'the right reads');
}

/** A French profile: the French words of the Roles screen (Plaid L7, lot D). */
async function testTheWordsFollowTheProfile(h: Harness, runner: QueryRunner, s: Seed) {
  await runner.query(`UPDATE users SET locale = 'fr' WHERE id = $1`, [s.users.unlimited]);
  const rows = await h.tools.execute(ctx(runner, s, 'unlimited'), 'query_entities', { entity_type: 'role_permissions', filters: { role: 'Finance' } });
  assert.deepEqual(
    rows.items.map((item: any) => [item.label, item.metadata.resource, item.metadata.resource_label, item.metadata.level, item.metadata.level_label]),
    [
      ['Finance custom: Budget', 'budget', 'Budget', 'admin', 'Administrateur'],
      ['Finance custom: Fournisseurs', 'suppliers', 'Fournisseurs', 'contributor', 'Contributeur'],
      ['Finance custom: Contacts', 'contacts', 'Contacts', 'reader', 'Lecteur'],
    ],
  );
  const detail = await h.tools.execute(ctx(runner, s, 'unlimited'), 'get_entity_detail', { entity_type: 'roles', entity_id: 'Finance custom' });
  assert.deepEqual(detail.data.rights[1], { resource: 'suppliers', resource_label: 'Fournisseurs', level: 'contributor', level_label: 'Contributeur' });
  const byResource = await h.tools.execute(ctx(runner, s, 'unlimited'), 'aggregate_entities', { entity_type: 'role_permissions', group_by: 'resource', filters: { role: 'Budget Reader' } });
  assert.deepEqual(byResource.groups, [{ key: 'budget', count: 1, label: 'Budget' }, { key: 'contracts', count: 1, label: 'Contrats' }]);
  const roles = await h.tools.execute(ctx(runner, s, 'unlimited'), 'aggregate_entities', { entity_type: 'roles', group_by: 'type' });
  assert.equal('label' in roles.groups[0], false, 'a kind of role keeps its code');
}

async function run() {
  const harness = await createHarness();
  try {
    const runner = harness.dataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      const s = await seed(runner);
      await testRolesListMatchesTheRoute(harness, runner, s);
      await testRoleDetailIsTheMatrix(harness, runner, s);
      await testRolePermissionsRows(harness, runner, s);
      await testGateOnARealTransaction(harness, runner, s);
      await testTheWordsFollowTheProfile(harness, runner, s);
      await testTheUserCountIsTheScreens(harness, runner, s);
      await testTheExecutorsCheckTheRight(harness, runner, s);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  } finally {
    await harness.app.close();
  }
  console.log('ai-roles-query.integration.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
