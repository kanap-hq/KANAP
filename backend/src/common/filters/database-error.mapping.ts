import { HttpException, HttpStatus } from '@nestjs/common';
import { QueryRunnerAlreadyReleasedError, QueryRunnerProviderAlreadyReleasedError } from 'typeorm';

/**
 * PostgreSQL errors that a concurrent write can cause, answered as a clean HTTP
 * error instead of a 500 (plan planning/perf-scale, lot 1D). The `code` is
 * stable: the frontend translates it (`errors:<code>`) and its autosave
 * retries `retry` and `busy` by itself (a bounded number of times, keeping the
 * change on screen meanwhile).
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
 * - DatabaseConnectionError: the request could not get a connection (pool
 *   exhausted, database unreachable), or its connection ended while it still
 *   held its transaction (the server ended it, see 25P03 above; nothing it
 *   wrote is committed)          → 503 `busy` with Retry-After
 *
 * Any other error is left alone (a 500, as before).
 */
export type DatabaseErrorCode = 'duplicate' | 'parent_gone' | 'in_use' | 'retry' | 'busy';

/** Seconds a client waits before retrying a `busy` answer. */
export const BUSY_RETRY_AFTER_SECONDS = 2;

const MESSAGES: Record<DatabaseErrorCode, string> = {
  duplicate: 'This record already exists. Reload the page to see the current data.',
  parent_gone: 'Something this change depends on was deleted in the meantime. Reload the page to see the current data.',
  in_use: 'This change would remove something that is still used elsewhere, so it was not saved.',
  retry: 'Another change to the same data was saved at the same moment, so this one did not go through. Please try again.',
  busy: 'This data is busy with another operation. Please try again in a few seconds.',
};

/** The `busy` message when the cause is the connection, not a lock or a long statement. */
const SERVER_BUSY_MESSAGE = 'The server is busy. Please try again in a few seconds.';

/**
 * The request's database connection is missing or gone:
 * - `no connection`: none could be obtained (the pool timed out waiting for a
 *   free connection, or the database is unreachable);
 * - `connection lost`: it ended while the request still held its transaction
 *   (the server ended a transaction left idle too long, the database
 *   restarted). The transaction is gone with it: nothing it wrote is committed.
 * Answered 503 `busy`.
 */
export class DatabaseConnectionError extends Error {
  constructor(readonly reason: 'no connection' | 'connection lost', options?: { cause?: unknown }) {
    super(reason === 'no connection'
      ? 'No database connection could be obtained for the request.'
      : 'The request\'s database connection ended while it held its transaction; nothing it wrote is committed.');
    this.name = 'DatabaseConnectionError';
    if (options && 'cause' in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

/** TypeORM's refusal to use a runner whose connection is released (by us, or by a lost connection). */
export function isReleasedRunnerError(error: unknown): boolean {
  return error instanceof QueryRunnerAlreadyReleasedError || error instanceof QueryRunnerProviderAlreadyReleasedError;
}

export type MappedDatabaseError = {
  code: DatabaseErrorCode;
  /** The SQLSTATE, or the DatabaseConnectionError reason: what the log line names. */
  cause: string;
  /** The table and constraint named by PostgreSQL, when it names them (for the logs; never the row values). */
  table?: string;
  constraint?: string;
  /** For `no connection`: the underlying error's message (a pool timeout, a refused connection). */
  note?: string;
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

function busyException(message: string, cause: unknown): HttpException {
  return new HttpException(
    { statusCode: HttpStatus.SERVICE_UNAVAILABLE, error: 'Service Unavailable', code: 'busy', message },
    HttpStatus.SERVICE_UNAVAILABLE,
    { cause },
  );
}

const nameOf = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

/** The HTTP answer for a database error a race can cause, or null for any other error. */
export function mapDatabaseError(error: unknown): MappedDatabaseError | null {
  if (error instanceof HttpException) return null;
  if (error instanceof DatabaseConnectionError) {
    const underlying = (error as { cause?: unknown }).cause;
    return {
      code: 'busy',
      cause: error.reason,
      // Why no connection could be had (a pool timeout, a refused connection); a lost one says nothing more.
      note: error.reason === 'no connection' && underlying instanceof Error ? underlying.message : undefined,
      exception: busyException(SERVER_BUSY_MESSAGE, error),
      retryAfterSeconds: BUSY_RETRY_AFTER_SECONDS,
    };
  }
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
  const e = error as { table?: unknown; constraint?: unknown; driverError?: { table?: unknown; constraint?: unknown } };
  return {
    code,
    cause: sqlState,
    table: nameOf(e?.driverError?.table ?? e?.table),
    constraint: nameOf(e?.driverError?.constraint ?? e?.constraint),
    exception,
    retryAfterSeconds: code === 'busy' ? BUSY_RETRY_AFTER_SECONDS : undefined,
  };
}

/**
 * The one warning line of a mapped error: method, path, SQLSTATE (or the
 * connection cause), table and constraint, and the answer. Never the driver's
 * `detail`, which quotes the row's values (personal data).
 */
export function databaseErrorLogLine(req: { method?: string; originalUrl?: string; url?: string } | undefined, mapped: MappedDatabaseError): string {
  const where = [mapped.table && `table ${mapped.table}`, mapped.constraint && `constraint ${mapped.constraint}`, mapped.note]
    .filter(Boolean)
    .join(', ');
  return `[db] ${req?.method ?? ''} ${req?.originalUrl ?? req?.url ?? ''}: ${mapped.cause}${where ? ` (${where})` : ''}`
    + ` answered ${mapped.exception.getStatus()} ${mapped.code}`;
}
