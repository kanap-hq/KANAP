import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { parseDecimalMark } from '../../../common/csv-sheet';
import { writeCsv } from '../../../common/csv-sheet';
import { buildBudgetExport, exportListQuery, parseAmountYears, parseFileColumns } from '../export-file';
import { readBudgetCsv } from '../interpret';
import { periodForYearlyTotal } from '../period';
import { buildPreflight, planBudgetFile } from '../preflight';
import { budgetFileSchema, OLD_BUDGET_FILE_MESSAGE } from '../columns';
import { formatToken, parseToken, tokenError } from '../token';
import { BUDGET_FILE_MAX_BYTES } from '../upload';
import {
  BudgetCatalog,
  BudgetFileScope,
  LineHint,
  StoredLine,
  emptyCatalog,
  emptyMonths,
} from '../types';

// The budget file's own rules. No database: the loader is covered separately.

const YEAR = 2026;

function line(patch: Partial<StoredLine> = {}): StoredLine {
  return {
    id: 'line-1',
    itemNumber: 3,
    rowVersion: 7,
    name: 'Widget',
    description: null,
    ppeType: null,
    investmentType: null,
    priority: null,
    companyId: null,
    companyName: null,
    supplierId: null,
    supplierName: null,
    supplierErpId: null,
    accountId: null,
    accountNumber: null,
    costCenterId: null,
    costCenterCode: null,
    runBuild: null,
    analytics: {},
    ownerItEmail: null,
    ownerBusinessEmail: null,
    projectNumber: null,
    currency: 'EUR',
    effectiveStart: '2026-01-01',
    endOfValidity: null,
    notes: null,
    versions: [],
    ...patch,
  };
}

function withJanuary(cents: bigint | null) {
  const months = emptyMonths();
  months.planned[0] = { cents };
  return [{ id: 'ver-2026', year: YEAR, budgetRev: 3, months }];
}

function catalog(patch: Partial<BudgetCatalog> = {}): BudgetCatalog {
  return emptyCatalog(patch);
}

async function preflight(
  scope: BudgetFileScope,
  text: string,
  stored: StoredLine[],
  options: {
    language?: 'en' | 'fr' | 'de' | 'es';
    names?: LineHint[];
    cat?: BudgetCatalog;
    createSuppliers?: boolean;
    canCreateSuppliers?: boolean;
    labels?: Record<string, string>;
    dimensions?: string[];
  } = {},
) {
  const read = await readBudgetCsv(text, {
    scope,
    language: options.language ?? 'en',
    dimensionCodes: options.dimensions ?? [],
  });
  return buildPreflight({
    scope,
    read,
    catalog: options.cat ?? catalog(),
    stored,
    names: options.names ?? stored.map((item) => ({ itemNumber: item.itemNumber, name: item.name, supplierId: item.supplierId })),
    createSuppliers: options.createSuppliers ?? false,
    canCreateSuppliers: options.canCreateSuppliers ?? false,
    currentYear: YEAR,
    labels: options.labels ?? { budget: 'Budget' },
  });
}

async function testDecimalMarkParameter() {
  assert.equal(parseDecimalMark('comma'), ',');
  assert.equal(parseDecimalMark('dot'), '.');
  for (const raw of ['', undefined, null]) assert.equal(parseDecimalMark(raw), undefined);
  for (const raw of ['x', '.', ',', 'COMMA']) {
    assert.throws(() => parseDecimalMark(raw), (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.equal(error.getStatus(), 400);
      assert.equal(error.message, 'decimalMark must be comma or dot.');
      return true;
    });
  }
}

async function testTokenLanguages() {
  assert.equal(formatToken(7, [{ year: 2027, rev: 1 }, { year: 2026, rev: 3 }], 'fr'), 'v7.2026r3.2027r1.fr');
  assert.equal(formatToken(7, [], 'fr'), 'v7.fr');
  for (const language of ['en', 'fr', 'de', 'es'] as const) {
    const raw = `v7.2026r3.2027r1.${language}`;
    assert.deepEqual(parseToken(raw), {
      kind: 'ok', raw, rowVersion: 7, years: [{ year: 2026, rev: 3 }, { year: 2027, rev: 1 }], language,
    });
    assert.deepEqual(parseToken(`V7.${language.toUpperCase()}`), {
      kind: 'ok', raw: `V7.${language.toUpperCase()}`, rowVersion: 7, years: [], language,
    });
  }
  for (const raw of ['v7.2026r3', 'v7']) {
    const parsed = parseToken(raw);
    assert.equal(parsed.kind, 'ok');
    assert.equal(parsed.kind === 'ok' && parsed.language, null);
  }
  for (const raw of ['v7.it', 'v7.fr.2026r3', 'v7.fr.fr', 'v7.fr.extra']) {
    assert.deepEqual(parseToken(raw), { kind: 'bad', raw });
    assert.equal(tokenError(raw), `kanap_token '${raw}' is not a line token. Export the line again.`);
  }
  for (const cell of ['', 'v7', 'v7.it']) {
    assert.equal(budgetFileSchema('opex', 'en', []).conventionHint!.languageOf(cell), null);
  }
  const hinted = budgetFileSchema('opex', 'en', []).conventionHint!.languageOf('V7.FR');
  assert.equal(hinted, 'fr');
}

async function testOldFiles() {
  const opex = await readBudgetCsv('product_name;y_budget\nWidget;10\n', { scope: 'opex', language: 'en', dimensionCodes: [] });
  assert.deepEqual(opex.fileErrors, [OLD_BUDGET_FILE_MESSAGE]);
  assert.equal(opex.rows.length, 0, 'an old file produces no row errors');
  const rows = await readBudgetCsv('item_type,measure,jan\nopex,budget,1\n', { scope: 'opex', language: 'en', dimensionCodes: [] });
  assert.deepEqual(rows.fileErrors, [OLD_BUDGET_FILE_MESSAGE]);
  const fresh = await preflight('opex', 'item_number,name,currency,status\nOPX-3,Widget,EUR,enabled\n', [line()]);
  assert.deepEqual(fresh.fileErrors, []);
  assert.deepEqual(fresh.warnings.ignoredColumns, ['status']);
  assert.equal(fresh.changes.unchanged, 1, 'a status column is ignored and the line is unchanged');
}

async function testRoundTrip() {
  const stored = line({
    versions: withJanuary(10000n),
    endOfValidity: '2027-03-01T12:00:00.000Z',
  });
  const built = buildBudgetExport({
    scope: 'opex', language: 'en', years: [YEAR], columns: ['budget'], detail: 'yearly', lines: [stored], dimensionCodes: [],
  });
  const csv = writeCsv({ language: 'en', headers: built.headers, rows: built.rows });
  assert.ok(csv.startsWith('\uFEFF'));
  assert.ok(csv.includes('kanap_token'));
  assert.ok(csv.includes('v7.2026r3'));
  assert.ok(csv.includes('100.00'));
  assert.ok(csv.includes('2027-03-01'));
  const report = await preflight('opex', csv, [stored]);
  assert.equal(report.ok, true, JSON.stringify({ errors: report.errors, file: report.fileErrors, notices: report.notices }));
  assert.equal(report.changes.unchanged, 1);
  assert.equal(report.changes.updated, 0);
  assert.equal(report.notices.dates, null);
  assert.equal(report.snapshot.lines[0].rowVersion, 7);
  assert.equal(report.snapshot.lines[0].years[0].budgetRev, 3);

  const french = buildBudgetExport({
    scope: 'opex', language: 'fr', years: [2027], columns: ['budget'], detail: 'yearly',
    lines: [line({ effectiveStart: '2027-03-01' })], dimensionCodes: [],
  });
  const frenchCsv = writeCsv({ language: 'fr', headers: french.headers, rows: french.rows });
  assert.ok(frenchCsv.includes('01/03/2027'));
  assert.ok(frenchCsv.includes(';'));
  const back = await preflight('opex', frenchCsv, [line({ effectiveStart: '2027-03-01' })], { language: 'fr' });
  assert.equal(back.ok, true, JSON.stringify(back.errors));
  assert.equal(back.changes.unchanged, 1);
  assert.equal(back.notices.dates, 'Dates read day first: 01/03/2027 is March 1.');
}

async function testAmounts() {
  const stored = line({ versions: withJanuary(10000n) });
  const same = await preflight('opex', 'item_number,name,currency,budget_2026\nOPX-3,Widget,EUR,100.00\n', [stored]);
  assert.equal(same.changes.unchanged, 1, 'a yearly total equal to the stored sum writes nothing');
  const different = await preflight('opex', 'item_number,name,currency,budget_2026\nOPX-3,Widget,EUR,200.00\n', [stored]);
  assert.equal(different.changes.updated, 1);
  assert.ok(different.changes.updatedLines[0].fields.includes('budget 2026'));
  const frozen = await preflight('opex', 'item_number,name,currency,budget_2026\nOPX-3,Widget,EUR,200.00\n', [stored], {
    cat: catalog({ frozen: ['2026:budget'] }),
  });
  assert.equal(frozen.ok, false);
  assert.ok(frozen.errors.some((error) => error.message === 'Budget for 2026 is frozen.'));
  const frozenSame = await preflight('opex', 'item_number,name,currency,budget_2026\nOPX-3,Widget,EUR,100.00\n', [stored], {
    cat: catalog({ frozen: ['2026:budget'] }),
  });
  assert.equal(frozenSame.ok, true, 'a frozen column that the file does not change is not an error');

  const missingMonth = await preflight('opex', 'item_number,name,currency,budget_2026_01\nOPX-3,Widget,EUR,0\n', [line()]);
  assert.equal(missingMonth.changes.updated, 1, '0 on a missing month is a stored zero');
  const storedZero = line({ versions: withJanuary(0n) });
  const sameZero = await preflight('opex', 'item_number,name,currency,budget_2026_01\nOPX-3,Widget,EUR,0\n', [storedZero]);
  assert.equal(sameZero.changes.unchanged, 1, '0 on a stored zero is no change');

  const decimals = await preflight('opex', 'item_number,name,currency,budget_2026\nOPX-3,Widget,EUR,1.234\n', [stored]);
  assert.ok(decimals.errors.some((error) => error.message === 'budget_2026 has more than two decimals.'));
  const dash = await preflight('opex', 'item_number,name,currency,budget_2026\nOPX-3,Widget,EUR,-\n', [stored]);
  assert.ok(dash.errors.some((error) => error.message.includes('cannot be cleared')));
}

async function testIdentity() {
  const deleted = await preflight('opex', 'item_number,name,currency,kanap_token\nOPX-9,Gone,EUR,v1\n', []);
  assert.equal(deleted.deletedCount, 1);
  assert.ok(deleted.errors.some((error) => error.message === 'OPX-9 was deleted since the export.'));
  assert.ok(!deleted.errors.some((error) => error.message.includes('does not match')));
  const unknown = await preflight('opex', 'item_number,name,currency\nOPX-9,Gone,EUR\n', []);
  assert.equal(unknown.deletedCount, 0);
  assert.ok(unknown.errors.some((error) => error.message === "item_number 'OPX-9' does not match a line."));
  const other = await preflight('opex', 'item_number,name,currency\nCPX-3,Gone,EUR\n', []);
  assert.ok(other.errors.some((error) => error.message.includes('CAPEX list')));
  const twice = await preflight('opex', 'item_number,name,currency\nOPX-3,Widget,EUR\nOPX-3,Widget,EUR\n', [line()]);
  assert.ok(twice.errors.some((error) => error.message === 'item_number OPX-3 already appears on line 2.'));

  const stored = line();
  const changed = await preflight('opex', 'item_number,name,currency,kanap_token\nOPX-3,Widget,EUR,v4\n', [stored]);
  assert.equal(changed.ok, true, 'a token mismatch does not block');
  assert.equal(changed.changedSinceExportCount, 1);
  assert.equal(changed.changedSinceExport[0].rowMismatch, true);
  assert.equal(changed.changedSinceExport[0].message, 'OPX-3 was changed since the export.');
  const bad = await preflight('opex', 'item_number,name,currency,kanap_token\nOPX-3,Widget,EUR,v7.2026\n', [stored]);
  assert.ok(bad.errors.some((error) => error.message.includes('not a line token')));
}

async function testSuppliersAndDuplicates() {
  const cat = catalog({
    companies: [{ id: 'c1', name: 'Acme', coaId: 'chart', disabledAt: null }],
    accounts: [{ id: 'a1', number: '1200', coaId: 'chart', disabledAt: null }],
    suppliers: [{ id: 's1', name: 'Acme', erpId: null, disabledAt: null }],
  });
  const base = 'item_number,name,company_name,account_number,currency,supplier_name,supplier_erp_id\n';
  const clash = await preflight('opex', `${base},Widget,Acme,1200,EUR,Acme,42\n`, [], { cat });
  assert.ok(clash.errors.some((error) => error.message.includes('Add the ERP id in Master data > Suppliers')));
  const off = await preflight('opex', `${base},Widget,Acme,1200,EUR,Newco,\n`, [], { cat });
  assert.equal(off.ok, false);
  assert.equal(off.supplierMessage, '1 supplier does not exist. Create them in Master data > Suppliers, or tick Create missing suppliers.');
  assert.equal(off.creates.suppliers.length, 0);
  const on = await preflight('opex', `${base},Widget,Acme,1200,EUR,Newco,\n`, [], {
    cat, createSuppliers: true, canCreateSuppliers: true,
  });
  assert.equal(on.ok, true, JSON.stringify(on.errors));
  assert.equal(on.supplierMessage, null);
  assert.deepEqual(on.creates.suppliers, [{ name: 'Newco', erpId: null }]);
  assert.equal(on.changes.created, 1);

  const hint = await preflight('opex', 'item_number,name,currency\n,Widget,EUR\n', [line()]);
  assert.ok(hint.warnings.duplicates.some((warning) => warning.message === 'row 2 looks like OPX-3'));
}

async function testCreateRules() {
  const cat = catalog({
    companies: [{ id: 'c1', name: 'Acme', coaId: 'chart', disabledAt: null }],
    accounts: [{ id: 'a1', number: '1200', coaId: 'chart', disabledAt: null }],
  });
  const missing = await preflight('opex', 'item_number,name,company_name,account_number,currency\n,Widget,Other,1200,EUR\n', [], { cat });
  assert.ok(missing.missing.some((item) => item.message.startsWith('Missing: 1 company (Other): Master data > Companies')));
  const capex = await preflight('capex', 'item_number,name,company_name,account_number,currency\n,Server,Acme,1200,EUR\n', [], { cat });
  assert.ok(capex.errors.some((error) => error.message === 'ppe_type is required.'));
  const dash = await preflight('opex', 'item_number,name,currency\nOPX-3,-,EUR\n', [line()]);
  assert.ok(dash.errors.some((error) => error.message === 'name is required.'));
}

async function testExportShape() {
  const built = buildBudgetExport({
    scope: 'opex', language: 'en', years: [YEAR], columns: ['budget'], detail: 'months', lines: [], dimensionCodes: ['nature'],
  });
  assert.equal(built.rows.length, 0);
  assert.equal(built.headers[0], 'item_number');
  assert.ok(built.headers.includes('analytics:nature'));
  assert.ok(built.headers.includes('budget_2026_01'));
  assert.equal(built.headers[built.headers.length - 1], 'kanap_token');
  assert.deepEqual(parseAmountYears('', 2026), [2025, 2026, 2027]);
  assert.deepEqual(parseFileColumns('actual,budget', ['revision']), ['budget', 'actual']);
  const sample = buildBudgetExport({
    scope: 'opex', language: 'en', years: [2026, 2027, 2028],
    columns: ['budget', 'revision', 'forecast', 'actual', 'landing'],
    detail: 'months', lines: [line({ notes: 'A ordinary note for the row size.' })], dimensionCodes: [],
  });
  const csv = writeCsv({ language: 'en', headers: sample.headers, rows: sample.rows });
  const rowBytes = Buffer.byteLength(csv.split('\n')[1] ?? '', 'utf8');
  assert.ok(rowBytes > 0);
  assert.ok(
    BUDGET_FILE_MAX_BYTES >= rowBytes * 20_000,
    `cap ${BUDGET_FILE_MAX_BYTES} is below 20,000 rows of ${rowBytes} bytes`,
  );
  const all = exportListQuery({ filters: '{"q":1}', q: 'widget', ctx: 'abc', status: 'enabled', sort: 'name:ASC', all: 'true' }, true);
  assert.equal(all.includeDisabled, '1');
  assert.equal(all.status, undefined);
  assert.equal(all.filters, undefined);
  assert.equal(all.q, undefined);
  assert.equal(all.sort, 'name:ASC');
  const kept = exportListQuery({ status: 'disabled', sort: 'name:ASC' }, false);
  assert.equal(kept.status, 'disabled');
  assert.equal(kept.includeDisabled, undefined);
}

async function planOf(scope: BudgetFileScope, text: string, stored: StoredLine[], options: { cat?: BudgetCatalog; createSuppliers?: boolean; canCreateSuppliers?: boolean } = {}) {
  const read = await readBudgetCsv(text, { scope, language: 'en', dimensionCodes: [] });
  return planBudgetFile({
    scope, read, catalog: options.cat ?? catalog(), stored,
    names: stored.map((item) => ({ itemNumber: item.itemNumber, name: item.name, supplierId: item.supplierId })),
    createSuppliers: options.createSuppliers ?? false,
    canCreateSuppliers: options.canCreateSuppliers ?? false,
    currentYear: YEAR,
    labels: { budget: 'Budget' },
  });
}

async function testPlan() {
  const stored = line({ versions: withJanuary(10000n) });
  const yearly = await planOf('opex', 'item_number,name,currency,budget_2026\nOPX-3,Widget,EUR,200.00\n', [stored]);
  assert.equal(yearly.plans.length, 1);
  assert.deepEqual(yearly.plans[0].body, {});
  assert.equal(yearly.plans[0].amounts[0].month, null);
  assert.equal(yearly.plans[0].amounts[0].cents, 20000n);
  assert.deepEqual(yearly.plans[0].grains, [{ year: 2026, grain: 'annual' }]);
  const same = await planOf('opex', 'item_number,name,currency,budget_2026\nOPX-3,Widget,EUR,100.00\n', [stored]);
  assert.equal(same.plans.length, 0, 'an unchanged yearly total is not a write');

  const month = await planOf('opex', 'item_number,name,currency,budget_2026_01\nOPX-3,Widget,EUR,0\n', [line()]);
  assert.equal(month.plans[0].amounts[0].month, 1);
  assert.equal(month.plans[0].amounts[0].cents, 0n);
  assert.equal(month.plans[0].grains[0].grain, 'monthly');

  const cat = catalog({
    companies: [{ id: 'c1', name: 'Acme', coaId: 'chart', disabledAt: null }],
    accounts: [{ id: 'a1', number: '1200', coaId: 'chart', disabledAt: null }],
  });
  const created = await planOf('opex', 'item_number,name,company_name,account_number,currency,supplier_name\n,Widget,Acme,1200,EUR,Newco\n', [], {
    cat, createSuppliers: true, canCreateSuppliers: true,
  });
  assert.equal(created.report.ok, true, JSON.stringify(created.report.errors));
  assert.equal(created.plans[0].creating, true);
  assert.equal(created.plans[0].body.product_name, 'Widget');
  assert.equal(created.plans[0].body.paying_company_id, 'c1');
  assert.equal(created.plans[0].body.account_id, 'a1');
  assert.equal(created.plans[0].body.currency, 'EUR');
  assert.equal(created.plans[0].body.effective_start, '2026-01-01');
  assert.equal(created.plans[0].body.supplier_id, undefined);
  assert.deepEqual(created.plans[0].newSupplier, { name: 'Newco', erpId: null });

  const storedPeriod = periodForYearlyTotal(2026, { start: '2026-04-01', end: '2026-09-30' }, true, '2026-01-01', null);
  assert.deepEqual(storedPeriod, { start: '2026-04-01', end: '2026-09-30' });
  const clipped = periodForYearlyTotal(2026, null, false, '2026-03-01', '2026-06-30');
  assert.deepEqual(clipped, { start: '2026-03-01', end: '2026-06-30' });
  const whole = periodForYearlyTotal(2026, null, true, '2026-03-01', null);
  assert.deepEqual(whole, { start: '2026-03-01', end: '2026-12-31' });
}

async function main() {
  await testTokenLanguages();
  await testDecimalMarkParameter();
  await testOldFiles();
  await testRoundTrip();
  await testAmounts();
  await testIdentity();
  await testSuppliersAndDuplicates();
  await testCreateRules();
  await testExportShape();
  await testPlan();
  console.log('budget-file.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
