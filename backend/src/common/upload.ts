// Shared upload configuration for attachments
// Aligns attachment upload size across workspaces
import { BadRequestException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import * as path from 'path';
import { CSV_DECODE_MESSAGES, CsvDecodeErrorCode } from './csv-sheet/decode';
import { isUploadTypeAllowedForScope, UploadValidationScope } from './upload-validation';

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024; // 20 MB
export const CSV_IMPORT_MAX_BYTES = 1 * 1024 * 1024; // 1 MB

/**
 * Limits of every multipart upload besides the file size. The app sends one
 * file and at most one text field (`snapshot`, `kind` or `source_field`), with
 * flat names. `fieldSize` keeps multer's default (1 MB), except for the budget
 * file (`spend/budget-file/upload.ts`).
 */
export const MULTIPART_LIMITS = {
  files: 1,
  fields: 10,
  parts: 11,
  fieldNameSize: 100,
  fieldNestingDepth: 2,
  fieldArrayIndexLimit: 10,
} as const;

export type MultipartLimits = typeof MULTIPART_LIMITS & { fileSize: number };

/**
 * The bytes of an uploaded file. Uploads stay in memory (no route configures multer disk
 * storage), so a file is its buffer; reading a path the request names is never needed.
 */
export function uploadedBytes(file: Express.Multer.File | undefined): Buffer {
  if (!file) throw new BadRequestException('No file uploaded');
  if (!file.buffer) throw new BadRequestException('Empty upload');
  return file.buffer;
}

export function multipartLimits(fileSize: number): MultipartLimits {
  return { ...MULTIPART_LIMITS, fileSize };
}

/** A CSV import refuses a workbook by its name with the sentence that says how to save it as CSV. */
function csvRefusalCode(originalName: string | undefined): CsvDecodeErrorCode {
  const extension = path.extname(String(originalName || '')).toLowerCase();
  if (['.xlsx', '.xlsm', '.xls'].includes(extension)) return 'CSV_FILE_EXCEL';
  if (extension === '.ods') return 'CSV_FILE_OPENDOCUMENT';
  return 'CSV_FILE_NOT_TEXT';
}

const buildFileFilter = (scope: UploadValidationScope): NonNullable<MulterOptions['fileFilter']> => {
  return (_req, file, cb) => {
    if (isUploadTypeAllowedForScope(file, { scope })) {
      cb(null, true);
      return;
    }

    if (scope === 'inline-image') {
      cb(new BadRequestException('Unsupported image type. Allowed: PNG, JPG, JPEG, GIF, WEBP'), false);
      return;
    }
    if (scope === 'document-import') {
      cb(new BadRequestException('Unsupported file type. Allowed: DOCX'), false);
      return;
    }
    if (scope === 'csv-import') {
      const code = csvRefusalCode(file.originalname);
      cb(new BadRequestException({ message: CSV_DECODE_MESSAGES[code], code }), false);
      return;
    }

    cb(new BadRequestException('Unsupported file type'), false);
  };
};

export const attachmentMulterOptions: MulterOptions = {
  limits: multipartLimits(ATTACHMENT_MAX_BYTES),
  fileFilter: buildFileFilter('attachment'),
};

export const inlineImageMulterOptions: MulterOptions = {
  limits: multipartLimits(ATTACHMENT_MAX_BYTES),
  fileFilter: buildFileFilter('inline-image'),
};

export const documentImportMulterOptions: MulterOptions = {
  limits: multipartLimits(ATTACHMENT_MAX_BYTES),
  fileFilter: buildFileFilter('document-import'),
};

export const csvImportMulterOptions: MulterOptions = {
  limits: multipartLimits(CSV_IMPORT_MAX_BYTES),
  fileFilter: buildFileFilter('csv-import'),
};

/** Re-decode multer's latin1-mangled filename back to UTF-8 */
export function fixMulterFilename(name: string | undefined): string {
  if (!name) return '';
  try {
    return Buffer.from(name, 'latin1').toString('utf8');
  } catch {
    return name;
  }
}
