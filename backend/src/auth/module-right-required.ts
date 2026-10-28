import { ForbiddenException, HttpStatus } from '@nestjs/common';

/**
 * 403 `MODULE_RIGHT_REQUIRED`: the person lacks the module right a route asks for. The screen
 * translates it (`errors:MODULE_RIGHT_REQUIRED`) and names the module and level in its own words.
 * `message` keeps the English sentence a caller already had (the MCP and the assistant read it).
 */
export function moduleRightRequired(
  resource: string,
  level: string,
  message = 'You do not have the rights for this action.',
): ForbiddenException {
  return new ForbiddenException({
    statusCode: HttpStatus.FORBIDDEN,
    error: 'Forbidden',
    code: 'MODULE_RIGHT_REQUIRED',
    message,
    params: { resource, level },
  });
}
