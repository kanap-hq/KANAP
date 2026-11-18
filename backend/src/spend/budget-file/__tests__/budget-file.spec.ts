import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { parseDecimalMark } from '../../../common/csv-sheet';
import { writeCsv } from '../../../common/csv-sheet';
import { budgetCsvRows, buildBudgetExport, exportListQuery, parseAmountYears, parseFileColumns } from '../export-file';
import { parseItemNumber, readBudgetCsv } from '../interpret';
import { periodForYearlyTotal } from '../period';
import { buildPreflight, planBudgetFile, storedState } from '../preflight';
import { AMOUNT_MEASURES } from '../../amounts-write.util';
import type { BudgetFileAccess } from '../preflight';
import type { BudgetFileChoice } from '../types';
import { budgetFileSchema, CRITERIA_COLUMNS_MESSAGE, MISSING_BUDGET_HEADER_MESSAGE, OLD_BUDGET_FILE_MESSAGE } from '../columns';
import { writeXlsx } from '../../../common/xlsx';
import { si, workbookParts, zipOf } from '../../../common/xlsx/__tests__/fixtures/handmade';
import { natureChangeMessage } from '../preflight';
import type { BudgetNature } from '../../budget-nature';
import { formatToken, parseToken, tokenError } from '../token';
import { BUDGET_FILE_MAX_BYTES, budgetFileChoices } from '../upload';
import { parseImportChoices } from '../../../ai/import/ai-import-targets';
import {
  BudgetCatalog,
  BudgetFileScope,
  LineHint,
  StoredLine,
  StoredVersion,
  emptyCatalog,
  emptyMonths,
} from '../types';

// The budget file's own rules. No database: the loader is covered separately.

const YEAR = 2026;

function line(patch: Partial<StoredLine> = {}): StoredLine {
  return {
    id: 'line-1',
    nature: 'opex',
    itemNumber: 3,
    legacyNumber: 'OPX-3',
    rowVersion: 7,
    name: 'Widget',
    description: null,
    // A line written through the item service has a paying company (the default catalog's).
    companyId: 'c1',
    companyName: 'Acme',
    supplierId: null,
    supplierName: null,
    supplierErpId: null,
    accountId: null,
    accountNumber: null,
    costCenterId: null,
    costCenterCode: null,
    costCenterPath: null,
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

/** A 2026 version whose Budget follows two calculation lines that give `cents`, with the same January. */
function computedBudget(cents: bigint): StoredVersion[] {
  const [version] = withJanuary(cents);
  return [{ ...version, rounds: { planned: { method: 'computed', lineCount: 2, linesTotal: cents } } }];
}

/** `count` lines whose Budget follows its calculation lines, BL-1 to BL-n. */
function computedLines(count: number): StoredLine[] {
  return Array.from({ length: count }, (_, index) => line({
    id: `line-${index + 1}`,
    itemNumber: index + 1,
    legacyNumber: null,
    name: `Widget ${index + 1}`,
    versions: computedBudget(10000n),
  }));
}

function catalog(patch: Partial<BudgetCatalog> = {}): BudgetCatalog {
  return emptyCatalog({ companies: [{ id: 'c1', name: 'Acme', coaId: null, disabledAt: null }], ...patch });
}

async function preflight(
  scope: BudgetFileScope,
  text: string | Buffer,
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
    language: options.language ?? 'en',
    dimensionCodes: options.dimensions ?? [],
  });
  return buildPreflight({
    scope,
    read,
    catalog: options.cat ?? catalog(),
    // The stored lines and names the service reads: those of both natures (one right, lot R).
    stored,
    names: options.names ?? stored
      .map((item) => ({ nature: item.nature, itemNumber: item.itemNumber, name: item.name, supplierId: item.supplierId, companyId: item.companyId })),
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
    assert.equal(budgetFileSchema('en', []).conventionHint!.languageOf(cell), null);
  }
  const hinted = budgetFileSchema('en', []).conventionHint!.languageOf('V7.FR');
  assert.equal(hinted, 'fr');
}

async function testOldFiles() {
  const opex = await readBudgetCsv('product_name;y_budget\nWidget;10\n', { language: 'en', dimensionCodes: [] });
  assert.deepEqual(opex.fileErrors, [OLD_BUDGET_FILE_MESSAGE]);
  assert.equal(opex.rows.length, 0, 'an old file produces no row errors');
  const rows = await readBudgetCsv('item_type,measure,jan\nopex,budget,1\n', { language: 'en', dimensionCodes: [] });
  assert.deepEqual(rows.fileErrors, [OLD_BUDGET_FILE_MESSAGE]);
  // A CAPEX file of before lot C1 (its three criteria columns together), on either route: refused
  // as a whole, never read as dimensions.
  for (const [scope, header] of [
    ['capex', 'item_number,name,ppe_type,investment_type,priority,currency'],
    ['opex', 'item_number,name,PPE type,Investment-Type,Priority,currency'],
  ] as Array<[BudgetFileScope, string]>) {
    const criteria = await readBudgetCsv(`${header}\nCPX-3,Server,hardware,replacement,high,EUR\n`, { language: 'en', dimensionCodes: ['priority'] });
    assert.deepEqual(criteria.fileErrors, [CRITERIA_COLUMNS_MESSAGE], `${scope}: ${header}`);
    assert.equal(criteria.rows.length, 0, 'no row errors besides');
  }
  // One or two of them alone: unknown columns, ignored with a warning, as before lot C1.
  for (const [scope, text, ignored] of [
    ['opex', 'item_number,name,currency,Priority\nOPX-3,Widget,EUR,P1\n', ['Priority']],
    ['capex', 'item_number,name,currency,ppe_type,priority\nCPX-3,Widget,EUR,hardware,high\n', ['ppe_type', 'priority']],
  ] as Array<[BudgetFileScope, string, string[]]>) {
    const header = text.split('\n')[0];
    const stored = scope === 'opex' ? line() : line({ nature: 'capex', itemNumber: 120, legacyNumber: 'CPX-3' });
    const partial = await preflight(scope, text, [stored]);
    assert.deepEqual(partial.fileErrors, [], `${scope}: ${header}`);
    assert.deepEqual(partial.warnings.ignoredColumns, ignored, `${scope}: ${header} ignored`);
    assert.equal(partial.changes.unchanged, 1, `${scope}: the line is read, unchanged`);
  }
  const dimensions = await readBudgetCsv('item_number,name,analytics:priority,currency\nCPX-3,Server,High,EUR\n', {
    language: 'en', dimensionCodes: ['ppe_type', 'investment_type', 'priority'],
  });
  assert.deepEqual(dimensions.fileErrors, [], 'the dimension columns are the new form');
  const fresh = await preflight('opex', 'item_number,name,currency,status\nOPX-3,Widget,EUR,enabled\n', [line()]);
  assert.deepEqual(fresh.fileErrors, []);
  assert.deepEqual(fresh.warnings.ignoredColumns, ['status']);
  assert.equal(fresh.changes.unchanged, 1, 'a status column is ignored and the line is unchanged');
}

/** A first line that is not a budget file header is refused; a header with a column of the file is read as before. */
async function testMissingHeader() {
  const stored = line({ versions: withJanuary(10000n) });
  const refused = [
    'just some text',
    'just some text\nand another line\n',
    'Some title\nitem_number,name,currency\nBL-3,Widget,EUR\n',
  ];
  for (const text of refused) {
    const report = await preflight('opex', text, [stored]);
    assert.deepEqual(report.headerErrors, [MISSING_BUDGET_HEADER_MESSAGE], JSON.stringify(text));
    assert.deepEqual(report.fileErrors, [], JSON.stringify(text));
    assert.deepEqual([report.errorCount, report.changes.created, report.changes.updated, report.changes.unchanged], [0, 0, 0, 0], JSON.stringify(text));
    assert.equal(report.ok, false, JSON.stringify(text));
  }
  const workbook = writeXlsx({
    language: 'en',
    sheets: [{ name: 'budget', header: 'plain', headers: ['just some text'], rows: [['and another line']] }],
  });
  const fromWorkbook = await preflight('opex', workbook, [stored]);
  assert.deepEqual(fromWorkbook.headerErrors, [MISSING_BUDGET_HEADER_MESSAGE], 'xlsx: the first row is the sheet header');
  assert.deepEqual(fromWorkbook.fileErrors, [], 'xlsx: not a file error');
  assert.deepEqual([fromWorkbook.errorCount, fromWorkbook.changes.unchanged], [0, 0], 'xlsx: no row is read');

  // Empty files keep their own sentence, CSV and xlsx alike.
  const empty = await preflight('opex', '', [stored]);
  assert.deepEqual(empty.fileErrors, ['The file is empty.']);
  assert.deepEqual(empty.headerErrors, []);
  const emptyWorkbook = writeXlsx({ language: 'en', sheets: [{ name: 'budget', headers: [], rows: [] }] });
  const emptySheet = await preflight('opex', emptyWorkbook, [stored]);
  assert.deepEqual(emptySheet.fileErrors, ['The file is empty.']);
  assert.deepEqual(emptySheet.headerErrors, []);

  // A header of another language, and any partial header, keep the behaviour they have: one column of
  // the file is enough, the words the reader does not know are only warnings.
  const foreign = await preflight('opex', 'Nature;Item Number;Nom;Budget 2026\nopex;BL-3;Widget;100.00\n', [stored]);
  assert.deepEqual([foreign.ok, foreign.fileErrors, foreign.headerErrors], [true, [], []], 'a foreign header with file columns is read');
  assert.deepEqual(foreign.warnings.ignoredColumns, ['Nom']);
  assert.equal(foreign.changes.unchanged, 1);
  const onlyHeader = await preflight('opex', 'item_number\n', []);
  assert.deepEqual([onlyHeader.ok, onlyHeader.headerErrors, onlyHeader.changes.unchanged], [true, [], 0], 'an empty partial export is nothing to change');
}

async function testRoundTrip() {
  const stored = line({
    versions: withJanuary(10000n),
    endOfValidity: '2027-03-01T12:00:00.000Z',
  });
  const built = buildBudgetExport({
    language: 'en', years: [YEAR], columns: ['budget'], detail: 'yearly', lines: [stored], dimensions: [],
  });
  const csv = writeCsv({ language: 'en', headers: built.headers, rows: budgetCsvRows(built.rows, 'en') });
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
    language: 'fr', years: [2027], columns: ['budget'], detail: 'yearly',
    lines: [line({ effectiveStart: '2027-03-01' })], dimensions: [],
  });
  const frenchCsv = writeCsv({ language: 'fr', headers: french.headers, rows: budgetCsvRows(french.rows, 'fr') });
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
    cat: catalog({ frozen: ['opex:2026:budget'] }),
  });
  assert.equal(frozen.ok, false);
  assert.ok(frozen.errors.some((error) => error.message === 'Budget for 2026 is frozen.'));
  const frozenSame = await preflight('opex', 'item_number,name,currency,budget_2026\nOPX-3,Widget,EUR,100.00\n', [stored], {
    cat: catalog({ frozen: ['opex:2026:budget'] }),
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
  assert.ok(deleted.errors.some((error) => error.message === 'OPX-9 is no longer available since the export.'));
  assert.ok(!deleted.errors.some((error) => error.message.includes('does not match')));
  const unknown = await preflight('opex', 'item_number,name,currency\nOPX-9,Gone,EUR\n', []);
  assert.equal(unknown.deletedCount, 0);
  assert.ok(unknown.errors.some((error) => error.message === "item_number 'OPX-9' does not match a line."));
  // A CPX number on the OPEX list that names no line: no such line (one right reads both natures, lot R).
  const other = await preflight('opex', 'item_number,name,currency\nCPX-3,Gone,EUR\n', []);
  assert.deepEqual(other.errors.map((error) => error.message), ["item_number 'CPX-3' does not match a line."]);
  const twice = await preflight('opex', 'item_number,name,currency\nOPX-3,Widget,EUR\nOPX-3,Widget,EUR\n', [line()]);
  assert.ok(twice.errors.some((error) => error.message === 'item_number OPX-3 already appears on line 2.'));

  const stored = line();
  const changed = await preflight('opex', 'item_number,name,currency,kanap_token\nOPX-3,Widget,EUR,v4\n', [stored]);
  assert.equal(changed.ok, true, 'a token mismatch does not block');
  assert.equal(changed.changedSinceExportCount, 1);
  assert.equal(changed.changedSinceExport[0].rowMismatch, true);
  assert.equal(changed.changedSinceExport[0].message, 'BL-3 was changed since the export.', 'the report names a line by its BL number');
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

  // A new row that looks like a stored line (the same title and no supplier on either) is left out
  // (lot I2 of 26.11.9): no warning of the file's, an entry of the lookalikes, nothing created.
  const hint = await preflight('opex', 'item_number,name,currency\n,Widget,EUR\n', [line()]);
  assert.deepEqual(hint.warnings.duplicates, []);
  assert.deepEqual(hint.lookalikes?.lines.map((entry) => [entry.line, entry.target.ref, entry.reason, entry.outcome]), [[2, 'BL-3', 'title_supplier', 'ignored']]);
  assert.equal(hint.changes.created, 0);
}

async function testCreateRules() {
  const cat = catalog({
    companies: [{ id: 'c1', name: 'Acme', coaId: 'chart', disabledAt: null }],
    accounts: [{ id: 'a1', number: '1200', coaId: 'chart', disabledAt: null }],
  });
  const missing = await preflight('opex', 'item_number,name,company_name,account_number,currency\n,Widget,Other,1200,EUR\n', [], { cat });
  assert.ok(missing.missing.some((item) => item.message.startsWith('Missing: 1 company (Other): Master data > Companies')));
  // Each error carries the code and values the interface translates.
  assert.deepEqual(
    missing.errors.map((error) => [error.column, error.code, error.params]),
    [['company_name', 'CSV_REFERENCE_NOT_FOUND', { value: 'Other' }]],
  );

  // A new line without a company is paid by the workspace's only enabled company, whose chart reads the account.
  const noCompany = 'item_number,name,account_number,currency\n,Widget,1200,EUR\n';
  const only = await planOf('opex', noCompany, [], { cat });
  assert.equal(only.report.ok, true, JSON.stringify(only.report.errors));
  assert.equal(only.plans[0].body.paying_company_id, 'c1');
  assert.equal(only.plans[0].body.account_id, 'a1');
  const withDisabled = await planOf('opex', noCompany, [], {
    cat: catalog({ ...cat, companies: [...cat.companies, { id: 'c2', name: 'Old', coaId: 'chart', disabledAt: '2020-01-01T00:00:00.000Z' }] }),
  });
  assert.equal(withDisabled.plans[0]?.body.paying_company_id, 'c1', 'a disabled company does not count');
  const two = await preflight('opex', noCompany, [], {
    cat: catalog({ ...cat, companies: [...cat.companies, { id: 'c2', name: 'Beta', coaId: 'chart', disabledAt: null }] }),
  });
  assert.deepEqual(
    two.errors.map((error) => [error.column, error.message, error.code]),
    [['company_name', 'company_name is required.', 'CSV_VALUE_REQUIRED']],
    'two companies: the file names one',
  );
  // A new CAPEX line needs the values of the CAPEX dimensions (lot C1): the dimension is named, on its column.
  const capexCat = catalog({
    ...cat,
    dimensions: [
      { code: 'ppe_type', name: 'PP&E type', required: true, axisName: 'PP&E type', values: [{ id: 'p1', name: 'Hardware', disabledAt: null }] },
      { code: 'priority', name: 'Priority', required: true, axisName: 'Priority', values: [{ id: 'r1', name: 'High', disabledAt: null }] },
    ],
  });
  const capex = await preflight('capex', 'item_number,name,company_name,account_number,currency,analytics:ppe_type\n,Server,Acme,1200,EUR,hardware\n', [], {
    cat: capexCat, dimensions: ['ppe_type', 'priority'],
  });
  assert.deepEqual(
    capex.errors.map((error) => [error.column, error.message]),
    [['analytics:priority', 'The Priority dimension is required. Choose a value.']],
    'the missing CAPEX dimension, by its name',
  );
  const dash = await preflight('opex', 'item_number,name,currency\nOPX-3,-,EUR\n', [line()]);
  assert.ok(dash.errors.some((error) => error.message === 'name is required.'));
}

/** An account for the other type of line only: refused on a new line or a new account, the current one kept. */
async function testAccountNature() {
  const cat = catalog({
    companies: [{ id: 'c1', name: 'Acme', coaId: 'chart', disabledAt: null }],
    accounts: [
      { id: 'a1', number: '1200', coaId: 'chart', disabledAt: null, nature: 'capex' },
      { id: 'a2', number: '6100', coaId: 'chart', disabledAt: null, nature: 'opex' },
      { id: 'a3', number: '6200', coaId: 'chart', disabledAt: null, nature: null },
    ],
  });
  const create = 'item_number,name,company_name,account_number,currency\n';
  const accountErrors = (report: { errors: Array<{ column: string | null; message: string }> }) =>
    report.errors.filter((error) => error.column === 'account_number').map((error) => error.message);

  const capexAccount = await preflight('opex', `${create},Widget,Acme,1200,EUR\n`, [], { cat });
  assert.deepEqual(accountErrors(capexAccount), ['Account 1200 is for CAPEX lines only.'], 'a new OPEX line on a CAPEX account');
  const opexAccount = await preflight('capex', `${create},Server,Acme,6100,EUR\n`, [], { cat });
  assert.deepEqual(accountErrors(opexAccount), ['Account 6100 is for OPEX lines only.'], 'a new CAPEX line on an OPEX account');
  for (const number of ['6100', '6200']) {
    const fine = await preflight('opex', `${create},Widget,Acme,${number},EUR\n`, [], { cat });
    assert.equal(fine.ok, true, `a new OPEX line on account ${number}: ${JSON.stringify(fine.errors)}`);
  }

  const update = 'item_number,name,account_number,currency\nOPX-3,Widget,1200,EUR\n';
  const moved = await preflight('opex', update, [line({ companyId: 'c1', accountId: 'a2', accountNumber: '6100' })], { cat });
  assert.deepEqual(accountErrors(moved), ['Account 1200 is for CAPEX lines only.'], 'an account change to the other type');
  const kept = await preflight('opex', update, [line({ companyId: 'c1', accountId: 'a1', accountNumber: '1200' })], { cat });
  assert.equal(kept.ok, true, `the line's current account is kept: ${JSON.stringify(kept.errors)}`);
}

async function testValueAppliesTo() {
  const cat = catalog({
    companies: [{ id: 'c1', name: 'Acme', coaId: null, disabledAt: null }],
    dimensions: [{
      code: 'nature',
      name: 'Nature de coût',
      required: false,
      axisName: 'Nature de coût',
      values: [
        { id: 'v1', name: 'Abonnements SaaS', disabledAt: null, appliesTo: 'opex' },
        { id: 'v2', name: 'Matériel', disabledAt: null, appliesTo: 'capex' },
        { id: 'v3', name: 'Licences', disabledAt: null, appliesTo: null },
        // A fixture without the field (older catalogs): both types.
        { id: 'v4', name: 'Divers', disabledAt: null },
      ],
    }],
  });
  const options = { cat, dimensions: ['nature'] };
  const create = 'item_number,name,company_name,currency,analytics:nature\n';
  const cellErrors = (report: { errors: Array<{ column: string | null; message: string }> }) =>
    report.errors.filter((error) => error.column === 'analytics:nature').map((error) => error.message);

  const onCapex = await preflight('capex', `${create},Server,Acme,EUR,abonnements saas\n`, [], options);
  assert.deepEqual(
    cellErrors(onCapex),
    ['Abonnements SaaS is for OPEX lines only. Pick a value for CAPEX lines.'],
    'a new CAPEX line on an OPEX value',
  );
  const onOpex = await preflight('opex', `${create},Widget,Acme,EUR,Matériel\n`, [], options);
  assert.deepEqual(cellErrors(onOpex), ['Matériel is for CAPEX lines only. Pick a value for OPEX lines.'], 'a new OPEX line on a CAPEX value');
  for (const name of ['Abonnements SaaS', 'Licences', 'Divers']) {
    const fine = await preflight('opex', `${create},Widget,Acme,EUR,${name}\n`, [], options);
    assert.deepEqual(cellErrors(fine), [], `a new OPEX line on ${name}`);
  }

  const update = 'item_number,name,analytics:nature\nOPX-3,Widget,Matériel\n';
  const changed = await preflight('opex', update, [line({ analytics: { nature: 'Licences' } })], options);
  assert.deepEqual(cellErrors(changed), ['Matériel is for CAPEX lines only. Pick a value for OPEX lines.'], 'a change to a value of the other type');
  const kept = await preflight('opex', update, [line({ analytics: { nature: 'Matériel' } })], options);
  assert.equal(kept.ok, true, `the line's current value is kept: ${JSON.stringify(kept.errors)}`);
  const cleared = await preflight('opex', 'item_number,name,analytics:nature\nOPX-3,Widget,-\n', [line({ analytics: { nature: 'Matériel' } })], options);
  assert.equal(cleared.ok, true, `clearing it is allowed: ${JSON.stringify(cleared.errors)}`);
}

/**
 * A required dimension: a new line needs a value (absent column, blank cell and `-` refused, a
 * value the load creates counts); an existing line is refused only for a `-` on a value it holds.
 */
async function testRequiredDimension() {
  const cat = catalog({
    companies: [{ id: 'c1', name: 'Acme', coaId: null, disabledAt: null }],
    dimensions: [
      { code: 'menu', name: 'Menu', required: true, axisName: 'Menu', values: [{ id: 'm1', name: 'Fromage', disabledAt: null }] },
      { code: 'nature', name: 'Nature', required: false, axisName: 'Nature', values: [{ id: 'n1', name: 'Licences', disabledAt: null }] },
    ],
  });
  const options = { cat, dimensions: ['menu', 'nature'] };
  const message = 'The Menu dimension is required. Choose a value.';
  const menuErrors = (report: { errors: Array<{ column: string | null; message: string }> }) =>
    report.errors.filter((error) => error.column === 'analytics:menu').map((error) => error.message);

  const absent = await preflight('opex', 'item_number,name,company_name,currency,analytics:nature\n,Widget,Acme,EUR,Licences\n', [], options);
  assert.deepEqual(menuErrors(absent), [message], 'a new line, the column absent from the file');
  for (const [label, cell] of [['blank', ''], ['-', '-']]) {
    const report = await preflight('opex', `item_number,name,company_name,currency,analytics:menu\n,Widget,Acme,EUR,${cell}\n`, [], options);
    assert.deepEqual(menuErrors(report), [message], `a new line, ${label} cell`);
  }
  for (const value of ['fromage', 'Dessert']) {
    const report = await preflight('opex', `item_number,name,company_name,currency,analytics:menu\n,Widget,Acme,EUR,${value}\n`, [], options);
    assert.deepEqual(menuErrors(report), [], `a new line with ${value} (${value === 'Dessert' ? 'created by the load' : 'existing'})`);
  }

  const held = [line({ analytics: { menu: 'Fromage' } })];
  const lacking = [line()];
  const cases: Array<[string, string, StoredLine[]]> = [
    ['blank cell, value held', 'item_number,name,analytics:menu\nOPX-3,Widget,\n', held],
    ['column absent, value held', 'item_number,name\nOPX-3,Widget Pro\n', held],
    ['column absent, no value held', 'item_number,name\nOPX-3,Widget Pro\n', lacking],
    ['- with no value held', 'item_number,name,analytics:menu\nOPX-3,Widget,-\n', lacking],
  ];
  for (const [label, text, stored] of cases) {
    const report = await preflight('opex', text, stored, options);
    assert.equal(report.ok, true, `an existing line, ${label}: ${JSON.stringify(report.errors)}`);
  }
  const cleared = await preflight('opex', 'item_number,name,analytics:menu\nOPX-3,Widget,-\n', held, options);
  assert.deepEqual(menuErrors(cleared), [message], 'an existing line may not clear the value it holds');

  // The unnamed default dimension: the gate's wording, not its code.
  const unnamed = catalog({
    companies: [{ id: 'c1', name: 'Acme', coaId: null, disabledAt: null }],
    dimensions: [{ code: 'default', name: 'default', required: true, axisName: null, values: [] }],
  });
  const defaultMissing = await preflight('opex', 'item_number,name,company_name,currency\n,Widget,Acme,EUR\n', [], { cat: unnamed, dimensions: ['default'] });
  assert.deepEqual(
    defaultMissing.errors.filter((error) => error.column === 'analytics:default').map((error) => error.message),
    ['The analytics dimension is required. Choose a value.'],
    'a required default dimension without a name',
  );
}

async function testExportShape() {
  const dimensions = [
    { code: 'default', appliesTo: null },
    { code: 'ppe_type', appliesTo: 'capex' as const },
    { code: 'investment_type', appliesTo: 'capex' as const },
    { code: 'priority', appliesTo: 'capex' as const },
  ];
  const headers = buildBudgetExport({
    language: 'en', years: [YEAR], columns: ['budget'], detail: 'yearly', lines: [], dimensions,
  }).headers;
  assert.deepEqual(headers.slice(0, 16), [
    'nature', 'item_number', 'name', 'description',
    'company_name', 'supplier_name', 'supplier_erp_id', 'account_number', 'cost_center_code', 'cost_center_path', 'run_build',
    'analytics:default', 'analytics:ppe_type', 'analytics:investment_type', 'analytics:priority', 'owner_it_email',
  ], 'one file for both natures: nature first, every enabled dimension after run_build');
  const both = buildBudgetExport({
    language: 'en', years: [YEAR], columns: ['budget'], detail: 'yearly', dimensions,
    lines: [
      line({ nature: 'capex', itemNumber: 120, legacyNumber: 'CPX-4', description: 'Racks', analytics: { default: 'Infra', ppe_type: 'Hardware', priority: 'High' } }),
      // An OPEX line that keeps a value on a CAPEX dimension (set while it applied to both): not written.
      line({ analytics: { default: 'Apps', priority: 'Low' } }),
    ],
  });
  const cell = (row: number, header: string) => both.rows[row][both.headers.indexOf(header)];
  assert.deepEqual(
    ['nature', 'item_number', 'description', 'analytics:default', 'analytics:ppe_type', 'analytics:priority'].map((header) => cell(0, header)),
    ['capex', 'BL-120', 'Racks', 'Infra', 'Hardware', 'High'],
    'a CAPEX line: its nature, its BL number, its description and the value names',
  );
  assert.deepEqual(
    ['nature', 'item_number', 'analytics:default', 'analytics:priority'].map((header) => cell(1, header)),
    ['opex', 'BL-3', 'Apps', ''],
    'an OPEX line: no value on a dimension of the other nature',
  );
  const built = buildBudgetExport({
    language: 'en', years: [YEAR], columns: ['budget'], detail: 'months', lines: [], dimensions: [{ code: 'nature', appliesTo: null }],
  });
  assert.equal(built.rows.length, 0);
  assert.equal(built.headers[0], 'nature');
  assert.equal(built.headers[1], 'item_number');
  assert.ok(built.headers.includes('analytics:nature'));
  assert.ok(built.headers.includes('budget_2026_01'));
  assert.equal(built.headers[built.headers.length - 1], 'kanap_token');
  assert.deepEqual(parseAmountYears('', 2026), [2025, 2026, 2027]);
  assert.deepEqual(parseFileColumns('actual,budget', ['revision']), ['budget', 'actual']);
  const sample = buildBudgetExport({
    language: 'en', years: [2026, 2027, 2028],
    columns: ['budget', 'revision', 'forecast', 'actual', 'landing'],
    detail: 'months', lines: [line({ notes: 'A ordinary note for the row size.' })], dimensions: [],
  });
  const csv = writeCsv({ language: 'en', headers: sample.headers, rows: budgetCsvRows(sample.rows, 'en') });
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

async function planOf(
  scope: BudgetFileScope,
  text: string,
  stored: StoredLine[],
  options: { cat?: BudgetCatalog; createSuppliers?: boolean; canCreateSuppliers?: boolean } = {},
) {
  const read = await readBudgetCsv(text, { language: 'en', dimensionCodes: [] });
  return planBudgetFile({
    scope, read, catalog: options.cat ?? catalog(), stored,
    names: stored.map((item) => ({ nature: item.nature, itemNumber: item.itemNumber, name: item.name, supplierId: item.supplierId })),
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
  assert.equal(created.plans[0].nature, 'opex', 'a file without a nature column: the route\'s');
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


/* ---- One file for both natures (lot C1b) ---- */

/** An OPEX line BL-3 (OPX-3) and a CAPEX line BL-120 (CPX-4), with the company and accounts a new line needs. */
function natureFixture() {
  const opexLine = line();
  const capexLine = line({ id: 'line-2', nature: 'capex', itemNumber: 120, legacyNumber: 'CPX-4', name: 'Racks' });
  const cat = catalog({
    companies: [{ id: 'c1', name: 'Acme', coaId: 'chart', disabledAt: null }],
    accounts: [
      { id: 'a1', number: '6100', coaId: 'chart', disabledAt: null, nature: 'opex' },
      { id: 'a2', number: '2100', coaId: 'chart', disabledAt: null, nature: 'capex' },
    ],
  });
  return { opexLine, capexLine, stored: [opexLine, capexLine], cat };
}

const rowErrors = (report: { errors: Array<{ line: number; column: string | null; message: string }> }) =>
  report.errors.map((error) => [error.line, error.column, error.message]);

/** The `nature` column: required on a new line, the line's own when blank, never changed by a file. */
async function testNatureColumn() {
  const { stored, cat } = natureFixture();
  const header = 'nature,item_number,name,company_name,account_number,currency\n';
  // A new title: a row titled as a stored line would be left out as its lookalike (lot I2 of 26.11.9).
  const mixed = await planOf('opex', `${header}opex,,Gadget,Acme,6100,EUR\ncapex,,Server,Acme,2100,EUR\nCAPEX,BL-120,Racks v2,,,\n,BL-3,Widget Pro,,,\n`, stored, {
    cat,
  });
  assert.equal(mixed.report.ok, true, JSON.stringify(mixed.report.errors));
  assert.deepEqual(mixed.plans.map((plan) => [plan.line, plan.nature, plan.creating]), [
    [2, 'opex', true], [3, 'capex', true], [4, 'capex', false], [5, 'opex', false],
  ], 'each line written with its own nature; a blank cell keeps the line\'s');
  assert.equal(mixed.plans[2].body.product_name, 'Racks v2', 'the title of a CAPEX line is its product_name');
  // The lines created and updated, counted by nature: what the model announces (lot I1, fourth fixes).
  assert.deepEqual(mixed.report.changes.byNature, {
    created: { opex: 1, capex: 1 }, updated: { opex: 1, capex: 1 },
  }, 'the check counts its lines by nature');

  const refused = await preflight('opex', [
    header.trim(),
    ',,No nature,Acme,6100,EUR',
    'service,,Odd,Acme,6100,EUR',
    '-,,Widget,Acme,6100,EUR',
    'opex,BL-120,Racks,,,',
    'capex,OPX-3,Widget,,,',
  ].join('\n'), stored, { cat });
  assert.deepEqual(rowErrors(refused), [
    [2, 'nature', 'nature is required.'],
    [3, 'nature', "nature 'service' is not a value. Use opex or capex."],
    [4, 'nature', 'nature cannot be cleared.'],
    [5, 'nature', natureChangeMessage('BL-120', 'capex', 'opex')],
    [6, 'nature', natureChangeMessage('OPX-3 (BL-3)', 'opex', 'capex')],
  ]);
  assert.equal(natureChangeMessage('BL-120', 'capex', 'opex'), 'BL-120 is a CAPEX line, not an OPEX line. A file does not change the type of a line.');

  // A file of before lot C1b (no nature column): every line is of the route's nature.
  const old = await preflight('opex', 'item_number,name,currency\nCPX-4,Racks,EUR\nOPX-3,Widget,EUR\n', stored, { cat });
  assert.deepEqual(rowErrors(old), [[2, 'item_number', natureChangeMessage('CPX-4 (BL-120)', 'capex', 'opex')]], 'a CAPEX line in a file of the OPEX list');
  assert.equal(old.changes.unchanged, 1);
}

/** `BL-n`, a bare number (its BL number), `OPX-n` and `CPX-n` (the numbers of before lot C1b). */
async function testItemNumbers() {
  const { opexLine, capexLine, stored, cat } = natureFixture();
  const header = 'nature,item_number,name\n';
  for (const [ref, nature, expected] of [
    ['BL-3', 'opex', opexLine], ['bl-3', 'opex', opexLine], ['3', 'opex', opexLine], ['OPX-3', 'opex', opexLine],
    ['BL-120', 'capex', capexLine], ['120', 'capex', capexLine], ['CPX-4', 'capex', capexLine], ['cpx-4', 'capex', capexLine],
  ] as Array<[string, BudgetNature, StoredLine]>) {
    const report = await preflight('opex', `${header}${nature},${ref},${expected.name}\n`, stored, { cat });
    assert.equal(report.ok, true, `${ref}: ${JSON.stringify(report.errors)}`);
    assert.deepEqual(report.snapshot.lines.map((item) => item.id), [expected.id], `${ref} names ${expected.id}`);
  }
  // A CPX number is not a BL number, and the reverse.
  const missing = await preflight('capex', 'item_number,name\nCPX-120,Racks\nOPX-120,Racks\n', stored, { cat });
  assert.deepEqual(rowErrors(missing), [
    [2, 'item_number', "item_number 'CPX-120' does not match a line."],
    [3, 'item_number', "item_number 'OPX-120' does not match a line."],
  ]);
  // A bare number keeps its former meaning in a file without a nature column: on the CAPEX list
  // its CPX number, on the OPEX list the OPEX line's number. With the column, it is a BL number.
  for (const [scope, text, expected] of [
    ['capex', 'item_number,name\n4,Racks\n', capexLine],
    ['opex', 'item_number,name\n3,Widget\n', opexLine],
    ['capex', 'nature,item_number,name\ncapex,120,Racks\n', capexLine],
    ['opex', 'nature,item_number,name\nopex,3,Widget\n', opexLine],
  ] as Array<[BudgetFileScope, string, StoredLine]>) {
    const report = await preflight(scope, text, stored, { cat });
    assert.deepEqual(report.snapshot.lines.map((item) => item.id), [expected.id], `${scope}: ${text.split('\n')[1]} (${JSON.stringify(report.errors)})`);
  }
  const bareCpx = await preflight('capex', 'item_number,name\n120,Racks\n', stored, { cat });
  assert.deepEqual(rowErrors(bareCpx), [[2, 'item_number', "item_number '120' does not match a line."]], 'on the CAPEX list of before, 120 is CPX-120');
  const deletedCpx = await preflight('capex', 'item_number,name,kanap_token\n9,Gone,v1\n', stored, { cat });
  assert.deepEqual(rowErrors(deletedCpx), [[2, 'item_number', 'CPX-9 is no longer available since the export.']], 'named as before');
  // A CAPEX line moved from OPEX keeps its OPX number (lot M): found by it, still a CAPEX line.
  const moved = line({ id: 'line-9', nature: 'capex', itemNumber: 9, legacyNumber: 'OPX-9', name: 'Moved' });
  const byOpx = await preflight('capex', 'item_number,name\nOPX-9,Moved\n', [moved], { cat });
  assert.equal(byOpx.ok, true, JSON.stringify(byOpx.errors));
  // A line named in a file without a nature column, of the other nature: named as the file names it.
  const otherList = await preflight('opex', 'item_number,name\nCPX-4,Racks\n', stored, { cat });
  assert.deepEqual(rowErrors(otherList), [[2, 'item_number', natureChangeMessage('CPX-4 (BL-120)', 'capex', 'opex')]]);
  const twice = await preflight('opex', `${header}opex,BL-3,Widget\nopex,OPX-3,Widget\n`, stored, { cat });
  assert.deepEqual(rowErrors(twice), [[3, 'item_number', 'item_number OPX-3 and BL-3 on line 2 are the same line, BL-3.']]);
  assert.deepEqual(['x', 'BL-0', 'PRJ-3', 'BL-'].map((raw) => parseItemNumber({ kind: 'value', text: raw }).kind), ['invalid', 'invalid', 'invalid', 'invalid']);
  assert.deepEqual(parseItemNumber({ kind: 'value', text: ' 12 ' }), { kind: 'number', prefix: 'BL', n: 12, raw: '12', ref: 'BL-12' }, 'a bare number is a BL number');
}

/**
 * One right for every budget line (lot R): a file holding both natures loads from either list, and
 * an OPX or CPX number names its line from either list. A file without a `nature` column is still
 * read as lines of its list, so a number naming a line of the other nature is refused as a change
 * of type, never for a right.
 */
async function testMixedFileFromEitherList() {
  const { stored, cat } = natureFixture();
  const file = 'nature,item_number,name,company_name,account_number,currency\nopex,BL-3,Widget Pro,,,\ncapex,BL-120,Racks v2,,,\ncapex,,Server,Acme,2100,EUR\n';
  for (const scope of ['opex', 'capex'] as const) {
    const plan = await planOf(scope, file, stored, { cat });
    assert.equal(plan.report.ok, true, `${scope} list: ${JSON.stringify(plan.report.errors)}`);
    assert.deepEqual(plan.plans.map((item) => item.nature), ['opex', 'capex', 'capex'], `${scope} list: each line its nature`);
    assert.deepEqual(plan.report.snapshot.lines.map((item) => item.id), ['line-1', 'line-2'], `${scope} list: both lines read`);
    assert.ok(!plan.report.errors.some((error) => /Admin level/.test(error.message)), `${scope} list: no right by nature`);
  }
  // Numbers of before lot C1b, in a file without the nature column (read as lines of its list).
  const opexList = await preflight('opex', 'item_number,name\nCPX-4,Racks\nCPX-99,Nothing\n', stored, { cat });
  assert.deepEqual(rowErrors(opexList).map((error) => error[2]), [
    natureChangeMessage('CPX-4 (BL-120)', 'capex', 'opex'),
    "item_number 'CPX-99' does not match a line.",
  ], 'OPEX list: the CAPEX line is found, and keeps its nature');
  const capexList = await preflight('capex', 'item_number,name\nOPX-3,Widget\nOPX-99,Nothing\n', stored, { cat });
  assert.deepEqual(rowErrors(capexList).map((error) => error[2]), [
    natureChangeMessage('OPX-3 (BL-3)', 'opex', 'capex'),
    "item_number 'OPX-99' does not match a line.",
  ], 'CAPEX list: the OPEX line is found, and keeps its nature');
}

/** Dimensions by the line's nature: a dimension of the other nature stays empty; a required one binds its nature only. */
async function testDimensionsByNature() {
  const { stored, cat: base } = natureFixture();
  const cat = catalog({
    ...base,
    dimensions: [
      { code: 'menu', name: 'Menu', required: true, axisName: 'Menu', appliesTo: 'opex', values: [{ id: 'm1', name: 'Fromage', disabledAt: null }] },
      { code: 'priority', name: 'Priority', required: true, axisName: 'Priority', appliesTo: 'capex', values: [{ id: 'p1', name: 'High', disabledAt: null }] },
      { code: 'nature', name: 'Nature', required: false, axisName: 'Nature', appliesTo: null, values: [{ id: 'n1', name: 'Licences', disabledAt: null }] },
    ],
  });
  const options = { cat, dimensions: ['menu', 'priority', 'nature'] };
  const header = 'nature,item_number,name,company_name,account_number,currency,analytics:menu,analytics:priority,analytics:nature\n';
  const fine = await preflight('opex', `${header}opex,,Widget,Acme,6100,EUR,Fromage,,Licences\ncapex,,Server,Acme,2100,EUR,,High,Licences\n`, [], options);
  assert.equal(fine.ok, true, `each line needs the required dimensions of its own nature: ${JSON.stringify(fine.errors)}`);
  const refused = await preflight('opex', [
    header.trim(),
    // Not titled as BL-3: its lookalike would be left out, errors included (lot I2 of 26.11.9).
    'opex,,Gadget,Acme,6100,EUR,Fromage,High,',
    'capex,,Server,Acme,2100,EUR,Fromage,High,',
    'capex,BL-120,Racks,,,,-,,',
    'capex,,Bare,Acme,2100,EUR,,,',
  ].join('\n'), stored, options);
  assert.deepEqual(rowErrors(refused), [
    [2, 'analytics:priority', 'The Priority dimension is for CAPEX lines only. Leave it out.'],
    [3, 'analytics:menu', 'The Menu dimension is for OPEX lines only. Leave it out.'],
    [4, 'analytics:menu', 'The Menu dimension is for OPEX lines only. Leave it out.'],
    [5, 'analytics:priority', 'The Priority dimension is required. Choose a value.'],
  ]);
}

/** The freeze of a line's own nature: a year frozen for CAPEX only stops the CAPEX lines, not the OPEX ones. */
async function testFreezeByNature() {
  const { opexLine, capexLine, cat } = natureFixture();
  const stored = [line({ ...opexLine, versions: withJanuary(10000n) }), line({ ...capexLine, versions: withJanuary(10000n) })];
  const file = 'nature,item_number,name,budget_2026\nopex,BL-3,Widget,200.00\ncapex,BL-120,Racks,200.00\n';
  const capexFrozen = await preflight('opex', file, stored, { cat: catalog({ ...cat, frozen: ['capex:2026:budget'] }) });
  assert.deepEqual(rowErrors(capexFrozen), [[3, 'budget_2026', 'Budget for 2026 is frozen.']]);
  const opexFrozen = await preflight('opex', file, stored, { cat: catalog({ ...cat, frozen: ['opex:2026:budget'] }) });
  assert.deepEqual(rowErrors(opexFrozen), [[2, 'budget_2026', 'Budget for 2026 is frozen.']]);
}

/**
 * A new row looks like a stored line of its own nature only (lot I2 of 26.11.9), and is left out; two
 * rows of the file alike stay a warning, both created.
 */
async function testDuplicatesByNature() {
  const { stored, cat } = natureFixture();
  const header = 'nature,item_number,name,company_name,account_number,currency\n';
  const report = await preflight('opex', [
    header.trim(),
    'capex,,Widget,Acme,2100,EUR',
    'opex,,Racks,Acme,6100,EUR',
    'capex,,Racks,Acme,2100,EUR',
    'opex,,Twin,Acme,6100,EUR',
    'capex,,Twin,Acme,2100,EUR',
    'capex,,Twin,Acme,2100,EUR',
  ].join('\n'), stored, { cat });
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.deepEqual(report.lookalikes?.lines.map((entry) => [entry.line, entry.nature, entry.target.ref, entry.outcome]), [[4, 'capex', 'BL-120', 'ignored']]);
  assert.deepEqual(report.warnings.duplicates, [
    { line: 7, message: 'row 7 looks like row 6', code: 'BUDGET_FILE_LOOKS_LIKE_ROW', params: { line: 7, row: 6 } },
  ]);
  assert.deepEqual(report.changes.createdLines.map((entry) => entry.line), [2, 3, 5, 6, 7]);
}

/* ---- Lookalikes and consistency (lot I2 of 26.11.9) ---- */

/** The lines the check reads for the lookalikes: every stored line, with its yearly totals and state. */
function hintsOf(stored: StoredLine[]): LineHint[] {
  return stored.map((item) => ({
    nature: item.nature, itemNumber: item.itemNumber, name: item.name, supplierId: item.supplierId,
    id: item.id, companyId: item.companyId, accountId: item.accountId, currency: item.currency, rowVersion: item.rowVersion,
    endOfValidity: item.endOfValidity,
    years: item.versions.map((version) => ({
      year: version.year, versionId: version.id, budgetRev: version.budgetRev,
      totals: Object.fromEntries(AMOUNT_MEASURES.map((measure) => [measure, version.months[measure].reduce((sum, cell) => sum + (cell.cents ?? 0n), 0n)])),
    })),
  }));
}

/** A version of `year` whose Budget is `cents`, in January. */
function budgetOf(cents: bigint, year = YEAR, id = `ver-${year}-${cents}`): StoredVersion {
  const months = emptyMonths();
  months.planned[0] = { cents };
  return { id, year, budgetRev: 1, months };
}

const LOOK_HEADER = 'nature,item_number,name,company_name,account_number,currency,supplier_name,budget_2026';
const TWO_YEARS = `${LOOK_HEADER},budget_2027`;

/** Two companies, an account, two suppliers; four lines: Microsoft 365 E3 and E5 (OPEX), two data centres (CAPEX, no supplier, two years). */
function lookFixture(patch: { stored?: StoredLine[]; cat?: Partial<BudgetCatalog> } = {}) {
  const cat = catalog({
    companies: [
      { id: 'c1', name: 'Acme', coaId: 'chart', disabledAt: null, baseCurrency: 'EUR' },
      { id: 'c2', name: 'Other', coaId: 'chart', disabledAt: null, baseCurrency: 'EUR' },
    ],
    accounts: [{ id: 'a1', number: '6100', coaId: 'chart', disabledAt: null }],
    suppliers: [
      { id: 's1', name: 'Microsoft', erpId: null, disabledAt: null },
      { id: 's2', name: 'Orange', erpId: null, disabledAt: null },
    ],
    ...patch.cat,
  });
  const base = { companyId: 'c1', accountId: 'a1', legacyNumber: null };
  const stored = patch.stored ?? [
    line({ ...base, id: 'l10', itemNumber: 10, name: 'Microsoft 365 E3', supplierId: 's1', versions: [budgetOf(12000000n)] }),
    line({ ...base, id: 'l11', itemNumber: 11, name: 'Microsoft 365 E5', supplierId: 's1', versions: [budgetOf(20000000n)] }),
    line({ ...base, id: 'l13', itemNumber: 13, nature: 'capex', name: 'Data center', versions: [budgetOf(25000000n), budgetOf(26000000n, YEAR + 1)] }),
    line({ ...base, id: 'l12', itemNumber: 12, nature: 'capex', name: 'Rénovation data center', versions: [budgetOf(25000000n), budgetOf(26000000n, YEAR + 1)] }),
  ];
  return { cat, stored };
}

async function lookPlan(
  rows: string[],
  options: { header?: string; stored?: StoredLine[]; cat?: BudgetCatalog; choices?: BudgetFileChoice[]; access?: BudgetFileAccess; createSuppliers?: boolean } = {},
) {
  const fixture = lookFixture({ stored: options.stored });
  const read = await readBudgetCsv([options.header ?? LOOK_HEADER, ...rows].join('\n'), { language: 'en', dimensionCodes: [] });
  return planBudgetFile({
    scope: 'opex', read, catalog: options.cat ?? fixture.cat, stored: fixture.stored, names: hintsOf(fixture.stored),
    createSuppliers: options.createSuppliers ?? false, canCreateSuppliers: options.createSuppliers ?? false,
    currentYear: YEAR, labels: { budget: 'Budget' },
    ...(options.access ? { access: options.access } : {}),
    ...(options.choices ? { matching: { choices: options.choices } } : {}),
  });
}

/** The choices for one row the check followed. */
const rowChoices = (report: { matching?: { choices: BudgetFileChoice[] } }) => (report.matching?.choices ?? []).filter((choice) => choice.kind === 'lookalike');

const looks = (report: { lookalikes?: { lines: Array<{ line: number; target: { ref: string }; reason?: string; outcome: string }> } }) =>
  report.lookalikes?.lines.map((entry) => [entry.line, entry.target.ref, entry.reason, entry.outcome]) ?? [];

/** The three rules, their order, and what is no lookalike. */
async function testLookalikeRules() {
  // a. The same title, case and accents aside, and the same supplier (none on both included).
  const a = await lookPlan(['opex,,microsoft 365 e3,Acme,6100,EUR,Microsoft,999', 'capex,,Renovation Data Center,Acme,6100,EUR,,1']);
  assert.deepEqual(looks(a.report), [[2, 'BL-10', 'title_supplier', 'ignored'], [3, 'BL-12', 'title_supplier', 'ignored']]);
  assert.deepEqual(a.plans, [], 'a row left out is not planned');
  assert.equal(a.report.ok, true);
  // b. Every amount equal, the same currency, company and account: a translated title. Two lines hold
  // the amount: the smaller number. A line found by its title comes before one found by its amounts.
  const b = await lookPlan(['capex,,Data centre refresh,Acme,6100,EUR,,250000,260000', 'capex,,Data center,Acme,6100,EUR,,250000,260000'], { header: TWO_YEARS });
  assert.deepEqual(looks(b.report), [[2, 'BL-12', 'amounts', 'ignored'], [3, 'BL-13', 'title_supplier', 'ignored']]);
  // c. A close title, the same supplier and one amount equal (another one differs: not b).
  const close = await lookPlan(['opex,,Microsoft 365 E3 licence,Acme,6100,EUR,Microsoft,120000,5000'], { header: `${LOOK_HEADER},budget_2027` });
  assert.deepEqual(looks(close.report), [[2, 'BL-10', 'close_title', 'ignored']]);
  // No lookalike: E5 against E3 alone without an equal amount; equal amounts in another currency; equal
  // amounts of another company and another supplier.
  const e3 = lookFixture().stored.filter((item) => item.itemNumber === 10);
  const e5 = await lookPlan(['opex,,Microsoft 365 E5,Acme,6100,EUR,Microsoft,200000'], { stored: e3 });
  assert.deepEqual(looks(e5.report), []);
  assert.equal(e5.report.changes.created, 1);
  const usd = await lookPlan(['capex,,Data centre refresh,Acme,6100,USD,,250000,260000'], { header: TWO_YEARS });
  assert.deepEqual(looks(usd.report), []);
  const other = await lookPlan(['opex,,Licences,Other,6100,EUR,Orange,120000']);
  assert.deepEqual(looks(other.report), []);
  // Months summed by year before they are compared with the yearly total.
  const months = await lookPlan(['capex,,Data centre refresh,Acme,6100,EUR,,100000,150000,260000'],
    { header: 'nature,item_number,name,company_name,account_number,currency,supplier_name,budget_2026_01,budget_2026_02,budget_2027' });
  assert.deepEqual(looks(months.report), [[2, 'BL-12', 'amounts', 'ignored']]);
}

/** A row left out leaves nothing behind: its supplier to create is not created, nor listed. */
async function testLeftOutLeavesNothing() {
  const left = await lookPlan(['capex,,Data centre refresh,Acme,6100,EUR,Newco,250000,260000'], { header: TWO_YEARS, createSuppliers: true });
  assert.deepEqual(looks(left.report), [[2, 'BL-12', 'amounts', 'ignored']], 'a supplier to create does not stop the amounts rule');
  assert.equal(left.report.creates.supplierCount, 0);
  assert.deepEqual(left.report.creates.suppliers, []);
  assert.deepEqual(left.report.matching?.candidates, []);
  assert.deepEqual(left.plans, []);
  const anyway = await lookPlan(['capex,,Data centre refresh,Acme,6100,EUR,Newco,250000,260000'], {
    header: TWO_YEARS, createSuppliers: true, choices: [{ kind: 'lookalike', line: 2, action: 'create' }],
  });
  assert.deepEqual(looks(anyway.report), [[2, 'BL-12', 'amounts', 'created']]);
  assert.equal(anyway.report.creates.supplierCount, 1);
  assert.equal(anyway.plans.length, 1);
  assert.deepEqual(rowChoices(anyway.report), [{ kind: 'lookalike', line: 2, action: 'create' }]);
}

/**
 * Review 3 of lot I3, C4: BL-10 deleted after a check, then a new check: its targets carry the line gone
 * (an empty state). "Create all anyway", "Update all" and "Leave all out" send them back, through the
 * screen's route and Kad's choice route alike: read, and followed (BL-10 cannot be updated: left out).
 */
async function testChoicesForAllWithALineGone() {
  const row = 'opex,,Microsoft 365 E3,Acme,6100,EUR,Microsoft,130000';
  const shown = await lookPlan([row]);
  const chosen: BudgetFileChoice[] = [{ kind: 'lookalike', line: 2, action: 'update', item: 10, state: shown.report.lookalikes!.lines[0].target.state }];
  const after = await lookPlan([row], { stored: [], choices: chosen });
  const targets = after.report.lookalikes!.targets;
  assert.deepEqual(targets, { 2: { item: 10, state: '' } });
  for (const [action, outcome] of [['create', 'created'], ['update', 'ignored'], ['ignore', 'ignored']] as const) {
    const all = [{ kind: 'lookalikes', action, targets }];
    const screen = budgetFileChoices(JSON.stringify(all));
    const card = parseImportChoices('budget_lines', all);
    assert.deepEqual(card, screen, action);
    const plan = await lookPlan([row], { stored: [], choices: screen as BudgetFileChoice[] });
    assert.equal(plan.report.ok, true, JSON.stringify(plan.report.errors));
    // Gone, BL-10 has no reference to show (correctifs J).
    assert.deepEqual(plan.report.lookalikes!.lines.map((entry) => [entry.line, entry.target.ref, entry.outcome]), [[2, '', outcome]], action);
  }
}

/** "Update BL-n": through the read, as if the file named the line; refused when it cannot be. */
async function testLookalikeUpdate() {
  const { stored } = lookFixture();
  const e3 = stored.find((item) => item.itemNumber === 10)!;
  const state = storedState(e3);
  const row = 'opex,,Microsoft 365 E3,Acme,6100,EUR,Microsoft,130000';
  const shown = await lookPlan([row]);
  assert.equal(shown.report.lookalikes?.lines[0].target.state, state);
  assert.equal(shown.report.lookalikes?.lines[0].updatable, true);
  const updated = await lookPlan([row], { choices: [{ kind: 'lookalike', line: 2, action: 'update', item: 10 }] });
  assert.equal(updated.report.ok, true, JSON.stringify(updated.report.errors));
  assert.deepEqual([updated.report.changes.created, updated.report.changes.updated], [0, 1]);
  assert.deepEqual(updated.plans.map((plan) => [plan.itemId, plan.creating, plan.amounts.map((amount) => amount.cents)]), [['l10', false, [13000000n]]]);
  assert.deepEqual(updated.report.lookalikes?.lines[0].fields, ['budget 2026']);
  assert.deepEqual(rowChoices(updated.report), [{ kind: 'lookalike', line: 2, action: 'update', item: 10, state }], 'the state kept');
  assert.equal(updated.report.snapshot.lines[0].id, 'l10', 'the load\'s snapshot holds the line');
  // Another target than the line it looks like: no longer applies, the row is left out.
  const elsewhere = await lookPlan([row], { choices: [{ kind: 'lookalike', line: 2, action: 'update', item: 11 }] });
  assert.deepEqual(looks(elsewhere.report), [[2, 'BL-10', 'title_supplier', 'ignored']]);
  assert.deepEqual(rowChoices(elsewhere.report), []);
  // Changed since the check: a new error on the row.
  const stale = await lookPlan([row], { choices: [{ kind: 'lookalike', line: 2, action: 'update', item: 10, state: '0000000000000000' }] });
  assert.equal(stale.report.ok, false);
  assert.deepEqual(stale.report.errors.map((error) => [error.line, error.code, error.params]), [[2, 'BUDGET_FILE_LOOKALIKE_CHANGED', { ref: 'BL-10' }]]);
  // A frozen year: the update fails on its row.
  const frozen = await lookPlan([row], {
    cat: { ...lookFixture().cat, frozen: ['opex:2026:budget'] }, choices: [{ kind: 'lookalike', line: 2, action: 'update', item: 10 }],
  });
  assert.deepEqual(frozen.report.errors.map((error) => [error.line, error.code]), [[2, 'BUDGET_FILE_FROZEN']]);
  // A line read only in a limited person's access: "Update" is not offered, the choice falls back.
  const readOnly: BudgetFileAccess = { editable: new Set(['l11']), places: new Map(), wanted: new Map() };
  const limited = await lookPlan([row], { access: readOnly, choices: [{ kind: 'lookalike', line: 2, action: 'update', item: 10 }] });
  assert.deepEqual(limited.report.lookalikes?.lines.map((entry) => [entry.updatable, entry.outcome]), [[false, 'ignored']]);
  assert.deepEqual(limited.plans, []);
  // Two rows of the file on the same line: the first one updates it, the next one is left out (C1).
  const second = 'opex,,MICROSOFT 365 E3,Acme,6100,EUR,Microsoft,140000';
  const twice = await lookPlan([row, second], { choices: [{ kind: 'lookalikes', action: 'update' }] });
  assert.equal(twice.report.ok, true, JSON.stringify(twice.report.errors));
  assert.deepEqual(looks(twice.report), [[2, 'BL-10', 'title_supplier', 'updated'], [3, 'BL-10', 'title_supplier', 'ignored']]);
  assert.deepEqual(twice.report.warnings.consistency?.map((warning) => [warning.line, warning.code, warning.params]), [
    [3, 'BUDGET_FILE_LOOKALIKE_SAME_LINE', { line: 3, other: 2, ref: 'BL-10' }],
  ]);
  assert.deepEqual(twice.plans.map((plan) => plan.itemId), ['l10']);
  const both = await lookPlan([row, second], { choices: [
    { kind: 'lookalike', line: 2, action: 'update', item: 10, state }, { kind: 'lookalike', line: 3, action: 'update', item: 10, state },
  ] });
  assert.deepEqual(looks(both.report), [[2, 'BL-10', 'title_supplier', 'updated'], [3, 'BL-10', 'title_supplier', 'ignored']]);
  assert.deepEqual(rowChoices(both.report), [{ kind: 'lookalike', line: 2, action: 'update', item: 10, state }], 'the second choice falls back');
  // A row that names the line by its number updates it, wherever it stands.
  const named = await lookPlan([row, 'opex,BL-10,Microsoft 365 E3,Acme,6100,EUR,Microsoft,140000'], {
    choices: [{ kind: 'lookalike', line: 2, action: 'update', item: 10, state }],
  });
  assert.equal(named.report.ok, true, JSON.stringify(named.report.errors));
  assert.deepEqual(looks(named.report), [[2, 'BL-10', 'title_supplier', 'ignored']]);
  assert.deepEqual(named.report.warnings.consistency?.map((warning) => [warning.line, warning.code, warning.params]), [
    [2, 'BUDGET_FILE_LOOKALIKE_SAME_LINE', { line: 2, other: 3, ref: 'BL-10' }],
  ]);
  assert.equal(named.report.changes.updated, 1);
}

/**
 * A choice that names a line keeps it when the row no longer looks like it (B1): an update is refused
 * when the line changed since the check, and a row left out by default stays left out.
 */
async function testLookalikeTargetKept() {
  const { stored } = lookFixture();
  const e3 = stored.find((item) => item.itemNumber === 10)!;
  const row = 'opex,,Microsoft 365 E3,Acme,6100,EUR,Microsoft,130000';
  const renamed = stored.map((item) => (item.itemNumber === 10 ? { ...item, name: 'M365 E3 (renewed)', rowVersion: item.rowVersion + 1 } : item));
  const refused = (report: { ok: boolean; errors: Array<{ line: number; code?: string }>; changes: { created: number; updated: number } }) =>
    [report.ok, report.errors.map((error) => [error.line, error.code]), report.changes.created, report.changes.updated];
  // "Update BL-10", then BL-10 renamed before the load.
  const one = await lookPlan([row], { stored: renamed, choices: [{ kind: 'lookalike', line: 2, action: 'update', item: 10, state: storedState(e3) }] });
  assert.deepEqual(refused(one.report), [false, [[2, 'BUDGET_FILE_LOOKALIKE_CHANGED']], 0, 0]);
  // "Update all", with the targets the check gave.
  const shown = await lookPlan([row]);
  assert.deepEqual(shown.report.lookalikes?.targets, { 2: { item: 10, state: storedState(e3) } });
  const all = await lookPlan([row], { stored: renamed, choices: [{ kind: 'lookalikes', action: 'update', targets: shown.report.lookalikes!.targets }] });
  assert.deepEqual(refused(all.report), [false, [[2, 'BUDGET_FILE_LOOKALIKE_CHANGED']], 0, 0]);
  // Left out by default: the check gives its targets back, and the row stays left out.
  const left = await lookPlan([row], { stored: renamed, choices: shown.report.matching!.choices });
  assert.deepEqual(refused(left.report), [true, [], 0, 0]);
  assert.deepEqual(looks(left.report), [[2, 'BL-10', undefined, 'ignored']]);
  // Found by its amounts; its Budget edited meanwhile.
  const dcRow = 'capex,,Data centre refresh,Acme,6100,EUR,,250000,260000';
  const dcShown = await lookPlan([dcRow], { header: TWO_YEARS });
  assert.deepEqual(looks(dcShown.report), [[2, 'BL-12', 'amounts', 'ignored']]);
  const edited = stored.map((item) => (item.itemNumber === 12
    ? { ...item, versions: [{ ...budgetOf(26500000n), id: item.versions[0].id, budgetRev: 2 }, item.versions[1]] }
    : item));
  const dc = await lookPlan([dcRow], {
    header: TWO_YEARS, stored: edited,
    choices: [{ kind: 'lookalike', line: 2, action: 'update', item: 12, state: dcShown.report.lookalikes!.lines[0].target.state }],
  });
  assert.deepEqual(refused(dc.report), [false, [[2, 'BUDGET_FILE_LOOKALIKE_CHANGED']], 0, 0]);
  const dcLeft = await lookPlan([dcRow], { header: TWO_YEARS, stored: edited, choices: dcShown.report.matching!.choices });
  assert.deepEqual(refused(dcLeft.report), [true, [], 0, 0]);
  // Chosen again on the new state: the update goes through.
  const again = await lookPlan([dcRow], {
    header: TWO_YEARS, stored: edited, choices: [...dcShown.report.matching!.choices, { kind: 'lookalike', line: 2, action: 'update', item: 12, state: dcLeft.report.lookalikes!.lines[0].target.state }],
  });
  assert.deepEqual(refused(again.report), [true, [], 0, 1]);
  // Correctifs J: BL-10 deleted since the check. The row reads by its line and title only (no reference),
  // offers no update, and stays left out, by default as with "Update all" (as the applications, T-I3l).
  const deleted = stored.filter((item) => item.itemNumber !== 10);
  for (const choices of [shown.report.matching!.choices, [{ kind: 'lookalikes' as const, action: 'update' as const, targets: shown.report.lookalikes!.targets }]]) {
    const gone = await lookPlan([row], { stored: deleted, choices });
    assert.deepEqual(refused(gone.report), [true, [], 0, 0]);
    assert.deepEqual(gone.report.lookalikes?.lines.map((entry) => [entry.line, entry.name, entry.target.ref, entry.target.name, entry.updatable, entry.outcome]),
      [[2, 'Microsoft 365 E3', '', '', false, 'ignored']]);
  }
}

/** T-I2f: the same paying company in every rule, two amounts without the same supplier, a close title in the same currency, no ended line. */
async function testLookalikeCompanyAndEnd() {
  const base = { accountId: 'a1', legacyNumber: null };
  const acme = line({ ...base, id: 'l10', itemNumber: 10, name: 'Microsoft 365 E3', supplierId: 's1', companyId: 'c1', versions: [budgetOf(1200000n)] });
  const other = line({ ...base, id: 'l20', itemNumber: 20, name: 'Microsoft 365 E3', supplierId: 's1', companyId: 'c2', companyName: 'Other', versions: [budgetOf(800000n)] });
  // A. A row of Other looks like Other's line, not Acme's.
  const a = await lookPlan(['opex,,Microsoft 365 E3,Other,6100,EUR,Microsoft,9000'], { stored: [acme, other] });
  assert.deepEqual(looks(a.report), [[2, 'BL-20', 'title_supplier', 'ignored']]);
  // B. Equal amounts and the same supplier: the line of the row's company.
  const b1 = line({ ...base, id: 'b1', itemNumber: 30, name: 'Licences Acme', supplierId: 's1', companyId: 'c1', versions: [budgetOf(500000n)] });
  const b2 = line({ ...base, id: 'b2', itemNumber: 31, name: 'Licences Other', supplierId: 's1', companyId: 'c2', companyName: 'Other', versions: [budgetOf(500000n)] });
  const b = await lookPlan(['opex,,Lizenzen,Other,6100,EUR,Microsoft,5000'], { stored: [b1, b2] });
  assert.deepEqual(looks(b.report), [[2, 'BL-31', 'amounts', 'ignored']]);
  // A new subsidiary's budget, titled and priced as the parent company's lines: nothing left out.
  const fixture = lookFixture();
  const subsidiary = { ...fixture.cat, companies: [...fixture.cat.companies, { id: 'c3', name: 'Filiale', coaId: 'chart', disabledAt: null, baseCurrency: 'EUR' }] };
  const sub = await lookPlan(['opex,,Microsoft 365 E3,Filiale,6100,EUR,Microsoft,120000,', 'capex,,Rénovation data center,Filiale,6100,EUR,,250000,260000'], {
    header: TWO_YEARS, cat: subsidiary,
  });
  assert.deepEqual(looks(sub.report), []);
  assert.equal(sub.report.changes.created, 2);
  // E. One equal amount without a common supplier is no lookalike; two are.
  const hosting = line({ ...base, id: 'e1', itemNumber: 50, name: 'Hosting', versions: [budgetOf(1200000n), budgetOf(1300000n, YEAR + 1)] });
  const e = await lookPlan(['opex,,Brand new SaaS,Acme,6100,EUR,,12000,'], { stored: [hosting], header: TWO_YEARS });
  assert.deepEqual([looks(e.report), e.report.changes.created], [[], 1]);
  const two = await lookPlan(['opex,,Hébergement,Acme,6100,EUR,,12000,13000'], { stored: [hosting], header: TWO_YEARS });
  assert.deepEqual(looks(two.report), [[2, 'BL-50', 'amounts', 'ignored']]);
  // A close title and an equal amount in another currency: no lookalike.
  const close = await lookPlan(['opex,,Microsoft 365 E3 licence,Acme,6100,USD,Microsoft,12000'], { stored: [acme] });
  assert.deepEqual(looks(close.report), []);
  // H. A line ended in 2024 is no target of a 2026 row; a line still running is.
  const ended = line({ ...base, id: 'd1', itemNumber: 40, name: 'Antivirus', supplierId: 's1', endOfValidity: '2024-12-31T12:00:00.000Z', versions: [budgetOf(300000n, 2024)] });
  const h = await lookPlan(['opex,,Antivirus,Acme,6100,EUR,Microsoft,4000'], { stored: [ended] });
  assert.deepEqual([looks(h.report), h.report.changes.created], [[], 1]);
  const running = line({ ...base, id: 'd2', itemNumber: 41, name: 'Antivirus', supplierId: 's1' });
  const h2 = await lookPlan(['opex,,Antivirus,Acme,6100,EUR,Microsoft,4000'], { stored: [ended, running] });
  assert.deepEqual(looks(h2.report), [[2, 'BL-41', 'title_supplier', 'ignored']]);
  // A file without a company column: the workspace's only company pays the row.
  const single = { ...fixture.cat, companies: [fixture.cat.companies[0]] };
  const bare = await lookPlan(['opex,,Microsoft 365 E3,6100,EUR,Microsoft,999'], {
    cat: single, header: 'nature,item_number,name,account_number,currency,supplier_name,budget_2026',
  });
  assert.deepEqual(looks(bare.report), [[2, 'BL-10', 'title_supplier', 'ignored']]);
}

/** More lookalikes than the report lists: the choice for all rows reaches them; a row's own choice wins. */
async function testManyLookalikes() {
  const stored = Array.from({ length: 250 }, (_, index) => line({
    id: `m${index}`, itemNumber: 100 + index, legacyNumber: null, name: `Line ${index}`, supplierId: 's2', companyId: 'c1', accountId: 'a1',
    versions: [budgetOf(BigInt(100 + index) * 100n)],
  }));
  const rows = stored.map((item, index) => `opex,,Line ${index},Acme,6100,EUR,Orange,${100 + index}`);
  const left = await lookPlan(rows, { stored });
  assert.deepEqual([left.report.lookalikes?.lines.length, left.report.lookalikes?.count, left.report.lookalikes?.ignored], [200, 250, 250]);
  const created = await lookPlan(rows, { stored, choices: [{ kind: 'lookalikes', action: 'create' }, { kind: 'lookalike', line: 2, action: 'ignore' }] });
  assert.deepEqual([created.report.changes.created, created.report.lookalikes?.ignored], [249, 1]);
  const updated = await lookPlan(rows, { stored, choices: [{ kind: 'lookalikes', action: 'update' }] });
  assert.equal(updated.report.ok, true, JSON.stringify(updated.report.errors.slice(0, 3)));
  assert.deepEqual([updated.report.lookalikes?.updated, updated.report.changes.unchanged], [250, 250]);
  const all = updated.report.matching?.choices.find((choice) => choice.kind === 'lookalikes');
  assert.equal(all?.kind === 'lookalikes' && Object.keys(all.targets ?? {}).length, 250);
  // "Update all" as the screen sends it: the targets of every row, beyond the 200 listed (B3).
  assert.equal(Object.keys(left.report.lookalikes?.targets ?? {}).length, 250);
  const screen = await lookPlan(rows, { stored, choices: [{ kind: 'lookalikes', action: 'update', targets: left.report.lookalikes!.targets }] });
  assert.deepEqual([screen.report.ok, screen.report.lookalikes?.updated, screen.report.lookalikes?.ignored], [true, 250, 0]);
}

/** The consistency warnings: never a refusal (P3), never below three comparable lines or without a supplier. */
async function testConsistency() {
  const orange = (n: number, cents: bigint) => line({
    id: `o${n}`, itemNumber: 200 + n, legacyNumber: null, name: `Orange ${n}`, supplierId: 's2', companyId: 'c1', accountId: 'a1', versions: [budgetOf(cents)],
  });
  const { stored } = lookFixture();
  const three = [...stored, orange(1, 1000000n), orange(2, 1200000n), orange(3, 1100000n)];
  const far = await lookPlan(['opex,,Fibre,Acme,6100,EUR,Orange,500000', 'opex,,Fibre 2,Acme,6100,EUR,Orange,11000'], { stored: three });
  assert.equal(far.report.ok, true);
  assert.deepEqual(far.report.warnings.consistency?.map((warning) => [warning.line, warning.code, warning.params]), [
    [2, 'BUDGET_FILE_AMOUNT_FAR_FROM_SUPPLIER', { label: 'Budget', year: 2026, amount: '500 000', median: '11 000', count: 3, supplier: 'Orange' }],
  ]);
  const two = await lookPlan(['opex,,Fibre,Acme,6100,EUR,Orange,500000'], { stored: [...stored, orange(1, 1000000n), orange(2, 1200000n)] });
  assert.deepEqual(two.report.warnings.consistency, [], 'two comparable lines are no reference');
  const none = await lookPlan(['capex,,Serveurs,Acme,6100,EUR,,9000000'], { stored: three });
  assert.deepEqual(none.report.warnings.consistency, [], 'no supplier, no median');
  // Against the line the row looks like, created anyway.
  const anyway = await lookPlan(['opex,,Microsoft 365 E3,Acme,6100,EUR,Microsoft,1200000'], { choices: [{ kind: 'lookalike', line: 2, action: 'create' }] });
  assert.deepEqual(anyway.report.warnings.consistency?.map((warning) => [warning.code, warning.params]), [
    ['BUDGET_FILE_AMOUNT_FAR_FROM_LINE', { label: 'Budget', year: 2026, amount: '1 200 000', other: '120 000', ref: 'BL-10' }],
  ]);
  // Dates outside the years of the amounts, and a currency other than the company's.
  const dates = await lookPlan(['opex,,Fibre,Acme,6100,EUR,Orange,10500,2028-01-01,', 'opex,,Fibre 2,Acme,6100,USD,Orange,10500,,2025-06-30'],
    { header: `${LOOK_HEADER},effective_start,end_of_validity`, stored: three });
  assert.equal(dates.report.ok, true, JSON.stringify(dates.report.errors));
  assert.deepEqual(dates.report.warnings.consistency?.map((warning) => [warning.line, warning.code, warning.params]), [
    [2, 'BUDGET_FILE_START_AFTER_AMOUNTS', { start: '2028-01-01', year: 2026 }],
    [3, 'BUDGET_FILE_END_BEFORE_AMOUNTS', { end: '2025-06-30', year: 2026 }],
    [3, 'BUDGET_FILE_CURRENCY_NOT_COMPANY', { currency: 'USD', company: 'Acme', base: 'EUR' }],
  ]);
}

/** Both natures write the description, including clearing an existing text. */
async function testCapexDescription() {
  const { stored, cat } = natureFixture();
  const header = 'nature,item_number,name,description,company_name,account_number,currency\n';
  const planned = await planOf('opex', `${header}capex,,Server,A server,Acme,2100,EUR\ncapex,BL-120,Racks,-,,,\nopex,BL-3,Widget,Licences,,,\n`, stored, {
    cat,
  });
  assert.equal(planned.report.ok, true, JSON.stringify(planned.report.errors));
  assert.deepEqual(planned.plans.map((plan) => [plan.nature, plan.body.description]), [['capex', 'A server'], ['opex', 'Licences']], 'the CAPEX description is written');
  assert.deepEqual([planned.report.changes.unchanged, planned.report.changes.updated, planned.report.changes.created], [1, 1, 1]);
}

/** A text the app stored with a line break at its end reads back unchanged: the cell and the stored value are trimmed alike. */
async function testTrailingLineBreak() {
  const stored = line({ notes: 'test\n', description: '  Monitoring ' });
  const built = buildBudgetExport({ language: 'en', years: [YEAR], columns: ['budget'], detail: 'yearly', lines: [stored], dimensions: [] });
  const csv = writeCsv({ language: 'en', headers: built.headers, rows: budgetCsvRows(built.rows, 'en') });
  const report = await preflight('opex', csv, [stored]);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.deepEqual([report.changes.unchanged, report.changes.updated], [1, 0], 'an export read back changes nothing');
  const edited = await planOf('opex', 'item_number,name,notes\nBL-3,Widget,test 2\n', [stored]);
  assert.deepEqual(edited.plans.map((plan) => plan.body), [{ notes: 'test 2' }], 'a real change still writes');
}

/** company_name of another company than the cost center's: accepted, with one warning on the line. */
async function testCostCenterOfAnotherCompany() {
  const cat = catalog({
    companies: [
      { id: 'c1', name: 'Acme', coaId: null, disabledAt: null },
      { id: 'c2', name: 'Globex', coaId: null, disabledAt: null },
    ],
    accounts: [{ id: 'a1', number: '6100', coaId: null, disabledAt: null }],
    costCenters: [{ id: 'cc1', code: 'IT-100', kind: 'cost_center', companyId: 'c1', disabledAt: null }],
  });
  const header = 'item_number,name,company_name,cost_center_code,account_number,currency\n';
  const other = await preflight('opex', `${header},Widget,Globex,IT-100,6100,EUR\n`, [], { cat });
  assert.equal(other.ok, true, JSON.stringify(other.errors));
  assert.deepEqual(other.warnings.costCenterCompanies, [{
    line: 2,
    code: 'BUDGET_FILE_COST_CENTER_OTHER_COMPANY',
    costCenter: 'IT-100',
    company: 'Globex',
    costCenterCompany: 'Acme',
    message: 'Cost center IT-100 belongs to Acme. The line is paid by Globex.',
  }]);
  const same = await preflight('opex', `${header},Widget,Acme,IT-100,6100,EUR\n`, [], { cat });
  assert.deepEqual(same.warnings.costCenterCompanies, [], 'the cost center\'s own company');
  const fromCenter = await preflight('opex', `${header},Widget,,IT-100,6100,EUR\n`, [], { cat });
  assert.equal(fromCenter.ok, true, JSON.stringify(fromCenter.errors));
  assert.deepEqual(fromCenter.warnings.costCenterCompanies, [], 'an empty company_name takes the cost center\'s');
  // A stored line's cost center counts too when the file leaves the column out.
  const stored = line({ costCenterId: 'cc1', costCenterCode: 'IT-100' });
  const kept = await preflight('opex', 'item_number,name,company_name\nBL-3,Widget,Globex\n', [stored], { cat });
  assert.deepEqual(kept.warnings.costCenterCompanies.map((warning) => warning.line), [2]);
}

/** Past 20 calculation lines warnings, the list stops at 20 and the count says how many there are. */
async function testCalculationLinesCap() {
  const stored = computedLines(21);
  const rows = stored.map((item) => `BL-${item.itemNumber},${item.name},EUR,200.00`).join('\n');
  const report = await preflight('opex', `item_number,name,currency,budget_2026\n${rows}\n`, stored);
  assert.equal(report.ok, true, JSON.stringify(report.errors));
  assert.equal(report.changes.updated, 21);
  assert.equal(report.warnings.calculationLines.length, 20, 'the list is capped');
  assert.equal(report.warnings.calculationLinesCount, 21, 'the count is the full one');
  assert.deepEqual(report.warnings.calculationLines.map((warning) => warning.item), stored.slice(0, 20).map((item) => `BL-${item.itemNumber}`));
  assert.deepEqual(report.warnings.calculationLines[0], {
    line: 2,
    item: 'BL-1',
    column: 'budget',
    year: YEAR,
    count: 2,
    total: '100.00',
    message: 'BL-1 · Budget 2026: 2 calculation lines (100) will no longer drive these amounts.',
  });
}

/** No warning for a row in error, a frozen column, or a line the file creates. */
async function testCalculationLinesSilentCases() {
  const [stored] = computedLines(1);
  const inError = await preflight('opex', 'item_number,name,currency,budget_2026,revision_2026\nBL-1,Widget 1,EUR,200.00,1.234\n', [stored]);
  assert.ok(inError.errors.some((error) => error.message === 'revision_2026 has more than two decimals.'), JSON.stringify(inError.errors));
  assert.deepEqual([inError.warnings.calculationLines, inError.warnings.calculationLinesCount], [[], 0], 'a row in error says nothing about its lines');

  const frozen = await preflight('opex', 'item_number,name,currency,budget_2026\nBL-1,Widget 1,EUR,200.00\n', [stored], {
    cat: catalog({ frozen: ['opex:2026:budget'] }),
  });
  assert.ok(frozen.errors.some((error) => error.message === 'Budget for 2026 is frozen.'));
  assert.deepEqual(frozen.warnings.calculationLines, [], 'a frozen column is refused, not warned about');

  const cat = catalog({
    companies: [{ id: 'c1', name: 'Acme', coaId: 'chart', disabledAt: null }],
    accounts: [{ id: 'a1', number: '1200', coaId: 'chart', disabledAt: null }],
  });
  const created = await preflight(
    'opex',
    'item_number,name,company_name,account_number,currency,budget_2026\nBL-1,Widget 1,Acme,,EUR,100.00\n,New widget,Acme,1200,EUR,200.00\n',
    [stored],
    { cat },
  );
  assert.equal(created.ok, true, JSON.stringify(created.errors));
  assert.deepEqual([created.changes.created, created.changes.unchanged], [1, 1]);
  assert.deepEqual(created.warnings.calculationLines, [], 'a line the file creates has no calculation lines');
}

// A new value of a dimension that the analytics rules refuse (too long, invisible characters): the
// error carries a code and its values, which the dialog and Kad's card translate.
async function testRefusedNewDimensionValue() {
  const cat = catalog({
    accounts: [{ id: 'a1', number: '1200', coaId: null, disabledAt: null }],
    dimensions: [{ code: 'nature', name: 'Nature', required: false, axisName: 'Nature', values: [] }],
  });
  const options = { cat, dimensions: ['nature'] };
  const header = 'item_number,name,company_name,account_number,currency,analytics:nature\n';
  const long = await preflight('opex', `${header},Widget,Acme,1200,EUR,${'x'.repeat(201)}\n`, [], options);
  assert.deepEqual(
    long.errors.map((error) => [error.column, error.code, error.params]),
    [['analytics:nature', 'BUDGET_FILE_DIMENSION_VALUE_TOO_LONG', { name: 'Nature', max: 200 }]],
  );
  const hidden = await preflight('opex', `${header},Widget,Acme,1200,EUR,Lic\u200bences\n`, [], options);
  assert.deepEqual(
    hidden.errors.map((error) => [error.column, error.code, error.params]),
    [['analytics:nature', 'BUDGET_FILE_DIMENSION_VALUE_CHARACTERS', { name: 'Nature' }]],
  );
}

/**
 * The clearing rule of every import (D21 of 26.11.9, lot I6): the budget file reads its cells by
 * `readImportCell`. `-` and `__CLEAR__` clear a stored value, a blank cell keeps it, `'-` (the
 * export's guard on a stored "-", in CSV or as an Excel cell typed after an apostrophe) is the text
 * "-". The check counts the stored values its `-` cells clear (`changes.cleared`); a `-` on an empty
 * value counts nothing; the refusals stay (an amount, a dimension a line must hold).
 */
async function testClearRule() {
  const dimension = { code: 'nature', name: 'Nature', required: false, axisName: 'Nature', values: [{ id: 'v1', name: 'Licences', disabledAt: null }] };
  const cat = catalog({ dimensions: [dimension] });
  const options = { cat, dimensions: ['nature'] };
  const full = line({
    itemNumber: 3,
    costCenterId: 'cc1', costCenterCode: 'IT-100',
    supplierId: 's1', supplierName: 'Lactalis',
    description: 'Contrat annuel', notes: 'A revoir', runBuild: 'run',
    ownerItEmail: 'it@example.test', ownerBusinessEmail: 'biz@example.test',
    projectNumber: 4, endOfValidity: '2027-03-01T12:00:00.000Z',
    analytics: { nature: 'Licences' },
  });
  const header = 'item_number,cost_center_code,supplier_name,description,notes,run_build,owner_it_email,owner_business_email,project,end_of_validity,analytics:nature\n';
  // Every clearable value of a stored line, cleared by `-` (and `__CLEAR__`, the older mark): ten values.
  const cleared = await preflight('opex', `${header}BL-3,-,-,-,__CLEAR__,-,-,-,-,-,-\n`, [full], options);
  assert.equal(cleared.ok, true, JSON.stringify(cleared.errors));
  assert.deepEqual([cleared.changes.updated, cleared.changes.unchanged, cleared.changes.cleared], [1, 0, 10]);
  const { plans } = planBudgetFile({
    scope: 'opex', read: await readBudgetCsv(`${header}BL-3,-,-,-,__CLEAR__,-,-,-,-,-,-\n`, { language: 'en', dimensionCodes: ['nature'] }),
    catalog: cat, stored: [full], names: [], createSuppliers: false, canCreateSuppliers: false, currentYear: YEAR, labels: { budget: 'Budget' },
  });
  assert.deepEqual(plans[0].body, {
    cost_center_id: null, supplier_id: null, description: null, notes: null, run_build: null,
    owner_it_id: null, owner_business_id: null, project_id: null, disabled_at: null,
  });
  assert.deepEqual(plans[0].analytics, [{ code: 'nature', categoryId: null, createName: null }]);
  // The same file on a line that holds none of these values: nothing to clear, nothing counted.
  const empty = await preflight('opex', `${header}BL-3,-,-,-,-,-,-,-,-,-,-\n`, [line({ itemNumber: 3 })], options);
  assert.equal(empty.ok, true, JSON.stringify(empty.errors));
  assert.deepEqual([empty.changes.updated, empty.changes.unchanged, empty.changes.cleared], [0, 1, 0]);
  // A blank cell keeps every value.
  const kept = await preflight('opex', `${header}BL-3,,,,,,,,,,\n`, [full], options);
  assert.deepEqual([kept.ok, kept.changes.unchanged, kept.changes.cleared], [true, 1, 0]);
  // `'-` writes the text "-": a change, no value cleared.
  const dash = await preflight('opex', "item_number,description\nBL-3,'-\n", [full], options);
  assert.deepEqual([dash.ok, dash.changes.updated, dash.changes.cleared], [true, 1, 0]);
  const dashPlan = planBudgetFile({
    scope: 'opex', read: await readBudgetCsv("item_number,description\nBL-3,'-\n", { language: 'en', dimensionCodes: [] }),
    catalog: cat, stored: [full], names: [], createSuppliers: false, canCreateSuppliers: false, currentYear: YEAR, labels: { budget: 'Budget' },
  });
  assert.deepEqual(dashPlan.plans[0].body, { description: '-' });
  // A row that fails clears nothing, and a new line counts nothing.
  const failing = await preflight('opex', 'item_number,description,budget_2026\nBL-3,-,-\n', [full], options);
  assert.equal(failing.ok, false);
  assert.deepEqual(failing.errors.map((error) => error.code), ['BUDGET_FILE_AMOUNT_CANNOT_BE_CLEARED'], 'an amount is still refused');
  assert.equal(failing.changes.cleared, 0);
  const required = catalog({ dimensions: [{ ...dimension, required: true }] });
  const held = await preflight('opex', 'item_number,analytics:nature\nBL-3,-\n', [full], { cat: required, dimensions: ['nature'] });
  assert.deepEqual(held.errors.map((error) => error.code), ['BUDGET_FILE_DIMENSION_REQUIRED'], 'a dimension a line must hold is still refused');
  assert.equal(held.changes.cleared, 0);

  // `'-` typed in Excel: "-" in a cell whose style carries the apostrophe (`quotePrefix`) is the text "-";
  // a "-" typed alone clears.
  const parts = workbookParts({
    sharedStrings: [si('item_number'), si('description'), si('BL-3'), si('-')],
    cellXfs: [0, 0],
    sheetData: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s" s="1"><v>3</v></c></row>',
  });
  parts['xl/styles.xml'] = String(parts['xl/styles.xml']).replace(/(<cellXfs><xf [^>]*)\/>(<xf [^>]*)\/>/, '$1/>$2 quotePrefix="1"/>');
  const typed = await preflight('opex', zipOf(parts), [full], options);
  assert.deepEqual([typed.ok, typed.changes.updated, typed.changes.cleared], [true, 1, 0], JSON.stringify(typed.errors));
  const plain = zipOf(workbookParts({
    sharedStrings: [si('item_number'), si('description'), si('BL-3'), si('-')],
    sheetData: '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>'
      + '<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c></row>',
  }));
  const typedClear = await preflight('opex', plain, [full], options);
  assert.deepEqual([typedClear.ok, typedClear.changes.cleared], [true, 1], JSON.stringify(typedClear.errors));

  // An export of a line whose texts are "-" writes `'-`: read back as it is, it changes nothing.
  const dashes = line({ itemNumber: 3, versions: withJanuary(10000n), description: '-', notes: '-', name: '-' });
  const built = buildBudgetExport({ language: 'en', years: [YEAR], columns: ['budget'], detail: 'yearly', lines: [dashes], dimensions: [] });
  const csv = writeCsv({ language: 'en', headers: built.headers, rows: budgetCsvRows(built.rows, 'en') });
  assert.ok(csv.includes("'-"), 'the export guards a stored "-"');
  const back = await preflight('opex', csv, [dashes]);
  assert.deepEqual([back.ok, back.changes.unchanged, back.changes.updated, back.changes.cleared], [true, 1, 0, 0], JSON.stringify(back.errors));
  const workbook = writeXlsx({ language: 'en', sheets: [{ name: 'budget', headers: built.headers, rows: built.rows, header: 'styled' }] });
  const backXlsx = await preflight('opex', workbook, [dashes]);
  assert.deepEqual([backXlsx.ok, backXlsx.changes.unchanged, backXlsx.changes.cleared], [true, 1, 0], JSON.stringify(backXlsx.errors));
}

async function main() {
  await testTokenLanguages();
  await testDecimalMarkParameter();
  await testOldFiles();
  await testMissingHeader();
  await testRoundTrip();
  await testClearRule();
  await testAmounts();
  await testIdentity();
  await testSuppliersAndDuplicates();
  await testCreateRules();
  await testAccountNature();
  await testValueAppliesTo();
  await testRequiredDimension();
  await testRefusedNewDimensionValue();
  await testExportShape();
  await testPlan();
  await testNatureColumn();
  await testItemNumbers();
  await testMixedFileFromEitherList();
  await testDimensionsByNature();
  await testFreezeByNature();
  await testDuplicatesByNature();
  await testLookalikeRules();
  await testLeftOutLeavesNothing();
  await testLookalikeUpdate();
  await testChoicesForAllWithALineGone();
  await testManyLookalikes();
  await testLookalikeTargetKept();
  await testLookalikeCompanyAndEnd();
  await testConsistency();
  await testTrailingLineBreak();
  await testCapexDescription();
  await testCostCenterOfAnotherCompany();
  await testCalculationLinesCap();
  await testCalculationLinesSilentCases();
  console.log('budget-file.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
