import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DataSource } from 'typeorm';
import { getOptionsToken, getStorageToken } from '@nestjs/throttler';
import * as jwt from 'jsonwebtoken';
import dataSource from '../../data-source';
import { StripeConfigService } from '../../billing/stripe/stripe.config';
import { ListContextsService } from '../../common/list-context/list-contexts.service';
import { useRequestPipeline } from '../../common/request-pipeline';
import { StorageService } from '../../common/storage/storage.service';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/user.entity';
import { BudgetLineTypeChangeService } from '../budget-line-type-change.service';
import { BudgetLinesController } from '../budget-lines.controller';
import { BudgetLinesService } from '../budget-lines.service';
import { BudgetFileService } from '../budget-file/budget-file.service';
import { CapexItemsController } from '../capex-items.controller';
import { EFFECTIVE_START_MESSAGE } from '../dto/effective-start';
import { SpendBudgetOperationsService } from '../spend-budget-operations.service';
import { CapexItemContactsService, SpendItemContactsService } from '../spend-item-contacts.service';
import { CapexItemsService, SpendItemsService } from '../spend-items.service';
import { CapexItemsDeleteService, SpendItemsDeleteService } from '../spend-items-delete.service';
import { SpendItemsController } from '../spend-items.controller';
import { FreezeService } from '../../freeze/freeze.service';
import { AuditService } from '../../audit/audit.service';
import { deps } from './budget-lines.fixtures';
import { itemService, seedCompany } from './cost-center.fixtures';
import { createRaceTenant, dropRaceTenant, seed } from './race-harness';

// A budget line created without effective_start used to reach PostgreSQL (the
// column is NOT NULL) and answer 500. The create routes and the shared write
// gate answer 400 and name the field. The request runs through the same
// pipeline as the API (tenant transaction, then the handler).
// @database-spec: opens the data-source. Run it on a dedicated database, never appdb.

const JWT_SECRET = 'start-date-test-signing-key';

async function main() {
  await dataSource.initialize();
  const [{ current }] = await dataSource.query(`SELECT current_database() AS current`);
  assert.notEqual(current, 'appdb', 'this spec must not write the dev database');
  const tenantId = await createRaceTenant('start-date');
  const previousSecret = process.env.JWT_SECRET;
  const previousRateLimit = process.env.RATE_LIMIT_ENABLED;
  process.env.JWT_SECRET = JWT_SECRET;
  process.env.RATE_LIMIT_ENABLED = 'false';
  let app: INestApplication | undefined;
  try {
    const { companyId, userId } = await seed(tenantId, async (runner) => {
      const company = await seedCompany(runner, tenantId, 'Start date company');
      const [role] = await runner.query(
        `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
         VALUES ($1, 'Start date member', 'Start date', false, false, now(), now()) RETURNING id`,
        [tenantId],
      );
      await runner.query(
        `INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'budget', 'member')`,
        [tenantId, role.id],
      );
      const [user] = await runner.query(
        `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status)
         VALUES ($1, $2, $3, 'Start', 'Date', 'enabled') RETURNING id`,
        [tenantId, role.id, `${randomUUID()}@start-date.example`],
      );
      return { companyId: company.companyId as string, userId: user.id as string };
    });
    const opex = itemService('opex');
    const capex = itemService('capex');
    const lines = new BudgetLinesService(deps.allocationCalculator as any, deps.fxRates as any, undefined as any, undefined as any, opex, capex, undefined as any);
    const token = jwt.sign({ sub: userId, tenant_id: tenantId, purpose: 'access' }, JWT_SECRET);

    @Module({
      controllers: [SpendItemsController, CapexItemsController, BudgetLinesController],
      providers: [
        ListContextsService,
        { provide: SpendItemsService, useValue: opex },
        { provide: CapexItemsService, useValue: capex },
        { provide: BudgetLinesService, useValue: lines },
        { provide: SpendItemsDeleteService, useValue: {} },
        { provide: CapexItemsDeleteService, useValue: {} },
        { provide: StorageService, useValue: {} },
        { provide: SpendItemContactsService, useValue: {} },
        { provide: CapexItemContactsService, useValue: {} },
        { provide: BudgetFileService, useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: FreezeService, useValue: {} },
        { provide: BudgetLineTypeChangeService, useValue: {} },
        { provide: SpendBudgetOperationsService, useValue: {} },
        { provide: UsersService, useValue: new (UsersService as any)(dataSource.getRepository(User)) },
        { provide: PermissionsService, useValue: new PermissionsService(dataSource.getRepository(UserPageRole), dataSource.getRepository(RolePermission)) },
        { provide: DataSource, useValue: dataSource },
        { provide: StripeConfigService, useValue: { isConfigured: () => false } },
        { provide: getOptionsToken(), useValue: [{ name: 'default', ttl: 60_000, limit: 100 }] },
        { provide: getStorageToken(), useValue: { increment: async () => ({ totalHits: 1, timeToExpire: 60, isBlocked: false, timeToBlockExpire: 0 }) } },
      ],
    })
    class StartDateModule {}

    const application = await NestFactory.create(StartDateModule, { logger: ['error'], abortOnError: false });
    app = application;
    application.use((req: any, _res: any, next: () => void) => {
      req.tenant = { id: tenantId, slug: 'start-date', name: 'Start date' };
      next();
    });
    useRequestPipeline(application, dataSource);
    await application.listen(0, '127.0.0.1');
    const base = `http://127.0.0.1:${(application.getHttpServer().address() as AddressInfo).port}`;

    const post = async (path: string, body: unknown) => {
      const res = await fetch(`${base}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    };
    const countLines = () => seed(tenantId, async (runner) => {
      const [row] = await runner.query(`SELECT count(*)::int AS n FROM spend_items WHERE tenant_id = $1`, [tenantId]);
      return row.n as number;
    });

    const missing = [
      ['/spend-items', { product_name: 'No date', currency: 'EUR' }],
      ['/capex-items', { description: 'No date', currency: 'EUR' }],
      ['/budget-lines', { nature: 'opex', product_name: 'No date', currency: 'EUR' }],
      ['/budget-lines', { nature: 'capex', product_name: 'No date', currency: 'EUR' }],
    ] as const;
    for (const [path, body] of missing) {
      const before = await countLines();
      const answer = await post(path, body);
      assert.equal(answer.status, 400, `${path} ${JSON.stringify(answer.body)}`);
      assert.equal(answer.body.field, 'effective_start');
      assert.equal(answer.body.message, `effective_start: ${EFFECTIVE_START_MESSAGE}`);
      assert.equal(await countLines(), before, `${path} inserted a line`);
      console.log(`ok - ${path} ${('nature' in body && body.nature) || ''} without a start date is 400`);
    }

    const created = await post('/spend-items', {
      product_name: 'With date',
      currency: 'EUR',
      effective_start: '2026-04-01',
      paying_company_id: companyId,
      status: 'disabled',
    });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const stored = await seed(tenantId, async (runner) => {
      const [row] = await runner.query(
        `SELECT effective_start::text AS effective_start, status FROM spend_items WHERE tenant_id = $1 AND product_name = 'With date'`,
        [tenantId],
      );
      return row as { effective_start: string; status: string };
    });
    assert.equal(stored.effective_start, '2026-04-01');
    assert.equal(stored.status, 'disabled', 'a key outside the zod schema is still written');
    console.log('ok - a line with a start date is created');
    console.log(`ok - create without a start date on ${current}`);
  } finally {
    if (app) await app.close();
    await dropRaceTenant(tenantId);
    if (previousSecret === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = previousSecret;
    if (previousRateLimit === undefined) delete process.env.RATE_LIMIT_ENABLED;
    else process.env.RATE_LIMIT_ENABLED = previousRateLimit;
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
