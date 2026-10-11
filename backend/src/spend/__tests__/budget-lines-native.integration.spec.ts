import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { Module } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { DataSource } from 'typeorm';
import * as jwt from 'jsonwebtoken';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { AuditLog } from '../../audit/audit.entity';
import { PermissionGuard } from '../../auth/permission.guard';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/user.entity';
import { StripeConfigService } from '../../billing/stripe/stripe.config';
import { BudgetLinesController } from '../budget-lines.controller';
import { BudgetLinesService } from '../budget-lines.service';
import { BudgetFileService } from '../budget-file/budget-file.service';
import { budgetFileService, exportBudgetFile, loadBudgetFile, preflightBudgetFile } from './budget-file.fixtures';
import { assert, inRolledBackTransaction, runSpecs, freezeColumn, setTenant } from './round-inputs.fixtures';
import { seedBudgetLines, deps, YEAR } from './budget-lines.fixtures';
import { itemService, seedCompany } from './cost-center.fixtures';

runSpecs('budget-lines-native.integration.spec', [['native HTTP contract, conflicts, freeze, rights, isolation and audit', async () => {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, lines, foreign } = await seedBudgetLines(runner);
    const company = await seedCompany(runner, tenantId, 'Native company');
    await runner.query(`UPDATE spend_items SET paying_company_id = $2 WHERE tenant_id = $1 AND nature IN ('opex', 'capex')`, [tenantId, company.companyId]);
    const audit = new AuditService(runner.manager.getRepository(AuditLog));
    const opex = itemService('opex', audit);
    const capex = itemService('capex', audit);
    const service = new BudgetLinesService(deps.allocationCalculator as any, deps.fxRates as any, undefined as any, undefined as any, opex, capex);
    const identity = async (level: string | null) => {
      const [role] = await runner.query(`INSERT INTO roles (tenant_id, role_name) VALUES ($1, $2) RETURNING id`, [tenantId, `Native ${level}`]);
      if (level) await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'budget', $3)`, [tenantId, role.id, level]);
      const [user] = await runner.query(`INSERT INTO users (tenant_id, role_id, email, status) VALUES ($1, $2, $3, 'enabled') RETURNING id`, [tenantId, role.id, `${randomUUID()}@example.invalid`]);
      return user.id;
    };
    const users = { none: await identity(null), reader: await identity('reader'), contributor: await identity('contributor'), member: await identity('member') };
    const oldSecret = process.env.JWT_SECRET;
    process.env.JWT_SECRET = 'native-budget-test-signing-key';
    @Module({ controllers: [BudgetLinesController], providers: [
      { provide: BudgetLinesService, useValue: service }, { provide: BudgetFileService, useValue: budgetFileService() },
      { provide: UsersService, useValue: new (UsersService as any)(dataSource.getRepository(User)) },
      { provide: PermissionsService, useValue: new PermissionsService(dataSource.getRepository(UserPageRole), dataSource.getRepository(RolePermission)) },
      { provide: DataSource, useValue: dataSource }, { provide: StripeConfigService, useValue: { isConfigured: () => false } },
      Reflector, PermissionGuard, JwtAuthGuard,
    ] })
    class NativeModule {}
    const app = await NestFactory.create(NativeModule, { logger: false, abortOnError: false });
    app.use((req: any, _res: any, next: () => void) => { req.queryRunner = runner; req.tenant = { id: tenantId }; next(); });
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const request = async (path: string, method = 'GET', body?: unknown, user = users.member) => {
      const response = await fetch(`${url}/budget-lines${path ? `/${path}` : ''}`, {
        method, headers: { Authorization: `Bearer ${jwt.sign({ sub: user, tenant_id: tenantId, purpose: 'access' }, process.env.JWT_SECRET!)}`, 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    };
    try {
      assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, BudgetLinesController.prototype.create), { resource: 'budget', level: 'member' });
      assert.deepEqual(Reflect.getMetadata(REQUIRE_LEVEL_KEY, BudgetLinesController.prototype.update), { resource: 'budget', level: 'member' });
      assert.equal((await request(`BL-${lines[0].number}`, 'GET', undefined, users.none)).status, 403);
      assert.equal((await request(`BL-${lines[0].number}`, 'GET', undefined, users.reader)).status, 200);
      for (const user of [users.none, users.reader, users.contributor]) {
        assert.equal((await request('', 'POST', { nature: 'opex' }, user)).status, 403);
        assert.equal((await request(lines[0].itemId, 'PATCH', { notes: 'Denied' }, user)).status, 403);
      }
      const bodies: any[] = [];
      for (const nature of ['opex', 'capex']) {
        const created = await request('', 'POST', { nature, product_name: `${nature} title`, description: `${nature} description`, notes: `${nature} notes`, currency: 'EUR', effective_start: '2026-01-01', paying_company_id: company.companyId, account_id: company.accountId });
        assert.equal(created.status, 201, JSON.stringify(created.body));
        bodies.push(created.body);
        assert.equal(created.body.reference, `BL-${created.body.item_number}`);
        assert.equal(created.body.nature, nature);
        assert.deepEqual([created.body.product_name, created.body.description, created.body.notes], [`${nature} title`, `${nature} description`, `${nature} notes`]);
        const read = await request(created.body.reference);
        assert.equal(read.status, 200);
        assert.deepEqual(read.body, created.body);
        for (const ref of [created.body.id, String(created.body.item_number), created.body.legacy_number].filter(Boolean)) {
          assert.equal((await request(ref)).body.id, created.body.id);
        }
        const patch = await request(created.body.id, 'PATCH', { description: 'Updated description', notes: 'Updated notes', base: { description: created.body.description, notes: created.body.notes } });
        assert.equal(patch.status, 200, JSON.stringify(patch.body));
        assert.deepEqual([patch.body.product_name, patch.body.description, patch.body.notes], [`${nature} title`, 'Updated description', 'Updated notes']);
        const conflict = await request(created.body.id, 'PATCH', { description: 'My description', base: { description: created.body.description } });
        assert.equal(conflict.status, 409, JSON.stringify(conflict.body));
        assert.equal(conflict.body.code, 'edit_conflict');
        assert.equal(conflict.body.conflicts[0].field, 'description');
        assert.equal((await request(created.body.id)).body.description, 'Updated description');
        const independent = await request(created.body.id, 'PATCH', { notes: 'Independent notes', base: { notes: 'Updated notes' } });
        assert.equal(independent.status, 200);
        const title = await request(created.body.id, 'PATCH', { product_name: `${nature} renamed`, base: { product_name: `${nature} title` } });
        assert.equal(title.status, 200);
        const titleConflict = await request(created.body.id, 'PATCH', { product_name: 'Other title', base: { product_name: `${nature} title` } });
        assert.equal(titleConflict.status, 409);
        assert.equal(titleConflict.body.conflicts[0].field, 'product_name');
        const logs = await runner.query(`SELECT table_name, action, before_json, after_json, user_id FROM audit_log WHERE tenant_id = $1 AND record_id = $2 ORDER BY created_at`, [tenantId, created.body.id]);
        assert.equal(logs.length, 4, 'only successful writes audited');
        for (const log of logs) {
          assert.equal(log.table_name, nature === 'opex' ? 'spend_items' : 'capex_items');
          assert.equal(log.user_id, users.member);
          assert.equal(log.after_json.nature, nature);
          assert.equal(log.after_json.item_number, created.body.item_number);
        }
        assert.deepEqual([logs[0].after_json.product_name, logs[0].after_json.description, logs[0].after_json.notes], [`${nature} title`, `${nature} description`, `${nature} notes`]);
        assert.equal((await request(created.body.id, 'PATCH', { nature })).status, 400);
      }
      assert.deepEqual(Object.keys(bodies[0]).sort(), Object.keys(bodies[1]).sort(), 'same native keys for both natures');
      for (const line of lines) {
        for (const ref of [line.itemId, line.legacy, `BL-${line.number}`, String(line.number)]) assert.equal((await request(ref)).body.id, line.itemId);
      }
      for (const method of ['GET', 'PATCH']) assert.equal((await request(foreign.itemId, method, method === 'PATCH' ? { notes: 'Foreign edit' } : undefined)).status, 404);
      assert.equal((await request('', 'POST', { product_name: 'Missing type' })).status, 400);
      for (const contract_id of [null, randomUUID()]) {
        assert.equal((await request(bodies[1].id, 'PATCH', { contract_id })).status, 400);
        assert.equal((await request('', 'POST', { nature: 'capex', contract_id })).status, 400);
      }
      // Both metadata services remain editable when the line has actual frozen amounts.
      for (const line of lines.slice(0, 2)) {
        await freezeColumn(runner, line.nature, tenantId, YEAR, 'budget');
        const changed = await request(line.itemId, 'PATCH', { notes: 'Editable despite frozen amounts' });
        assert.equal(changed.status, 200, JSON.stringify(changed.body));
        assert.equal((await request(line.itemId)).body.notes, 'Editable despite frozen amounts');
      }
      // The legacy alias still returns the title as description and its CPX number.
      const alias = await capex.get(bodies[1].id, { manager: runner.manager });
      assert.equal(alias.description, 'capex renamed');
      assert.ok(!('product_name' in alias) && !('nature' in alias) && !('legacy_number' in alias));
      await capex.update(bodies[1].id, { description: 'Alias title' }, users.member, { manager: runner.manager });
      const [aliasAudit] = await runner.query(`SELECT after_json FROM audit_log WHERE tenant_id = $1 AND record_id = $2 ORDER BY created_at DESC LIMIT 1`, [tenantId, bodies[1].id]);
      assert.equal(aliasAudit.after_json.description, 'Alias title');
      assert.ok(!('product_name' in aliasAudit.after_json));
      assert.equal((await request(bodies[1].id)).body.description, 'Updated description');
      const exported = await exportBudgetFile(runner.manager, 'capex', tenantId, [bodies[1].id]);
      const roundtrip = await preflightBudgetFile(runner.manager, 'capex', tenantId, exported);
      assert.equal(roundtrip.ok, true, JSON.stringify(roundtrip.errors));
      assert.deepEqual([roundtrip.changes.unchanged, roundtrip.changes.updated], [1, 0]);
      const imported = await loadBudgetFile(runner.manager, 'capex', tenantId, exported);
      assert.equal('updated' in imported && imported.updated, 0);
      // Creating CAPEX still checks its applicable required dimensions by name.
      const [axis] = await runner.query(`INSERT INTO analytics_axes (tenant_id, code, name, applies_to, required) VALUES ($1, 'native_required', 'Investment purpose', 'capex', true) RETURNING id`, [tenantId]);
      const [value] = await runner.query(`INSERT INTO analytics_categories (tenant_id, axis_id, name) VALUES ($1, $2, 'Replacement') RETURNING id`, [tenantId, axis.id]);
      const requiredBody = { nature: 'capex', product_name: 'Required dimension', currency: 'EUR', effective_start: '2026-01-01', paying_company_id: company.companyId };
      const refused = await request('', 'POST', requiredBody);
      assert.equal(refused.status, 400);
      assert.match(JSON.stringify(refused.body), /Investment purpose/);
      assert.equal((await request('', 'POST', { ...requiredBody, analytics_values: { [axis.id]: value.id } })).status, 201);
      console.log('ok - native GET/POST/PATCH, field conflicts, frozen metadata, permissions, tenant isolation, required dimensions, real audit and file roundtrip');
    } finally {
      await app.close();
      if (oldSecret === undefined) delete process.env.JWT_SECRET; else process.env.JWT_SECRET = oldSecret;
      await setTenant(runner, tenantId);
    }
  });
}]]).catch((error) => { console.error(error); process.exit(1); });
