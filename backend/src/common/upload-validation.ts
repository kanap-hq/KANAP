import { BadRequestException } from '@nestjs/common';
import * as path from 'path';
import AdmZip = require('adm-zip');

export type UploadValidationScope = 'attachment' | 'inline-image' | 'document-import' | 'csv-import';

export type ValidateUploadOptions = {
  scope?: UploadValidationScope;
};

export type UploadValidationInput = {
  originalName?: string | null;
  mimeType?: string | null;
  buffer: Buffer;
  size?: number | null;
};

export type UploadValidationResult = {
  extension: string;
  mimeType: string;
  size: number;
};

const GENERIC_MIME_TYPES = new Set([
  '',
  'application/octet-stream',
  'binary/octet-stream',
  'application/binary',
  'application/unknown',
]);

const MIME_ALIASES: Record<string, string> = {
  'image/jpg': 'image/jpeg',
  'application/x-zip-compressed': 'application/zip',
  'text/x-csv': 'text/csv',
  'application/csv': 'text/csv',
  'application/x-csv': 'text/csv',
  'text/x-markdown': 'text/markdown',
  'application/x-rtf': 'application/rtf',
  'text/xml': 'application/xml',
};

const EXTENSION_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.csv': 'text/csv',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.xml': 'application/xml',
  '.rtf': 'application/rtf',
  '.zip': 'application/zip',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
};

const ATTACHMENT_ALLOWED_EXTENSIONS = new Set(Object.keys(EXTENSION_TO_MIME));
const ATTACHMENT_ALLOWED_MIME_TYPES = new Set(Object.values(EXTENSION_TO_MIME));

const INLINE_IMAGE_ALLOWED_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const INLINE_IMAGE_ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const DOCUMENT_IMPORT_ALLOWED_EXTENSIONS = new Set(['.docx']);
const DOCUMENT_IMPORT_ALLOWED_MIME_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const CSV_IMPORT_ALLOWED_EXTENSIONS = new Set(['.csv']);
const CSV_IMPORT_ALLOWED_MIME_TYPES = new Set(['text/csv']);

const ZIP_BASED_EXTENSION_MIME: Record<string, string> = {
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
};

const OLE_BASED_EXTENSION_MIME: Record<string, string> = {
  '.doc': 'application/msword',
  '.xls': 'application/vnd.ms-excel',
  '.ppt': 'application/vnd.ms-powerpoint',
};

const TEXT_LIKE_EXTENSIONS = new Set(['.txt', '.csv', '.json', '.md', '.xml', '.svg', '.rtf']);

const TEXT_LIKE_MIME_TYPES = new Set([
  'text/plain',
  'text/csv',
  'application/json',
  'text/markdown',
  'application/xml',
  'image/svg+xml',
  'application/rtf',
]);

function normalizeMimeType(value?: string | null): string {
  const base = String(value || '')
    .toLowerCase()
    .trim()
    .split(';')[0]
    .trim();
  return MIME_ALIASES[base] || base;
}

function normalizeExtension(originalName?: string | null): string {
  return path.extname(String(originalName || '')).toLowerCase();
}

function getScopeAllowedSets(scope: UploadValidationScope): {
  allowedExtensions: Set<string>;
  allowedMimeTypes: Set<string>;
} {
  if (scope === 'document-import') {
    return {
      allowedExtensions: DOCUMENT_IMPORT_ALLOWED_EXTENSIONS,
      allowedMimeTypes: DOCUMENT_IMPORT_ALLOWED_MIME_TYPES,
    };
  }
  if (scope === 'inline-image') {
    return {
      allowedExtensions: INLINE_IMAGE_ALLOWED_EXTENSIONS,
      allowedMimeTypes: INLINE_IMAGE_ALLOWED_MIME_TYPES,
    };
  }
  if (scope === 'csv-import') {
    return {
      allowedExtensions: CSV_IMPORT_ALLOWED_EXTENSIONS,
      allowedMimeTypes: CSV_IMPORT_ALLOWED_MIME_TYPES,
    };
  }

  return {
    allowedExtensions: ATTACHMENT_ALLOWED_EXTENSIONS,
    allowedMimeTypes: ATTACHMENT_ALLOWED_MIME_TYPES,
  };
}

function hasPrefix(buffer: Buffer, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false;
  for (let i = 0; i < bytes.length; i += 1) {
    if (buffer[i] !== bytes[i]) return false;
  }
  return true;
}

function detectSignature(buffer: Buffer): 'png' | 'jpeg' | 'gif' | 'webp' | 'pdf' | 'zip' | 'ole' | null {
  if (hasPrefix(buffer, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'png';
  if (hasPrefix(buffer, [0xff, 0xd8, 0xff])) return 'jpeg';
  if (hasPrefix(buffer, [0x47, 0x49, 0x46, 0x38])) return 'gif';
  if (
    hasPrefix(buffer, [0x52, 0x49, 0x46, 0x46]) &&
    buffer.length > 12 &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) return 'webp';
  if (hasPrefix(buffer, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'pdf';
  if (
    hasPrefix(buffer, [0x50, 0x4b, 0x03, 0x04]) ||
    hasPrefix(buffer, [0x50, 0x4b, 0x05, 0x06]) ||
    hasPrefix(buffer, [0x50, 0x4b, 0x07, 0x08])
  ) return 'zip';
  if (hasPrefix(buffer, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])) return 'ole';
  return null;
}

function detectZipContainerMime(buffer: Buffer): string {
  try {
    const zip = new AdmZip(buffer);
    const entries = zip.getEntries().map((entry) => entry.entryName.toLowerCase());

    if (entries.some((entry) => entry.startsWith('word/'))) {
      return ZIP_BASED_EXTENSION_MIME['.docx'];
    }
    if (entries.some((entry) => entry.startsWith('xl/'))) {
      return ZIP_BASED_EXTENSION_MIME['.xlsx'];
    }
    if (entries.some((entry) => entry.startsWith('ppt/'))) {
      return ZIP_BASED_EXTENSION_MIME['.pptx'];
    }

    if (entries.includes('mimetype')) {
      const odfMime = String(zip.readAsText('mimetype') || '').trim().toLowerCase();
      if (
        odfMime === ZIP_BASED_EXTENSION_MIME['.odt'] ||
        odfMime === ZIP_BASED_EXTENSION_MIME['.ods'] ||
        odfMime === ZIP_BASED_EXTENSION_MIME['.odp']
      ) {
        return odfMime;
      }
    }
  } catch {
    // Handled by fallback below.
  }

  return 'application/zip';
}

function isTextLikeBuffer(buffer: Buffer): boolean {
  if (!buffer.length) return true;
  const sample = buffer.subarray(0, Math.min(buffer.length, 4096));
  let suspicious = 0;

  for (const byte of sample) {
    if (byte === 0x00) return false;
    const isCommonControl = byte === 0x09 || byte === 0x0a || byte === 0x0d;
    if (byte < 0x20 && !isCommonControl) {
      suspicious += 1;
    }
  }

  return suspicious / sample.length < 0.02;
}

function assertSvgShape(buffer: Buffer): void {
  const content = buffer
    .subarray(0, Math.min(buffer.length, 8192))
    .toString('utf8')
    .toLowerCase();

  if (!content.includes('<svg')) {
    throw new BadRequestException('Invalid SVG file');
  }
  if (
    /<\s*script\b/.test(content) ||
    /\son[a-z0-9_-]+\s*=/.test(content) ||
    /\b(?:href|src)\s*=\s*["']?\s*(?:javascript:|data:text\/html|vbscript:)/.test(content) ||
    /<\s*foreignobject\b/.test(content)
  ) {
    throw new BadRequestException('Unsafe SVG file');
  }
}

function detectMimeFromBuffer(buffer: Buffer, extension: string): string | null {
  const signature = detectSignature(buffer);
  if (!signature) return null;

  if (signature === 'png') return 'image/png';
  if (signature === 'jpeg') return 'image/jpeg';
  if (signature === 'gif') return 'image/gif';
  if (signature === 'webp') return 'image/webp';
  if (signature === 'pdf') return 'application/pdf';
  if (signature === 'zip') return detectZipContainerMime(buffer);

  if (signature === 'ole') {
    return OLE_BASED_EXTENSION_MIME[extension] || 'application/x-ole-storage';
  }

  return null;
}

function assertTextMime(buffer: Buffer, mimeType: string): void {
  if (!isTextLikeBuffer(buffer)) {
    throw new BadRequestException('File content does not match declared text format');
  }

  if (mimeType === 'image/svg+xml') {
    assertSvgShape(buffer);
  }
}

function areMimeTypesEquivalent(a: string, b: string): boolean {
  return normalizeMimeType(a) === normalizeMimeType(b);
}

function unsupportedTypeMessage(scope: UploadValidationScope): string {
  if (scope === 'document-import') {
    return 'Unsupported file type. Allowed: DOCX';
  }
  if (scope === 'inline-image') {
    return 'Unsupported image type. Allowed: PNG, JPG, JPEG, GIF, WEBP';
  }
  if (scope === 'csv-import') {
    return 'Unsupported file type. Allowed: CSV';
  }
  return 'Unsupported file type';
}

export function isUploadTypeAllowedForScope(
  file: Pick<Express.Multer.File, 'mimetype' | 'originalname'>,
  options?: ValidateUploadOptions,
): boolean {
  const scope = options?.scope ?? 'attachment';
  const { allowedExtensions, allowedMimeTypes } = getScopeAllowedSets(scope);

  const extension = normalizeExtension(file.originalname);
  const mimeType = normalizeMimeType(file.mimetype);

  if (extension && allowedExtensions.has(extension)) return true;
  if (mimeType && !GENERIC_MIME_TYPES.has(mimeType) && allowedMimeTypes.has(mimeType)) return true;

  return false;
}

export function validateUploadedFile(
  input: UploadValidationInput,
  options?: ValidateUploadOptions,
): UploadValidationResult {
  const scope = options?.scope ?? 'attachment';
  const { allowedExtensions, allowedMimeTypes } = getScopeAllowedSets(scope);

  const extension = normalizeExtension(input.originalName);
  const clientMime = normalizeMimeType(input.mimeType);
  const size = Number(input.size || input.buffer.length || 0);

  if (!input.buffer || !Buffer.isBuffer(input.buffer) || input.buffer.length === 0) {
    throw new BadRequestException('Empty upload');
  }

  if (extension && !allowedExtensions.has(extension)) {
    throw new BadRequestException(unsupportedTypeMessage(scope));
  }

  if (clientMime && !GENERIC_MIME_TYPES.has(clientMime) && !allowedMimeTypes.has(clientMime)) {
    throw new BadRequestException(unsupportedTypeMessage(scope));
  }

  const detectedMime = detectMimeFromBuffer(input.buffer, extension);
  const extensionMime = extension ? EXTENSION_TO_MIME[extension] : '';

  if (detectedMime && extensionMime && !areMimeTypesEquivalent(detectedMime, extensionMime)) {
    throw new BadRequestException('File content does not match file extension');
  }

  let canonicalMime = detectedMime || extensionMime || '';

  if (!canonicalMime && clientMime && !GENERIC_MIME_TYPES.has(clientMime)) {
    canonicalMime = clientMime;
  }

  if (!canonicalMime) {
    throw new BadRequestException(unsupportedTypeMessage(scope));
  }

  canonicalMime = normalizeMimeType(canonicalMime);

  if (!allowedMimeTypes.has(canonicalMime)) {
    throw new BadRequestException(unsupportedTypeMessage(scope));
  }

  if (TEXT_LIKE_EXTENSIONS.has(extension) || TEXT_LIKE_MIME_TYPES.has(canonicalMime)) {
    assertTextMime(input.buffer, canonicalMime);
  }

  return {
    extension,
    mimeType: canonicalMime,
    size,
  };
}
