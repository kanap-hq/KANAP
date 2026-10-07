import 'reflect-metadata';
import * as assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Body, Controller, INestApplication, Module, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import { HttpAdapterHost, NestFactory } from '@nestjs/core';
import { FileInterceptor } from '@nestjs/platform-express';
import { MulterError } from 'multer';
import { ReleaseTenantRunnerFilter } from '../filters/release-tenant-runner.filter';
import { mapMultipartError } from '../filters/multipart-error.mapping';
import {
  ATTACHMENT_MAX_BYTES,
  attachmentMulterOptions,
  CSV_IMPORT_MAX_BYTES,
  csvImportMulterOptions,
  documentImportMulterOptions,
  inlineImageMulterOptions,
  MULTIPART_LIMITS,
} from '../upload';
import { BUDGET_FILE_MAX_BYTES, budgetFileMulterOptions } from '../../spend/budget-file/upload';

// Every multipart upload is bounded: one file, a few text fields with short,
// flat names, besides the file size. A refused upload answers 4xx (400 with a
// message, or 413 for the file size), never 500, through the global filter
// main.ts installs.

function testOptionObjects() {
  const expected: Array<[string, any, number]> = [
    ['attachment', attachmentMulterOptions, ATTACHMENT_MAX_BYTES],
    ['inline image', inlineImageMulterOptions, ATTACHMENT_MAX_BYTES],
    ['document import', documentImportMulterOptions, ATTACHMENT_MAX_BYTES],
    ['CSV import', csvImportMulterOptions, CSV_IMPORT_MAX_BYTES],
    ['budget file', budgetFileMulterOptions, BUDGET_FILE_MAX_BYTES],
  ];
  for (const [label, options, fileSize] of expected) {
    assert.deepEqual(options.limits, { ...MULTIPART_LIMITS, fileSize }, `${label}: complete limits`);
    assert.equal(typeof options.fileFilter, 'function', `${label}: keeps its file filter`);
  }
  assert.equal(MULTIPART_LIMITS.files, 1);
  assert.ok(MULTIPART_LIMITS.fields >= 2, 'room for the one text field the app sends');
  assert.equal(MULTIPART_LIMITS.parts, MULTIPART_LIMITS.files + MULTIPART_LIMITS.fields);
  assert.equal((MULTIPART_LIMITS as any).fieldSize, undefined, 'the field size keeps the multer default');
}

function testMapping() {
  for (const code of ['LIMIT_FIELD_ARRAY_INDEX', 'INVALID_FIELD_NAME', 'STREAM_DESTROYED']) {
    const mapped = mapMultipartError(new MulterError(code as any, 'items[3]'));
    assert.ok(mapped, `${code} is mapped`);
    assert.equal(mapped!.getStatus(), 400);
  }
  assert.equal(mapMultipartError(new Error('other')), null);
  assert.equal(mapMultipartError(null), null);
}

@Controller('probe')
class UploadProbeController {
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', attachmentMulterOptions))
  upload(@UploadedFile() file: Express.Multer.File | undefined, @Body() body: Record<string, unknown>) {
    return { size: file?.size ?? null, fields: { ...body } };
  }

  // Multer without limits: only its own name checks apply.
  @Post('bare')
  @UseInterceptors(FileInterceptor('file'))
  bare(@UploadedFile() file: Express.Multer.File | undefined) {
    return { size: file?.size ?? null };
  }

  // A refusal multer raises from its storage (disk storage only, unreachable with
  // the memory storage the API uses): checked through the same filter.
  @Post('stream-destroyed')
  streamDestroyed() {
    throw new MulterError('STREAM_DESTROYED' as any);
  }
}

@Module({ controllers: [UploadProbeController] })
class UploadProbeModule {}

async function createApp(): Promise<INestApplication> {
  const app = await NestFactory.create(UploadProbeModule, { logger: false });
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new ReleaseTenantRunnerFilter(httpAdapter));
  await app.listen(0, '127.0.0.1');
  return app;
}

function form(parts: Array<[string, string] | [string, Blob, string]>): FormData {
  const body = new FormData();
  for (const part of parts) {
    if (part.length === 3) body.append(part[0], part[1], part[2]);
    else body.append(part[0], part[1]);
  }
  return body;
}

const textFile = () => new Blob(['hello'], { type: 'text/plain' });

async function post(app: INestApplication, path: string, body?: FormData) {
  const { port } = app.getHttpServer().address() as AddressInfo;
  const res = await fetch(`http://127.0.0.1:${port}/probe/${path}`, { method: 'POST', body });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, body: json };
}

async function testHttp(app: INestApplication) {
  // An ordinary upload: one file and one text field.
  const ok = await post(app, 'upload', form([['file', textFile(), 'note.txt'], ['kind', 'reference']]));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.deepEqual(ok.body, { size: 5, fields: { kind: 'reference' } });

  const refusals: Array<[string, FormData, RegExp]> = [
    ['two files', form([['file', textFile(), 'a.txt'], ['file', textFile(), 'b.txt']]), /Too many files|Unexpected file field/],
    ['too many fields', form([
      ['file', textFile(), 'a.txt'],
      ...Array.from({ length: MULTIPART_LIMITS.fields + 1 }, (_, i) => [`field${i}`, 'x'] as [string, string]),
    ]), /Too many (fields|parts)/],
    ['field name too long', form([['file', textFile(), 'a.txt'], ['n'.repeat(MULTIPART_LIMITS.fieldNameSize + 1), 'x']]), /Field name too long/],
    ['nested field name', form([['file', textFile(), 'a.txt'], ['a[b][c][d]', 'x']]), /nesting too deep/],
    ['array index too large', form([['file', textFile(), 'a.txt'], [`items[${MULTIPART_LIMITS.fieldArrayIndexLimit + 1}]`, 'x']]), /array index too large/],
  ];
  for (const [label, body, message] of refusals) {
    const res = await post(app, 'upload', body);
    assert.equal(res.status, 400, `${label}: HTTP ${res.status} ${JSON.stringify(res.body)}`);
    assert.match(String(res.body?.message), message, label);
  }

  // A field name multer cannot store answers 400 (it answered 500 before).
  const invalid = await post(app, 'bare', form([['a[4294967294]', 'x'], ['a[]', 'y']]));
  assert.equal(invalid.status, 400, `invalid field name: HTTP ${invalid.status} ${JSON.stringify(invalid.body)}`);
  assert.match(String(invalid.body?.message), /Invalid field name/);

  // A file stream destroyed under multer answers 400.
  const destroyed = await post(app, 'stream-destroyed');
  assert.equal(destroyed.status, 400);
  assert.match(String(destroyed.body?.message), /interrupted/);
}

async function run() {
  testOptionObjects();
  testMapping();
  const app = await createApp();
  try {
    await testHttp(app);
  } finally {
    await app.close();
  }
  console.log('multipart-limits-http.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
