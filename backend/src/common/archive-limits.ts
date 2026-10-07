import { BadRequestException } from '@nestjs/common';
import { readFileSync } from 'node:fs';
import AdmZip = require('adm-zip');

/**
 * Limits for the ZIP archives the API opens (DOCX, XLSX, ODT, downloaded CSV
 * archives). Measured on legitimate files (lot L1d-2): a weekly portfolio
 * report of 60,000 lines has 10 entries and 62 MB uncompressed (largest entry
 * 17 MB); a 19.5 MB DOCX with images has 28 entries and 19.5 MB uncompressed;
 * a 12 MB sparse XLSX written by LibreOffice holds one 248 MB sheet, which is
 * why the type detection of attachments only lists entries and never reads
 * the sheets.
 *
 * Listing an archive creates one object per entry and per folder its entry
 * names imply, and the work grows with the length and the depth of the names.
 * The entry list is therefore checked before adm-zip builds it: entries plus
 * implied folders, name length, folder levels in a name. Measured: office
 * files (weekly report XLSX, DOCX and ODT with images) list at most 40 objects,
 * with names of 45 bytes and 3 folder levels at most; a ZIP of a source tree
 * (2,966 files in 321 folders) lists 3,287 objects, with names of 100 bytes and
 * 6 levels at most. At these limits the costliest list takes about 0.2 s.
 */
/** Entries, plus the folders their names imply. */
export const ARCHIVE_MAX_ENTRIES = 5_000;
export const ARCHIVE_MAX_ENTRY_BYTES = 100 * 1024 * 1024;
export const ARCHIVE_MAX_TOTAL_BYTES = 200 * 1024 * 1024;
/** Length of an entry name, in bytes (the longest path macOS accepts). */
export const ARCHIVE_MAX_NAME_BYTES = 1_024;
/** Folder levels in an entry name (`a/b/c.txt` has 2). */
export const ARCHIVE_MAX_NAME_LEVELS = 64;

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
  maxNameBytes: number;
  maxNameLevels: number;
};

export const DEFAULT_ARCHIVE_LIMITS: ArchiveLimits = {
  maxEntries: ARCHIVE_MAX_ENTRIES,
  maxEntryBytes: ARCHIVE_MAX_ENTRY_BYTES,
  maxTotalBytes: ARCHIVE_MAX_TOTAL_BYTES,
  maxNameBytes: ARCHIVE_MAX_NAME_BYTES,
  maxNameLevels: ARCHIVE_MAX_NAME_LEVELS,
};

// ZIP records read to check the entry list (APPNOTE 4.3.12, 4.3.14 to 4.3.16).
const END_SIGNATURE = 0x06054b50;
const END_SIZE = 22;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_LOCATOR_SIZE = 20;
const ZIP64_END_SIGNATURE = 0x06064b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const CENTRAL_HEADER_SIZE = 46;
const SLASH = 0x2f;

function readUInt64(buffer: Buffer, offset: number): number {
  return buffer.readUInt32LE(offset + 4) * 0x100000000 + buffer.readUInt32LE(offset);
}

/**
 * The entry count and the offset of the central directory, taken from the end
 * record found the way adm-zip 0.6 finds it (last end record within the comment
 * range, or the ZIP64 record it points to).
 */
function readCentralDirectory(buffer: Buffer): { entries: number; offset: number } | null {
  let i = buffer.length - END_SIZE;
  const searchStart = Math.max(0, i - 0xffff);
  let stop = searchStart;
  let endOffset = -1;
  let zip64 = false;
  for (; i >= stop; i -= 1) {
    if (buffer[i] !== 0x50) continue;
    const signature = buffer.readUInt32LE(i);
    if (signature === END_SIGNATURE) {
      endOffset = i;
      zip64 = false;
      stop = i - ZIP64_LOCATOR_SIZE;
    } else if (signature === ZIP64_LOCATOR_SIGNATURE) {
      stop = searchStart;
    } else if (signature === ZIP64_END_SIGNATURE) {
      endOffset = i;
      zip64 = true;
      break;
    }
  }
  if (endOffset < 0) return null;
  if (!zip64) {
    return { entries: buffer.readUInt16LE(endOffset + 8), offset: buffer.readUInt32LE(endOffset + 16) };
  }
  if (endOffset + 56 > buffer.length) return null;
  return { entries: readUInt64(buffer, endOffset + 24), offset: readUInt64(buffer, endOffset + 48) };
}

/**
 * Reads the names in the central directory and refuses (ArchiveLimitError) an
 * archive whose entries plus implied folders exceed `maxEntries`, or one with a
 * name longer than `maxNameBytes` or deeper than `maxNameLevels`. The work is
 * proportional to the size of the directory. `expectedEntries` is the count
 * adm-zip read from the same end record: an archive whose directory cannot be
 * matched to it is refused.
 */
function assertEntryListWithinLimits(buffer: Buffer, expectedEntries: number, limits: ArchiveLimits): void {
  const directory = readCentralDirectory(buffer);
  if (!directory || directory.entries !== expectedEntries) throw new ArchiveLimitError();
  // adm-zip refuses this directory before reading any name.
  if (directory.entries > (buffer.length - directory.offset) / CENTRAL_HEADER_SIZE) return;

  // Implied folders, one id per distinct path: key = parent id + '/' + folder name.
  const folderIds = new Map<string, number>();
  let listed = 0;
  let index = directory.offset;
  for (let entry = 0; entry < directory.entries; entry += 1) {
    // A header adm-zip cannot read stops it with its own error, before it lists anything.
    if (index + CENTRAL_HEADER_SIZE > buffer.length || buffer.readUInt32LE(index) !== CENTRAL_HEADER_SIGNATURE) return;
    const nameLength = buffer.readUInt16LE(index + 28);
    if (nameLength > limits.maxNameBytes) throw new ArchiveLimitError();
    const nameStart = index + CENTRAL_HEADER_SIZE;
    const nameEnd = Math.min(nameStart + nameLength, buffer.length);

    let parent = 0;
    let levels = 0;
    let segmentStart = nameStart;
    for (let position = nameStart; position < nameEnd; position += 1) {
      if (buffer[position] !== SLASH) continue;
      levels += 1;
      if (levels > limits.maxNameLevels) throw new ArchiveLimitError();
      const key = `${parent}/${buffer.toString('latin1', segmentStart, position)}`;
      let id = folderIds.get(key);
      if (id === undefined) {
        id = folderIds.size + 1;
        folderIds.set(key, id);
        listed += 1;
      }
      parent = id;
      segmentStart = position + 1;
    }
    // A name ending with '/' is the folder itself, already counted.
    if (nameEnd === nameStart || buffer[nameEnd - 1] !== SLASH) listed += 1;
    if (listed > limits.maxEntries) throw new ArchiveLimitError();

    index += CENTRAL_HEADER_SIZE + nameLength + buffer.readUInt16LE(index + 30) + buffer.readUInt16LE(index + 32);
  }
}

// zlib's answer when inflating would produce more than the declared size.
function isOutputLimitError(error: unknown): boolean {
  return (error as { code?: unknown })?.code === 'ERR_BUFFER_TOO_LARGE';
}

/**
 * A ZIP archive opened under limits. The entry list (entries and implied
 * folders, name lengths and levels) is checked when it is opened, before adm-zip
 * builds it. Each read checks the size the entry declares against the limits
 * left, then decompresses it: adm-zip (0.6.1 and later) stops inflating at the
 * declared size, so the bytes produced never exceed what was checked, and the
 * real length is counted against the total.
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
 * when its entry list is over the limits; other errors (not a ZIP archive) are
 * the ones adm-zip raises.
 */
export function openBoundedArchive(source: Buffer | string, limits: Partial<ArchiveLimits> = {}): BoundedArchive {
  const effective: ArchiveLimits = { ...DEFAULT_ARCHIVE_LIMITS, ...limits };
  const buffer = typeof source === 'string' ? readFileSync(source) : source;
  // Reads the end record only: the entries are listed on first use.
  const zip = new AdmZip(buffer);
  const declaredEntries = zip.getEntryCount();
  if (declaredEntries > effective.maxEntries) throw new ArchiveLimitError();
  assertEntryListWithinLimits(buffer, declaredEntries, effective);
  return new BoundedArchive(zip, effective);
}
