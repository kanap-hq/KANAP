import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { SuppliersService } from '../suppliers.service';

// The suppliers file, beyond what the shared master-data layer promises
// (`master-data-csv-shared-layer.integration.spec.ts`):
//
//  - two rows with the same name, in any case, are refused at the check with
//    both row numbers and the name, instead of failing at the load;
//  - a contact e-mail that matches no contact refuses the row: the import
//    never creates an empty contact;
//  - the row errors carry a code the interface translates;
//  - the end of validity (`disabled_at`) goes out and comes back, and a file
//    written before the column existed still imports;
//  - the export lists the suppliers by name, whatever their case.
//
// Every case runs inside one transaction with its own tenant, rolled back at the end.

type Report = {
  ok: boolean;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  errors: Array<{ row: number; message: string; column?: string; code?: string; params?: Record<string, string | number> }>;
};

const HEADERS = ['name', 'erp_supplier_id', 'commercial_contact', 'technical_contact', 'support_contact', 'notes', 'status', 'disabled_at'];

function fileOf(rows: Array<Record<string, string>>, headers: readonly string[] = HEADERS): Express.Multer.File {
  const lines = [headers.join(','), ...rows.map((row) => headers.map((header) => row[header] ?? '').join(','))];
  return { buffer: Buffer.from(`${lines.join('\n')}\n`, 'utf8') } as Express.Multer.File;
}

async function withTenant(tag: string, fn: (runner: QueryRunner, tenantId: string, suppliers: SuppliersService) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Suppliers CSV test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `suppliers-csv-${tag}-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    const suppliers = new SuppliersService(undefined as any, new AuditService(runner.manager.getRepository(AuditLog)));
    await fn(runner, tenantId, suppliers);
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

function importer(runner: QueryRunner, suppliers: SuppliersService) {
  return (rows: Array<Record<string, string>>, dryRun: boolean, headers?: readonly string[]) =>
    suppliers.importCsv({ file: fileOf(rows, headers), dryRun, userId: null, language: 'en' }, { manager: runner.manager }) as Promise<Report>;
}

const supplierNames = async (runner: QueryRunner, tenantId: string) =>
  (await runner.query(`SELECT name FROM suppliers WHERE tenant_id = $1 ORDER BY name`, [tenantId])).map((row: any) => row.name);

/** Two rows with the same name, whatever the case, are refused at the check: the load used to fail on the unique index. */
async function testDuplicateNameInFile() {
  await withTenant('dup', async (runner, tenantId, suppliers) => {
    const run = importer(runner, suppliers);
    const rows = [
      { name: 'QA-Dup', erp_supplier_id: 'ERP-1' },
      { name: 'Other', erp_supplier_id: 'ERP-2' },
      { name: 'qa-dup', erp_supplier_id: 'ERP-3' },
    ];
    for (const dryRun of [true, false]) {
      const report = await run(rows, dryRun);
      assert.equal(report.ok, false, `dryRun=${dryRun}: refused`);
      assert.deepEqual(report.errors, [{
        row: 4,
        column: 'name',
        message: "'qa-dup' is already on row 2. Keep one row per supplier.",
        code: 'CSV_SUPPLIER_NAME_DUPLICATE',
        params: { name: 'qa-dup', firstRow: 2 },
      }]);
    }
    // Identical rows too: one row per supplier.
    const same = await run([{ name: 'Twin' }, { name: 'Twin' }], true);
    assert.equal(same.ok, false);
    assert.deepEqual(same.errors.map((error) => [error.row, error.code]), [[3, 'CSV_SUPPLIER_NAME_DUPLICATE']]);
    assert.deepEqual(await supplierNames(runner, tenantId), [], 'nothing is written');
  });
}

/** A contact e-mail must name an existing contact, for each of the three roles; none is ever created. */
async function testUnknownContactRefused() {
  await withTenant('contact', async (runner, tenantId, suppliers) => {
    const run = importer(runner, suppliers);
    await runner.query(`INSERT INTO contacts (tenant_id, email, first_name, last_name) VALUES ($1, 'known@example.com', 'Kim', 'Known')`, [tenantId]);
    const contacts = async () => Number((await runner.query(`SELECT count(*)::int AS n FROM contacts WHERE tenant_id = $1`, [tenantId]))[0].n);

    for (const column of ['commercial_contact', 'technical_contact', 'support_contact']) {
      for (const dryRun of [true, false]) {
        const report = await run([
          { name: 'Linked', commercial_contact: 'Known@Example.com' },
          { name: 'Orphan', [column]: 'Nobody@Example.com' },
        ], dryRun);
        assert.equal(report.ok, false, `${column} dryRun=${dryRun}: refused`);
        assert.deepEqual(report.errors, [{
          row: 3,
          column,
          message: 'Contact not found: nobody@example.com. Create it in Contacts first.',
          code: 'CSV_CONTACT_NOT_FOUND',
          params: { email: 'nobody@example.com' },
        }], column);
      }
    }
    assert.equal(await contacts(), 1, 'no contact is created');
    assert.deepEqual(await supplierNames(runner, tenantId), [], 'no supplier is written');

    const loaded = await run([{ name: 'Linked', commercial_contact: 'Known@Example.com', support_contact: 'known@example.com' }], false);
    assert.deepEqual([loaded.ok, loaded.errors], [true, []]);
    const links = await runner.query(
      `SELECT sc.role::text AS role, c.email FROM supplier_contacts sc JOIN contacts c ON c.id = sc.contact_id
        WHERE sc.tenant_id = $1 ORDER BY sc.role`,
      [tenantId],
    );
    assert.deepEqual(links.map((link: any) => [link.role, link.email]), [['commercial', 'known@example.com'], ['support', 'known@example.com']]);
    assert.equal(await contacts(), 1, 'the known contact is linked, not copied');
  });
}

/** The row errors carry the code the interface translates; the English message stays for API clients. */
async function testRowErrorsCarryCodes() {
  await withTenant('codes', async (runner, _tenantId, suppliers) => {
    const report = await importer(runner, suppliers)([
      { name: '', notes: 'A row with no name' },
      { name: 'Status', status: 'actif' },
      { name: 'Mail', technical_contact: 'not-an-email' },
      { name: 'Date', disabled_at: 'soon' },
    ], true);
    assert.equal(report.ok, false);
    assert.deepEqual(report.errors, [
      { row: 2, column: 'name', message: 'Name is required', code: 'CSV_VALUE_REQUIRED' },
      {
        row: 3, column: 'status', message: "Invalid status 'actif'. Use 'enabled' or 'disabled'.",
        code: 'CSV_ENUM_INVALID', params: { value: 'actif', allowed: 'enabled, disabled' },
      },
      {
        row: 4, column: 'technical_contact', message: 'Invalid technical_contact email',
        code: 'CSV_EMAIL_INVALID', params: { value: 'not-an-email' },
      },
      {
        row: 5, column: 'disabled_at', message: "Invalid disabled_at 'soon'. Use a date such as 2027-12-31 or 31/12/2027.",
        code: 'CSV_DATE_INVALID', params: { value: 'soon' },
      },
    ]);
  });
}

/** The end of validity goes out and comes back; a file without the column still imports. */
async function testDisabledAtRoundTrip() {
  await withTenant('disabled-at', async (runner, tenantId, suppliers) => {
    const run = importer(runner, suppliers);
    const opts = { manager: runner.manager };
    await suppliers.create({ name: 'Ended', disabled_at: new Date('2025-06-30T12:00:00.000Z') } as any, undefined, opts);
    await suppliers.create({ name: 'Scheduled', disabled_at: new Date('2031-12-31T12:00:00.000Z') } as any, undefined, opts);
    await suppliers.create({ name: 'Open' } as any, undefined, opts);
    const stored = async (): Promise<Array<[string, string, string | null]>> => (await runner.query(
      `SELECT name, status::text AS status, disabled_at FROM suppliers WHERE tenant_id = $1 ORDER BY name`,
      [tenantId],
    )).map((row: any) => [row.name, row.status, row.disabled_at ? new Date(row.disabled_at).toISOString() : null]);
    const before = await stored();
    assert.deepEqual(before, [
      ['Ended', 'disabled', '2025-06-30T12:00:00.000Z'],
      ['Open', 'enabled', null],
      ['Scheduled', 'enabled', '2031-12-31T12:00:00.000Z'],
    ]);

    const exported = (await suppliers.exportCsv('data', { manager: runner.manager, language: 'en' })).content.replace(/^﻿/, '');
    const lines = exported.trim().split(/\r?\n/);
    assert.deepEqual(lines[0].split(','), HEADERS, 'disabled_at follows status');
    assert.ok(lines.includes('Ended,,,,,,disabled,2025-06-30'), exported);
    assert.ok(lines.includes('Scheduled,,,,,,enabled,2031-12-31'), exported);

    const again = await suppliers.importCsv(
      { file: { buffer: Buffer.from(exported, 'utf8') } as Express.Multer.File, dryRun: true, userId: null, language: 'en' },
      { manager: runner.manager },
    ) as Report;
    assert.deepEqual([again.ok, again.inserted, again.updated, again.unchanged], [true, 0, 0, 3], JSON.stringify(again.errors));

    // Into an empty register: the dates come back as they were.
    await runner.query(`DELETE FROM suppliers WHERE tenant_id = $1`, [tenantId]);
    const restored = await suppliers.importCsv(
      { file: { buffer: Buffer.from(exported, 'utf8') } as Express.Multer.File, dryRun: false, userId: null, language: 'en' },
      { manager: runner.manager },
    ) as Report;
    assert.deepEqual([restored.ok, restored.errors], [true, []]);
    assert.deepEqual(await stored(), before);

    // A status that contradicts the date is refused; a file without the column still imports.
    const conflict = await run([{ name: 'Ended', status: 'enabled', disabled_at: '2025-06-30' }], true);
    assert.equal(conflict.ok, false);
    assert.equal(conflict.errors[0].code, 'CSV_STATUS_DATE_PASSED');
    const legacy = await run([{ name: 'Legacy', status: 'disabled' }], false, HEADERS.filter((header) => header !== 'disabled_at'));
    assert.deepEqual([legacy.ok, legacy.errors], [true, []]);
    assert.equal((await stored()).find(([name]) => name === 'Legacy')?.[1], 'disabled');
  });
}

/** The export lists the suppliers by name, whatever their case, not by creation date. */
async function testExportSortedByName() {
  await withTenant('sort', async (runner, _tenantId, suppliers) => {
    for (const name of ['beta', 'Alpha', 'charlie', 'Bravo']) {
      await suppliers.create({ name } as any, undefined, { manager: runner.manager });
    }
    const exported = (await suppliers.exportCsv('data', { manager: runner.manager, language: 'en' })).content.replace(/^﻿/, '');
    const names = exported.trim().split(/\r?\n/).slice(1).map((line) => line.split(',')[0]);
    assert.deepEqual(names, ['Alpha', 'beta', 'Bravo', 'charlie']);
  });
}

async function main() {
  await dataSource.initialize();
  let failed = 0;
  const tests: Array<[string, () => Promise<void>]> = [
    ['testDuplicateNameInFile', testDuplicateNameInFile],
    ['testUnknownContactRefused', testUnknownContactRefused],
    ['testRowErrorsCarryCodes', testRowErrorsCarryCodes],
    ['testDisabledAtRoundTrip', testDisabledAtRoundTrip],
    ['testExportSortedByName', testExportSortedByName],
  ];
  try {
    for (const [name, test] of tests) {
      try {
        await test();
        console.log(`ok - ${name}`);
      } catch (err) {
        failed += 1;
        console.error(`not ok - ${name}`);
        console.error(err);
      }
    }
  } finally {
    await dataSource.destroy();
  }
  if (failed > 0) {
    console.error(`suppliers-csv.integration.spec: ${failed} failed`);
    process.exit(1);
  }
  console.log('suppliers-csv.integration.spec: ok');
}

void main();
