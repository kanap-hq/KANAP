// @database-spec
import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
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
 * Data-scoped access (spec §6.6): `GET /budget-lines/summary/hidden-by-value` over HTTP, the real
 * controller, PermissionGuard, JWT guard, tenant interceptor and data-access application. Ulla reads
 * every line and gets an empty answer; Rita reads L1 to L4 and gets the exact hidden count of the
 * value, in the report's lifecycle window; a person without `budget:reader` is refused (403); a
 * missing or invalid parameter is a 400. The same service call is spied on to prove an unscoped
 * reader runs no counting query.
 *
 * Needs the role kanap_data_limited (CI installs it); skipped without it, failed in CI.
 */

const dataSource = new DataSource({ ...(appDataSource.options as any), poolSize: 3 });
let client: PgClient;
let s: Seed;
let otherUserId: string;

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

async function call(app: INestApplication, query: string, userId: string): Promise<Answer> {
  const address = await app.getUrl();
  const response = await fetch(`${address}/budget-lines/summary/hidden-by-value?${query}`, {
    headers: { Authorization: `Bearer ${jwt.sign({ sub: userId, tenant_id: s.tenantId, purpose: 'access' }, process.env.JWT_SECRET!, { expiresIn: '5m' })}` },
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  let body: any = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = null;
  }
  return { status: response.status, text, body };
}

async function testHttp(app: INestApplication): Promise<void> {
  const path = (from: string) => `axis=${s.axis1}&values=${s.category1}&from=${from}`;
  const ulla = await call(app, path('2026-01-01'), s.persons.ulla);
  assert.equal(ulla.status, 200, ulla.text);
  assert.deepEqual(ulla.body, { counts: {} }, 'an unscoped reader gets an empty answer');

  const rita = await call(app, path('2026-01-01'), s.persons.rita);
  assert.equal(rita.status, 200, rita.text);
  assert.deepEqual(rita.body, { counts: { [s.category1]: 2 } }, 'L6 and L7, the hidden lines of the window');
  const wider = await call(app, path('2025-01-01'), s.persons.rita);
  assert.deepEqual(wider.body, { counts: { [s.category1]: 3 } }, 'the wider window keeps L5');
  const later = await call(app, path('2027-01-01'), s.persons.rita);
  assert.deepEqual(later.body, { counts: { [s.category1]: 1 } }, 'the later window keeps L6 alone');
  const noWindow = await call(app, `axis=${s.axis1}&values=${s.category1}`, s.persons.rita);
  assert.deepEqual(noWindow.body, { counts: { [s.category1]: 3 } }, 'no window counts every hidden line');
  const empty = await call(app, `axis=${s.axis1}&values=${s.category1}&from=2027-04-01`, s.persons.rita);
  assert.deepEqual(empty.body, { counts: {} }, 'no hidden line in that window');

  const denied = await call(app, path('2026-01-01'), otherUserId);
  assert.equal(denied.status, 403, denied.text);
  for (const query of [
    `values=${s.category1}`,
    `axis=nope&values=${s.category1}`,
    `axis=${s.axis1}`,
    `axis=${s.axis1}&values=nope`,
    `axis=${s.axis1}&values=${Array.from({ length: 501 }, () => 'x').join(',')}`,
    `axis=${s.axis1}&values=${s.category1}&from=2026-13-01`,
    `axis=${s.axis1}&values=${s.category1}&from=yesterday`,
  ]) {
    const refused = await call(app, query, s.persons.ulla);
    assert.equal(refused.status, 400, `${query}: ${refused.text}`);
  }
  console.log('  HTTP: unscoped empty, limited exact counts and window, no budget right 403, invalid parameters 400: OK');

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
          await service.hiddenCategoryCounts({ axis: s.axis1, values: s.category1, from: '2026-01-01' }, { manager: runner.manager });
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
    // The seed's lines have no end; give three of them one, so the window has something to cut.
    await inTenant(async () => {
      await client.query(`UPDATE spend_items SET disabled_at = '2025-06-01' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.lines.L5]);
      await client.query(`UPDATE spend_items SET disabled_at = '2027-03-01' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.lines.L6]);
      await client.query(`UPDATE spend_items SET disabled_at = '2026-09-01' WHERE tenant_id = $1 AND id = $2`, [s.tenantId, s.lines.L7]);
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
