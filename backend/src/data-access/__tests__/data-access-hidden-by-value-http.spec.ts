// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { INestApplication, Module } from '@nestjs/common';
import { HttpAdapterHost, NestFactory, Reflector } from '@nestjs/core';
import { DataSource, QueryRunner } from 'typeorm';
import * as jwt from 'jsonwebtoken';
import appDataSource from '../../data-source';
import { TenantInitGuard } from '../../common/tenant-init.guard';
import { TenantInterceptor } from '../../common/tenant.interceptor';
import { ReleaseTenantRunnerFilter } from '../../common/filters/release-tenant-runner.filter';
import { withTenantExecution } from '../../common/tenant-runner';
import { purgeTenantTables } from '../../admin/tenants/tenant-data-purge';
import { TENANT_PURGE_TABLES } from '../../admin/tenants/tenant-purge.inventory';
import { PermissionGuard } from '../../auth/permission.guard';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/user.entity';
import { StripeConfigService } from '../../billing/stripe/stripe.config';
import { BudgetLinesController } from '../../spend/budget-lines.controller';
import { BudgetLinesService } from '../../spend/budget-lines.service';
import { BudgetFileService } from '../../spend/budget-file/budget-file.service';
import { SpendBudgetOperationsService } from '../../spend/spend-budget-operations.service';
import { realSummaryDeps } from '../../spend/__tests__/oracle/oracle-deps';
import { applyDataAccess } from '../data-access';
import { APP_URL, LIMITED_ROLE, PgClient, connect, roleExists, seedPerson, seedRole } from './data-access-test-helpers';
import { seed, type Seed } from './data-access-line-seed';

/**
 * Data-scoped access (spec §6.6): `POST /budget-lines/summary/hidden-by-value` over HTTP, the real
 * controller, PermissionGuard, JWT guard, tenant interceptor and data-access application. Ulla reads
 * every line and gets an empty answer; Rita reads L1 to L4 and gets the exact hidden count of the
 * value, in the report's lifecycle window and for the tab's nature; a value only a hidden line holds
 * gets no answer; a person without `budget:reader` is refused (403); a missing or invalid body is a
 * 400. The same service call is spied on to prove an unscoped reader runs no counting query.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 3 });
let client: PgClient;
let s: Seed;
let otherUserId: string;
let hiddenOnly: { axis: string; value: string };

async function inTenant(fn: () => Promise<void>): Promise<void> {
  await client.query('BEGIN');
  try {
    await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    await fn();
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

function testModule(): any {
  const deps = realSummaryDeps({ scope: 'opex' });
  const service = new BudgetLinesService(
    deps.allocationCalculator as any,
    deps.fxRates as any,
    undefined as any,
    undefined as any,
    undefined as any,
    undefined as any,
    undefined as any,
  );
  @Module({
    controllers: [BudgetLinesController],
    providers: [
      { provide: BudgetLinesService, useValue: service },
      { provide: BudgetFileService, useValue: {} },
      { provide: SpendBudgetOperationsService, useValue: {} },
      { provide: UsersService, useValue: new (UsersService as any)(dataSource.getRepository(User)) },
      { provide: PermissionsService, useValue: new PermissionsService(dataSource.getRepository(UserPageRole), dataSource.getRepository(RolePermission)) },
      { provide: DataSource, useValue: dataSource },
      { provide: StripeConfigService, useValue: { isConfigured: () => false } },
      Reflector, PermissionGuard, JwtAuthGuard,
    ],
  })
  class HiddenCountModule {}
  return HiddenCountModule;
}

async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(testModule(), { logger: false, abortOnError: false });
  const reflector = app.get(Reflector);
  app.use((req: any, _res: any, next: () => void) => {
    req.tenant = { id: s.tenantId, slug: 'da-hidden-count', name: 'Data access hidden count' };
    next();
  });
  app.useGlobalGuards(new TenantInitGuard(dataSource, reflector));
  app.useGlobalInterceptors(new TenantInterceptor(dataSource, reflector));
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new ReleaseTenantRunnerFilter(httpAdapter));
  await app.listen(0, '127.0.0.1');
  return app;
}

type Answer = { status: number; text: string; body: any };

async function call(app: INestApplication, body: unknown, userId: string): Promise<Answer> {
  const address = await app.getUrl();
  const response = await fetch(`${address}/budget-lines/summary/hidden-by-value`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${jwt.sign({ sub: userId, tenant_id: s.tenantId, purpose: 'access' }, process.env.JWT_SECRET!, { expiresIn: '5m' })}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let parsed: any = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  return { status: response.status, text, body: parsed };
}

async function testHttp(app: INestApplication): Promise<void> {
  const year = new Date().getFullYear();
  const body = (patch: Record<string, unknown> = {}) => ({ axis: s.axis1, values: [s.category1], year, scope: 'all', ...patch });
  const ulla = await call(app, body(), s.persons.ulla);
  assert.equal(ulla.status, 200, ulla.text);
  assert.deepEqual(ulla.body, { counts: {} }, 'an unscoped reader gets an empty answer');

  const rita = await call(app, body(), s.persons.rita);
  assert.equal(rita.status, 200, rita.text);
  assert.deepEqual(rita.body, { counts: { [s.category1]: 2 } }, 'L6 and L7, the hidden lines of the window');
  const wider = await call(app, body({ year: year - 1 }), s.persons.rita);
  assert.deepEqual(wider.body, { counts: { [s.category1]: 3 } }, 'the wider window keeps L5');
  const later = await call(app, body({ year: year + 1 }), s.persons.rita);
  assert.deepEqual(later.body, { counts: { [s.category1]: 1 } }, 'the later window keeps L6 alone');
  const noYear = await call(app, body({ year: undefined }), s.persons.rita);
  assert.deepEqual(noYear.body, { counts: { [s.category1]: 3 } }, 'no year: the server window, current year - 1');
  const empty = await call(app, body({ year: year + 2 }), s.persons.rita);
  assert.deepEqual(empty.body, { counts: {} }, 'no hidden line in that window');

  const opex = await call(app, body({ scope: 'opex' }), s.persons.rita);
  assert.deepEqual(opex.body, { counts: { [s.category1]: 1 } }, 'the OPEX tab counts L7 only');
  const capex = await call(app, body({ scope: 'capex' }), s.persons.rita);
  assert.deepEqual(capex.body, { counts: { [s.category1]: 1 } }, 'the CAPEX tab counts L6 only');

  const hiddenOnlyAnswer = await call(app, { axis: hiddenOnly.axis, values: [hiddenOnly.value], year, scope: 'all' }, s.persons.rita);
  assert.equal(hiddenOnlyAnswer.status, 200, hiddenOnlyAnswer.text);
  assert.deepEqual(hiddenOnlyAnswer.body, { counts: {} }, 'a value no readable line holds is not answered');

  // 500 real UUIDs are accepted (the request is a body, not a URL); 501 is a 400.
  const many = Array.from({ length: 499 }, () => randomUUID());
  const fiveHundred = await call(app, body({ values: [s.category1, ...many] }), s.persons.rita);
  assert.equal(fiveHundred.status, 200, fiveHundred.text);
  assert.deepEqual(fiveHundred.body, { counts: { [s.category1]: 2 } });
  const tooMany = await call(app, body({ values: [s.category1, ...many, randomUUID()] }), s.persons.rita);
  assert.equal(tooMany.status, 400, tooMany.text);

  const denied = await call(app, body(), otherUserId);
  assert.equal(denied.status, 403, denied.text);
  for (const refused of [
    {},
    { values: [s.category1], year, scope: 'all' },
    { axis: 'nope', values: [s.category1], year, scope: 'all' },
    { axis: s.axis1, values: 'x', year, scope: 'all' },
    { axis: s.axis1, values: [], year, scope: 'all' },
    { axis: s.axis1, values: ['nope'], year, scope: 'all' },
    { axis: s.axis1, values: [s.category1], year: '2026', scope: 'all' },
    { axis: s.axis1, values: [s.category1], year: 2026.5, scope: 'all' },
    { axis: s.axis1, values: [s.category1], year: 1900, scope: 'all' },
    { axis: s.axis1, values: [s.category1], year, scope: 'opex,capex' },
  ]) {
    const refusedAnswer = await call(app, refused, s.persons.ulla);
    assert.equal(refusedAnswer.status, 400, `${JSON.stringify(refused)}: ${refusedAnswer.text}`);
  }
  console.log('  HTTP: unscoped empty, limited counts with window and nature, hidden-only value silent, 500 accepted, invalid 400, no budget right 403: OK');

  const service = app.get(BudgetLinesService);
  const runner: QueryRunner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [s.tenantId]);
    const statementsOf = async (person: string): Promise<string[]> => {
      await runner.query('SAVEPOINT page');
      try {
        await applyDataAccess(runner, person);
        const seen: string[] = [];
        const original = runner.manager.query.bind(runner.manager);
        (runner.manager as any).query = (sql: string, ...rest: any[]) => { seen.push(sql); return (original as any)(sql, ...rest); };
        try {
          await service.hiddenCategoryCounts({ axis: s.axis1, values: [s.category1], year, scope: 'all' }, { manager: runner.manager });
        } finally {
          (runner.manager as any).query = original;
        }
        return seen;
      } finally {
        await runner.query('ROLLBACK TO SAVEPOINT page');
      }
    };
    assert.deepEqual((await statementsOf(s.persons.ulla)).filter((sql) => sql.includes('data_access_hidden_category_count')), [], 'an unscoped reader runs no counting query');
    assert.ok((await statementsOf(s.persons.rita)).some((sql) => sql.includes('data_access_hidden_category_count')), 'a limited reader counts the hidden lines');
    console.log('  statements: no counting query outside limited mode, one for a limited person: OK');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

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
  let app: INestApplication | null = null;
  const oldSecret = process.env.JWT_SECRET;
  try {
    if (!(await roleExists(client))) {
      if (process.env.CI) assert.fail(`CI installs ${LIMITED_ROLE} before the migrations (infra/scripts/data-access-role.sql)`);
      console.log(`data access hidden by value over HTTP: ${LIMITED_ROLE} not installed, skipped`);
      return;
    }
    await client.query('BEGIN');
    try {
      s = await seed(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    // The base value is held by both natures: L4 CAPEX readable, L5 OPEX and L6 CAPEX and L7 OPEX
    // hidden. The window cuts L5 (ends in 2025), keeps L6 (2027) and L7 (2026).
    await inTenant(async () => {
      await client.query(`UPDATE spend_items SET nature = 'capex' WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [s.tenantId, [s.lines.L4, s.lines.L6]]);
      await client.query(`UPDATE spend_items SET disabled_at = '2025-06-01' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.lines.L5]);
      await client.query(`UPDATE spend_items SET disabled_at = '2027-03-01' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.lines.L6]);
      await client.query(`UPDATE spend_items SET disabled_at = '2026-09-01' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.lines.L7]);
      const hiddenAxis = (await client.query(
        `INSERT INTO analytics_axes (tenant_id, code, name) VALUES ($1, 'hidden-only', 'hidden-only') RETURNING id`,
        [s.tenantId],
      )).rows[0].id as string;
      const hiddenValue = (await client.query(
        `INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'hidden only') RETURNING id`,
        [s.tenantId, hiddenAxis],
      )).rows[0].id as string;
      await client.query(
        `INSERT INTO spend_item_analytics_values (tenant_id, item_id, axis_id, category_id) VALUES ($1, $2, $3, $4)`,
        [s.tenantId, s.lines.L6, hiddenAxis, hiddenValue],
      );
      hiddenOnly = { axis: hiddenAxis, value: hiddenValue };
      const [member] = (await client.query(`SELECT role_id FROM users WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.persons.ulla])).rows;
      await client.query(
        `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'budget', 'reader')`,
        [s.tenantId, member.role_id],
      );
      const otherRole = await seedRole(client, s.tenantId, 'Other module');
      await client.query(
        `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'tasks', 'reader')`,
        [s.tenantId, otherRole],
      );
      otherUserId = await seedPerson(client, s.tenantId, 'all', otherRole);
    });
    process.env.JWT_SECRET = 'data-access-hidden-by-value-http-key';
    app = await createApp();
    await testHttp(app);
    console.log('data access hidden by value over HTTP: all scenarios passed');
  } finally {
    if (app) await app.close();
    if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
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
