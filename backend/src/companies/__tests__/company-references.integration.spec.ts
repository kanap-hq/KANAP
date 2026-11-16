import 'dotenv/config';
// @database-spec: opens the data-source through runSpecs, so it runs on a database lane.
import { QueryRunner } from 'typeorm';
import { CompaniesService } from '../companies.service';
import { Company } from '../company.entity';
import { CompanyMetric } from '../company-metric.entity';
import { CompanyMetricsService } from '../company-metrics.service';
import { companiesRegistry } from '../../ai/query/registries/companies.registry';
import { adaptFilters } from '../../ai/query/ai-filter.adapter';
import { resolveToUuid } from '../../common/resolve-item-id';
import {
  assert,
  captureAudit,
  inRolledBackTransaction,
  realFreeze,
  runSpecs,
  seedTenant,
  underSavepoint,
} from '../../spend/__tests__/round-inputs.fixtures';

// The company reference (`COMP-n`, lot R2 of 26.11.9) in the list and its file: the reference
// column's filter (list, ids, totals), the quick search on a typed reference, the references of
// the ids, the sort, Kad's `reference` field through the list service, and the file's optional
// `reference` column (update by reference, unknown reference refused, older file accepted,
// export then import without change).

const YEAR = 2026;

function service(runner: QueryRunner) {
  const audit = captureAudit() as any;
  const metrics = new CompanyMetricsService(runner.manager.getRepository(CompanyMetric), audit, realFreeze());
  // The totals convert turnovers: every company is in euros, the reporting currency.
  const fx = {
    resolveRates: async (_tenantId: string, lookups: Array<{ sourceCurrency: string; fiscalYear: number; rateSetId?: string | null }>) => ({
      map: new Map(lookups.map((l) => [`${l.rateSetId || 'live'}:${l.fiscalYear}:${l.sourceCurrency}`, {
        rate: 1, rateSetId: null, fiscalYear: l.fiscalYear, reportingCurrency: 'EUR', source: 'identity', capturedAt: null,
      }])),
      settings: { reportingCurrency: 'EUR' },
    }),
  };
  return new CompaniesService(runner.manager.getRepository(Company), audit, metrics, fx as any);
}

type Seeded = { runner: QueryRunner; tenantId: string; svc: CompaniesService; idOf: (n: number) => string };

/** 31 companies, `Company 1` to `Company 31`, numbered COMP-1 to COMP-31, each with a headcount of 1 in YEAR. */
async function withCompanies(tag: string, fn: (seeded: Seeded) => Promise<void>) {
  await inRolledBackTransaction(async (runner) => {
    const tenantId = await seedTenant(runner, tag);
    const ids = new Map<number, string>();
    for (let n = 1; n <= 31; n += 1) {
      const [row] = await runner.query(
        `INSERT INTO companies (tenant_id, name, country_iso, city, base_currency, item_number)
         VALUES ($1, $2, 'FR', 'Lyon', 'EUR', $3) RETURNING id`,
        [tenantId, `Company ${n}`, n],
      );
      ids.set(n, row.id);
      await runner.query(
        `INSERT INTO company_metrics (tenant_id, company_id, fiscal_year, headcount) VALUES ($1, $2, $3, 1)`,
        [tenantId, row.id, YEAR],
      );
    }
    await fn({ runner, tenantId, svc: service(runner), idOf: (n) => ids.get(n)! });
  });
}

/** The numbers of the companies a list call returns, sorted. */
async function listed(seeded: Seeded, query: Record<string, unknown>): Promise<number[]> {
  const { items } = await seeded.svc.list({ limit: 100, ...query }, { manager: seeded.runner.manager });
  return (items as Company[]).map((item) => item.item_number).sort((a, b) => a - b);
}

/** The list, the ids of the record's band and the totals agree on a query. */
async function sameEverywhere(seeded: Seeded, query: Record<string, unknown>): Promise<number[]> {
  const numbers = await listed(seeded, query);
  const { ids, refs, total } = await seeded.svc.listIds(query, { manager: seeded.runner.manager });
  assert.equal(total, numbers.length, `ids total of ${JSON.stringify(query)}`);
  assert.deepEqual(ids.map((id) => numbers.find((n) => seeded.idOf(n) === id)).sort((a, b) => a! - b!), numbers);
  assert.deepEqual(refs.slice().sort(), numbers.map((n) => `COMP-${n}`).sort());
  const totals = await seeded.svc.totals({ ...query, year: YEAR }, { manager: seeded.runner.manager, tenantId: seeded.tenantId });
  assert.equal(totals.headcount ?? 0, numbers.length, `totals of ${JSON.stringify(query)}`);
  return numbers;
}

const column = (model: Record<string, unknown>) => ({ filters: JSON.stringify({ item_number: model }) });

async function testReferenceColumnFilter() {
  await withCompanies('ref-filter', async (seeded) => {
    assert.deepEqual(await sameEverywhere(seeded, column({ filterType: 'text', type: 'equals', filter: 'COMP-3' })), [3]);
    assert.deepEqual(await sameEverywhere(seeded, column({ filterType: 'text', type: 'equals', filter: '3' })), [3]);
    assert.deepEqual(await sameEverywhere(seeded, column({ filterType: 'text', type: 'equals', filter: 'comp-3' })), [3]);
    // COMP-013 names no company: no match.
    assert.deepEqual(await sameEverywhere(seeded, column({ filterType: 'text', type: 'equals', filter: 'COMP-013' })), []);
    // Contains reads the digits, as the other reference columns do.
    assert.deepEqual(await sameEverywhere(seeded, column({ filterType: 'text', type: 'contains', filter: 'COMP-3' })), [3, 13, 23, 30, 31]);
  });
}

async function testQuickSearch() {
  await withCompanies('ref-search', async (seeded) => {
    assert.deepEqual(await sameEverywhere(seeded, { q: 'COMP-3' }), [3]);
    assert.deepEqual(await sameEverywhere(seeded, { q: 'comp-3' }), [3]);
    assert.deepEqual(await sameEverywhere(seeded, { q: 'COMP-30' }), [30], 'COMP-30 does not find COMP-3');
    assert.deepEqual(await sameEverywhere(seeded, { q: 'COMP-013' }), [], 'a leading zero is no reference');
    // Digits alone stay the text search (the names hold them).
    assert.deepEqual(await sameEverywhere(seeded, { q: '3' }), [3, 13, 23, 30, 31]);
  });
}

async function testIdsAndSort() {
  await withCompanies('ref-ids', async (seeded) => {
    const { ids, refs } = await seeded.svc.listIds({ sort: 'item_number:DESC' }, { manager: seeded.runner.manager });
    assert.equal(ids.length, 31);
    assert.equal(ids[0], seeded.idOf(31));
    assert.equal(refs[0], 'COMP-31');
    assert.equal(refs[30], 'COMP-1');
    ids.forEach((id, index) => assert.equal(refs[index], `COMP-${32 - (index + 1)}`, `ref of ${id}`));
    const { items } = await seeded.svc.list({ sort: 'item_number:ASC', limit: 3 }, { manager: seeded.runner.manager });
    assert.deepEqual((items as Company[]).map((item) => item.item_number), [1, 2, 3]);
  });
}

/** Kad's `reference` field: the adapter's filter and the registry's sort, through the list service. */
async function testAssistantField() {
  await withCompanies('ref-kad', async (seeded) => {
    assert.equal(companiesRegistry.fields.reference.grid, 'item_number');
    assert.equal(companiesRegistry.sortFields.reference, 'item_number');
    const adapted = adaptFilters(companiesRegistry, { reference: ['COMP-3', '12', 'COMP-013', 'DEPT-4'] });
    assert.deepEqual(adapted.applied, ['reference']);
    assert.deepEqual(await sameEverywhere(seeded, { filters: JSON.stringify(adapted.filters) }), [3, 12]);
    const sort = `${companiesRegistry.sortFields.reference}:DESC`;
    const { items } = await seeded.svc.list({ sort, limit: 2 }, { manager: seeded.runner.manager });
    assert.deepEqual((items as Company[]).map((item) => item.item_number), [31, 30]);
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

const BASE = ['name', 'country_iso', 'address1', 'address2', 'postal_code', 'city', 'state', 'reg_number', 'vat_number', 'base_currency', 'status', 'disabled_at', 'notes'];

function fileOf(headers: readonly string[], rows: Array<Record<string, string>>): Express.Multer.File {
  const lines = [headers.join(','), ...rows.map((row) => headers.map((header) => row[header] ?? '').join(','))];
  return { buffer: Buffer.from(`${lines.join('\n')}\n`, 'utf8') } as Express.Multer.File;
}

function importer(seeded: Seeded) {
  return (headers: readonly string[], rows: Array<Record<string, string>>, dryRun = false) => seeded.svc.importCsv(
    { file: fileOf(headers, rows), dryRun, userId: null, language: 'en', year: YEAR },
    { manager: seeded.runner.manager },
  ) as Promise<Report>;
}

const row = (over: Record<string, string>) => ({ country_iso: 'FR', city: 'Lyon', base_currency: 'EUR', status: 'enabled', ...over });

async function namesOf(seeded: Seeded): Promise<Map<number, string>> {
  const rows: Array<{ item_number: number; name: string }> = await seeded.runner.query(
    `SELECT item_number, name FROM companies WHERE tenant_id = $1`, [seeded.tenantId],
  );
  return new Map(rows.map((r) => [r.item_number, r.name]));
}

async function testImportByReference() {
  await withCompanies('ref-import', async (seeded) => {
    const run = importer(seeded);
    const headers = ['reference', ...BASE];
    // A filled reference names the company: the name is a value of the row (a rename).
    for (const dryRun of [true, false]) {
      const report = await run(headers, [row({ reference: 'COMP-3', name: 'Renamed three' }), row({ reference: '4', name: 'Renamed four' })], dryRun);
      assert.equal(report.ok, true, JSON.stringify(report.errors));
      assert.deepEqual([report.inserted, report.updated], [0, 2], `dryRun=${dryRun}`);
    }
    const names = await namesOf(seeded);
    assert.equal(names.get(3), 'Renamed three');
    assert.equal(names.get(4), 'Renamed four');
    assert.equal(names.size, 31, 'nothing created');

    // An empty reference keeps the name as the key; a new name creates the company.
    const byName = await run(headers, [row({ reference: '', name: 'company 5', notes: 'by name' }), row({ reference: '', name: 'Brand new' })]);
    assert.equal(byName.ok, true, JSON.stringify(byName.errors));
    assert.deepEqual([byName.inserted, byName.updated], [1, 1]);
    assert.equal((await namesOf(seeded)).get(5), 'Company 5', 'the stored spelling stays');

    // An unknown reference, or one that is no company reference, refuses its row, by number.
    const unknown = await run(headers, [row({ reference: 'COMP-6', name: 'Company 6' }), row({ reference: 'COMP-999', name: 'Ghost' })]);
    assert.equal(unknown.ok, false);
    assert.deepEqual(unknown.errors.map((e) => [e.row, e.column, e.code, e.params?.value]), [[3, 'reference', 'CSV_RECORD_REFERENCE_NOT_FOUND', 'COMP-999']]);
    const padded = await run(headers, [row({ reference: 'COMP-013', name: 'Padded' }), row({ reference: 'DEPT-3', name: 'Other family' })]);
    assert.deepEqual(padded.errors.map((e) => [e.row, e.column, e.code, e.params?.value]), [
      [2, 'reference', 'CSV_RECORD_REFERENCE_NOT_FOUND', 'COMP-013'],
      [3, 'reference', 'CSV_RECORD_REFERENCE_NOT_FOUND', 'DEPT-3'],
    ]);

    // A rename onto another company's name, a reference twice, or a row by name on a company
    // another row names by reference: refused.
    const taken = await run(headers, [row({ reference: 'COMP-7', name: 'Company 8' })]);
    assert.deepEqual(taken.errors.map((e) => [e.row, e.column, e.code, e.params]), [[2, 'name', 'CSV_VALUE_TAKEN', { value: 'Company 8', reference: 'COMP-8' }]]);
    const twice = await run(headers, [row({ reference: 'COMP-7', name: 'Seven' }), row({ reference: 'comp-7', name: 'Seven again' })]);
    assert.deepEqual(twice.errors.map((e) => [e.row, e.column, e.code]), [[3, 'reference', 'CSV_DUPLICATE_KEY']]);
    const same = await run(headers, [row({ reference: 'COMP-9', name: 'Nine' }), row({ reference: '', name: 'Company 9' })]);
    assert.deepEqual(same.errors.map((e) => [e.row, e.column, e.code, e.params]), [[3, 'name', 'CSV_SAME_RECORD', { firstRow: 2, reference: 'COMP-9' }]]);
    assert.equal((await namesOf(seeded)).get(9), 'Company 9', 'a refused file writes nothing');

    // An older file, without the column, still imports.
    const older = await run(BASE, [row({ name: 'Company 10', notes: 'older file' })]);
    assert.equal(older.ok, true, JSON.stringify(older.errors));
    assert.deepEqual([older.inserted, older.updated], [0, 1]);
  });
}

/**
 * A filled reference that renames its company is announced, without blocking the check or the
 * load (D12: a file from another workspace would otherwise rename unrelated companies, since
 * COMP-3 exists everywhere). A row whose name is stored as is, or a row without a reference,
 * announces nothing.
 */
async function testRenameWarning() {
  await withCompanies('ref-renames', async (seeded) => {
    const run = importer(seeded);
    const headers = ['reference', ...BASE];
    const rows = [
      row({ reference: 'COMP-3', name: 'Beta' }),
      row({ reference: 'COMP-4', name: 'Company 4', notes: 'same name' }),
      row({ reference: '', name: 'Company 5', notes: 'by name' }),
      row({ reference: '6', name: 'company 6' }),
      row({ reference: 'COMP-7', name: 'Company 7' }),
    ];
    for (const dryRun of [true, false]) {
      const report = await run(headers, rows, dryRun);
      assert.equal(report.ok, true, JSON.stringify(report.errors));
      assert.deepEqual([report.inserted, report.updated, report.unchanged], [0, 4, 1], `dryRun=${dryRun}`);
      assert.deepEqual((report.warnings ?? []).map((w) => [w.row, w.column, w.code, w.params]), [
        [2, undefined, 'CSV_REFERENCE_RENAMES', { reference: 'COMP-3', stored: 'Company 3', name: 'Beta', context: 'company' }],
        [5, undefined, 'CSV_REFERENCE_RENAMES', { reference: 'COMP-6', stored: 'Company 6', name: 'company 6', context: 'company' }],
      ], `dryRun=${dryRun}`);
    }
    const names = await namesOf(seeded);
    assert.equal(names.get(3), 'Beta', 'the load renames despite the warning');
    assert.equal(names.get(6), 'company 6');
  });
}

async function testExportThenImport() {
  await withCompanies('ref-roundtrip', async (seeded) => {
    const file = await seeded.svc.exportCsv('data', { manager: seeded.runner.manager, language: 'en', year: YEAR });
    const lines = file.content.replace(/^﻿/, '').trim().split(/\r?\n/);
    assert.equal(lines[0].split(',')[0], 'reference');
    assert.ok(lines.slice(1).some((line) => line.startsWith('COMP-3,Company 3,')), lines.slice(0, 3).join('\n'));
    const report = await seeded.svc.importCsv(
      { file: { buffer: Buffer.from(file.content, 'utf8') } as Express.Multer.File, dryRun: false, userId: null, language: 'en', year: YEAR },
      { manager: seeded.runner.manager },
    ) as Report;
    assert.equal(report.ok, true, JSON.stringify(report.errors));
    assert.deepEqual([report.inserted, report.updated, report.unchanged], [0, 0, 31]);
    const template = await seeded.svc.exportCsv('template', { manager: seeded.runner.manager, language: 'en', year: YEAR });
    const [templateHeaders, example] = template.content.replace(/^﻿/, '').trim().split(/\r?\n/);
    assert.equal(templateHeaders.split(',')[0], 'reference');
    assert.equal(example.split(',')[0], '', 'the example company has no reference');
  });
}

/** The page moves to a new company by its reference: the create answer carries the number the database gave it. */
async function testCreateReturnsReference() {
  await withCompanies('ref-create', async (seeded) => {
    const created = await seeded.svc.create(
      { name: 'Company new', country_iso: 'FR', city: 'Lyon', base_currency: 'EUR' } as any,
      undefined,
      { manager: seeded.runner.manager },
    );
    assert.equal(typeof created.item_number, 'number', JSON.stringify(created));
    const [stored] = await seeded.runner.query(`SELECT item_number FROM companies WHERE id = $1`, [created.id]);
    assert.equal(created.item_number, stored.item_number);
    assert.equal(await resolveToUuid(`COMP-${created.item_number}`, 'company', seeded.runner.manager), created.id);
  });
}

// One row per company: a second row naming the same company, by its reference (the family's
// CSV_DUPLICATE_KEY on the reference) or by its name (CSV_COMPANY_NAME_DUPLICATE), is refused on its line, at the check as at the
// load; a new company named twice too. Nothing is written.
async function testImportRefusesSecondRowOfACompany() {
  await withCompanies('ref-second-row', async (seeded) => {
    const run = importer(seeded);
    const headers = ['reference', ...BASE];
    const stored = async () => seeded.runner.query(
      `SELECT name, notes FROM companies WHERE tenant_id = $1 ORDER BY item_number`, [seeded.tenantId],
    );
    const before = await stored();
    const cases: Array<[string, Array<Record<string, string>>, Array<[number, string, string, Record<string, unknown>]>]> = [
      ['same reference', [row({ reference: 'COMP-8', name: 'Company 8', notes: 'A' }), row({ reference: '8', name: 'Eight renamed', notes: 'B' })],
        [[3, 'reference', 'CSV_DUPLICATE_KEY', { columns: 'reference', firstRow: 2 }]]],
      ['same name', [row({ reference: '', name: 'Company 8', notes: 'A' }), row({ reference: '', name: 'company 8', notes: 'B' })],
        [[3, 'name', 'CSV_COMPANY_NAME_DUPLICATE', { name: 'company 8', firstRow: 2 }]]],
      ['a new company twice', [row({ reference: '', name: 'Brand new', notes: 'A' }), row({ reference: '', name: 'brand NEW', notes: 'B' })],
        [[3, 'name', 'CSV_COMPANY_NAME_DUPLICATE', { name: 'brand NEW', firstRow: 2 }]]],
    ];
    for (const [label, rows, expected] of cases) {
      for (const dryRun of [true, false]) {
        const report = await run(headers, rows, dryRun);
        assert.equal(report.ok, false, `${label}, dryRun=${dryRun}: ${JSON.stringify(report)}`);
        assert.deepEqual(report.errors.map((e) => [e.row, e.column, e.code, e.params]), expected, `${label}, dryRun=${dryRun}`);
      }
    }
    assert.deepEqual(await stored(), before, 'a refused file writes nothing');
  });
}

// A rename by reference and another row of the file that lead to the same name, whatever its case:
// the second row is refused on its line (CSV_COMPANY_NAME_DUPLICATE), at the check as at the load,
// and nothing is written. The load runs under a savepoint, so a refusal by the database shows.
async function testImportRefusesARenameOntoAnotherRowsName() {
  await withCompanies('ref-rename-collision', async (seeded) => {
    const run = importer(seeded);
    const attempt = (rows: Array<Record<string, string>>, dryRun: boolean) => underSavepoint(seeded.runner, () => run(headers, rows, dryRun))
      .catch((err: Error) => ({ ok: false, errors: [], thrown: err.message }) as Report & { thrown: string });
    const headers = ['reference', ...BASE];
    const stored = async () => seeded.runner.query(
      `SELECT name, notes FROM companies WHERE tenant_id = $1 ORDER BY item_number`, [seeded.tenantId],
    );
    const before = await stored();
    const cases: Array<[string, Array<Record<string, string>>, string]> = [
      ['a rename, then a new company', [row({ reference: 'COMP-8', name: 'Fresh name' }), row({ reference: '', name: 'fresh NAME' })], 'fresh NAME'],
      ['a new company, then a rename', [row({ reference: '', name: 'Fresh name' }), row({ reference: 'COMP-8', name: 'fresh NAME' })], 'fresh NAME'],
      ['two renames', [row({ reference: 'COMP-8', name: 'Same name' }), row({ reference: 'COMP-9', name: 'same NAME' })], 'same NAME'],
    ];
    for (const [label, rows, name] of cases) {
      for (const dryRun of [true, false]) {
        const report = await attempt(rows, dryRun);
        assert.equal(report.ok, false, `${label}, dryRun=${dryRun}: ${JSON.stringify(report)}`);
        assert.deepEqual(report.errors.map((e) => [e.row, e.column, e.code, e.params]),
          [[3, 'name', 'CSV_COMPANY_NAME_DUPLICATE', { name, firstRow: 2 }]], `${label}, dryRun=${dryRun}: ${JSON.stringify(report)}`);
      }
    }
    assert.deepEqual(await stored(), before, 'a refused file writes nothing');
  });
}

void runSpecs('company references', [
  ['a created company comes back with its reference', testCreateReturnsReference],
  ['the reference column filters the list, the ids and the totals alike', testReferenceColumnFilter],
  ['the quick search finds a typed reference exactly', testQuickSearch],
  ['the ids carry the references, and the list sorts by reference', testIdsAndSort],
  ['Kad filters and sorts by reference through the list service', testAssistantField],
  ['the file updates by reference, refuses an unknown one and still reads an older file', testImportByReference],
  ['the file refuses a second row of the same company', testImportRefusesSecondRowOfACompany],
  ['the file refuses a rename onto the name of another row', testImportRefusesARenameOntoAnotherRowsName],
  ['a rename by reference is announced, without blocking the check or the load', testRenameWarning],
  ['an export imports back without change', testExportThenImport],
]);
