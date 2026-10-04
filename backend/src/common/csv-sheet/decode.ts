export type CsvEncoding = 'utf-8' | 'windows-1252';

export class CsvDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvDecodeError';
  }
}

/**
 * UTF-8, with or without a BOM. Anything that is not UTF-8 is Windows-1252,
 * which is what Excel writes for "CSV" on Windows. UTF-16 is neither: a BOM
 * of FF FE or FE FF is refused rather than read as mojibake.
 */
export function decodeCsv(buf: Buffer): { encoding: CsvEncoding; text: string } {
  if (buf.length >= 2) {
    const utf16 = (buf[0] === 0xff && buf[1] === 0xfe) || (buf[0] === 0xfe && buf[1] === 0xff);
    if (utf16) throw new CsvDecodeError('This file is not UTF-8 or Windows-1252.');
  }
  const hasBom = buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  const body = hasBom ? buf.subarray(3) : buf;
  try {
    return { encoding: 'utf-8', text: new TextDecoder('utf-8', { fatal: true }).decode(body) };
  } catch {
    // A UTF-8 BOM that is not valid UTF-8 is a broken file, not Windows-1252.
    if (hasBom) throw new CsvDecodeError('This file is not UTF-8 or Windows-1252.');
    return { encoding: 'windows-1252', text: new TextDecoder('windows-1252').decode(buf) };
  }
}
