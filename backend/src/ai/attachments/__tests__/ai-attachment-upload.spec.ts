import * as assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { BadRequestException } from '@nestjs/common';
import { writeXlsx } from '../../../common/xlsx';
import { AiAttachmentService } from '../../ai-attachment.service';

/** Uploading a Plaid attachment: an image as before, a spreadsheet read at once and stored as `table`. */

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000100e221bc330000000049454e44ae426082', 'hex');

function harness() {
  const objects = new Map<string, Buffer>();
  const reads: string[] = [];
  const rows: any[] = [];
  const storage = {
    putObject: async (input: { key: string; body: Buffer }) => {
      objects.set(input.key, input.body);
    },
    getObjectStream: async (key: string) => {
      reads.push(key);
      return { stream: Readable.from([objects.get(key)!]) };
    },
  };
  const attachmentsRepo = {
    create: (row: any) => row,
    save: async (row: any) => {
      rows.push(row);
      return row;
    },
    findOne: async ({ where }: any) => rows.find((row) => row.id === where.id && row.tenant_id === where.tenant_id) ?? null,
  };
  const conversationsRepo = {
    findOne: async () => ({ id: 'conv-1', tenant_id: 'tenant-1', user_id: 'user-1', archived_at: null }),
  };
  const service = new AiAttachmentService(storage as any, attachmentsRepo as any, conversationsRepo as any);
  const upload = (originalname: string, mimetype: string, buffer: Buffer) =>
    service.uploadAttachment({
      conversationId: 'conv-1',
      tenantId: 'tenant-1',
      userId: 'user-1',
      file: { originalname, mimetype, buffer, size: buffer.length } as Express.Multer.File,
    });
  return { service, upload, objects, reads, rows };
}

async function run() {
  const { service, upload, objects, reads, rows } = harness();

  const image = await upload('shot.png', 'image/png', PNG);
  assert.equal(image.kind, 'image');

  const workbook = writeXlsx({ language: 'en', sheets: [{ name: 'Apps', headers: ['Name', 'Cost'], rows: [['CRM', { kind: 'number', value: 800 }]] }] });
  const table = await upload('apps.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', workbook);
  assert.equal(table.kind, 'table');
  assert.equal(table.mime_type, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  assert.equal(objects.size, 2);

  // The summary computed at upload is reused: the stored file is not read again.
  const text = await service.loadTableSummaryText(table);
  assert.match(text, /^<attached_table id="[0-9a-f-]+" filename="apps.xlsx">/);
  assert.match(text, /^1\. "Name": text, 1 of 1$/m);
  assert.match(text, /^line 2: CRM \| 800$/m);
  assert.equal(reads.length, 0);

  // A summary missing from the cache (a restart) is read again from the stored file.
  const restarted = new AiAttachmentService(
    { getObjectStream: async (key: string) => { reads.push(key); return { stream: Readable.from([objects.get(key)!]) }; } } as any,
    { findOne: async ({ where }: any) => rows.find((row) => row.id === where.id) ?? null } as any,
    {} as any,
  );
  const csv = await upload('costs.csv', 'text/csv', Buffer.from('Supplier;Amount\nAcme;1 200,50\n', 'utf8'));
  assert.equal(csv.kind, 'table');
  const other = { ...csv, id: '00000000-0000-4000-8000-000000000001' };
  rows.push(other);
  objects.set(other.storage_path, objects.get(csv.storage_path)!);
  assert.match(await restarted.loadTableSummaryText(other), /^line 2: Acme \| 1 200,50$/m);
  assert.equal(reads.length, 1);

  // A file that cannot be read is refused before anything is stored.
  const before = objects.size;
  await assert.rejects(
    upload('empty.csv', 'text/csv', Buffer.from(' ; \n', 'utf8')),
    (error: unknown) => error instanceof BadRequestException && (error.getResponse() as { code?: string }).code === 'CSV_FILE_EMPTY',
  );
  await assert.rejects(upload('notes.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', workbook), BadRequestException);
  assert.equal(objects.size, before);

  console.log('ai-attachment-upload.spec.ts: ok');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
