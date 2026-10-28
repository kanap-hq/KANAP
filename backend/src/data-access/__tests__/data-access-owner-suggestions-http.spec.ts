// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  PARAMTYPES_METADATA,
  PIPES_METADATA,
  ROUTE_ARGS_METADATA,
  SELF_DECLARED_DEPS_METADATA,
} from '@nestjs/common/constants';
import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import appDataSource from '../../data-source';
import { StripeConfigService } from '../../billing/stripe/stripe.config';
import { PermissionGuard } from '../../auth/permission.guard';
import { ReleaseTenantRunnerFilter } from '../../common/filters/release-tenant-runner.filter';
import { TenantInitGuard } from '../../common/tenant-init.guard';
import { TenantInterceptor } from '../../common/tenant.interceptor';
import { withTenantExecution } from '../../common/tenant-runner';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';
import { BudgetLinesController } from '../../spend/budget-lines.controller';
import { UsersService } from '../../users/users.service';
import { OWNER_SUGGESTIONS_MAX } from '../data-access-people';
import { APP_URL, LIMITED_ROLE, PgClient, connect, roleExists, seedNodes, seedPerson, seedRole, seedTree } from './data-access-test-helpers';

/**
 * Data-scoped access, lot 4: `GET /budget-lines/owner-suggestions?cost_center_id=`, over HTTP,
 * through the real tenant interceptor and permission guard.
 *
 * - an unscoped budget member and a limited budget member read the same names, in the `USER_LOOKUP`
 *   order, names only (no email for a unique name, no access level, no node or path);
 * - a budget reader is refused (403): the pickers belong to the people who edit lines;
 * - the response is capped at 500 with `has_more: true` beyond;
 * - a limited caller asks only about a centre it reads or may place a line on, or about the centre
 *   of a readable line (`line=`); outside that scope the answer is empty, and a hidden line is 404;
 * - the parameter is required and must be a uuid (400); a well-formed unknown centre is empty;
 * - the static route is not swallowed by `GET :ref`.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 3 });
let client: PgClient;
let s: Seed;
let app: INestApplication | null = null;

type Seed = {
  tenantId: string;
  nodes: { k1: string; k4: string; k5: string };
  persons: {
    member: string;
    limitedMember: string;
    reader: string;
    administrator: string;
  };
  lines: { visible: string; hidden: string };
};

// ---------------------------------------------------------------------------------------------
// The real controller; its services are not under test.

const CONTROLLERS = [BudgetLinesController];

function stub(): any {
  const fn = () => Promise.resolve(undefined);
  return new Proxy({}, {
    get: (_target, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : fn),
  });
}

function depsOf(cls: any): unknown[] {
  const tokens: unknown[] = [...(Reflect.getMetadata(PARAMTYPES_METADATA, cls) ?? [])];
  for (const { index, param } of Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, cls) ?? []) tokens[index] = param;
  return tokens.map((token: any) => (token && typeof token === 'object' && typeof token.forwardRef === 'function' ? token.forwardRef() : token));
}

function enhancersOf(controller: any): any[] {
  const targets = [controller, ...Object.getOwnPropertyNames(controller.prototype).map((name) => controller.prototype[name])];
  const out: any[] = [];
  for (const target of targets) {
    if (typeof target !== 'function') continue;
    for (const key of [GUARDS_METADATA, INTERCEPTORS_METADATA, PIPES_METADATA]) {
      for (const enhancer of Reflect.getMetadata(key, target) ?? []) if (typeof enhancer === 'function') out.push(enhancer);
    }
  }
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, controller, name) ?? {};
    for (const arg of Object.values<any>(args)) {
      for (const pipe of arg?.pipes ?? []) if (typeof pipe === 'function') out.push(pipe);
    }
  }
  return out;
}

/** The guard's own user lookup, under the request's tenant manager. */
const guardUsers = {
  findById: async (id: string, opts?: { manager?: EntityManager }) => {
    const manager = opts?.manager ?? dataSource.manager;
    const [row] = await manager.query(
      `SELECT u.id, u.status, u.role_id, r.role_name
         FROM users u
         LEFT JOIN roles r ON r.tenant_id = u.tenant_id AND r.id = u.role_id
        WHERE u.tenant_id = app_current_tenant() AND u.id = $1`,
      [id],
    );
    return row ? { ...row, role: row.role_name ? { role_name: row.role_name } : null } : null;
  },
};

function testModule(): any {
  const perms = new PermissionsService(
    dataSource.getRepository(UserPageRole),
    dataSource.getRepository(RolePermission),
  );
  const guard = new PermissionGuard(
    new Reflector(),
    guardUsers as any,
    perms,
    dataSource,
    { isConfigured: () => false } as any,
  );
  const real = new Map<unknown, unknown>([
    [DataSource, dataSource],
    [PermissionsService, perms],
    [PermissionGuard, guard],
    [UsersService, guardUsers],
    [StripeConfigService, { isConfigured: () => false }],
    [getRepositoryToken(UserPageRole), dataSource.getRepository(UserPageRole)],
    [getRepositoryToken(RolePermission), dataSource.getRepository(RolePermission)],
  ]);
  const enhancers = new Set<any>();
  for (const controller of CONTROLLERS) for (const enhancer of enhancersOf(controller)) enhancers.add(enhancer);
  for (const enhancer of enhancers) {
    if (enhancer === PermissionGuard) continue;
    if (typeof enhancer.prototype?.canActivate !== 'function') continue;
    enhancer.prototype.canActivate = () => true;
    if (typeof enhancer.prototype.onModuleInit === 'function') enhancer.prototype.onModuleInit = () => undefined;
  }
  const tokens = new Set<unknown>();
  const built = [...enhancers].filter((enhancer) => enhancer !== PermissionGuard && typeof enhancer.prototype?.transform !== 'function');
  for (const cls of [...CONTROLLERS, ...built]) {
    for (const token of depsOf(cls)) {
      if (token === undefined || token === Object) throw new Error(`${cls.name}: a dependency the spec cannot stub`);
      if (token !== Reflector) tokens.add(token);
    }
  }
  tokens.add(PermissionGuard);
  tokens.add(DataSource);
  for (const token of depsOf(PermissionGuard)) {
    if (token !== Reflector) tokens.add(token);
  }
  const providers = [...tokens].map((token) => ({ provide: token as any, useValue: real.has(token) ? real.get(token) : stub() }));
  @Module({ controllers: CONTROLLERS, providers })
  class OwnerSuggestionsModule {}
  return OwnerSuggestionsModule;
}

async function createApp(): Promise<INestApplication> {
  const created = await NestFactory.create(testModule(), { logger: false });
  const reflector = created.get(Reflector);
  created.use((req: any, _res: any, next: () => void) => {
    req.tenant = { id: s.tenantId, slug: 'owner-suggestions', name: 'Owner suggestions' };
    const user = req.headers['x-da-user'];
    if (typeof user === 'string' && user) req.user = { sub: user };
    next();
  });
  created.useGlobalGuards(new TenantInitGuard(dataSource, reflector));
  created.useGlobalInterceptors(new TenantInterceptor(dataSource, reflector));
  const { httpAdapter } = created.get(HttpAdapterHost);
  created.useGlobalFilters(new ReleaseTenantRunnerFilter(httpAdapter));
  await created.listen(0, '127.0.0.1');
  return created;
}

type Answer = { status: number; text: string; body: any };

async function call(path: string, userId: string): Promise<Answer> {
  const { port } = app!.getHttpServer().address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/${path}`, {
    headers: { 'x-da-user': userId },
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: res.status, text, body };
}

// ---------------------------------------------------------------------------------------------
// Seed.

const EXTRA_COUNT = OWNER_SUGGESTIONS_MAX + 1;

async function seed(): Promise<Seed> {
  await client.query('BEGIN');
  try {
    const tree = await seedTree(client);
    const tenantId = tree.tenantId;
    const memberRole = await seedRole(client, tenantId, 'Budget member');
    const readerRole = await seedRole(client, tenantId, 'Budget reader');
    const noBudgetRole = await seedRole(client, tenantId, 'No budget');
    const administratorRole = await seedRole(client, tenantId, 'Administrator');
    for (const [roleId, level] of [[memberRole, 'member'], [readerRole, 'reader']] as const) {
      await client.query(
        `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'budget', $3)`,
        [tenantId, roleId, level],
      );
    }

    const person = async (
      mode: 'all' | 'limited',
      roleId: string,
      first: string,
      last: string,
      nodes: Parameters<typeof seedNodes>[3] = [],
      status: 'enabled' | 'disabled' = 'enabled',
    ): Promise<string> => {
      const id = await seedPerson(client, tenantId, mode, roleId);
      await seedNodes(client, tenantId, id, nodes);
      await client.query(
        `UPDATE users SET first_name = $2, last_name = $3, status = $4::status_state WHERE id = $1`,
        [id, first, last, status],
      );
      return id;
    };

    const member = await person('all', memberRole, 'Mona', 'Member');
    const limitedMember = await person('limited', memberRole, 'Lea', 'Limited', [
      { type: 'cost_center', id: tree.nodes.k1, access: 'read' },
    ]);
    const reader = await person('all', readerRole, 'Rita', 'Reader');
    const administrator = await person('limited', administratorRole, 'Ada', 'Administrator');
    // Out of the group: another centre, no budget right, disabled.
    await person('limited', memberRole, 'Nina', 'Other', [{ type: 'cost_center', id: tree.nodes.k4, access: 'read' }]);
    await person('limited', noBudgetRole, 'Noa', 'Nobudget', [{ type: 'cost_center', id: tree.nodes.k1, access: 'read' }]);
    await person('all', noBudgetRole, 'Otto', 'Outsider');
    await person('all', memberRole, 'Dan', 'Disabled', [], 'disabled');
    for (let i = 1; i <= EXTRA_COUNT; i += 1) {
      await person('all', memberRole, `Extra ${String(i).padStart(3, '0')}`, 'Zeta');
    }

    // Lines on K4, outside Lea's nodes: one she reads as IT owner, one she cannot read.
    const line = async (name: string, ownerItId: string, itemNumber: number): Promise<string> => {
      const { rows } = await client.query(
        `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, nature, paying_company_id, cost_center_id, owner_it_id)
         VALUES ($1, $2, 'EUR', '2026-01-01', $3, 'opex', $4, $5, $6) RETURNING id`,
        [tenantId, name, itemNumber, tree.companies.c1, tree.nodes.k4, ownerItId],
      );
      return rows[0].id as string;
    };
    const visibleLine = await line('Visible through ownership', limitedMember, 1_000_001);
    const hiddenLine = await line('Hidden from Lea', member, 1_000_002);

    await client.query('COMMIT');
    return {
      tenantId,
      nodes: { k1: tree.nodes.k1, k4: tree.nodes.k4, k5: tree.nodes.k5 },
      persons: { member, limitedMember, reader, administrator },
      lines: { visible: visibleLine, hidden: hiddenLine },
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

// ---------------------------------------------------------------------------------------------
// Tests.

const ALL_NAMES = [
  'Ada Administrator',
  'Lea Limited',
  'Mona Member',
  'Rita Reader',
  ...Array.from({ length: EXTRA_COUNT }, (_, i) => `Extra ${String(i + 1).padStart(3, '0')} Zeta`),
];
/** The response cap, in `USER_LOOKUP` order: the four base names, then 496 Extra rows. */
const EXPECTED_NAMES = ALL_NAMES.slice(0, OWNER_SUGGESTIONS_MAX);

function namesOf(answer: Answer): string[] {
  return answer.body.items.map((item: any) => [item.first_name, item.last_name].filter(Boolean).join(' '));
}

async function testSuggestions(): Promise<void> {
  // `limit=1` is ignored: the route caps at its own 500, after the lookup order, and reports more.
  const member = await call(`budget-lines/owner-suggestions?cost_center_id=${s.nodes.k1}&limit=1`, s.persons.member);
  assert.equal(member.status, 200, member.text);
  assert.equal(member.body.has_more, true, member.text);
  assert.deepEqual(namesOf(member), EXPECTED_NAMES, `the first 500 people, in the USER_LOOKUP order: ${member.text}`);
  assert.equal(member.body.items.length, OWNER_SUGGESTIONS_MAX, member.text);
  for (const item of member.body.items) {
    assert.deepEqual(
      Object.keys(item).sort(),
      ['email', 'first_name', 'id', 'last_name', 'status'],
      `names-only columns: ${JSON.stringify(item)}`,
    );
    assert.equal(item.email, null, `a unique name shows no email: ${JSON.stringify(item)}`);
    assert.equal(item.access, undefined, 'no access level');
  }
  assert.ok(!namesOf(member).includes('Nina Other'), 'a node on another centre stays out');
  assert.ok(!namesOf(member).includes('Noa Nobudget'), 'a limited person without the budget right stays out');
  assert.ok(!namesOf(member).includes('Otto Outsider'), 'a mode-all person without the budget right stays out');
  assert.ok(!namesOf(member).includes('Dan Disabled'), 'a disabled person stays out');
  console.log('  unscoped budget member: names only, order, cap at 500 with has_more, exclusions: OK');

  const limited = await call(`budget-lines/owner-suggestions?cost_center_id=${s.nodes.k1}`, s.persons.limitedMember);
  assert.equal(limited.status, 200, limited.text);
  assert.deepEqual(limited.body.items, member.body.items, 'the limited member reads the same names');
  console.log('  limited budget member: same answer through the limited role: OK');

  const reader = await call(`budget-lines/owner-suggestions?cost_center_id=${s.nodes.k1}`, s.persons.reader);
  assert.equal(reader.status, 403, `a budget reader is refused: ${reader.text}`);
  assert.equal(reader.body?.code, 'MODULE_RIGHT_REQUIRED', reader.text);
  console.log('  budget reader: 403: OK');

  const unknown = await call(`budget-lines/owner-suggestions?cost_center_id=${randomUUID()}`, s.persons.member);
  assert.equal(unknown.status, 200, unknown.text);
  assert.deepEqual(unknown.body, { items: [], has_more: false }, 'an unknown well-formed centre is empty');
  const missing = await call('budget-lines/owner-suggestions', s.persons.member);
  assert.equal(missing.status, 400, missing.text);
  const invalid = await call('budget-lines/owner-suggestions?cost_center_id=not-a-uuid', s.persons.member);
  assert.equal(invalid.status, 400, invalid.text);
  console.log('  unknown centre empty, missing or invalid parameter 400: OK');

  // A limited member does not read K4 through its nodes: the answer is empty, not a 403.
  const outside = await call(`budget-lines/owner-suggestions?cost_center_id=${s.nodes.k4}`, s.persons.limitedMember);
  assert.equal(outside.status, 200, outside.text);
  assert.deepEqual(outside.body, { items: [], has_more: false }, 'a centre outside the limited caller\'s nodes is empty');
  console.log('  limited caller, centre outside its nodes: empty: OK');

  // The line she reads as owner accepts its centre, even though her nodes do not cover it.
  const throughLine = await call(
    `budget-lines/owner-suggestions?cost_center_id=${s.nodes.k4}&line=${s.lines.visible}`,
    s.persons.limitedMember,
  );
  assert.equal(throughLine.status, 200, throughLine.text);
  assert.equal(throughLine.body.items.length, OWNER_SUGGESTIONS_MAX, throughLine.text);
  assert.equal(throughLine.body.has_more, true, throughLine.text);
  assert.ok(namesOf(throughLine).includes('Nina Other'), 'the centre\'s own limited reader is suggested');
  assert.ok(!namesOf(throughLine).includes('Lea Limited'), 'the owner of the line is not a reader of the centre');
  console.log('  limited caller, readable line on that centre: the list: OK');

  // The line only accepts its own centre: another centre stays out of scope.
  const otherCentre = await call(
    `budget-lines/owner-suggestions?cost_center_id=${s.nodes.k5}&line=${s.lines.visible}`,
    s.persons.limitedMember,
  );
  assert.equal(otherCentre.status, 200, otherCentre.text);
  assert.deepEqual(otherCentre.body, { items: [], has_more: false }, 'a line does not open another centre');
  const hiddenLine = await call(
    `budget-lines/owner-suggestions?cost_center_id=${s.nodes.k4}&line=${s.lines.hidden}`,
    s.persons.limitedMember,
  );
  assert.equal(hiddenLine.status, 404, `a hidden line answers as a missing one: ${hiddenLine.text}`);
  console.log('  line of another centre empty, hidden line 404: OK');
}

// ---------------------------------------------------------------------------------------------
// Run.

async function cleanup(): Promise<void> {
  if (!s) return;
  await withTenantExecution(dataSource, s.tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES))
    .catch((error) => console.error(`could not purge ${s.tenantId}:`, error));
  await client.query(`DELETE FROM tenants WHERE id = $1`, [s.tenantId])
    .catch((error: unknown) => console.error(`could not delete ${s.tenantId}:`, error));
}

async function run(): Promise<void> {
  client = await connect(APP_URL);
  await dataSource.initialize();
  try {
    if (!(await roleExists(client))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`owner suggestions: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    console.log('budget line owner suggestions over HTTP');
    s = await seed();
    app = await createApp();
    await testSuggestions();
    console.log('  owner suggestions: all scenarios passed');
  } finally {
    if (app) await app.close();
    try {
      await cleanup();
    } finally {
      await dataSource.destroy();
      await client.end();
    }
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
