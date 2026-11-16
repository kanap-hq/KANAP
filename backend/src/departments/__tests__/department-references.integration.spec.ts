import 'dotenv/config';
// @database-spec: opens the data-source through runSpecs, so it runs on a database lane.
import { QueryRunner } from 'typeorm';
import { DepartmentsService } from '../departments.service';
import { Department } from '../department.entity';
import { Company } from '../../companies/company.entity';
import { departmentsRegistry } from '../../ai/query/registries/departments.registry';
import { adaptFilters } from '../../ai/query/ai-filter.adapter';
import { resolveToUuid } from '../../common/resolve-item-id';
import { exportListQuery } from '../../common/pagination';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  runSpecs,
  seedTenant,
} from '../../spend/__tests__/round-inputs.fixtures';

// The department reference (`DEPT-n`, lot R2 of 26.11.9) in the list and its file: the reference
// column's filter (list and ids), the quick search on a typed reference, the references of the
// ids, the sort, Kad's `reference` field through the list service, and the file's optional
// `reference` column: filled, it names the department whatever company the row writes (the
// department moves), an unknown one is refused, an older file still imports, and an export
// imports back without change.

type Seeded = { runner: QueryRunner; tenantId: string; svc: DepartmentsService; idOf: (n: number) => string; alpha: string; beta: string };

/** Two companies, Alpha and Beta; 31 departments of Alpha, `Dept 1` to `Dept 31`, numbered DEPT-1 to DEPT-31. */
async function withDepartments(tag: string, fn: (seeded: Seeded) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, tag);
    const company = async (name: string) => (await runner.query(
      `INSERT INTO companies (tenant_id, name, country_iso, city, base_currency) VALUES ($1, $2, 'FR', 'Lyon', 'EUR') RETURNING id`,
      [tenantId, name],
    ))[0].id as string;
    const alpha = await company('Alpha');
    const beta = await company('Beta');
    const ids = new Map<number, string>();
    for (let n = 1; n <= 31; n += 1) {
      const [row] = await runner.query(
        `INSERT INTO departments (tenant_id, company_id, name, item_number) VALUES ($1, $2, $3, $4) RETURNING id`,
        [tenantId, alpha, `Dept ${n}`, n],
      );
      ids.set(n, row.id);
    }
    const svc = new DepartmentsService(runner.manager.getRepository(Department), runner.manager.getRepository(Company), captureAudit() as any);
    await fn({ runner, tenantId, svc, idOf: (n) => ids.get(n)!, alpha, beta });
  });
}

/** The list and the ids of the record's band agree on a query: the numbers they return, sorted. */
async function sameEverywhere(seeded: Seeded, query: Record<string, unknown>): Promise<number[]> {
  const { items } = await seeded.svc.list({ limit: 100, ...query }, { manager: seeded.runner.manager });
  const numbers = (items as Department[]).map((item) => item.item_number).sort((a, b) => a - b);
  const { ids, refs, total } = await seeded.svc.listIds(query, { manager: seeded.runner.manager });
  assert.equal(total, numbers.length, `ids total of ${JSON.stringify(query)}`);
  assert.deepEqual(ids.map((id) => numbers.find((n) => seeded.idOf(n) === id)).sort((a, b) => a! - b!), numbers);
  assert.deepEqual(refs.slice().sort(), numbers.map((n) => `DEPT-${n}`).sort());
  return numbers;
}

const column = (model: Record<string, unknown>) => ({ filters: JSON.stringify({ item_number: model }) });

async function testReferenceColumnFilter() {
  await withDepartments('dref-filter', async (seeded) => {
    assert.deepEqual(await sameEverywhere(seeded, column({ filterType: 'text', type: 'equals', filter: 'DEPT-3' })), [3]);
    assert.deepEqual(await sameEverywhere(seeded, column({ filterType: 'text', type: 'equals', filter: '3' })), [3]);
    assert.deepEqual(await sameEverywhere(seeded, column({ filterType: 'text', type: 'equals', filter: 'DEPT-013' })), []);
    assert.deepEqual(await sameEverywhere(seeded, column({ filterType: 'text', type: 'contains', filter: 'DEPT-3' })), [3, 13, 23, 30, 31]);
  });
}

async function testQuickSearch() {
  await withDepartments('dref-search', async (seeded) => {
    assert.deepEqual(await sameEverywhere(seeded, { q: 'DEPT-3' }), [3]);
    assert.deepEqual(await sameEverywhere(seeded, { q: 'dept-3' }), [3]);
    assert.deepEqual(await sameEverywhere(seeded, { q: 'DEPT-30' }), [30], 'DEPT-30 does not find DEPT-3');
    assert.deepEqual(await sameEverywhere(seeded, { q: 'DEPT-013' }), [], 'a leading zero is no reference');
    assert.deepEqual(await sameEverywhere(seeded, { q: '3' }), [3, 13, 23, 30, 31], 'digits alone stay the text search');
  });
}

async function testIdsAndSort() {
  await withDepartments('dref-ids', async (seeded) => {
    const { ids, refs } = await seeded.svc.listIds({ sort: 'item_number:DESC' }, { manager: seeded.runner.manager });
    assert.equal(ids.length, 31);
    ids.forEach((id, index) => {
      assert.equal(id, seeded.idOf(31 - index));
      assert.equal(refs[index], `DEPT-${31 - index}`);
    });
    const { items } = await seeded.svc.list({ sort: 'item_number:ASC', limit: 3 }, { manager: seeded.runner.manager });
    assert.deepEqual((items as Department[]).map((item) => item.item_number), [1, 2, 3]);
  });
}

async function testAssistantField() {
  await withDepartments('dref-kad', async (seeded) => {
    assert.equal(departmentsRegistry.fields.reference.grid, 'item_number');
    assert.equal(departmentsRegistry.sortFields.reference, 'item_number');
    const adapted = adaptFilters(departmentsRegistry, { reference: ['DEPT-3', '12', 'DEPT-013', 'COMP-4'] });
    assert.deepEqual(adapted.applied, ['reference']);
    assert.deepEqual(await sameEverywhere(seeded, { filters: JSON.stringify(adapted.filters) }), [3, 12]);
    const { items } = await seeded.svc.list({ sort: `${departmentsRegistry.sortFields.reference}:DESC`, limit: 2 }, { manager: seeded.runner.manager });
    assert.deepEqual((items as Department[]).map((item) => item.item_number), [31, 30]);
  });
}

// --- The file -------------------------------------------------------------------------------

type Report = {
  ok: boolean;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  errors: Array<{ row: number; column?: string; code?: string; params?: Record<string, string | number> }>;
  warnings?: Array<{ row: number; column?: string; code?: string; params?: Record<string, string | number> }>;
};

const BASE = ['company_name', 'name', 'description', 'status', 'disabled_at'];

function fileOf(headers: readonly string[], rows: Array<Record<string, string>>): Express.Multer.File {
  const lines = [headers.join(','), ...rows.map((row) => headers.map((header) => row[header] ?? '').join(','))];
  return { buffer: Buffer.from(`${lines.join('\n')}\n`, 'utf8') } as Express.Multer.File;
}

function importer(seeded: Seeded) {
  return (headers: readonly string[], rows: Array<Record<string, string>>, dryRun = false) => seeded.svc.importCsv(
    { file: fileOf(headers, rows), dryRun, userId: null, language: 'en' },
    { manager: seeded.runner.manager },
  ) as Promise<Report>;
}

async function stored(seeded: Seeded, n: number): Promise<{ name: string; company_id: string; description: string | null }> {
  return (await seeded.runner.query(
    `SELECT name, company_id, description FROM departments WHERE tenant_id = $1 AND item_number = $2`, [seeded.tenantId, n],
  ))[0];
}

async function testImportByReference() {
  await withDepartments('dref-import', async (seeded) => {
    const run = importer(seeded);
    const headers = ['reference', ...BASE];
    // The reference names the department whatever company the row writes: it moves to Beta.
    for (const dryRun of [true, false]) {
      const report = await run(headers, [
        { reference: 'DEPT-3', company_name: 'Beta', name: 'Dept 3', status: 'enabled' },
        { reference: '4', company_name: 'Alpha', name: 'Renamed four', status: 'enabled' },
      ], dryRun);
      assert.equal(report.ok, true, JSON.stringify(report.errors));
      assert.deepEqual([report.inserted, report.updated], [0, 2], `dryRun=${dryRun}`);
    }
    assert.equal((await stored(seeded, 3)).company_id, seeded.beta);
    assert.equal((await stored(seeded, 4)).name, 'Renamed four');
    const count = async () => Number((await seeded.runner.query(`SELECT count(*)::int AS n FROM departments WHERE tenant_id = $1`, [seeded.tenantId]))[0].n);
    assert.equal(await count(), 31, 'nothing created');

    // An empty reference keeps the company and name as the key.
    const byName = await run(headers, [{ reference: '', company_name: 'Alpha', name: 'dept 5', description: 'by name' }]);
    assert.equal(byName.ok, true, JSON.stringify(byName.errors));
    assert.deepEqual([byName.inserted, byName.updated], [0, 1]);
    assert.deepEqual([(await stored(seeded, 5)).name, (await stored(seeded, 5)).description], ['Dept 5', 'by name']);

    // An unknown reference, or one that is no department reference, refuses its row, by number.
    const unknown = await run(headers, [{ reference: 'DEPT-6', company_name: 'Alpha', name: 'Dept 6' }, { reference: 'DEPT-999', company_name: 'Alpha', name: 'Ghost' }]);
    assert.deepEqual(unknown.errors.map((e) => [e.row, e.column, e.code, e.params?.value]), [[3, 'reference', 'CSV_RECORD_REFERENCE_NOT_FOUND', 'DEPT-999']]);
    const padded = await run(headers, [{ reference: 'DEPT-013', company_name: 'Alpha', name: 'Padded' }, { reference: 'COMP-3', company_name: 'Alpha', name: 'Other family' }]);
    assert.deepEqual(padded.errors.map((e) => [e.row, e.column, e.code, e.params?.value]), [
      [2, 'reference', 'CSV_RECORD_REFERENCE_NOT_FOUND', 'DEPT-013'],
      [3, 'reference', 'CSV_RECORD_REFERENCE_NOT_FOUND', 'COMP-3'],
    ]);

    // A name another department of that company holds, a reference twice: refused.
    const taken = await run(headers, [{ reference: 'DEPT-7', company_name: 'Alpha', name: 'Dept 8' }]);
    assert.deepEqual(taken.errors.map((e) => [e.row, e.column, e.code, e.params]), [[2, 'name', 'CSV_VALUE_TAKEN', { value: 'Dept 8', reference: 'DEPT-8' }]]);
    const twice = await run(headers, [{ reference: 'DEPT-7', company_name: 'Alpha', name: 'Seven' }, { reference: 'dept-7', company_name: 'Alpha', name: 'Seven again' }]);
    assert.deepEqual(twice.errors.map((e) => [e.row, e.column, e.code]), [[3, 'reference', 'CSV_DUPLICATE_KEY']]);
    const same = await run(headers, [{ reference: 'DEPT-9', company_name: 'Alpha', name: 'Nine' }, { reference: '', company_name: 'Alpha', name: 'Dept 9' }]);
    assert.deepEqual(same.errors.map((e) => [e.row, e.column, e.code, e.params]), [[3, 'name', 'CSV_SAME_RECORD', { firstRow: 2, reference: 'DEPT-9' }]]);
    assert.equal((await stored(seeded, 9)).name, 'Dept 9', 'a refused file writes nothing');

    // An older file, without the column, still imports.
    const older = await run(BASE, [{ company_name: 'Alpha', name: 'Dept 10', description: 'older file' }]);
    assert.equal(older.ok, true, JSON.stringify(older.errors));
    assert.deepEqual([older.inserted, older.updated], [0, 1]);
  });
}

/**
 * A filled reference that renames its department or moves it to another company is announced,
 * without blocking the check or the load (D12). A row that keeps the stored name and company,
 * or a row without a reference, announces nothing.
 */
async function testRenameAndMoveWarnings() {
  await withDepartments('dref-warnings', async (seeded) => {
    const run = importer(seeded);
    const headers = ['reference', ...BASE];
    const rows: Array<Record<string, string>> = [
      { reference: 'DEPT-3', company_name: 'Alpha', name: 'Purchasing' },
      { reference: 'DEPT-4', company_name: 'Beta', name: 'Dept 4' },
      { reference: 'DEPT-5', company_name: 'Alpha', name: 'Dept 5', description: 'same name and company' },
      { reference: '', company_name: 'Alpha', name: 'Dept 6', description: 'by name' },
      { reference: '7', company_name: 'Beta', name: 'Seven' },
      { reference: 'DEPT-8', company_name: 'Alpha', name: 'Dept 8' },
    ];
    for (const dryRun of [true, false]) {
      const report = await run(headers, rows, dryRun);
      assert.equal(report.ok, true, JSON.stringify(report.errors));
      assert.deepEqual([report.inserted, report.updated, report.unchanged], [0, 5, 1], `dryRun=${dryRun}`);
      assert.deepEqual((report.warnings ?? []).map((w) => [w.row, w.column, w.code, w.params]), [
        [2, undefined, 'CSV_REFERENCE_RENAMES', { reference: 'DEPT-3', stored: 'Dept 3', name: 'Purchasing', context: 'department' }],
        [3, undefined, 'CSV_REFERENCE_MOVES', { reference: 'DEPT-4', name: 'Dept 4', from: 'Alpha', to: 'Beta', context: 'company' }],
        [6, undefined, 'CSV_REFERENCE_RENAMES', { reference: 'DEPT-7', stored: 'Dept 7', name: 'Seven', context: 'department' }],
        [6, undefined, 'CSV_REFERENCE_MOVES', { reference: 'DEPT-7', name: 'Dept 7', from: 'Alpha', to: 'Beta', context: 'company' }],
      ], `dryRun=${dryRun}`);
    }
    assert.deepEqual(await stored(seeded, 4), { name: 'Dept 4', company_id: seeded.beta, description: null }, 'the load moves despite the warning');
    assert.equal((await stored(seeded, 3)).name, 'Purchasing', 'the load renames despite the warning');
  });
}

async function testExportThenImport() {
  await withDepartments('dref-roundtrip', async (seeded) => {
    // The whole register, and what the list shows (the export dialog's default).
    for (const listQuery of [undefined, exportListQuery({ rows: 'list', sort: 'item_number:ASC' })]) {
      const file = await seeded.svc.exportCsv('data', { manager: seeded.runner.manager, language: 'en', listQuery });
      const lines = file.content.replace(/^﻿/, '').trim().split(/\r?\n/);
      assert.equal(lines[0], 'reference,company_name,name,description,status,disabled_at');
      assert.ok(lines.includes('DEPT-3,Alpha,Dept 3,,enabled,'), lines.slice(0, 4).join('\n'));
      const report = await seeded.svc.importCsv(
        { file: { buffer: Buffer.from(file.content, 'utf8') } as Express.Multer.File, dryRun: false, userId: null, language: 'en' },
        { manager: seeded.runner.manager },
      ) as Report;
      assert.equal(report.ok, true, JSON.stringify(report.errors));
      assert.deepEqual([report.inserted, report.updated, report.unchanged], [0, 0, 31]);
    }
  });
}

/** The page moves to a new department by its reference: the create answer carries the number the database gave it. */
async function testCreateReturnsReference() {
  await withDepartments('ref-create', async (seeded) => {
    const created = await seeded.svc.create({ name: 'Dept new', company_id: seeded.beta } as any, undefined, { manager: seeded.runner.manager });
    assert.equal(typeof created.item_number, 'number', JSON.stringify(created));
    const [stored] = await seeded.runner.query(`SELECT item_number FROM departments WHERE id = $1`, [created.id]);
    assert.equal(created.item_number, stored.item_number);
    assert.equal(await resolveToUuid(`DEPT-${created.item_number}`, 'department', seeded.runner.manager), created.id);
  });
}

void runSpecs('department references', [
  ['a created department comes back with its reference', testCreateReturnsReference],
  ['the reference column filters the list and the ids alike', testReferenceColumnFilter],
  ['the quick search finds a typed reference exactly', testQuickSearch],
  ['the ids carry the references, and the list sorts by reference', testIdsAndSort],
  ['Kad filters and sorts by reference through the list service', testAssistantField],
  ['the file updates by reference, refuses an unknown one and still reads an older file', testImportByReference],
  ['a rename or a move by reference is announced, without blocking the check or the load', testRenameAndMoveWarnings],
  ['an export imports back without change', testExportThenImport],
]);
