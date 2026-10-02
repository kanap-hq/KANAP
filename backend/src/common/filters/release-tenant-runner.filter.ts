import { ArgumentsHost, Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { QueryRunner } from 'typeorm';
import { attachErrorToResponse } from '../../admin/ops/request-metrics.middleware';
import { ClientAbortedError } from '../request-finalizer.middleware';
import {
  DatabaseConnectionError,
  databaseErrorLogLine,
  isReleasedRunnerError,
  mapDatabaseError,
} from './database-error.mapping';

/**
 * Global exception filter. Rolls back and releases the request's tenant runner
 * when an error escaped before TenantInterceptor finished it, then answers:
 * - a database error a race can cause (unique, foreign key, deadlock, lock or
 *   statement timeout) as 409 / 503 with a stable `code`, see
 *   `database-error.mapping.ts` (one warning line instead of a stack trace);
 * - a query refused because the request's connection ended while it held its
 *   transaction (TypeORM's "already released" errors on a runner left
 *   released with its transaction still active: the server ended a
 *   transaction left idle too long, the database restarted) as 503 `busy`:
 *   nothing the request wrote is committed, the client may try again;
 * - after the client aborted the request (`req._clientAborted`, set by
 *   `request-finalizer.middleware.ts`, which already rolled back): nothing,
 *   nobody is listening. The abort's own fallout (ClientAbortedError, the
 *   "already released" errors, a refusal below 500) is dropped quietly; any
 *   other error is logged at error level, since it may be a real fault;
 * - anything else as before (BaseExceptionFilter).
 */
@Catch()
export class ReleaseTenantRunnerFilter extends BaseExceptionFilter {
  constructor(adapter?: any) {
    super(adapter as any);
  }
  async catch(exception: any, host: ArgumentsHost) {
    const req: any = host.switchToHttp().getRequest();
    const res: any = host.switchToHttp().getResponse();
    const runner: QueryRunner | undefined = req?.queryRunner ?? undefined;
    // Read before any cleanup: TypeORM marks a runner whose connection ended
    // released, and never clears its transaction flag (no ROLLBACK reached it).
    const connectionLost = !!runner && (runner as any).isReleased === true && (runner as any).isTransactionActive === true;
    try {
      // Attach error details for the ops metrics middleware to pick up
      if (res && exception) attachErrorToResponse(res, exception);
      const already = !!req?._tenantRunnerReleased;
      if (runner && !already) {
        if ((runner as any).isReleased) {
          // Nothing left to roll back or release (a ROLLBACK would only fail on the released runner).
          req._tenantRunnerReleased = true;
        } else {
          try {
            // Roll back any active transaction to avoid keeping the connection in a bad state
            if ((runner as any).isTransactionActive) {
              try {
                await runner.rollbackTransaction();
              } catch (rollbackError) {
                // eslint-disable-next-line no-console
                console.error('[ReleaseTenantRunnerFilter] Rollback failed during exception handling:', rollbackError);
              }
            }
          } finally {
            try {
              if (!(runner as any).isReleased) {
                await runner.release();
              }
              req._tenantRunnerReleased = true;
            } catch (releaseError) {
              // eslint-disable-next-line no-console
              console.error('[ReleaseTenantRunnerFilter] CRITICAL: Connection release failed during exception handling:', releaseError);
            }
          }
        }
      }
    } catch (cleanupError) {
      // eslint-disable-next-line no-console
      console.error('[ReleaseTenantRunnerFilter] Cleanup error:', cleanupError);
    }

    if (req?._clientAborted) {
      if (!isClientAbortFallout(exception)) {
        // eslint-disable-next-line no-console
        console.error(`[request] ${req.method} ${req.originalUrl ?? req.url}: error after the client aborted (not answered):`, exception);
      }
      return;
    }

    const answered = connectionLost && isReleasedRunnerError(exception)
      ? new DatabaseConnectionError('connection lost', { cause: exception })
      : exception;
    const mapped = mapDatabaseError(answered);
    if (mapped) {
      if (mapped.retryAfterSeconds && typeof res?.setHeader === 'function' && !res.headersSent) {
        res.setHeader('Retry-After', String(mapped.retryAfterSeconds));
      }
      // eslint-disable-next-line no-console
      console.warn(databaseErrorLogLine(req, mapped));
      return super.catch(mapped.exception, host);
    }
    return super.catch(exception, host);
  }
}

/**
 * What a handler still running after the client aborted ends with because of
 * the abort: ClientAbortedError (the fenced runner), TypeORM's "already
 * released" errors (a runner the finalizer released), anywhere in the cause
 * chain, or an ordinary refusal (an HTTP status below 500).
 */
function isClientAbortFallout(exception: unknown): boolean {
  if (exception instanceof HttpException && exception.getStatus() < 500) return true;
  let current: unknown = exception;
  for (let depth = 0; current && depth < 5; depth++) {
    if (current instanceof ClientAbortedError || isReleasedRunnerError(current)) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
