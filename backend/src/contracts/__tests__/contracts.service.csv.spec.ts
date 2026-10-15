/**
 * Contracts CSV export/template/import consistency tests.
 *
 * Regression coverage for:
 *  - template download producing an EMPTY file (no header row)
 *  - import accepting files with wrong headers (no validation)
 *  - export hardcoding owner_email to '' (owner lost on round-trip)
 *  - unresolved company/supplier/owner silently skipped instead of reported
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
  'name;company_name;supplier_name;start_date;duration_months;auto_renewal;notice_period_months;yearly_amount_at_signature;currency;billing_frequency;status;owner_email;notes';

async function testTemplateContainsHeaderRow() {
  const svc = createService();
  const result = await svc.exportCsv('template', { manager: createMockManager() });
  const content = result.content.replace(/^﻿/, '');
  assert.equal(content.trim(), HEADER, 'template must contain exactly the header row');
}

async function testExportEmitsOwnerEmailAndIsoDate() {
  const svc = createService();
  const result = await svc.exportCsv('data', { manager: createMockManager() });
  const content = result.content.replace(/^﻿/, '');
  const lines = content.trim().split('\n');
  assert.equal(lines[0], HEADER);
  assert.ok(lines[1].includes('alice@fromage.co'), 'export must emit the owner email');
  assert.ok(lines[1].includes('2024-01-15'), 'export must emit ISO start_date');
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
  assert.equal(result.updated, 1, 'exported row must match the existing contract');
  assert.equal(result.inserted, 0);
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
  const row = 'New Deal;Ghost Corp;Ghost Supplier;2024-01-01;12;no;1;0;EUR;annual;enabled;ghost@nowhere.io;';
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

async function testImportReadsWindows1252() {
  const svc = createService();
  // Excel "CSV (semicolon)" on Windows writes Windows-1252: latin1 matches it for "é".
  const row = 'Refonte CRM é;Société Test;Dell;2024-01-01;12;no;1;0;EUR;annual;enabled;alice@fromage.co;';
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
  await testImportReadsWindows1252();
  await testImportRefusesUtf16WithBadRequest();

  console.log('Contracts CSV tests passed.');
})().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
