import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { CompaniesController } from '../../companies/companies.controller';
import { CompaniesService } from '../../companies/companies.service';
import { CompanyMetricsService } from '../../companies/company-metrics.service';
import { ContactsController } from '../../contacts/contacts.controller';
import { ContactsService } from '../../contacts/contacts.service';
import { DepartmentsController } from '../../departments/departments.controller';
import { DepartmentsService } from '../../departments/departments.service';
import { SuppliersController } from '../../suppliers/suppliers.controller';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { resolveToUuid } from '../resolve-item-id';

// Lot R1 of 26.11.9: the record routes of suppliers, companies, contacts and departments read a
// record by its reference (SUP-3, COMP-1, CTCT-2, DEPT-4), its bare number or its uuid, in the
// request's tenant only, and hand back `item_number`. Contracts are read over HTTP under data
// access in `data-access-contract-routes-http.spec.ts`; here only their tenant boundary.
// @database-spec

type Family = 'supplier' | 'company' | 'contact' | 'department' | 'contract';
const PREFIX: Record<Family, string> = { supplier: 'SUP', company: 'COMP', contact: 'CTCT', department: 'DEPT', contract: 'CTR' };

async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Business references read', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `bref-read-${tag}-${tenantId.slice(0, 8)}`],
  );
  return tenantId;
}

async function asTenant(runner: QueryRunner, tenantId: string) {
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
}

/** `count` records of each family, numbered 1..count by the database. */
async function seedFamilies(runner: QueryRunner, tenantId: string, count: number): Promise<Record<Family, string[]>> {
  await asTenant(runner, tenantId);
  const one = async (sql: string, params: unknown[]) => (await runner.query(`${sql} RETURNING id::text AS id`, params))[0].id as string;
  const out: Record<Family, string[]> = { supplier: [], company: [], contact: [], department: [], contract: [] };
  for (let i = 1; i <= count; i += 1) {
    out.supplier.push(await one(`INSERT INTO suppliers (tenant_id, name, erp_supplier_id) VALUES ($1, $2, $3)`, [tenantId, `Supplier ${i}`, `F1000${i}`]));
    out.company.push(await one(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon')`, [tenantId, `Company ${i}`]));
    out.contact.push(await one(`INSERT INTO contacts (tenant_id, email) VALUES ($1, $2)`, [tenantId, `person${i}-${tenantId.slice(0, 6)}@example.test`]));
    out.department.push(await one(`INSERT INTO departments (tenant_id, name, company_id) VALUES ($1, $2, $3)`, [tenantId, `Department ${i}`, out.company[0]]));
    out.contract.push(await one(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date) VALUES ($1, $2, $3, $4, '2026-01-01')`,
      [tenantId, `Contract ${i}`, out.company[0], out.supplier[0]],
    ));
  }
  return out;
}

function controllers(runner: QueryRunner, tenantId: string) {
  const manager = runner.manager;
  const audit = new AuditService(manager.getRepository(AuditLog));
  const metrics = new CompanyMetricsService(undefined as any, audit, { assertNotFrozen: async () => undefined } as any);
  const req = { queryRunner: { manager }, tenant: { id: tenantId }, user: { sub: null } };
  const ctx = { manager, tenantId, userId: null } as any;
  const suppliers = new SuppliersController(new SuppliersService(undefined as any, audit), undefined as any, undefined as any);
  const companies = new CompaniesController(new CompaniesService(undefined as any, audit, metrics), undefined as any);
  const contacts = new ContactsController(new ContactsService(undefined as any, undefined as any, undefined as any, undefined as any, audit), undefined as any);
  const departments = new DepartmentsController(new DepartmentsService(undefined as any, undefined as any, audit), undefined as any);
  return {
    supplier: (id: string) => suppliers.get(id, req),
    company: (id: string) => companies.get(id, ctx),
    contact: (id: string) => contacts.get(id, req),
    department: (id: string) => departments.get(id, ctx),
  } as Record<Exclude<Family, 'contract'>, (id: string) => Promise<any>>;
}

async function main() {
  await dataSource.initialize();
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    // The other tenant first, with one more record of each family: its n° 3 has no twin in `home`.
    const away = await seedTenant(runner, 'away');
    const awayRows = await seedFamilies(runner, away, 3);
    const home = await seedTenant(runner, 'home');
    const homeRows = await seedFamilies(runner, home, 2);
    await asTenant(runner, home);
    const read = controllers(runner, home);

    for (const family of ['supplier', 'company', 'contact', 'department'] as const) {
      const prefix = PREFIX[family];
      for (const [value, expected] of [
        [`${prefix}-2`, homeRows[family][1]],
        [`${prefix.toLowerCase()}-1`, homeRows[family][0]],
        ['2', homeRows[family][1]],
        [homeRows[family][0], homeRows[family][0]],
      ] as const) {
        const record = await read[family](value);
        assert.equal(record.id, expected, `${family} ${value}: the record of the request's tenant`);
        assert.equal(record.item_number, expected === homeRows[family][0] ? 1 : 2, `${family} ${value}: the record carries item_number`);
      }
      await assert.rejects(read[family](`${prefix}-3`), NotFoundException, `${family}: another tenant's number names nothing here`);
      await assert.rejects(read[family](awayRows[family][2]), NotFoundException, `${family}: another tenant's uuid is not read`);
      const other = family === 'supplier' ? 'COMP-1' : 'SUP-1';
      await assert.rejects(read[family](other), BadRequestException, `${family}: another family's reference is refused`);
      console.log(`  ${family}: ${prefix}-n, the bare number and the uuid read the record; another tenant's names nothing: OK`);
    }

    // Contracts: the tenant boundary of the resolution (the data access boundary is an HTTP spec).
    assert.equal(await resolveToUuid('CTR-2', 'contract', runner.manager), homeRows.contract[1]);
    await assert.rejects(resolveToUuid('CTR-3', 'contract', runner.manager), NotFoundException);
    // CTR-n is a contract: the contributors routes alone still read it (as MEM-n, `alsoAccept`).
    await assert.rejects(resolveToUuid('CTR-2', 'contributor', runner.manager), BadRequestException);
    console.log('  contract: CTR-n in the request tenant only; CTR is no contributor reference outside its routes: OK');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
  console.log('business-references.read.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
