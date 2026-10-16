import 'dotenv/config';
// @database-spec: opens the data-source through runSpecs, so it runs on a database lane.
import { ConflictException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import { BusinessProcessesService } from '../../business-processes/business-processes.service';
import { BusinessProcess } from '../../business-processes/business-process.entity';
import { LocationsService } from '../../locations/locations.service';
import { Location } from '../../locations/location.entity';
import { DepartmentsService } from '../../departments/departments.service';
import { Department } from '../../departments/department.entity';
import { Company } from '../../companies/company.entity';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedTenant,
  underSavepoint,
} from '../../spend/__tests__/round-inputs.fixtures';

// A name another record already has (whatever its case) is refused with the
// answer of the database's unique key, 409 `duplicate`, so the pages can show
// it under the name field: business processes, locations, sub-locations of a
// location and departments of a company, on create and on rename. A change of
// case of the record's own name is allowed.

async function expectDuplicate(fn: () => Promise<unknown>) {
  let caught: unknown = null;
  try {
    await fn();
  } catch (err) {
    caught = err;
  }
  assert.ok(caught instanceof ConflictException, `expected a 409, got ${String(caught)}`);
  const body = (caught as ConflictException).getResponse() as { code?: string };
  assert.strictEqual(body.code, 'duplicate');
}

async function one(runner: QueryRunner, sql: string, params: unknown[]): Promise<string> {
  const [row] = await runner.query(sql, params);
  return row.id as string;
}

void runSpecs('duplicate name refusals', [
  ['business processes: create and rename refuse a name in any case', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = new BusinessProcessesService(
        runner.manager.getRepository(BusinessProcess), undefined as any, undefined as any, undefined as any, captureAudit() as any,
      );
      const tenantId = await seedTenant(runner, 'bp-duplicate');
      await one(runner, `INSERT INTO business_processes (tenant_id, name) VALUES ($1, 'Order to cash') RETURNING id`, [tenantId]);
      const other = await one(runner, `INSERT INTO business_processes (tenant_id, name) VALUES ($1, 'Procure to pay') RETURNING id`, [tenantId]);
      const opts = { manager: runner.manager };
      await underSavepoint(runner, () => expectDuplicate(() => svc.create({ name: 'order TO cash' } as any, null, opts)));
      await underSavepoint(runner, () => expectDuplicate(() => svc.update(other, { name: 'ORDER TO CASH' } as any, null, opts)));
    });
  }],
  ['locations: create and rename refuse a name in any case', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = new LocationsService(runner.manager.getRepository(Location), captureAudit() as any, undefined as any, undefined as any);
      const tenantId = await seedTenant(runner, 'location-duplicate');
      await one(runner, `INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, 'Paris DC', 'on_prem', 'LOC-1') RETURNING id`, [tenantId]);
      const other = await one(runner, `INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, 'Lyon DC', 'on_prem', 'LOC-2') RETURNING id`, [tenantId]);
      const opts = { manager: runner.manager };
      await underSavepoint(runner, () => expectDuplicate(() => svc.create({ name: 'paris dc' }, tenantId, null, opts)));
      await underSavepoint(runner, () => expectDuplicate(() => svc.update(other, { name: 'PARIS DC' }, tenantId, null, opts)));
    });
  }],
  ['sub-locations: create and rename refuse a name the location already has in any case', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = new LocationsService(runner.manager.getRepository(Location), captureAudit() as any, undefined as any, undefined as any);
      const tenantId = await seedTenant(runner, 'sublocation-duplicate');
      const location = await one(runner, `INSERT INTO locations (tenant_id, name, hosting_type, location_reference) VALUES ($1, 'Paris DC', 'on_prem', 'LOC-1') RETURNING id`, [tenantId]);
      await one(runner, `INSERT INTO location_sub_items (tenant_id, location_id, name) VALUES ($1, $2, 'Room A') RETURNING id`, [tenantId, location]);
      const other = await one(runner, `INSERT INTO location_sub_items (tenant_id, location_id, name) VALUES ($1, $2, 'Room B') RETURNING id`, [tenantId, location]);
      const opts = { manager: runner.manager };
      await underSavepoint(runner, () => expectDuplicate(() => svc.createSubItem(location, { name: 'room a' }, tenantId, null, opts)));
      await underSavepoint(runner, () => expectDuplicate(() => svc.updateSubItem(location, other, { name: 'ROOM A' }, tenantId, null, opts)));
    });
  }],
  ['departments: create and rename refuse a name the company already has in any case', async () => {
    await inRolledBackTransaction(async (runner) => {
      const svc = new DepartmentsService(
        runner.manager.getRepository(Department), runner.manager.getRepository(Company), captureAudit() as any,
      );
      const tenantId = await seedTenant(runner, 'department-duplicate');
      const company = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Acme', 'FR', 'Lyon') RETURNING id`, [tenantId]);
      const elsewhere = await one(runner, `INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, 'Globex', 'FR', 'Lyon') RETURNING id`, [tenantId]);
      const finance = await svc.create({ company_id: company, name: 'Finance' }, undefined, { manager: runner.manager });
      const other = await svc.create({ company_id: company, name: 'Sales' }, undefined, { manager: runner.manager });
      const opts = { manager: runner.manager };
      await underSavepoint(runner, () => expectDuplicate(() => svc.create({ company_id: company, name: 'FINANCE' }, undefined, opts)));
      await underSavepoint(runner, () => expectDuplicate(() => svc.update(other.id, { name: 'finance' }, undefined, opts)));
      // Another company may have a Finance department, and a change of case of its own name is allowed.
      await svc.create({ company_id: elsewhere, name: 'finance' }, undefined, opts);
      await svc.update(finance.id, { name: 'FINANCE' }, undefined, opts);
    });
  }],
]);
