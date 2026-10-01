import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * PostgreSQL errors that a concurrent write can cause, answered as a clean HTTP
 * error instead of a 500 (plan planning/perf-scale, lot 1D). The `code` is
 * stable: the frontend translates it (`errors:<code>`) and its autosave keeps
 * the pending change, retrying `retry` and `busy` by itself.
 *
 * - 23505 unique_violation        → 409 `duplicate`
 * - 23503 foreign_key_violation   → 409 `parent_gone` (the row written points
 *   to a row deleted meanwhile), or 409 `in_use` when a DELETE is refused
 *   because other rows still point to the deleted one
 * - 40P01 deadlock_detected,
 *   40001 serialization_failure   → 409 `retry`
 * - 55P03 lock_not_available (lock_timeout),
 *   57014 query_canceled (statement_timeout),
 *   25P03 idle_in_transaction_session_timeout (the server ended a request
 *   transaction left idle too long, e.g. a saturated event loop)
 *                                 → 503 `busy` with Retry-After
 *
 * Any other error is left alone (a 500, as before).
 */
export type DatabaseErrorCode = 'duplicate' | 'parent_gone' | 'in_use' | 'retry' | 'busy';

/** Seconds a client waits before retrying a `busy` answer. */
export const BUSY_RETRY_AFTER_SECONDS = 2;

const MESSAGES: Record<DatabaseErrorCode, string> = {
  duplicate: 'This record already exists. Reload the page to see the current data.',
  parent_gone: 'Something this change depends on was deleted in the meantime. Reload the page to see the current data.',
  in_use: 'This record is still used elsewhere, so it cannot be deleted.',
  retry: 'Another change was saved at the same moment. Please try again.',
  busy: 'This data is busy with another operation. Please try again in a few seconds.',
};

export type MappedDatabaseError = {
  code: DatabaseErrorCode;
  sqlState: string;
  /** The constraint named by PostgreSQL, when it names one (for the logs). */
  constraint?: string;
  exception: HttpException;
  /** Seconds for the Retry-After header (`busy` only). */
  retryAfterSeconds?: number;
};

/** The SQLSTATE of a database error: TypeORM wraps the driver error in a QueryFailedError. */
export function sqlStateOf(error: unknown): string | undefined {
  const e = error as { code?: unknown; driverError?: { code?: unknown } } | null | undefined;
  const code = e?.driverError?.code ?? e?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? code : undefined;
}

function codeFor(sqlState: string, error: unknown): DatabaseErrorCode | null {
  switch (sqlState) {
    case '23505':
      return 'duplicate';
    case '23503': {
      // A DELETE refused by a key pointing at the deleted row, or a row that points to a row gone meanwhile.
      const query = (error as { query?: unknown } | null)?.query;
      return typeof query === 'string' && /^\s*DELETE\b/i.test(query) ? 'in_use' : 'parent_gone';
    }
    case '40P01':
    case '40001':
      return 'retry';
    case '55P03':
    case '57014':
    case '25P03':
      return 'busy';
    default:
      return null;
  }
}

/** The HTTP answer for a database error a race can cause, or null for any other error. */
export function mapDatabaseError(error: unknown): MappedDatabaseError | null {
  if (error instanceof HttpException) return null;
  const sqlState = sqlStateOf(error);
  if (!sqlState) return null;
  const code = codeFor(sqlState, error);
  if (!code) return null;
  const status = code === 'busy' ? HttpStatus.SERVICE_UNAVAILABLE : HttpStatus.CONFLICT;
  const exception = new HttpException(
    { statusCode: status, error: status === HttpStatus.CONFLICT ? 'Conflict' : 'Service Unavailable', code, message: MESSAGES[code] },
    status,
    { cause: error },
  );
  const e = error as { constraint?: unknown; driverError?: { constraint?: unknown } };
  const constraint = e?.driverError?.constraint ?? e?.constraint;
  return {
    code,
    sqlState,
    constraint: typeof constraint === 'string' ? constraint : undefined,
    exception,
    retryAfterSeconds: code === 'busy' ? BUSY_RETRY_AFTER_SECONDS : undefined,
  };
}
