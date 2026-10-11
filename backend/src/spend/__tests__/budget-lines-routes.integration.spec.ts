// @database-spec: uses the PostgreSQL transaction harness.
import 'dotenv/config';
import { Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import * as jwt from 'jsonwebtoken';
import { StripeConfigService } from '../../billing/stripe/stripe.config';
import { randomUUID } from 'node:crypto';
import { PermissionGuard } from '../../auth/permission.guard';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { REQUIRE_LEVEL_KEY, READ_ONLY_ROUTE_KEY } from '../../auth/require-level.decorator';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/user.entity';
import dataSource from '../../data-source';
import { BudgetLinesController } from '../budget-lines.controller';
import { BudgetLinesService } from '../budget-lines.service';
import { BudgetFileService } from '../budget-file/budget-file.service';
import { budgetFileService } from './budget-file.fixtures';
import { assert, inRolledBackTransaction, runSpecs, seedLine, freezeColumn } from './round-inputs.fixtures';
import { budgetService, seedBudgetLines, YEAR } from './budget-lines.fixtures';
import { seedListFixture } from './oracle/budget-list.fixture';

// Real HTTP routing, JWT authentication, @Tenant(), PermissionGuard and database services.
// The request manager is the rolled-back fixture runner; billing configuration is a test double.
runSpecs('budget-lines-routes.integration.spec', [['nine HTTP routes, permissions, isolation, mixed deletion and export', async () => {
  await inRolledBackTransaction(async (runner) => {
    const world = await seedBudgetLines(runner);
    const { tenantId, lines, foreign } = world;
    const identity = async (label: string, level?: string) => {
      const [role] = await runner.query(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`, [tenantId, label]);
      for (const [resource, permission] of (level ? [['budget', level]] : [])) {
        await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, $3, $4)`, [tenantId, role.id, resource, permission]);
      }
      const [user] = await runner.query(`INSERT INTO users (tenant_id, role_id, email, status) VALUES ($1, $2, $3, 'enabled') RETURNING id`, [tenantId, role.id, `${label}-${randomUUID()}@example.invalid`]);
      return user.id as string;
    };
    const users = { none: await identity('no-budget'), reader: await identity('budget-reader', 'reader'), member: await identity('budget-member', 'member'), admin: await identity('budget-admin', 'admin') };
    const usersService = new (UsersService as any)(dataSource.getRepository(User));
    const permissions = new PermissionsService(dataSource.getRepository(UserPageRole), dataSource.getRepository(RolePermission));
    const oldSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'budget-lines-test-signing-key';
    const file = budgetFileService();
    @Module({ controllers: [BudgetLinesController], providers: [
      { provide: BudgetLinesService, useValue: budgetService(runner) }, { provide: BudgetFileService, useValue: file },
      { provide: UsersService, useValue: usersService }, { provide: PermissionsService, useValue: permissions },
      { provide: DataSource, useValue: dataSource }, { provide: StripeConfigService, useValue: { isConfigured: () => false } },
      Reflector, PermissionGuard, JwtAuthGuard,
    ] })
    class RoutesModule {}
    const app = await NestFactory.create(RoutesModule, { logger: false, abortOnError: false });
    app.use((req: any, _res: any, next: () => void) => { req.queryRunner = runner; req.tenant = { id: tenantId }; next(); });
    await app.listen(0, '127.0.0.1');
    const address = await app.getUrl();
    const request = async (path: string, user: string, method = 'GET', body?: unknown) => {
      const response = await fetch(`${address}/budget-lines/${path}`, { method, headers: { Authorization: `Bearer ${jwt.sign({ sub: user, tenant_id: tenantId, purpose: 'access' }, process.env.JWT_SECRET!, { expiresIn: '5m' })}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
      const text = await response.text();
      return { status: response.status, headers: response.headers, text, body: response.headers.get('content-type')?.includes('json') ? JSON.parse(text) : undefined };
    };
    const aggregate = { query: {}, spec: { groupBy: ['nature'], measures: [{ id: 'budget', fn: 'sum', field: 'yBudget' }] } };
    try {
      const routes = [
        ['summary', 'summary', 'GET'], ['summary/totals', 'summaryTotals', 'GET'],
        ['summary/filter-values?fields=nature', 'summaryFilterValues', 'GET'], ['summary/ids', 'summaryIds', 'GET'],
        [`summary/neighbors?id=BL-${lines[1].number}`, 'summaryNeighbors', 'GET'],
        ['summary/aggregate', 'summaryAggregate', 'POST'], [`resolve/BL-${lines[1].number}`, 'resolve', 'GET'],
        ['bulk', 'bulkDelete', 'DELETE'], ['budget-file/export?language=en', 'exportBudgetFile', 'GET'],
      ];
      for (const [path, handler, method] of routes) {
        const required = handler === 'bulkDelete' || handler === 'exportBudgetFile' ? 'admin' : 'reader';
        assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, (BudgetLinesController.prototype as any)[handler]), { resource: 'budget', level: required });
        const body = method === 'POST' ? aggregate : method === 'DELETE' ? { ids: [] } : undefined;
        assert.equal((await request(path, users.none, method, body)).status, 403, `${path}: no budget right`);
        if (required === 'admin') {
          for (const user of [users.reader, users.member]) assert.equal((await request(path, user, method, body)).status, 403, `${path}: lower level`);
        }
        const response = await request(path, required === 'admin' ? users.admin : users.reader, method, body);
        assert.equal(response.status, 200, `${path}: ${response.text}`);
        assert.ok(!response.text.includes(foreign.itemId) && !response.text.includes('BL-508801'), `${path}: no foreign line`);
      }
      assert.equal(Reflect.getMetadata(READ_ONLY_ROUTE_KEY, BudgetLinesController.prototype.summaryAggregate), true);
      assert.equal(Reflect.getMetadata(READ_ONLY_ROUTE_KEY, BudgetLinesController.prototype.exportBudgetFile), true);
      assert.equal((await request(`resolve/${foreign.itemId}`, users.reader)).status, 404);
      assert.equal((await request(`summary/neighbors?id=${foreign.itemId}`, users.reader)).status, 404);
      assert.equal((await request('resolve/not-a-reference', users.reader)).status, 400);
      const foreignQuery = `filters=${encodeURIComponent(JSON.stringify({ id: { filterType: 'set', values: [foreign.itemId] } }))}`;
      assert.equal((await request(`summary?${foreignQuery}`, users.reader)).body.total, 0);
      assert.equal((await request(`summary/ids?${foreignQuery}`, users.reader)).body.total, 0);
      const foreignAggregate = await request('summary/aggregate', users.reader, 'POST', { ...aggregate, query: { filters: { id: { filterType: 'set', values: [foreign.itemId] } } } });
      assert.equal(foreignAggregate.body.total.count, 0);
      const exported = await request('budget-file/export?language=en', users.admin);
      assert.ok(exported.headers.get('content-disposition')?.includes('budget.csv'));
      for (const line of lines) assert.ok(exported.text.includes(`BL-${line.number}`) && exported.text.includes(`UniqueTitle${line.number}`));
      assert.ok(exported.text.includes('opex') && exported.text.includes('capex'));
      const selected = await request(`budget-file/export?language=en&filters=${encodeURIComponent(JSON.stringify({ nature: { filterType: 'set', values: ['capex'] } }))}`, users.admin);
      assert.ok(selected.text.includes('BL-7102') && !selected.text.includes('BL-7101'));
      console.log('ok - nine HTTP routes, rights, isolation and filtered mixed budget.csv');

      // Same mixed ids passed to each legacy export still select that route's nature only.
      const caller = { manager: runner.manager, tenantId, userId: null };
      const options = { language: 'en', amountYears: undefined, columns: undefined, detail: undefined };
      const mixedIds = [...lines.map((line) => line.itemId), foreign.itemId];
      for (const nature of ['opex', 'capex'] as const) {
        const result = await file.exportFile(nature, mixedIds, caller, options);
        const expected = await file.exportFile(nature, lines.filter((line) => line.nature === nature).map((line) => line.itemId), caller, options);
        assert.deepEqual(result, expected, `${nature}: unchanged export on mixed ids`);
        for (const line of lines) assert.equal(result.content.includes(`BL-${line.number}`), line.nature === nature);
      }
      console.log('ok - both existing nature-specific exports unchanged');
      const unknown = randomUUID();
      const deleted = await request('bulk', users.admin, 'DELETE', { ids: [lines[0].itemId, lines[1].itemId, unknown, foreign.itemId] });
      assert.equal(deleted.status, 200, deleted.text);
      assert.deepEqual(deleted.body.deleted, [lines[0].itemId, lines[1].itemId]);
      assert.deepEqual(deleted.body.failed.map((entry: any) => [entry.id, entry.name, entry.reason]), [[unknown, 'Unknown', 'Item not found'], [foreign.itemId, 'Unknown', 'Item not found']]);
      const remaining = await request('summary/ids', users.reader);
      assert.deepEqual(remaining.body.ids, [lines[2].itemId]);
      console.log('ok - mixed deletion and existing unknown/foreign-id reporting');
      const capex = await seedLine(runner, 'capex', tenantId, YEAR, { planned: Array(12).fill(10) }, 7301);
      await freezeColumn(runner, 'opex', tenantId, YEAR, 'budget');
      const partial = await request('bulk', users.admin, 'DELETE', { ids: [lines[2].itemId, capex.itemId] });
      assert.equal(partial.status, 200, partial.text);
      assert.deepEqual(partial.body.deleted, [capex.itemId]);
      assert.equal(partial.body.failed[0].id, lines[2].itemId);
      assert.equal((await request(`resolve/${lines[2].itemId}`, users.reader)).status, 200);
      console.log('ok - a frozen OPEX line is kept while an unfrozen CAPEX line is deleted');

      // Account access is passed by the neutral controller just as on existing lists.
      const fixture = await seedListFixture(runner, 20261003);
      // Read consolidation through the controller under the newly seeded fixture tenant.
      const controller = new BudgetLinesController(budgetService(runner), file);
      const query = { includeDisabled: 'true', spec: undefined };
      await runner.query(`UPDATE accounts SET consolidation_account_number = 600, consolidation_account_name = 'Consolidation' WHERE tenant_id = $1`, [fixture.tenantId]);
      const spec = { groupBy: ['account_consolidation_key'], measures: [] };
      const low = await controller.summaryAggregate({ query, spec }, { tenantId: fixture.tenantId, userId: '', userRoles: [], manager: runner.manager, permissions: { budget: 'reader' } });
      const high = await controller.summaryAggregate({ query, spec }, { tenantId: fixture.tenantId, userId: '', userRoles: [], manager: runner.manager, permissions: { budget: 'reader', accounts: 'reader' } });
      assert.ok(low.groups.every((group) => group.keys[0] === null));
      assert.ok(high.groups.some((group) => group.keys[0] !== null));
      console.log('ok - consolidation fields honor account access');
    } finally {
      await app.close();
      if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
    }
  });
}]]).catch((err) => { console.error(err); process.exit(1); });
