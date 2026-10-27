import { BadRequestException } from '@nestjs/common';
import { StringDecoder } from 'node:string_decoder';
import { posix } from 'node:path';
import type AdmZip = require('adm-zip');
import { SaxesParser, SaxesTagPlain } from 'saxes';
import { ArchiveLimitError, BoundedArchive, openBoundedArchive } from '../archive-limits';

/**
 * The common .xlsx reader: the first worksheet of a workbook as a grid of cells, read with a streaming
 * XML parser (no tree) from a ZIP archive opened under limits. The upload is treated as hostile: every
 * limit below is checked, and every refusal is an XlsxReadError (a 400) with a plain sentence.
 *
 * Only these parts are ever decompressed: `xl/workbook.xml`, `xl/_rels/workbook.xml.rels`, the first
 * worksheet, the shared strings and the styles. Entry names are only looked up, never written anywhere.
 */

/**
 * One cell. `number` keeps the text of `<v>` exactly as the file holds it. A date is a calendar day
 * (`iso`, `YYYY-MM-DD`), plus `time` (`HH:MM:SS`, rounded to the second, no time zone: the wall-clock
 * time Excel shows) when its format shows a time or its serial has a time of day.
 */
export type XlsxReadCell =
  | { kind: 'text'; value: string }
  | { kind: 'number'; value: string }
  | { kind: 'date'; iso: string; time?: string }
  | { kind: 'empty' };

export interface XlsxGrid {
  /** Name of the sheet read: the first worksheet in workbook order. */
  sheetName: string;
  /** Sheets of the workbook (worksheets and chart sheets). */
  sheetCount: number;
  /** `rows[i]` is spreadsheet row `i + 1`; a row stops at its last cell with a value; no trailing empty row. */
  rows: XlsxReadCell[][];
}

const MB = 1024 * 1024;
const MAX_SHARED_STRINGS = 1_000_000;
const MAX_CELL_ELEMENTS = 5_000_000;
/**
 * Rows of a worksheet in Excel. A row number past it comes from no spreadsheet; it also bounds the
 * rows without a value, which `maxRows` does not count.
 */
const EXCEL_MAX_ROWS = 1_048_576;

/** Limits of the reader, one place. */
export const XLSX_READ_LIMITS = {
  /** The upload itself (the import routes already refuse more). */
  maxArchiveBytes: 48 * MB,
  /** Entries of the archive, plus the folders their names imply. */
  maxEntries: 2_000,
  /** Declared uncompressed size of one entry, checked before it is decompressed and again while it is. */
  maxEntryBytes: 200 * MB,
  /** Declared uncompressed size of all entries together. */
  maxTotalBytes: 300 * MB,
  /** Uncompressed size over compressed size, for each entry the reader decompresses. */
  maxCompressionRatio: 100,
  /**
   * The ratio is checked on parts declared larger than this: a small part may legitimately pack
   * tighter (one cell of 32,767 identical characters is a 300:1 part), and costs nothing.
   */
  compressionRatioFromBytes: 1 * MB,
  /** Entries of the shared string table. */
  maxSharedStrings: MAX_SHARED_STRINGS,
  /** `<c>` elements of the sheet. */
  maxCellElements: MAX_CELL_ELEMENTS,
  /**
   * Attributes of one element. Excel writes fewer than ten; the XML parser holds all of them before it
   * reports the element, so they are counted as it reads them.
   */
  maxAttributesPerElement: 64,
  /**
   * Elements of one part, whatever their name: 12,000,000. Two per cell (`<c>` and its value), one per
   * shared string, and 1,000,000 for the rows and the rest (formulas, rich text runs, columns, styles).
   * The monthly budget file of three years at the import's row cap is about 8,100,000.
   */
  maxElements: 2 * MAX_CELL_ELEMENTS + MAX_SHARED_STRINGS + 1_000_000,
  /**
   * Cells of the returned grid, the empty cells between two values included. The widest file read at
   * the row cap of an import is the monthly budget file of three years: 199 columns, plus one per
   * dimension, 4,040,000 cells for 20,000 lines with three dimensions. 5,000,000 is 20,101 rows of
   * 248 columns, and about the cells of the largest CSV file an import accepts (48 MB, about 10 bytes
   * a cell).
   */
  maxGridCells: 5_000_000,
  /** Characters of one cell (Excel's own limit). */
  maxCellTextLength: 32_767,
  /** Highest row holding a value. */
  maxRows: 200_000,
  /**
   * Rows holding a value. A caller passes its own row cap (`readSheet`: the import's row cap, the
   * header and a margin): reading stops as soon as it is passed, before the rest of the sheet is held.
   */
  maxValueRows: 200_000,
  /** Highest column (XFD, Excel's own limit). */
  maxColumns: 16_384,
} as const;

export type XlsxReadLimits = { [K in keyof typeof XLSX_READ_LIMITS]: number };

export type XlsxReadErrorCode =
  | 'XLSX_OLD_FORMAT'
  | 'XLSX_NOT_WORKBOOK'
  | 'XLSX_INVALID'
  | 'XLSX_DOCTYPE'
  | 'XLSX_NO_SHEET'
  | 'XLSX_TOO_LARGE';

export const XLSX_OLD_FORMAT_MESSAGE = 'This is an old Excel file (.xls). Save it as .xlsx or CSV and import it again.';
const NOT_WORKBOOK_MESSAGE = 'This file is not an Excel workbook (.xlsx). Save it as .xlsx or CSV and import it again.';
const INVALID_MESSAGE = 'This Excel file could not be read: it is damaged or incomplete. Save it again as .xlsx or CSV and import it again.';
const DOCTYPE_MESSAGE = 'This Excel file could not be read: it holds a document type declaration, which Excel never writes.';
const NO_SHEET_MESSAGE = 'This workbook has no sheet to read.';

/** A refusal of the file: `code` for the interface, `limit` when a limit was passed. */
export class XlsxReadError extends BadRequestException {
  constructor(
    readonly code: XlsxReadErrorCode,
    message: string,
    readonly limit: keyof XlsxReadLimits | null = null,
  ) {
    super(message);
    this.name = 'XlsxReadError';
  }
}

const count = (value: number): string => value.toLocaleString('en-US');

function tooLarge(limit: keyof XlsxReadLimits, limits: XlsxReadLimits): XlsxReadError {
  const value = limits[limit];
  const reason: Record<keyof XlsxReadLimits, string> = {
    maxArchiveBytes: `the file is larger than ${count(Math.floor(value / MB))} MB`,
    maxEntries: `it holds more than ${count(value)} parts, or parts with overlong names`,
    maxEntryBytes: `a part would be larger than ${count(Math.floor(value / MB))} MB once unpacked`,
    maxTotalBytes: `its parts would be larger than ${count(Math.floor(value / MB))} MB once unpacked`,
    maxCompressionRatio: `a part is compressed more than ${count(value)} times`,
    compressionRatioFromBytes: `a part is compressed more than ${count(limits.maxCompressionRatio)} times`,
    maxSharedStrings: `it holds more than ${count(value)} different texts`,
    maxCellElements: `the sheet has more than ${count(value)} cells`,
    maxAttributesPerElement: `an XML element of the file has more than ${count(value)} attributes`,
    maxElements: `a part of the file holds more than ${count(value)} XML elements`,
    maxGridCells: `the sheet has more than ${count(value)} cells`,
    maxCellTextLength: `a cell holds more than ${count(value)} characters`,
    maxRows: `the sheet has more than ${count(value)} rows`,
    maxValueRows: `the sheet has more than ${count(value)} rows`,
    maxColumns: `the sheet has more than ${count(value)} columns`,
  };
  return new XlsxReadError('XLSX_TOO_LARGE', `This file is too large to read: ${reason[limit]}.`, limit);
}

const invalid = (): XlsxReadError => new XlsxReadError('XLSX_INVALID', INVALID_MESSAGE);

/** `PK\x03\x04`: a ZIP archive (an .xlsx, but also an .ods or a .docx). */
export function hasZipSignature(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04;
}

/** `D0 CF 11 E0`: an OLE compound file, the old .xls format (and an encrypted .xlsx). */
export function hasOldExcelSignature(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11 && buffer[3] === 0xe0;
}

/**
 * Reads the first worksheet of an .xlsx file. Throws XlsxReadError, and nothing else, when the file
 * cannot be read or passes a limit.
 */
export function readXlsxGrid(buffer: Buffer, limits: Partial<XlsxReadLimits> = {}): XlsxGrid {
  const effective: XlsxReadLimits = { ...XLSX_READ_LIMITS, ...limits };
  if (hasOldExcelSignature(buffer)) throw new XlsxReadError('XLSX_OLD_FORMAT', XLSX_OLD_FORMAT_MESSAGE);
  if (!hasZipSignature(buffer)) throw new XlsxReadError('XLSX_NOT_WORKBOOK', NOT_WORKBOOK_MESSAGE);
  if (buffer.length > effective.maxArchiveBytes) throw tooLarge('maxArchiveBytes', effective);
  try {
    return readWorkbook(buffer, effective);
  } catch (error) {
    if (error instanceof XlsxReadError) throw error;
    // adm-zip on a damaged archive, a bad checksum, an encrypted entry, a string too long for memory:
    // the file cannot be read, which is not a server error.
    throw invalid();
  }
}

/**
 * `readXlsxGrid` with the worksheet decompressed and parsed as a stream: the same grid, the same
 * limits and the same refusals, without holding the 200 MB part in memory. The small parts (workbook,
 * relationships, styles, shared strings) are still read whole. The imports use it; the synchronous
 * reader stays for callers that already hold the file and for the specs that compare both.
 */
export async function readXlsxGridAsync(buffer: Buffer, limits: Partial<XlsxReadLimits> = {}): Promise<XlsxGrid> {
  const effective: XlsxReadLimits = { ...XLSX_READ_LIMITS, ...limits };
  if (hasOldExcelSignature(buffer)) throw new XlsxReadError('XLSX_OLD_FORMAT', XLSX_OLD_FORMAT_MESSAGE);
  if (!hasZipSignature(buffer)) throw new XlsxReadError('XLSX_NOT_WORKBOOK', NOT_WORKBOOK_MESSAGE);
  if (buffer.length > effective.maxArchiveBytes) throw tooLarge('maxArchiveBytes', effective);
  try {
    return await readWorkbookAsync(buffer, effective);
  } catch (error) {
    if (error instanceof XlsxReadError) throw error;
    // adm-zip on a damaged archive, a bad checksum, an encrypted entry, an inflater error: the file
    // cannot be read, which is not a server error.
    throw invalid();
  }
}

// ---------------------------------------------------------------------------------------------------
// Archive

function openArchive(buffer: Buffer, limits: XlsxReadLimits): BoundedArchive {
  let archive: BoundedArchive;
  try {
    archive = openBoundedArchive(buffer, {
      maxEntries: limits.maxEntries,
      maxEntryBytes: limits.maxEntryBytes,
      maxTotalBytes: limits.maxTotalBytes,
    });
  } catch (error) {
    if (error instanceof ArchiveLimitError) throw tooLarge('maxEntries', limits);
    throw new XlsxReadError('XLSX_NOT_WORKBOOK', NOT_WORKBOOK_MESSAGE);
  }
  // Declared sizes of every entry, before anything is decompressed.
  let total = 0;
  for (const entry of archive.entries()) {
    if (entry.isDirectory) continue;
    const size = Number(entry.header.size) || 0;
    if (size > limits.maxEntryBytes) throw tooLarge('maxEntryBytes', limits);
    total += size;
    if (total > limits.maxTotalBytes) throw tooLarge('maxTotalBytes', limits);
  }
  return archive;
}

/** Decompresses one part: ratio first, then the size, checked again by the inflater as it runs. */
function readPart(archive: BoundedArchive, entry: AdmZip.IZipEntry, limits: XlsxReadLimits): Buffer {
  const size = Number(entry.header.size) || 0;
  const compressed = Number(entry.header.compressedSize) || 0;
  if (size > limits.compressionRatioFromBytes && size > limits.maxCompressionRatio * Math.max(compressed, 1)) {
    throw tooLarge('maxCompressionRatio', limits);
  }
  let data: Buffer;
  try {
    data = archive.read(entry);
  } catch (error) {
    // The inflater stops at the declared size: a part that unpacks to more lies about its size.
    if (error instanceof ArchiveLimitError) throw invalid();
    throw error;
  }
  // A stored entry declares the same size twice. adm-zip returns the compressed bytes, which the
  // streamed reader refuses; the whole reader refuses them too instead of parsing a short part.
  if ((Number(entry.header.method) || 0) === 0 && data.length !== (Number(entry.header.size) || 0)) throw invalid();
  return data;
}

function findEntry(archive: BoundedArchive, name: string): AdmZip.IZipEntry | null {
  const entry = archive.zip.getEntry(name);
  return entry && !entry.isDirectory ? entry : null;
}

/** The target of a workbook relationship as an entry name: relative to `xl/`, or absolute from the root. */
function partName(target: string): string | null {
  const resolved = target.startsWith('/') ? posix.normalize(target).slice(1) : posix.normalize(posix.join('xl', target));
  if (resolved === '' || resolved.startsWith('..')) return null;
  return resolved;
}

// ---------------------------------------------------------------------------------------------------
// Concurrency

/** Reads of one worksheet that may run at once: each one holds its grid until it returns. */
const WORKBOOK_READ_SLOTS = 2;

/** A fair counting semaphore: a released place is handed to the first waiter, never lost between them. */
class Semaphore {
  private used = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(private readonly places: number) {}

  async acquire(): Promise<void> {
    if (this.used < this.places) {
      this.used += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  release(): void {
    const next = this.waiters.shift();
    // The place is transferred as it is: a new caller cannot take it before the waiter resumes.
    if (next) next();
    else this.used -= 1;
  }
}

const workbookReadSlots = new Semaphore(WORKBOOK_READ_SLOTS);

/** What the specs observe: streamed reads in flight and the highest number seen, against the two places. */
export const XLSX_READ_ACTIVITY = { active: 0, peak: 0, limit: WORKBOOK_READ_SLOTS };

// ---------------------------------------------------------------------------------------------------
// XML

const PART_CHUNK = MB;
const DOCTYPE = Buffer.from('<!DOCTYPE', 'latin1');
const ENTITY = Buffer.from('<!ENTITY', 'latin1');

/** Handlers of one part. A self-closing element gets `open` then `close`, as any other. */
type TagHandlers = {
  open: (name: string, attributes: Record<string, string>) => void;
  close: (name: string) => void;
  text: (text: string) => void;
};

/** The local name of an element or attribute: `x:row` is `row`. */
function localName(name: string): string {
  const colon = name.indexOf(':');
  return colon < 0 ? name : name.slice(colon + 1);
}

/** The value of an attribute by local name (`r:id`, whatever the prefix). */
function attribute(attributes: Record<string, string>, name: string, prefixed = false): string | undefined {
  for (const key of Object.keys(attributes)) {
    const colon = key.indexOf(':');
    if (prefixed ? colon >= 0 && key.slice(colon + 1) === name : key === name) return attributes[key];
  }
  return undefined;
}

/**
 * Parses one part with saxes, fed in chunks. DOCTYPE and ENTITY declarations are searched on the bytes
 * of each chunk, across the chunk boundary, before saxes sees them: no entity is ever expanded; only
 * the five predefined entities and numeric character references are decoded. The attributes of an
 * element are counted as saxes reads them, before it builds the element, and the elements of the part
 * as they open. An error thrown by a handler leaves `parser.write` at once and ends the parse.
 *
 * The same parser reads a small part held in memory (`parsePart`) and the sheet inflated as it
 * arrives (`streamPart`): the declarations and the byte order marks are checked on the bytes, across
 * the chunks, and each chunk is decoded and parsed as soon as it is produced. Refusals follow that
 * order: a size, ratio, element or attribute limit raised while the bytes arrive comes before the
 * CRC-32 of the part, checked at its end. A file with both reports the limit, which is accepted.
 */
class PartParser {
  private readonly parser: SaxesParser;
  private readonly decoder = new StringDecoder('utf8');
  private elements = 0;
  private attributes = 0;
  /** The last bytes already scanned for `<!DOCTYPE` and `<!ENTITY`, so a token split between two chunks is found. */
  private scanTail: Buffer | null = null;
  private prefix: Buffer[] = [];
  private prefixLength = 0;
  private started = false;

  constructor(handlers: TagHandlers, private readonly limits: XlsxReadLimits) {
    const parser = new SaxesParser({ xmlns: false, position: false });
    this.parser = parser;
    parser.on('error', () => {
      throw invalid();
    });
    parser.on('doctype', () => {
      throw new XlsxReadError('XLSX_DOCTYPE', DOCTYPE_MESSAGE);
    });
    // saxes reports each attribute as it reads it, then the element once all are read: the attributes
    // seen since the last element belong to the element being read. (An `opentagstart` handler next to
    // the `attribute` one makes saxes about three times slower on large parts.)
    parser.on('attribute', () => {
      this.attributes += 1;
      if (this.attributes > limits.maxAttributesPerElement) throw tooLarge('maxAttributesPerElement', limits);
    });
    parser.on('opentag', (tag: SaxesTagPlain) => {
      this.attributes = 0;
      this.elements += 1;
      if (this.elements > limits.maxElements) throw tooLarge('maxElements', limits);
      handlers.open(localName(tag.name), tag.attributes as Record<string, string>);
    });
    parser.on('closetag', (tag: SaxesTagPlain) => handlers.close(localName(tag.name)));
    parser.on('text', handlers.text);
    parser.on('cdata', handlers.text);
  }

  /** Feeds one chunk of the part; throws as soon as a limit is passed or the XML is refused. */
  write(data: Buffer): void {
    this.scan(data);
    // A byte order mark is dropped once the first bytes are known: UTF-16 is refused, as Excel writes UTF-8.
    if (!this.started) {
      this.prefix.push(data);
      this.prefixLength += data.length;
      if (this.prefixLength < 3) return;
      const head = this.prefix.length === 1 ? this.prefix[0] : Buffer.concat(this.prefix);
      this.prefix = [];
      this.prefixLength = 0;
      this.started = true;
      if (head.length >= 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))) throw invalid();
      const start = head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
      const text = this.decoder.write(head.subarray(start));
      if (text) this.parser.write(text);
      return;
    }
    const text = this.decoder.write(data);
    if (text) this.parser.write(text);
  }

  /** Ends the part: the last decoded text, then saxes' own close. */
  end(): void {
    if (!this.started) {
      const head = this.prefix.length === 0 ? Buffer.alloc(0) : this.prefix.length === 1 ? this.prefix[0] : Buffer.concat(this.prefix);
      if (head.length >= 2 && ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))) throw invalid();
      const start = head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf ? 3 : 0;
      this.started = true;
      const text = this.decoder.write(head.subarray(start));
      if (text) this.parser.write(text);
    }
    const rest = this.decoder.end();
    if (rest) this.parser.write(rest);
    this.parser.close();
  }

  private scan(data: Buffer): void {
    const window = this.scanTail ? Buffer.concat([this.scanTail, data]) : data;
    if (window.indexOf(DOCTYPE) >= 0 || window.indexOf(ENTITY) >= 0) throw new XlsxReadError('XLSX_DOCTYPE', DOCTYPE_MESSAGE);
    this.scanTail = window.length <= 8 ? Buffer.from(window) : Buffer.from(window.subarray(window.length - 8));
  }
}

/** Parses a part held whole in memory, in chunks (a 200 MB string would cost more than the part). */
function parsePart(data: Buffer, handlers: TagHandlers, limits: XlsxReadLimits): void {
  const parser = new PartParser(handlers, limits);
  for (let offset = 0; offset < data.length; offset += PART_CHUNK) {
    parser.write(data.subarray(offset, Math.min(offset + PART_CHUNK, data.length)));
  }
  parser.end();
}

/**
 * Reads the worksheet part as a stream: its stored bytes (a view of the archive) are inflated chunk by
 * chunk and parsed as they arrive, so the 200 MB part is never held whole. The ratio and declared size
 * are checked before anything is inflated, the cumulative size and the CRC-32 at the end, and the
 * element and attribute counts as saxes reads them. Refusals are the same XlsxReadError as `parsePart`.
 */
async function streamPart(archive: BoundedArchive, entry: AdmZip.IZipEntry, handlers: TagHandlers, limits: XlsxReadLimits): Promise<void> {
  const size = Number(entry.header.size) || 0;
  const compressed = Number(entry.header.compressedSize) || 0;
  if (size > limits.compressionRatioFromBytes && size > limits.maxCompressionRatio * Math.max(compressed, 1)) {
    throw tooLarge('maxCompressionRatio', limits);
  }
  const parser = new PartParser(handlers, limits);
  try {
    // The archive checks the declared size, the cumulative budget and the CRC-32; this layer only
    // parses the bytes it is handed.
    await archive.stream(entry, (chunk) => parser.write(chunk));
    parser.end();
  } catch (error) {
    if (error instanceof ArchiveLimitError) throw invalid();
    throw error;
  }
}

/**
 * Text accumulated within an element, refused past the cell limit. OOXML writes characters XML cannot
 * hold as `_xHHHH_` (a carriage return is `_x000D_`), and a literal `_x` as `_x005F_x`: decoded here.
 */
class TextBuffer {
  private parts: string[] = [];
  private length = 0;

  constructor(private readonly limits: XlsxReadLimits) {}

  add(text: string): void {
    this.length += text.length;
    // The escapes take up to seven characters for one: compare the decoded length at the end too.
    if (this.length > this.limits.maxCellTextLength * 7) throw tooLarge('maxCellTextLength', this.limits);
    this.parts.push(text);
  }

  take(): string {
    const raw = this.parts.length === 1 ? this.parts[0] : this.parts.join('');
    this.parts = [];
    this.length = 0;
    const text = raw.includes('_x') ? raw.replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16))) : raw;
    if (text.length > this.limits.maxCellTextLength) throw tooLarge('maxCellTextLength', this.limits);
    return text;
  }

  clear(): void {
    this.parts = [];
    this.length = 0;
  }
}

// ---------------------------------------------------------------------------------------------------
// Workbook, relationships, styles, shared strings

interface WorkbookInfo {
  sheets: { name: string; relId: string }[];
  date1904: boolean;
}

function parseWorkbook(data: Buffer, limits: XlsxReadLimits): WorkbookInfo {
  const info: WorkbookInfo = { sheets: [], date1904: false };
  parsePart(data, {
    open(name, attributes) {
      if (name === 'workbookPr') {
        const value = (attribute(attributes, 'date1904') ?? '').trim().toLowerCase();
        info.date1904 = value === '1' || value === 'true';
      } else if (name === 'sheet') {
        info.sheets.push({ name: attribute(attributes, 'name') ?? '', relId: attribute(attributes, 'id', true) ?? '' });
      }
    },
    close() {},
    text() {},
  }, limits);
  return info;
}

interface Relationship {
  id: string;
  type: string;
  target: string;
  external: boolean;
}

function parseRelationships(data: Buffer, limits: XlsxReadLimits): Relationship[] {
  const relationships: Relationship[] = [];
  parsePart(data, {
    open(name, attributes) {
      if (name !== 'Relationship') return;
      relationships.push({
        id: attribute(attributes, 'Id') ?? '',
        type: attribute(attributes, 'Type') ?? '',
        target: attribute(attributes, 'Target') ?? '',
        external: (attribute(attributes, 'TargetMode') ?? '').toLowerCase() === 'external',
      });
    },
    close() {},
    text() {},
  }, limits);
  return relationships;
}

/** Built-in number formats that show a date or a time. */
const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
/** Those of them that show a time of day. */
const BUILTIN_TIME_FORMATS = new Set([18, 19, 20, 21, 22, 45, 46, 47]);

/** How a cell style shows a number: as itself, as a day, or as a day with a time of day. */
type DateStyle = 'none' | 'date' | 'dateTime';

/**
 * Whether a custom number format shows a date: a `d`, `m` or `y` outside quotes, escapes and brackets.
 * An elapsed time (`[h]:mm`, `[mm]:ss`) is a duration, not a date.
 */
export function isDateFormatCode(code: string): boolean {
  const plain = plainFormatText(code);
  return plain !== null && /[dmy]/i.test(plain);
}

/** Whether a custom date format also shows a time of day: an `h` or an `s` outside quotes, escapes and brackets. */
export function isDateTimeFormatCode(code: string): boolean {
  const plain = plainFormatText(code);
  return plain !== null && /[dmy]/i.test(plain) && /[hs]/i.test(plain);
}

/** The letters of a format code outside quotes, escapes and brackets; null for an elapsed time. */
function plainFormatText(code: string): string | null {
  let plain = '';
  for (let i = 0; i < code.length; i += 1) {
    const ch = code[i];
    if (ch === '"') {
      const end = code.indexOf('"', i + 1);
      i = end < 0 ? code.length : end;
    } else if (ch === '\\' || ch === '_' || ch === '*') {
      i += 1;
    } else if (ch === '[') {
      const end = code.indexOf(']', i + 1);
      const inside = code.slice(i + 1, end < 0 ? code.length : end);
      if (/^(h+|m+|s+)$/i.test(inside)) return null;
      i = end < 0 ? code.length : end;
    } else {
      plain += ch;
    }
  }
  return plain;
}

/** For each `cellXfs` entry (the `s` of a cell), whether its number format shows a date, and a time. */
function parseStyles(data: Buffer, limits: XlsxReadLimits): DateStyle[] {
  const customFormats = new Map<number, string>();
  const formatOfStyle: number[] = [];
  let inCellXfs = false;
  let depth = 0;
  parsePart(data, {
    open(name, attributes) {
      if (name === 'numFmt' && !inCellXfs) {
        const id = Number(attribute(attributes, 'numFmtId'));
        if (Number.isInteger(id)) customFormats.set(id, attribute(attributes, 'formatCode') ?? '');
      } else if (name === 'cellXfs' && !inCellXfs) {
        inCellXfs = true;
        depth = 0;
      } else if (inCellXfs) {
        if (name === 'xf' && depth === 0) {
          const id = Number(attribute(attributes, 'numFmtId') ?? '0');
          formatOfStyle.push(Number.isInteger(id) ? id : 0);
        }
        depth += 1;
      }
    },
    close(name) {
      if (!inCellXfs) return;
      if (name === 'cellXfs' && depth === 0) inCellXfs = false;
      else depth -= 1;
    },
    text() {},
  }, limits);
  return formatOfStyle.map((id): DateStyle => {
    const custom = customFormats.get(id);
    if (custom !== undefined) return isDateTimeFormatCode(custom) ? 'dateTime' : isDateFormatCode(custom) ? 'date' : 'none';
    return BUILTIN_TIME_FORMATS.has(id) ? 'dateTime' : BUILTIN_DATE_FORMATS.has(id) ? 'date' : 'none';
  });
}

/**
 * The shared string table. Rich text runs are concatenated; phonetic runs (`<rPh>`) are left out.
 */
function parseSharedStrings(data: Buffer, limits: XlsxReadLimits): string[] {
  const strings: string[] = [];
  const text = new TextBuffer(limits);
  let inItem = false;
  let inText = false;
  let phonetic = 0;
  parsePart(data, {
    open(name) {
      if (name === 'si') {
        if (strings.length >= limits.maxSharedStrings) throw tooLarge('maxSharedStrings', limits);
        inItem = true;
        text.clear();
      } else if (name === 'rPh') phonetic += 1;
      else if (name === 't' && inItem && phonetic === 0) inText = true;
    },
    close(name) {
      if (name === 'si' && inItem) {
        strings.push(text.take());
        inItem = false;
        phonetic = 0;
      } else if (name === 'rPh') phonetic = Math.max(0, phonetic - 1);
      else if (name === 't') inText = false;
    },
    text(value) {
      if (inText) text.add(value);
    },
  }, limits);
  return strings;
}

// ---------------------------------------------------------------------------------------------------
// Dates

const EPOCH_1900 = Date.UTC(1899, 11, 30);

/**
 * The calendar day of a date serial, or null when it is no day: negative, 0 and 60 in the 1900 system
 * (Excel's 1900-01-00 and 1900-02-29, which never existed), or past 9999. The time of day is dropped.
 */
export function serialToIsoDay(serial: number, date1904: boolean): string | null {
  if (!Number.isFinite(serial) || serial < 0) return null;
  const whole = Math.floor(serial);
  let days: number;
  if (date1904) days = whole + 1462;
  else if (whole === 0 || whole === 60) return null;
  else days = whole < 60 ? whole + 1 : whole;
  const day = new Date(EPOCH_1900 + days * 86_400_000);
  if (days > 3_000_000 || day.getUTCFullYear() > 9999) return null;
  return day.toISOString().slice(0, 10);
}

/**
 * The day of a date serial (`serialToIsoDay`) and its time of day, rounded to the second and kept
 * within the day (a fraction that rounds to midnight is 23:59:59). `time` is set when `showsTime` or
 * when the serial has a time of day; null when the serial is no day.
 */
export function serialToDateTime(serial: number, date1904: boolean, showsTime: boolean): { iso: string; time?: string } | null {
  const iso = serialToIsoDay(serial, date1904);
  if (!iso) return null;
  const seconds = Math.min(Math.round((serial - Math.floor(serial)) * 86_400), 86_399);
  if (seconds === 0 && !showsTime) return { iso };
  const two = (value: number) => String(value).padStart(2, '0');
  return { iso, time: `${two(Math.floor(seconds / 3600))}:${two(Math.floor(seconds / 60) % 60)}:${two(seconds % 60)}` };
}

// ---------------------------------------------------------------------------------------------------
// Sheet

const NUMBER_TEXT = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const ISO_DAY_START = /^(\d{4})-(\d{2})-(\d{2})(?:$|T)/;
const CELL_REF = /^([A-Za-z]{1,3})(\d+)?$/;
const ROW_NUMBER = /^\d{1,7}$/;

function columnNumber(letters: string): number {
  let value = 0;
  for (const ch of letters.toUpperCase()) value = value * 26 + (ch.charCodeAt(0) - 64);
  return value;
}

function isoDayOf(text: string): string | null {
  const match = ISO_DAY_START.exec(text.trim());
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const time = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === iso ? iso : null;
}

interface SheetContext {
  sharedStrings: readonly string[];
  dateStyles: readonly DateStyle[];
  date1904: boolean;
  limits: XlsxReadLimits;
}

/** The handlers that build the grid of a worksheet, and the grid once the part has been parsed. */
function sheetHandlers(context: SheetContext): { handlers: TagHandlers; rows: () => XlsxReadCell[][] } {
  const { sharedStrings, dateStyles, date1904, limits } = context;
  const rows: XlsxReadCell[][] = [];
  const valueText = new TextBuffer(limits);
  const inlineText = new TextBuffer(limits);
  let gridCells = 0;
  let cellElements = 0;
  let valueRows = 0;

  let inSheetData = false;
  let rowNumber = 0;
  let row: XlsxReadCell[] | null = null;
  let lastColumn = 0;

  let inCell = false;
  let cellColumn = 0;
  let cellType = 'n';
  let cellStyle = 0;
  let hasValue = false;
  let hasInline = false;
  let inValue = false;
  let inInline = false;
  let inInlineText = false;
  let phonetic = 0;

  const place = (cell: XlsxReadCell): void => {
    if (cell.kind === 'empty') return;
    if (rowNumber > limits.maxRows) throw tooLarge('maxRows', limits);
    let target = row;
    if (!target) {
      valueRows += 1;
      if (valueRows > limits.maxValueRows) throw tooLarge('maxValueRows', limits);
      while (rows.length < rowNumber - 1) rows.push([]);
      target = [];
      rows.push(target);
      row = target;
    }
    gridCells += cellColumn - target.length;
    if (gridCells > limits.maxGridCells) throw tooLarge('maxGridCells', limits);
    while (target.length < cellColumn - 1) target.push({ kind: 'empty' });
    target.push(cell);
  };

  const finishCell = (): XlsxReadCell => {
    const value = hasValue ? valueText.take() : null;
    switch (cellType) {
      case 's': {
        if (value === null || value.trim() === '') return { kind: 'empty' };
        const index = value.trim();
        if (!/^\d+$/.test(index) || Number(index) >= sharedStrings.length) throw invalid();
        const text = sharedStrings[Number(index)];
        return text === '' ? { kind: 'empty' } : { kind: 'text', value: text };
      }
      case 'inlineStr': {
        const text = hasInline ? inlineText.take() : value;
        return text === null || text === '' ? { kind: 'empty' } : { kind: 'text', value: text };
      }
      case 'str':
      case 'e':
        return value === null || value === '' ? { kind: 'empty' } : { kind: 'text', value };
      case 'b': {
        if (value === null || value.trim() === '') return { kind: 'empty' };
        const flag = value.trim().toLowerCase();
        if (flag === '1' || flag === 'true') return { kind: 'text', value: 'TRUE' };
        if (flag === '0' || flag === 'false') return { kind: 'text', value: 'FALSE' };
        throw invalid();
      }
      case 'd': {
        if (value === null || value.trim() === '') return { kind: 'empty' };
        const iso = isoDayOf(value);
        return iso ? { kind: 'date', iso } : { kind: 'text', value };
      }
      case 'n': {
        // A formula without a cached value is empty.
        if (value === null || value.trim() === '') return { kind: 'empty' };
        const text = value.trim();
        if (!NUMBER_TEXT.test(text)) throw invalid();
        const style = dateStyles[cellStyle] ?? 'none';
        if (style !== 'none') {
          const day = serialToDateTime(Number(text), date1904, style === 'dateTime');
          if (day) return { kind: 'date', ...day };
        }
        return { kind: 'number', value: text };
      }
      default:
        throw invalid();
    }
  };

  return {
    handlers: {
    open(name, attributes) {
      if (name === 'sheetData') {
        inSheetData = true;
        return;
      }
      if (!inSheetData) return;
      if (name === 'row') {
        const r = attribute(attributes, 'r');
        let next = rowNumber + 1;
        if (r !== undefined) {
          if (!ROW_NUMBER.test(r.trim())) throw invalid();
          next = Number(r.trim());
        }
        if (next <= rowNumber || next < 1) throw invalid();
        if (next > EXCEL_MAX_ROWS) throw tooLarge('maxRows', limits);
        rowNumber = next;
        row = null;
        lastColumn = 0;
        return;
      }
      if (name === 'c') {
        if (rowNumber === 0) throw invalid();
        cellElements += 1;
        if (cellElements > limits.maxCellElements) throw tooLarge('maxCellElements', limits);
        const ref = attribute(attributes, 'r');
        let column = lastColumn + 1;
        if (ref !== undefined) {
          const match = CELL_REF.exec(ref.trim());
          if (!match) throw invalid();
          column = columnNumber(match[1]);
        }
        if (column > limits.maxColumns) throw tooLarge('maxColumns', limits);
        if (column <= lastColumn) throw invalid();
        lastColumn = column;
        cellColumn = column;
        cellType = attribute(attributes, 't') ?? 'n';
        const style = Number(attribute(attributes, 's') ?? '0');
        cellStyle = Number.isInteger(style) && style >= 0 ? style : 0;
        hasValue = false;
        hasInline = false;
        valueText.clear();
        inlineText.clear();
        phonetic = 0;
        inCell = true;
        return;
      }
      if (!inCell) return;
      if (name === 'v') {
        inValue = true;
        hasValue = true;
      } else if (name === 'is') {
        inInline = true;
        hasInline = true;
      } else if (inInline && name === 'rPh') phonetic += 1;
      else if (inInline && name === 't' && phonetic === 0) inInlineText = true;
    },
    close(name) {
      if (name === 'sheetData') {
        inSheetData = false;
        return;
      }
      if (!inSheetData) return;
      if (name === 'c' && inCell) {
        inCell = false;
        inValue = false;
        inInline = false;
        inInlineText = false;
        place(finishCell());
      } else if (name === 'v') inValue = false;
      else if (name === 'is') inInline = false;
      else if (name === 'rPh') phonetic = Math.max(0, phonetic - 1);
      else if (name === 't') inInlineText = false;
    },
    text(value) {
      if (inValue) valueText.add(value);
      else if (inInlineText) inlineText.add(value);
    },
    },
    rows: () => rows,
  };
}

/** Parses a worksheet part held whole in memory (the synchronous reader). */
function parseSheet(data: Buffer, context: SheetContext): XlsxReadCell[][] {
  const sheet = sheetHandlers(context);
  parsePart(data, sheet.handlers, context.limits);
  return sheet.rows();
}

// ---------------------------------------------------------------------------------------------------

const RELATIONSHIP_TYPE = (type: string, name: string): boolean => type.endsWith(`/${name}`);

interface WorkbookParts {
  workbook: WorkbookInfo;
  relationships: Relationship[];
  sheetEntry: AdmZip.IZipEntry;
  sheetName: string;
  stylesEntry: AdmZip.IZipEntry | null;
  sharedStringsEntry: AdmZip.IZipEntry | null;
}

/** The parts the reader needs: the workbook, its relationships, the first worksheet, styles, shared strings. */
function locateParts(archive: BoundedArchive, limits: XlsxReadLimits): WorkbookParts {
  const workbookEntry = findEntry(archive, 'xl/workbook.xml');
  const relsEntry = findEntry(archive, 'xl/_rels/workbook.xml.rels');
  if (!workbookEntry || !relsEntry) throw new XlsxReadError('XLSX_NOT_WORKBOOK', NOT_WORKBOOK_MESSAGE);

  const workbook = parseWorkbook(readPart(archive, workbookEntry, limits), limits);
  const relationships = parseRelationships(readPart(archive, relsEntry, limits), limits);
  const byId = new Map(relationships.filter((rel) => !rel.external).map((rel) => [rel.id, rel]));

  // The first worksheet in workbook order (a chart sheet is skipped).
  let sheetEntry: AdmZip.IZipEntry | null = null;
  let sheetName = '';
  for (const sheet of workbook.sheets) {
    const rel = byId.get(sheet.relId);
    if (!rel || !RELATIONSHIP_TYPE(rel.type, 'worksheet')) continue;
    const name = partName(rel.target);
    const entry = name ? findEntry(archive, name) : null;
    if (!entry) throw invalid();
    sheetEntry = entry;
    sheetName = sheet.name;
    break;
  }
  if (!sheetEntry) throw new XlsxReadError('XLSX_NO_SHEET', NO_SHEET_MESSAGE);

  const relatedPart = (type: string, fallback: string): AdmZip.IZipEntry | null => {
    const rel = relationships.find((candidate) => !candidate.external && RELATIONSHIP_TYPE(candidate.type, type));
    const name = rel ? partName(rel.target) : fallback;
    return name ? findEntry(archive, name) : null;
  };
  return {
    workbook,
    relationships,
    sheetEntry,
    sheetName,
    stylesEntry: relatedPart('styles', 'xl/styles.xml'),
    sharedStringsEntry: relatedPart('sharedStrings', 'xl/sharedStrings.xml'),
  };
}

function readWorkbook(buffer: Buffer, limits: XlsxReadLimits): XlsxGrid {
  const archive = openArchive(buffer, limits);
  const parts = locateParts(archive, limits);
  const dateStyles = parts.stylesEntry ? parseStyles(readPart(archive, parts.stylesEntry, limits), limits) : [];
  const sharedStrings = parts.sharedStringsEntry ? parseSharedStrings(readPart(archive, parts.sharedStringsEntry, limits), limits) : [];
  const rows = parseSheet(readPart(archive, parts.sheetEntry, limits), {
    sharedStrings,
    dateStyles,
    date1904: parts.workbook.date1904,
    limits,
  });
  return { sheetName: parts.sheetName, sheetCount: parts.workbook.sheets.length, rows };
}

/**
 * `readWorkbook` with the worksheet part read as a stream: the small parts are still held whole.
 * A process has two places at most, because the stream returns before the caller has used its grid:
 * without them, N parallel imports would hold N grids (about 200 MB each at the import row cap).
 */
async function readWorkbookAsync(buffer: Buffer, limits: XlsxReadLimits): Promise<XlsxGrid> {
  await workbookReadSlots.acquire();
  XLSX_READ_ACTIVITY.active += 1;
  XLSX_READ_ACTIVITY.peak = Math.max(XLSX_READ_ACTIVITY.peak, XLSX_READ_ACTIVITY.active);
  try {
    const archive = openArchive(buffer, limits);
    const parts = locateParts(archive, limits);
    const dateStyles = parts.stylesEntry ? parseStyles(readPart(archive, parts.stylesEntry, limits), limits) : [];
    const sharedStrings = parts.sharedStringsEntry ? parseSharedStrings(readPart(archive, parts.sharedStringsEntry, limits), limits) : [];
    const sheet = sheetHandlers({
      sharedStrings,
      dateStyles,
      date1904: parts.workbook.date1904,
      limits,
    });
    await streamPart(archive, parts.sheetEntry, sheet.handlers, limits);
    return { sheetName: parts.sheetName, sheetCount: parts.workbook.sheets.length, rows: sheet.rows() };
  } finally {
    XLSX_READ_ACTIVITY.active -= 1;
    workbookReadSlots.release();
  }
}
