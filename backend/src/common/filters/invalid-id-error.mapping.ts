import { BadRequestException } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

/**
 * A route id that is not a uuid reaches PostgreSQL as a cast to `uuid` and
 * fails with SQLSTATE 22P02 (`invalid input syntax for type uuid`). That
 * answer is a 400 `INVALID_ID` instead of a 500. A 22P02 on another type, and
 * any other database error, stay a 500.
 *
 * A malformed uuid produced by a server bug takes the same 400: the database
 * error does not say whether the value came from the client or from the server.
 */
export const INVALID_ID_CODE = 'INVALID_ID';
export const INVALID_ID_MESSAGE = 'Invalid identifier.';

/** PostgreSQL's text for a value that cannot be cast to `uuid` (arrays included). */
const UUID_SYNTAX = /invalid input syntax for type uuid\b/i;

type DriverError = { code?: unknown; message?: unknown };

/** A 400 for a uuid `22P02`, or null for any other error. */
export function mapInvalidIdError(exception: unknown): BadRequestException | null {
  if (!(exception instanceof QueryFailedError)) return null;
  const driverError = exception.driverError as DriverError | undefined;
  if (!driverError || driverError.code !== '22P02') return null;
  const driverMessage = typeof driverError.message === 'string' ? driverError.message : '';
  if (!UUID_SYNTAX.test(`${exception.message}\n${driverMessage}`)) return null;
  return new BadRequestException({ code: INVALID_ID_CODE, message: INVALID_ID_MESSAGE });
}

/** One warning line: method, path and the answer. Never the rejected value. */
export function invalidIdLogLine(req: { method?: string; originalUrl?: string; url?: string } | undefined): string {
  return `[db] ${req?.method ?? ''} ${req?.originalUrl ?? req?.url ?? ''}: 22P02 invalid uuid answered 400 ${INVALID_ID_CODE}`;
}
