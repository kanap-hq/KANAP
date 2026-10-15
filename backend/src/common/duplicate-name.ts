import { ConflictException, HttpStatus } from '@nestjs/common';

/**
 * The refusal of a name another record already has (whatever its case where the name is unique
 * ignoring case): the same answer as the database's unique key (409 `duplicate`, see
 * `filters/database-error.mapping.ts`), with a message that names what is taken. The pages show
 * their translated message under the name field.
 */
export function duplicateNameException(message: string): ConflictException {
  return new ConflictException({
    statusCode: HttpStatus.CONFLICT,
    error: 'Conflict',
    code: 'duplicate',
    message,
  });
}
