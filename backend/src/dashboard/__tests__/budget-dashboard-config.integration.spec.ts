// @database-spec: dashboard HTTP routes, PostgreSQL RLS and additive migration.
import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Module, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import * as jwt from 'jsonwebtoken';
import { DashboardController } from '../dashboard.controller';
import { DashboardService } from '../dashboard.service';
import { DashboardDataService } from '../dashboard-data.service';
import { UserDashboardConfig, DEFAULT_DASHBOARD_CONFIG, DEFAULT_BUDGET_DASHBOARD_CONFIG } from '../user-dashboard-config.entity';
import { BudgetDashboardConfig1854030000000 } from '../../migrations/1854030000000-budget-dashboard-config';
import { DashboardHideEmptyTiles1856120000000 } from '../../migrations/1856120000000-dashboard-hide-empty-tiles';
import { DataSource } from 'typeorm';
import { UsersService } from '../../users/users.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { StripeConfigService } from '../../billing/stripe/stripe.config';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { assert, inRolledBackTransaction, runSpecs, seedTenant, setTenant } from '../../spend/__tests__/round-inputs.fixtures';

runSpecs('budget-dashboard-config.integration.spec', [
  ['additive migration: defaults, rerun, rollback and existing RLS', async () => {
    await inRolledBackTransaction(async (runner) => {
      const migration = new BudgetDashboardConfig1854030000000();
      await migration.down(runner);
      await migration.up(runner);
      await migration.up(runner);
      const [column] = await runner.query(`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'user_dashboard_config' AND column_name = 'budget_tiles'`);
      assert.equal(column.is_nullable, 'NO');
      assert.equal(column.column_default, "'[]'::jsonb");
      const [rls] = await runner.query(`SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname = 'user_dashboard_config'`);
      assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });
      const [policy] = await runner.query(`SELECT qual, with_check FROM pg_policies WHERE tablename = 'user_dashboard_config' AND policyname = 'user_dashboard_config_tenant_isolation'`);
      assert.match(policy.qual, /tenant_id = app_current_tenant\(\)/);
      assert.match(policy.with_check, /tenant_id = app_current_tenant\(\)/);
      await migration.down(runner);
      assert.equal((await runner.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'user_dashboard_config' AND column_name = 'budget_tiles'`)).length, 0);
    });
  }],
  ['hide empty tiles migration: on by default, rerun and rollback', async () => {
    await inRolledBackTransaction(async (runner) => {
      const migration = new DashboardHideEmptyTiles1856120000000();
      await migration.down(runner);
      await migration.up(runner);
      await migration.up(runner);
      const [column] = await runner.query(`SELECT is_nullable, column_default FROM information_schema.columns WHERE table_name = 'user_dashboard_config' AND column_name = 'hide_empty_tiles'`);
      assert.deepEqual(column, { is_nullable: 'NO', column_default: 'true' });
      await migration.down(runner);
      assert.equal((await runner.query(`SELECT column_name FROM information_schema.columns WHERE table_name = 'user_dashboard_config' AND column_name = 'hide_empty_tiles'`)).length, 0);
    });
  }],
  ['HTTP defaults, persistence, independent writes/resets, validation, user and tenant isolation', async () => {
    await inRolledBackTransaction(async (runner) => {
      // Already applied on a migrated database; rolled back with the rest otherwise.
      await new DashboardHideEmptyTiles1856120000000().up(runner);
      const tenantA = await seedTenant(runner, 'dashboard-a');
      const seedUser = async (tenant: string) => {
        await setTenant(runner, tenant);
        const [role] = await runner.query(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`, [tenant, `Dashboard ${randomUUID()}`]);
        const [user] = await runner.query(`INSERT INTO users (tenant_id, role_id, email, status) VALUES ($1, $2, $3, 'enabled') RETURNING id`, [tenant, role.id, `${randomUUID()}@example.invalid`]);
        return user.id as string;
      };
      const alice = await seedUser(tenantA);
      const bob = await seedUser(tenantA);
      const tenantB = await seedTenant(runner, 'dashboard-b');
      const other = await seedUser(tenantB);
      await setTenant(runner, tenantA);
      const service = new DashboardService(runner.manager.getRepository(UserDashboardConfig));
      const oldSecret = process.env.JWT_SECRET;
      process.env.JWT_SECRET = randomUUID();
      @Module({ controllers: [DashboardController], providers: [
        { provide: DashboardService, useValue: service }, { provide: DashboardDataService, useValue: {} },
        { provide: UsersService, useValue: {} }, { provide: PermissionsService, useValue: {} },
        { provide: DataSource, useValue: runner.connection }, { provide: StripeConfigService, useValue: {} }, Reflector, JwtAuthGuard,
      ] })
      class TestModule {}
      const app = await NestFactory.create(TestModule, { logger: ['error'], abortOnError: false });
      app.use((req: any, _res: any, next: () => void) => { req.tenant = { id: req.headers['x-test-tenant'] || tenantA }; req.queryRunner = runner; next(); });
      app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true }));
      await app.listen(0, '127.0.0.1');
      const base = await app.getUrl();
      const request = async (path = 'budget-config', method = 'GET', body?: unknown, user = alice, tenant = tenantA, tokenTenant = tenant) => {
        const response = await fetch(`${base}/dashboard/${path}`, {
          method, headers: { Authorization: `Bearer ${jwt.sign({ sub: user, tenant_id: tokenTenant, purpose: 'access' }, process.env.JWT_SECRET!)}`, 'Content-Type': 'application/json', 'x-test-tenant': tenant },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const result = { status: response.status, body: await response.json() };
        if (result.status >= 500) console.error(method, path, result);
        return result;
      };
      try {
        const initial = await request();
        assert.equal(initial.status, 200, JSON.stringify(initial.body));
        assert.deepEqual(initial.body.tiles, DEFAULT_BUDGET_DASHBOARD_CONFIG);
        const saved = { tiles: DEFAULT_BUDGET_DASHBOARD_CONFIG.map((tile) => ({ ...tile, enabled: tile.id !== 'hygiene', order: 10 - tile.order, config: tile.id === 'budget' ? { columns: ['budget'] } : {} })) };
        const put = await request('budget-config', 'PUT', saved);
        assert.equal(put.status, 200);
        assert.deepEqual((await request()).body, put.body);
        assert.equal(put.body.tiles[0].id, DEFAULT_BUDGET_DASHBOARD_CONFIG[DEFAULT_BUDGET_DASHBOARD_CONFIG.length - 1].id);
        assert.equal(put.body.tiles.find((tile: any) => tile.id === 'hygiene').enabled, false);
        assert.deepEqual((await request('config')).body, { tiles: DEFAULT_DASHBOARD_CONFIG, hideEmptyTiles: true });
        const main = { tiles: [{ id: 'my-tasks', enabled: true, order: 1, config: { limit: 8 } }] };
        assert.equal((await request('config', 'PUT', main)).status, 200);
        const mainRead = (await request('config')).body;
        assert.deepEqual((await request()).body, put.body);
        assert.equal((await request('budget-config', 'PUT', saved)).status, 200);
        assert.deepEqual((await request('config')).body, mainRead);
        // The option: kept when a save leaves it out, refused on the budget tiles, back on at reset.
        assert.equal(mainRead.hideEmptyTiles, true);
        assert.equal((await request('config', 'PUT', { ...main, hideEmptyTiles: false })).body.hideEmptyTiles, false);
        assert.equal((await request('config', 'PUT', main)).body.hideEmptyTiles, false);
        assert.equal((await request('config', 'GET', undefined, bob)).body.hideEmptyTiles, true);
        assert.equal((await request('config', 'PUT', { ...main, hideEmptyTiles: 'no' })).status, 400);
        assert.equal((await request('budget-config', 'PUT', { ...saved, hideEmptyTiles: false })).status, 400);
        assert.equal((await request('config/reset', 'POST')).body.hideEmptyTiles, true);
        assert.equal((await request('config')).body.hideEmptyTiles, true);
        assert.equal((await request('config', 'PUT', main)).status, 200);
        // DTO-supplied user and tenant ids cannot select another person's settings.
        assert.equal((await request('budget-config', 'PUT', { ...saved, user_id: bob })).status, 400);
        assert.deepEqual((await request('budget-config', 'GET', undefined, bob)).body.tiles, DEFAULT_BUDGET_DASHBOARD_CONFIG);
        for (const tiles of [
          [{ id: 'unknown', enabled: true, order: 1, config: {} }],
          [{ id: 'budget', enabled: true, order: 1, config: { columns: ['unknown'] } }],
          [{ id: 'budget', enabled: true, order: 1, config: { columns: [] } }],
          [{ id: 'budget', enabled: true, order: 1, config: { columns: 'budget' } }],
        ]) assert.equal((await request('budget-config', 'PUT', { tiles })).status, 400);
        assert.deepEqual((await request()).body, put.body);
        await setTenant(runner, tenantB);
        assert.deepEqual((await request('budget-config', 'GET', undefined, other, tenantB)).body.tiles, DEFAULT_BUDGET_DASHBOARD_CONFIG);
        assert.deepEqual((await service.getBudgetConfig(alice, { manager: runner.manager })).tiles, DEFAULT_BUDGET_DASHBOARD_CONFIG);
        assert.equal((await request('budget-config', 'GET', undefined, alice, tenantB, tenantA)).status, 401);
        assert.equal((await request('budget-config', 'PUT', { tiles: [{ id: 'budget', enabled: false, order: 1, config: { columns: null } }] }, other, tenantB)).status, 200);
        await setTenant(runner, tenantA);
        assert.deepEqual((await request()).body, put.body);
        assert.equal((await request('budget-config/reset', 'POST')).status, 201);
        assert.deepEqual((await request()).body.tiles, DEFAULT_BUDGET_DASHBOARD_CONFIG);
        assert.deepEqual((await request('config')).body, mainRead);
        // Main reset must keep the independently saved budget tiles too.
        await request('budget-config', 'PUT', saved);
        assert.equal((await request('config/reset', 'POST')).status, 201);
        assert.deepEqual((await request('config')).body.tiles, DEFAULT_DASHBOARD_CONFIG);
        assert.deepEqual((await request()).body, put.body);
        // Partial saves keep future/newly introduced tiles enabled.
        const partial = await request('budget-config', 'PUT', { tiles: [{ id: 'budget', enabled: false, order: 1, config: {} }] });
        assert.equal(partial.body.tiles.filter((tile: any) => tile.enabled).length, DEFAULT_BUDGET_DASHBOARD_CONFIG.filter((tile) => tile.enabled).length - 1);
        assert.equal((await request('budget-config/reset', 'POST', undefined, bob)).status, 201);
        assert.deepEqual((await request('budget-config', 'GET', undefined, bob)).body.tiles, DEFAULT_BUDGET_DASHBOARD_CONFIG);
      } finally {
        await app.close();
        if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
      }
    });
  }],
]).catch((error) => { console.error(error); process.exit(1); });
