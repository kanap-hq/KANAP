import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { EntityManager, QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { CompaniesService } from '../../companies/companies.service';
import { CompanyMetricsService } from '../../companies/company-metrics.service';
import { ContactsService } from '../../contacts/contacts.service';
import { ContractsService } from '../../contracts/contracts.service';
import { DepartmentsService } from '../../departments/departments.service';
import { SuppliersService } from '../../suppliers/suppliers.service';
import { AiMasterDataMutationSupportService } from '../../ai/mutation/ai-master-data-mutation-support.service';
import { CONTRACT_CSV_HEADERS } from '../../contracts/contract-csv-headers';

// Business references (SUP-n, COMP-n, CTCT-n, DEPT-n, CTR-n; migration 1856240000000) on every
// creation path: the service of each family, the CSV import of each family and Kad hand back the
// number the database set, the audit "create" entry carries it, numbers follow each other per
// tenant; two creations at the same time in one tenant get two numbers.
// @database-spec

type Services = ReturnType<typeof services>;

function services(manager: EntityManager) {
  const audit = new AuditService(manager.getRepository(AuditLog));
  const metrics = new CompanyMetricsService(undefined as any, audit, { assertNotFrozen: async () => undefined } as any);
  const contractArgs: any[] = Array.from({ length: 10 }, () => undefined);
  contractArgs[4] = audit;
  contractArgs[7] = { syncFromSupplier: async () => undefined };
  const suppliers = new SuppliersService(undefined as any, audit);
  return {
    companies: new CompaniesService(undefined as any, audit, metrics),
    suppliers,
    contacts: new ContactsService(undefined as any, undefined as any, undefined as any, undefined as any, audit),
    departments: new DepartmentsService(undefined as any, undefined as any, audit),
    contracts: new (ContractsService as any)(...contractArgs) as ContractsService,
    // Kad's creations of master data go through the same services.
    kad: new (AiMasterDataMutationSupportService as any)(
      undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, suppliers, undefined,
    ) as AiMasterDataMutationSupportService,
  };
}

async function inTenant(tag: string, fn: (runner: QueryRunner, tenantId: string, svc: Services) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Business references', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `bref-${tag}-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await fn(runner, tenantId, services(runner.manager));
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function auditedNumber(runner: QueryRunner, table: string, recordId: string): Promise<number | undefined> {
  const [row] = await runner.query(
    `SELECT after_json FROM audit_log WHERE table_name = $1 AND record_id = $2 AND action = 'create'`,
    [table, recordId],
  );
  return row?.after_json?.item_number;
}

async function numbers(runner: QueryRunner, table: string, tenantId: string): Promise<Array<[string, number]>> {
  const rows = await runner.query(
    `SELECT ${table === 'contacts' ? 'email' : 'name'} AS key, item_number FROM ${table} WHERE tenant_id = $1 ORDER BY item_number`,
    [tenantId],
  );
  return rows.map((row: { key: string; item_number: number }) => [row.key, row.item_number]);
}

/** Each service hands back the number of the record it created, and its audit entry carries it. */
async function testServicesHandBackTheNumber() {
  await inTenant('svc', async (runner, tenantId, svc) => {
    const manager = runner.manager;
    const company: any = await svc.companies.create({ name: 'Acme', country_iso: 'FR', city: 'Lyon' } as any, undefined, { manager });
    assert.equal(company.item_number, 1, 'COMP-1');
    assert.equal(await auditedNumber(runner, 'companies', company.id), 1);
    const supplier: any = await svc.suppliers.create({ name: 'Dell' } as any, undefined, { manager });
    assert.equal(supplier.item_number, 1, 'SUP-1');
    assert.equal(await auditedNumber(runner, 'suppliers', supplier.id), 1);
    const contact: any = await svc.contacts.create({ email: 'jane@example.test', first_name: 'Jane' } as any, { manager, tenantId, userId: null });
    assert.equal(contact.item_number, 1, 'CTCT-1');
    assert.equal(await auditedNumber(runner, 'contacts', contact.id), 1);
    const department: any = await svc.departments.create({ name: 'Finance', company_id: company.id } as any, undefined, { manager });
    assert.equal(department.item_number, 1, 'DEPT-1');
    assert.equal(await auditedNumber(runner, 'departments', department.id), 1);
    const contract: any = await svc.contracts.create({
      name: 'Support', company_id: company.id, supplier_id: supplier.id, start_date: '2026-01-01',
    } as any, undefined, { manager });
    assert.equal(contract.item_number, 1, 'CTR-1');
    assert.equal(await auditedNumber(runner, 'contracts', contract.id), 1);

    const second: any = await svc.suppliers.create({ name: 'HP' } as any, undefined, { manager });
    assert.equal(second.item_number, 2, 'SUP-2 follows');
    // A number sent with the body is not written: the database sets it.
    const sent: any = await svc.suppliers.create({ name: 'Lenovo', item_number: 99 } as any, undefined, { manager });
    assert.equal(sent.item_number, 3);
    // An update leaves the number.
    const updated: any = await svc.suppliers.update(second.id, { name: 'HP Inc', item_number: 50 } as any, undefined, { manager });
    const [stored] = await runner.query(`SELECT item_number FROM suppliers WHERE id = $1`, [second.id]);
    assert.equal(stored.item_number, 2, 'an update never writes the number');
    assert.equal(updated.name, 'HP Inc');

    // Kad creates a supplier through the same service.
    const kadSupplier: any = await (svc.kad as any).createRecord(
      { manager, tenantId, userId: null }, 'suppliers', { name: 'Kad supplier' }, { source: 'ai' },
    );
    assert.equal(kadSupplier.item_number, 4, 'Kad hands back SUP-4');
  });
}

/** The CSV import of each family numbers the rows it creates after the stored ones. */
async function testCsvImportsNumberCreations() {
  await inTenant('csv', async (runner, tenantId, svc) => {
    const manager = runner.manager;
    const upload = (lines: string[]) => ({ buffer: Buffer.from(`${lines.join('\n')}\n`, 'utf8') }) as Express.Multer.File;
    const headersOf = (content: string) => content.replace(/^﻿/, '').split('\n')[0].split(',');
    // Cells by technical column; a template that writes titles gives them through `titles`.
    const fileOf = (headers: string[], rows: Array<Record<string, string>>, titles: Record<string, { en: string }> = {}) => {
      const columnOf = (header: string) => Object.keys(titles).find((column) => titles[column].en === header) ?? header;
      return upload([headers.join(';'), ...rows.map((row) => headers.map((h) => row[columnOf(h)] ?? '').join(';'))]);
    };
    const ok = (result: any, label: string) => assert.equal(result.ok, true, `${label}: ${JSON.stringify(result.errors)}`);

    await svc.companies.create({ name: 'Stored company', country_iso: 'FR', city: 'Lyon' } as any, undefined, { manager });
    const companyHeaders = headersOf((await svc.companies.exportCsv('template', { manager })).content);
    ok(await svc.companies.importCsv({
      file: fileOf(companyHeaders, [
        { name: 'Imported A', country_iso: 'FR', city: 'Paris', base_currency: 'EUR' },
        { name: 'Imported B', country_iso: 'DE', city: 'Berlin', base_currency: 'EUR' },
      ]),
      dryRun: false, userId: null,
    } as any, { manager }), 'companies');
    assert.deepEqual(await numbers(runner, 'companies', tenantId), [['Stored company', 1], ['Imported A', 2], ['Imported B', 3]]);

    const supplierHeaders = headersOf((await svc.suppliers.exportCsv('template', { manager })).content);
    const supplierResult = await svc.suppliers.importCsv({
      file: fileOf(supplierHeaders, [{ Name: 'Supplier A' }, { Name: 'Supplier B' }]), dryRun: false, userId: null,
    } as any, { manager });
    ok(supplierResult, 'suppliers');
    assert.deepEqual(await numbers(runner, 'suppliers', tenantId), [['Supplier A', 1], ['Supplier B', 2]]);

    const contactHeaders = headersOf((await svc.contacts.exportCsv('template', { manager, tenantId } as any)).content);
    ok(await svc.contacts.importCsv({
      file: fileOf(contactHeaders, [{ email: 'a@example.test' }, { email: 'b@example.test' }]), dryRun: false,
    } as any, { manager, tenantId } as any), 'contacts');
    assert.deepEqual(await numbers(runner, 'contacts', tenantId), [['a@example.test', 1], ['b@example.test', 2]]);

    const departmentHeaders = headersOf((await svc.departments.exportCsv('template', { manager })).content);
    ok(await svc.departments.importCsv({
      file: fileOf(departmentHeaders, [{ company_name: 'Imported A', name: 'Dept A' }, { company_name: 'Imported B', name: 'Dept B' }]),
      dryRun: false, userId: null,
    } as any, { manager }), 'departments');
    assert.deepEqual(await numbers(runner, 'departments', tenantId), [['Dept A', 1], ['Dept B', 2]]);

    const contractHeaders = headersOf((await svc.contracts.exportCsv('template', { manager } as any)).content);
    const contract = (name: string) => ({
      name, company_name: 'Imported A', supplier_name: 'Supplier A', start_date: '2026-01-15', duration_months: '12',
      auto_renewal: 'yes', notice_period_months: '1', yearly_amount_at_signature: '1200', currency: 'EUR', billing_frequency: 'annual',
    });
    ok(await svc.contracts.importCsv({
      file: fileOf(contractHeaders, [contract('Contract A'), contract('Contract B')], CONTRACT_CSV_HEADERS), dryRun: false, userId: null,
    } as any, { manager } as any), 'contracts');
    assert.deepEqual(await numbers(runner, 'contracts', tenantId), [['Contract A', 1], ['Contract B', 2]]);
  });
}

/** Two transactions create a supplier in the same tenant at the same time: two numbers, no error. */
async function testConcurrentCreations() {
  const tenantId = randomUUID();
  const setup = dataSource.createQueryRunner();
  await setup.connect();
  const first = dataSource.createQueryRunner();
  const second = dataSource.createQueryRunner();
  await first.connect();
  await second.connect();
  try {
    await setup.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Business references race', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `bref-race-${tenantId.slice(0, 8)}`],
    );
    for (const runner of [first, second]) {
      await runner.startTransaction();
      await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    }
    const [a] = await first.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Race A') RETURNING item_number`, [tenantId]);
    // The second waits on the counter row the first holds until it commits.
    const pending = second.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Race B') RETURNING item_number`, [tenantId]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await first.commitTransaction();
    const [b] = await pending;
    await second.commitTransaction();
    assert.deepEqual([a.item_number, b.item_number].sort(), [1, 2]);
  } finally {
    for (const runner of [first, second]) {
      if (runner.isTransactionActive) await runner.rollbackTransaction();
      await runner.release();
    }
    await setup.startTransaction();
    await setup.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    await setup.query(`DELETE FROM suppliers WHERE tenant_id = $1`, [tenantId]);
    await setup.query(`DELETE FROM item_sequences WHERE tenant_id = $1`, [tenantId]);
    await setup.query(`DELETE FROM search_index WHERE tenant_id = $1`, [tenantId]);
    await setup.query(`DELETE FROM tenants WHERE id = $1`, [tenantId]);
    await setup.commitTransaction();
    await setup.release();
  }
}

async function main() {
  await dataSource.initialize();
  const failures: string[] = [];
  try {
    for (const test of [testServicesHandBackTheNumber, testCsvImportsNumberCreations, testConcurrentCreations]) {
      try {
        await test();
        console.log(`  ok ${test.name}`);
      } catch (err) {
        failures.push(`${test.name}: ${(err as Error).message.split('\n').slice(0, 12).join(' | ')}`);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failures.length) {
    throw new Error(`business-references.creation.integration.spec: ${failures.length} failing\n  ${failures.join('\n  ')}`);
  }
  console.log('business-references.creation.integration.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
