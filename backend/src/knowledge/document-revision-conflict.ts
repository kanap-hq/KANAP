import { ConflictException, HttpStatus } from '@nestjs/common';

/**
 * Code of the 409 that refuses a write of a document whose revision moved since it was read (an
 * autosave after an import of the record's text, a second tab). The screens translate it
 * (`errors:document_revision_conflict`); the message stays the API's sentence.
 */
export const DOCUMENT_REVISION_CONFLICT = 'document_revision_conflict';

export function documentRevisionConflict(): ConflictException {
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    code: DOCUMENT_REVISION_CONFLICT,
    message: 'Document revision conflict',
  });
}
