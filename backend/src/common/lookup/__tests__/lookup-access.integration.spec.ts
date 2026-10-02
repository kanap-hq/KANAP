import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { QueryRunner } from 'typeorm';
import dataSource from '../../../data-source';
import { PermissionGuard } from '../../../auth/permission.guard';
import { REQUIRE_ANY_LEVEL_KEY } from '../../../auth/require-level.decorator';
import { PermissionsService } from '../../../permissions/permissions.service';
import { RolePermission } from '../../../permissions/role-permission.entity';
import { UserPageRole } from '../../../permissions/user-page-role.entity';
import { UsersService } from '../../../users/users.service';
import { User } from '../../../users/user.entity';
import { UsersController } from '../../../users/users.controller';
import { SuppliersController } from '../../../suppliers/suppliers.controller';
import { AccountsController } from '../../../accounts/accounts.controller';
import { BusinessProcessesController } from '../../../business-processes/business-processes.controller';
import { ContractsController } from '../../../contracts/contracts.controller';
import {
  ACCOUNT_LOOKUP_ACCESS,
  BUSINESS_PROCESS_LOOKUP_ACCESS,
  CONTRACT_LOOKUP_ACCESS,
  lookupReaders,
  lookupSearchers,
  SUPPLIER_LOOKUP_ACCESS,
  USER_LOOKUP_ACCESS,
} from '../lookup-requirements';

// Who may search a reference lookup, and who may only read the labels of the
// values they already hold (lot 1C review, S1). The real PermissionGuard runs
// against roles stored in the database, then the real handler (its @Tenant()
// argument built by the real decorator): a reader of a page that picks a
// reference gets `ids` (200) but not a search (403); the level that edits that
// page searches. The Business Contributor role is the one of the perf tenant.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

type Level = 'reader' | 'contributor' | 'member' | 'admin';
const r = (resource: string) => ({ resource, level: 'reader' as const });
const m = (resource: string) => ({ resource, level: 'member' as const });

/** The lists, pinned: a change to who reads a reference must change this spec. */
function testPinnedLists() {
  assert.deepEqual(lookupReaders(USER_LOOKUP_ACCESS), [
    'users', 'opex', 'capex', 'tasks', 'portfolio_requests', 'portfolio_projects', 'applications', 'infrastructure',
    'locations', 'knowledge', 'contracts', 'business_processes', 'incidents', 'cost_centers', 'portfolio_settings',
    'portfolio_planning', 'portfolio_reports',
  ].map(r), 'people: no suppliers, companies or departments (no person picker there)');
  assert.deepEqual(lookupSearchers(USER_LOOKUP_ACCESS), [
    r('users'),
    ...['opex', 'capex', 'tasks', 'portfolio_requests', 'portfolio_projects', 'applications', 'infrastructure', 'locations', 'knowledge'].map(r),
    m('contracts'), m('business_processes'), { resource: 'incidents', level: 'contributor' }, m('cost_centers'), m('portfolio_settings'),
  ], 'people: the readers of every page with "Send link" search, the other picking pages at the level that edits them');

  assert.deepEqual(lookupReaders(SUPPLIER_LOOKUP_ACCESS), ['suppliers', 'opex', 'capex', 'contracts', 'applications', 'infrastructure', 'contacts'].map(r));
  assert.deepEqual(lookupSearchers(SUPPLIER_LOOKUP_ACCESS), [r('suppliers'), ...['opex', 'capex', 'contracts', 'applications', 'infrastructure', 'contacts'].map(m)]);

  assert.deepEqual(lookupReaders(ACCOUNT_LOOKUP_ACCESS), ['accounts', 'opex', 'capex'].map(r), 'accounts: no reporting (no account picker there)');
  assert.deepEqual(lookupSearchers(ACCOUNT_LOOKUP_ACCESS), [r('accounts'), m('opex'), m('capex')]);

  assert.deepEqual(lookupReaders(BUSINESS_PROCESS_LOOKUP_ACCESS), ['business_processes', 'portfolio_requests', 'applications'].map(r));
  assert.deepEqual(lookupSearchers(BUSINESS_PROCESS_LOOKUP_ACCESS), [r('business_processes'), m('portfolio_requests'), m('applications')]);

  assert.deepEqual(lookupReaders(CONTRACT_LOOKUP_ACCESS), ['contracts', 'opex', 'capex', 'infrastructure'].map(r));
  assert.deepEqual(lookupSearchers(CONTRACT_LOOKUP_ACCESS), [r('contracts'), m('opex'), m('capex'), m('infrastructure')]);

  // The routes carry these lists (the guard reads the handler's metadata).
  for (const [route, access] of LOOKUPS) {
    assert.deepEqual(Reflect.getMetadata(REQUIRE_ANY_LEVEL_KEY, route.controller.prototype.lookup), lookupReaders(access), `${route.name}: guard list`);
  }
  console.log('ok - lists pinned, and carried by the five lookup routes');
}

type Route = { name: string; controller: any };
const USERS: Route = { name: '/users/lookup', controller: UsersController };
const SUPPLIERS: Route = { name: '/suppliers/lookup', controller: SuppliersController };
const ACCOUNTS: Route = { name: '/accounts/lookup', controller: AccountsController };
const PROCESSES: Route = { name: '/business-processes/lookup', controller: BusinessProcessesController };
const CONTRACTS: Route = { name: '/contracts/lookup', controller: ContractsController };
const LOOKUPS: Array<[Route, typeof USER_LOOKUP_ACCESS]> = [
  [USERS, USER_LOOKUP_ACCESS],
  [SUPPLIERS, SUPPLIER_LOOKUP_ACCESS],
  [ACCOUNTS, ACCOUNT_LOOKUP_ACCESS],
  [PROCESSES, BUSINESS_PROCESS_LOOKUP_ACCESS],
  [CONTRACTS, CONTRACT_LOOKUP_ACCESS],
];

/** The real guard, built once the data-source is up (no Stripe: no freeze check). */
let guard: PermissionGuard;
function buildGuard() {
  guard = new PermissionGuard(
    new Reflector(),
    new (UsersService as any)(dataSource.getRepository(User)),
    new PermissionsService(dataSource.getRepository(UserPageRole), dataSource.getRepository(RolePermission)),
    dataSource,
    { isConfigured: () => false } as any,
  );
}

function executionContext(route: Route, req: any): ExecutionContext {
  const http = { getRequest: () => req, getResponse: () => ({}), getNext: () => undefined };
  return {
    getHandler: () => route.controller.prototype.lookup,
    getClass: () => route.controller,
    switchToHttp: () => http,
    getType: () => 'http',
    getArgs: () => [req, {}, undefined],
    getArgByIndex: (i: number) => [req, {}, undefined][i],
    switchToRpc: () => { throw new Error('http only'); },
    switchToWs: () => { throw new Error('http only'); },
  } as unknown as ExecutionContext;
}

/** The handler's @Tenant() argument, built by the decorator the route declares. */
function tenantArgument(route: Route, context: ExecutionContext) {
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, route.controller, 'lookup') as Record<string, { factory?: Function; data?: unknown }>;
  const custom = Object.values(args).find((arg) => typeof arg.factory === 'function');
  assert.ok(custom, `${route.name}: @Tenant() argument`);
  return custom!.factory!(custom!.data, context);
}

type Answer = { status: number; body?: any };

async function call(runner: QueryRunner, tenantId: string, userId: string, route: Route, query: Record<string, string>): Promise<Answer> {
  const req: any = { method: 'GET', user: { sub: userId }, tenant: { id: tenantId }, queryRunner: runner };
  const context = executionContext(route, req);
  try {
    if (!(await guard.canActivate(context))) return { status: 403 };
    const body = await route.controller.prototype.lookup.call(undefined, query, tenantArgument(route, context));
    return { status: 200, body };
  } catch (error) {
    if (error instanceof HttpException) return { status: error.getStatus(), body: error.getResponse() };
    throw error;
  }
}

async function testReaderVersusEditor() {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Lookup access', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `lookup-access-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;

    // One row per reference, the value a record holds.
    const supplier = await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Acme Réseaux') RETURNING id`, [tenantId]);
    const company = await one(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Lookup Co', 'FR', 'Lyon') RETURNING id`, [tenantId]);
    const chart = await one(`INSERT INTO chart_of_accounts (tenant_id, code, name, country_iso) VALUES ($1, 'LAC', 'Chart', 'FR') RETURNING id`, [tenantId]);
    const account = await one(`INSERT INTO accounts (tenant_id, coa_id, account_number, account_name) VALUES ($1, $2, 6110, 'Software') RETURNING id`, [tenantId, chart]);
    const contract = await one(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, 'Support réseau', $2, $3, '2026-01-01') RETURNING id`,
      [tenantId, company, supplier],
    );
    const process = await one(`INSERT INTO business_processes (tenant_id, name) VALUES ($1, 'Order to cash') RETURNING id`, [tenantId]);

    const identity = async (label: string, permissions: Record<string, Level>, roleName = `Lookup ${label}`) => {
      const roleId = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`, [tenantId, roleName]);
      for (const [resource, level] of Object.entries(permissions)) {
        await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
      }
      return one(
        `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, 'Lookup', $3, $4, 'enabled') RETURNING id`,
        [tenantId, roleId, label, `${label}-${randomUUID()}@example.invalid`],
      );
    };
    const person = await identity('person', { tasks: 'reader' });
    const held: Record<string, string> = {
      [USERS.name]: person, [SUPPLIERS.name]: supplier, [ACCOUNTS.name]: account, [PROCESSES.name]: process, [CONTRACTS.name]: contract,
    };

    /**
     * What one role gets from one lookup: `search` (blank and typed text) and
     * `ids` (the held value's label). 'search' = both allowed, 'ids' = search
     * refused but the label read, 'none' = refused by the guard.
     */
    const expectAccess = async (who: string, userId: string, route: Route, expected: 'search' | 'ids' | 'none') => {
      const blank = await call(runner, tenantId, userId, route, {});
      const typed = await call(runner, tenantId, userId, route, { q: 'o' });
      const ids = await call(runner, tenantId, userId, route, { ids: held[route.name] });
      const label = `${who} on ${route.name}`;
      if (expected === 'none') {
        assert.deepEqual([blank.status, typed.status, ids.status], [403, 403, 403], `${label}: refused`);
        return;
      }
      assert.equal(ids.status, 200, `${label}: the held value's label is read`);
      assert.deepEqual(ids.body.items.map((item: any) => item.id), [held[route.name]], `${label}: by id`);
      if (expected === 'ids') {
        assert.deepEqual([blank.status, typed.status], [403, 403], `${label}: no search`);
        assert.equal(blank.body?.code, 'lookup_search_forbidden');
      } else {
        assert.deepEqual([blank.status, typed.status], [200, 200], `${label}: searches`);
        assert.ok(blank.body.items.length > 0, `${label}: the blank search lists rows`);
      }
    };

    const roles: Array<[string, Record<string, Level>, Partial<Record<string, 'search' | 'ids' | 'none'>>, string?]> = [
      ['opex reader', { opex: 'reader' }, { [USERS.name]: 'search', [SUPPLIERS.name]: 'ids', [ACCOUNTS.name]: 'ids', [CONTRACTS.name]: 'ids', [PROCESSES.name]: 'none' }],
      ['opex member', { opex: 'member' }, { [USERS.name]: 'search', [SUPPLIERS.name]: 'search', [ACCOUNTS.name]: 'search', [CONTRACTS.name]: 'search', [PROCESSES.name]: 'none' }],
      ['infrastructure reader', { infrastructure: 'reader' }, { [USERS.name]: 'search', [SUPPLIERS.name]: 'ids', [CONTRACTS.name]: 'ids', [ACCOUNTS.name]: 'none' }],
      ['infrastructure member', { infrastructure: 'member' }, { [SUPPLIERS.name]: 'search', [CONTRACTS.name]: 'search' }],
      ['applications reader', { applications: 'reader' }, { [USERS.name]: 'search', [SUPPLIERS.name]: 'ids', [PROCESSES.name]: 'ids', [CONTRACTS.name]: 'none' }],
      ['applications member', { applications: 'member' }, { [SUPPLIERS.name]: 'search', [PROCESSES.name]: 'search' }],
      ['requests reader', { portfolio_requests: 'reader' }, { [USERS.name]: 'search', [PROCESSES.name]: 'ids' }],
      ['requests member', { portfolio_requests: 'member' }, { [PROCESSES.name]: 'search' }],
      ['contracts reader', { contracts: 'reader' }, { [CONTRACTS.name]: 'search', [USERS.name]: 'ids', [SUPPLIERS.name]: 'ids' }],
      ['contracts member', { contracts: 'member' }, { [USERS.name]: 'search', [SUPPLIERS.name]: 'search' }],
      ['incidents reader', { incidents: 'reader' }, { [USERS.name]: 'ids' }],
      ['incidents contributor', { incidents: 'contributor' }, { [USERS.name]: 'search' }],
      ['cost centers reader', { cost_centers: 'reader' }, { [USERS.name]: 'ids' }],
      ['cost centers member', { cost_centers: 'member' }, { [USERS.name]: 'search' }],
      ['portfolio planning reader', { portfolio_planning: 'reader' }, { [USERS.name]: 'ids' }],
      ['suppliers reader', { suppliers: 'reader' }, { [SUPPLIERS.name]: 'search', [USERS.name]: 'none' }],
      ['accounts reader', { accounts: 'reader' }, { [ACCOUNTS.name]: 'search', [SUPPLIERS.name]: 'none' }],
      ['reporting reader', { reporting: 'reader' }, { [ACCOUNTS.name]: 'none', [USERS.name]: 'none' }],
      ['companies and departments reader', { companies: 'reader', departments: 'reader' }, { [USERS.name]: 'none' }],
      // The perf tenant's Business Contributor: applications reader, project contributor, requests and tasks member, users reader.
      [
        'Business Contributor',
        { applications: 'reader', portfolio_projects: 'contributor', portfolio_requests: 'member', tasks: 'member', users: 'reader' },
        { [SUPPLIERS.name]: 'ids', [USERS.name]: 'search', [PROCESSES.name]: 'search', [CONTRACTS.name]: 'none', [ACCOUNTS.name]: 'none' },
        'Business Contributor',
      ],
    ];
    for (const [who, permissions, expectations, roleName] of roles) {
      const userId = await identity(who.replace(/\s+/g, '-'), permissions, roleName);
      for (const [route] of LOOKUPS) {
        const expected = expectations[route.name];
        if (expected) await expectAccess(who, userId, route, expected);
      }
    }

    // An administrator searches everything.
    const adminRole = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Administrator') RETURNING id`, [tenantId]);
    const admin = await one(
      `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, 'Lookup', 'Admin', $3, 'enabled') RETURNING id`,
      [tenantId, adminRole, `admin-${randomUUID()}@example.invalid`],
    );
    for (const [route] of LOOKUPS) await expectAccess('administrator', admin, route, 'search');

    // A search that names `ids` with nothing valid is still a hydration (no row), never a list.
    const opexReader = await identity('opex-reader-2', { opex: 'reader' });
    const garbage = await call(runner, tenantId, opexReader, SUPPLIERS, { ids: 'not-a-uuid', q: 'a' });
    assert.equal(garbage.status, 200);
    assert.deepEqual(garbage.body.items, [], 'invalid ids: an empty hydration, not a search');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
  console.log('ok - readers of a picking page read labels by id only; editors and own-page readers search; Business Contributor');
}

async function main() {
  await dataSource.initialize();
  buildGuard();
  try {
    testPinnedLists();
    await testReaderVersusEditor();
    console.log('lookup-access.integration.spec: ok');
  } finally {
    await dataSource.destroy();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
