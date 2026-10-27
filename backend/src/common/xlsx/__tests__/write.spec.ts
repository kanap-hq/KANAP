import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import AdmZip = require('adm-zip');
import { writeXlsx, XLSX_CONTENT_TYPE, XLSX_MAX_TEXT_LENGTH, XlsxCell, XlsxSheet } from '../index';
import { readXlsxGrid } from '../read';

/** Rules of the common xlsx writer, read back from the XML, then a round trip through LibreOffice when it is installed. */

const text = (buffer: Buffer, part: string): string => new AdmZip(buffer).readAsText(part);
const sheetXml = (buffer: Buffer, index = 1): string => text(buffer, `xl/worksheets/sheet${index}.xml`);
const write = (sheets: XlsxSheet[], language: 'en' | 'fr' | 'de' | 'es' = 'en', appBaseUrl?: string | null): Buffer =>
  writeXlsx({ language, sheets, appBaseUrl });
const one = (rows: XlsxCell[][], headers = ['A', 'B'], extra: Partial<XlsxSheet> = {}): Buffer =>
  write([{ name: 'S', headers, rows, ...extra }]);
const cellOf = (xml: string, ref: string): string => {
  const match = xml.match(new RegExp(`<c r="${ref}"[^>]*>.*?</c>`, 's'));
  assert.ok(match, `cell ${ref} exists`);
  return match[0];
};

function types() {
  const xml = sheetXml(
    one([
      ['plain', { kind: 'number', value: 3.5 }],
      ['x', { kind: 'amount', value: '-1234.50' }],
      ['y', { kind: 'date', iso: '2026-09-15' }],
      ['z', null],
      ['p', { kind: 'percent', value: 0.125 }],
      ['', 'last'],
    ]),
  );
  assert.equal(cellOf(xml, 'A2'), '<c r="A2" t="inlineStr"><is><t xml:space="preserve">plain</t></is></c>', 'text is an inline string');
  assert.equal(cellOf(xml, 'B2'), '<c r="B2"><v>3.5</v></c>', 'number has no style');
  assert.equal(cellOf(xml, 'B3'), '<c r="B3" s="3"><v>-1234.50</v></c>', 'amount is its text, style 3');
  assert.equal(cellOf(xml, 'B4'), '<c r="B4" s="1"><v>46280</v></c>', 'date is a serial, style 1');
  assert.ok(!xml.includes('r="B5"'), 'null writes no cell');
  assert.equal(cellOf(xml, 'B6'), '<c r="B6" s="4"><v>0.125</v></c>', 'percent is the fraction, style 4');
  assert.ok(!xml.includes('r="A7"') && xml.includes('r="B7"'), 'an empty text writes no cell');
  // Before 1900-03-01 Excel's serials are wrong (its 1900-02-29) or negative: the day is text, in the language's format.
  const early = sheetXml(write([{ name: 'S', headers: ['A'], rows: [[{ kind: 'date', iso: '1900-02-28' }], [{ kind: 'date', iso: '1850-07-04' }], [{ kind: 'date', iso: '1900-03-01' }]] }], 'fr'));
  assert.equal(cellOf(early, 'A2'), '<c r="A2" t="inlineStr"><is><t xml:space="preserve">28/02/1900</t></is></c>', 'the day before the leap-year bug is text');
  assert.equal(cellOf(early, 'A3'), '<c r="A3" t="inlineStr"><is><t xml:space="preserve">04/07/1850</t></is></c>', 'a day before 1900 is text');
  assert.equal(cellOf(early, 'A4'), '<c r="A4" s="1"><v>61</v></c>', '1900-03-01 is serial 61');
  assert.ok(!/<c [^>]*s="[12]"[^>]*t="inlineStr"/.test(xml.replace(/<row r="1">.*?<\/row>/, '')), 'no text cell carries a style');
}

function styles() {
  const styled = text(one([[{ kind: 'amount', value: '1' }, { kind: 'date', iso: '2026-01-01' }]]), 'xl/styles.xml');
  assert.match(styled, /<cellXfs count="10">/);
  const xfs = [...styled.matchAll(/<xf numFmtId="(\d+)" fontId="(\d)"[^>]*\/>/g)].slice(1); // the first xf is cellStyleXfs
  assert.deepEqual(
    xfs.map((x) => [x[1], x[2]]),
    [['0', '0'], ['164', '0'], ['0', '1'], ['4', '0'], ['10', '0'], ['4', '1'], ['10', '1'], ['164', '1'], ['2', '0'], ['2', '1']],
    'indices: default, date, bold, amount, percent, then bold amount, percent and date of the footer, then the two-decimal number and its bold',
  );
  assert.ok(styled.includes('<font><b/><sz val="11"/><name val="Calibri"/></font>'), 'the bold font');
  for (const [language, format] of [['en', 'yyyy-mm-dd'], ['fr', '[$-40C]dd/mm/yyyy'], ['de', '[$-407]dd.mm.yyyy'], ['es', '[$-C0A]dd/mm/yyyy']] as const) {
    const out = text(write([{ name: 'S', headers: ['A'], rows: [[null]] }], language), 'xl/styles.xml');
    assert.ok(out.includes(`<numFmt numFmtId="164" formatCode="${format}"/>`), `${language} date format`);
  }
  // A plain sheet without amounts keeps the two styles the weekly report always had.
  const plain = text(write([{ name: 'S', headers: ['A'], rows: [['x']], header: 'plain' }]), 'xl/styles.xml');
  assert.match(plain, /<cellXfs count="2">/);
  assert.match(plain, /<fonts count="1">/);
  const plainAmount = text(write([{ name: 'S', headers: ['A'], rows: [[{ kind: 'amount', value: '1.5' }]], header: 'plain' }]), 'xl/styles.xml');
  assert.match(plainAmount, /<cellXfs count="10">/, 'an amount in a plain sheet brings the amount style');
  const plainPercent = text(write([{ name: 'S', headers: ['A'], rows: [[{ kind: 'percent', value: 0.5 }]], header: 'plain' }]), 'xl/styles.xml');
  assert.match(plainPercent, /<cellXfs count="10">.*<xf numFmtId="10" fontId="0"[^>]*\/>/s, 'a percent in a plain sheet brings the percent style');
}

/** A number marked `decimals: 2` keeps its value and shows `0.00` (style 8, bold 9 in a footer); others stay General. */
function decimals() {
  const buffer = write([{
    name: 'S',
    headers: ['FTE', 'Headcount'],
    rows: [[{ kind: 'number', value: 49 / 6, decimals: 2 }, { kind: 'number', value: 12 }]],
    footer: [[{ kind: 'number', value: 8.5, decimals: 2 }, { kind: 'number', value: 12 }]],
  }]);
  const xml = sheetXml(buffer);
  assert.equal(cellOf(xml, 'A2'), `<c r="A2" s="8"><v>${49 / 6}</v></c>`, 'the value is kept whole, style 8');
  assert.equal(cellOf(xml, 'B2'), '<c r="B2"><v>12</v></c>', 'an integer column stays General');
  assert.equal(cellOf(xml, 'A3'), '<c r="A3" s="9"><v>8.5</v></c>', 'bold two-decimal footer');
  assert.equal(cellOf(xml, 'B3'), '<c r="B3" s="2"><v>12</v></c>', 'bold General footer');
  assert.match(text(buffer, 'xl/styles.xml'), /<xf numFmtId="2" fontId="0"[^>]*\/><xf numFmtId="2" fontId="1"[^>]*\/><\/cellXfs>/);
  const plain = write([{ name: 'S', headers: ['A'], rows: [[{ kind: 'number', value: 1.25, decimals: 2 }]], header: 'plain' }]);
  assert.match(text(plain, 'xl/styles.xml'), /<cellXfs count="10">/, 'a two-decimal number in a plain sheet brings the extra styles');
}

/** Total rows: bold, after the data rows, outside the filter, so a sort or a filter in the spreadsheet never moves them. */
function footer() {
  const buffer = write([{
    name: 'S',
    headers: ['Name', 'Days', 'Amount', 'Share', 'Day'],
    rows: [
      ['a', { kind: 'number', value: 1 }, { kind: 'amount', value: '10.00' }, { kind: 'percent', value: 0.25 }, { kind: 'date', iso: '2026-01-01' }],
      ['b', { kind: 'number', value: 3 }, { kind: 'amount', value: '30.00' }, { kind: 'percent', value: 0.75 }, null],
    ],
    footer: [['Total', { kind: 'number', value: 4 }, { kind: 'amount', value: '40.00' }, { kind: 'percent', value: 1 }, { kind: 'date', iso: '2026-12-31' }]],
    links: ['/budget/1', '/budget/2'],
  }]);
  const xml = sheetXml(buffer);
  assert.ok(xml.includes('<autoFilter ref="A1:E3"/>'), 'the filter covers the header and the data rows only');
  assert.match(text(buffer, 'xl/workbook.xml'), /<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">&apos;S&apos;!\$A\$1:\$E\$3<\/definedName>/);
  assert.equal(cellOf(xml, 'A4'), '<c r="A4" s="2" t="inlineStr"><is><t xml:space="preserve">Total</t></is></c>', 'bold text');
  assert.equal(cellOf(xml, 'B4'), '<c r="B4" s="2"><v>4</v></c>', 'bold number');
  assert.equal(cellOf(xml, 'C4'), '<c r="C4" s="5"><v>40.00</v></c>', 'bold amount');
  assert.equal(cellOf(xml, 'D4'), '<c r="D4" s="6"><v>1</v></c>', 'bold percent');
  assert.equal(cellOf(xml, 'E4'), '<c r="E4" s="7"><v>46387</v></c>', 'bold date');
  assert.equal(cellOf(xml, 'C2'), '<c r="C2" s="3"><v>10.00</v></c>', 'data rows keep their styles');
  assert.equal((xml.match(/<hyperlink /g) ?? []).length, 2, 'the footer carries no link');
  // A footer alone in a plain sheet brings the bold styles.
  const plain = write([{ name: 'S', headers: ['A'], rows: [['x']], footer: [['Total']], header: 'plain' }]);
  assert.match(text(plain, 'xl/styles.xml'), /<cellXfs count="10">/);
  assert.ok(!sheetXml(plain).includes('autoFilter'));
  assert.throws(() => write([{ name: 'S', headers: ['A', 'B'], rows: [], footer: [['Total']] }]), /row 1 has 1 cells for 2 headers/);
}

function styledHeader() {
  const medium = 'a much longer text than the header is';
  const buffer = one(
    [
      ['short', medium],
      ['x'.repeat(200), { kind: 'amount', value: '1' }],
    ],
    ['Name', 'Value'],
  );
  const xml = sheetXml(buffer);
  assert.ok(cellOf(xml, 'A1').includes(' s="2"') && cellOf(xml, 'B1').includes(' s="2"'), 'bold header');
  assert.ok(
    xml.includes('<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'),
    'frozen first row',
  );
  assert.ok(xml.includes('<autoFilter ref="A1:B3"/>'), 'filter over the used range');
  assert.ok(text(buffer, 'xl/workbook.xml').includes('<definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">&apos;S&apos;!$A$1:$B$3</definedName>'), 'filter defined name');
  // Element order: sheetViews, cols, sheetData, autoFilter, hyperlinks.
  const order = ['<sheetViews>', '<cols>', '<sheetData>', '<autoFilter', '<hyperlinks>'];
  const withLinks = sheetXml(one([['a', 'b']], ['A', 'B'], { links: ['/x'] }));
  const positions = order.map((tag) => withLinks.indexOf(tag));
  assert.ok(positions.every((p) => p >= 0) && [...positions].sort((a, b) => a - b).join() === positions.join(), 'element order');

  // Widths: header and first 1,000 cells, +2, min 8, max 60; amounts at least 14, dates at least 12.
  assert.ok(xml.includes('<col min="1" max="1" width="60" customWidth="1"/>'), 'max 60');
  assert.ok(xml.includes(`<col min="2" max="2" width="${medium.length + 2}" customWidth="1"/>`), 'longest cell + 2');
  const narrow = sheetXml(one([['a', { kind: 'amount', value: '1' }, { kind: 'date', iso: '2026-01-01' }]], ['N', 'Amount', 'D']));
  assert.ok(narrow.includes('<col min="1" max="1" width="8" customWidth="1"/>'), 'min 8');
  assert.ok(narrow.includes('<col min="2" max="2" width="14" customWidth="1"/>'), 'amount at least 14');
  assert.ok(narrow.includes('<col min="3" max="3" width="12" customWidth="1"/>'), 'date at least 12');
  const late = Array.from({ length: 1200 }, (_, i) => [i === 1100 ? 'z'.repeat(40) : 'a', 'b']);
  assert.ok(sheetXml(one(late)).includes('<col min="1" max="1" width="8" customWidth="1"/>'), 'only the first 1,000 rows are measured');
  const lines = sheetXml(one([['ab\n' + 'c'.repeat(20) + '\nd', 'x']]));
  assert.ok(lines.includes('<col min="1" max="1" width="22" customWidth="1"/>'), 'a multi-line cell is as wide as its longest line');

  // Header only: still a valid sheet, filter on the header row.
  const empty = one([], ['A', 'B', 'C']);
  assert.ok(sheetXml(empty).includes('<autoFilter ref="A1:C1"/>') && sheetXml(empty).includes('<row r="1">'), 'header-only sheet');
}

function plainHeader() {
  const xml = sheetXml(
    write([{ name: 'S', headers: ['A', 'D'], rows: [['x', { kind: 'date', iso: '2026-01-01' }]], header: 'plain' }]),
  );
  assert.ok(!xml.includes('sheetViews') && !xml.includes('autoFilter') && !xml.includes(' s="2"'), 'no pane, no filter, no bold');
  assert.ok(xml.includes('<cols><col min="2" max="2" width="12" customWidth="1"/></cols>'), 'only the date columns are sized');
  assert.ok(!sheetXml(write([{ name: 'S', headers: ['A'], rows: [['x']], header: 'plain' }])).includes('<cols>'), 'no columns when no date');
  assert.ok(!text(write([{ name: 'S', headers: ['A'], rows: [['x']], header: 'plain' }]), 'xl/workbook.xml').includes('definedName'));
}

function characters() {
  const dirty = 'a\u0000b\u0001c\u000bd\u000ce\u001ff￾g￿h\uD800i\uDC00j';
  const xml = sheetXml(one([[dirty, 'ok']]));
  assert.ok(xml.includes('>abcdefghij</t>'), 'forbidden characters and lone surrogates are stripped');
  assert.ok(sheetXml(one([['pair \u{1F600} kept', 'x']])).includes('pair \u{1F600} kept'), 'a valid surrogate pair stays');
  const kept = sheetXml(one([['Café – “crème”\nsecond\r\nthird\ttab', 'x']]));
  assert.ok(kept.includes('Café – “crème”\nsecond\r\nthird\ttab'), 'accents, line breaks and tabs stay');
  assert.ok(sheetXml(one([['a & <b> "c" \'d\'', 'x']])).includes('a &amp; &lt;b&gt; &quot;c&quot; &apos;d&apos;'), 'XML escaping');
  const long = sheetXml(one([['a'.repeat(40_000), 'x']]));
  const body = long.match(/<c r="A2"[^>]*><is><t xml:space="preserve">(a+)<\/t>/);
  assert.ok(body && body[1].length === XLSX_MAX_TEXT_LENGTH && XLSX_MAX_TEXT_LENGTH === 32_767, 'cut at 32,767 characters');
  const pairCut = sheetXml(one([['a'.repeat(32_766) + '\u{1F600}', 'x']]));
  assert.ok(!/[\uD800-\uDBFF]<\/t>/.test(pairCut), 'a surrogate pair cut in two leaves no lone surrogate');

  // A literal `_xHHHH_` is escaped (OOXML: `_x005F_` is `_`), so it reads back as written, in a cell and a header.
  const escapes = one([['_x0041_ and _x000D_', 'a_x12_b _xZZZZ_ _x0041']], ['_x0041_', 'B']);
  const escapedXml = sheetXml(escapes);
  assert.ok(escapedXml.includes('>_x005F_x0041_ and _x005F_x000D_</t>'), 'the _x of _xHHHH_ is written _x005F_x');
  assert.ok(escapedXml.includes('>a_x12_b _xZZZZ_ _x0041</t>'), 'text that is no escape is written as is');
  assert.deepEqual(readXlsxGrid(escapes).rows, [
    [{ kind: 'text', value: '_x0041_' }, { kind: 'text', value: 'B' }],
    [{ kind: 'text', value: '_x0041_ and _x000D_' }, { kind: 'text', value: 'a_x12_b _xZZZZ_ _x0041' }],
  ]);
}

function formulaGuard() {
  const xml = sheetXml(one([['=SUM(A1)', '+1'], ['-x', '@a'], ['-12.50', '-3'], ['\t=1', ' =1'], ['safe', 'a=b']]));
  assert.ok(cellOf(xml, 'A2').includes('>&apos;=SUM(A1)<'), '=SUM(A1) guarded');
  assert.ok(cellOf(xml, 'B2').includes('>&apos;+1<'), '+1 guarded');
  assert.ok(cellOf(xml, 'A3').includes('>&apos;-x<'), '-x guarded');
  assert.ok(cellOf(xml, 'B3').includes('>&apos;@a<'), '@a guarded');
  assert.ok(cellOf(xml, 'A4').includes('>-12.50<') && cellOf(xml, 'B4').includes('>-3<'), 'a plain negative number is left as it is');
  assert.ok(cellOf(xml, 'A5').includes('>&apos;\t=1<') && cellOf(xml, 'B5').includes('>&apos; =1<'), 'tab or spaces before the trigger');
  assert.ok(cellOf(xml, 'A6').includes('>safe<') && cellOf(xml, 'B6').includes('>a=b<'), 'other text untouched');
  const header = sheetXml(one([], ['=H', '-h']));
  assert.ok(header.includes('>=H<') && header.includes('>-h<'), 'headers are not guarded');
  const plain = sheetXml(write([{ name: 'S', headers: ['A'], rows: [['=SUM(A1)']], header: 'plain' }]));
  assert.ok(plain.includes('>=SUM(A1)<'), 'a plain sheet keeps its text as is');
  const amount = sheetXml(one([['x', { kind: 'amount', value: '-5.25' }]]));
  assert.ok(cellOf(amount, 'B2') === '<c r="B2" s="3"><v>-5.25</v></c>', 'a negative amount stays a number');
}

function sheetNames() {
  const mk = (name: string): XlsxSheet => ({ name, headers: ['A'], rows: [] });
  const names = (sheets: string[]): string[] =>
    [...text(write(sheets.map(mk)), 'xl/workbook.xml').matchAll(/<sheet name="([^"]*)"/g)].map((m) => m[1].replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
  assert.deepEqual(names(['a[b]c:d*e?f/g\\h']), ['a-b-c-d-e-f-g-h'], 'forbidden characters replaced');
  assert.deepEqual(names(['x'.repeat(50)]), ['x'.repeat(31)], '31 characters at most');
  assert.deepEqual(names(["'quoted'"]), ['quoted'], 'no apostrophe at the ends');
  assert.deepEqual(names(['', '   ']), ['Sheet', 'Sheet (2)'], 'empty names and duplicates');
  assert.deepEqual(names(['Budget', 'budget', 'BUDGET']), ['Budget', 'budget (2)', 'BUDGET (3)'], 'unique without regard to case');
  const long = names(['y'.repeat(40), 'y'.repeat(40)]);
  assert.equal(long[1].length, 31, 'a suffixed name still fits 31 characters');
  assert.equal(new Set(long.map((n) => n.toLowerCase())).size, 2);
  assert.deepEqual(names(['Tâches & co']), ['Tâches & co'], 'accents and ampersand kept');
  // A cut through a surrogate pair, a lone surrogate or a character XML forbids: removed, the name stays valid XML.
  const emoji = names(['x'.repeat(30) + '😀z', 'a\uD800b\uFFFEc', 'y'.repeat(28) + '😀😀', 'y'.repeat(28) + '😀😀']);
  assert.deepEqual(emoji, ['x'.repeat(30), 'abc', 'y'.repeat(28) + '😀', 'y'.repeat(27) + ' (2)']);
  assert.ok(!/[\uD800-\uDFFF]/.test(emoji.join('').replace(/😀/g, '')), 'no lone surrogate');
}

function validation() {
  assert.throws(() => one([['a', { kind: 'amount', value: '1,50' }]]), /not a decimal amount/);
  for (const bad of ['', '1e5', '+1', '1.', '.5', ' 1', '1 ', 'NaN', '--1']) {
    assert.throws(() => one([['a', { kind: 'amount', value: bad }]]), /not a decimal amount/, `amount "${bad}" refused`);
  }
  for (const good of ['0', '-0.5', '007', '1234567890123456789.123456789']) {
    assert.ok(sheetXml(one([['a', { kind: 'amount', value: good }]])).includes(`<v>${good}</v>`), `amount "${good}" written as is`);
  }
  assert.throws(() => one([['a', { kind: 'number', value: NaN }]]), /finite/);
  assert.throws(() => one([['a', { kind: 'number', value: Infinity }]]), /finite/);
  assert.throws(() => one([['a', { kind: 'percent', value: NaN }]]), /percent cell needs a finite number/);
  assert.throws(() => one([['a', { kind: 'percent', value: '0.5' as unknown as number }]]), /percent cell needs a finite number/);
  assert.throws(() => one([['a', { kind: 'date', iso: '2026-02-30' }]]), /calendar day/);
  assert.throws(() => one([['a', { kind: 'date', iso: '15/09/2026' }]]), /calendar day/);
  assert.throws(() => one([['only one']]), /1 cells for 2 headers/, 'a short row throws');
  assert.throws(() => one([['a', 'b', 'c']]), /3 cells for 2 headers/, 'a long row throws');
  assert.throws(() => one([['a', 'b']], ['A', 'B'], { links: [] }), /1 rows and 0 links/);
  // Excel's limits: no sheet, more rows than a sheet holds below its header, more columns than it has.
  assert.throws(() => write([]), /at least one sheet/);
  const fullRows = new Array(1_048_575).fill(['a']);
  assert.throws(() => write([{ name: 'S', headers: ['A'], rows: [...fullRows, ['a']] }]), /1048576 rows, 1048575 at most/);
  assert.throws(() => write([{ name: 'S', headers: Array.from({ length: 16_385 }, (_, i) => `H${i}`), rows: [] }]), /16385 columns, 16384 at most/);
  assert.ok(sheetXml(write([{ name: 'S', headers: Array.from({ length: 16_384 }, (_, i) => `H${i}`), rows: [] }])).includes('<c r="XFD1"'), '16,384 columns fit');
}

function linksAndParts() {
  const buffer = write(
    [{ name: 'S', headers: ['A', 'B', 'C'], rows: [['a', 'b', 'c'], ['a', 'b', 'c'], ['a', 'b', 'c']], links: ['/budget/1?x=1&y=2', null, 'https://other.example.com/z'], linkColumn: 3 }],
    'en',
    ' https://app.example.com/ ',
  );
  const xml = sheetXml(buffer);
  assert.ok(xml.includes('<hyperlinks><hyperlink ref="C2" r:id="rId1"/><hyperlink ref="C4" r:id="rId2"/></hyperlinks>'), 'links on the 3rd column, none for null');
  const rels = text(buffer, 'xl/worksheets/_rels/sheet1.xml.rels');
  assert.ok(rels.includes('Target="https://app.example.com/budget/1?x=1&amp;y=2" TargetMode="External"'), 'app base put in front, URL escaped');
  const noBase = text(write([{ name: 'S', headers: ['A', 'B'], rows: [['a', 'b']], links: ['/p/1'] }]), 'xl/worksheets/_rels/sheet1.xml.rels');
  assert.ok(noBase.includes('Target="/p/1"'), 'no base: the path as is');
  assert.ok(!sheetXml(one([['a', 'b']])).includes('hyperlinks') && !new AdmZip(one([['a', 'b']])).getEntry('xl/worksheets/_rels/sheet1.xml.rels'), 'no links, no part');
  assert.ok(xml.includes('<hyperlink ref="C2"') && sheetXml(write([{ name: 'S', headers: ['A', 'B'], rows: [['a', 'b']], links: ['/p'] }])).includes('ref="B2"'), 'default link column is 2');

  // An absolute link keeps its own host; the target is URI-encoded, an existing %xx kept.
  assert.ok(rels.includes('Target="https://other.example.com/z"'), 'no base in front of an absolute link');
  const encoded = text(
    write([{ name: 'S', headers: ['A', 'B'], rows: [['a', 'b'], ['a', 'b']], links: ['/docs/Café plan', 'https://x.example/a%20b c'] }], 'en', 'https://app.example.com'),
    'xl/worksheets/_rels/sheet1.xml.rels',
  );
  assert.ok(encoded.includes('Target="https://app.example.com/docs/Caf%C3%A9%20plan"'), 'space and accent encoded');
  assert.ok(encoded.includes('Target="https://x.example/a%20b%20c"'), 'an existing %20 is not encoded twice');

  // Excel's limits: a target over 2,079 characters, or a link past 65,530 in a sheet, is left out; the cell stays.
  const long = '/p/' + 'x'.repeat(2079 - 3);
  const tooLong = write([{ name: 'S', headers: ['A', 'B'], rows: [['a', 'b'], ['a', 'b']], links: [long, `${long}y`] }]);
  assert.ok(sheetXml(tooLong).includes('<hyperlinks><hyperlink ref="B2" r:id="rId1"/></hyperlinks>'), 'only the link within 2,079 characters');
  assert.ok(sheetXml(tooLong).includes('<c r="B3" t="inlineStr">'), 'the cell of a dropped link stays');
  const count = 65_531;
  const many = write([{ name: 'S', headers: ['A'], rows: Array.from({ length: count }, () => ['a']), links: Array.from({ length: count }, (_, i) => `/p/${i}`), linkColumn: 1 }]);
  const manyXml = sheetXml(many);
  assert.equal((manyXml.match(/<hyperlink /g) ?? []).length, 65_530, '65,530 links at most');
  assert.ok(manyXml.includes(`<c r="A${count + 1}" t="inlineStr">`) && !manyXml.includes(`<hyperlink ref="A${count + 1}"`), 'the row past the limit keeps its cell');

  const parts = new AdmZip(write([{ name: 'S1', headers: ['A'], rows: [] }, { name: 'S2', headers: ['A'], rows: [] }]))
    .getEntries().map((e) => e.entryName).sort();
  assert.deepEqual(parts, [
    '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml',
  ].sort());
  assert.equal(XLSX_CONTENT_TYPE, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}

function libreOffice() {
  const which = spawnSync('which', ['soffice'], { encoding: 'utf8' });
  if (which.status !== 0) {
    console.log('write.spec.ts: LibreOffice round trip skipped (soffice not installed)');
    return;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xlsx-write-'));
  try {
    const file = path.join(dir, 'book.xlsx');
    const convert = (language: 'en' | 'fr' | 'de' | 'es'): string => {
      const buffer = write(
        [
          {
            name: 'Data',
            headers: ['Name', 'Days', 'Amount', 'Day', 'Formula', 'Note', 'Share'],
            rows: [
              ['Alpha', { kind: 'number', value: 3.5 }, { kind: 'amount', value: '-1234.50' }, { kind: 'date', iso: '2026-09-15' }, '=SUM(A1)', 'Café "x"', { kind: 'percent', value: 0.125 }],
              ['Beta', { kind: 'number', value: 0 }, { kind: 'amount', value: '1234567.05' }, null, '+1', 'é', { kind: 'percent', value: -0.0325 }],
            ],
          },
          { name: 'Empty', headers: ['A'], rows: [] },
        ],
        language,
      );
      fs.writeFileSync(file, buffer);
      const out = path.join(dir, `out-${language}`);
      // Comma, double quote, UTF-8, first line 1, text cells quoted, numbers as shown, every sheet to its own file.
      const run = spawnSync(
        'soffice',
        [
          `-env:UserInstallation=file://${path.join(dir, 'profile')}`,
          '--headless',
          '--convert-to',
          'csv:Text - txt - csv (StarCalc):44,34,76,1,,0,true,true,false,false,false,-1',
          '--outdir',
          out,
          file,
        ],
        { encoding: 'utf8', timeout: 120_000 },
      );
      assert.equal(run.status, 0, `soffice exits 0 (${run.stderr})`);
      assert.ok(fs.existsSync(path.join(out, 'book-Data.csv')) && fs.existsSync(path.join(out, 'book-Empty.csv')), 'one CSV per sheet');
      assert.equal(fs.readFileSync(path.join(out, 'book-Empty.csv'), 'utf8').trim(), '"A"', 'the header-only sheet opens');
      return fs.readFileSync(path.join(out, 'book-Data.csv'), 'utf8');
    };
    const csv = convert('fr');
    assert.ok(csv.startsWith('"Name","Days","Amount","Day","Formula","Note","Share"'), 'LibreOffice reads the headers');
    assert.ok(csv.includes('"Alpha",3.5,-1234.5,15/09/2026,"\'=SUM(A1)","Café ""x""",12.5%'), `numbers are numbers (no quote), the date is in the French format, the formula is text, the share a percentage: ${csv}`);
    assert.ok(csv.includes('"Beta",0,1234567.05,,"\'+1","é",-3.25%'), 'second row: zero, long amount, empty date, guarded +1, negative share');
    assert.ok(convert('en').includes(',2026-09-15,'), 'English: ISO day');
    assert.ok(convert('de').includes(',15.09.2026,'), 'German: dd.mm.yyyy');
    assert.ok(convert('es').includes(',15/09/2026,'), 'Spanish: dd/mm/yyyy');
    console.log('write.spec.ts: LibreOffice round trip ok');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

function run() {
  types();
  styles();
  footer();
  decimals();
  styledHeader();
  plainHeader();
  characters();
  formulaGuard();
  sheetNames();
  validation();
  linksAndParts();
  libreOffice();
  console.log('write.spec.ts: ok');
}

run();
