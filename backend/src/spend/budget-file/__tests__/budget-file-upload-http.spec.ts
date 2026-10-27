import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Body, Controller, HttpCode, INestApplication, Module, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { FileInterceptor } from '@nestjs/platform-express';
import { ReleaseTenantRunnerFilter } from '../../../common/filters/release-tenant-runner.filter';
import { parseBudgetSnapshot } from '../import-file';
import {
  BUDGET_FILE_MAX_BYTES,
  BUDGET_FILE_SNAPSHOT_MAX_BYTES,
  BUDGET_FILE_TOO_LARGE,
  BudgetFileSizeInterceptor,
  budgetFileMulterOptions,
} from '../upload';

// The budget file's multipart body, through the interceptors of the preflight and load routes
// (spend-items and capex-items controllers). The load sends the preflight's snapshot back as a
// text field: one entry per existing line of the file. Multer's default field size (1 MB) refused
// a load of a few thousand lines with 400 "Field value too long - snapshot".

@Controller('probe')
class BudgetFileProbeController {
  @Post('preflight')
  @HttpCode(200)
  @UseInterceptors(BudgetFileSizeInterceptor, FileInterceptor('file', budgetFileMulterOptions))
  preflight(@UploadedFile() file: Express.Multer.File) {
    return { size: file?.size ?? null };
  }

  @Post('import')
  @HttpCode(200)
  @UseInterceptors(BudgetFileSizeInterceptor, FileInterceptor('file', budgetFileMulterOptions))
  load(@UploadedFile() file: Express.Multer.File, @Body('snapshot') snapshot: string) {
    return { size: file?.size ?? null, lines: parseBudgetSnapshot(snapshot).lines.length };
  }
}

@Module({ controllers: [BudgetFileProbeController] })
class BudgetFileProbeModule {}

async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(BudgetFileProbeModule, { logger: false });
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new ReleaseTenantRunnerFilter(httpAdapter));
  await app.listen(0, '127.0.0.1');
  return app;
}

const uuid = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

/** A snapshot as the preflight writes it, with realistic widths: 5-digit numbers, 2-digit revisions. */
function snapshotOf(lines: number, years: number): string {
  return JSON.stringify({
    lines: Array.from({ length: lines }, (_, i) => ({
      id: uuid(i),
      itemNumber: 10_000 + i,
      rowVersion: 12,
      years: Array.from({ length: years }, (__, y) => ({ year: 2020 + y, versionId: uuid(1_000_000 + i * 100 + y), budgetRev: 12 })),
    })),
  });
}

const csv = (bytes = 64) => new Blob(['item_number;name\n'.padEnd(bytes, ' ')], { type: 'text/csv' });

function form(file: Blob, fields: Array<[string, string]> = []): FormData {
  const body = new FormData();
  body.append('file', file, 'budget.csv');
  for (const [name, value] of fields) body.append(name, value);
  return body;
}

async function post(app: INestApplication, path: string, body: FormData) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/probe/${path}`, { method: 'POST', body });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

/** The budget file takes CSV and .xlsx (its content decides, an .xls included); other files meet the CSV import's sentences. */
function testFileFilter() {
  const answer = (originalname: string, mimetype: string) => {
    let result: { error: any; accepted: boolean } | null = null;
    budgetFileMulterOptions.fileFilter!({} as any, { originalname, mimetype } as any, (error: any, accepted?: boolean) => {
      result = { error, accepted: accepted === true };
    });
    return result!;
  };
  for (const [name, mimetype] of [
    ['budget.csv', 'text/csv'],
    ['budget.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['BUDGET.XLSX', 'application/octet-stream'],
    ['budget', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
    ['budget.xls', 'application/vnd.ms-excel'],
  ]) {
    assert.equal(answer(name, mimetype).accepted, true, name);
  }
  for (const [name, mimetype, code] of [
    ['budget.ods', 'application/vnd.oasis.opendocument.spreadsheet', 'CSV_FILE_OPENDOCUMENT'],
    ['budget.xlsm', 'application/vnd.ms-excel.sheet.macroEnabled.12', 'CSV_FILE_EXCEL'],
    ['budget.pdf', 'application/pdf', 'CSV_FILE_NOT_TEXT'],
  ]) {
    const { error, accepted } = answer(name, mimetype);
    assert.equal(accepted, false, name);
    assert.equal(error.getStatus(), 400, name);
    assert.equal(error.getResponse().code, code, name);
  }
}

function testSizing() {
  // The cap holds the 20,000 lines the manual announces, each with 14 budget years.
  const widest = Buffer.byteLength(snapshotOf(20_000, 14), 'utf8');
  assert.ok(widest <= BUDGET_FILE_SNAPSHOT_MAX_BYTES, `20,000 lines of 14 years: ${widest} bytes`);
}

async function testHttp(app: INestApplication) {
  // 20,000 existing lines of 3 years: about 6.5 MB, six times the old limit.
  const snapshot = snapshotOf(20_000, 3);
  assert.ok(Buffer.byteLength(snapshot, 'utf8') > 4 * 1024 * 1024, 'the snapshot is well above the old 1 MB');
  const loaded = await post(app, 'import', form(csv(), [['snapshot', snapshot]]));
  assert.equal(loaded.status, 200, JSON.stringify(loaded.body).slice(0, 300));
  assert.equal(loaded.body.lines, 20_000);

  // Above the snapshot cap: 413 in plain language, as for a file too large.
  const overSnapshot = await post(app, 'import', form(csv(), [['snapshot', 'x'.repeat(BUDGET_FILE_SNAPSHOT_MAX_BYTES + 1)]]));
  assert.equal(overSnapshot.status, 413, JSON.stringify(overSnapshot.body).slice(0, 300));
  assert.equal(overSnapshot.body.message, BUDGET_FILE_TOO_LARGE);

  // A file above its cap: the same 413 on both routes.
  for (const path of ['preflight', 'import']) {
    const overFile = await post(app, path, form(csv(BUDGET_FILE_MAX_BYTES + 1), path === 'import' ? [['snapshot', '{"lines":[]}']] : []));
    assert.equal(overFile.status, 413, `${path}: ${JSON.stringify(overFile.body).slice(0, 300)}`);
    assert.equal(overFile.body.message, BUDGET_FILE_TOO_LARGE, path);
  }

  // The large field size applies to the snapshot only: a second text field is refused.
  const twoFields = await post(app, 'import', form(csv(), [['snapshot', '{"lines":[]}'], ['other', 'x']]));
  assert.equal(twoFields.status, 400, JSON.stringify(twoFields.body));
  assert.match(String(twoFields.body?.message), /Too many (fields|parts)/);

  // The preflight sends the file alone.
  const preflight = await post(app, 'preflight', form(csv()));
  assert.equal(preflight.status, 200, JSON.stringify(preflight.body));
}

async function run() {
  testFileFilter();
  testSizing();
  const app = await createApp();
  try {
    await testHttp(app);
  } finally {
    await app.close();
  }
  console.log('budget-file-upload-http.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
