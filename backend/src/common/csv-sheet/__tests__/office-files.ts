import AdmZip = require('adm-zip');

// Minimal office files, built the way the applications write them, for the
// specs that check a workbook is refused before it is read as CSV.

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';

/** An .xlsx with one sheet whose first row is `name`, `status`. */
export function minimalXlsx(): Buffer {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(
    `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    + '<Default Extension="xml" ContentType="application/xml"/>'
    + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
    + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
    + '</Types>',
  ));
  zip.addFile('_rels/.rels', Buffer.from(
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
    + '</Relationships>',
  ));
  zip.addFile('xl/workbook.xml', Buffer.from(
    `${XML}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">`
    + '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
  ));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(
    `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
    + '</Relationships>',
  ));
  zip.addFile('xl/worksheets/sheet1.xml', Buffer.from(
    `${XML}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>`
    + '<row r="1"><c r="A1" t="inlineStr"><is><t>name</t></is></c><c r="B1" t="inlineStr"><is><t>status</t></is></c></row>'
    + '</sheetData></worksheet>',
  ));
  return zip.toBuffer();
}

/** An .ods: `mimetype` is stored uncompressed, as ODF requires (AdmZip orders the entries by name; the check does not depend on it). */
export function minimalOds(): Buffer {
  const zip = new AdmZip();
  zip.addFile('mimetype', Buffer.from('application/vnd.oasis.opendocument.spreadsheet'));
  zip.getEntry('mimetype')!.header.method = 0;
  zip.addFile('content.xml', Buffer.from(
    `${XML}<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"><office:body><office:spreadsheet/></office:body></office:document-content>`,
  ));
  return zip.toBuffer();
}

/** A .docx: a ZIP too, with no workbook in it. */
export function minimalDocx(): Buffer {
  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(`${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`));
  zip.addFile('word/document.xml', Buffer.from(`${XML}<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`));
  return zip.toBuffer();
}

const SECTOR = 512;
const FREE = 0xffffffff;
const END_OF_CHAIN = 0xfffffffe;
const FAT_SECTOR = 0xfffffffd;

/**
 * An OLE compound file (Excel 97-2003 .xls) holding one stream, `Workbook`,
 * with a BIFF8 BOF and EOF record. Sector 0 is the FAT, sector 1 the
 * directory, sectors 2 to 9 the stream (4096 bytes, so it is not in the mini stream).
 */
export function minimalXls(streamName = 'Workbook'): Buffer {
  const streamSectors = 8;
  const header = Buffer.alloc(SECTOR);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header, 0);
  header.writeUInt16LE(0x003e, 24); // minor version
  header.writeUInt16LE(0x0003, 26); // major version 3: 512-byte sectors
  header.writeUInt16LE(0xfffe, 28); // little endian
  header.writeUInt16LE(9, 30); // sector shift
  header.writeUInt16LE(6, 32); // mini sector shift
  header.writeUInt32LE(1, 44); // FAT sectors
  header.writeUInt32LE(1, 48); // first directory sector
  header.writeUInt32LE(4096, 56); // mini stream cutoff
  header.writeUInt32LE(END_OF_CHAIN, 60); // no mini FAT
  header.writeUInt32LE(END_OF_CHAIN, 68); // no DIFAT sector
  header.writeUInt32LE(0, 76); // DIFAT[0]: the FAT is sector 0
  for (let offset = 80; offset < SECTOR; offset += 4) header.writeUInt32LE(FREE, offset);

  const fat = Buffer.alloc(SECTOR, 0xff);
  fat.writeUInt32LE(FAT_SECTOR, 0);
  fat.writeUInt32LE(END_OF_CHAIN, 4);
  for (let sector = 2; sector < 2 + streamSectors; sector++) {
    fat.writeUInt32LE(sector === 1 + streamSectors ? END_OF_CHAIN : sector + 1, sector * 4);
  }

  const directory = Buffer.alloc(SECTOR);
  const entry = (index: number, name: string, type: number, child: number, start: number, size: number) => {
    const base = index * 128;
    Buffer.from(`${name}\u0000`, 'utf16le').copy(directory, base);
    directory.writeUInt16LE((name.length + 1) * 2, base + 64);
    directory.writeUInt8(type, base + 66);
    directory.writeUInt8(1, base + 67); // black
    directory.writeUInt32LE(FREE, base + 68);
    directory.writeUInt32LE(FREE, base + 72);
    directory.writeUInt32LE(child, base + 76);
    directory.writeUInt32LE(start, base + 116);
    directory.writeUInt32LE(size, base + 120);
  };
  entry(0, 'Root Entry', 5, 1, END_OF_CHAIN, 0);
  entry(1, streamName, 2, FREE, 2, streamSectors * SECTOR);
  for (let index = 2; index < 4; index++) {
    directory.writeUInt32LE(FREE, index * 128 + 68);
    directory.writeUInt32LE(FREE, index * 128 + 72);
    directory.writeUInt32LE(FREE, index * 128 + 76);
  }

  const stream = Buffer.alloc(streamSectors * SECTOR);
  // BOF (0x0809): BIFF8, workbook globals; then EOF (0x000A).
  Buffer.from([0x09, 0x08, 0x10, 0x00, 0x00, 0x06, 0x05, 0x00]).copy(stream, 0);
  Buffer.from([0x0a, 0x00, 0x00, 0x00]).copy(stream, 20);
  return Buffer.concat([header, fat, directory, stream]);
}
