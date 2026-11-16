import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { adaptFilters } from '../../ai/query/ai-filter.adapter';
import { resolveAiQuerySort } from '../../ai/query/ai-query.executor';
import { contactsRegistry } from '../../ai/query/registries/contacts.registry';
import { ContactsService } from '../contacts.service';
import { ExternalContact } from '../external-contact.entity';
import { SupplierContactLink } from '../supplier-contact.entity';
import { Supplier } from '../../suppliers/supplier.entity';

// The contact's reference (`CTCT-12`) out of its page (lot R3):
//
//  - the list's reference column filters on the number, with or without the prefix; `CTCT-013` is
//    text, which no reference is written as; the column sorts by number;
//  - the quick search finds `CTCT-3` exactly, besides the text search;
//  - the assistant filters and sorts on `reference`;
//  - the file: a `reference` column first; filled, it names the contact a row updates, its e-mail
//    included; an unknown one refuses the row; a file without it still imports.
//
// Every case runs inside one transaction with its own tenant, rolled back at the end.

type Report = {
  ok: boolean;
  inserted: number;
  updated: number;
  unchanged?: number;
  errors: Array<{ row: number; message: string; column?: string; code?: string; params?: Record<string, string | number> }>;
  warnings?: Array<{ row: number; message: string; column?: string; code?: string; params?: Record<string, string | number> }>;
};

const HEADERS = ['reference', 'first_name', 'last_name', 'job_title', 'email', 'phone', 'mobile', 'country', 'notes', 'active'];

function fileOf(rows: Array<Record<string, string>>, headers: readonly string[] = HEADERS): Express.Multer.File {
  const lines = [headers.join(';'), ...rows.map((row) => headers.map((header) => row[header] ?? '').join(';'))];
  return { buffer: Buffer.from(`${lines.join('\n')}\n`, 'utf8'), originalname: 'contacts.csv' } as Express.Multer.File;
}

type Ctx = { runner: QueryRunner; tenantId: string; contacts: ContactsService };

/** A tenant with the contacts `c01@example.test` to `c13@example.test`, numbered CTCT-1 to CTCT-13; CTCT-5's last name is `CTCT-001`. */
async function withTenant(tag: string, fn: (ctx: Ctx) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Contact references test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `contacts-ref-${tag}-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    for (let n = 1; n <= 13; n += 1) {
      const two = String(n).padStart(2, '0');
      await runner.query(
        `INSERT INTO contacts (tenant_id, email, first_name, last_name, active) VALUES ($1, $2, $3, $4, true)`,
        [tenantId, `c${two}@example.test`, `First ${two}`, n === 5 ? 'CTCT-001' : `Last ${two}`],
      );
    }
    const manager = runner.manager;
    const contacts = new ContactsService(
      manager.getRepository(ExternalContact),
      manager.getRepository(SupplierContactLink),
      manager.getRepository(Supplier),
      undefined as any,
      undefined as any,
    );
    await fn({ runner, tenantId, contacts });
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

async function listNumbers(ctx: Ctx, query: Record<string, unknown>) {
  const result = await ctx.contacts.list({ sort: 'item_number:ASC', ...query }, { manager: ctx.runner.manager, tenantId: ctx.tenantId });
  return result.items.map((item: any) => item.item_number);
}

async function idNumbers(ctx: Ctx, query: Record<string, unknown>) {
  const result = await ctx.contacts.listIds({ sort: 'item_number:ASC', ...query }, { manager: ctx.runner.manager, tenantId: ctx.tenantId });
  const rows: Array<{ id: string; item_number: number }> = await ctx.runner.query(
    `SELECT id, item_number FROM contacts WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [ctx.tenantId, result.ids],
  );
  const numberById = new Map(rows.map((row) => [row.id, Number(row.item_number)]));
  return result.ids.map((id) => numberById.get(id));
}

const textFilter = (type: string, filter: string) => JSON.stringify({ item_number: { filterType: 'text', type, filter } });

/** The reference column: `CTCT-3` and `3` find CTCT-3; `CTCT-013` finds nothing; it sorts by number. */
async function testReferenceColumnFilter() {
  await withTenant('filter', async (ctx) => {
    for (const read of [listNumbers, idNumbers]) {
      assert.deepEqual(await read(ctx, { filters: textFilter('equals', 'CTCT-3') }), [3], `${read.name}: CTCT-3`);
      assert.deepEqual(await read(ctx, { filters: textFilter('equals', 'ctct-3') }), [3], `${read.name}: ctct-3`);
      assert.deepEqual(await read(ctx, { filters: textFilter('equals', '3') }), [3], `${read.name}: 3`);
      assert.deepEqual(await read(ctx, { filters: textFilter('contains', 'CTCT-3') }), [3, 13], `${read.name}: contains`);
      assert.deepEqual(await read(ctx, { filters: textFilter('equals', 'CTCT-013') }), [], `${read.name}: CTCT-013 is text`);
    }
    const sorted = await ctx.contacts.list({ sort: 'item_number:DESC', limit: 3 }, { manager: ctx.runner.manager, tenantId: ctx.tenantId });
    assert.deepEqual(sorted.items.map((item: any) => item.item_number), [13, 12, 11]);
    assert.equal(sorted.total, 13);
  });
}

/** The quick search: `CTCT-3` finds CTCT-3 exactly, `CTCT-30` nothing, `CTCT-001` the last name of CTCT-5 (text). */
async function testQuickSearch() {
  await withTenant('search', async (ctx) => {
    for (const read of [listNumbers, idNumbers]) {
      assert.deepEqual(await read(ctx, { q: 'CTCT-3' }), [3], `${read.name}: CTCT-3`);
      assert.deepEqual(await read(ctx, { q: 'ctct-3' }), [3], `${read.name}: ctct-3`);
      assert.deepEqual(await read(ctx, { q: 'CTCT-30' }), [], `${read.name}: CTCT-30`);
      assert.deepEqual(await read(ctx, { q: 'CTCT-001' }), [5], `${read.name}: text, never CTCT-1`);
      assert.deepEqual(await read(ctx, { q: 'c07@' }), [7], `${read.name}: the text search stays`);
    }
    assert.deepEqual(await listNumbers(ctx, { q: 'CTCT-3', filters: textFilter('equals', '4') }), []);
  });
}

/** The assistant: `reference` filters on the reference (one or several) and sorts by number. */
async function testAssistantReference() {
  await withTenant('kad', async (ctx) => {
    const kad = async (filters: Record<string, any>, sort?: { field: string; direction: string }) => {
      const adapted = adaptFilters(contactsRegistry, filters);
      assert.deepEqual(adapted.ignored, [], JSON.stringify(adapted));
      const query: Record<string, unknown> = { sort: resolveAiQuerySort(contactsRegistry, sort).param };
      if (Object.keys(adapted.filters).length > 0) query.filters = JSON.stringify(adapted.filters);
      return listNumbers(ctx, query);
    };
    assert.deepEqual(await kad({ reference: 'CTCT-3' }), [3]);
    assert.deepEqual(await kad({ reference: ['CTCT-12', 'ctct-3'] }, { field: 'reference', direction: 'asc' }), [3, 12]);
    assert.deepEqual(await kad({ reference: 'CTCT-013' }), []);
    assert.deepEqual((await kad({}, { field: 'reference', direction: 'desc' })).slice(0, 2), [13, 12]);
  });
}

function importer(ctx: Ctx) {
  return (rows: Array<Record<string, string>>, dryRun: boolean, headers?: readonly string[]) =>
    ctx.contacts.importCsv({ file: fileOf(rows, headers), dryRun, language: 'en' }, { manager: ctx.runner.manager, tenantId: ctx.tenantId }) as Promise<Report>;
}

const contactRow = async ({ runner, tenantId }: Ctx, itemNumber: number) =>
  (await runner.query(`SELECT email, first_name, last_name FROM contacts WHERE tenant_id = $1 AND item_number = $2`, [tenantId, itemNumber]))[0];

/** The file's reference names the contact a row updates, its e-mail included; an unknown one refuses the row. */
async function testImportByReference() {
  await withTenant('import', async (ctx) => {
    const run = importer(ctx);
    // The check says each name and e-mail a reference changes (D12), and blocks nothing; a row
    // that keeps them, or a row without a reference, says nothing.
    const changes = [
      { reference: 'CTCT-3', first_name: 'First 03', last_name: 'Last 03', email: 'new03@example.test', active: 'yes' },
      { reference: '4', first_name: 'Renamed', last_name: 'Last 04', email: 'c04@example.test', active: 'yes' },
      { reference: 'CTCT-10', first_name: 'First 10', last_name: 'Last 10', email: 'C10@example.test', active: 'no' },
      { reference: '', first_name: 'Other', last_name: 'Name', email: 'c11@example.test', active: 'yes' },
    ];
    const check = await run(changes, true);
    assert.deepEqual([check.ok, check.inserted, check.updated, check.errors], [true, 0, 4, []]);
    assert.deepEqual((check.warnings ?? []).map((warning) => [warning.row, warning.code, warning.params]), [
      [2, 'CSV_REFERENCE_EMAIL_CHANGES', { reference: 'CTCT-3', name: 'First 03 Last 03', from: 'c03@example.test', to: 'new03@example.test' }],
      [3, 'CSV_REFERENCE_RENAMES', { reference: 'CTCT-4', stored: 'First 04 Last 04', name: 'Renamed Last 04', context: 'contact' }],
    ]);
    const moved = await run([
      { reference: 'CTCT-3', first_name: 'First 03', last_name: 'Last 03', email: 'new03@example.test', active: 'yes' },
      { reference: '4', first_name: 'Renamed', last_name: 'Last 04', email: 'c04@example.test', active: 'yes' },
    ], false);
    assert.deepEqual([moved.ok, moved.inserted, moved.updated, moved.errors], [true, 0, 2, []]);
    assert.equal((await contactRow(ctx, 3)).email, 'new03@example.test', 'the e-mail changes');
    assert.equal((await contactRow(ctx, 4)).first_name, 'Renamed');
    const count = async () => Number((await ctx.runner.query(`SELECT count(*) AS n FROM contacts WHERE tenant_id = $1`, [ctx.tenantId]))[0].n);
    assert.equal(await count(), 13, 'no contact created');

    const unknown = await run([
      { reference: '', email: 'fresh@example.test' },
      { reference: 'CTCT-999', email: 'ghost@example.test' },
      { reference: 'CTCT-013', email: 'padded@example.test' },
    ], true);
    assert.equal(unknown.ok, false);
    assert.deepEqual(unknown.errors.map((error) => [error.row, error.column, error.code, error.params?.value]), [
      [3, 'reference', 'CSV_RECORD_REFERENCE_NOT_FOUND', 'CTCT-999'],
      [4, 'reference', 'CSV_RECORD_REFERENCE_NOT_FOUND', 'CTCT-013'],
    ]);

    // Another contact's e-mail, one contact on two rows, one e-mail for two contacts: refused at the check.
    const taken = await run([{ reference: 'CTCT-6', email: 'C07@example.test' }], true);
    assert.deepEqual(taken.errors.map((error) => [error.row, error.column, error.code, error.params]), [
      [2, 'email', 'CSV_VALUE_TAKEN', { value: 'c07@example.test', reference: 'CTCT-7' }],
    ]);
    const twice = await run([
      { reference: 'CTCT-8', email: 'eight@example.test' },
      { reference: '', email: 'c08@example.test' },
      { reference: 'CTCT-8', email: 'eight-again@example.test' },
      { reference: 'CTCT-9', email: 'shared@example.test' },
      { reference: '', email: 'shared@example.test' },
    ], true);
    assert.deepEqual(twice.errors.map((error) => [error.row, error.column, error.code, error.params]), [
      [3, 'email', 'CSV_SAME_RECORD', { reference: 'CTCT-8', firstRow: 2 }],
      [4, 'reference', 'CSV_SAME_RECORD', { reference: 'CTCT-8', firstRow: 2 }],
      [6, 'email', 'CSV_DUPLICATE_KEY', { columns: 'email', firstRow: 5 }],
    ]);
  });
}

/** The export writes the reference first; its file comes back unchanged; a file without the column still imports. */
async function testExportRoundTrip() {
  await withTenant('roundtrip', async (ctx) => {
    const exported = (await ctx.contacts.exportCsv('data', { manager: ctx.runner.manager, tenantId: ctx.tenantId, language: 'en' })).content.replace(/^﻿/, '');
    const lines = exported.trim().split(/\r?\n/);
    assert.equal(lines[0].split(',')[0], 'reference');
    assert.ok(lines.some((line) => line.startsWith('CTCT-3,First 03,Last 03,,c03@example.test,')), exported);
    const again = await ctx.contacts.importCsv(
      { file: { buffer: Buffer.from(exported, 'utf8'), originalname: 'contacts.csv' } as Express.Multer.File, dryRun: true, language: 'en' },
      { manager: ctx.runner.manager, tenantId: ctx.tenantId },
    ) as Report;
    assert.deepEqual([again.ok, again.inserted, again.updated, again.unchanged, again.errors], [true, 0, 0, 13, []]);

    const legacy = await importer(ctx)([
      { first_name: 'Legacy', email: 'c02@example.test', active: 'yes' },
      { email: 'legacy-new@example.test' },
    ], false, HEADERS.slice(1));
    assert.deepEqual([legacy.ok, legacy.inserted, legacy.updated, legacy.errors], [true, 1, 1, []]);
    assert.equal((await contactRow(ctx, 2)).first_name, 'Legacy');
  });
}

// One row per contact: a second row naming the same contact, by its reference or by its e-mail, is
// refused on its line, at the check as at the load; a new contact named twice too. Nothing is written.
async function testImportRefusesSecondRowOfAContact() {
  await withTenant('second-row', async (ctx) => {
    const run = importer(ctx);
    const stored = async () => (await ctx.runner.query(
      `SELECT email, first_name, last_name FROM contacts WHERE tenant_id = $1 ORDER BY item_number`, [ctx.tenantId],
    ));
    const before = await stored();
    const cases: Array<[string, Array<Record<string, string>>, Array<[number, string, string, Record<string, unknown>]>]> = [
      ['same reference', [{ reference: 'CTCT-8', email: 'c08@example.test', first_name: 'A' }, { reference: '8', email: 'eight@example.test', first_name: 'B' }],
        [[3, 'reference', 'CSV_SAME_RECORD', { reference: 'CTCT-8', firstRow: 2 }]]],
      ['same e-mail', [{ reference: '', email: 'c08@example.test', first_name: 'A' }, { reference: '', email: 'C08@example.test', first_name: 'B' }],
        [[3, 'email', 'CSV_SAME_RECORD', { reference: 'CTCT-8', firstRow: 2 }]]],
      ['a new contact twice', [{ reference: '', email: 'brand-new@example.test', first_name: 'A' }, { reference: '', email: 'Brand-New@example.test', first_name: 'B' }],
        [[3, 'email', 'CSV_DUPLICATE_KEY', { columns: 'email', firstRow: 2 }]]],
    ];
    for (const [label, rows, expected] of cases) {
      for (const dryRun of [true, false]) {
        const report = await run(rows, dryRun);
        assert.equal(report.ok, false, `${label}, dryRun=${dryRun}: ${JSON.stringify(report)}`);
        assert.deepEqual(report.errors.map((error) => [error.row, error.column, error.code, error.params]), expected, `${label}, dryRun=${dryRun}`);
      }
    }
    assert.deepEqual(await stored(), before, 'a refused file writes nothing');
  });
}

// A change of e-mail by reference and another row of the file that lead to the same address,
// whatever its case: the second row is refused on its line (CSV_DUPLICATE_KEY on the e-mail), at the
// check as at the load, and nothing is written. The load runs under a savepoint, so a refusal by the
// database shows.
async function testImportRefusesANewAddressOfAnotherRow() {
  await withTenant('address-collision', async (ctx) => {
    const run = importer(ctx);
    const attempt = async (rows: Array<Record<string, string>>, dryRun: boolean) => {
      await ctx.runner.query('SAVEPOINT address_collision');
      try {
        const report = await run(rows, dryRun);
        await ctx.runner.query('RELEASE SAVEPOINT address_collision');
        return report;
      } catch (err) {
        await ctx.runner.query('ROLLBACK TO SAVEPOINT address_collision');
        return { ok: false, inserted: 0, updated: 0, errors: [], thrown: (err as Error).message } as Report & { thrown: string };
      }
    };
    const stored = async () => (await ctx.runner.query(
      `SELECT email, first_name, last_name FROM contacts WHERE tenant_id = $1 ORDER BY item_number`, [ctx.tenantId],
    ));
    const before = await stored();
    const cases: Array<[string, Array<Record<string, string>>]> = [
      ['a new address by reference, then a new contact', [{ reference: 'CTCT-8', email: 'fresh@example.test' }, { reference: '', email: 'Fresh@example.test' }]],
      ['a new contact, then a new address by reference', [{ reference: '', email: 'fresh@example.test' }, { reference: 'CTCT-8', email: 'FRESH@example.test' }]],
      ['two new addresses by reference', [{ reference: 'CTCT-8', email: 'same@example.test' }, { reference: 'CTCT-9', email: 'Same@example.test' }]],
    ];
    for (const [label, rows] of cases) {
      for (const dryRun of [true, false]) {
        const report = await attempt(rows, dryRun);
        assert.equal(report.ok, false, `${label}, dryRun=${dryRun}: ${JSON.stringify(report)}`);
        assert.deepEqual(report.errors.map((error) => [error.row, error.column, error.code, error.params]),
          [[3, 'email', 'CSV_DUPLICATE_KEY', { columns: 'email', firstRow: 2 }]], `${label}, dryRun=${dryRun}: ${JSON.stringify(report)}`);
      }
    }
    assert.deepEqual(await stored(), before, 'a refused file writes nothing');
  });
}

/** The contact's page shows its supplier in the picker as the lookup does: reference, ERP ID and status. */
async function testDetailCarriesSupplierOption() {
  await withTenant('detail', async (ctx) => {
    const [supplier] = await ctx.runner.query(
      `INSERT INTO suppliers (tenant_id, name, erp_supplier_id) VALUES ($1, 'Salesforce', 'SUP-003') RETURNING id, item_number`,
      [ctx.tenantId],
    );
    await ctx.runner.query(`UPDATE contacts SET supplier_id = $2 WHERE tenant_id = $1 AND email = 'c01@example.test'`, [ctx.tenantId, supplier.id]);
    const [contact] = await ctx.runner.query(`SELECT id FROM contacts WHERE tenant_id = $1 AND email = 'c01@example.test'`, [ctx.tenantId]);
    const opts = { manager: ctx.runner.manager, tenantId: ctx.tenantId };
    const detail: any = await ctx.contacts.get(contact.id, opts);
    assert.ok(Number(supplier.item_number) > 0);
    assert.deepEqual(detail.supplier_option, {
      id: supplier.id, item_number: Number(supplier.item_number), name: 'Salesforce', erp_supplier_id: 'SUP-003', status: 'enabled',
    });
    assert.equal(detail.supplier_name, 'Salesforce');
    const [bare] = await ctx.runner.query(`SELECT id FROM contacts WHERE tenant_id = $1 AND email = 'c02@example.test'`, [ctx.tenantId]);
    assert.equal(((await ctx.contacts.get(bare.id, opts)) as any).supplier_option, null, 'no supplier, no option');
  });
}

async function main() {
  await dataSource.initialize();
  let failed = 0;
  const tests: Array<[string, () => Promise<void>]> = [
    ['testReferenceColumnFilter', testReferenceColumnFilter],
    ['testQuickSearch', testQuickSearch],
    ['testAssistantReference', testAssistantReference],
    ['testImportByReference', testImportByReference],
    ['testImportRefusesSecondRowOfAContact', testImportRefusesSecondRowOfAContact],
    ['testImportRefusesANewAddressOfAnotherRow', testImportRefusesANewAddressOfAnotherRow],
    ['testExportRoundTrip', testExportRoundTrip],
    ['testDetailCarriesSupplierOption', testDetailCarriesSupplierOption],
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
    console.error(`contacts-reference.integration.spec: ${failed} failed`);
    process.exit(1);
  }
  console.log('contacts-reference.integration.spec: ok');
}

void main();
