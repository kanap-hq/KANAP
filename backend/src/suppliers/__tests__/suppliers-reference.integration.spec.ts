import 'dotenv/config';
import * as assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { QueryRunner } from 'typeorm';
import dataSource from '../../data-source';
import { AuditLog } from '../../audit/audit.entity';
import { AuditService } from '../../audit/audit.service';
import { adaptFilters } from '../../ai/query/ai-filter.adapter';
import { resolveAiQuerySort } from '../../ai/query/ai-query.executor';
import { suppliersRegistry } from '../../ai/query/registries/suppliers.registry';
import { SuppliersService } from '../suppliers.service';

// The supplier's reference (`SUP-12`) out of its page (lot R3):
//
//  - the list's reference column filters on the number, with or without the prefix; `SUP-013` is
//    text, which no reference is written as;
//  - the quick search finds `SUP-3` exactly, besides the text search, which still finds an ERP ID
//    written `SUP-001`;
//  - the id list of the record's previous / next band carries the references;
//  - the assistant filters and sorts on `reference`;
//  - the file: a `reference` column first; filled, it names the supplier a row updates (a rename
//    included), an unknown one refuses the row; a file without it still imports; an ERP ID
//    `SUP-12` stays an ERP ID.
//
// Every case runs inside one transaction with its own tenant, rolled back at the end.

type Report = {
  ok: boolean;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  errors: Array<{ row: number; message: string; column?: string; code?: string; params?: Record<string, string | number> }>;
  warnings?: Array<{ row: number; message: string; column?: string; code?: string; params?: Record<string, string | number> }>;
};

const HEADERS = ['reference', 'name', 'erp_supplier_id', 'commercial_contact', 'technical_contact', 'support_contact', 'notes', 'status', 'disabled_at'];

function fileOf(rows: Array<Record<string, string>>, headers: readonly string[] = HEADERS): Express.Multer.File {
  const lines = [headers.join(','), ...rows.map((row) => headers.map((header) => row[header] ?? '').join(','))];
  return { buffer: Buffer.from(`${lines.join('\n')}\n`, 'utf8') } as Express.Multer.File;
}

type Ctx = { runner: QueryRunner; tenantId: string; suppliers: SuppliersService };

/** A tenant with the suppliers `Supplier 01` to `Supplier 13`, numbered SUP-1 to SUP-13; SUP-5 has the ERP ID `SUP-001`. */
async function withTenant(tag: string, fn: (ctx: Ctx) => Promise<void>) {
  const runner = dataSource.createQueryRunner();
  await runner.connect();
  await runner.startTransaction();
  try {
    const tenantId = randomUUID();
    await runner.query(
      `INSERT INTO tenants (id, slug, name, status, metadata, branding, created_at, updated_at)
       VALUES ($1, $2, 'Supplier references test', 'active', '{}'::jsonb, '{"logo_version":0,"use_logo_in_dark":true}'::jsonb, now(), now())`,
      [tenantId, `suppliers-ref-${tag}-${tenantId.slice(0, 8)}`],
    );
    await runner.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenantId]);
    for (let n = 1; n <= 13; n += 1) {
      await runner.query(
        `INSERT INTO suppliers (tenant_id, name, erp_supplier_id) VALUES ($1, $2, $3)`,
        [tenantId, `Supplier ${String(n).padStart(2, '0')}`, n === 5 ? 'SUP-001' : `F${n}`],
      );
    }
    const suppliers = new SuppliersService(undefined as any, new AuditService(runner.manager.getRepository(AuditLog)));
    await fn({ runner, tenantId, suppliers });
  } finally {
    await runner.rollbackTransaction();
    await runner.release();
  }
}

const numberOf = async ({ runner, tenantId }: Ctx, name: string) =>
  Number((await runner.query(`SELECT item_number FROM suppliers WHERE tenant_id = $1 AND name = $2`, [tenantId, name]))[0]?.item_number);

async function listNumbers(ctx: Ctx, query: Record<string, unknown>) {
  const result = await ctx.suppliers.list({ sort: 'item_number:ASC', ...query }, { manager: ctx.runner.manager });
  return result.items.map((item) => item.item_number);
}

async function idNumbers(ctx: Ctx, query: Record<string, unknown>) {
  const result = await ctx.suppliers.listIds({ sort: 'item_number:ASC', ...query }, { manager: ctx.runner.manager });
  return result.refs.map((ref) => Number(ref.replace('SUP-', '')));
}

const textFilter = (type: string, filter: string) => JSON.stringify({ item_number: { filterType: 'text', type, filter } });

/** The reference column: `SUP-3` and `3` find SUP-3; `SUP-013` finds nothing; the list and the id list agree. */
async function testReferenceColumnFilter() {
  await withTenant('filter', async (ctx) => {
    assert.equal(await numberOf(ctx, 'Supplier 03'), 3, 'the database numbers the suppliers in order');
    for (const read of [listNumbers, idNumbers]) {
      assert.deepEqual(await read(ctx, { filters: textFilter('equals', 'SUP-3') }), [3], `${read.name}: SUP-3`);
      assert.deepEqual(await read(ctx, { filters: textFilter('equals', 'sup-3') }), [3], `${read.name}: sup-3`);
      assert.deepEqual(await read(ctx, { filters: textFilter('equals', '3') }), [3], `${read.name}: 3`);
      assert.deepEqual(await read(ctx, { filters: textFilter('contains', 'SUP-3') }), [3, 13], `${read.name}: contains SUP-3`);
      assert.deepEqual(await read(ctx, { filters: textFilter('equals', 'SUP-013') }), [], `${read.name}: SUP-013 is text`);
      assert.deepEqual(await read(ctx, { filters: textFilter('contains', 'SUP-013') }), [], `${read.name}: contains SUP-013`);
    }
    const total = await ctx.suppliers.list({ filters: textFilter('contains', '1') }, { manager: ctx.runner.manager });
    assert.equal(total.total, 5, 'SUP-1, SUP-10 to SUP-13: the count follows the filter');
    // The column sorts by number, not as text (SUP-2 before SUP-10).
    const sorted = await ctx.suppliers.list({ sort: 'item_number:DESC', limit: 3 }, { manager: ctx.runner.manager });
    assert.deepEqual(sorted.items.map((item) => item.item_number), [13, 12, 11]);
  });
}

/** The quick search: `SUP-3` finds SUP-3 exactly, `SUP-30` nothing, and `SUP-001` the ERP ID of SUP-5 (text). */
async function testQuickSearch() {
  await withTenant('search', async (ctx) => {
    for (const read of [listNumbers, idNumbers]) {
      assert.deepEqual(await read(ctx, { q: 'SUP-3' }), [3], `${read.name}: SUP-3`);
      assert.deepEqual(await read(ctx, { q: 'sup-3' }), [3], `${read.name}: sup-3`);
      assert.deepEqual(await read(ctx, { q: 'SUP-30' }), [], `${read.name}: SUP-30`);
      assert.deepEqual(await read(ctx, { q: 'SUP-001' }), [5], `${read.name}: the ERP ID SUP-001, never SUP-1`);
      assert.deepEqual(await read(ctx, { q: 'Supplier 07' }), [7], `${read.name}: the text search stays`);
    }
    // With a column filter: both apply.
    assert.deepEqual(await listNumbers(ctx, { q: 'SUP-3', filters: textFilter('equals', 'SUP-4') }), []);
    assert.deepEqual(await listNumbers(ctx, { q: 'SUP-3', filters: textFilter('contains', '3') }), [3]);
  });
}

/** The id list of the record's previous / next band carries each supplier's reference, in its order. */
async function testIdListReferences() {
  await withTenant('ids', async (ctx) => {
    const result = await ctx.suppliers.listIds({ sort: 'name:DESC', limit: 3 }, { manager: ctx.runner.manager });
    assert.equal(result.total, 13);
    assert.deepEqual(result.refs, ['SUP-13', 'SUP-12', 'SUP-11']);
    const named: Array<{ id: string; item_number: number }> = await ctx.runner.query(
      `SELECT id, item_number FROM suppliers WHERE tenant_id = $1 AND id = ANY($2::uuid[])`, [ctx.tenantId, result.ids],
    );
    const numberById = new Map(named.map((row) => [row.id, Number(row.item_number)]));
    assert.deepEqual(result.ids.map((id) => `SUP-${numberById.get(id)}`), result.refs, 'refs follow the ids');
  });
}

/** The assistant: `reference` filters on the reference (one or several) and sorts by number. */
async function testAssistantReference() {
  await withTenant('kad', async (ctx) => {
    const kad = async (filters: Record<string, any>, sort?: { field: string; direction: string }) => {
      const adapted = adaptFilters(suppliersRegistry, filters);
      assert.deepEqual(adapted.ignored, [], JSON.stringify(adapted));
      const query: Record<string, unknown> = { sort: resolveAiQuerySort(suppliersRegistry, sort).param };
      if (Object.keys(adapted.filters).length > 0) query.filters = JSON.stringify(adapted.filters);
      return (await ctx.suppliers.list(query, { manager: ctx.runner.manager })).items.map((item) => item.item_number);
    };
    assert.deepEqual(await kad({ reference: 'SUP-3' }), [3]);
    assert.deepEqual(await kad({ reference: ['SUP-12', 'sup-3'] }, { field: 'reference', direction: 'asc' }), [3, 12]);
    assert.deepEqual(await kad({ reference: '7' }), [7]);
    assert.deepEqual(await kad({ reference: 'SUP-013' }), [], 'a leading zero is no reference');
    const sorted = await kad({}, { field: 'reference', direction: 'desc' });
    assert.deepEqual(sorted.slice(0, 2), [13, 12]);
  });
}

function importer(ctx: Ctx) {
  return (rows: Array<Record<string, string>>, dryRun: boolean, headers?: readonly string[]) =>
    ctx.suppliers.importCsv({ file: fileOf(rows, headers), dryRun, userId: null, language: 'en' }, { manager: ctx.runner.manager }) as Promise<Report>;
}

const supplierRow = async ({ runner, tenantId }: Ctx, itemNumber: number) =>
  (await runner.query(`SELECT name, erp_supplier_id, notes FROM suppliers WHERE tenant_id = $1 AND item_number = $2`, [tenantId, itemNumber]))[0];

/** The file's reference names the supplier a row updates, its name included; an unknown one refuses the row. */
async function testImportByReference() {
  await withTenant('import', async (ctx) => {
    const run = importer(ctx);
    // The check says each name a reference changes (D12), and blocks nothing; a row that keeps its
    // name, or a row without a reference, says nothing.
    const check = await run([
      { reference: 'SUP-3', name: 'Renamed three', erp_supplier_id: 'F3' },
      { reference: '4', name: 'Supplier 04', erp_supplier_id: 'F4-new' },
      { reference: '', name: 'supplier 05', erp_supplier_id: 'F5-new' },
    ], true);
    assert.deepEqual([check.ok, check.updated, check.errors], [true, 3, []]);
    assert.deepEqual((check.warnings ?? []).filter((warning) => warning.code !== 'CSV_NAME_MATCHED_CASE').map((warning) => [warning.row, warning.code, warning.params]), [
      [2, 'CSV_REFERENCE_RENAMES', { reference: 'SUP-3', stored: 'Supplier 03', name: 'Renamed three', context: 'supplier' }],
    ]);
    const renamed = await run([
      { reference: 'SUP-3', name: 'Renamed three', erp_supplier_id: 'F3' },
      { reference: '4', name: 'Supplier 04', erp_supplier_id: 'F4-new' },
    ], false);
    assert.deepEqual([renamed.ok, renamed.inserted, renamed.updated, renamed.errors], [true, 0, 2, []]);
    assert.equal((await supplierRow(ctx, 3)).name, 'Renamed three');
    assert.equal((await supplierRow(ctx, 4)).erp_supplier_id, 'F4-new');
    const count = async () => Number((await ctx.runner.query(`SELECT count(*) AS n FROM suppliers WHERE tenant_id = $1`, [ctx.tenantId]))[0].n);
    assert.equal(await count(), 13, 'no supplier created');

    const unknown = await run([
      { reference: '', name: 'Fresh supplier' },
      { reference: 'SUP-999', name: 'Ghost' },
      { reference: 'SUP-013', name: 'Padded' },
      { reference: 'COMP-2', name: 'Other family' },
    ], true);
    assert.equal(unknown.ok, false);
    assert.deepEqual(unknown.errors.map((error) => [error.row, error.column, error.code, error.params?.value]), [
      [3, 'reference', 'CSV_RECORD_REFERENCE_NOT_FOUND', 'SUP-999'],
      [4, 'reference', 'CSV_RECORD_REFERENCE_NOT_FOUND', 'SUP-013'],
      [5, 'reference', 'CSV_RECORD_REFERENCE_NOT_FOUND', 'COMP-2'],
    ]);

    // Another supplier's name, or two rows on one supplier: refused at the check, never at the load.
    const taken = await run([{ reference: 'SUP-6', name: 'supplier 07' }], true);
    assert.deepEqual(taken.errors.map((error) => [error.row, error.column, error.code, error.params]), [
      [2, 'name', 'CSV_VALUE_TAKEN', { value: 'supplier 07', reference: 'SUP-7' }],
    ]);
    const twice = await run([
      { reference: 'SUP-8', name: 'Eight renamed' },
      { reference: '', name: 'Supplier 08' },
      { reference: 'SUP-8', name: 'Eight again' },
    ], true);
    assert.deepEqual(twice.errors.map((error) => [error.row, error.column, error.code, error.params]), [
      [3, 'name', 'CSV_SAME_RECORD', { reference: 'SUP-8', firstRow: 2 }],
      [4, 'reference', 'CSV_SAME_RECORD', { reference: 'SUP-8', firstRow: 2 }],
    ]);
    // Two suppliers swapping names is refused too: one row would take the other's name.
    const swap = await run([{ reference: 'SUP-9', name: 'Supplier 10' }, { reference: 'SUP-10', name: 'Supplier 09' }], true);
    assert.deepEqual(swap.errors.map((error) => error.code), ['CSV_VALUE_TAKEN', 'CSV_VALUE_TAKEN']);
  });
}

/** An ERP ID written `SUP-12` stays an ERP ID: the import matches by name and stores it as is. */
async function testErpIdIsNoReference() {
  await withTenant('erp', async (ctx) => {
    const run = importer(ctx);
    const report = await run([{ name: 'Holder', erp_supplier_id: 'SUP-12' }], false);
    assert.deepEqual([report.ok, report.inserted, report.updated, report.errors], [true, 1, 0, []]);
    assert.deepEqual(await supplierRow(ctx, 12), { name: 'Supplier 12', erp_supplier_id: 'F12', notes: null }, 'SUP-12 untouched');
    const holder = (await ctx.runner.query(`SELECT item_number, erp_supplier_id FROM suppliers WHERE tenant_id = $1 AND name = 'Holder'`, [ctx.tenantId]))[0];
    assert.deepEqual([Number(holder.item_number), holder.erp_supplier_id], [14, 'SUP-12']);
    // The text search finds it by its ERP ID, next to SUP-12 by its reference.
    assert.deepEqual(await listNumbers(ctx, { q: 'SUP-12' }), [12, 14]);
  });
}

/** The export writes the reference first; its file comes back unchanged; a file without the column still imports. */
async function testExportRoundTrip() {
  await withTenant('roundtrip', async (ctx) => {
    const exported = (await ctx.suppliers.exportCsv('data', { manager: ctx.runner.manager, language: 'en' })).content.replace(/^﻿/, '');
    const lines = exported.trim().split(/\r?\n/);
    assert.equal(lines[0].split(',')[0], 'Reference');
    assert.ok(lines.includes('SUP-3,Supplier 03,F3,,,,,enabled,'), exported);
    const french = (await ctx.suppliers.exportCsv('template', { manager: ctx.runner.manager, language: 'fr' })).content.replace(/^﻿/, '');
    assert.equal(french.split(/\r?\n/)[0].split(';')[0], 'Référence');

    const again = await ctx.suppliers.importCsv(
      { file: { buffer: Buffer.from(exported, 'utf8') } as Express.Multer.File, dryRun: true, userId: null, language: 'en' },
      { manager: ctx.runner.manager },
    ) as Report;
    assert.deepEqual([again.ok, again.inserted, again.updated, again.unchanged, again.errors], [true, 0, 0, 13, []]);

    const legacy = await importer(ctx)([{ name: 'Supplier 02', erp_supplier_id: 'F2-legacy' }, { name: 'Legacy new' }], false, HEADERS.slice(1));
    assert.deepEqual([legacy.ok, legacy.inserted, legacy.updated, legacy.errors], [true, 1, 1, []]);
    assert.equal((await supplierRow(ctx, 2)).erp_supplier_id, 'F2-legacy');
  });
}

// One row per supplier: a second row naming the same supplier, by its reference or by its name (the
// family's CSV_SUPPLIER_NAME_DUPLICATE), is refused on its line, at the check as at the load; a new
// supplier named twice too. Nothing is written.
async function testImportRefusesSecondRowOfASupplier() {
  await withTenant('second-row', async (ctx) => {
    const run = importer(ctx);
    const names = async () => (await ctx.runner.query(
      `SELECT name, erp_supplier_id FROM suppliers WHERE tenant_id = $1 ORDER BY item_number`, [ctx.tenantId],
    ));
    const before = await names();
    const cases: Array<[string, Array<Record<string, string>>, Array<[number, string, string, Record<string, unknown>]>]> = [
      ['same reference', [{ reference: 'SUP-8', name: 'Supplier 08', erp_supplier_id: 'A' }, { reference: '8', name: 'Eight renamed', erp_supplier_id: 'B' }],
        [[3, 'reference', 'CSV_SAME_RECORD', { reference: 'SUP-8', firstRow: 2 }]]],
      ['same name', [{ reference: '', name: 'Supplier 08', erp_supplier_id: 'A' }, { reference: '', name: 'supplier 08', erp_supplier_id: 'B' }],
        [[3, 'name', 'CSV_SUPPLIER_NAME_DUPLICATE', { name: 'supplier 08', firstRow: 2 }]]],
      ['a new supplier twice', [{ reference: '', name: 'Brand new', erp_supplier_id: 'A' }, { reference: '', name: 'brand NEW', erp_supplier_id: 'B' }],
        [[3, 'name', 'CSV_SUPPLIER_NAME_DUPLICATE', { name: 'brand NEW', firstRow: 2 }]]],
    ];
    for (const [label, rows, expected] of cases) {
      for (const dryRun of [true, false]) {
        const report = await run(rows, dryRun);
        assert.equal(report.ok, false, `${label}, dryRun=${dryRun}: ${JSON.stringify(report)}`);
        assert.deepEqual(report.errors.map((error) => [error.row, error.column, error.code, error.params]), expected, `${label}, dryRun=${dryRun}`);
      }
    }
    assert.deepEqual(await names(), before, 'a refused file writes nothing');
  });
}

async function main() {
  await dataSource.initialize();
  let failed = 0;
  const tests: Array<[string, () => Promise<void>]> = [
    ['testReferenceColumnFilter', testReferenceColumnFilter],
    ['testQuickSearch', testQuickSearch],
    ['testIdListReferences', testIdListReferences],
    ['testAssistantReference', testAssistantReference],
    ['testImportByReference', testImportByReference],
    ['testImportRefusesSecondRowOfASupplier', testImportRefusesSecondRowOfASupplier],
    ['testErpIdIsNoReference', testErpIdIsNoReference],
    ['testExportRoundTrip', testExportRoundTrip],
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
    console.error(`suppliers-reference.integration.spec: ${failed} failed`);
    process.exit(1);
  }
  console.log('suppliers-reference.integration.spec: ok');
}

void main();
