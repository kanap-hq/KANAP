import * as assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { backendPath } from '../../__tests__/backend-root';
import { writeXlsx } from '../write';
import {
  isDateFormatCode,
  readXlsxGrid,
  serialToIsoDay,
  XLSX_OLD_FORMAT_MESSAGE,
  XLSX_READ_LIMITS,
  XlsxReadCell,
  XlsxReadError,
  XlsxReadLimits,
} from '../read';
import { declareSize, handmadeXlsx, HandmadeParts, si, workbookParts, zipOf } from './fixtures/handmade';

/**
 * The xlsx reader: each item of its scope, each limit, the refusals, files written by the common writer
 * and by LibreOffice, and a fuzz loop that must only ever end in a result or an XlsxReadError.
 */

const fixture = (name: string): Buffer => fs.readFileSync(backendPath('src', 'common', 'xlsx', '__tests__', 'fixtures', name));
const text = (value: string): XlsxReadCell => ({ kind: 'text', value });
const number = (value: string): XlsxReadCell => ({ kind: 'number', value });
const date = (iso: string): XlsxReadCell => ({ kind: 'date', iso });
const EMPTY: XlsxReadCell = { kind: 'empty' };
const rowsOf = (options: HandmadeParts, limits?: Partial<XlsxReadLimits>) => readXlsxGrid(handmadeXlsx(options), limits).rows;

function refuses(read: () => unknown, code: XlsxReadError['code'], limit: XlsxReadError['limit'] = null, label = code): XlsxReadError {
  let caught: unknown;
  try {
    read();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught instanceof XlsxReadError, `${label}: an XlsxReadError (got ${String(caught)})`);
  const error = caught as XlsxReadError;
  assert.equal(error.code, code, `${label}: code`);
  assert.equal(error.limit, limit, `${label}: limit`);
  assert.equal(error.getStatus(), 400, `${label}: a 400`);
  assert.match(error.message, /^[A-Z].*\.$/, `${label}: a sentence`);
  return error;
}

function sharedAndRichStrings() {
  const rows = rowsOf({
    sharedStrings: [
      si('plain'),
      // Rich text: runs concatenated; the phonetic run is not part of the text.
      '<si><r><t>Bon</t></r><r><rPr><b/></rPr><t xml:space="preserve">jour </t></r><rPh sb="0" eb="3"><t>ボンジュール</t></rPh></si>',
      '<si><t>A</t><rPh sb="0" eb="1"><t>エー</t></rPh><phoneticPr fontId="1"/></si>',
      si('  spaced  '),
      si('line_x000D_\nbreak and _x005F_x0041_'),
      '<si/>',
      si('&lt;tag&gt; &amp; &#233;&#x00E9;'),
    ],
    sheetData:
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c></row>' +
      '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="s"><v>4</v></c><c r="C2" t="s"><v>5</v></c><c r="D2" t="s"><v>6</v></c></row>',
  });
  assert.deepEqual(rows, [
    [text('plain'), text('Bonjour '), text('A')],
    [text('  spaced  '), text('line\r\nbreak and _x0041_'), EMPTY, text('<tag> & éé')],
  ]);
  refuses(() => rowsOf({ sharedStrings: [si('a')], sheetData: '<row r="1"><c r="A1" t="s"><v>1</v></c></row>' }), 'XLSX_INVALID', null, 'shared string index out of range');
}

function inlineFormulaBooleanError() {
  const rows = rowsOf({
    sheetData:
      '<row r="1">' +
      '<c r="A1" t="inlineStr"><is><t xml:space="preserve"> inline </t></is></c>' +
      '<c r="B1" t="inlineStr"><is><r><t>ri</t></r><r><t>ch</t></r><rPh><t>x</t></rPh></is></c>' +
      '<c r="C1" t="str"><f>"a"&amp;"b"</f><v>ab</v></c>' +
      '<c r="D1" t="b"><v>1</v></c><c r="E1" t="b"><v>0</v></c>' +
      '<c r="F1" t="e"><v>#N/A</v></c>' +
      '<c r="G1"><f>1+1</f><v>2</v></c>' +
      '<c r="H1"><f>1+1</f></c>' +
      '<c r="I1" t="str"><f>A1</f></c>' +
      '<c r="J1" t="d"><v>2027-12-31T00:00:00</v></c>' +
      '<c r="K1">  <v> 3.5 </v></c>' +
      '<c r="L1" t="n"><v>-1.5E-3</v></c>' +
      '</row>',
  });
  assert.deepEqual(rows, [
    [text(' inline '), text('rich'), text('ab'), text('TRUE'), text('FALSE'), text('#N/A'), number('2'), EMPTY, EMPTY, date('2027-12-31'), number('3.5'), number('-1.5E-3')],
  ]);
  refuses(() => rowsOf({ sheetData: '<row r="1"><c r="A1"><v>12abc</v></c></row>' }), 'XLSX_INVALID', null, 'a number cell that is no number');
  refuses(() => rowsOf({ sheetData: '<row r="1"><c r="A1" t="x"><v>1</v></c></row>' }), 'XLSX_INVALID', null, 'unknown cell type');
}

function gaps() {
  // A1 and C1: B1 is empty. Cells and rows without `r` follow the previous ones. Row 3 is missing.
  const rows = rowsOf({
    sheetData:
      '<row r="1"><c r="A1" t="inlineStr"><is><t>a</t></is></c><c r="C1" t="inlineStr"><is><t>c</t></is></c></row>' +
      '<row><c t="inlineStr"><is><t>a2</t></is></c><c><v>2</v></c><c r="E2"><v>5</v></c><c><v>6</v></c></row>' +
      '<row r="4"><c r="B4" s="0"/><c r="C4"><v>3</v></c><c r="D4" s="0"/></row>' +
      '<row r="5"><c r="A5" s="0"/></row>' +
      '<row r="9" customFormat="1"/>',
  });
  assert.deepEqual(rows, [
    [text('a'), EMPTY, text('c')],
    [text('a2'), number('2'), EMPTY, EMPTY, number('5'), number('6')],
    [],
    [EMPTY, EMPTY, number('3')],
  ]);
  refuses(() => rowsOf({ sheetData: '<row r="2"/><row r="1"/>' }), 'XLSX_INVALID', null, 'rows out of order');
  refuses(() => rowsOf({ sheetData: '<row r="1"><c r="B1"><v>1</v></c><c r="A1"><v>1</v></c></row>' }), 'XLSX_INVALID', null, 'cells out of order');
  refuses(() => rowsOf({ sheetData: '<row r="1"><c r="1A"><v>1</v></c></row>' }), 'XLSX_INVALID', null, 'bad cell reference');
}

function dateStyles() {
  assert.ok(isDateFormatCode('[$-40C]dd/mm/yyyy'), 'locale tag then day');
  assert.ok(isDateFormatCode('yyyy-mm-dd'));
  assert.ok(isDateFormatCode('mmm d, yyyy'));
  assert.ok(isDateFormatCode('dd/mm/yyyy\\ hh:mm'));
  assert.ok(!isDateFormatCode('General'), 'General');
  assert.ok(!isDateFormatCode('#,##0.00'), 'amount');
  assert.ok(!isDateFormatCode('0" days"'), 'a d inside quotes');
  assert.ok(!isDateFormatCode('[Red]0.00'), 'a d inside brackets');
  assert.ok(!isDateFormatCode('[h]:mm:ss'), 'elapsed time');
  assert.ok(!isDateFormatCode('[mm]:ss'), 'elapsed minutes');
  assert.ok(!isDateFormatCode('0\\d'), 'an escaped d');

  // Styles: 0 General, 1 built-in 14, 2 built-in 22, 3 custom date, 4 custom amount, 5 built-in 4, 6 elapsed, 7 built-in 47.
  const styled = {
    numFmts: '<numFmt numFmtId="164" formatCode="[$-40C]dd/mm/yyyy"/><numFmt numFmtId="165" formatCode="#,##0.00\\ &quot;€&quot;"/><numFmt numFmtId="166" formatCode="[h]:mm"/>',
    cellXfs: [0, 14, 22, 164, 165, 4, 166, 47],
  };
  const cells = (values: string[]) =>
    `<row r="1">${values.map((v, i) => `<c r="${String.fromCharCode(65 + i)}1" s="${i}"><v>${v}</v></c>`).join('')}</row>`;
  assert.deepEqual(rowsOf({ ...styled, sheetData: cells(['46752', '46752', '46752.75', '46752', '46752', '46752', '1.5', '0.25']) }), [
    // A time of day alone (serial 0.25 in a time format) is no calendar day: it stays a number.
    [number('46752'), date('2027-12-31'), date('2027-12-31'), date('2027-12-31'), number('46752'), number('46752'), number('1.5'), number('0.25')],
  ]);
  // A style index past the table is General.
  assert.deepEqual(rowsOf({ ...styled, sheetData: '<row r="1"><c r="A1" s="99"><v>46752</v></c></row>' }), [[number('46752')]]);

  // 1900 system, with its leap-year bug: 60 is 1900-02-29, which never existed.
  assert.equal(serialToIsoDay(1, false), '1900-01-01');
  assert.equal(serialToIsoDay(59, false), '1900-02-28');
  assert.equal(serialToIsoDay(60, false), null);
  assert.equal(serialToIsoDay(61, false), '1900-03-01');
  assert.equal(serialToIsoDay(0, false), null);
  assert.equal(serialToIsoDay(-1, false), null);
  assert.equal(serialToIsoDay(2_958_465, false), '9999-12-31');
  assert.equal(serialToIsoDay(2_958_466, false), null);
  // 1904 system.
  assert.equal(serialToIsoDay(0, true), '1904-01-01');
  assert.equal(serialToIsoDay(45_290, true), '2027-12-31');

  const dateCells = '<row r="1"><c r="A1" s="1"><v>60</v></c><c r="B1" s="1"><v>61</v></c><c r="C1" s="1"><v>45290</v></c></row>';
  assert.deepEqual(rowsOf({ cellXfs: [0, 14], sheetData: dateCells }), [[number('60'), date('1900-03-01'), date('2023-12-30')]]);
  assert.deepEqual(rowsOf({ cellXfs: [0, 14], sheetData: dateCells, date1904: true }), [[date('1904-03-01'), date('1904-03-02'), date('2027-12-31')]]);
}

function sheetsAndNamespaces() {
  // A chart sheet comes first: the first worksheet is read; both are counted.
  const grid = readXlsxGrid(
    handmadeXlsx({
      sheetsXml: '<sheet name="Chart" sheetId="2" r:id="rId2"/><sheet name="OPEX" sheetId="1" r:id="rId1"/><sheet name="Other" sheetId="3" r:id="rId3"/>',
      relsXml:
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="/xl/worksheets/sheet1.xml"/>' +
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chartsheet" Target="chartsheets/sheet1.xml"/>' +
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>',
      sheetData: '<row r="1"><c r="A1"><v>1</v></c></row>',
      parts: { 'xl/worksheets/sheet2.xml': '<worksheet><sheetData><row r="1"><c r="A1"><v>2</v></c></row></sheetData></worksheet>' },
    }),
  );
  assert.deepEqual(grid, { sheetName: 'OPEX', sheetCount: 3, rows: [[number('1')]] });

  // Prefixed elements (`x:`) and the strict relationship namespace.
  const strict = zipOf({
    ...workbookParts({ sheetData: '' }),
    'xl/workbook.xml':
      '<x:workbook xmlns:x="http://purl.oclc.org/ooxml/spreadsheetml/main" xmlns:rel="http://purl.oclc.org/ooxml/officeDocument/relationships"><x:sheets><x:sheet name="S" sheetId="1" rel:id="rId1"/></x:sheets></x:workbook>',
    'xl/_rels/workbook.xml.rels':
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://purl.oclc.org/ooxml/officeDocument/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':
      '<x:worksheet xmlns:x="http://purl.oclc.org/ooxml/spreadsheetml/main"><x:sheetData><x:row r="1"><x:c r="A1" t="inlineStr"><x:is><x:t>s</x:t></x:is></x:c></x:row></x:sheetData></x:worksheet>',
  });
  assert.deepEqual(readXlsxGrid(strict).rows, [[text('s')]]);

  // No worksheet at all; a worksheet whose part is missing.
  refuses(() => readXlsxGrid(handmadeXlsx({ sheetsXml: '', sheetData: '' })), 'XLSX_NO_SHEET');
  refuses(() => readXlsxGrid(zipOf({ ...workbookParts({ sheetData: '' }), 'xl/worksheets/sheet1.xml': '' })), 'XLSX_INVALID', null, 'empty sheet part');
  const missing = workbookParts({ sheetData: '' });
  delete missing['xl/worksheets/sheet1.xml'];
  refuses(() => readXlsxGrid(zipOf(missing)), 'XLSX_INVALID', null, 'missing sheet part');
  // An empty sheet is an empty grid.
  assert.deepEqual(rowsOf({ sheetData: '' }), []);
}

function refusals() {
  const xls = Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(512)]);
  assert.equal(refuses(() => readXlsxGrid(xls), 'XLSX_OLD_FORMAT').message, XLSX_OLD_FORMAT_MESSAGE);
  assert.equal(XLSX_OLD_FORMAT_MESSAGE, 'This is an old Excel file (.xls). Save it as .xlsx or CSV and import it again.');
  refuses(() => readXlsxGrid(Buffer.from('name;amount\nx;1\n')), 'XLSX_NOT_WORKBOOK', null, 'a CSV file');
  refuses(() => readXlsxGrid(zipOf({ 'content.xml': '<office/>', mimetype: 'application/vnd.oasis.opendocument.spreadsheet' })), 'XLSX_NOT_WORKBOOK', null, 'an .ods file');
  refuses(() => readXlsxGrid(Buffer.from('PK\x03\x04 broken')), 'XLSX_NOT_WORKBOOK', null, 'a broken archive');

  // DOCTYPE and ENTITY: refused before parsing, in any part.
  const laughs = '<!DOCTYPE sst [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">]>';
  refuses(
    () => readXlsxGrid(handmadeXlsx({ sharedStrings: [si('x')], sheetData: '', parts: { 'xl/sharedStrings.xml': `<?xml version="1.0"?>${laughs}<sst><si><t>&b;</t></si></sst>` } })),
    'XLSX_DOCTYPE',
    null,
    'DOCTYPE in sharedStrings.xml',
  );
  refuses(() => readXlsxGrid(handmadeXlsx({ sheetData: '', parts: { 'xl/workbook.xml': '<!ENTITY x "y"><workbook/>' } })), 'XLSX_DOCTYPE', null, 'ENTITY in workbook.xml');
  refuses(() => readXlsxGrid(handmadeXlsx({ sheetData: '<row r="1"><c r="A1" t="inlineStr"><is><t>&custom;</t></is></c></row>' })), 'XLSX_INVALID', null, 'undeclared entity');
  refuses(() => readXlsxGrid(handmadeXlsx({ sheetData: '<row r="1"><c r="A1"><v>1</v></row>' })), 'XLSX_INVALID', null, 'malformed XML');
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('<worksheet/>', 'utf16le')]);
  refuses(() => readXlsxGrid(zipOf({ ...workbookParts({ sheetData: '' }), 'xl/worksheets/sheet1.xml': utf16 })), 'XLSX_INVALID', null, 'a UTF-16 part');
}

function limits() {
  assert.deepEqual(XLSX_READ_LIMITS, {
    maxArchiveBytes: 48 * 1024 * 1024,
    maxEntries: 2_000,
    maxEntryBytes: 200 * 1024 * 1024,
    maxTotalBytes: 300 * 1024 * 1024,
    maxCompressionRatio: 100,
    compressionRatioFromBytes: 1024 * 1024,
    maxSharedStrings: 1_000_000,
    maxCellElements: 5_000_000,
    maxGridCells: 5_000_000,
    maxCellTextLength: 32_767,
    maxRows: 200_000,
    maxColumns: 16_384,
  });
  const small = handmadeXlsx({ sheetData: '<row r="1"><c r="A1"><v>1</v></c></row>' });
  refuses(() => readXlsxGrid(small, { maxArchiveBytes: small.length - 1 }), 'XLSX_TOO_LARGE', 'maxArchiveBytes');

  // Entries: 2,000 at most, the implied folders counted.
  const parts = workbookParts({ sheetData: '' });
  const crowded: Record<string, string> = {};
  // Six parts and four folders (`_rels/`, `xl/`, `xl/_rels/`, `xl/worksheets/`), then files at the root.
  for (let i = 0; Object.keys(parts).length + 4 + Object.keys(crowded).length < XLSX_READ_LIMITS.maxEntries; i += 1) crowded[`extra-${i}.txt`] = '';
  assert.deepEqual(readXlsxGrid(zipOf({ ...parts, ...crowded })).rows, [], '2,000 entries and folders are read');
  refuses(() => readXlsxGrid(zipOf({ ...parts, ...crowded, 'one-more.txt': '' })), 'XLSX_TOO_LARGE', 'maxEntries');

  // Declared sizes, before anything is decompressed: one entry, then all of them.
  const MB = 1024 * 1024;
  const sheet = 'xl/worksheets/sheet1.xml';
  refuses(() => readXlsxGrid(declareSize(small, sheet, 200 * MB + 1)), 'XLSX_TOO_LARGE', 'maxEntryBytes');
  const twoParts = zipOf({ ...workbookParts({ sheetData: '' }), 'docProps/thumbnail.bin': 'x' });
  refuses(() => readXlsxGrid(declareSize(declareSize(twoParts, sheet, 160 * MB), 'docProps/thumbnail.bin', 160 * MB)), 'XLSX_TOO_LARGE', 'maxTotalBytes');

  // Compression ratio of a part the reader decompresses; an unread part may be packed tighter.
  const padding = `<!--${' '.repeat(2 * MB)}-->`;
  const packed = zipOf({ ...workbookParts({ sheetData: '' }), [sheet]: `<worksheet>${padding}<sheetData/></worksheet>` });
  refuses(() => readXlsxGrid(packed), 'XLSX_TOO_LARGE', 'maxCompressionRatio');
  // A small part packed as tight is read: the ratio applies to parts over 1 MB.
  const smallPacked = zipOf({ ...workbookParts({ sheetData: '' }), [sheet]: `<worksheet><!--${' '.repeat(MB - 100)}--><sheetData/></worksheet>` });
  assert.deepEqual(readXlsxGrid(smallPacked).rows, []);
  assert.deepEqual(readXlsxGrid(zipOf({ ...workbookParts({ sheetData: '' }), 'xl/printerSettings/printerSettings1.bin': Buffer.alloc(2 * MB) })).rows, []);

  // A part that unpacks to more than it declares: the inflater stops at the declared size.
  const honest = handmadeXlsx({ sheetData: `<row r="1"><c r="A1" t="inlineStr"><is><t>${'abcdefgh'.repeat(500)}</t></is></c></row>` });
  refuses(() => readXlsxGrid(declareSize(honest, sheet, 1_000)), 'XLSX_INVALID', null, 'a lying declared size');

  // Shared strings, cell elements, grid cells, rows, columns (small limits to keep the spec quick).
  refuses(() => rowsOf({ sharedStrings: [si('a'), si('b'), si('c'), si('d')], sheetData: '' }, { maxSharedStrings: 3 }), 'XLSX_TOO_LARGE', 'maxSharedStrings');
  assert.deepEqual(rowsOf({ sharedStrings: [si('a'), si('b'), si('c')], sheetData: '' }, { maxSharedStrings: 3 }), []);
  const sixCells = '<row r="1"><c r="A1"><v>1</v></c><c r="B1"/><c r="C1"/></row><row r="2"><c r="A2"/><c r="B2"/><c r="C2"/></row>';
  refuses(() => rowsOf({ sheetData: sixCells }, { maxCellElements: 5 }), 'XLSX_TOO_LARGE', 'maxCellElements');
  assert.equal(rowsOf({ sheetData: sixCells }, { maxCellElements: 6 }).length, 1);
  refuses(() => rowsOf({ sheetData: '<row r="1"><c r="J1"><v>1</v></c></row>' }, { maxGridCells: 9 }), 'XLSX_TOO_LARGE', 'maxGridCells');
  assert.equal(rowsOf({ sheetData: '<row r="1"><c r="J1"><v>1</v></c></row>' }, { maxGridCells: 10 })[0].length, 10);
  refuses(() => rowsOf({ sheetData: '<row r="11"><c r="A11"><v>1</v></c></row>' }, { maxRows: 10 }), 'XLSX_TOO_LARGE', 'maxRows');
  assert.equal(rowsOf({ sheetData: '<row r="10"><c r="A10"><v>1</v></c></row><row r="5000"><c r="A5000" s="0"/></row>' }, { maxRows: 10 }).length, 10, 'an empty row past the limit is ignored');
  assert.equal(rowsOf({ sheetData: '<row r="1"><c r="XFD1"><v>1</v></c></row>' })[0].length, 16_384);
  refuses(() => rowsOf({ sheetData: '<row r="1"><c r="XFE1"><v>1</v></c></row>' }), 'XLSX_TOO_LARGE', 'maxColumns');

  // Text of one cell: 32,767 characters, in a shared string, an inline string and a value.
  const longest = 'x'.repeat(32_767);
  assert.equal(rowsOf({ sheetData: `<row r="1"><c r="A1" t="inlineStr"><is><t>${longest}</t></is></c></row>` })[0][0].kind, 'text');
  refuses(() => rowsOf({ sheetData: `<row r="1"><c r="A1" t="inlineStr"><is><t>${longest}x</t></is></c></row>` }), 'XLSX_TOO_LARGE', 'maxCellTextLength', 'inline string');
  refuses(() => rowsOf({ sharedStrings: [si(`${longest}x`)], sheetData: '' }), 'XLSX_TOO_LARGE', 'maxCellTextLength', 'shared string');
  refuses(() => rowsOf({ sheetData: `<row r="1"><c r="A1" t="str"><v>${longest}x</v></c></row>` }), 'XLSX_TOO_LARGE', 'maxCellTextLength', 'formula string');
}

function writerRoundTrip() {
  const buffer = writeXlsx({
    language: 'fr',
    sheets: [
      {
        name: 'OPEX',
        headers: ['kanap_token', 'account', 'end_of_validity', 'budget_2027', 'days', 'share', 'old', 'empty', 'formula'],
        rows: [
          ['k1.fr.0123456789abcdef', '01100', { kind: 'date', iso: '2027-12-31' }, { kind: 'amount', value: '-1234.50' }, { kind: 'number', value: 3.25, decimals: 2 }, { kind: 'percent', value: 0.125 }, { kind: 'date', iso: '1899-05-01' }, null, '=1+1'],
          ['0042', '  leading spaces', { kind: 'date', iso: '1900-03-01' }, { kind: 'amount', value: '12345678901234567.89' }, { kind: 'number', value: 7 }, null, null, null, 'é ü 中 😀'],
        ],
      },
    ],
  });
  const grid = readXlsxGrid(buffer);
  assert.equal(grid.sheetName, 'OPEX');
  assert.equal(grid.sheetCount, 1);
  assert.deepEqual(grid.rows, [
    ['kanap_token', 'account', 'end_of_validity', 'budget_2027', 'days', 'share', 'old', 'empty', 'formula'].map(text),
    [text('k1.fr.0123456789abcdef'), text('01100'), date('2027-12-31'), number('-1234.50'), number('3.25'), number('0.125'), text('01/05/1899'), EMPTY, text("'=1+1")],
    [text('0042'), text('  leading spaces'), date('1900-03-01'), number('12345678901234567.89'), number('7'), EMPTY, EMPTY, EMPTY, text('é ü 中 😀')],
  ]);

  // The committed writer fixture: two sheets, the first one read.
  const fromWriter = readXlsxGrid(fixture('writer-budget.xlsx'));
  assert.equal(fromWriter.sheetName, 'OPEX');
  assert.equal(fromWriter.sheetCount, 2);
  assert.deepEqual(fromWriter.rows[1], [
    text('k1.fr.0123456789abcdef'), text('01100'), text('Licences'), date('2027-01-01'), date('2027-12-31'), number('12280.00'), number('-1234.56'), number('3'),
  ]);
}

function libreOffice() {
  // LibreOffice's CSV import turned 01100 into the number 1100 and the day into a date (format `mm/dd/yy`).
  const fromCsv = readXlsxGrid(fixture('libreoffice-from-csv.xlsx'));
  assert.equal(fromCsv.sheetCount, 1);
  assert.deepEqual(fromCsv.rows, [
    ['account', 'description', 'effective_start', 'budget_2027', 'note'].map(text),
    [number('1100'), text('Licences'), date('2027-12-31'), number('12280.5'), text('  kept  ')],
    [number('42'), text('Support'), date('2027-02-01'), number('-1234.56'), text('TRUE')],
  ]);
  // The writer's file saved again by LibreOffice: shared strings, its own styles, the same values.
  const fromWriter = readXlsxGrid(fixture('libreoffice-from-writer.xlsx'));
  assert.equal(fromWriter.sheetName, 'OPEX');
  assert.equal(fromWriter.sheetCount, 2);
  assert.deepEqual(fromWriter.rows.slice(1), [
    [text('k1.fr.0123456789abcdef'), text('01100'), text('Licences'), date('2027-01-01'), date('2027-12-31'), number('12280'), number('-1234.56'), number('3')],
    [text('k1.fr.fedcba9876543210'), text('0042'), text("'=SUM(A1:A2)"), date('2028-02-29'), EMPTY, number('0.1'), EMPTY, number('2.5')],
    [EMPTY, EMPTY, text('  spaced  ')],
  ]);
}

/** A seeded generator, so a failure can be replayed. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function fuzz() {
  const sources = [fixture('writer-budget.xlsx'), fixture('libreoffice-from-csv.xlsx')];
  const next = random(20261027);
  let results = 0;
  let refusals = 0;
  for (let round = 0; round < 400; round += 1) {
    const source = sources[round % sources.length];
    let mutated: Buffer;
    if (next() < 0.3) {
      mutated = source.subarray(0, Math.floor(next() * source.length));
    } else {
      mutated = Buffer.from(source);
      const flips = 1 + Math.floor(next() * 8);
      for (let i = 0; i < flips; i += 1) mutated[Math.floor(next() * mutated.length)] = Math.floor(next() * 256);
    }
    try {
      const grid = readXlsxGrid(mutated);
      assert.ok(Array.isArray(grid.rows));
      results += 1;
    } catch (error) {
      assert.ok(error instanceof XlsxReadError, `round ${round}: only an XlsxReadError (got ${String(error)})`);
      refusals += 1;
    }
  }
  assert.ok(refusals > 0, 'some mutations are refused');
  console.log(`read.spec.ts: fuzz ${results} read, ${refusals} refused`);
}

function run() {
  sharedAndRichStrings();
  inlineFormulaBooleanError();
  gaps();
  dateStyles();
  sheetsAndNamespaces();
  refusals();
  limits();
  writerRoundTrip();
  libreOffice();
  fuzz();
  console.log('read.spec.ts: ok');
}

run();
