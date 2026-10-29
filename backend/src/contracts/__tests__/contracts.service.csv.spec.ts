/**
 * Contracts CSV export/template/import consistency tests.
 *
 * Regression coverage for:
 *  - template download producing an EMPTY file (no header row)
 *  - import accepting files with wrong headers (no validation)
 *  - export hardcoding owner_email to '' (owner lost on round-trip)
 *  - unresolved company/supplier/owner silently skipped instead of reported
 *
 * The file follows the screen's language (`common/csv-sheet`): `,`, ISO dates and a decimal dot in
 * English (the default), `;`, local dates and a decimal comma in French. The import reads either.
 */
import * as assert from 'node:assert/strict';
import { ContractsService } from '../contracts.service';

const TENANT = 't1';

const companies = [{ id: 'c1', name: 'Fromage Co', tenant_id: TENANT }];
const suppliers = [{ id: 's1', name: 'Dell', tenant_id: TENANT }];
const users = [{ id: 'u1', email: 'alice@fromage.co', tenant_id: TENANT }];
const contracts = [
  {
    id: 'k1',
    name: 'ESX Support',
    company_id: 'c1',
    supplier_id: 's1',
    owner_user_id: 'u1',
    start_date: '2024-01-15',
    duration_months: 36,
    auto_renewal: true,
    notice_period_months: 3,
    yearly_amount_at_signature: 12000,
    currency: 'EUR',
    billing_frequency: 'annual',
    status: 'enabled',
    notes: 'notes; with delimiter',
  },
];

function createMockManager() {
  return {
    query: async (sql: string) => {
      if (/FROM suppliers/i.test(sql)) return suppliers;
      if (/FROM companies/i.test(sql)) return companies;
      if (/FROM users/i.test(sql)) return users;
      return [];
    },
    getRepository: () => ({
      find: async () => contracts,
      findOne: async ({ where }: any) =>
        contracts.find((c) => c.name === where.name && c.supplier_id === where.supplier_id) ?? null,
    }),
  } as any;
}

function createService(): ContractsService {
  // exportCsv/importCsv(dry-run) only touch the manager passed via opts
  return new (ContractsService as any)(
    null, null, null, null, null, null, null, null, null,
  );
}

const HEADER =
  'name;company_name;supplier_name;cost_center;start_date;duration_months;auto_renewal;notice_period_months;yearly_amount_at_signature;currency;billing_frequency;status;owner_email;notes';

async function testTemplateContainsHeaderRow() {
  const svc = createService();
  const french = await svc.exportCsv('template', { manager: createMockManager(), language: 'fr' });
  assert.equal(french.content.replace(/^﻿/, '').trim(), HEADER, 'template must contain exactly the header row');
  const english = await svc.exportCsv('template', { manager: createMockManager() });
  assert.equal(english.content.replace(/^﻿/, '').trim(), HEADER.replace(/;/g, ','), 'an English template uses commas');
}

async function testExportEmitsOwnerEmailAndIsoDate() {
  const svc = createService();
  const result = await svc.exportCsv('data', { manager: createMockManager() });
  const lines = result.content.replace(/^﻿/, '').trim().split('\n');
  assert.equal(lines[0], HEADER.replace(/;/g, ','));
  assert.ok(lines[1].includes('alice@fromage.co'), 'export must emit the owner email');
  assert.ok(lines[1].includes(',2024-01-15,'), 'an English export emits an ISO start_date');
  assert.ok(lines[1].includes('"notes; with delimiter"') === false, 'a semicolon needs no quotes in a comma file');
  const french = (await svc.exportCsv('data', { manager: createMockManager(), language: 'fr' })).content.replace(/^﻿/, '').trim().split('\n');
  assert.equal(french[0], HEADER);
  assert.ok(french[1].includes(';15/01/2024;'), 'a French export emits a local start_date');
  assert.ok(french[1].endsWith(';"notes; with delimiter"'), 'a cell holding the separator is quoted');
}

async function testExportRoundTripsThroughImport() {
  const svc = createService();
  const exported = await svc.exportCsv('data', { manager: createMockManager() });
  const result = await svc.importCsv(
    { file: { buffer: Buffer.from(exported.content, 'utf8') } as any, dryRun: true },
    { manager: createMockManager() },
  );
  assert.equal(result.ok, true, `round-trip import failed: ${JSON.stringify(result.errors)}`);
  assert.equal(result.errors.length, 0);
  assert.equal(result.inserted, 0, 'exported row must match the existing contract');
  assert.equal(result.updated, 0, 'an exported row re-imported as is changes nothing');
  assert.equal((result as any).unchanged, 1);
}

async function testImportRejectsWrongHeaders() {
  const svc = createService();
  const csv = 'name;bogus_column\nESX Support;whatever\n';
  const result = await svc.importCsv(
    { file: { buffer: Buffer.from('﻿' + csv, 'utf8') } as any, dryRun: true },
    { manager: createMockManager() },
  );
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e: any) => /Header mismatch/.test(e.message)),
    'import must report a header mismatch');
}

async function testImportReportsUnresolvedReferences() {
  const svc = createService();
  const row = 'New Deal;Ghost Corp;Ghost Supplier;;2024-01-01;12;no;1;0;EUR;annual;enabled;ghost@nowhere.io;';
  const csv = `${HEADER}\n${row}\n`;
  const result = await svc.importCsv(
    { file: { buffer: Buffer.from('﻿' + csv, 'utf8') } as any, dryRun: true },
    { manager: createMockManager() },
  );
  assert.equal(result.ok, false);
  const messages = result.errors.map((e: any) => e.message).join(' | ');
  assert.ok(/company 'Ghost Corp' not found/.test(messages), messages);
  assert.ok(/supplier 'Ghost Supplier' not found/.test(messages), messages);
  assert.ok(/user 'ghost@nowhere.io' not found/.test(messages), messages);
}

// A yes/no cell that is neither: the shared coded error, worded by the interface, on its column.
async function testImportCodesAnInvalidYesNo() {
  const svc = createService();
  const row = 'New Deal;Fromage Co;Dell;;2024-01-01;12;maybe;1;0;EUR;annual;enabled;;';
  const result = await svc.importCsv(
    { file: { buffer: Buffer.from(`${HEADER}\n${row}\n`, 'utf8') } as any, dryRun: true },
    { manager: createMockManager() },
  );
  assert.equal(result.ok, false);
  const error: any = result.errors.find((e: any) => e.row === 2);
  assert.ok(error, JSON.stringify(result.errors));
  assert.equal(error.code, 'CSV_BOOLEAN_INVALID', JSON.stringify(error));
  assert.equal(error.column, 'auto_renewal');
  assert.deepEqual(error.params, { value: 'maybe' });
}

// Every row problem carries a shared code on its column, so the dialog words it in the interface language.
async function testImportCodesEveryRowProblem() {
  const svc = createService();
  const rows = [
    ';Ghost Corp;;;2024-01-01;12;no;1;0;EURO;weekly;enabled;ghost@nowhere.io;',
    'Deal;;Ghost Supplier;;;12;no;1;0;EUR;annual;enabled;;',
    'Deal 3;Fromage Co;Dell;;not a date;12;no;1;0;EUR;annual;enabled;;',
  ];
  const result = await svc.importCsv(
    { file: { buffer: Buffer.from(`${HEADER}\n${rows.join('\n')}\n`, 'utf8') } as any, dryRun: true },
    { manager: createMockManager() },
  );
  assert.equal(result.ok, false);
  const uncoded = result.errors.filter((e: any) => !e.code || !e.column);
  assert.deepEqual(uncoded, [], JSON.stringify(uncoded));
  const byColumn = (row: number) => Object.fromEntries(
    result.errors.filter((e: any) => e.row === row).map((e: any) => [e.column, { code: e.code, params: e.params ?? {} }]),
  );
  assert.deepEqual(byColumn(2), {
    name: { code: 'CSV_VALUE_REQUIRED', params: {} },
    company_name: { code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Ghost Corp' } },
    supplier_name: { code: 'CSV_VALUE_REQUIRED', params: {} },
    owner_email: { code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'ghost@nowhere.io' } },
    currency: { code: 'CSV_CURRENCY_INVALID', params: { value: 'EURO' } },
    billing_frequency: { code: 'CSV_ENUM_INVALID', params: { value: 'weekly', allowed: 'monthly, quarterly, annual, other' } },
  });
  assert.deepEqual(byColumn(3), {
    company_name: { code: 'CSV_VALUE_REQUIRED', params: {} },
    supplier_name: { code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Ghost Supplier' } },
    start_date: { code: 'CSV_VALUE_REQUIRED', params: {} },
  });
  assert.deepEqual(byColumn(4), { start_date: { code: 'CSV_DATE_INVALID', params: { value: 'not a date' } } });
}

function errorsByColumn(result: { errors: Array<{ row?: number; column?: string; code?: string; params?: Record<string, unknown> }> }, row: number) {
  return Object.fromEntries(
    result.errors.filter((error) => error.row === row).map((error) => [error.column, { code: error.code, params: error.params ?? {} }]),
  );
}

// A bad yes/no, amount or month count does not hide the other errors of the same row.
// Dry run and load report the same list, and a valid row in the file is not given an error.
async function testImportReportsEveryErrorOfARow() {
  const svc = createService();
  const rows = [
    'New Deal;Ghost Corp;Ghost Supplier;;2024-01-01;12;maybe;1;0;EUR;annual;enabled;;',
    'Kept Deal;Fromage Co;Dell;;2024-01-15;36;yes;3;12000;EUR;annual;enabled;alice@fromage.co;',
    'Short;Ghost Corp;Dell;;2024-01-01;soon;no;later;nope;EUR;annual;enabled;;',
  ];
  for (const dryRun of [true, false]) {
    const result = await svc.importCsv(
      { file: { buffer: Buffer.from(`${HEADER}\n${rows.join('\n')}\n`, 'utf8') } as any, dryRun },
      { manager: createMockManager() },
    );
    assert.equal(result.ok, false, JSON.stringify(result.errors));
    assert.deepEqual(errorsByColumn(result, 2), {
      auto_renewal: { code: 'CSV_BOOLEAN_INVALID', params: { value: 'maybe' } },
      company_name: { code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Ghost Corp' } },
      supplier_name: { code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Ghost Supplier' } },
    }, dryRun ? 'dry run' : 'load');
    assert.deepEqual(errorsByColumn(result, 3), {}, 'a valid row stays clean');
    assert.deepEqual(errorsByColumn(result, 4), {
      duration_months: { code: 'CSV_NUMBER_INVALID', params: { value: 'soon' } },
      notice_period_months: { code: 'CSV_NUMBER_INVALID', params: { value: 'later' } },
      yearly_amount_at_signature: { code: 'CSV_NUMBER_INVALID', params: { value: 'nope' } },
      company_name: { code: 'CSV_REFERENCE_NOT_FOUND', params: { value: 'Ghost Corp' } },
    });
    assert.equal(result.inserted, 0);
    assert.equal(result.updated, 0);
  }
}

// Text that is not a whole number of months is a row error. Blank keeps the column default, and 0 is a number.
async function testInvalidMonthCountsAreRowErrors() {
  const svc = createService();
  for (const value of ['soon', '12.5', '12abc', '-1', '2147483648']) {
    const row = `New Deal;Fromage Co;Dell;;2024-01-01;${value};no;1;0;EUR;annual;enabled;;`;
    const result = await svc.importCsv(
      { file: { buffer: Buffer.from(`${HEADER}\n${row}\n`, 'utf8') } as any, dryRun: true },
      { manager: createMockManager() },
    );
    assert.equal(result.ok, false, value);
    assert.deepEqual(errorsByColumn(result, 2), {
      duration_months: { code: 'CSV_NUMBER_INVALID', params: { value } },
    }, JSON.stringify(result.errors));
  }
  for (const row of [
    'Fresh;Fromage Co;Dell;;2024-01-01;;no;;0;EUR;annual;enabled;;',
    'Zero;Fromage Co;Dell;;2024-01-01;0;no;0;0;EUR;annual;enabled;;',
  ]) {
    const result = await svc.importCsv(
      { file: { buffer: Buffer.from(`${HEADER}\n${row}\n`, 'utf8') } as any, dryRun: true },
      { manager: createMockManager() },
    );
    assert.equal(result.ok, true, `${row}: ${JSON.stringify(result.errors)}`);
    assert.equal(result.inserted, 1, row);
  }
}

async function testImportReadsWindows1252() {
  const svc = createService();
  // Excel "CSV (semicolon)" on Windows writes Windows-1252: latin1 matches it for "é".
  const row = 'Refonte CRM é;Société Test;Dell;;2024-01-01;12;no;1;0;EUR;annual;enabled;alice@fromage.co;';
  const result = await svc.importCsv(
    { file: { buffer: Buffer.from(`${HEADER}\r\n${row}\r\n`, 'latin1') } as any, dryRun: true },
    { manager: createMockManager() },
  );
  const messages = result.errors.map((e: any) => e.message).join(' | ');
  assert.ok(/company 'Société Test' not found/.test(messages), messages);
}

async function testImportRefusesUtf16WithBadRequest() {
  const svc = createService();
  const buffer = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(`${HEADER}\r\n`, 'utf16le')]);
  await assert.rejects(
    svc.importCsv({ file: { buffer } as any, dryRun: true }, { manager: createMockManager() }),
    (err: any) => err?.getStatus?.() === 400 && /not UTF-8 or Windows-1252/.test(err.message),
  );
}

(async () => {
  await testTemplateContainsHeaderRow();
  await testExportEmitsOwnerEmailAndIsoDate();
  await testExportRoundTripsThroughImport();
  await testImportRejectsWrongHeaders();
  await testImportReportsUnresolvedReferences();
  await testImportCodesAnInvalidYesNo();
  await testImportCodesEveryRowProblem();
  await testImportReportsEveryErrorOfARow();
  await testInvalidMonthCountsAreRowErrors();
  await testImportReadsWindows1252();
  await testImportRefusesUtf16WithBadRequest();

  console.log('Contracts CSV tests passed.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
