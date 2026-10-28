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
  /** A general number (days, counts); `decimals: 2` shows it with two decimals (`0.00`), the value kept whole. */
  | { kind: 'number'; value: number; decimals?: 2 }
  /** A decimal written as text, such as `-1234.50`, stored as is in the cell. */
  | { kind: 'amount'; value: string }
  /** A calendar day, `YYYY-MM-DD`. A day before 1900-03-01 is written as text in the language's format. */
  | { kind: 'date'; iso: string }
  /** A share as a fraction (`0.125` is 12.5 %), shown with two decimals and a percent sign. */
  | { kind: 'percent'; value: number }
  /** An empty cell: nothing is written. */
  | null;

export interface XlsxSheet {
  /** Sanitised: 31 characters at most, none of `[]:*?/\`, unique in the workbook. */
  name: string;
  headers: readonly string[];
  rows: readonly (readonly XlsxCell[])[];
  /**
   * Total rows, written in bold after the data rows and left out of the filter range, so a sort or a
   * filter in the spreadsheet never moves them. They carry no link.
   */
  footer?: readonly (readonly XlsxCell[])[];
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
  /**
   * The modification time written in the archive entries. The current time when omitted; a caller
   * that compares files byte for byte passes it, as the DOS timestamp has a two-second resolution.
   */
  modifiedAt?: Date;
}

/** Excel's limit for the text of one cell. */
export const XLSX_MAX_TEXT_LENGTH = 32_767;
/** Excel's limits for a sheet: 1,048,576 rows, the header included, and 16,384 columns. */
export const XLSX_MAX_DATA_ROWS = 1_048_575;
export const XLSX_MAX_COLUMNS = 16_384;
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
/** Appended after the others so 0 to 3 keep their place. Built-in `0.00%`. */
const STYLE_PERCENT = 4;
/** The bold styles of the footer (total) rows: amount, percent and date in bold; text and numbers use STYLE_BOLD. */
const STYLE_AMOUNT_BOLD = 5;
const STYLE_PERCENT_BOLD = 6;
const STYLE_DATE_BOLD = 7;
/** A number with two decimals (built-in `0.00`), and its bold footer variant. Appended so 0 to 7 keep their place. */
const STYLE_DECIMAL = 8;
const STYLE_DECIMAL_BOLD = 9;

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

/** `_xHHHH_`, which a spreadsheet reads as the character HHHH: its `_x` is written `_x005F_x` (OOXML). */
const OOXML_ESCAPE_LIKE = /_x(?=[0-9A-Fa-f]{4}_)/g;

/**
 * Text safe for a cell: no character XML forbids, at most 32,767 characters, and a literal `_xHHHH_`
 * escaped so a spreadsheet reads it as written.
 */
function cellText(text: string): string {
  let out = text.replace(XML_FORBIDDEN, '');
  if (out.length > XLSX_MAX_TEXT_LENGTH) {
    out = out.slice(0, XLSX_MAX_TEXT_LENGTH).replace(XML_FORBIDDEN, '');
  }
  return out.includes('_x') ? out.replace(OOXML_ESCAPE_LIKE, '_x005F_x') : out;
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
  if (columns > XLSX_MAX_COLUMNS) throw new Error(`xlsx: sheet "${name}" has ${columns} columns, ${XLSX_MAX_COLUMNS} at most`);
  const footer = sheet.footer ?? [];
  if (sheet.rows.length + footer.length > XLSX_MAX_DATA_ROWS) {
    throw new Error(`xlsx: sheet "${name}" has ${sheet.rows.length + footer.length} rows, ${XLSX_MAX_DATA_ROWS} at most below the header`);
  }
  const names: string[] = [];
  for (let column = 1; column <= columns; column += 1) names.push(columnNumberToName(column));
  if (sheet.links && sheet.links.length !== sheet.rows.length) {
    throw new Error(`xlsx: sheet "${name}" has ${sheet.rows.length} rows and ${sheet.links.length} links`);
  }
  const linkColumn = sheet.linkColumn ?? 2;
  if (!Number.isInteger(linkColumn) || linkColumn < 1) throw new Error(`xlsx: sheet "${name}": linkColumn must be 1 or more`);
  const linkColumnName = columnNumberToName(linkColumn);

  // The footer is bold: its styles live among the extra ones.
  let usesAmount = footer.length > 0;
  const dateColumns = new Set<number>();
  const amountColumns = new Set<number>();
  const widths: number[] = sheet.headers.map((header) => longestLine(header));

  const textCell = (ref: string, text: string, guard: boolean, bold = false): string => {
    const value = cellText(guard ? neutralizeCsvFormulaValue(text) : text);
    return `<c r="${ref}"${bold ? ` s="${STYLE_BOLD}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
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

  const writeRow = (row: readonly XlsxCell[], rowIndex: number, bold: boolean): void => {
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
        cells.push(textCell(ref, cell, styled, bold));
        if (sample) widths[index] = Math.max(widths[index], longestLine(cell));
      } else if (cell.kind === 'number') {
        if (typeof cell.value !== 'number' || !Number.isFinite(cell.value)) {
          throw new Error(`xlsx: sheet "${name}" ${ref}: a number cell needs a finite number`);
        }
        if (cell.decimals === 2) {
          cells.push(`<c r="${ref}" s="${bold ? STYLE_DECIMAL_BOLD : STYLE_DECIMAL}"><v>${cell.value}</v></c>`);
          usesAmount = true;
          if (sample) widths[index] = Math.max(widths[index], cell.value.toFixed(2).length);
        } else {
          cells.push(`<c r="${ref}"${bold ? ` s="${STYLE_BOLD}"` : ''}><v>${cell.value}</v></c>`);
          if (sample) widths[index] = Math.max(widths[index], String(cell.value).length);
        }
      } else if (cell.kind === 'amount') {
        if (typeof cell.value !== 'string' || !AMOUNT_TEXT.test(cell.value)) {
          throw new Error(`xlsx: sheet "${name}" ${ref}: "${String(cell.value)}" is not a decimal amount`);
        }
        cells.push(`<c r="${ref}" s="${bold ? STYLE_AMOUNT_BOLD : STYLE_AMOUNT}"><v>${cell.value}</v></c>`);
        amountColumns.add(index + 1);
        usesAmount = true;
        if (sample) widths[index] = Math.max(widths[index], cell.value.length + Math.floor(cell.value.length / 3));
      } else if (cell.kind === 'percent') {
        if (typeof cell.value !== 'number' || !Number.isFinite(cell.value)) {
          throw new Error(`xlsx: sheet "${name}" ${ref}: a percent cell needs a finite number`);
        }
        cells.push(`<c r="${ref}" s="${bold ? STYLE_PERCENT_BOLD : STYLE_PERCENT}"><v>${cell.value}</v></c>`);
        usesAmount = true;
        if (sample) widths[index] = Math.max(widths[index], String(Math.round(cell.value * 10_000) / 100).length + 1);
      } else if (cell.kind === 'date') {
        const serial = daySerial(cell.iso);
        if (cell.iso < FIRST_SERIAL_DAY) cells.push(textCell(ref, formatCsvDate(cell.iso, language), false, bold));
        else cells.push(`<c r="${ref}" s="${bold ? STYLE_DATE_BOLD : STYLE_DATE}"><v>${serial}</v></c>`);
        dateColumns.add(index + 1);
      } else {
        throw new Error(`xlsx: sheet "${name}" ${ref}: unknown cell kind`);
      }
    }

    const link = bold ? null : sheet.links?.[rowIndex];
    const target = link ? linkTarget(link, appBaseUrl) : '';
    if (target && target.length <= XLSX_MAX_LINK_LENGTH && hyperlinks.length < XLSX_MAX_LINKS_PER_SHEET) {
      const relId = `rId${hyperlinkRels.length + 1}`;
      hyperlinks.push(`<hyperlink ref="${linkColumnName}${rowNumber}" r:id="${relId}"/>`);
      hyperlinkRels.push(
        `<Relationship Id="${relId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${xmlEscape(target)}" TargetMode="External"/>`,
      );
    }
    rowBuffers.push(Buffer.from(`\n    <row r="${rowNumber}">${cells.join('')}</row>`, 'utf8'));
  };
  sheet.rows.forEach((row, rowIndex) => writeRow(row, rowIndex, false));
  footer.forEach((row, index) => writeRow(row, sheet.rows.length + index, true));

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
    // The header and the data rows: the footer stays below the filter.
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


interface PackageSheet {
  name: string;
  filterRange: string | null;
}

/** The workbook-level parts `writeXlsx` and `writeTextXlsxStream` share: types, rels, sheets, styles. */
function workbookPackage(sheets: readonly PackageSheet[], extraStyles: boolean, language: CsvLanguage) {
  const sheetOverrides = sheets
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

  const workbookSheetsXml = sheets
    .map((sheet, index) => `<sheet name="${xmlEscape(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join('\n    ');

  // Excel keeps a sheet's filter in a hidden defined name as well; the filter works without it, but this is how Excel writes it.
  const filterNames = sheets
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

  const workbookRelationshipsXml = sheets
    .map(
      (_, index) =>
        `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    )
    .join('\n  ');

  const workbookRelsXml = `${XML_HEAD}
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  ${workbookRelationshipsXml}
  <Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  // Style 0 is the default, 1 the date cells; 2 (bold header), 3 (amount, `#,##0.00`), 4 (percent, `0.00%`), the
  // bold amount, percent and date of the footer rows (5 to 7) and the two-decimal number, plain and bold (8, 9), exist
  // when a sheet uses them.
  const fonts = extraStyles
    ? '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
    : '<fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>';
  const cellXfs = extraStyles
    ? '<cellXfs count="10"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>'
      + '<xf numFmtId="4" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="10" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/><xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>'
      + '<xf numFmtId="2" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="2" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/></cellXfs>'
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

  return { contentTypesXml, rootRelsXml, workbookXml, workbookRelsXml, stylesXml };
}

/**
 * Writes a workbook: one sheet per entry, in order. Throws on no sheet, on a sheet over Excel's rows or columns,
 * and on a row whose length differs from the headers.
 */
export function writeXlsx(request: XlsxWriteRequest): Buffer {
  const { language, sheets } = request;
  if (!sheets || sheets.length === 0) throw new Error('xlsx: a workbook needs at least one sheet');
  const appBaseUrl = String(request.appBaseUrl || '').trim().replace(/\/$/, '');
  const taken = new Set<string>();
  const built = sheets.map((sheet) => buildSheet(sheet, sheetName(sheet.name, taken), appBaseUrl, language));
  const extraStyles = built.some((sheet) => sheet.usesExtraStyles);

  const packageXml = workbookPackage(built, extraStyles, language);

  const zip = new AdmZip();
  const addFile = (name: string, data: Buffer): void => {
    const entry = zip.addFile(name, data);
    if (request.modifiedAt) entry.header.time = request.modifiedAt;
  };
  addFile('[Content_Types].xml', Buffer.from(packageXml.contentTypesXml, 'utf8'));
  addFile('_rels/.rels', Buffer.from(packageXml.rootRelsXml, 'utf8'));
  addFile('xl/workbook.xml', Buffer.from(packageXml.workbookXml, 'utf8'));
  addFile('xl/_rels/workbook.xml.rels', Buffer.from(packageXml.workbookRelsXml, 'utf8'));
  addFile('xl/styles.xml', Buffer.from(packageXml.stylesXml, 'utf8'));
  built.forEach((sheet, index) => {
    addFile(`xl/worksheets/sheet${index + 1}.xml`, sheet.xml);
  });
  built.forEach((sheet, index) => {
    if (sheet.relsXml) addFile(`xl/worksheets/_rels/sheet${index + 1}.xml.rels`, Buffer.from(sheet.relsXml, 'utf8'));
  });
  return zip.toBuffer();
}

/** A sheet of text rows read as they arrive, for exports too large to hold as an array of rows. */
export interface XlsxTextStreamRequest {
  language: CsvLanguage;
  /** Sanitised like a written sheet name. */
  sheetName: string;
  headers: readonly string[];
  /** The data rows, read once, in order. Only text cells: a string, or an empty cell. */
  rows: AsyncIterable<readonly (string | null | undefined)[]>;
  /** A size hint for the XML buffer (the rows about to be read); the filter uses the rows actually read. */
  rowCountHint?: number;
  /** The archive timestamp, for a reproducible file; now when omitted. */
  modifiedAt?: Date;
}

/**
 * A buffer whose bytes are written in order and that grows when it must. The sheet of a big export is
 * written into one of these instead of an array of row buffers: the rows themselves are never held, and
 * the memory is the XML of the sheet (about 450 bytes a row for the audit log), not three copies of it.
 */
class GrowingBuffer {
  private data: Buffer;
  private length = 0;

  constructor(initial: number) {
    this.data = Buffer.allocUnsafe(Math.max(64 * 1024, initial));
  }

  write(text: string): void {
    const bytes = Buffer.byteLength(text);
    if (this.length + bytes > this.data.length) {
      let size = this.data.length;
      while (size < this.length + bytes) size *= 2;
      const next = Buffer.allocUnsafe(size);
      this.data.copy(next, 0, 0, this.length);
      this.data = next;
    }
    this.data.write(text, this.length, 'utf8');
    this.length += bytes;
  }

  result(): Buffer {
    return this.data.subarray(0, this.length);
  }
}

/**
 * The audit log workbook, and any other export of a sheet of text rows: the same file `writeXlsx` writes
 * for one styled sheet of inline strings (bold frozen header, filter, the same widths), but the rows are
 * read from an async iterator and turned into XML as they arrive. The output is byte for byte the one of
 * `writeXlsx` with the same rows and `modifiedAt`, which the spec checks.
 */
export async function writeTextXlsxStream(request: XlsxTextStreamRequest): Promise<Buffer> {
  const { language, headers } = request;
  const columns = headers.length;
  if (columns === 0) throw new Error('xlsx: a streamed sheet needs at least one column');
  if (columns > XLSX_MAX_COLUMNS) throw new Error(`xlsx: streamed sheet has ${columns} columns, ${XLSX_MAX_COLUMNS} at most`);
  if (request.rowCountHint !== undefined && (!Number.isInteger(request.rowCountHint) || request.rowCountHint < 0)) {
    throw new Error('xlsx: streamed sheet rowCountHint must be a non-negative count');
  }

  const name = sheetName(request.sheetName, new Set());
  const names: string[] = [];
  for (let column = 1; column <= columns; column += 1) names.push(columnNumberToName(column));
  const widths: number[] = headers.map((header) => longestLine(header));

  const textCell = (ref: string, text: string, bold = false): string => {
    const value = cellText(neutralizeCsvFormulaValue(text));
    return `<c r="${ref}"${bold ? ` s="${STYLE_BOLD}"` : ''} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
  };
  const headerCells: string[] = [];
  headers.forEach((header, index) => {
    if (header === '' || header === null || header === undefined) return;
    const ref = `${names[index]}1`;
    headerCells.push(`<c r="${ref}" s="${STYLE_BOLD}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(cellText(String(header)))}</t></is></c>`);
  });

  const rowXml = (row: readonly (string | null | undefined)[], rowIndex: number): string => {
    if (row.length !== columns) {
      throw new Error(`xlsx: streamed sheet "${name}" row ${rowIndex + 1} has ${row.length} cells for ${columns} headers`);
    }
    const rowNumber = rowIndex + 2;
    const sample = rowIndex < WIDTH_SAMPLE_ROWS;
    const cells: string[] = [];
    for (let index = 0; index < columns; index += 1) {
      const cell = row[index];
      if (cell === null || cell === undefined || cell === '') continue;
      if (typeof cell !== 'string') throw new Error(`xlsx: streamed sheet "${name}" ${names[index]}${rowNumber}: text only`);
      cells.push(textCell(`${names[index]}${rowNumber}`, cell));
      if (sample) widths[index] = Math.max(widths[index], longestLine(cell));
    }
    return `\n    <row r="${rowNumber}">${cells.join('')}</row>`;
  };

  const save = new GrowingBuffer(Math.min(128 * 1024 * 1024, Math.max(1024 * 1024, (request.rowCountHint ?? 0) * 600 + 65_536)));
  const iterator = request.rows[Symbol.asyncIterator]();
  // The column widths come from the header and the first 1,000 rows, and the header is written first:
  // those rows are turned into XML now (a few hundred kilobytes) and written after the header.
  const firstRows: string[] = [];
  let written = 0;
  try {
    while (written < WIDTH_SAMPLE_ROWS) {
      const next = await iterator.next();
      if (next.done) break;
      if (written >= XLSX_MAX_DATA_ROWS) throw new Error(`xlsx: streamed sheet "${name}" has more than ${XLSX_MAX_DATA_ROWS} rows`);
      firstRows.push(rowXml(next.value, written));
      written += 1;
    }

    const colsXml = widths
      .map((measured, index) => {
        const width = Math.min(WIDTH_MAX, Math.max(WIDTH_MIN, measured + 2));
        return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
      })
      .join('');
    save.write(
      [
        XML_HEAD,
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">',
        '  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>',
        `  <cols>${colsXml}</cols>`,
        '  <sheetData>',
        '    ',
      ].join('\n'),
    );
    save.write(`<row r="1">${headerCells.join('')}</row>`);
    for (const row of firstRows) save.write(row);
    for (;;) {
      const next = await iterator.next();
      if (next.done) break;
      if (written >= XLSX_MAX_DATA_ROWS) throw new Error(`xlsx: streamed sheet "${name}" has more than ${XLSX_MAX_DATA_ROWS} rows`);
      save.write(rowXml(next.value, written));
      written += 1;
    }
  } catch (error) {
    // Stop pulling rows, so a generator releases its database batch; keep the original error.
    try {
      await iterator.return?.();
    } catch {
      // The refusal that stopped the writer is the one to report.
    }
    throw error;
  }
  const filterRange = `A1:${names[columns - 1]}${written + 1}`;
  save.write(['', '  </sheetData>', `  <autoFilter ref="${filterRange}"/>`, '</worksheet>'].join('\n'));

  const packageXml = workbookPackage([{ name, filterRange }], true, language);

  const zip = new AdmZip();
  const addFile = (entryName: string, data: Buffer): void => {
    const entry = zip.addFile(entryName, data);
    if (request.modifiedAt) entry.header.time = request.modifiedAt;
  };
  addFile('[Content_Types].xml', Buffer.from(packageXml.contentTypesXml, 'utf8'));
  addFile('_rels/.rels', Buffer.from(packageXml.rootRelsXml, 'utf8'));
  addFile('xl/workbook.xml', Buffer.from(packageXml.workbookXml, 'utf8'));
  addFile('xl/_rels/workbook.xml.rels', Buffer.from(packageXml.workbookRelsXml, 'utf8'));
  addFile('xl/styles.xml', Buffer.from(packageXml.stylesXml, 'utf8'));
  addFile('xl/worksheets/sheet1.xml', save.result());
  return zip.toBuffer();
}
