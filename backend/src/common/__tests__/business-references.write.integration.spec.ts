import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NotFoundException } from '@nestjs/common';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { CompaniesController } from '../../companies/companies.controller';
import { CompaniesService } from '../../companies/companies.service';
import { CompaniesDeleteService } from '../../companies/companies-delete.service';
import { Company } from '../../companies/company.entity';
import { CompanyMetricsService } from '../../companies/company-metrics.service';
import { ContactsController } from '../../contacts/contacts.controller';
import { ContactsService } from '../../contacts/contacts.service';
import { DepartmentsController } from '../../departments/departments.controller';
import { DepartmentsService } from '../../departments/departments.service';
import { DepartmentsDeleteService } from '../../departments/departments-delete.service';
import { Department } from '../../departments/department.entity';
import { SuppliersController } from '../../suppliers/suppliers.controller';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { SuppliersDeleteService } from '../../suppliers/suppliers-delete.service';
import { Supplier } from '../../suppliers/supplier.entity';

// Lot R1 of 26.11.9: PATCH and DELETE of suppliers, companies, contacts and departments name the
// record by its reference (SUP-2, comp-2, CTCT-2) or its bare number, and write that record of the
// request's tenant only; the audit keeps the uuid; another tenant's number is a 404 that leaves its
// record untouched; a deleted number is not handed out again. Everything rolled back.
// @database-spec

async function seedTenant(runner: QueryRunner, tag: string): Promise<string> {
  const tenantId = randomUUID();
  await runner.query(
    `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
     VALUES ($1, $2, 'Business references write', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
    [tenantId, `bref-write-${tag}-${tenantId.slice(0, 8)}`],
  );
  await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
  return tenantId;
}

async function seed(runner: QueryRunner, tenantId: string, count: number) {
  const one = async (sql: string, params: unknown[]) => (await runner.query(`${sql} RETURNING id::text AS id`, params))[0].id as string;
  const out = { supplier: [] as string[], company: [] as string[], contact: [] as string[], department: [] as string[] };
  for (let i = 1; i <= count; i += 1) {
    out.supplier.push(await one(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, $2)`, [tenantId, `S${i}`]));
    out.company.push(await one(`INSERT INTO companies (tenant_id, name, country_iso, city) VALUES ($1, $2, 'FR', 'Lyon')`, [tenantId, `C${i}`]));
    out.contact.push(await one(`INSERT INTO contacts (tenant_id, email) VALUES ($1, $2)`, [tenantId, `p${i}-${tenantId.slice(0, 6)}@example.test`]));
    out.department.push(await one(`INSERT INTO departments (tenant_id, name, company_id) VALUES ($1, $2, $3)`, [tenantId, `D${i}`, out.company[0]]));
  }
  return out;
}

async function main() {
  await dataSource.initialize();
  const runner: QueryRunner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const away = await seedTenant(runner, 'away');
    const awayRows = await seed(runner, away, 3);
    const home = await seedTenant(runner, 'home');
    const homeRows = await seed(runner, home, 2);
    const manager = runner.manager;
    const audit = new AuditService(manager.getRepository(AuditLog));
    const metrics = new CompanyMetricsService(undefined as any, audit, { assertNotFrozen: async () => undefined } as any);
    const req = { queryRunner: { manager }, tenant: { id: home }, user: { sub: null } };
    const ctx = { manager, tenantId: home, userId: null } as any;
    const suppliers = new SuppliersController(new SuppliersService(undefined as any, audit), new SuppliersDeleteService(manager.getRepository(Supplier), audit), undefined as any);
    const companies = new CompaniesController(new CompaniesService(undefined as any, audit, metrics), new CompaniesDeleteService(manager.getRepository(Company), audit));
    const contacts = new ContactsController(new ContactsService(undefined as any, undefined as any, undefined as any, undefined as any, audit), undefined as any);
    const departments = new DepartmentsController(new DepartmentsService(undefined as any, undefined as any, audit), new DepartmentsDeleteService(manager.getRepository(Department), audit));

    const auditIds = async (table: string, action: string): Promise<string[]> => (await runner.query(
      `SELECT record_id::text AS id FROM audit_log WHERE tenant_id = $1 AND table_name = $2 AND action = $3`, [home, table, action],
    )).map((r: any) => r.id);
    const exists = async (table: string, id: string) => (await runner.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id])).length > 0;

    await suppliers.update('SUP-2', { name: 'S2 renamed' }, req);
    await companies.update('comp-2', { name: 'C2 renamed', country_iso: 'FR', city: 'Lyon' }, ctx);
    await contacts.update('CTCT-2', { email: `p2-${home.slice(0, 6)}@example.test`, first_name: 'Renamed' }, req);
    await departments.update('2', { name: 'D2 renamed', company_id: homeRows.company[0] }, ctx);
    const [names] = await runner.query(
      `SELECT (SELECT name FROM suppliers WHERE id = $1) s, (SELECT name FROM companies WHERE id = $2) c,
              (SELECT first_name FROM contacts WHERE id = $3) ct, (SELECT name FROM departments WHERE id = $4) d`,
      [homeRows.supplier[1], homeRows.company[1], homeRows.contact[1], homeRows.department[1]],
    );
    assert.deepEqual({ ...names }, { s: 'S2 renamed', c: 'C2 renamed', ct: 'Renamed', d: 'D2 renamed' });
    for (const [table, id] of [['suppliers', homeRows.supplier[1]], ['companies', homeRows.company[1]], ['contacts', homeRows.contact[1]], ['departments', homeRows.department[1]]]) {
      assert.ok((await auditIds(table, 'update')).includes(id), `${table} update audited on the uuid`);
    }
    console.log('  PATCH by SUP-2, comp-2, CTCT-2 and bare 2: right record, audit on the uuid: OK');

    await assert.rejects(suppliers.update('SUP-3', { name: 'hijack' }, req), NotFoundException);
    await assert.rejects(companies.delete('COMP-3', ctx), NotFoundException);
    await assert.rejects(contacts.update('CTCT-3', { email: 'hijack@example.test', first_name: 'Hijack' }, req), NotFoundException);
    await assert.rejects(departments.delete('3', ctx), NotFoundException);
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [away]);
    const [awaySup] = await runner.query(`SELECT name FROM suppliers WHERE id = $1`, [awayRows.supplier[2]]);
    assert.equal(awaySup.name, 'S3');
    assert.equal(await exists('companies', awayRows.company[2]), true);
    const [awayContact] = await runner.query(`SELECT first_name FROM contacts WHERE id = $1`, [awayRows.contact[2]]);
    assert.equal(awayContact.first_name, null);
    assert.equal(await exists('departments', awayRows.department[2]), true);
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [home]);
    console.log('  another tenant number: 404, its record untouched: OK');

    await suppliers.delete('SUP-2', req);
    await companies.delete('COMP-2', ctx);
    await contacts.remove('CTCT-2', req);
    await departments.delete('DEPT-2', ctx);
    for (const [table, id] of [['suppliers', homeRows.supplier[1]], ['companies', homeRows.company[1]], ['contacts', homeRows.contact[1]], ['departments', homeRows.department[1]]]) {
      assert.equal(await exists(table, id), false, `${table} deleted`);
      assert.ok((await auditIds(table, 'delete')).includes(id), `${table} delete audited on the uuid`);
    }
    assert.equal(await exists('suppliers', homeRows.supplier[0]), true, 'SUP-1 stays');
    const [next] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'S new') RETURNING item_number`, [home]);
    assert.equal(next.item_number, 3, 'a deleted number is not handed out again');
    console.log('  DELETE by reference: right record, audit on the uuid, number not reused: OK');
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
    await dataSource.destroy();
  }
  console.log('business-references.write.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
