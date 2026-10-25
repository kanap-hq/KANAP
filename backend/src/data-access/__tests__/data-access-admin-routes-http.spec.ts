// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
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
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { StripeConfigService } from '../../billing/stripe/stripe.config';
import { PermissionGuard } from '../../auth/permission.guard';
import { PasswordResetToken } from '../../auth/password-reset-token.entity';
import { Company } from '../../companies/company.entity';
import { CompaniesDeleteService } from '../../companies/companies-delete.service';
import { ReleaseTenantRunnerFilter } from '../../common/filters/release-tenant-runner.filter';
import { TenantInitGuard } from '../../common/tenant-init.guard';
import { TenantInterceptor } from '../../common/tenant.interceptor';
import { withTenantExecution } from '../../common/tenant-runner';
import { CostCenter } from '../../cost-centers/cost-center.entity';
import { CostCentersDeleteService } from '../../cost-centers/cost-centers-delete.service';
import { CostCentersService, CostCenterContext } from '../../cost-centers/cost-centers.service';
import { Department } from '../../departments/department.entity';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { Role } from '../../roles/role.entity';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';
import { User } from '../../users/user.entity';
import { UserRole } from '../../users/user-role.entity';
import { UsersController } from '../../users/users.controller';
import { UsersDeleteService } from '../../users/users-delete.service';
import { UsersService } from '../../users/users.service';
import { applyDataAccess } from '../data-access';
import { DataAccessAdminService } from '../data-access-admin.service';
import { DataAccessAdminController } from '../data-access-admin.controller';
import { DataAccessController } from '../data-access.controller';
import { DATA_ACCESS_RESERVED_MESSAGE } from '../reserved-operations';
import { ContractSeed, seedContracts } from './data-access-contract-seed';
import { APP_URL, LIMITED_ROLE, PgClient, connect, roleExists, seedNodes, seedPerson, seedRole } from './data-access-test-helpers';

/**
 * Data-scoped access, lot 6 run 6A (planning/data-scoped-access/spec.md §7.1-§7.6, §8, §10.7):
 * the administration routes over HTTP, through the real tenant interceptor, permission guard,
 * controllers and services, on the reference example of lots 2 and 5 (`data-access-contract-seed.ts`).
 *
 * Covers: the read and the write of a person's access and its audit; the refusals (Administrator,
 * self, unavailable, invalid body); the preview that follows the real path and writes nothing; the
 * overview and its filters; who sees a company, a group and a centre; the users list fields; the
 * delete refusals; the CSV export, dry run, real import and every error kind.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 4 });
let client: PgClient;
let s: ContractSeed;
let hasRole = false;

type Extra = {
  usersAdminRole: string;
  usersReaderRole: string;
  budgetReaderRole: string;
  manager: string; // unscoped users admin (the caller)
  limitedAdmin: string; // limited, administers users
  reader: string; // unscoped, users reader only
  outsider: string; // unscoped, no users permission
  extraCompany: string;
  extraCompanyName: string;
  centerCompany: string;
  extraCenter: string;
  centerAccessPerson: string;
};
let extra: Extra;

/** Simulated availability, so the unavailable state is provable. */
let availability = { available: true, missing: [] as string[] };
const availabilityOf = async () => ({
  available: availability.available,
  missing: availability.missing as any,
});

// ---------------------------------------------------------------------------------------------
// The real controllers, with the services these routes do not need stubbed.

const CONTROLLERS = [DataAccessController, DataAccessAdminController, UsersController];

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

/** The guard's own user lookup, under the request's tenant manager (no UsersService dependency). */
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

function testModule(service: DataAccessAdminService): any {
  const audit = new AuditService(dataSource.getRepository(AuditLog));
  const users = new UsersService(
    dataSource.getRepository(User),
    dataSource.getRepository(Company),
    dataSource.getRepository(Department),
    stub() as any,
    stub() as any,
    stub() as any,
    audit,
    dataSource.getRepository(PasswordResetToken),
  );
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
    [AuditService, audit],
    [UsersService, users],
    [UsersDeleteService, stub()],
    [DataAccessAdminService, service],
    [PermissionGuard, guard],
    [PermissionsService, perms],
    [StripeConfigService, { isConfigured: () => false }],
    [getRepositoryToken(User), dataSource.getRepository(User)],
    [getRepositoryToken(UserRole), dataSource.getRepository(UserRole)],
    [getRepositoryToken(Role), dataSource.getRepository(Role)],
    [getRepositoryToken(Company), dataSource.getRepository(Company)],
    [getRepositoryToken(Department), dataSource.getRepository(Department)],
    [getRepositoryToken(PasswordResetToken), dataSource.getRepository(PasswordResetToken)],
  ]);
  const enhancers = new Set<any>();
  for (const controller of CONTROLLERS) for (const enhancer of enhancersOf(controller)) enhancers.add(enhancer);
  // Authentication is not under test; the permission guard is, so it stays real. Every other guard
  // is stubbed, and the permission guard is provided as the instance built above.
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
  class DataAccessAdminModule {}
  return DataAccessAdminModule;
}

async function createApp(service: DataAccessAdminService): Promise<INestApplication> {
  const app = await NestFactory.create(testModule(service), { logger: false });
  const reflector = app.get(Reflector);
  app.use((req: any, _res: any, next: () => void) => {
    req.tenant = { id: s.tenantId, slug: 'da-admin-routes', name: 'Data access admin routes' };
    const user = req.headers['x-da-user'];
    if (typeof user === 'string' && user) req.user = { sub: user };
    next();
  });
  app.useGlobalGuards(new TenantInitGuard(dataSource, reflector));
  app.useGlobalInterceptors(new TenantInterceptor(dataSource, reflector));
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new ReleaseTenantRunnerFilter(httpAdapter));
  await app.listen(0, '127.0.0.1');
  return app;
}

type Method = 'GET' | 'POST' | 'PUT';
type Answer = { status: number; text: string; body: any };

function answerOf(status: number, text: string): Answer {
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status, text, body };
}

async function call(app: INestApplication, method: Method, path: string, userId: string, body?: unknown): Promise<Answer> {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/${path}`, {
    method,
    headers: { 'x-da-user': userId, 'content-type': 'application/json' },
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  return answerOf(res.status, await res.text());
}

async function callForm(app: INestApplication, path: string, userId: string, form: FormData): Promise<Answer> {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/${path}`, {
    method: 'POST',
    headers: { 'x-da-user': userId },
    body: form,
    signal: AbortSignal.timeout(15000),
  });
  return answerOf(res.status, await res.text());
}

function expectLimited(res: Answer, message: string, what: string): void {
  assert.equal(res.status, 403, `${what}: ${res.text}`);
  assert.equal(res.body?.code, 'DATA_ACCESS_LIMITED', `${what}: ${res.text}`);
  assert.equal(res.body?.message, message, what);
}

function formOf(csv: string): FormData {
  const form = new FormData();
  form.append('file', new Blob([Buffer.from(csv, 'utf8')], { type: 'text/csv' }), 'data-access.csv');
  return form;
}

// ---------------------------------------------------------------------------------------------
// Seed.

async function inTenant<T>(fn: () => Promise<T>): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    const out = await fn();
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

const PERSON_NAMES: Record<string, [string, string]> = {
  marta: ['Marta', 'Ruiz'],
  paul: ['Paul', 'Martin'],
  rita: ['Rita', 'Lopez'],
  claire: ['Claire', 'Dubois'],
  rob: ['Rob', 'Jansen'],
  nina: ['Nina', 'Petit'],
  admin: ['Ada', 'Administrator'],
  ulla: ['Ulla', 'Unscoped'],
};

async function seedExtra(): Promise<Extra> {
  return inTenant(async () => {
    const q = async (sql: string, params?: unknown[]): Promise<any[]> => (await client.query(sql, params)).rows;
    for (const [person, [first, last]] of Object.entries(PERSON_NAMES)) {
      await client.query(`UPDATE users SET first_name = $2, last_name = $3 WHERE id = $1`, [s.persons[person as keyof typeof s.persons], first, last]);
    }
    // The users roles: admin (the caller, and a limited person), reader, and a budget reader for an
    // unscoped caller with no users permission at all.
    const usersAdminRole = await seedRole(client, s.tenantId, 'Users admin');
    const usersReaderRole = await seedRole(client, s.tenantId, 'Users reader');
    const budgetReaderRole = await seedRole(client, s.tenantId, 'Budget reader');
    for (const [roleId, resource, level] of [
      [usersAdminRole, 'users', 'admin'],
      [usersReaderRole, 'users', 'reader'],
      [budgetReaderRole, 'budget', 'reader'],
    ] as const) {
      await client.query(
        `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES (app_current_tenant(), $1, $2, $3)`,
        [roleId, resource, level],
      );
    }
    const manager = await seedPerson(client, s.tenantId, 'all', usersAdminRole);
    await client.query(`UPDATE users SET first_name = 'Marc', last_name = 'Manager' WHERE id = $1`, [manager]);
    const limitedAdmin = await seedPerson(client, s.tenantId, 'limited', usersAdminRole);
    await seedNodes(client, s.tenantId, limitedAdmin, [{ type: 'company', id: s.es, access: 'read' }]);
    await client.query(`UPDATE users SET first_name = 'Lea', last_name = 'Limited' WHERE id = $1`, [limitedAdmin]);
    const reader = await seedPerson(client, s.tenantId, 'all', usersReaderRole);
    await client.query(`UPDATE users SET first_name = 'Rhea', last_name = 'Reader' WHERE id = $1`, [reader]);
    const outsider = await seedPerson(client, s.tenantId, 'all', budgetReaderRole);
    await client.query(`UPDATE users SET first_name = 'Otto', last_name = 'Outsider' WHERE id = $1`, [outsider]);

    // A company and a centre used by the data access only, for the delete refusals.
    const extraCompanyName = `Access Only ${s.tenantId.slice(0, 8)}`;
    const [extraCompanyRow] = await q(
      `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES (app_current_tenant(), $1, 'FR', 'Lyon', 'enabled') RETURNING id`,
      [extraCompanyName],
    );
    const extraCompany = extraCompanyRow.id as string;
    const [centerCompanyRow] = await q(
      `INSERT INTO companies (tenant_id, name, country_iso, city, status) VALUES (app_current_tenant(), $1, 'FR', 'Lyon', 'enabled') RETURNING id`,
      [`Center Only ${s.tenantId.slice(0, 8)}`],
    );
    const centerCompany = centerCompanyRow.id as string;
    const [extraCenterRow] = await q(
      `INSERT INTO cost_centers (tenant_id, code, kind, name, company_id, status)
       VALUES (app_current_tenant(), 'ACC', 'cost_center', 'Access centre', $1, 'enabled') RETURNING id`,
      [centerCompany],
    );
    const extraCenter = extraCenterRow.id as string;
    const accessPerson = await seedPerson(client, s.tenantId, 'limited', usersAdminRole);
    await seedNodes(client, s.tenantId, accessPerson, [{ type: 'company', id: extraCompany, access: 'read' }]);
    await client.query(`UPDATE users SET first_name = 'Zoe', last_name = 'Company' WHERE id = $1`, [accessPerson]);
    const centerAccessPerson = await seedPerson(client, s.tenantId, 'limited', usersAdminRole);
    await seedNodes(client, s.tenantId, centerAccessPerson, [{ type: 'cost_center', id: extraCenter, access: 'edit' }]);
    await client.query(`UPDATE users SET first_name = 'Yann', last_name = 'Center' WHERE id = $1`, [centerAccessPerson]);

    // Marta is the budget owner of INF-ES ("Add their cost centers", spec §7.1).
    await client.query(`UPDATE cost_centers SET owner_user_id = $2 WHERE id = $1`, [s.infEs, s.persons.marta]);

    return {
      usersAdminRole,
      usersReaderRole,
      budgetReaderRole,
      manager,
      limitedAdmin,
      reader,
      outsider,
      extraCompany,
      extraCompanyName,
      centerCompany,
      extraCenter,
      centerAccessPerson,
    };
  });
}

async function auditRows(): Promise<Array<{ table_name: string; action: string; source: string; user_id: string | null; record_id: string | null; before_json: any; after_json: any }>> {
  return inTenant(async () => (await client.query(
    `SELECT table_name, action, source, user_id, record_id, before_json, after_json
       FROM audit_log
      WHERE tenant_id = app_current_tenant() AND table_name = 'user_data_access'
      ORDER BY created_at, id`,
  )).rows);
}

async function userRow(id: string): Promise<{ data_access_mode: string; data_access_updated_at: Date | null; data_access_updated_by: string | null }> {
  return inTenant(async () => (await client.query(
    `SELECT data_access_mode, data_access_updated_at, data_access_updated_by FROM users WHERE id = $1`,
    [id],
  )).rows[0]);
}

async function nodeRows(id: string): Promise<Array<{ node_type: string; company_id: string | null; cost_center_id: string | null; access: string }>> {
  return inTenant(async () => (await client.query(
    `SELECT node_type, company_id, cost_center_id, access FROM user_data_access_nodes WHERE user_id = $1 ORDER BY node_type, company_id, cost_center_id`,
    [id],
  )).rows);
}

// ---------------------------------------------------------------------------------------------
// Scenarios.

async function testRefusals(app: INestApplication) {
  const routes: Array<[Method, string, string, unknown?]> = [
    ['GET', 'read a person access', `users/${s.persons.marta}/data-access`],
    ['PUT', 'write a person access', `users/${s.persons.marta}/data-access`, { mode: 'all', nodes: [] }],
    ['POST', 'preview', `users/${s.persons.marta}/data-access/preview`, { mode: 'all', nodes: [] }],
    ['GET', 'read a company access', `companies/${s.es}/data-access`],
    ['GET', 'read a cost centre access', `cost-centers/${s.inf}/data-access`],
    ['GET', 'the overview', 'data-access'],
    ['GET', 'the export', 'data-access/export'],
  ];
  for (const [method, what, path, body] of routes) {
    expectLimited(await call(app, method, path, extra.limitedAdmin, body), DATA_ACCESS_RESERVED_MESSAGE, `limited users admin: ${what}`);
    const outsider = await call(app, method, path, extra.outsider, body);
    assert.equal(outsider.status, 403, `unscoped without users admin: ${what}: ${outsider.text}`);
  }
  const limitedImport = await callForm(app, 'data-access/import?dryRun=true', extra.limitedAdmin, formOf('email,type,node,access\n'));
  expectLimited(limitedImport, DATA_ACCESS_RESERVED_MESSAGE, 'limited users admin: the import');
  const outsiderImport = await callForm(app, 'data-access/import?dryRun=true', extra.outsider, formOf('email,type,node,access\n'));
  assert.equal(outsiderImport.status, 403, `unscoped without users admin: the import: ${outsiderImport.text}`);
  console.log('  every route: 403 DATA_ACCESS_LIMITED to a limited users admin, 403 to an unscoped caller without users admin: OK');
}

async function testReadAndWrite(app: INestApplication) {
  const marta = s.persons.marta;
  const read = await call(app, 'GET', `users/${marta}/data-access`, extra.manager);
  assert.equal(read.status, 200, read.text);
  assert.equal(read.body.mode, 'limited');
  assert.equal(read.body.is_administrator, false);
  assert.equal(read.body.available, true);
  assert.equal(read.body.updated_at, null);
  assert.equal(read.body.updated_by_name, null);
  assert.deepEqual(read.body.nodes.map((node: any) => [node.type, node.id, node.access]), [['company', s.es, 'edit']]);
  assert.deepEqual(read.body.budget_owner_centers, [{ id: s.infEs, code: 'INF-ES', name: 'INF-ES' }]);
  console.log('  GET a person access: mode, nodes, budget owner centres, never modified: OK');

  // A change: company read and the group INF in edit.
  const body = {
    mode: 'limited',
    nodes: [
      { type: 'company', id: s.es, access: 'read' },
      { type: 'cost_center', id: s.inf, access: 'edit' },
    ],
  };
  const beforeAudit = (await auditRows()).length;
  const written = await call(app, 'PUT', `users/${marta}/data-access`, extra.manager, body);
  assert.equal(written.status, 200, written.text);
  assert.equal(written.body.mode, 'limited');
  assert.deepEqual(written.body.nodes.map((node: any) => [node.type, node.id, node.access]), [
    ['company', s.es, 'read'],
    ['cost_center', s.inf, 'edit'],
  ]);
  assert.ok(written.body.updated_at, 'updated_at set');
  assert.equal(written.body.updated_by_name, 'Marc Manager');
  assert.deepEqual(
    (await nodeRows(marta)).map((row) => [row.node_type, row.company_id, row.cost_center_id, row.access]),
    [['company', s.es, null, 'read'], ['cost_center', null, s.inf, 'edit']],
  );
  const audits = await auditRows();
  assert.equal(audits.length, beforeAudit + 1, 'one audit entry');
  const entry = audits[audits.length - 1];
  assert.equal(entry.table_name, 'user_data_access');
  assert.equal(entry.action, 'update');
  assert.equal(entry.source, 'screen');
  assert.equal(entry.user_id, extra.manager);
  assert.equal(entry.record_id, marta);
  assert.equal(entry.before_json.mode, 'limited');
  assert.deepEqual(entry.before_json.nodes, [{ type: 'company', name: `Alpha Espagne ${s.tenantId.slice(0, 8)}`, access: 'edit' }]);
  assert.equal(entry.after_json.mode, 'limited');
  assert.deepEqual(entry.after_json.nodes, [
    { type: 'company', name: `Alpha Espagne ${s.tenantId.slice(0, 8)}`, access: 'read' },
    { type: 'cost_center', code: 'INF', name: 'INF', access: 'edit' },
  ]);
  console.log('  PUT a person access: replaced, stamped, one readable audit entry (screen): OK');

  // No change: no write, no audit, the same stamp.
  const stamp = written.body.updated_at;
  const again = await call(app, 'PUT', `users/${marta}/data-access`, extra.manager, body);
  assert.equal(again.status, 200, again.text);
  assert.equal((await auditRows()).length, beforeAudit + 1, 'no audit entry for an unchanged access');
  assert.equal((await userRow(marta)).data_access_updated_at?.toISOString(), new Date(stamp).toISOString(), 'no stamp change');
  console.log('  PUT with no effect: no write, no audit, no stamp: OK');

  // Back to all.
  const back = await call(app, 'PUT', `users/${marta}/data-access`, extra.manager, { mode: 'all', nodes: [] });
  assert.equal(back.status, 200, back.text);
  assert.equal(back.body.mode, 'all');
  assert.deepEqual(back.body.nodes, []);
  assert.deepEqual(await nodeRows(marta), []);
  const backEntry = (await auditRows()).at(-1)!;
  assert.equal(backEntry.before_json.mode, 'limited');
  assert.equal(backEntry.after_json.mode, 'all');
  assert.deepEqual(backEntry.after_json.nodes, []);
  console.log('  PUT back to all: nodes gone, audited: OK');

  // A limited mode with an empty list is allowed: the person then sees only what they are named on.
  const empty = await call(app, 'PUT', `users/${marta}/data-access`, extra.manager, { mode: 'limited', nodes: [] });
  assert.equal(empty.status, 200, empty.text);
  assert.equal(empty.body.mode, 'limited');
  assert.deepEqual(empty.body.nodes, []);

  // Restore Marta's reference access for the following scenarios.
  const restore = await call(app, 'PUT', `users/${marta}/data-access`, extra.manager, {
    mode: 'limited',
    nodes: [{ type: 'company', id: s.es, access: 'edit' }],
  });
  assert.equal(restore.status, 200, restore.text);

  // Refusals.
  const adminRead = await call(app, 'GET', `users/${s.persons.admin}/data-access`, extra.manager);
  assert.equal(adminRead.status, 200, adminRead.text);
  assert.equal(adminRead.body.mode, 'all');
  assert.equal(adminRead.body.is_administrator, true);
  assert.deepEqual(adminRead.body.nodes, []);
  const adminTarget = await call(app, 'PUT', `users/${s.persons.admin}/data-access`, extra.manager, { mode: 'all', nodes: [] });
  assert.equal(adminTarget.status, 409, adminTarget.text);
  assert.equal(adminTarget.body.code, 'DATA_ACCESS_ADMINISTRATOR');
  assert.equal(adminTarget.body.message, 'Administrators see all data.');
  const self = await call(app, 'PUT', `users/${extra.manager}/data-access`, extra.manager, { mode: 'all', nodes: [] });
  assert.equal(self.status, 409, self.text);
  assert.equal(self.body.code, 'DATA_ACCESS_SELF');
  assert.equal(self.body.message, 'You cannot change your own data access.');
  console.log('  Administrator target 409, self 409: OK');

  // Invalid bodies: 400 with a code.
  const invalid: Array<[string, unknown, string]> = [
    ['mode', { mode: 'everything', nodes: [] }, 'DATA_ACCESS_MODE_INVALID'],
    ['all with nodes', { mode: 'all', nodes: [{ type: 'company', id: s.es, access: 'read' }] }, 'DATA_ACCESS_ALL_WITH_NODES'],
    ['all with an id', { mode: 'limited', nodes: [{ type: 'all', id: s.es, access: 'read' }] }, 'DATA_ACCESS_NODE_ID_FORBIDDEN'],
    ['duplicate', { mode: 'limited', nodes: [{ type: 'company', id: s.es, access: 'read' }, { type: 'company', id: s.es, access: 'edit' }] }, 'DATA_ACCESS_NODE_DUPLICATE'],
    ['unknown company', { mode: 'limited', nodes: [{ type: 'company', id: '00000000-0000-4000-8000-000000000000', access: 'read' }] }, 'DATA_ACCESS_NODE_UNKNOWN'],
    ['unknown cost centre', { mode: 'limited', nodes: [{ type: 'cost_center', id: '00000000-0000-4000-8000-000000000000', access: 'read' }] }, 'DATA_ACCESS_NODE_UNKNOWN'],
    ['bad access', { mode: 'limited', nodes: [{ type: 'company', id: s.es, access: 'write' }] }, 'DATA_ACCESS_ACCESS_INVALID'],
    ['nodes not an array', { mode: 'limited', nodes: {} }, 'DATA_ACCESS_NODES_INVALID'],
    ['bad type', { mode: 'limited', nodes: [{ type: 'program', id: s.es, access: 'read' }] }, 'DATA_ACCESS_NODE_TYPE_INVALID'],
    ['id not a uuid', { mode: 'limited', nodes: [{ type: 'company', id: 'nope', access: 'read' }] }, 'DATA_ACCESS_NODE_ID_REQUIRED'],
  ];
  for (const [what, invalidBody, code] of invalid) {
    const res = await call(app, 'PUT', `users/${marta}/data-access`, extra.manager, invalidBody);
    assert.equal(res.status, 400, `${what}: ${res.text}`);
    assert.equal(res.body.code, code, `${what}: ${res.text}`);
  }
  console.log('  invalid bodies: 400 with a clear code: OK');
}

async function testAvailability(app: INestApplication, service: DataAccessAdminService) {
  const marta = s.persons.marta;
  availability = { available: false, missing: ['role'] };
  try {
    const limited = await call(app, 'PUT', `users/${marta}/data-access`, extra.manager, {
      mode: 'limited',
      nodes: [{ type: 'company', id: s.es, access: 'read' }],
    });
    assert.equal(limited.status, 409, limited.text);
    assert.equal(limited.body.code, 'DATA_ACCESS_UNAVAILABLE');
    assert.deepEqual(limited.body.missing, ['role']);
    const preview = await call(app, 'POST', `users/${marta}/data-access/preview`, extra.manager, {
      mode: 'limited',
      nodes: [{ type: 'company', id: s.es, access: 'read' }],
    });
    assert.equal(preview.status, 409, preview.text);
    assert.equal(preview.body.code, 'DATA_ACCESS_UNAVAILABLE');
    const read = await call(app, 'GET', `users/${marta}/data-access`, extra.manager);
    assert.equal(read.status, 200, read.text);
    assert.equal(read.body.available, false);
    const overview = await call(app, 'GET', 'data-access', extra.manager);
    assert.equal(overview.status, 200, overview.text);
    assert.equal(overview.body.available, false);
    assert.deepEqual(overview.body.missing, ['role']);
    // Going back to all is always allowed.
    const all = await call(app, 'PUT', `users/${marta}/data-access`, extra.manager, { mode: 'all', nodes: [] });
    assert.equal(all.status, 200, all.text);
    assert.equal(all.body.mode, 'all');
  } finally {
    availability = { available: true, missing: [] };
  }
  // Put Marta's reference access back.
  const restore = await call(app, 'PUT', `users/${marta}/data-access`, extra.manager, {
    mode: 'limited',
    nodes: [{ type: 'company', id: s.es, access: 'edit' }],
  });
  assert.equal(restore.status, 200, restore.text);

  // The service restores the caller's role and settings in the same request, and a query after it
  // sees everything (spec §8).
  const result = await withTenantExecution(dataSource, s.tenantId, async (manager) => {
    await applyDataAccess(manager, extra.manager);
    const preview = await service.preview(manager, marta, { mode: 'limited', nodes: [{ type: 'company', id: s.es, access: 'edit' }] }, extra.manager);
    const [count] = await manager.query(`SELECT count(*)::int AS n FROM spend_items WHERE tenant_id = app_current_tenant()`);
    const [state] = await manager.query(
      `SELECT current_setting('role', true) AS role, current_setting('app.da_mode', true) AS mode,
              current_user AS current_user, session_user AS session_user`,
    );
    assert.equal(state.role || 'none', 'none', 'the caller role is the app role');
    assert.equal(state.mode || '', '', 'app.da_mode is empty');
    assert.equal(state.current_user, state.session_user);
    assert.equal(Number(count.n), 7, 'a following query in the same request sees every line');
    return preview;
  });
  assert.equal(result.lines, 4, `preview counts: ${JSON.stringify(result)}`);
  console.log('  unavailable: PUT/preview limited 409 with missing, GET available false, back to all 200: OK');
  console.log('  preview restores the caller role and settings, a following query sees everything: OK');
}

async function testPreview(app: INestApplication) {
  const marta = s.persons.marta;
  const body = { mode: 'limited', nodes: [{ type: 'company', id: s.es, access: 'edit' }] };
  const before = await userRow(marta);
  const beforeNodes = await nodeRows(marta);
  const preview = await call(app, 'POST', `users/${marta}/data-access/preview`, extra.manager, body);
  assert.equal(preview.status, 201, preview.text);
  const expected = await withTenantExecution(dataSource, s.tenantId, async (manager) => {
    await applyDataAccess(manager, marta);
    return (await manager.query(
      `SELECT
         (SELECT count(*)::int FROM spend_items i WHERE i.tenant_id = app_current_tenant()
            AND i.nature IN ('opex', 'capex')) AS lines,
         (SELECT count(*)::int FROM spend_items i WHERE i.tenant_id = app_current_tenant()
            AND i.nature IN ('opex', 'capex')
            AND data_access_line_editable(i.paying_company_id, i.cost_center_id, i.owner_it_id, i.owner_business_id)) AS editable_lines,
         (SELECT count(*)::int FROM contracts c WHERE c.tenant_id = app_current_tenant()) AS contracts`,
    ))[0];
  });
  assert.deepEqual(preview.body, {
    lines: Number(expected.lines),
    editable_lines: Number(expected.editable_lines),
    contracts: Number(expected.contracts),
  }, 'the preview equals what Marta sees when applied for real');
  assert.equal(preview.body.lines, 4);
  assert.equal(preview.body.editable_lines, 3);
  assert.ok(preview.body.contracts >= 2, `Marta sees her contracts: ${preview.text}`);
  assert.equal((await userRow(marta)).data_access_mode, before.data_access_mode, 'mode unchanged');
  assert.equal((await userRow(marta)).data_access_updated_at?.toISOString() ?? null, before.data_access_updated_at?.toISOString() ?? null, 'stamp unchanged');
  assert.deepEqual(await nodeRows(marta), beforeNodes, 'nodes unchanged');
  const audit = await auditRows();
  assert.ok(!audit.some((entry) => entry.before_json === null && entry.after_json === null), 'no empty audit');
  console.log('  preview: equals the real access, nothing written: OK');

  // Another proposal, on the group: Paul's counts.
  const groupPreview = await call(app, 'POST', `users/${marta}/data-access/preview`, extra.manager, {
    mode: 'limited',
    nodes: [{ type: 'cost_center', id: s.inf, access: 'read' }],
  });
  assert.equal(groupPreview.status, 201, groupPreview.text);
  const paulCounts = await withTenantExecution(dataSource, s.tenantId, async (manager) => {
    await applyDataAccess(manager, s.persons.paul);
    return (await manager.query(
      `SELECT
         (SELECT count(*)::int FROM spend_items i WHERE i.tenant_id = app_current_tenant()
            AND i.nature IN ('opex', 'capex')) AS lines,
         (SELECT count(*)::int FROM spend_items i WHERE i.tenant_id = app_current_tenant()
            AND i.nature IN ('opex', 'capex')
            AND data_access_line_editable(i.paying_company_id, i.cost_center_id, i.owner_it_id, i.owner_business_id)) AS editable_lines,
         (SELECT count(*)::int FROM contracts c WHERE c.tenant_id = app_current_tenant()) AS contracts`,
    ))[0];
  });
  assert.deepEqual(groupPreview.body, {
    lines: Number(paulCounts.lines),
    editable_lines: Number(paulCounts.editable_lines),
    contracts: Number(paulCounts.contracts),
  });
  assert.equal(groupPreview.body.lines, 4);
  assert.equal(groupPreview.body.editable_lines, 0);
  console.log('  preview of the group INF equals Paul\'s real access: OK');

  // A proposed "all": the unscoped counts.
  const allPreview = await call(app, 'POST', `users/${marta}/data-access/preview`, extra.manager, { mode: 'all', nodes: [] });
  assert.equal(allPreview.status, 201, allPreview.text);
  assert.deepEqual(allPreview.body, { lines: 7, editable_lines: 7, contracts: 6 });
  console.log('  preview of all: the unscoped counts, nothing written: OK');
}

async function testOverview(app: INestApplication) {
  const overview = await call(app, 'GET', 'data-access', extra.manager);
  assert.equal(overview.status, 200, overview.text);
  assert.equal(overview.body.available, true);
  assert.deepEqual(overview.body.missing, []);
  assert.equal(overview.body.counts.limited_persons, 9, `limited persons: ${JSON.stringify(overview.body.counts)}`);
  assert.equal(overview.body.counts.lines_without_company, 2);
  const names = overview.body.persons.map((person: any) => person.name).sort();
  assert.ok(names.includes('Marta Ruiz'), names.join(','));
  assert.ok(!names.includes('Ada Administrator'), 'an Administrator stored as limited is listed nowhere');
  assert.ok(!names.includes('Ulla Unscoped'), 'a person in mode all is absent');
  const marta = overview.body.persons.find((person: any) => person.id === s.persons.marta);
  assert.deepEqual(marta.roles, ['Budget member']);
  assert.deepEqual(marta.nodes.map((node: any) => [node.type, node.access]), [['company', 'edit']]);

  const byCompany = await call(app, 'GET', `data-access?node_type=company&node_id=${s.es}`, extra.manager);
  assert.equal(byCompany.status, 200, byCompany.text);
  assert.deepEqual(byCompany.body.persons.map((person: any) => person.name).sort(), ['Lea Limited', 'Marta Ruiz']);
  const byCentre = await call(app, 'GET', `data-access?node_type=cost_center&node_id=${s.inf}`, extra.manager);
  assert.deepEqual(byCentre.body.persons.map((person: any) => person.name).sort(), ['Paul Martin', 'Rita Lopez']);
  const byAll = await call(app, 'GET', 'data-access?node_type=all', extra.manager);
  assert.deepEqual(byAll.body.persons.map((person: any) => person.name).sort(), ['Claire Dubois', 'Rob Jansen']);
  const byName = await call(app, 'GET', 'data-access?q=Marta', extra.manager);
  assert.deepEqual(byName.body.persons.map((person: any) => person.id), [s.persons.marta]);
  const byEmail = await call(app, 'GET', `data-access?q=${encodeURIComponent(await emailOf(s.persons.paul))}`, extra.manager);
  assert.deepEqual(byEmail.body.persons.map((person: any) => person.id), [s.persons.paul]);
  console.log('  overview: limited persons only, counts, node and name/email filters: OK');
}

async function emailOf(id: string): Promise<string> {
  return inTenant(async () => (await client.query(`SELECT email FROM users WHERE id = $1`, [id])).rows[0].email);
}

async function testWhoSees(app: INestApplication) {
  const company = await call(app, 'GET', `companies/${s.es}/data-access`, extra.manager);
  assert.equal(company.status, 200, company.text);
  assert.deepEqual(company.body.full.map((row: any) => row.person.name).sort(), ['Claire Dubois', 'Lea Limited', 'Marta Ruiz', 'Rob Jansen']);
  assert.deepEqual(company.body.partial.map((row: any) => row.person.name).sort(), ['Paul Martin', 'Rita Lopez']);
  const claire = company.body.full.find((row: any) => row.person.id === s.persons.claire);
  assert.deepEqual(claire.via, { type: 'all', name: null });
  assert.equal(claire.access, 'edit');
  const paul = company.body.partial.find((row: any) => row.person.id === s.persons.paul);
  assert.deepEqual(paul.via, { type: 'cost_center', id: s.inf, code: 'INF', name: 'INF' });
  assert.equal(paul.access, 'read');
  console.log('  company access: full (company/Tout) and partial (group covering a centre): OK');

  const fr = await call(app, 'GET', `companies/${s.fr}/data-access`, extra.manager);
  assert.deepEqual(fr.body.full.map((row: any) => row.person.name).sort(), ['Claire Dubois', 'Rob Jansen']);
  assert.deepEqual(fr.body.partial.map((row: any) => row.person.name).sort(), ['Paul Martin', 'Rita Lopez']);

  const group = await call(app, 'GET', `cost-centers/${s.inf}/data-access`, extra.manager);
  assert.equal(group.status, 200, group.text);
  assert.deepEqual(group.body.direct.map((row: any) => row.person.name).sort(), ['Paul Martin', 'Rita Lopez']);
  assert.deepEqual(group.body.inherited.map((row: any) => row.person.name).sort(), ['Claire Dubois', 'Rob Jansen']);
  assert.deepEqual(group.body.inherited.find((row: any) => row.person.id === s.persons.claire).via, { type: 'all', name: null });

  const centre = await call(app, 'GET', `cost-centers/${s.infFr}/data-access`, extra.manager);
  assert.deepEqual(centre.body.direct.map((row: any) => row.person.name), ['Rita Lopez']);
  assert.equal(centre.body.direct[0].access, 'edit');
  const inheritedNames = centre.body.inherited.map((row: any) => [row.person.name, row.via.type, row.access]);
  assert.deepEqual(inheritedNames.sort(), [
    ['Claire Dubois', 'all', 'edit'],
    ['Paul Martin', 'cost_center', 'read'],
    ['Rob Jansen', 'all', 'read'],
  ].sort());
  assert.deepEqual(centre.body.inherited.find((row: any) => row.person.id === s.persons.paul).via, {
    type: 'cost_center', id: s.inf, code: 'INF', name: 'INF',
  });
  console.log('  cost centre access: direct, inherited from the parent group and Tout: OK');
}

async function testUsersList(app: INestApplication) {
  const list = await call(app, 'GET', 'users?limit=100', extra.manager);
  assert.equal(list.status, 200, list.text);
  assert.equal(list.body.data_access_any_limited, true);
  const byId = new Map<string, any>(list.body.items.map((item: any) => [item.id, item]));
  const marta = byId.get(s.persons.marta);
  assert.deepEqual(marta.data_access, { mode: 'limited', nodes: [`Alpha Espagne ${s.tenantId.slice(0, 8)}`] });
  assert.deepEqual(byId.get(s.persons.ulla).data_access, { mode: 'all', nodes: [] });
  assert.deepEqual(byId.get(s.persons.admin).data_access, { mode: 'all', nodes: [] });
  assert.deepEqual(byId.get(s.persons.rita).data_access.nodes, ['INF', 'INF-FR']);
  const emptyPage = await call(app, 'GET', 'users?limit=100&q=zzzz-no-such-user', extra.manager);
  assert.equal(emptyPage.status, 200, emptyPage.text);
  assert.equal(emptyPage.body.items.length, 0);
  assert.equal(emptyPage.body.data_access_any_limited, true, 'the flag does not depend on the page rows');
  console.log('  users list: data_access per row and the any-limited flag, batched: OK');

  // A limited users administrator gets no access column.
  const limited = await call(app, 'GET', 'users?limit=100', extra.limitedAdmin);
  assert.equal(limited.status, 200, limited.text);
  assert.equal(limited.body.data_access_any_limited, undefined);
  assert.equal(limited.body.items.every((item: any) => item.data_access === undefined), true);
  // A users reader gets no access column either.
  const reader = await call(app, 'GET', 'users?limit=100', extra.reader);
  assert.equal(reader.status, 200, reader.text);
  assert.equal(reader.body.data_access_any_limited, undefined);
  assert.equal(reader.body.items.every((item: any) => item.data_access === undefined), true);
  // A caller without users permission is refused by the permission guard.
  const outsider = await call(app, 'GET', 'users?limit=100', extra.outsider);
  assert.equal(outsider.status, 403, outsider.text);
  console.log('  users list: nothing for a limited admin or a plain reader, 403 without users access: OK');
}

async function testDeleteRefusals() {
  const audit = new AuditService(dataSource.getRepository(AuditLog));
  const companies = new CompaniesDeleteService(dataSource.getRepository(Company), audit);
  const centers = new CostCentersService(audit);
  const centerDelete = new CostCentersDeleteService(centers, audit);
  await withTenantExecution(dataSource, s.tenantId, async (manager) => {
    await assert.rejects(
      () => companies.delete(extra.extraCompany, { manager, userId: extra.manager }),
      (error: any) => {
        assert.equal(error.code, 'COMPANY_IN_USE', error.message);
        assert.ok(error.usages.some((usage: any) => usage.type === 'data_access' && usage.total === 1), JSON.stringify(error.usages));
        assert.match(error.message, /the data access of 1 person/);
        return true;
      },
    );
    const check = await companies.deleteCheck([extra.extraCompany], { manager });
    assert.equal(check.refused.length, 1);
    assert.ok(check.refused[0].usages.some((usage) => usage.type === 'data_access' && usage.total === 1));

    const ctx: CostCenterContext = { manager, tenantId: s.tenantId, userId: extra.manager };
    await assert.rejects(
      () => centerDelete.delete(extra.extraCenter, ctx),
      (error: any) => {
        assert.equal(error.code, 'COST_CENTER_IN_USE', error.message);
        assert.ok(error.usages.some((usage: any) => usage.type === 'data_access' && usage.total === 1), JSON.stringify(error.usages));
        assert.match(error.message, /the data access of 1 person/);
        return true;
      },
    );
    const centerCheck = await centerDelete.deleteCheck([extra.extraCenter], ctx);
    assert.equal(centerCheck.refused.length, 1);
    assert.ok(centerCheck.refused[0].usages.some((usage) => usage.type === 'data_access' && usage.total === 1));
  });
  console.log('  delete of a company and of a cost centre used by an access: 409 with the number of persons: OK');
}

async function testImportExport(app: INestApplication) {
  const tag = s.tenantId.slice(0, 8);
  const martaEmail = await emailOf(s.persons.marta);
  const paulEmail = await emailOf(s.persons.paul);
  const ritaEmail = await emailOf(s.persons.rita);
  const claireEmail = await emailOf(s.persons.claire);
  const ninaEmail = await emailOf(s.persons.nina);
  const adminEmail = await emailOf(s.persons.admin);
  const managerEmail = await emailOf(extra.manager);

  const exported = await call(app, 'GET', 'data-access/export?language=en', extra.manager);
  assert.equal(exported.status, 200, exported.text);
  const csv = exported.text.replace(/^\uFEFF/, '');
  const rows = csv.trim().split('\n').map((line) => line.split(','));
  assert.deepEqual(rows[0], ['email', 'type', 'node', 'access']);
  const has = (row: string[]) => rows.some((line) => line.join('|') === row.join('|'));
  assert.ok(has([martaEmail, 'company', `Alpha Espagne ${tag}`, 'edit']), 'Marta company');

  assert.ok(has([ritaEmail, 'cost_center', 'INF-FR', 'edit']), 'Rita INF-FR');
  assert.ok(has([ritaEmail, 'cost_center', 'INF', 'read']), 'Rita INF');
  assert.ok(has([claireEmail, 'all', '', 'edit']), 'Claire all');
  assert.ok(!rows.some((line) => line[0] === ninaEmail), 'a limited person with no node has no line');
  console.log('  export: one line per limited person and node, companies by name, centres by code, all empty: OK');

  const dry = await callForm(app, 'data-access/import?dryRun=true&language=en', extra.manager, formOf(csv));
  assert.equal(dry.status, 201, dry.text);
  assert.equal(dry.body.ok, true, dry.text);
  assert.equal(dry.body.dryRun, true);
  assert.equal(dry.body.updated, 0);
  assert.equal(dry.body.unchanged, 8, dry.text);
  assert.equal(dry.body.inserted, 0);
  assert.deepEqual(dry.body.errors, []);
  console.log('  import dry run of the export: no change (8 persons with nodes): OK');

  const beforeImport = (await auditRows()).length;
  const importCsv = [
    'email,type,node,access',
    `${martaEmail},company,Alpha Espagne ${tag},edit`,
    `${ritaEmail},cost_center,INF-FR,edit`,
    `${ritaEmail},cost_center,INF,read`,
    `${claireEmail},all,,edit`,
    `${paulEmail},company,Alpha France ${tag},read`,
  ].join('\n');
  const imported = await callForm(app, 'data-access/import?dryRun=false&language=en', extra.manager, formOf(importCsv));
  assert.equal(imported.status, 201, imported.text);
  assert.equal(imported.body.ok, true, imported.text);
  assert.equal(imported.body.dryRun, false);
  assert.equal(imported.body.updated, 1, 'Paul changes, the others do not');
  assert.equal(imported.body.unchanged, 3, imported.text);
  assert.deepEqual(
    (await nodeRows(s.persons.paul)).map((row) => [row.node_type, row.company_id, row.cost_center_id, row.access]),
    [['company', s.fr, null, 'read']],
  );
  const importAudits = (await auditRows()).slice(beforeImport);
  assert.equal(importAudits.length, 1, 'one audit entry for the changed person');
  assert.equal(importAudits[0].source, 'import');
  assert.equal(importAudits[0].record_id, s.persons.paul);
  assert.equal(importAudits[0].before_json.nodes[0].type, 'cost_center');
  assert.equal(importAudits[0].after_json.nodes[0].name, `Alpha France ${tag}`);
  console.log('  real import: a person receives exactly the listed nodes in limited mode, one audit (import): OK');

  const again = await callForm(app, 'data-access/import?dryRun=false&language=en', extra.manager, formOf(importCsv));
  assert.equal(again.body.updated, 0, again.text);
  assert.equal(again.body.unchanged, 4, again.text);
  assert.equal((await auditRows()).length, beforeImport + 1, 'no audit for an unchanged person');
  console.log('  re-import of the same file: no write, no audit: OK');

  const errorsCsv = [
    'email,type,node,access',
    `unknown@example.invalid,company,Alpha France ${tag},read`,
    `${martaEmail},company,Unknown Company,read`,
    `${martaEmail},cost_center,NOPE,read`,
    `${martaEmail},program,,read`,
    `${martaEmail},company,Alpha France ${tag},write`,
    `${martaEmail},company,Alpha France ${tag},read`,
    `${martaEmail},company,Alpha France ${tag},edit`,
    `${adminEmail},company,Alpha France ${tag},read`,
    `${managerEmail},company,Alpha France ${tag},read`,
    `${martaEmail},all,Alpha France ${tag},read`,
    `${martaEmail},company,,read`,
    `${martaEmail},cost_center,,read`,
  ].join('\n');
  const auditBeforeErrors = (await auditRows()).length;
  const paulNodes = await nodeRows(s.persons.paul);
  const refused = await callForm(app, 'data-access/import?dryRun=false&language=en', extra.manager, formOf(errorsCsv));
  assert.equal(refused.status, 201, refused.text);
  assert.equal(refused.body.ok, false, refused.text);
  assert.equal(refused.body.updated, 0);
  assert.equal(refused.body.unchanged, 0);
  const codes = new Set(refused.body.errors.map((error: any) => error.code));
  for (const code of [
    'CSV_REFERENCE_NOT_FOUND',
    'CSV_ENUM_INVALID',
    'CSV_DUPLICATE_KEY',
    'DATA_ACCESS_ADMINISTRATOR',
    'DATA_ACCESS_SELF',
    'DATA_ACCESS_NODE_ID_FORBIDDEN',
    'DATA_ACCESS_NODE_ID_REQUIRED',
  ]) {
    assert.ok(codes.has(code), `${code} reported: ${refused.text}`);
  }
  assert.deepEqual(await nodeRows(s.persons.paul), paulNodes, 'nothing written when any row is refused');
  assert.equal((await auditRows()).length, auditBeforeErrors, 'no audit when any row is refused');
  console.log('  import errors: unknown person/company/centre, invalid type/access, duplicate, Administrator, self, all with node, missing node: nothing written: OK');

  availability = { available: false, missing: ['role'] };
  try {
    const unavailable = await callForm(app, 'data-access/import?dryRun=false&language=en', extra.manager, formOf(importCsv));
    assert.equal(unavailable.status, 201, unavailable.text);
    assert.equal(unavailable.body.ok, false, unavailable.text);
    assert.equal(unavailable.body.errors.length, 1, unavailable.text);
    assert.equal(unavailable.body.errors[0].row, 0);
    assert.equal(unavailable.body.errors[0].code, 'DATA_ACCESS_UNAVAILABLE');
  } finally {
    availability = { available: true, missing: [] };
  }
  assert.equal((await auditRows()).length, auditBeforeErrors, 'unavailable import writes nothing');

  const after = await call(app, 'GET', 'data-access/export?language=en', extra.manager);
  const roundTrip = await callForm(app, 'data-access/import?dryRun=true&language=en', extra.manager, formOf(after.text.replace(/^\uFEFF/, '')));
  assert.equal(roundTrip.body.ok, true, roundTrip.text);
  assert.equal(roundTrip.body.updated, 0, roundTrip.text);
  assert.ok(roundTrip.body.unchanged >= 8, roundTrip.text);
  console.log('  export of the imported state round-trips into a dry run with no change: OK');
}

// ---------------------------------------------------------------------------------------------
// Run.

async function cleanup() {
  if (!s) return;
  await withTenantExecution(dataSource, s.tenantId, (manager) => purgeTenantTables(manager, TENANT_PURGE_TABLES))
    .catch((error) => console.error(`could not purge ${s.tenantId}:`, error));
  await client.query(`DELETE FROM tenants WHERE id = $1`, [s.tenantId])
    .catch((error: unknown) => console.error(`could not delete ${s.tenantId}:`, error));
}

async function run() {
  client = await connect(APP_URL);
  await dataSource.initialize();
  let app: INestApplication | null = null;
  try {
    hasRole = await roleExists(client);
    console.log(`data access admin routes (role ${hasRole ? 'installed' : 'absent'})`);
    if (!hasRole) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log('data access admin routes: role absent, skipped');
      return;
    }
    await client.query(`SELECT data_access_sync_policies()`);
    await client.query('BEGIN');
    try {
      s = await seedContracts(client);
      await client.query('COMMIT');
      await client.query(`SELECT set_config('app.current_tenant', $1, false)`, [s.tenantId]);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    extra = await seedExtra();
    const audit = new AuditService(dataSource.getRepository(AuditLog));
    const service = new DataAccessAdminService(dataSource, audit, availabilityOf);
    app = await createApp(service);
    await testRefusals(app);
    await testReadAndWrite(app);
    await testAvailability(app, service);
    await testPreview(app);
    await testOverview(app);
    await testWhoSees(app);
    await testUsersList(app);
    await testDeleteRefusals();
    await testImportExport(app);
    console.log('data access admin routes: all passed');
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
