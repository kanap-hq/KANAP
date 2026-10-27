import { crc32, deflateRawSync } from 'node:zlib';

/**
 * A ZIP archive written field by field, for the reader specs: the shapes adm-zip accepts but an
 * ordinary writer never produces (stored entries, a data descriptor, a lying local header, a local
 * CRC that disagrees with the central one, a damaged signature). The central directory is always
 * the authoritative one, as in a real archive.
 */
export interface HostileZipEntry {
  data: Buffer | string;
  /** 0 stored, 8 deflated (default). */
  method?: 0 | 8;
  /** General purpose flags, default 0. Bit 0 is encryption, bit 3 a data descriptor. */
  flags?: number;
  /** A local header signature other than `PK\x03\x04`. */
  localSignature?: number;
  /** Local header values when they must disagree with the data or the central directory. */
  localCrc?: number;
  localCompressedSize?: number;
  localSize?: number;
  localExtra?: Buffer;
  /** The extra length written in the local header, when it lies. */
  localExtraLength?: number;
  /** Central directory values when they must disagree with the data. */
  centralCrc?: number;
  centralCompressedSize?: number;
  centralSize?: number;
  /** Write a trailing data descriptor (implied by bit 3). */
  descriptor?: boolean;
}

export type HostileZipInput = string | Buffer | HostileZipEntry;

function normalize(value: HostileZipInput): HostileZipEntry {
  if (typeof value === 'string' || Buffer.isBuffer(value)) return { data: value };
  return value;
}

export function hostileZip(entries: Record<string, HostileZipInput>): Buffer {
  const records: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;

  for (const [name, input] of Object.entries(entries)) {
    const entry = normalize(input);
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const method = entry.method ?? 8;
    const compressed = method === 0 ? data : deflateRawSync(data);
    const crc = crc32(data) >>> 0;
    const centralCrc = entry.centralCrc ?? crc;
    const centralCompressedSize = entry.centralCompressedSize ?? compressed.length;
    const centralSize = entry.centralSize ?? data.length;
    const flags = entry.flags ?? 0;
    const descriptor = entry.descriptor ?? (flags & 0x8) !== 0;
    const localCrc = entry.localCrc ?? (descriptor ? 0 : crc);
    const localCompressedSize = entry.localCompressedSize ?? (descriptor ? 0 : compressed.length);
    const localSize = entry.localSize ?? (descriptor ? 0 : data.length);
    const nameBytes = Buffer.from(name, 'utf8');
    const extra = entry.localExtra ?? Buffer.alloc(0);
    const extraLength = entry.localExtraLength ?? extra.length;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(entry.localSignature ?? 0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(0, 10);
    local.writeUInt32LE(localCrc, 14);
    local.writeUInt32LE(localCompressedSize, 18);
    local.writeUInt32LE(localSize, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(extraLength, 28);

    const parts = [local, nameBytes, extra, compressed];
    if (descriptor) {
      const tail = Buffer.alloc(16);
      tail.writeUInt32LE(0x08074b50, 0);
      tail.writeUInt32LE(centralCrc, 4);
      tail.writeUInt32LE(centralCompressedSize, 8);
      tail.writeUInt32LE(centralSize, 12);
      parts.push(tail);
    }
    const record = Buffer.concat(parts);
    records.push(record);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(flags, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0, 12);
    central.writeUInt32LE(centralCrc, 16);
    central.writeUInt32LE(centralCompressedSize, 20);
    central.writeUInt32LE(centralSize, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    directory.push(Buffer.concat([central, nameBytes]));
    offset += record.length;
  }

  const centralDirectory = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...records, centralDirectory, end]);
}
