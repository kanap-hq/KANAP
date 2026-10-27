import * as assert from 'node:assert/strict';
import { PortfolioWeeklyReportController } from '../portfolio-weekly-report.controller';

/**
 * The `format` of the weekly report export: the shared reader of every export (`parseExportFormat`),
 * so an empty value is CSV, `XLSX` in any case is the workbook, and anything else is a 400 with the
 * same sentence as the other exports. The service is a stub: this spec only proves which file the
 * controller asks for.
 */

const QUERY = { startDate: '2026-08-01', endDate: '2026-08-31', language: 'en' };
const CTX = { tenantId: '00000000-0000-0000-0000-000000000001', userId: null, manager: {} } as any;
const REQ = {} as any;

function fakeResponse() {
  const headers: Record<string, string> = {};
  let body: unknown = null;
  return {
    headers,
    body: () => body,
    res: {
      setHeader: (name: string, value: string) => { headers[name] = value; },
      send: (value: unknown) => { body = value; },
    } as any,
  };
}

function stubService() {
  const calls: string[] = [];
  const svc = {
    exportCsv: async () => {
      calls.push('csv');
      return { filename: 'weekly-report.csv', content: 'Event,Reference\nCreated,REQ-1\n' };
    },
    exportXlsx: async () => {
      calls.push('xlsx');
      return { filename: 'weekly-report.xlsx', content: Buffer.from('xlsx') };
    },
  };
  return { svc: svc as any, calls };
}

async function testFormats() {
  for (const [label, query, expected, contentType] of [
    ['absent', QUERY, 'csv', 'text/csv; charset=utf-8'],
    ['empty', { ...QUERY, format: '' }, 'csv', 'text/csv; charset=utf-8'],
    ['csv in capitals', { ...QUERY, format: 'CSV' }, 'csv', 'text/csv; charset=utf-8'],
    ['xlsx', { ...QUERY, format: 'xlsx' }, 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['xlsx in capitals and spaces', { ...QUERY, format: ' XLSX ' }, 'xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ] as Array<[string, Record<string, unknown>, string, string]>) {
    const { svc, calls } = stubService();
    const out = fakeResponse();
    await new PortfolioWeeklyReportController(svc).export(query as any, CTX, REQ, out.res);
    assert.deepEqual(calls, [expected], label);
    assert.equal(out.headers['Content-Type'], contentType, label);
    assert.match(out.headers['Content-Disposition'], expected === 'csv' ? /\.csv"/ : /\.xlsx"/, label);
    assert.ok(out.body() !== null, label);
  }
}

async function testRefused() {
  for (const format of ['ods', 'pdf', 'xls', 'csvx']) {
    const { svc, calls } = stubService();
    const out = fakeResponse();
    await assert.rejects(
      () => new PortfolioWeeklyReportController(svc).export({ ...QUERY, format }, CTX, REQ, out.res),
      (error: any) => error.getStatus?.() === 400 && error.message === 'format must be csv or xlsx.',
      format,
    );
    assert.deepEqual(calls, [], `${format}: no file built`);
    assert.deepEqual(out.headers, {}, `${format}: no header written`);
  }
}

async function run() {
  await testFormats();
  await testRefused();
  console.log('portfolio-weekly-report-export-format.spec: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
