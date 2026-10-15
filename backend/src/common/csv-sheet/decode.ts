export type CsvEncoding = 'utf-8' | 'windows-1252';

/** The refusals of a file that cannot be read as CSV text, by the code the interface translates. */
export const CSV_DECODE_MESSAGES = {
  CSV_ENCODING_UNSUPPORTED: 'This file is not UTF-8 or Windows-1252.',
  CSV_FILE_EXCEL: 'This file is an Excel workbook, not a CSV. In Excel: File › Save As › CSV UTF-8 (Comma delimited).',
  CSV_FILE_OPENDOCUMENT: 'This file is an OpenDocument spreadsheet, not a CSV. In LibreOffice Calc: File › Save As › Text CSV.',
  CSV_FILE_NOT_TEXT: 'This file is not a CSV file. Save it as CSV UTF-8 and import it again.',
} as const;

export type CsvDecodeErrorCode = keyof typeof CSV_DECODE_MESSAGES;

export class CsvDecodeError extends Error {
  constructor(
    /** The code the interface translates. */
    readonly code: CsvDecodeErrorCode,
  ) {
    super(CSV_DECODE_MESSAGES[code]);
    this.name = 'CsvDecodeError';
  }
}

/** The code of a refusal sentence of this module, for callers that only kept the sentence. */
export function csvDecodeErrorCode(message: string): CsvDecodeErrorCode | null {
  const entry = Object.entries(CSV_DECODE_MESSAGES).find(([, text]) => text === message);
  return entry ? (entry[0] as CsvDecodeErrorCode) : null;
}

/** How much of the file the control-byte check reads. */
const TEXT_SNIFF_BYTES = 8192;

function startsWith(buf: Buffer, bytes: number[]): boolean {
  return buf.length >= bytes.length && bytes.every((byte, index) => buf[index] === byte);
}

/**
 * A spreadsheet or another binary file, before any of it is read as text.
 * An .xlsx or .ods is a ZIP archive: its entry names say which (an ODF file
 * names its type in its first entry, `mimetype`). An .xls is an OLE compound
 * file whose directory names a `Workbook` stream in UTF-16. Anything else
 * with a NUL or a control byte in its first kilobytes is not text.
 */
function binaryKind(buf: Buffer): CsvDecodeErrorCode | null {
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) {
    if (buf.includes('application/vnd.oasis.opendocument.spreadsheet', 0, 'latin1')) return 'CSV_FILE_OPENDOCUMENT';
    if (buf.includes('xl/workbook', 0, 'latin1')) return 'CSV_FILE_EXCEL';
    return 'CSV_FILE_NOT_TEXT';
  }
  if (startsWith(buf, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) {
    return buf.includes('Workbook\u0000', 0, 'utf16le') ? 'CSV_FILE_EXCEL' : 'CSV_FILE_NOT_TEXT';
  }
  const end = Math.min(buf.length, TEXT_SNIFF_BYTES);
  for (let index = 0; index < end; index++) {
    const byte = buf[index];
    // Tab, line feed, vertical tab, form feed, carriage return and the DOS end-of-file mark occur in text files.
    if (byte < 0x20 && byte !== 0x09 && byte !== 0x0a && byte !== 0x0b && byte !== 0x0c && byte !== 0x0d && byte !== 0x1a) {
      return 'CSV_FILE_NOT_TEXT';
    }
  }
  return null;
}

/**
 * UTF-8, with or without a BOM. Anything that is not UTF-8 is Windows-1252,
 * which is what Excel writes for "CSV" on Windows. UTF-16 is neither: a BOM
 * of FF FE or FE FF is refused rather than read as mojibake. A workbook or
 * another binary file is refused before it is read as text, so its bytes are
 * never taken for a header.
 */
export function decodeCsv(buf: Buffer): { encoding: CsvEncoding; text: string } {
  if (buf.length >= 2) {
    const utf16 = (buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff);
    if (utf16) throw new CsvDecodeError('CSV_ENCODING_UNSUPPORTED');
  }
  const binary = binaryKind(buf);
  if (binary) throw new CsvDecodeError(binary);
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const body = hasBom ? buf.subarray(3) : buf;
  try {
    return { encoding: 'utf-8', text: new TextDecoder('utf-8', { fatal: true }).decode(body) };
  } catch {
    // A UTF-8 BOM that is not valid UTF-8 is a broken file, not Windows-1252.
    if (hasBom) throw new CsvDecodeError('CSV_ENCODING_UNSUPPORTED');
    return { encoding: 'windows-1252', text: new TextDecoder('windows-1252').decode(buf) };
  }
}
