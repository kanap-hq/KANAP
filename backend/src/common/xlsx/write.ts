import AdmZip = require('adm-zip');
import { neutralizeCsvFormulaValue } from '../csv/csv-export.service';
import { formatCsvDate } from '../csv-sheet/date';
import type { CsvLanguage } from '../csv-sheet/types';

/**
 * The common .xlsx writer: workbooks built from plain data, with no spreadsheet library.
 * Text goes in inline strings, amounts are written as the decimal text they arrive in (never through a
 * float), days are date cells in the language's format.
 */

export const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type XlsxCell =
  /** Text. */
  | string
  /** A general number (days, counts). */
  | { kind: 'number'; value: number }
  /** A decimal written as text, such as `-1234.50`, stored as is in the cell. */
  | { kind: 'amount'; value: string }
  /** A calendar day, `YYYY-MM-DD`. A day before 1900-03-01 is written as text in the language's format. */
  | { kind: 'date'; iso: string }
  /** An empty cell: nothing is written. */
  | null;

export interface XlsxSheet {
  /** Sanitised: 31 characters at most, none of `[]:*?/\`, unique in the workbook. */
  name: string;
  headers: readonly string[];
  rows: readonly (readonly XlsxCell[])[];
  /** `styled` (default): bold header, frozen first row, filter and column widths. `plain`: the header is a row of text. */
  header?: 'styled' | 'plain';
  /**
   * One link per row (or `null`), written on `linkColumn`. An app path such as `/budget/3`: `appBaseUrl` is put in
   * front when given; an absolute link is kept. A target over XLSX_MAX_LINK_LENGTH, or past XLSX_MAX_LINKS_PER_SHEET
   * links, is left out.
   */
  links?: readonly (string | null)[];
  /** 1-based column that carries the row link. Default 2. */
  linkColumn?: number;
}

export interface XlsxWriteRequest {
  language: CsvLanguage;
  sheets: readonly XlsxSheet[];
  appBaseUrl?: string | null;
}

/** Excel's limit for the text of one cell. */
export const XLSX_MAX_TEXT_LENGTH = 32_767;
/** Excel's limit for the target of a link: a longer one is left out (the cell stays). */
export const XLSX_MAX_LINK_LENGTH = 2_079;
/** Excel's limit for the links of one sheet: the rows after it keep their cells, without link. */
export const XLSX_MAX_LINKS_PER_SHEET = 65_530;

/**
 * The XLSX date format of each language, the way the CSV writes days. The locale tag keeps
 * the day first: without it, LibreOffice shows `dd/mm/yyyy` in its own locale's order.
 */
const XLSX_DATE_FORMAT: Record<CsvLanguage, string> = {
  en: 'yyyy-mm-dd',
  fr: '[$-40C]dd/mm/yyyy',
  de: '[$-407]dd.mm.yyyy',
  es: '[$-C0A]dd/mm/yyyy',
};

/** Indices of `cellXfs` in `xl/styles.xml`. 0 and 1 are what the weekly report has always had. */
const STYLE_DATE = 1;
const STYLE_BOLD = 2;
const STYLE_AMOUNT = 3;

const XML_HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' };
const AMOUNT_TEXT = /^-?\d+(\.\d+)?$/;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
// Characters XML 1.0 forbids, and surrogates that have no pair.
const XML_FORBIDDEN =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
const SHEET_NAME_FORBIDDEN = /[\[\]:*?/\\\u0000-\u001F]/g;

/**
 * The first day written as a date cell. Excel counts 1900-02-29, which never existed, so its serials
 * before this day are off by one, and it has no serial before 1900.
 */
const FIRST_SERIAL_DAY = '1900-03-01';

const WIDTH_SAMPLE_ROWS = 1000;
const WIDTH_MIN = 8;
const WIDTH_MAX = 60;
const WIDTH_DATE_MIN = 12;
const WIDTH_AMOUNT_MIN = 14;

const xmlEscape = (value: string): string => value.replace(/[&<>"']/g, (char) => XML_ESCAPES[char]);

export function columnNumberToName(columnNumber: number): string {
  let num = columnNumber;
  let name = '';
  while (num > 0) {
    const remainder = (num - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    num = Math.floor((num - 1) / 26);
  }
  return name;
}

/** Days since 1899-12-30: how a spreadsheet stores a date. */
export function daySerial(iso: string): number {
  const time = ISO_DAY.test(iso) ? Date.parse(`${iso}T00:00:00Z`) : NaN;
  if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== iso) {
    throw new Error(`xlsx: "${iso}" is not a calendar day (YYYY-MM-DD)`);
  }
  return (time - Date.UTC(1899, 11, 30)) / 86_400_000;
}

/**
 * The target of a row link: an app path (`/budget/3`) gets `appBaseUrl` in front, an absolute
 * link is kept. The result is URI-encoded (spaces, accents), an existing `%xx` left as is.
 */
function linkTarget(link: string, appBaseUrl: string): string {
  const raw = (appBaseUrl && link.startsWith('/') ? `${appBaseUrl}${link}` : link).replace(XML_FORBIDDEN, '');
  return raw
    .split(/(%[0-9A-Fa-f]{2})/)
    .map((part) => (/^%[0-9A-Fa-f]{2}$/.test(part) ? part : encodeURI(part)))
    .join('');
}

/** Text safe for a cell: no character XML forbids, at most 32,767 characters. */
function cellText(text: string): string {
  let out = text.replace(XML_FORBIDDEN, '');
  if (out.length > XLSX_MAX_TEXT_LENGTH) {
    out = out.slice(0, XLSX_MAX_TEXT_LENGTH).replace(XML_FORBIDDEN, '');
  }
  return out;
}

/** A sheet name Excel accepts, unique (without regard to case) among the names already taken. */
function sheetName(raw: string, taken: Set<string>): string {
  // A cut can split a surrogate pair: what XML forbids is removed after it.
  const cut = (text: string, length: number): string => text.slice(0, length).replace(XML_FORBIDDEN, '');
  let base = String(raw ?? '').replace(SHEET_NAME_FORBIDDEN, '-').trim().replace(/^'+|'+$/g, '').trim();
  base = cut(base, 31).trim();
  if (!base) base = 'Sheet';
  let name = base;
  for (let attempt = 2; taken.has(name.toLowerCase()); attempt += 1) {
    const suffix = ` (${attempt})`;
    name = `${cut(base, 31 - suffix.length).trimEnd()}${suffix}`;
  }
  taken.add(name.toLowerCase());
  return name;
}

interface BuiltSheet {
  name: string;
  xml: Buffer;
  relsXml: string | null;
  /** `A1:Xn` of the filter, for the workbook's defined name. */
  filterRange: string | null;
  usesExtraStyles: boolean;
}

function buildSheet(sheet: XlsxSheet, name: string, appBaseUrl: string, language: CsvLanguage): BuiltSheet {
  const styled = (sheet.header ?? 'styled') === 'styled';
  const columns = sheet.headers.length;
  const names: string[] = [];
  for (let column = 1; column <= columns; column += 1) names.push(columnNumberToName(column));
  if (sheet.links && sheet.links.length !== sheet.rows.length) {
    throw new Error(`xlsx: sheet "${name}" has ${sheet.rows.length} rows and ${sheet.links.length} links`);
  }
  const linkColumn = sheet.linkColumn ?? 2;
  if (!Number.isInteger(linkColumn) || linkColumn < 1) throw new Error(`xlsx: sheet "${name}": linkColumn must be 1 or more`);
  const linkColumnName = columnNumberToName(linkColumn);

  let usesAmount = false;
  const dateColumns = new Set<number>();
  const amountColumns = new Set<number>();
  const widths: number[] = sheet.headers.map((header) => longestLine(header));

  const textCell = (ref: string, text: string, guard: boolean): string => {
    const value = cellText(guard ? neutralizeCsvFormulaValue(text) : text);
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  };

  const headerStyle = styled ? ` s="${STYLE_BOLD}"` : '';
  const headerCells: string[] = [];
  sheet.headers.forEach((header, index) => {
    if (header === '' || header === null || header === undefined) return;
    const ref = `${names[index]}1`;
    const value = cellText(String(header));
    headerCells.push(`<c r="${ref}"${headerStyle} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`);
  });

  // Each row is turned into bytes as soon as it is built: the sheet is never held as one large string.
  const rowBuffers: Buffer[] = [Buffer.from(`<row r="1">${headerCells.join('')}</row>`, 'utf8')];
  const hyperlinks: string[] = [];
  const hyperlinkRels: string[] = [];

  sheet.rows.forEach((row, rowIndex) => {
    if (row.length !== columns) {
      throw new Error(`xlsx: sheet "${name}" row ${rowIndex + 1} has ${row.length} cells for ${columns} headers`);
    }
    const rowNumber = rowIndex + 2;
    const sample = rowIndex < WIDTH_SAMPLE_ROWS;
    const cells: string[] = [];
    for (let index = 0; index < columns; index += 1) {
      const cell = row[index];
      if (cell === null || cell === undefined || cell === '') continue;
      const ref = `${names[index]}${rowNumber}`;
      if (typeof cell === 'string') {
        cells.push(textCell(ref, cell, styled));
        if (sample) widths[index] = Math.max(widths[index], longestLine(cell));
      } else if (cell.kind === 'number') {
        if (typeof cell.value !== 'number' || !Number.isFinite(cell.value)) {
          throw new Error(`xlsx: sheet "${name}" ${ref}: a number cell needs a finite number`);
        }
        cells.push(`<c r="${ref}"><v>${cell.value}</v></c>`);
        if (sample) widths[index] = Math.max(widths[index], String(cell.value).length);
      } else if (cell.kind === 'amount') {
        if (typeof cell.value !== 'string' || !AMOUNT_TEXT.test(cell.value)) {
          throw new Error(`xlsx: sheet "${name}" ${ref}: "${String(cell.value)}" is not a decimal amount`);
        }
        cells.push(`<c r="${ref}" s="${STYLE_AMOUNT}"><v>${cell.value}</v></c>`);
        amountColumns.add(index + 1);
        usesAmount = true;
        if (sample) widths[index] = Math.max(widths[index], cell.value.length + Math.floor(cell.value.length / 3));
      } else if (cell.kind === 'date') {
        const serial = daySerial(cell.iso);
        if (cell.iso < FIRST_SERIAL_DAY) cells.push(textCell(ref, formatCsvDate(cell.iso, language), false));
        else cells.push(`<c r="${ref}" s="${STYLE_DATE}"><v>${serial}</v></c>`);
        dateColumns.add(index + 1);
      } else {
        throw new Error(`xlsx: sheet "${name}" ${ref}: unknown cell kind`);
      }
    }

    const link = sheet.links?.[rowIndex];
    const target = link ? linkTarget(link, appBaseUrl) : '';
    if (target && target.length <= XLSX_MAX_LINK_LENGTH && hyperlinks.length < XLSX_MAX_LINKS_PER_SHEET) {
      const relId = `rId${hyperlinkRels.length + 1}`;
      hyperlinks.push(`<hyperlink ref="${linkColumnName}${rowNumber}" r:id="${relId}"/>`);
      hyperlinkRels.push(
        `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(target)}" TargetMode="External"/>`,
      );
    }
    rowBuffers.push(Buffer.from(`\n    <row r="${rowNumber}">${cells.join('')}</row>`, 'utf8'));
  });

  const hyperlinksXml = hyperlinks.length > 0 ? `<hyperlinks>${hyperlinks.join('')}</hyperlinks>` : '';
  let xml: Buffer;
  let filterRange: string | null = null;

  if (!styled) {
    // Exactly what the weekly report has always written: only the date columns are sized.
    const dateColumnsXml =
      dateColumns.size > 0
        ? `<cols>${[...dateColumns]
            .sort((a, b) => a - b)
            .map((column) => `<col min="${column}" max="${column}" width="${WIDTH_DATE_MIN}" customWidth="1"/>`)
            .join('')}</cols>`
        : '';
    xml = Buffer.concat([
      Buffer.from(
        [
          XML_HEAD,
          '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
          `  ${dateColumnsXml}`,
          '  <sheetData>',
          '    ',
        ].join('\n'),
        'utf8',
      ),
      ...rowBuffers,
      Buffer.from(['', '  </sheetData>', `  ${hyperlinksXml}`, '</worksheet>'].join('\n'), 'utf8'),
    ]);
  } else {
    const colsXml = widths
      .map((measured, index) => {
        const column = index + 1;
        let width = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, measured + 2));
        if (dateColumns.has(column)) width = Math.max(width, WIDTH_DATE_MIN);
        if (amountColumns.has(column)) width = Math.max(width, WIDTH_AMOUNT_MIN);
        return `<col min="${column}" max="${column}" width="${width}" customWidth="1"/>`;
      })
      .join('');
    filterRange = columns > 0 ? `A1:${names[columns - 1]}${sheet.rows.length + 1}` : null;
    const parts = [
      XML_HEAD,
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
      '  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
    ];
    if (columns > 0) parts.push(`  <cols>${colsXml}</cols>`);
    parts.push('  <sheetData>', '    ');
    const tail = ['', '  </sheetData>'];
    if (filterRange) tail.push(`  <autoFilter ref="${filterRange}"/>`);
    if (hyperlinksXml) tail.push(`  ${hyperlinksXml}`);
    tail.push('</worksheet>');
    xml = Buffer.concat([Buffer.from(parts.join('\n'), 'utf8'), ...rowBuffers, Buffer.from(tail.join('\n'), 'utf8')]);
  }

  const relsXml =
    hyperlinkRels.length > 0
      ? `${XML_HEAD}\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  ${hyperlinkRels.join('\n  ')}\n</Relationships>`
      : null;

  return { name, xml, relsXml, filterRange, usesExtraStyles: styled || usesAmount };
}

/** Characters of the longest line: a cell with line breaks is as wide as its widest line. */
function longestLine(value: string): number {
  if (!value.includes('\n')) return value.length;
  return value.split(/\r?\n/).reduce((max, line) => Math.max(max, line.length), 0);
}

/** Writes a workbook: one sheet per entry, in order. A row whose length differs from the headers throws. */
export function writeXlsx(request: XlsxWriteRequest): Buffer {
  const { language, sheets } = request;
  const appBaseUrl = String(request.appBaseUrl || '').trim().replace(/\/$/, '');
  const taken = new Set<string>();
  const built = sheets.map((sheet) => buildSheet(sheet, sheetName(sheet.name, taken), appBaseUrl, language));
  const extraStyles = built.some((sheet) => sheet.usesExtraStyles);

  const sheetOverrides = built
    .map(
      (_, index) =>
        `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    )
    .join('\n  ');

  const contentTypesXml = `${XML_HEAD}
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  ${sheetOverrides}
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`;

  const rootRelsXml = `${XML_HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookSheetsXml = built
    .map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('\n    ');

  // Excel keeps a sheet's filter in a hidden defined name as well; the filter works without it, but this is how Excel writes it.
  const filterNames = built
    .map((sheet, index) =>
      sheet.filterRange
        ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${index}" hidden="1">${xmlEscape(
            `'${sheet.name.replace(/'/g, "''")}'!${sheet.filterRange.replace(/([A-Z]+)(\d+)/g, '$$$1$$$2')}`,
          )}</definedName>`
        : '',
    )
    .join('');

  const workbookXml = `${XML_HEAD}
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    ${workbookSheetsXml}
  </sheets>${filterNames ? `\n  <definedNames>${filterNames}</definedNames>` : ''}
</workbook>`;

  const workbookRelationshipsXml = built
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join('\n  ');

  const workbookRelsXml = `${XML_HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${workbookRelationshipsXml}
  <Relationship Id="rId${built.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  // Style 0 is the default, 1 the date cells; 2 (bold header) and 3 (amount, `#,##0.00`) exist when a sheet uses them.
  const fonts = extraStyles
    ? '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    : '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>';
  const cellXfs = extraStyles
    ? '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>'
    : '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs>';
  const stylesXml = `${XML_HEAD}
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="1"><numFmt numFmtId="164" formatCode="${XLSX_DATE_FORMAT[language]}"/></numFmts>
  ${fonts}
  <fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  ${cellXfs}
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  const zip = new AdmZip();
  zip.addFile('[Content_Types].xml', Buffer.from(contentTypesXml, 'utf8'));
  zip.addFile('_rels/.rels', Buffer.from(rootRelsXml, 'utf8'));
  zip.addFile('xl/workbook.xml', Buffer.from(workbookXml, 'utf8'));
  zip.addFile('xl/_rels/workbook.xml.rels', Buffer.from(workbookRelsXml, 'utf8'));
  zip.addFile('xl/styles.xml', Buffer.from(stylesXml, 'utf8'));
  built.forEach((sheet, index) => {
    zip.addFile(`xl/worksheets/sheet${index + 1}.xml`, sheet.xml);
  });
  built.forEach((sheet, index) => {
    if (sheet.relsXml) zip.addFile(`xl/worksheets/_rels/sheet${index + 1}.xml.rels`, Buffer.from(sheet.relsXml, 'utf8'));
  });
  return zip.toBuffer();
}
