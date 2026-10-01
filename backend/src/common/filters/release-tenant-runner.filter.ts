import { ArgumentsHost, Catch } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { QueryRunner } from 'typeorm';
import { attachErrorToResponse } from '../../admin/ops/request-metrics.middleware';
import { mapDatabaseError } from './database-error.mapping';

/**
 * Global exception filter. Rolls back and releases the request's tenant runner
 * when an error escaped before TenantInterceptor finished it, then answers:
 * - a database error a race can cause (unique, foreign key, deadlock, lock or
 *   statement timeout) as 409 / 503 with a stable `code`, see
 *   `database-error.mapping.ts` (one warning line instead of a stack trace);
 * - after the client aborted the request (`req._clientAborted`, set by the
 *   finalizer in main.ts, which already rolled back): nothing, quietly. The
 *   handler kept running on a released runner, so the error it ends with is
 *   noise, and nobody is listening for the answer;
 * - anything else as before (BaseExceptionFilter).
 */
@Catch()
export class ReleaseTenantRunnerFilter extends BaseExceptionFilter {
  constructor(adapter?: any) {
    super(adapter as any);
  }
  async catch(exception: any, host: ArgumentsHost) {
    try {
      const ctx = host.switchToHttp();
      const req: any = ctx.getRequest();
      const res: any = ctx.getResponse();
      const runner: QueryRunner | undefined = req?.queryRunner;

      // Attach error details for the ops metrics middleware to pick up
      if (res && exception) attachErrorToResponse(res, exception);
      const already = !!req?._tenantRunnerReleased;
      if (runner && !already) {
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
    } catch (cleanupError) {
      // eslint-disable-next-line no-console
      console.error('[ReleaseTenantRunnerFilter] Cleanup error:', cleanupError);
    }

    const req: any = host.switchToHttp().getRequest();
    if (req?._clientAborted) return;

    const mapped = mapDatabaseError(exception);
    if (mapped) {
      const res: any = host.switchToHttp().getResponse();
      if (mapped.retryAfterSeconds && typeof res?.setHeader === 'function' && !res.headersSent) {
        res.setHeader('Retry-After', String(mapped.retryAfterSeconds));
      }
      // eslint-disable-next-line no-console
      console.warn(
        `[db] ${req?.method ?? ''} ${req?.originalUrl ?? req?.url ?? ''}: ${mapped.sqlState}`
        + `${mapped.constraint ? ` (${mapped.constraint})` : ''} answered ${mapped.exception.getStatus()} ${mapped.code}`,
      );
      return super.catch(mapped.exception, host);
    }
    return super.catch(exception, host);
  }
}
