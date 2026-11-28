import { BadRequestException, HttpException } from '@nestjs/common';

/**
 * Stable codes for the causes of a failed GLPI connection, which the integration card translates
 * (`errors:<code>`). The English sentence of each refusal stays as it was, for the API and the
 * other callers (Kad's ticket import), and as the card's fallback.
 */
export const GLPI_ERROR_CODES = [
  'glpi_url_missing',
  'glpi_url_invalid',
  'glpi_user_token_missing',
  'glpi_token_needed_for_address',
  'glpi_token_unreadable',
  'glpi_user_token_invalid',
  'glpi_app_token_invalid',
  'glpi_ip_not_allowed',
  'glpi_unreachable',
  'glpi_timeout',
  'glpi_redirect',
  'glpi_invalid_response',
  'glpi_connection_failed',
] as const;

export type GlpiErrorCode = (typeof GLPI_ERROR_CODES)[number];

/** A failed test names one of these: a GLPI cause, or the common refusal of a target address. */
export type GlpiTestFailureCode = GlpiErrorCode | 'address_private_host' | 'address_unresolved';

const TEST_FAILURE_CODES = new Set<string>([...GLPI_ERROR_CODES, 'address_private_host', 'address_unresolved']);

/** A refusal with its code, in Nest's usual shape: `error.message` stays the English sentence. */
export function glpiBadRequest(code: GlpiErrorCode, message: string): BadRequestException {
  return new BadRequestException({ statusCode: 400, error: 'Bad Request', code, message });
}

/** The code of a GLPI answer that refuses the credentials or the caller (`ERROR_…`), if known. */
export function glpiApiErrorCode(apiCode: string | null, status?: number): GlpiErrorCode | null {
  switch (apiCode) {
    case 'ERROR_GLPI_LOGIN_USER_TOKEN':
    case 'ERROR_GLPI_LOGIN':
      return 'glpi_user_token_invalid';
    case 'ERROR_APP_TOKEN_PARAMETERS_MISSING':
    case 'ERROR_WRONG_APP_TOKEN_PARAMETER':
      return 'glpi_app_token_invalid';
    case 'ERROR_NOT_ALLOWED_IP':
      return 'glpi_ip_not_allowed';
    default:
      return status === 401 ? 'glpi_user_token_invalid' : null;
  }
}

/** The code a failed connection test returns: the one its refusal carries, else the generic one. */
export function glpiTestFailureCode(error: unknown): GlpiTestFailureCode {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    const code = response && typeof response === 'object' ? (response as { code?: unknown }).code : null;
    if (typeof code === 'string' && TEST_FAILURE_CODES.has(code)) return code as GlpiTestFailureCode;
  }
  return 'glpi_connection_failed';
}
