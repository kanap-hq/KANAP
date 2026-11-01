import { ForbiddenException, HttpStatus } from '@nestjs/common';

/**
 * A 403 that carries a translatable `code` (and `params` for the values its sentence names: a
 * right, a family, a module). The screen translates `errors:<code>`; `message` keeps the English
 * sentence a caller already had (the MCP server and the assistant read it).
 */
export function codedForbidden(
  code: string,
  message: string,
  params?: Record<string, unknown>,
): ForbiddenException {
  return new ForbiddenException({
    statusCode: HttpStatus.FORBIDDEN,
    error: 'Forbidden',
    code,
    message,
    ...(params ? { params } : {}),
  });
}

/**
 * 403 `MODULE_RIGHT_REQUIRED`: the person lacks the module right a route asks for. The screen
 * translates it (`errors:MODULE_RIGHT_REQUIRED`) and names the module and level in its own words.
 */
export function moduleRightRequired(
  resource: string,
  level: string,
  message = 'You do not have the rights for this action.',
): ForbiddenException {
  return codedForbidden('MODULE_RIGHT_REQUIRED', message, { resource, level });
}

/** 403 `REQUEST_CONTEXT_MISSING`: the request carries no tenant, user or access scope to act on. */
export function requestContextMissing(message: string): ForbiddenException {
  return codedForbidden('REQUEST_CONTEXT_MISSING', message);
}

/** 403 `BUSINESS_CONTRIBUTOR_NO_ACCESS`: a Business Contributor has no access to this family. */
export function businessContributorNoAccess(family: string, message: string): ForbiddenException {
  return codedForbidden('BUSINESS_CONTRIBUTOR_NO_ACCESS', message, { family });
}

/** 403 `BUSINESS_CONTRIBUTOR_SCOPE`: a Business Contributor reaches only the records they are assigned to. */
export function businessContributorScope(family: string, message: string): ForbiddenException {
  return codedForbidden('BUSINESS_CONTRIBUTOR_SCOPE', message, { family });
}

/** 403 `OUTSIDE_PARTICIPATION`: a Business Contributor links only the records they take part in. */
export function outsideParticipation(family: string, message: string): ForbiddenException {
  return codedForbidden('OUTSIDE_PARTICIPATION', message, { family });
}
