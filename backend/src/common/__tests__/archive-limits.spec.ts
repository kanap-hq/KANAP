import * as assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import * as zlib from 'node:zlib';
import { AddressInfo } from 'node:net';
import AdmZip = require('adm-zip');
import {
  ARCHIVE_MAX_ENTRIES,
  ARCHIVE_MAX_ENTRY_BYTES,
  ArchiveLimitError,
  openBoundedArchive,
} from '../archive-limits';
import { DocumentExportService } from '../document-export.service';
import { DocumentImportService } from '../document-import.service';
import { validateUploadedFile } from '../upload-validation';
import { WB_DOWNLOAD_MAX_BYTES, WB_RESPONSE_MAX_BYTES, WorldBankClient } from '../../currency/world-bank-client';

// ZIP archives are opened under limits (entry count, size of an entry, total
// size), checked before anything is decompressed, with the real size bounded
// while an entry is read. Each place that opens an archive goes through them.

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const MB = 1024 * 1024;

function zipOf(entries: Record<string, Buffer | string>): Buffer {
  const zip = new AdmZip();
  for (const [name, content] of Object.entries(entries)) {
    zip.addFile(name, Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8'));
  }
  return zip.toBuffer();
}

function manyEntries(count: number, base: Record<string, string> = {}): Buffer {
  const entries: Record<string, string> = { ...base };
  for (let i = 0; Object.keys(entries).length < count; i += 1) entries[`extra/file-${i}.txt`] = 'x';
  return zipOf(entries);
}

/** Rewrites the uncompressed size an entry declares, in its local and central headers. */
function declareSize(archive: Buffer, entryName: string, size: number): Buffer {
  const out = Buffer.from(archive);
  const name = Buffer.from(entryName, 'utf8');
  let patched = 0;
  for (let offset = 0; offset < out.length - 4; offset += 1) {
    const signature = out.readUInt32LE(offset);
    if (signature === 0x04034b50) {
      const nameLength = out.readUInt16LE(offset + 26);
      if (out.subarray(offset + 30, offset + 30 + nameLength).equals(name)) {
        out.writeUInt32LE(size, offset + 22);
        patched += 1;
      }
    } else if (signature === 0x02014b50) {
      const nameLength = out.readUInt16LE(offset + 28);
      if (out.subarray(offset + 46, offset + 46 + nameLength).equals(name)) {
        out.writeUInt32LE(size, offset + 24);
        patched += 1;
      }
    }
  }
  assert.equal(patched, 2, `both headers of ${entryName} were rewritten`);
  return out;
}

const isLimitError = (error: unknown) => error instanceof ArchiveLimitError && (error as ArchiveLimitError).getStatus() === 400;

function docx(extra: Record<string, Buffer | string> = {}): Buffer {
  return zipOf({
    '[Content_Types].xml': '<Types/>',
    'word/document.xml': '<w:document><w:body><w:p><w:r><w:t>Hello</w:t></w:r></w:p></w:body></w:document>',
    ...extra,
  });
}

function testHelper() {
  // An ordinary archive opens and reads.
  const ordinary = openBoundedArchive(zipOf({ 'a.txt': 'alpha', 'b/c.txt': 'gamma' }));
  ordinary.assertDeclaredSizes();
  ordinary.assertRealSizes();
  assert.equal(ordinary.readText(ordinary.zip.getEntry('b/c.txt')!), 'gamma');

  // More entries than allowed: refused when opened.
  assert.doesNotThrow(() => openBoundedArchive(manyEntries(ARCHIVE_MAX_ENTRIES)));
  assert.throws(() => openBoundedArchive(manyEntries(ARCHIVE_MAX_ENTRIES + 1)), isLimitError);

  // An entry that declares more than the per-entry limit: refused before it is decompressed.
  const declaredLarge = declareSize(zipOf({ 'big.xml': 'small' }), 'big.xml', ARCHIVE_MAX_ENTRY_BYTES + 1);
  const large = openBoundedArchive(declaredLarge);
  assert.throws(() => large.assertDeclaredSizes(), isLimitError);
  const bigEntry = large.zip.getEntry('big.xml')!;
  let decompressed = 0;
  const getData = bigEntry.getData.bind(bigEntry);
  bigEntry.getData = (...args: any[]) => { decompressed += 1; return getData(...args); };
  assert.throws(() => large.read(bigEntry), isLimitError);
  assert.equal(decompressed, 0, 'nothing is decompressed for an entry declared too large');

  // An entry whose real size is larger than it declares: reading stops at the declared size.
  const understated = declareSize(zipOf({ 'data.xml': Buffer.alloc(2 * MB) }), 'data.xml', 1024);
  const lying = openBoundedArchive(understated);
  assert.doesNotThrow(() => lying.assertDeclaredSizes());
  assert.throws(() => lying.read(lying.zip.getEntry('data.xml')!), isLimitError);
  assert.throws(() => openBoundedArchive(understated).assertRealSizes(), isLimitError);

  // An entry whose decompressed size is over the limit (lower limits keep the archive small).
  const honest = zipOf({ 'data.xml': Buffer.alloc(2 * MB) });
  const capped = openBoundedArchive(honest, { maxEntryBytes: MB });
  assert.throws(() => capped.read(capped.zip.getEntry('data.xml')!), isLimitError);

  // The total: declared sizes first, then the bytes actually read.
  const two = zipOf({ 'one.bin': Buffer.alloc(2 * MB), 'two.bin': Buffer.alloc(2 * MB) });
  assert.throws(() => openBoundedArchive(two, { maxTotalBytes: 3 * MB }).assertDeclaredSizes(), isLimitError);
  const reading = openBoundedArchive(two, { maxTotalBytes: 3 * MB });
  assert.equal(reading.read(reading.zip.getEntry('one.bin')!).length, 2 * MB);
  assert.throws(() => reading.read(reading.zip.getEntry('two.bin')!), isLimitError);
}

function testUploadValidation() {
  // Ordinary office files are still recognised.
  assert.equal(validateUploadedFile({ originalName: 'note.docx', mimeType: DOCX_MIME, buffer: docx() }).mimeType, DOCX_MIME);
  const odt = zipOf({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': '<office:document-content/>' });
  assert.equal(validateUploadedFile({ originalName: 'note.odt', mimeType: '', buffer: odt }).mimeType, 'application/vnd.oasis.opendocument.text');

  // Too many entries: 400.
  assert.throws(
    () => validateUploadedFile({ originalName: 'note.docx', mimeType: DOCX_MIME, buffer: manyEntries(ARCHIVE_MAX_ENTRIES + 1, { 'word/document.xml': '<w/>' }) }),
    isLimitError,
  );

  // Only the entry list is read: a spreadsheet whose sheet is very large is not decompressed.
  const sparse = declareSize(zipOf({ '[Content_Types].xml': '<Types/>', 'xl/worksheets/sheet1.xml': '<worksheet/>' }), 'xl/worksheets/sheet1.xml', 300 * MB);
  assert.equal(validateUploadedFile({ originalName: 'sheet.xlsx', mimeType: XLSX_MIME, buffer: sparse }).mimeType, XLSX_MIME);

  // A `mimetype` entry larger than a media type is not read: the file is a plain ZIP.
  const odd = zipOf({ mimetype: 'application/vnd.oasis.opendocument.text' + ' '.repeat(1000), 'content.xml': '<x/>' });
  assert.equal(validateUploadedFile({ originalName: 'bundle.zip', mimeType: 'application/zip', buffer: odd }).mimeType, 'application/zip');
}

async function testDocumentImport() {
  const service = new DocumentImportService({} as any);

  // Declared over the limit: 400 before the converter runs.
  const declared = declareSize(docx(), 'word/document.xml', ARCHIVE_MAX_ENTRY_BYTES + 1);
  await assert.rejects(service.convertToMarkdown(declared, DOCX_MIME, 'big.docx'), isLimitError);

  // Real size larger than declared, in an entry the converter would read: 400 as well.
  const understated = declareSize(docx({ 'word/media/image1.png': Buffer.alloc(2 * MB) }), 'word/media/image1.png', 1024);
  await assert.rejects(service.convertToMarkdown(understated, DOCX_MIME, 'lying.docx'), isLimitError);

  // Images extracted by the converter are read back within limits.
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-limits-spec-'));
  try {
    await fs.mkdir(path.join(tempDir, 'media'));
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(92)]);
    await fs.writeFile(path.join(tempDir, 'media', 'one.png'), png);
    await fs.writeFile(path.join(tempDir, 'media', 'two.png'), png);
    // A sparse file: its size is on disk without the bytes being written.
    const big = await fs.open(path.join(tempDir, 'media', 'big.png'), 'w');
    await big.truncate(ARCHIVE_MAX_ENTRY_BYTES + 1);
    await big.close();

    const collect = (markdown: string, limits?: { maxImageBytes: number; maxTotalBytes: number }) =>
      (service as any).collectReferencedImages(markdown, tempDir, limits);

    const tooBig = await collect('![a](media/big.png)');
    assert.equal(tooBig.images.length, 0);
    assert.deepEqual(tooBig.omittedTargets, ['media/big.png']);
    assert.match(tooBig.warnings[0], /too large/);

    const budget = await collect('![a](media/one.png) ![b](media/two.png)', { maxImageBytes: 1000, maxTotalBytes: 150 });
    assert.deepEqual(budget.images.map((image: any) => image.sourcePath), ['media/one.png']);
    assert.deepEqual(budget.omittedTargets, ['media/two.png']);

    const ordinary = await collect('![a](media/one.png) ![b](media/two.png)');
    assert.equal(ordinary.images.length, 2);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testDocumentExport() {
  const service = new DocumentExportService();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-limits-spec-'));
  const contentXml = '<office:document-content><draw:frame svg:width="20cm" svg:height="10cm"/></office:document-content>';
  try {
    // Ordinary output: the frame is narrowed as before.
    const ordinaryPath = path.join(tempDir, 'ordinary.odt');
    await fs.writeFile(ordinaryPath, zipOf({ mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': contentXml }));
    await (service as any).normalizeOdtImageFrames(ordinaryPath);
    assert.match(new AdmZip(ordinaryPath).readAsText('content.xml'), /svg:width="16cm"/);

    // content.xml declared over the limit: not read.
    const largePath = path.join(tempDir, 'large.odt');
    await fs.writeFile(largePath, declareSize(zipOf({ 'content.xml': contentXml }), 'content.xml', ARCHIVE_MAX_ENTRY_BYTES + 1));
    await assert.rejects((service as any).normalizeOdtImageFrames(largePath), isLimitError);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function testWorldBank() {
  const client = new WorldBankClient();
  const csvName = 'API_PA.NUS.FCRF_DS2_en_csv_v2.csv';

  assert.equal((client as any).extractCsvFromArchive(zipOf({ [csvName]: 'Country Name,2020' })), 'Country Name,2020');
  assert.throws(() => (client as any).extractCsvFromArchive(manyEntries(ARCHIVE_MAX_ENTRIES + 1, { [csvName]: 'x' })), isLimitError);

  const smallJson = zlib.gzipSync(Buffer.from(JSON.stringify([{ page: 1 }, [{ date: '2020', value: 1 }]])));
  const largeJson = zlib.gzipSync(Buffer.alloc(WB_RESPONSE_MAX_BYTES + MB, 0x20));
  const server = http.createServer((req, res) => {
    if (req.url === '/declared-large') {
      res.writeHead(200, { 'content-length': String(WB_DOWNLOAD_MAX_BYTES + 1) });
      res.flushHeaders();
      return; // the client gives up on the declared length
    }
    if (req.url === '/streamed-large') {
      res.writeHead(200, { 'content-type': 'application/zip' });
      const chunk = Buffer.alloc(MB);
      let sent = 0;
      const write = () => {
        while (sent <= WB_DOWNLOAD_MAX_BYTES) {
          sent += chunk.length;
          if (!res.write(chunk)) { res.once('drain', write); return; }
        }
        res.end();
      };
      res.on('error', () => undefined);
      write();
      return;
    }
    if (req.url === '/json-small') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      res.end(smallJson);
      return;
    }
    if (req.url === '/json-large') {
      res.writeHead(200, { 'content-type': 'application/json', 'content-encoding': 'gzip' });
      res.end(largeJson);
      return;
    }
    res.writeHead(200, { 'content-type': 'application/zip' });
    res.end(zipOf({ [csvName]: 'Country Name,2020' }));
  });
  server.on('clientError', () => undefined);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const archive: Buffer = await (client as any).requestBinary(`${base}/archive`, 5000, 0);
    assert.equal((client as any).extractCsvFromArchive(archive), 'Country Name,2020');
    await assert.rejects((client as any).requestBinary(`${base}/declared-large`, 5000, 0), /size limit/);
    await assert.rejects((client as any).requestBinary(`${base}/streamed-large`, 5000, 0), /size limit/);

    assert.deepEqual(await (client as any).request(`${base}/json-small`, 5000), [{ page: 1 }, [{ date: '2020', value: 1 }]]);
    await assert.rejects(
      (client as any).request(`${base}/json-large`, 5000),
      (error: NodeJS.ErrnoException) => error.code === 'ERR_BUFFER_TOO_LARGE',
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

async function run() {
  testHelper();
  testUploadValidation();
  await testDocumentImport();
  await testDocumentExport();
  await testWorldBank();
  console.log('archive-limits.spec: all assertions passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
