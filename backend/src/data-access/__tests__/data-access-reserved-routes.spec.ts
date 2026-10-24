// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { Controller, Get, INestApplication, Module, Post, Req } from '@nestjs/common';
import {
  GUARDS_METADATA,
  INTERCEPTORS_METADATA,
  PARAMTYPES_METADATA,
  PIPES_METADATA,
  ROUTE_ARGS_METADATA,
  SELF_DECLARED_DEPS_METADATA,
} from '@nestjs/common/constants';
import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import appDataSource from '../../data-source';
import { TenantInitGuard } from '../../common/tenant-init.guard';
import { TenantInterceptor } from '../../common/tenant.interceptor';
import { SkipTenantTransaction } from '../../common/skip-tenant-transaction.decorator';
import { ReleaseTenantRunnerFilter } from '../../common/filters/release-tenant-runner.filter';
import { AiTenantExecutionService } from '../../ai/execution/ai-tenant-execution.service';
import { AiExecutionContext, AiExecutionContextWithManager } from '../../ai/ai.types';
import { AiMutationPreviewService } from '../../ai/ai-mutation-preview.service';
import { FreezeController } from '../../freeze/freeze.controller';
import { BudgetColumnsController } from '../../budget-columns/budget-columns.controller';
import { CurrencyController } from '../../currency/currency.controller';
import { AllocationRulesController } from '../../spend/allocation-rules.controller';
import { MasterDataOperationsController } from '../../master-data/master-data-operations.controller';
import { CompanyMetricsController } from '../../companies/company-metrics.controller';
import { DepartmentMetricsController } from '../../departments/department-metrics.controller';
import { SpendItemsController } from '../../spend/spend-items.controller';
import { CapexItemsController } from '../../spend/capex-items.controller';
import { BudgetLinesController } from '../../spend/budget-lines.controller';
import { ContractsController } from '../../contracts/contracts.controller';
import { UsersController } from '../../users/users.controller';
import { RolesController } from '../../roles/roles.controller';
import { AuditLogsController } from '../../audit/audit-logs.controller';
import { CompaniesController } from '../../companies/companies.controller';
import { CostCentersController } from '../../cost-centers/cost-centers.controller';
import { ChartOfAccountsController } from '../../accounts/chart-of-accounts.controller';
import { AnalyticsAxesController } from '../../analytics/analytics-axes.controller';
import { AnalyticsCategoriesController } from '../../analytics/analytics-categories.controller';
import { BusinessProcessesController } from '../../business-processes/business-processes.controller';
import { SuppliersController } from '../../suppliers/suppliers.controller';
import { ContactsController } from '../../contacts/contacts.controller';
import { AiAgentControlController } from '../../ai/control-plane/agent-control/ai-agent-control.controller';
import { AiSettingsController } from '../../ai/ai-settings.controller';
import { AiModelConfigsController } from '../../ai/ai-model-configs.controller';
import { AiApiKeysController } from '../../ai/ai-api-keys.controller';
import { DemoDataController } from '../../demo-data/demo-data.controller';
import {
  DATA_ACCESS_RESERVED_MESSAGE,
  DataAccessReservedException,
  ReservedToUnscopedDataAccess,
  assertUnscopedDataAccess,
} from '../reserved-operations';
import {
  APP_URL,
  LIMITED_ROLE,
  PgClient,
  connect,
  roleExists,
  seedNodes,
  seedPerson,
  seedRole,
  seedTree,
} from './data-access-test-helpers';
import { nextItemNumber } from './data-access-line-seed';

/**
 * Data-scoped access, lot 3 run 3A (planning/data-scoped-access/spec.md §2.7, §6.7, §10.5): the
 * operations reserved to unscoped persons, through the real tenant interceptor and exception filter.
 *
 * - A sample of each family of reserved routes, on the real controllers (their services stubbed: a
 *   refusal comes before the handler): a limited person gets 403 `DATA_ACCESS_LIMITED`; an unscoped
 *   person and an Administrator (limited mode on paper) are not refused. Routes with and without
 *   the request transaction (`@SkipTenantTransaction()`), decorator on the handler and on the class.
 *   Allowed routes of the same controllers serve a limited person.
 * - The interceptor keeps the mode on the request (`req.dataAccessMode`).
 * - A write a line policy refuses (42501) reaches the client as 403 `DATA_ACCESS_LIMITED`, without
 *   the table's name.
 * - `assertUnscopedDataAccess` refuses a limited person in a `runWithContext` path, and in a
 *   transaction where the access was not applied.
 * - Plaid: a reserved write (a company) is refused at preview and at approval; a supplier creation
 *   is not.
 *
 * Without the role (a database before the role script) a limited person is refused with 503 on the
 * routes with the request transaction (the access cannot be applied): asserted instead of 403. In CI
 * a missing role fails.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 2 });
type Seed = { tenantId: string; c1: string; c2: string; unscoped: string; admin: string; limited: string };
let seed: Seed;
let hasRole = false;
let client: PgClient;

// ---------------------------------------------------------------------------------------------
// Probes.

@Controller('da-reserved-probe')
class ProbeController {
  @Get('open')
  async open(@Req() req: any) {
    return { mode: req.dataAccessMode ?? null };
  }

  @ReservedToUnscopedDataAccess()
  @Get('reserved')
  async reserved(@Req() req: any) {
    const rows = await req.queryRunner.query(`SELECT current_user AS "user"`);
    return { mode: req.dataAccessMode ?? null, user: rows[0].user };
  }

  /** A line paid by C2: outside the limited person's edit access (C1), refused by the policy. */
  @Post('policy-refusal')
  async policyRefusal(@Req() req: any) {
    await req.queryRunner.query(
      `INSERT INTO spend_items (tenant_id, product_name, currency, effective_start, item_number, paying_company_id)
       VALUES (app_current_tenant(), 'DA reserved probe', 'EUR', '2026-01-01', $1, $2)`,
      [nextItemNumber() + 500000, seed.c2],
    );
    return { inserted: true };
  }
}

@ReservedToUnscopedDataAccess()
@SkipTenantTransaction()
@Controller('da-reserved-skip')
class SkipProbeController {
  @Get()
  async get() {
    return { ok: true };
  }
}

// ---------------------------------------------------------------------------------------------
// The real controllers, with their services stubbed.

const REAL_CONTROLLERS = [
  FreezeController, BudgetColumnsController, CurrencyController, AllocationRulesController,
  MasterDataOperationsController, CompanyMetricsController, DepartmentMetricsController,
  SpendItemsController, CapexItemsController, BudgetLinesController, ContractsController,
  UsersController, RolesController, AuditLogsController,
  CompaniesController, CostCentersController, ChartOfAccountsController, AnalyticsAxesController,
  AnalyticsCategoriesController, BusinessProcessesController, SuppliersController, ContactsController,
  AiAgentControlController, AiSettingsController, AiModelConfigsController, AiApiKeysController,
  DemoDataController,
];

/** A stand-in for any service: every member is a function resolving to undefined. Not a thenable. */
function stub(): unknown {
  const fn = () => Promise.resolve(undefined);
  return new Proxy({}, {
    get: (_target, prop) => (prop === 'then' || typeof prop === 'symbol' ? undefined : fn),
  });
}

/** The constructor dependencies Nest resolves for a class. */
function depsOf(cls: any): unknown[] {
  const tokens: unknown[] = [...(Reflect.getMetadata(PARAMTYPES_METADATA, cls) ?? [])];
  for (const { index, param } of Reflect.getMetadata(SELF_DECLARED_DEPS_METADATA, cls) ?? []) tokens[index] = param;
  return tokens.map((token: any) => (token && typeof token === 'object' && typeof token.forwardRef === 'function' ? token.forwardRef() : token));
}

/** Guards, interceptors and pipes a controller names as classes (Nest builds them with their dependencies). */
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

function stubModule(): any {
  const enhancers = new Set<any>();
  for (const controller of REAL_CONTROLLERS) for (const enhancer of enhancersOf(controller)) enhancers.add(enhancer);
  // Authentication and permissions are not under test: the reserved check runs after them.
  for (const enhancer of enhancers) {
    if (typeof enhancer.prototype?.canActivate !== 'function') continue;
    enhancer.prototype.canActivate = () => true;
    // Their start-up hooks read the options the stubs stand for (rate limits).
    if (typeof enhancer.prototype.onModuleInit === 'function') enhancer.prototype.onModuleInit = () => undefined;
  }
  const tokens = new Set<unknown>();
  for (const cls of [...REAL_CONTROLLERS, ...enhancers]) {
    for (const token of depsOf(cls)) {
      if (token === undefined || token === Object) throw new Error(`${cls.name}: a dependency the spec cannot stub`);
      // Nest provides the Reflector the interceptor and the guards use: never a stub.
      if (token !== Reflector) tokens.add(token);
    }
  }
  const providers = [...tokens].map((token) => ({ provide: token as any, useValue: stub() }));
  @Module({ controllers: [ProbeController, SkipProbeController, ...REAL_CONTROLLERS], providers })
  class ReservedRoutesModule {}
  return ReservedRoutesModule;
}

async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(stubModule(), { logger: false });
  const reflector = app.get(Reflector);
  app.use((req: any, _res: any, next: () => void) => {
    req.tenant = { id: seed.tenantId, slug: 'da-reserved', name: 'Data access reserved' };
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

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

async function call(app: INestApplication, method: Method, path: string, userId: string, body?: unknown) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/${path}`, {
    method,
    headers: { 'x-da-user': userId, 'content-type': 'application/json' },
    body: body === undefined || method === 'GET' ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: res.status, text, body: parsed };
}

const ID = randomUUID();

/** [family, method, path, skips the request transaction]: a sample of each family of spec §2.7. */
const RESERVED_SAMPLES: Array<[string, Method, string, boolean]> = [
  ['freeze', 'POST', 'freeze-states/freeze', false],
  ['budget columns', 'PATCH', 'budget-columns', false],
  ['currencies', 'PATCH', 'currency/settings', false],
  ['default allocation rule', 'PATCH', 'allocation-rules/active', false],
  ['master-data year copy', 'POST', 'master-data-operations/copy', false],
  ['company metrics', 'PATCH', `company-metrics/${ID}`, false],
  ['department metrics', 'PATCH', `department-metrics/${ID}`, false],
  ['column copy', 'POST', 'spend-items/budget-operations/copy-column', false],
  ['allocation copy', 'POST', 'spend-items/budget-operations/copy-allocations', false],
  ['column reset', 'POST', 'capex-items/budget-operations/clear-column', false],
  ['budget copy', 'POST', 'budget-lines/budget-operations/copy', false],
  ['bulk delete of lines', 'DELETE', 'spend-items/bulk', false],
  ['delete of a line', 'DELETE', `spend-items/${ID}`, false],
  ['delete of a contract', 'DELETE', `contracts/${ID}`, false],
  ['users', 'POST', 'users', false],
  ['roles', 'PUT', `roles/${ID}/permissions`, false],
  ['audit log list', 'GET', 'audit-logs', false],
  ['audit log entry', 'GET', `audit-logs/${ID}`, false],
  ['companies', 'POST', 'companies', false],
  ['cost centres', 'PATCH', `cost-centers/${ID}`, false],
  ['charts of accounts', 'PATCH', `chart-of-accounts/${ID}/global-default`, false],
  ['dimensions', 'POST', 'analytics-axes', false],
  ['closed-list dimension values', 'POST', 'analytics-categories', false],
  ['business processes', 'DELETE', `business-processes/${ID}`, false],
  ['supplier update', 'PATCH', `suppliers/${ID}`, false],
  ['contact delete', 'DELETE', `contacts/${ID}`, false],
  ['agent screens', 'GET', 'ai/admin/control-plane/agents', true],
  ['AI settings', 'GET', 'ai/settings', true],
  ['model configuration writes', 'POST', 'ai/model-configs', true],
  ['API keys administration', 'GET', 'ai/admin/keys', true],
  ['sample data', 'GET', 'admin/sample-data', true],
];

/** Routes of the same controllers left to every person. */
const ALLOWED_SAMPLES: Array<[string, Method, string]> = [
  ['companies list', 'GET', 'companies'],
  ['supplier creation', 'POST', 'suppliers'],
  ['line update', 'PATCH', `spend-items/${ID}`],
  ['own MCP keys', 'GET', 'ai/keys'],
];

function isReservedRefusal(res: { status: number; body: any }): boolean {
  return res.status === 403 && res.body?.code === 'DATA_ACCESS_LIMITED';
}

async function testReservedRoutes(app: INestApplication) {
  for (const [family, method, path, skip] of RESERVED_SAMPLES) {
    const limited = await call(app, method, path, seed.limited, {});
    if (hasRole || skip) {
      assert.ok(isReservedRefusal(limited), `${family} (${method} /${path}), limited: ${limited.status} ${limited.text}`);
      assert.equal(limited.body.message, DATA_ACCESS_RESERVED_MESSAGE, `${family}: the reserved message`);
    } else {
      assert.equal(limited.status, 503, `${family} (${method} /${path}), limited without the role: ${limited.text}`);
      assert.equal(limited.body?.code, 'DATA_ACCESS_UNAVAILABLE');
    }
    for (const [who, id] of [['unscoped', seed.unscoped], ['Administrator', seed.admin]] as const) {
      const res = await call(app, method, path, id, {});
      assert.ok(!isReservedRefusal(res), `${family} (${method} /${path}), ${who}: not refused as reserved (${res.status} ${res.text})`);
    }
  }
  console.log(`  ${RESERVED_SAMPLES.length} reserved routes (every family of spec §2.7): limited refused, unscoped and Administrator served: OK`);

  for (const [label, method, path] of ALLOWED_SAMPLES) {
    const res = await call(app, method, path, seed.limited, {});
    assert.ok(!isReservedRefusal(res), `${label} (${method} /${path}), limited: not refused as reserved (${res.status} ${res.text})`);
  }
  console.log(`  ${ALLOWED_SAMPLES.length} allowed routes of the same controllers: limited not refused: OK`);
}

async function testProbes(app: INestApplication) {
  for (const [who, id] of [['unscoped', seed.unscoped], ['Administrator', seed.admin]] as const) {
    const open = await call(app, 'GET', 'da-reserved-probe/open', id);
    assert.equal(open.status, 200, open.text);
    assert.equal(open.body.mode, 'all', `${who}: req.dataAccessMode ${open.text}`);
    const reserved = await call(app, 'GET', 'da-reserved-probe/reserved', id);
    assert.equal(reserved.status, 200, `${who}, reserved handler: ${reserved.text}`);
    assert.equal(reserved.body.mode, 'all');
    const skip = await call(app, 'GET', 'da-reserved-skip', id);
    assert.equal(skip.status, 200, `${who}, reserved class without the request transaction: ${skip.text}`);
  }
  const skip = await call(app, 'GET', 'da-reserved-skip', seed.limited);
  assert.ok(isReservedRefusal(skip), `limited, reserved class without the request transaction: ${skip.text}`);
  // No person (a public or system call reaching the route): nothing to refuse.
  const noPerson = await call(app, 'GET', 'da-reserved-skip', '');
  assert.equal(noPerson.status, 200, noPerson.text);
  if (!hasRole) return;
  const open = await call(app, 'GET', 'da-reserved-probe/open', seed.limited);
  assert.equal(open.status, 200, open.text);
  assert.equal(open.body.mode, 'limited', 'limited: req.dataAccessMode');
  const reserved = await call(app, 'GET', 'da-reserved-probe/reserved', seed.limited);
  assert.ok(isReservedRefusal(reserved), `limited, reserved handler: ${reserved.text}`);
  console.log('  probes: mode on the request, handler and class decorators, with and without the request transaction: OK');
}

async function testPolicyRefusal(app: INestApplication) {
  if (!hasRole) return;
  const res = await call(app, 'POST', 'da-reserved-probe/policy-refusal', seed.limited, {});
  assert.equal(res.status, 403, `a write the policy refuses: ${res.text}`);
  assert.equal(res.body.code, 'DATA_ACCESS_LIMITED');
  assert.equal(res.body.message, 'This item is outside your data access.');
  assert.ok(!/spend_items|row-level security|policy/i.test(res.text), `no database text in the answer: ${res.text}`);
  // An unscoped person writes the same line (rolled back below with the tenant).
  const unscoped = await call(app, 'POST', 'da-reserved-probe/policy-refusal', seed.unscoped, {});
  assert.equal(unscoped.status, 201, unscoped.text);
  console.log('  42501 from a line policy: 403 DATA_ACCESS_LIMITED without the table name: OK');
}

function context(userId: string): AiExecutionContext {
  return { tenantId: seed.tenantId, userId, isPlatformHost: false, surface: 'chat', authMethod: 'jwt' } as AiExecutionContext;
}

const REFUSED = (error: unknown) => error instanceof DataAccessReservedException;

async function testUtility() {
  const executor = new AiTenantExecutionService(dataSource);
  // A transaction where the access was not applied: the mode is read from the person.
  const plain = (userId: string) => executor.run(seed.tenantId, (manager) => assertUnscopedDataAccess({ manager, userId }));
  await plain(seed.unscoped);
  await plain(seed.admin);
  await plain('');
  await assert.rejects(plain(seed.limited), REFUSED, 'limited, access not applied: refused');
  // A request whose mode the interceptor set.
  await assert.rejects(assertUnscopedDataAccess({ req: { dataAccessMode: 'limited' } }), REFUSED);
  await assertUnscopedDataAccess({ req: { dataAccessMode: 'all' } });
  if (hasRole) {
    // runWithContext: the access applied, the mode read from the transaction.
    const viaContext = (userId: string) => executor.runWithContext(context(userId), (ctx) => assertUnscopedDataAccess(ctx));
    await viaContext(seed.unscoped);
    await viaContext(seed.admin);
    await assert.rejects(viaContext(seed.limited), REFUSED, 'limited through runWithContext: refused');
  }
  console.log('  assertUnscopedDataAccess: request, runWithContext and plain transaction: OK');
}

/** Rolls back what `fn` wrote: the transaction ends on the sentinel. */
class Rollback extends Error {
  dto?: { status?: string };
}

async function testPlaid() {
  const executor = new AiTenantExecutionService(dataSource);
  const reached: string[] = [];
  const operation = {
    toolName: 'create_master_data_record',
    businessResource: 'companies',
    writePreview: { reversible: false },
    prepareCreatePreview: async (_ctx: unknown, input: { entity_type: string }) => {
      reached.push(`prepare ${input.entity_type}`);
      throw new Rollback();
    },
    executePreview: async () => {
      reached.push('execute');
    },
    presentPreview: () => ({ target: {}, changes: {}, summary: '' }),
  };
  const operations = { getOperation: () => operation, isSupportedToolName: () => true };
  const policy = { assertWriteAccess: async () => undefined };
  const previews = new AiMutationPreviewService(null as any, null as any, null as any, policy as any, operations as any);

  // In production Plaid runs through runWithContext; without the role, a plain transaction (the
  // mode is then read from the person).
  const inPlaid = <T>(userId: string, fn: (ctx: AiExecutionContextWithManager) => Promise<T>) => (hasRole
    ? executor.runWithContext(context(userId), fn)
    : executor.run(seed.tenantId, (manager) => fn({ ...context(userId), manager })));

  const create = (userId: string, entityType: string) => inPlaid(userId, (ctx) => previews.createPreview(ctx, 'create_master_data_record', { entity_type: entityType, fields: {} }));
  await assert.rejects(create(seed.limited, 'companies'), REFUSED, 'Plaid: a limited person cannot prepare a company');
  assert.deepEqual(reached, [], 'refused before the preview is prepared');
  await assert.rejects(create(seed.limited, 'suppliers'), (error) => error instanceof Rollback, 'Plaid: a supplier creation is allowed');
  await assert.rejects(create(seed.unscoped, 'companies'), (error) => error instanceof Rollback, 'Plaid: an unscoped person prepares a company');
  assert.deepEqual(reached, ['prepare suppliers', 'prepare companies']);

  // Approval of a pending company preview (written in the same transaction, rolled back).
  const approve = (userId: string) => inPlaid(userId, async (ctx) => {
    const rows = await ctx.manager.query(
      `INSERT INTO ai_mutation_previews (tenant_id, user_id, tool_name, target_entity_type, mutation_input, status, expires_at)
       VALUES ($1, $2, 'create_master_data_record', 'companies', '{}'::jsonb, 'pending', now() + interval '1 hour') RETURNING id`,
      [seed.tenantId, userId],
    );
    const dto = await previews.executePreview(ctx, rows[0].id);
    const rollback = new Rollback();
    rollback.dto = dto;
    throw rollback;
  });
  await assert.rejects(approve(seed.limited), REFUSED, 'Plaid: a limited person cannot approve a company preview');
  assert.ok(!(reached as string[]).includes('execute'), 'refused before the write');
  await assert.rejects(approve(seed.unscoped), (error: any) => error instanceof Rollback && error.dto?.status === 'executed', 'Plaid: an unscoped person approves it');
  assert.ok((reached as string[]).includes('execute'));
  console.log('  Plaid: a reserved write refused at preview and approval, a supplier creation allowed: OK');
}

// ---------------------------------------------------------------------------------------------
// Seed and run.

async function inTenant(fn: (c: PgClient) => Promise<void>) {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [seed.tenantId]);
    await fn(client);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function seedTenant(): Promise<Seed> {
  await client.query('BEGIN');
  try {
    const tree = await seedTree(client);
    const reader = await seedRole(client, tree.tenantId, 'Budget member');
    const administrator = await seedRole(client, tree.tenantId, 'Administrator');
    const unscoped = await seedPerson(client, tree.tenantId, 'all', reader);
    const admin = await seedPerson(client, tree.tenantId, 'limited', administrator);
    const limited = await seedPerson(client, tree.tenantId, 'limited', reader);
    // Edit on C1: even with an edit node, the reserved operations stay closed.
    await seedNodes(client, tree.tenantId, limited, [{ type: 'company', id: tree.companies.c1, access: 'edit' }]);
    await client.query('COMMIT');
    return { tenantId: tree.tenantId, c1: tree.companies.c1, c2: tree.companies.c2, unscoped, admin, limited };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

async function cleanup() {
  if (!seed) return;
  await inTenant(async (c) => {
    for (const table of ['spend_items', 'ai_mutation_previews', 'user_data_access_nodes', 'users', 'roles', 'cost_centers', 'companies']) {
      if (table === 'cost_centers') await c.query(`UPDATE cost_centers SET parent_id = NULL WHERE tenant_id = $1`, [seed.tenantId]);
      await c.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [seed.tenantId]);
    }
  });
  await client.query(`DELETE FROM tenants WHERE id = $1`, [seed.tenantId]);
}

async function run() {
  client = await connect(APP_URL);
  await dataSource.initialize();
  let app: INestApplication | null = null;
  try {
    hasRole = await roleExists(client);
    console.log(`data access reserved routes (role ${hasRole ? 'installed' : 'absent'})`);
    if (!hasRole && process.env.CI) {
      assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
    }
    if (hasRole) await client.query(`SELECT data_access_sync_policies()`);
    seed = await seedTenant();
    app = await createApp();
    await testProbes(app);
    await testReservedRoutes(app);
    await testPolicyRefusal(app);
    await testUtility();
    await testPlaid();
    console.log(hasRole ? 'data access reserved routes: all scenarios passed' : 'data access reserved routes: role absent, scenarios that need it skipped');
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
