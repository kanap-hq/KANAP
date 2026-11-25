import 'dotenv/config';
import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditService } from '../../audit/audit.service';
import { PermissionGuard } from '../../auth/permission.guard';
import { REQUIRE_LEVEL_KEY } from '../../auth/require-level.decorator';
import { CompaniesController } from '../../companies/companies.controller';
import { DepartmentsController } from '../../departments/departments.controller';
import { PermissionsService } from '../../permissions/permissions.service';
import { RolePermission } from '../../permissions/role-permission.entity';
import { UserPageRole } from '../../permissions/user-page-role.entity';
import { UsersService } from '../../users/users.service';
import { User } from '../../users/user.entity';
import { AiFinancialPlanMutationSupportService } from '../../ai/mutation/ai-financial-plan-mutation-support.service';
import { AllocationCalculatorService } from '../allocation-calculator.service';
import { CapexAllocationsService, SpendAllocationsService } from '../spend-allocations.service';
import { CapexVersionsController } from '../capex-versions.controller';
import { SpendVersionsController } from '../spend-versions.controller';
import { itemService, lineBody, seedCompany } from './cost-center.fixtures';
import { Kind, seedVersion } from './round-inputs.fixtures';
import { createRaceTenant, dropRaceTenant, seed } from './race-harness';

// The names an allocation carries (K2d, point 3). A person who reads the budget without reading the
// companies or departments lists sees who a line they read is split between: the Allocations tab's
// read answers the company and department names, and Kad's card names them too. Nothing changes for
// data access: the lists stay closed to that person (403), only the names carried by the line show.
// @database-spec: opens the data-source, so run-ci-tests.js runs this file in a database lane.

const YEAR = 2026;
const calculator = () => new AllocationCalculatorService(undefined as any, undefined as any, undefined as any, undefined as any);
const allocations = (kind: Kind): SpendAllocationsService => kind === 'opex'
  ? new SpendAllocationsService(undefined as any, undefined as any, calculator(), new AuditService(undefined as any) as any)
  : new CapexAllocationsService(undefined as any, undefined as any, calculator(), new AuditService(undefined as any) as any);

type Setup = { reader: string; versionId: string; north: string; south: string; department: string };

async function seedBudgetReader(runner: QueryRunner, tenantId: string): Promise<string> {
  const [role] = await runner.query(
    `INSERT INTO roles (tenant_id, role_name, role_description, is_system, is_built_in, created_at, updated_at)
     VALUES ($1, $2, 'Budget without companies', false, false, now(), now()) RETURNING id`,
    [tenantId, `Budget only ${randomUUID().slice(0, 8)}`],
  );
  await runner.query(`INSERT INTO role_permissions (tenant_id, role_id, resource, level) VALUES ($1, $2, 'budget', 'reader')`, [tenantId, role.id]);
  const [user] = await runner.query(
    `INSERT INTO users (tenant_id, role_id, email, first_name, last_name, status) VALUES ($1, $2, $3, 'Bea', 'Budget', 'enabled') RETURNING id`,
    [tenantId, role.id, `bea.${randomUUID().slice(0, 6)}@allocation-names.example`],
  );
  return user.id;
}

/** A line split by hand: 60 % to North's Finance department, 40 % to South. */
async function setup(tenantId: string, kind: Kind): Promise<Setup> {
  const s = await seed(tenantId, async (runner) => {
    const reader = await seedBudgetReader(runner, tenantId);
    const north = await seedCompany(runner, tenantId, `North ${kind}`);
    const south = await seedCompany(runner, tenantId, `South ${kind}`, 6100);
    const [department] = await runner.query(
      `INSERT INTO departments (tenant_id, company_id, name) VALUES ($1, $2, $3) RETURNING id`, [tenantId, north.companyId, `Finance ${kind}`],
    );
    const line = await itemService(kind).create(
      lineBody(kind, `Split line ${kind}`, { paying_company_id: north.companyId, account_id: north.accountId }), null, { manager: runner.manager },
    );
    const versionId = await seedVersion(runner, kind, tenantId, line.id, YEAR);
    return { reader, versionId, north: north.companyId, south: south.companyId, department: department.id as string };
  });
  await seed(tenantId, async (runner) => {
    const service = allocations(kind);
    const read = await service.listForVersion(s.versionId, { manager: runner.manager, tenantId });
    await service.put(s.versionId, {
      method: 'manual_pct', driver: 'headcount', base_signature: read.base_signature,
      rows: [{ company_id: s.north, department_id: null, allocation_pct: 60 }, { company_id: s.south, department_id: null, allocation_pct: 40 }],
    }, null, { manager: runner.manager, tenantId });
    // A row on a department, as a split by department stores it.
    await runner.query(`UPDATE spend_allocations SET department_id = $1 WHERE version_id = $2 AND company_id = $3`, [s.department, s.versionId, s.north]);
  });
  return s;
}

function buildGuard(): PermissionGuard {
  return new PermissionGuard(
    new Reflector(),
    new (UsersService as any)(dataSource.getRepository(User)),
    new PermissionsService(dataSource.getRepository(UserPageRole), dataSource.getRepository(RolePermission)),
    dataSource,
    { isConfigured: () => false } as any,
  );
}

function executionContext(controller: any, handler: string, req: any): ExecutionContext {
  const http = { getRequest: () => req, getResponse: () => ({}), getNext: () => undefined };
  return {
    getHandler: () => controller.prototype[handler],
    getClass: () => controller,
    switchToHttp: () => http,
    getType: () => 'http',
    getArgs: () => [req, {}, undefined],
    getArgByIndex: (i: number) => [req, {}, undefined][i],
    switchToRpc: () => { throw new Error('http only'); },
    switchToWs: () => { throw new Error('http only'); },
  } as unknown as ExecutionContext;
}

async function allocationNames(tenantId: string, kind: Kind) {
  const s = await setup(tenantId, kind);
  const controller: any = kind === 'opex' ? SpendVersionsController : CapexVersionsController;
  assert.deepEqual(
    Reflect.getMetadata(REQUIRE_LEVEL_KEY, controller.prototype.listAllocations), { resource: 'budget', level: 'reader' },
    `${kind}: the Allocations tab's read asks for the budget only`,
  );
  const guard = buildGuard();
  await seed(tenantId, async (runner) => {
    const req: any = { method: 'GET', user: { sub: s.reader }, tenant: { id: tenantId }, queryRunner: runner };
    // The lists stay closed to this person.
    const refused = (error: unknown) => { if (error instanceof ForbiddenException) return false; throw error; };
    assert.equal(await guard.canActivate(executionContext(CompaniesController, 'list', req)).catch(refused), false, 'no companies list');
    assert.equal(await guard.canActivate(executionContext(DepartmentsController, 'list', req)).catch(refused), false, 'no departments list');

    // The Allocations tab's read, through the real guard and handler.
    assert.equal(await guard.canActivate(executionContext(controller, 'listAllocations', req)), true, `${kind}: a budget reader reads the split`);
    const handler = Object.assign(Object.create(controller.prototype), { allocations: allocations(kind) });
    const answer = await controller.prototype.listAllocations.call(handler, s.versionId, req);
    const rows = answer.items.map((item: any) => ({
      company_id: item.company_id, company_name: item.company_name, department_id: item.department_id, department_name: item.department_name, pct: Number(item.allocation_pct),
    })).sort((a: any, b: any) => b.pct - a.pct);
    assert.deepEqual(rows, [
      { company_id: s.north, company_name: `North ${kind}`, department_id: s.department, department_name: `Finance ${kind}`, pct: 60 },
      { company_id: s.south, company_name: `South ${kind}`, department_id: null, department_name: null, pct: 40 },
    ]);

    // Kad's card shows the same names for this person (no '—').
    const ai = new AiFinancialPlanMutationSupportService(undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any);
    const view = await (ai as any).splitView({ tenantId, userId: s.reader, manager: runner.manager }, answer.items, null);
    assert.deepEqual(view.rows, [{ label: `North ${kind} / Finance ${kind}`, pct: 60 }, { label: `South ${kind}`, pct: 40 }]);
  });
  console.log(`ok - ${kind}: a budget reader without the companies and departments lists reads the names a split carries`);
}

async function main() {
  await dataSource.initialize();
  const tenantId = await createRaceTenant('allocation-names');
  try {
    for (const kind of ['opex', 'capex'] as const) await allocationNames(tenantId, kind);
  } finally {
    await dropRaceTenant(tenantId);
    await dataSource.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
