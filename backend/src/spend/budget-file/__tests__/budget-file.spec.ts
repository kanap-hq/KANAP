import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { parseDecimalMark } from '../../../common/csv-sheet';
import { writeCsv } from '../../../common/csv-sheet';
import { budgetCsvRows, buildBudgetExport, exportListQuery, parseAmountYears, parseFileColumns } from '../export-file';
import { parseItemNumber, readBudgetCsv } from '../interpret';
import { periodForYearlyTotal } from '../period';
import { buildPreflight, planBudgetFile } from '../preflight';
import { budgetFileSchema, CRITERIA_COLUMNS_MESSAGE, MISSING_BUDGET_HEADER_MESSAGE, OLD_BUDGET_FILE_MESSAGE } from '../columns';
import { writeXlsx } from '../../../common/xlsx';
import { natureChangeMessage } from '../preflight';
import type { BudgetNature } from '../../budget-nature';
import { formatToken, parseToken, tokenError } from '../token';
import { BUDGET_FILE_MAX_BYTES } from '../upload';
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
      .map((item) => ({ nature: item.nature, itemNumber: item.itemNumber, name: item.name, supplierId: item.supplierId })),
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

  const hint = await preflight('opex', 'item_number,name,currency\n,Widget,EUR\n', [line()]);
  assert.ok(hint.warnings.duplicates.some((warning) => warning.message === 'row 2 looks like BL-3'));
}

async function testCreateRules() {
  const cat = catalog({
    companies: [{ id: 'c1', name: 'Acme', coaId: 'chart', disabledAt: null }],
    accounts: [{ id: 'a1', number: '1200', coaId: 'chart', disabledAt: null }],
  });
  const missing = await preflight('opex', 'item_number,name,company_name,account_number,currency\n,Widget,Other,1200,EUR\n', [], { cat });
  assert.ok(missing.missing.some((item) => item.message.startsWith('Missing: 1 company (Other): Master data > Companies')));
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
  const mixed = await planOf('opex', `${header}opex,,Widget,Acme,6100,EUR\ncapex,,Server,Acme,2100,EUR\nCAPEX,BL-120,Racks v2,,,\n,BL-3,Widget Pro,,,\n`, stored, {
    cat,
  });
  assert.equal(mixed.report.ok, true, JSON.stringify(mixed.report.errors));
  assert.deepEqual(mixed.plans.map((plan) => [plan.line, plan.nature, plan.creating]), [
    [2, 'opex', true], [3, 'capex', true], [4, 'capex', false], [5, 'opex', false],
  ], 'each line written with its own nature; a blank cell keeps the line\'s');
  assert.equal(mixed.plans[2].body.product_name, 'Racks v2', 'the title of a CAPEX line is its product_name');

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
    'opex,,Widget,Acme,6100,EUR,Fromage,High,',
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

/** The duplicate hint compares a new line with the lines of its own nature (OPEX by name and supplier, CAPEX by name). */
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
  assert.deepEqual(report.warnings.duplicates, [
    { line: 4, message: 'row 4 looks like BL-120' },
    { line: 7, message: 'row 7 looks like row 6' },
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

async function main() {
  await testTokenLanguages();
  await testDecimalMarkParameter();
  await testOldFiles();
  await testMissingHeader();
  await testRoundTrip();
  await testAmounts();
  await testIdentity();
  await testSuppliersAndDuplicates();
  await testCreateRules();
  await testAccountNature();
  await testValueAppliesTo();
  await testRequiredDimension();
  await testExportShape();
  await testPlan();
  await testNatureColumn();
  await testItemNumbers();
  await testMixedFileFromEitherList();
  await testDimensionsByNature();
  await testFreezeByNature();
  await testDuplicatesByNature();
  await testTrailingLineBreak();
  await testCapexDescription();
  await testCostCenterOfAnotherCompany();
  await testCalculationLinesCap();
  console.log('budget-file.spec: ok');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
