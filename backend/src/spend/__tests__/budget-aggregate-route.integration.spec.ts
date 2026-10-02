import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ExecutionContext, HttpException } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { PermissionGuard } from '../../auth/permission.guard';
import { READ_ONLY_ROUTE_KEY, REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/user.entity';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { AGGREGATE_LIMITS } from '../../common/list-engine/list-aggregate';
import { SpendItemsController } from '../spend-items.controller';
import { SpendItemsService } from '../spend-items.service';
import { CapexItemsController } from '../../capex/capex-items.controller';
import { CapexItemsService } from '../../capex/capex-items.service';
import { SUMMARY_SCOPES, SummaryScopeConfig } from '../spend-summary.builder';
import { realSummaryDeps } from './oracle/oracle-deps';
import { seedListFixture } from './oracle/budget-list.fixture';

// `POST /spend-items/summary/aggregate` and `POST /capex-items/summary/aggregate`
// (lot 2D, PR E): the reports' and the dashboard's server aggregates. The real
// PermissionGuard runs against roles stored in the database, then the real
// handler with its @Tenant() argument:
// - the list's read level (an OPEX reader reads OPEX, not CAPEX), as the GET
//   summary routes;
// - a read: a frozen tenant keeps it (`@ReadOnlyRoute()`), while a POST that
//   writes is still refused by the freeze;
// - the spec limits, including the lower measure cap of a per-line spec (`id`
//   or `item_number` among the keys);
// - the tenant: the statement reads the session's tenant only;
// - `ctx`, a saved list context, merged like the GET routes merge it.
// The fixture of the list differential (`oracle/budget-list.fixture.ts`), in a rolled-back transaction.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in its serial database lane.

type Level = 'reader' | 'contributor' | 'member' | 'admin';
type Route = { name: string; controller: any; handler: string; svc: any; method: 'POST' };
type Answer = { status: number; body?: any };

function itemService(scope: SummaryScopeConfig): any {
  const deps = realSummaryDeps(scope);
  const args: any[] = Array.from({ length: 12 }, () => undefined);
  args[4] = deps.allocationCalculator;
  args[7] = deps.fxRates;
  return scope.scope === 'opex' ? new (SpendItemsService as any)(...args) : new (CapexItemsService as any)(...args);
}

function buildGuard(stripeConfigured: boolean): PermissionGuard {
  return new PermissionGuard(
    new Reflector(),
    new (UsersService as any)(dataSource.getRepository(User)),
    new PermissionsService(dataSource.getRepository(UserPageRole), dataSource.getRepository(RolePermission)),
    dataSource,
    { isConfigured: () => stripeConfigured } as any,
  );
}

function executionContext(route: Route, req: any): ExecutionContext {
  const http = { getRequest: () => req, getResponse: () => ({}), getNext: () => undefined };
  return {
    getHandler: () => route.controller.prototype[route.handler],
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
  const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, route.controller, route.handler) as Record<string, { factory?: Function; data?: unknown }>;
  const custom = Object.values(args).find((arg) => typeof arg.factory === 'function');
  assert.ok(custom, `${route.name}: @Tenant() argument`);
  return custom!.factory!(custom!.data, context);
}

async function call(guard: PermissionGuard, runner: QueryRunner, tenantId: string, userId: string, route: Route, body: unknown): Promise<Answer> {
  const req: any = { method: route.method, user: { sub: userId }, tenant: { id: tenantId }, queryRunner: runner };
  const context = executionContext(route, req);
  await runner.query('SAVEPOINT route_call');
  try {
    if (!(await guard.canActivate(context))) {
      await runner.query('RELEASE SAVEPOINT route_call');
      return { status: 403 };
    }
    const result = await route.controller.prototype[route.handler].call({ svc: route.svc }, body, tenantArgument(route, context));
    await runner.query('RELEASE SAVEPOINT route_call');
    return { status: 200, body: result };
  } catch (error) {
    await runner.query('ROLLBACK TO SAVEPOINT route_call');
    if (error instanceof HttpException) return { status: error.getStatus(), body: error.getResponse() };
    throw error;
  }
}

const COUNT_ONLY = { groupBy: [], measures: [] };

async function main() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const { tenantId, emptyTenantId } = await seedListFixture(runner, 20261002);
    const one = async (sql: string, params: unknown[]) => (await runner.query(sql, params))[0].id as string;
    const identity = async (label: string, permissions: Record<string, Level>, roleName = `Aggregate ${label}`) => {
      const roleId = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`, [tenantId, roleName]);
      for (const [resource, level] of Object.entries(permissions)) {
        await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, roleId, resource, level]);
      }
      return one(
        `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, 'Aggregate', $3, $4, 'enabled') RETURNING id`,
        [tenantId, roleId, label, `${label}-${randomUUID()}@example.invalid`],
      );
    };
    const opexReader = await identity('opex-reader', { opex: 'reader' });
    const capexReader = await identity('capex-reader', { capex: 'reader' });
    const reportingReader = await identity('reporting-reader', { reporting: 'reader', tasks: 'reader' });
    const admin = await identity('admin', {}, 'Administrator');

    const opex: Route = { name: 'POST /spend-items/summary/aggregate', controller: SpendItemsController, handler: 'summaryAggregate', svc: itemService(SUMMARY_SCOPES.opex), method: 'POST' };
    const capex: Route = { name: 'POST /capex-items/summary/aggregate', controller: CapexItemsController, handler: 'summaryAggregate', svc: itemService(SUMMARY_SCOPES.capex), method: 'POST' };
    const guard = buildGuard(false);
    const m = runner.manager;

    // The routes carry the list's read level and the read-only mark.
    for (const [route, resource] of [[opex, 'opex'], [capex, 'capex']] as const) {
      assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, route.controller.prototype[route.handler]), { resource, level: 'reader' }, `${route.name}: read level`);
      assert.equal(Reflect.getMetadata(READ_ONLY_ROUTE_KEY, route.controller.prototype[route.handler]), true, `${route.name}: read-only`);
    }

    // Permissions: the list's read level, as the GET summary.
    const pageTotal = {
      opex: (await opex.svc.summary({ limit: 1 }, { manager: m })).total as number,
      capex: (await capex.svc.summary({ limit: 1 }, { manager: m })).total as number,
    };
    assert.ok(pageTotal.opex > 0 && pageTotal.capex > 0);
    const cases: Array<[string, string, Route, number]> = [
      ['OPEX reader', opexReader, opex, 200], ['OPEX reader', opexReader, capex, 403],
      ['CAPEX reader', capexReader, capex, 200], ['CAPEX reader', capexReader, opex, 403],
      ['reporting reader without budget access', reportingReader, opex, 403], ['reporting reader without budget access', reportingReader, capex, 403],
      ['administrator', admin, opex, 200], ['administrator', admin, capex, 200],
    ];
    for (const [who, userId, route, status] of cases) {
      const answer = await call(guard, runner, tenantId, userId, route, { query: {}, spec: COUNT_ONLY });
      assert.equal(answer.status, status, `${who} on ${route.name}`);
      if (status === 200) {
        const scope = route === opex ? 'opex' : 'capex';
        assert.equal(answer.body.total.count, pageTotal[scope], `${who} on ${route.name}: the page's lines (default window)`);
      }
    }
    console.log('ok - the list read level, like the GET summary');

    // A frozen tenant (Stripe configured, no subscription row: frozen) keeps the read; a write is refused.
    const frozenGuard = buildGuard(true);
    const frozenRead = await call(frozenGuard, runner, tenantId, opexReader, opex, { query: {}, spec: COUNT_ONLY });
    assert.equal(frozenRead.status, 200, `frozen tenant reads: ${JSON.stringify(frozenRead.body)}`);
    const shareRoute: Route = { ...opex, name: 'POST /spend-items/:id/share', handler: 'share' };
    await assert.rejects(
      frozenGuard.canActivate(executionContext(shareRoute, { method: 'POST', user: { sub: opexReader }, tenant: { id: tenantId }, queryRunner: runner })),
      (error: any) => error instanceof HttpException && error.getStatus() === 403 && (error.getResponse() as any).error === 'SUBSCRIPTION_FROZEN',
      'a POST that writes is still frozen',
    );
    console.log('ok - a frozen tenant keeps the aggregate read; a POST that writes stays frozen');

    // Limits.
    const Y = new Date().getFullYear();
    const sums = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `m${i}`, fn: 'sum', field: 'yBudget' }));
    const refused: Array<[string, unknown]> = [
      ['no body', undefined],
      ['body is a list', []],
      ['query is a string', { query: 'filters=x', spec: COUNT_ONLY }],
      ['no spec', { query: {} }],
      [`id with ${AGGREGATE_LIMITS.lineMeasures + 1} measures`, { spec: { groupBy: ['id'], measures: sums(AGGREGATE_LIMITS.lineMeasures + 1) } }],
      [`item_number with ${AGGREGATE_LIMITS.lineMeasures + 1} measures`, { spec: { groupBy: ['currency', 'item_number'], measures: sums(AGGREGATE_LIMITS.lineMeasures + 1) } }],
      [`${AGGREGATE_LIMITS.measures + 1} measures`, { spec: { groupBy: ['currency'], measures: sums(AGGREGATE_LIMITS.measures + 1) } }],
      [`${AGGREGATE_LIMITS.groupBy + 1} keys`, { spec: { groupBy: ['currency', 'status', 'run_build', 'supplier_name', 'account_display', 'cost_center_code', 'notes'], measures: [] } }],
      ['an amount as a key', { spec: { groupBy: ['yBudget'], measures: [] } }],
      ['a limit past the cap', { spec: { groupBy: ['id'], measures: [], limit: AGGREGATE_LIMITS.limit + 1 } }],
      ['a year past the bounds', { spec: { groupBy: [], measures: [{ id: 'a', fn: 'sum', field: `y${Y + 11}Budget` }] } }],
      ['an unknown ctx', { query: { ctx: 'A'.repeat(22) }, spec: COUNT_ONLY }],
    ];
    for (const [label, body] of refused) {
      const answer = await call(guard, runner, tenantId, opexReader, opex, body);
      assert.equal(answer.status, 400, `${label}: 400 (${JSON.stringify(answer.body)})`);
    }
    for (const groupBy of [['id'], ['item_number', 'product_name']]) {
      const answer = await call(guard, runner, tenantId, opexReader, opex, { spec: { groupBy, measures: sums(AGGREGATE_LIMITS.lineMeasures) } });
      assert.equal(answer.status, 200, `${groupBy.join(', ')} with ${AGGREGATE_LIMITS.lineMeasures} measures`);
      assert.equal(answer.body.groups.length, pageTotal.opex, 'one group per line');
    }
    const grouped = await call(guard, runner, tenantId, opexReader, opex, { spec: { groupBy: ['currency'], measures: sums(AGGREGATE_LIMITS.measures) } });
    assert.equal(grouped.status, 200, `a grouped spec keeps the general cap of ${AGGREGATE_LIMITS.measures}`);
    console.log(`ok - limits: at most ${AGGREGATE_LIMITS.lineMeasures} measures per line, ${AGGREGATE_LIMITS.measures} grouped; malformed bodies refused`);

    // Filters as an object or as JSON, and the years of the query: the same answer.
    const filters = { currency: { filterType: 'set', values: ['EUR'] } };
    const spec = { groupBy: ['run_build'], measures: [{ id: 'b', fn: 'sum', field: `y${Y - 2}Budget` }], order: [{ by: 'key', index: 0, dir: 'ASC' }] };
    const asObject = await call(guard, runner, tenantId, opexReader, opex, { query: { filters, years: String(Y - 2) }, spec });
    const asJson = await call(guard, runner, tenantId, opexReader, opex, { query: { filters: JSON.stringify(filters), years: [Y - 2] }, spec });
    assert.equal(asObject.status, 200);
    assert.deepEqual(asJson.body, asObject.body, 'filters as JSON');
    const window = (await opex.svc.summary({ limit: 1, years: String(Y - 2), filters: JSON.stringify(filters) }, { manager: m })).total;
    assert.equal(asObject.body.total.count, window, 'years: the window from the earliest year, as the page');
    console.log('ok - filters as an object or JSON; years set the window as on the page');

    // ctx: a saved list context gives its filters; an inline filter wins.
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const { id: ctx } = await new ListContextsService().save(m, tenantId, 'opex', { filters });
    const withCtx = await call(guard, runner, tenantId, opexReader, opex, { query: { ctx, years: String(Y - 2) }, spec });
    assert.equal(withCtx.status, 200, JSON.stringify(withCtx.body));
    assert.deepEqual(withCtx.body, asObject.body, 'ctx: the saved filters');
    const inline = await call(guard, runner, tenantId, opexReader, opex, { query: { ctx, filters: {}, years: String(Y - 2) }, spec });
    assert.equal(inline.body.total.count, (await opex.svc.summary({ limit: 1, years: String(Y - 2) }, { manager: m })).total, 'inline filters win over ctx');
    console.log('ok - ctx merged like the GET routes');

    // Tenant: the statement reads the session's tenant only (explicit predicates besides RLS).
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [emptyTenantId]);
    const otherAdminRole = await one(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, 'Administrator') RETURNING id`, [emptyTenantId]);
    const otherAdmin = await one(
      `INSERT INTO users (tenant_id, role_id, first_name, last_name, email, status) VALUES ($1, $2, 'Other', 'Admin', $3, 'enabled') RETURNING id`,
      [emptyTenantId, otherAdminRole, `other-${randomUUID()}@example.invalid`],
    );
    for (const route of [opex, capex]) {
      const answer = await call(guard, runner, emptyTenantId, otherAdmin, route, { spec: { groupBy: ['id'], measures: [{ id: 'b', fn: 'sum', field: 'yBudget' }] } });
      assert.equal(answer.status, 200);
      assert.deepEqual([answer.body.groups.length, answer.body.total.count, answer.body.total.values.b], [0, 0, 0], `${route.name}: another tenant's session reads none of the fixture's lines`);
    }
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    console.log('ok - another tenant reads none of the lines');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
  console.log('budget-aggregate-route.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
