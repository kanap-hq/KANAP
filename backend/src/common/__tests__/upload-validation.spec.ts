import * as assert from 'node:assert/strict';
import { BadRequestException } from '@nestjs/common';
import { writeXlsx } from '../xlsx';
import { isUploadTypeAllowedForScope, validateUploadedFile } from '../upload-validation';

function run() {
  assert.equal(isUploadTypeAllowedForScope(
    { originalname: 'import.csv', mimetype: 'text/csv' },
    { scope: 'csv-import' },
  ), true);
  assert.equal(isUploadTypeAllowedForScope(
    { originalname: 'payload.exe', mimetype: 'application/octet-stream' },
    { scope: 'csv-import' },
  ), false);

  assert.throws(
    () => validateUploadedFile({
      originalName: 'unsafe.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from('<svg><script>alert(1)</script></svg>'),
    }),
    (error: unknown) => error instanceof BadRequestException,
  );

  // A Plaid attachment: an image or a spreadsheet, nothing else.
  for (const [originalname, mimetype, allowed] of [
    ['shot.png', 'image/png', true],
    ['apps.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', true],
    ['apps.csv', 'text/csv', true],
    ['apps.xls', 'application/vnd.ms-excel', false],
    ['notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', false],
    ['run.exe', 'application/octet-stream', false],
  ] as const) {
    assert.equal(isUploadTypeAllowedForScope({ originalname, mimetype }, { scope: 'ai-attachment' }), allowed, originalname);
  }
  const workbook = writeXlsx({ language: 'en', sheets: [{ name: 'S', headers: ['Name'], rows: [['CRM']] }] });
  assert.equal(
    validateUploadedFile({ originalName: 'apps.xlsx', mimeType: 'application/octet-stream', buffer: workbook }, { scope: 'ai-attachment' }).mimeType,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  assert.equal(
    validateUploadedFile({ originalName: 'apps.csv', mimeType: 'text/csv', buffer: Buffer.from('Name\nCRM\n') }, { scope: 'ai-attachment' }).mimeType,
    'text/csv',
  );
  // A workbook renamed .csv is refused: its content does not match its name.
  assert.throws(
    () => validateUploadedFile({ originalName: 'apps.csv', mimeType: 'text/csv', buffer: workbook }, { scope: 'ai-attachment' }),
    (error: unknown) => error instanceof BadRequestException
      && (error.getResponse() as { code?: string }).code === 'UPLOAD_CONTENT_MISMATCH',
  );
}

run();
