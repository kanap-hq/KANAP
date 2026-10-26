import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { getRepositoryToken } from '@nestjs/typeorm';
import * as jwt from 'jsonwebtoken';
import { DataSource, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { buildAccessTokenPayload } from '../../auth/auth.service';
import { REQUIRE_ANY_LEVEL_KEY } from '../../auth/require-level.decorator';
import { StripeConfigService } from '../../billing/stripe/stripe.config';
import { CompaniesController } from '../../companies/companies.controller';
import { CompaniesDeleteService } from '../../companies/companies-delete.service';
import { CompaniesService } from '../../companies/companies.service';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { useRequestPipeline } from '../../common/request-pipeline';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { Role } from '../../roles/role.entity';
import { User } from '../../users/user.entity';
import { UserRole } from '../../users/user-role.entity';
import { UsersController } from '../../users/users.controller';
import { UsersDeleteService } from '../../users/users-delete.service';
import { UsersService } from '../../users/users.service';
import { createRaceTenant, dropRaceTenant, seed } from '../../spend/__tests__/race-harness';
import { CostCentersCsvService } from '../cost-centers-csv.service';
import { CostCentersDeleteService } from '../cost-centers-delete.service';
import { CostCentersController, TREE_READERS } from '../cost-centers.controller';
import { CostCentersService } from '../cost-centers.service';

// `GET /cost-centers/tree` and `GET /cost-centers/tree/count` over HTTP, with
// the real controller, its real guards (JwtAuthGuard on a signed access token,
// PermissionGuard on roles stored in the database) and the request pipeline
// main.ts installs: the tree's shape and order, who may read it (the page's
// readers and the budget and reporting readers, nobody else), the tenant
// (another tenant's session reads none of these nodes), and the cache
// validators (an unchanged tree answers 304 to its ETag, a renamed node a new
// body).
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

process.env.JWT_SECRET = process.env.JWT_SECRET || `cost-centers-tree-http-${randomUUID()}`;

@Module({
  controllers: [CostCentersController, CompaniesController, UsersController],
  providers: [
    ListContextsService,
    { provide: CostCentersService, useFactory: () => new CostCentersService(new AuditService(undefined as any)) },
    // Not reached by the routes under test.
    { provide: CostCentersDeleteService, useValue: {} },
    { provide: CostCentersCsvService, useValue: {} },
    // The company and user lookups read the reference in SQL; their services are not reached.
    { provide: CompaniesService, useValue: {} },
    { provide: CompaniesDeleteService, useValue: {} },
    { provide: UsersDeleteService, useValue: {} },
    // PermissionGuard's dependencies, as the lookup access spec builds them (no Stripe: no freeze check).
    { provide: UsersService, useFactory: () => new (UsersService as any)(dataSource.getRepository(User)) },
    { provide: getRepositoryToken(UserRole), useFactory: () => dataSource.getRepository(UserRole) },
    { provide: getRepositoryToken(Role), useFactory: () => dataSource.getRepository(Role) },
    { provide: getRepositoryToken(User), useFactory: () => dataSource.getRepository(User) },
    { provide: AuditService, useFactory: () => new AuditService(dataSource.getRepository(AuditLog)) },
    {
      provide: PermissionsService,
      useFactory: () => new PermissionsService(dataSource.getRepository(UserPageRole), dataSource.getRepository(RolePermission)),
    },
    { provide: DataSource, useValue: dataSource },
    { provide: StripeConfigService, useValue: { isConfigured: () => false } },
  ],
})
class TreeProbeModule {}

async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(TreeProbeModule, { logger: false });
  // The tenant middleware's job, from a header: the token must name the same tenant.
  app.use((req: any, _res: any, next: () => void) => {
    const tenantId = req.headers['x-probe-tenant'];
    if (tenantId) req.tenant = { id: tenantId, slug: 'tree-probe', name: 'Tree probe' };
    next();
  });
  useRequestPipeline(app, dataSource);
  await app.listen(0, '127.0.0.1');
  return app;
}

/** Wait until every pooled connection is back, i.e. the request transaction is finished. */
async function waitForIdlePool() {
  const pool: any = (dataSource.driver as any).master;
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (pool.totalCount === pool.idleCount && pool.waitingCount === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`a request left a connection out of the pool (total ${pool.totalCount}, idle ${pool.idleCount})`);
}

type Level = 'reader' | 'contributor' | 'member' | 'admin';

async function seedPerson(runner: QueryRunner, tenantId: string, label: string, permissions: Record<string, Level>, roleName?: string) {
  const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
  const roleId = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`, [tenantId, roleName ?? `Tree ${label}`]);
  for (const [resource, level] of Object.entries(permissions)) {
    await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
  }
  const email = `${label.replace(/\s+/g, '-')}-${randomUUID()}@example.invalid`;
  const id = await one(
    `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, 'Tree', $3, $4, 'enabled') RETURNING id`,
    [tenantId, roleId, label, email],
  );
  return { id, email, tenant_id: tenantId };
}

function token(user: { id: string; email: string; tenant_id: string }): string {
  return jwt.sign(buildAccessTokenPayload(user), process.env.JWT_SECRET as string, { expiresIn: '10m' });
}

async function main() {
  await dataSource.initialize();
  const tenantA = await createRaceTenant('cc-tree-http');
  const tenantB = await createRaceTenant('cc-tree-http-b');
  let app: INestApplication | undefined;
  try {
    // The route's guard list, pinned: a change to who reads the tree must change this spec.
    assert.deepEqual(TREE_READERS, [
      ...['cost_centers', 'budget', 'reporting'].map((resource) => ({ resource, level: 'reader' })),
      { resource: 'users', level: 'admin' },
    ]);
    for (const handler of ['tree', 'treeCount'] as const) {
      assert.deepEqual(Reflect.getMetadata(REQUIRE_ANY_LEVEL_KEY, (CostCentersController.prototype as any)[handler]), TREE_READERS, handler);
    }

    const a = await seed(tenantA, async (runner) => {
      const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
      const paris = await one(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Tree Paris', 'FR', 'Paris') RETURNING id`, [tenantA]);
      const people = {
        page: await seedPerson(runner, tenantA, 'page reader', { cost_centers: 'reader' }),
        budget: await seedPerson(runner, tenantA, 'budget reader', { budget: 'reader' }),
        reporting: await seedPerson(runner, tenantA, 'reporting reader', { reporting: 'reader' }),
        admin: await seedPerson(runner, tenantA, 'admin', {}, 'Administrator'),
        tasks: await seedPerson(runner, tenantA, 'tasks member', { tasks: 'member', companies: 'admin' }),
        // Administers users and nothing else: the data-access screens' pickers need the tree and
        // the company and person sources for this person (spec §7.1).
        usersAdmin: await seedPerson(runner, tenantA, 'users admin', { users: 'admin' }),
      };
      const group = await one(`INSERT INTO cost_centers (tenant_id, code, kind, name) VALUES ($1, 'T-G', 'group', 'Tree group') RETURNING id`, [tenantA]);
      // Siblings by sort order, then code: T-2 (sort 0) before T-1 (sort 5).
      const second = await one(
        `INSERT INTO cost_centers (tenant_id, code, kind, name, parent_id, company_id, owner_user_id, sort_order) VALUES ($1, 'T-1', 'cost_center', 'Tree one', $2, $3, $4, 5) RETURNING id`,
        [tenantA, group, paris, people.budget.id],
      );
      const first = await one(
        `INSERT INTO cost_centers (tenant_id, code, kind, name, parent_id, company_id, disabled_at) VALUES ($1, 'T-2', 'cost_center', 'Tree two', $2, $3, now() - interval '1 day') RETURNING id`,
        [tenantA, group, paris],
      );
      return { paris, people, group, first, second };
    });
    const b = await seed(tenantB, async (runner) => ({ admin: await seedPerson(runner, tenantB, 'admin b', {}, 'Administrator') }));

    app = await createApp();
    const base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
    const get = async (path: string, user: { id: string; email: string; tenant_id: string }, headers: Record<string, string> = {}) => {
      const res = await fetch(`${base}${path}`, {
        headers: { authorization: `Bearer ${token(user)}`, 'x-probe-tenant': user.tenant_id, ...headers },
      });
      const text = await res.text();
      await waitForIdlePool();
      return { status: res.status, etag: res.headers.get('etag'), cacheControl: res.headers.get('cache-control'), text, body: text ? JSON.parse(text) : null };
    };

    // Shape and order: the tree's nodes in tree order (siblings by sort order, then code), effective status.
    const tree = await get('/cost-centers/tree', a.people.page);
    assert.equal(tree.status, 200, tree.text);
    assert.deepEqual(Object.keys(tree.body), ['items']);
    const items = tree.body.items as Array<Record<string, unknown>>;
    assert.deepEqual(items.map((node) => [node.code, node.depth, node.path, node.status]), [
      ['T-G', 0, 'Tree group', 'enabled'],
      ['T-2', 1, 'Tree group › Tree two', 'disabled'],
      ['T-1', 1, 'Tree group › Tree one', 'enabled'],
    ]);
    assert.deepEqual(items[2], {
      id: a.second, code: 'T-1', name: 'Tree one', kind: 'cost_center', parent_id: a.group,
      company_id: a.paris, company_name: 'Tree Paris', owner_user_id: a.people.budget.id, owner_name: 'Tree budget reader',
      status: 'enabled', disabled_at: null, sort_order: 5, depth: 1, path: 'Tree group › Tree one', path_ids: [a.group, a.second],
    });
    assert.ok(items[1].disabled_at, 'the end of validity of a disabled node');
    const count = await get('/cost-centers/tree/count', a.people.page);
    assert.deepEqual([count.status, count.body], [200, { count: 3 }]);
    console.log('ok - the tree in tree order, effective status; count');

    // Who reads it: the page, the item forms and the reports; nobody else.
    for (const who of ['page', 'budget', 'reporting', 'admin', 'usersAdmin'] as const) {
      const answer = await get('/cost-centers/tree', a.people[who]);
      assert.equal(answer.status, 200, `${who}: reads the tree`);
      assert.equal(answer.text, tree.text, `${who}: the same tree`);
      assert.equal((await get('/cost-centers/tree/count', a.people[who])).status, 200, `${who}: reads the count`);
    }
    // The picker sources of the data-access screens for a users administrator without budget
    // rights: the tree above (useCostCenterTree), the company source (CompanySelect) and the
    // person source (AccessPersonAdd).
    const companiesLookup = await get('/companies/lookup?q=Tree', a.people.usersAdmin);
    assert.equal(companiesLookup.status, 200, companiesLookup.text);
    assert.deepEqual(companiesLookup.body.items.map((company: any) => [company.id, company.name]), [[a.paris, 'Tree Paris']]);
    const peopleLookup = await get('/users/lookup?q=Tree', a.people.usersAdmin);
    assert.equal(peopleLookup.status, 200, peopleLookup.text);
    assert.equal(peopleLookup.body.items.length, 6, 'the users administrator searches the person list');
    assert.ok(peopleLookup.body.items.every((person: any) => person.first_name === 'Tree'), peopleLookup.text);
    assert.equal((await get('/cost-centers/tree', a.people.tasks)).status, 403, 'no cost center, budget or reporting access: refused');
    assert.equal((await get('/cost-centers/tree/count', a.people.tasks)).status, 403);
    const anonymous = await fetch(`${base}/cost-centers/tree`, { headers: { 'x-probe-tenant': tenantA } });
    assert.equal(anonymous.status, 401);
    await waitForIdlePool();
    console.log('ok - read by cost center, budget and reporting readers, administrators and users administrators; company and person sources for a users administrator; 403 otherwise, 401 without a token');

    // Tenant: another tenant's administrator reads an empty tree.
    const other = await get('/cost-centers/tree', b.admin);
    assert.deepEqual([other.status, other.body], [200, { items: [] }]);
    assert.deepEqual((await get('/cost-centers/tree/count', b.admin)).body, { count: 0 });
    // A token of tenant B on tenant A's address is refused before any read.
    const crossed = await fetch(`${base}/cost-centers/tree`, { headers: { authorization: `Bearer ${token(b.admin)}`, 'x-probe-tenant': tenantA } });
    assert.equal(crossed.status, 401);
    await waitForIdlePool();
    console.log("ok - another tenant reads none of these nodes");

    // Cache validators: the browser keeps the answer and asks again with its ETag. Node's fetch adds
    // `Cache-Control: no-cache` to a request carrying `If-None-Match` (Fetch standard), which Express
    // reads as "do not answer from a cache": the header a browser sends when it revalidates is given.
    assert.equal(tree.cacheControl, 'private, no-cache');
    assert.equal(count.cacheControl, 'private, no-cache');
    assert.ok(tree.etag, 'an ETag');
    const unchanged = await get('/cost-centers/tree', a.people.budget, { 'if-none-match': tree.etag as string, 'cache-control': 'max-age=0' });
    assert.equal(unchanged.status, 304, 'unchanged tree: 304');
    assert.equal(unchanged.text, '', 'no body');
    await seed(tenantA, (runner) => runner.query(`UPDATE cost_centers SET name = 'Tree one renamed' WHERE tenant_id = $1 AND id = $2`, [tenantA, a.second]));
    const renamed = await get('/cost-centers/tree', a.people.budget, { 'if-none-match': tree.etag as string, 'cache-control': 'max-age=0' });
    assert.equal(renamed.status, 200, 'a renamed node: a new body');
    assert.notEqual(renamed.etag, tree.etag);
    assert.equal(renamed.body.items[2].name, 'Tree one renamed');
    // An owner's new name changes the answer too (names come from the users table).
    await seed(tenantA, (runner) => runner.query(`UPDATE users SET first_name = 'Renamed' WHERE tenant_id = $1 AND id = $2`, [tenantA, a.people.budget.id]));
    const owner = await get('/cost-centers/tree', a.people.budget, { 'if-none-match': renamed.etag as string, 'cache-control': 'max-age=0' });
    assert.equal(owner.status, 200);
    assert.equal(owner.body.items[2].owner_name, 'Renamed budget reader');
    // A refused reader gets no 304 for a valid ETag: the guard runs first.
    assert.equal((await get('/cost-centers/tree', a.people.tasks, { 'if-none-match': owner.etag as string, 'cache-control': 'max-age=0' })).status, 403);
    console.log('ok - private, no-cache; 304 to an unchanged tree, a new body after a rename (node or owner); guard before the 304');
  } finally {
    if (app) await app.close();
    await dropRaceTenant(tenantA);
    await dropRaceTenant(tenantB);
    await dataSource.destroy();
  }
}

main().then(() => console.log('cost-centers-tree-http.integration.spec: ok')).catch((err) => {
  console.error(err);
  process.exit(1);
});
