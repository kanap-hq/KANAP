import { BadRequestException } from '@nestjs/common';
import AdmZip = require('adm-zip');

/**
 * Limits for the ZIP archives the API opens (DOCX, XLSX, ODT, downloaded CSV
 * archives). Measured on legitimate files (lot L1d-2): a weekly portfolio
 * report of 60,000 lines has 10 entries and 62 MB uncompressed (largest entry
 * 17 MB); a 19.5 MB DOCX with images has 28 entries and 19.5 MB uncompressed;
 * a 12 MB sparse XLSX written by LibreOffice holds one 248 MB sheet, which is
 * why the type detection of attachments only lists entries and never reads
 * the sheets.
 */
export const ARCHIVE_MAX_ENTRIES = 5_000;
export const ARCHIVE_MAX_ENTRY_BYTES = 100 * 1024 * 1024;
export const ARCHIVE_MAX_TOTAL_BYTES = 200 * 1024 * 1024;

export const ARCHIVE_TOO_LARGE_MESSAGE = 'This file holds too much content to be opened.';

export class ArchiveLimitError extends BadRequestException {
  constructor() {
    super(ARCHIVE_TOO_LARGE_MESSAGE);
    this.name = 'ArchiveLimitError';
  }
}

export type ArchiveLimits = {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
};

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: ARCHIVE_MAX_ENTRIES,
  maxEntryBytes: ARCHIVE_MAX_ENTRY_BYTES,
  maxTotalBytes: ARCHIVE_MAX_TOTAL_BYTES,
};

// zlib's answer when inflating would produce more than the declared size.
function isOutputLimitError(error: unknown): boolean {
  return (error as { code?: unknown })?.code === 'ERR_BUFFER_TOO_LARGE';
}

/**
 * A ZIP archive opened under limits. The entry count is checked when it is
 * opened, before the central directory is parsed. Each read checks the size the
 * entry declares against the limits left, then decompresses it: adm-zip (0.6.1
 * and later) stops inflating at the declared size, so the bytes produced never
 * exceed what was checked, and the real length is counted against the total.
 */
export class BoundedArchive {
  private readBytes = 0;

  constructor(readonly zip: AdmZip, readonly limits: ArchiveLimits) {}

  entries(): AdmZip.IZipEntry[] {
    return this.zip.getEntries();
  }

  /** Checks the sizes every entry declares, before anything is decompressed. */
  assertDeclaredSizes(): void {
    let total = 0;
    for (const entry of this.entries()) {
      if (entry.isDirectory) continue;
      const size = Number(entry.header.size) || 0;
      total += size;
      if (size > this.limits.maxEntryBytes || total > this.limits.maxTotalBytes) throw new ArchiveLimitError();
    }
  }

  /**
   * Decompresses every entry once, without keeping the data, so that the real
   * sizes are known to fit before another program reads the archive. Errors
   * other than a limit (bad checksum, unsupported method) are left to that
   * program, as before.
   */
  assertRealSizes(): void {
    for (const entry of this.entries()) {
      if (entry.isDirectory) continue;
      try {
        this.read(entry);
      } catch (error) {
        if (error instanceof ArchiveLimitError) throw error;
      }
    }
  }

  read(entry: AdmZip.IZipEntry): Buffer {
    const remaining = this.limits.maxTotalBytes - this.readBytes;
    const declared = Number(entry.header.size) || 0;
    if (declared > this.limits.maxEntryBytes || declared > remaining) throw new ArchiveLimitError();
    let data: Buffer;
    try {
      data = entry.getData();
    } catch (error) {
      if (isOutputLimitError(error)) throw new ArchiveLimitError();
      throw error;
    }
    if (data.length > this.limits.maxEntryBytes || data.length > remaining) throw new ArchiveLimitError();
    this.readBytes += data.length;
    return data;
  }

  readText(entry: AdmZip.IZipEntry): string {
    return this.read(entry).toString('utf8');
  }
}

/**
 * Opens a ZIP archive (a buffer or a file path). Throws ArchiveLimitError (400)
 * when it holds more entries than allowed; other errors (not a ZIP archive) are
 * the ones adm-zip raises.
 */
export function openBoundedArchive(source: Buffer | string, limits: Partial<ArchiveLimits> = {}): BoundedArchive {
  const effective: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, ...limits };
  const zip = new AdmZip(source);
  // The count read from the end of the archive is the number of headers adm-zip
  // parses next: checked before any of them is read.
  if (zip.getEntryCount() > effective.maxEntries) throw new ArchiveLimitError();
  return new BoundedArchive(zip, effective);
}
