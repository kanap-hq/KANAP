// @database-spec
import 'dotenv/config';
import { QueryRunner } from 'typeorm';
import { ContractsService } from '../contracts.service';
import { CurrencySettingsService } from '../../currency/currency-settings.service';
import { FxRateService } from '../../currency/fx-rate.service';
import { CurrencyRateSet } from '../../currency/currency-rate-set.entity';
import { Tenant } from '../../tenants/tenant.entity';
import { adaptFilters } from '../../ai/query/ai-filter.adapter';
import { resolveAiQuerySort } from '../../ai/query/ai-query.executor';
import { contractsRegistry } from '../../ai/query/registries/contracts.registry';
import { seedCompany } from '../../spend/__tests__/cost-center.fixtures';
import { assert, inRolledBackTransaction, runSpecs, seedTenant } from '../../spend/__tests__/round-inputs.fixtures';

/**
 * The contract reference `CTR-n` outside the contract's page (lot R4 of 26.11.9), against a real
 * database, each test rolled back: the list's reference column (filter and sort, on the rows, the
 * ids and the totals), the quick search, the `refs` of the ids, Kad's `reference` filter and sort,
 * and the reference column of the contracts file.
 *
 * Four contracts numbered 3, 13, 30 and 1013: `CTR-3` and `3` find CTR-3; `CTR-013` is text (a
 * number with a leading zero is no reference) and finds the 013 of CTR-1013 alone.
 */

const NUMBERS = [3, 13, 30, 1013] as const;

function service(runner: QueryRunner): ContractsService {
  const audit = { log: async () => undefined };
  const settings = new CurrencySettingsService(runner.manager.getRepository(Tenant), audit as any);
  const fx = new FxRateService(runner.manager.getRepository(CurrencyRateSet), settings);
  const args: any[] = Array.from({ length: 10 }, () => undefined);
  args[4] = audit;
  args[7] = { syncFromSupplier: async () => undefined };
  args[9] = fx;
  return new (ContractsService as any)(...args);
}

async function seed(runner: QueryRunner) {
  const tenantId = await seedTenant(runner, 'contract-refs');
  const { companyId } = await seedCompany(runner, tenantId, 'Fromage Co');
  const [supplier] = await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'Dell') RETURNING id`, [tenantId]);
  const ids: Record<number, string> = {};
  for (const n of NUMBERS) {
    const [row] = await runner.query(
      `INSERT INTO contracts (tenant_id, name, company_id, supplier_id, start_date, item_number, yearly_amount_at_signature, currency)
       VALUES ($1, $2, $3, $4, '2026-01-01', $5, 100, 'EUR') RETURNING id`,
      [tenantId, `Contract number ${['three', 'thirteen', 'thirty', 'one thousand thirteen'][NUMBERS.indexOf(n)]}`, companyId, supplier.id, n],
    );
    ids[n] = row.id;
  }
  return { tenantId, ids, svc: service(runner), opts: { manager: runner.manager } };
}

const columnFilter = (type: string, filter: string) => JSON.stringify({ item_number: { filterType: 'text', type, filter } });

async function testReferenceColumnFilter() {
  await inRolledBackTransaction(async (runner) => {
    const { ids, svc, opts } = await seed(runner);
    const numberOf = new Map(Object.entries(ids).map(([n, id]) => [id, Number(n)]));
    const cases: Array<[string, string, number[]]> = [
      ['equals', 'CTR-3', [3]],
      ['equals', 'ctr-3', [3]],
      ['equals', '3', [3]],
      ['contains', 'CTR-3', [3, 13, 30, 1013]],
      // A leading zero: text, the 013 of CTR-1013, never CTR-13.
      ['contains', 'CTR-013', [1013]],
      ['equals', 'CTR-013', []],
    ];
    for (const [type, filter, expected] of cases) {
      const query = { filters: columnFilter(type, filter), sort: 'item_number:ASC' };
      const page = await svc.list(query, opts);
      assert.deepEqual((page.items as any[]).map((row) => numberOf.get(row.id)), expected, `list ${type} ${filter}`);
      assert.equal(page.total, expected.length, `list total ${type} ${filter}`);
      const listed = await svc.listIds(query, opts);
      assert.deepEqual(listed.ids.map((id) => numberOf.get(id)), expected, `ids ${type} ${filter}`);
      const totals = await svc.totals(query, opts);
      assert.equal(totals.count, expected.length, `totals ${type} ${filter}`);
    }
    // The column sorts by number, not as text.
    const desc = await svc.list({ sort: 'item_number:DESC' }, opts);
    assert.deepEqual((desc.items as any[]).map((row) => numberOf.get(row.id)), [1013, 30, 13, 3], 'numeric sort');
    assert.deepEqual((desc.items as any[]).map((row) => row.item_number), [1013, 30, 13, 3], 'the rows carry their number');
  });
}

async function testQuickSearch() {
  await inRolledBackTransaction(async (runner) => {
    const { ids, svc, opts } = await seed(runner);
    const numberOf = new Map(Object.entries(ids).map(([n, id]) => [id, Number(n)]));
    const cases: Array<[string, number[]]> = [
      ['CTR-3', [3]],
      ['ctr-3', [3]],
      ['CTR-30', [30]],
      // Digits alone and a leading zero stay a text search: no name holds them.
      ['13', []],
      ['CTR-013', []],
      // The text search is unchanged.
      ['thirt', [13, 30, 1013]],
    ];
    for (const [q, expected] of cases) {
      const page = await svc.list({ q, sort: 'item_number:ASC' }, opts);
      assert.deepEqual((page.items as any[]).map((row) => numberOf.get(row.id)), expected, `q=${q}`);
      const listed = await svc.listIds({ q, sort: 'item_number:ASC' }, opts);
      assert.deepEqual(listed.ids.map((id) => numberOf.get(id)), expected, `ids q=${q}`);
      assert.equal((await svc.totals({ q }, opts)).count, expected.length, `totals q=${q}`);
    }
  });
}

async function testIdsCarryReferences() {
  await inRolledBackTransaction(async (runner) => {
    const { ids, svc, opts } = await seed(runner);
    const listed = await svc.listIds({ sort: 'item_number:ASC' }, opts);
    assert.deepEqual(listed.ids, NUMBERS.map((n) => ids[n]));
    assert.deepEqual(listed.refs, ['CTR-3', 'CTR-13', 'CTR-30', 'CTR-1013'], 'one reference per id, in the same order');
  });
}

// The page of a new contract opens by its reference: the creation's answer carries the number.
async function testCreateAnswersTheReference() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, svc, opts } = await seed(runner);
    const [company] = await runner.query(`SELECT id FROM companies WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
    const [supplier] = await runner.query(`SELECT id FROM suppliers WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
    const created: any = await svc.create({
      name: 'Created by the page', company_id: company.id, supplier_id: supplier.id, start_date: '2026-01-01' as any,
      duration_months: 12 as any, currency: 'EUR' as any,
    } as any, undefined, opts);
    const [stored] = await runner.query(`SELECT item_number FROM contracts WHERE id = $1`, [created.id]);
    assert.ok(Number(stored.item_number) > 1013);
    assert.equal(Number(created.item_number), Number(stored.item_number), 'the answer carries the stored number');
  });
}

async function testAssistantReferenceFilterAndSort() {
  await inRolledBackTransaction(async (runner) => {
    const { ids, svc, opts } = await seed(runner);
    const numberOf = new Map(Object.entries(ids).map(([n, id]) => [id, Number(n)]));
    const adapted = adaptFilters(contractsRegistry, { reference: ['CTR-13', 'CTR-013', '30', 'SUP-3'] });
    assert.deepEqual(adapted.applied, ['reference'], JSON.stringify(adapted));
    const sort = resolveAiQuerySort(contractsRegistry, { field: 'reference', direction: 'desc' });
    assert.equal(sort.param, 'item_number:DESC');
    const page = await svc.list({ filters: JSON.stringify(adapted.filters), sort: sort.param }, opts);
    assert.deepEqual((page.items as any[]).map((row) => numberOf.get(row.id)), [30, 13], 'CTR-13 and 30; CTR-013 and SUP-3 name none');
    const single = adaptFilters(contractsRegistry, { reference: 'ctr-3' });
    const one = await svc.list({ filters: JSON.stringify(single.filters) }, opts);
    assert.deepEqual((one.items as any[]).map((row) => numberOf.get(row.id)), [3]);
    const sorted = await svc.list({ sort: resolveAiQuerySort(contractsRegistry, { field: 'reference', direction: 'asc' }).param }, opts);
    assert.deepEqual((sorted.items as any[]).map((row) => numberOf.get(row.id)), [3, 13, 30, 1013], 'sorted by reference');
  });
}

function file(content: string): Express.Multer.File {
  return { buffer: Buffer.from(content, 'utf8') } as Express.Multer.File;
}

const OLD_HEADER =
  'name;company_name;supplier_name;start_date;duration_months;auto_renewal;notice_period_months;yearly_amount_at_signature;currency;billing_frequency;status;owner_email;notes';
const HEADER = `reference;${OLD_HEADER}`;
const row = (reference: string, name: string, amount = '100') =>
  `${reference};${name};Fromage Co;Dell;2026-01-01;12;yes;1;${amount};EUR;annual;;;`;

async function testImportByReference() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, ids, svc, opts } = await seed(runner);

    // The export writes the reference first; importing it back changes nothing.
    const exported = await svc.exportCsv('data', opts);
    const lines = exported.content.replace(/^﻿/, '').trim().split('\n');
    assert.ok(lines[0].startsWith('Reference,Name,'), lines[0]);
    assert.deepEqual(lines.slice(1).map((line) => line.split(',')[0]).sort(), ['CTR-1013', 'CTR-13', 'CTR-3', 'CTR-30']);
    const again: any = await svc.importCsv({ file: file(exported.content), dryRun: false }, opts);
    assert.equal(again.ok, true, JSON.stringify(again.errors));
    assert.deepEqual([again.inserted, again.updated, again.unchanged], [0, 0, 4], 'export then import: unchanged');

    // A reference names the contract to update, even renamed; the bare number too.
    const renamed: any = await svc.importCsv({
      file: file([HEADER, row('CTR-3', 'Renamed three'), row('13', 'Contract number thirteen', '250'), row('', 'Brand new')].join('\n')),
      dryRun: false,
    }, opts);
    assert.equal(renamed.ok, true, JSON.stringify(renamed.errors));
    assert.deepEqual([renamed.inserted, renamed.updated, renamed.unchanged], [1, 2, 0], 'rename by reference, amount by number, one new');
    const stored = await runner.query(
      `SELECT id, name, yearly_amount_at_signature::text AS amount FROM contracts WHERE tenant_id = $1 AND id = ANY($2) ORDER BY item_number`,
      [tenantId, [ids[3], ids[13]]],
    );
    assert.deepEqual(stored.map((r: any) => [r.id, r.name, r.amount]), [
      [ids[3], 'Renamed three', '100.00'],
      [ids[13], 'Contract number thirteen', '250.00'],
    ]);
    const [{ n }] = await runner.query(`SELECT count(*)::int AS n FROM contracts WHERE tenant_id = $1`, [tenantId]);
    assert.equal(n, 5, 'the renamed contract was updated, not duplicated');

    // An unknown or malformed reference refuses its row, with its line; nothing is written.
    for (const dryRun of [true, false]) {
      const refused: any = await svc.importCsv({
        file: file([HEADER, row('CTR-30', 'Contract number thirty', '999'), row('CTR-999', 'Ghost'), row('CTR-013', 'Padded')].join('\n')),
        dryRun,
      }, opts);
      assert.equal(refused.ok, false);
      assert.deepEqual(
        refused.errors.filter((e: any) => e.column === 'reference').map((e: any) => [e.row, e.code, e.params?.value]),
        [[3, 'CSV_RECORD_REFERENCE_NOT_FOUND', 'CTR-999'], [4, 'CSV_RECORD_REFERENCE_NOT_FOUND', 'CTR-013']],
        JSON.stringify(refused.errors),
      );
    }
    const [thirty] = await runner.query(`SELECT yearly_amount_at_signature::text AS amount FROM contracts WHERE id = $1`, [ids[30]]);
    assert.equal(thirty.amount, '100.00', 'a refused file writes nothing');

    // A file without the reference column is read as before: by name and supplier.
    const old: any = await svc.importCsv({
      file: file([OLD_HEADER, 'Contract number thirty;Fromage Co;Dell;2026-01-01;12;yes;1;300;EUR;annual;;;'].join('\n')),
      dryRun: false,
    }, opts);
    assert.equal(old.ok, true, JSON.stringify(old.errors));
    assert.deepEqual([old.inserted, old.updated], [0, 1]);
    const [updated] = await runner.query(`SELECT yearly_amount_at_signature::text AS amount FROM contracts WHERE id = $1`, [ids[30]]);
    assert.equal(updated.amount, '300.00');
  });
}

// D12: a filled reference that renames its contract or moves it to another supplier is said by the
// check, without blocking (a file of another workspace names unrelated contracts by the same
// references). Nothing is said when the stored value stays, nor for a row without a reference.
async function testImportWarnsOfRenamesAndMoves() {
  await inRolledBackTransaction(async (runner) => {
    const { tenantId, ids, svc, opts } = await seed(runner);
    await runner.query(`INSERT INTO suppliers (tenant_id, name) VALUES ($1, 'HP')`, [tenantId]);
    const onSupplier = (reference: string, name: string, supplier: string) =>
      `${reference};${name};Fromage Co;${supplier};2026-01-01;12;yes;1;100;EUR;annual;;;`;
    const content = [
      HEADER,
      row('CTR-3', 'Renamed three'),
      onSupplier('CTR-13', 'Contract number thirteen', 'HP'),
      onSupplier('ctr-30', 'Thirty on HP', 'HP'),
      row('CTR-1013', 'contract number one thousand thirteen'),
    ].join('\n');
    for (const dryRun of [true, false]) {
      await runner.query('SAVEPOINT warn_run');
      const report: any = await svc.importCsv({ file: file(content), dryRun }, opts);
      assert.equal(report.ok, true, JSON.stringify(report.errors));
      assert.deepEqual(
        (report.warnings ?? []).map((w: any) => [w.row, w.code, w.params]),
        [
          [2, 'CSV_REFERENCE_RENAMES', { reference: 'CTR-3', stored: 'Contract number three', name: 'Renamed three', context: 'contract' }],
          [3, 'CSV_REFERENCE_MOVES', { reference: 'CTR-13', name: 'Contract number thirteen', from: 'Dell', to: 'HP', context: 'supplier' }],
          [4, 'CSV_REFERENCE_RENAMES', { reference: 'CTR-30', stored: 'Contract number thirty', name: 'Thirty on HP', context: 'contract' }],
          [4, 'CSV_REFERENCE_MOVES', { reference: 'CTR-30', name: 'Contract number thirty', from: 'Dell', to: 'HP', context: 'supplier' }],
          [5, 'CSV_REFERENCE_RENAMES', { reference: 'CTR-1013', stored: 'Contract number one thousand thirteen', name: 'contract number one thousand thirteen', context: 'contract' }],
        ],
        `dryRun=${dryRun}: ${JSON.stringify(report.warnings)}`,
      );
      await runner.query('ROLLBACK TO SAVEPOINT warn_run');
    }
    // Rows that keep the stored name and supplier: no warning.
    const same: any = await svc.importCsv({ file: file([HEADER, row('CTR-3', 'Contract number three', '120')].join('\n')), dryRun: true }, opts);
    assert.equal(same.ok, true, JSON.stringify(same.errors));
    assert.deepEqual(same.warnings ?? [], []);
    const [three] = await runner.query(`SELECT name FROM contracts WHERE id = $1`, [ids[3]]);
    assert.equal(three.name, 'Contract number three');

    // A reference and a name that name the same contract: one row per contract, the second refused.
    const twice: any = await svc.importCsv({
      file: file([HEADER, row('', 'Contract number thirty', '150'), row('CTR-30', 'Thirty renamed', '160')].join('\n')),
      dryRun: true,
    }, opts);
    assert.equal(twice.ok, false);
    assert.deepEqual(twice.errors.map((e: any) => [e.row, e.column, e.code, e.params]), [
      [3, 'reference', 'CSV_SAME_RECORD', { firstRow: 2, reference: 'CTR-30' }],
    ]);
  });
}

void runSpecs('contract references outside the page (R4)', [
  ['reference column filter on the list, the ids and the totals; numeric sort', testReferenceColumnFilter],
  ['quick search: CTR-n exactly, digits stay text', testQuickSearch],
  ['the ids carry the references', testIdsCarryReferences],
  ['the creation answers the reference', testCreateAnswersTheReference],
  ['Kad: reference filter and sort through the list', testAssistantReferenceFilterAndSort],
  ['import by reference, unknown refused, old file, export round trip', testImportByReference],
  ['import warns of renames and supplier moves by reference', testImportWarnsOfRenamesAndMoves],
]);
