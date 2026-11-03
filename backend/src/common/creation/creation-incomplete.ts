import { BadRequestException } from '@nestjs/common';

/**
 * 400 `CREATION_INCOMPLETE`: "Create" of a record created at its title (`POST /<family>/:id/creation/
 * complete`) while it still lacks fields it needs. `params.fields` holds their stable keys, which the
 * screen names, marks and focuses; `names` only words the English message.
 */
export function creationIncomplete(fields: string[], names: string[]): BadRequestException {
  return new BadRequestException({
    statusCode: 400,
    error: 'Bad Request',
    code: 'CREATION_INCOMPLETE',
    message: `Missing: ${names.join(', ')}.`,
    params: { fields },
  });
}
