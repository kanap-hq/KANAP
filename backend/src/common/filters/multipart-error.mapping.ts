import { BadRequestException } from '@nestjs/common';

// Multipart refusals that @nestjs/platform-express passes on untranslated (it
// maps the other multer codes to 400 / 413 itself). Without this they would
// answer 500.
const MULTIPART_MESSAGES: Record<string, string> = {
  LIMIT_FIELD_ARRAY_INDEX: 'Field name array index too large',
  INVALID_FIELD_NAME: 'Invalid field name',
  STREAM_DESTROYED: 'The file upload was interrupted',
};

type MulterLikeError = { name?: unknown; code?: unknown; field?: unknown; message?: unknown };

/** A 400 for a multipart refusal raised by multer, or null for any other error. */
export function mapMultipartError(exception: unknown): BadRequestException | null {
  const error = exception as MulterLikeError | null;
  if (!error || error.name !== 'MulterError' || typeof error.code !== 'string') return null;
  const message = MULTIPART_MESSAGES[error.code] ?? (String(error.message || '') || 'Invalid multipart request');
  return new BadRequestException(typeof error.field === 'string' && error.field ? `${message} - ${error.field}` : message);
}
