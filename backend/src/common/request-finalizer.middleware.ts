import { NextFunction } from 'express';

/**
 * Express middleware (main.ts) that makes sure the request's tenant runner is
 * finished whatever happens: on 'finish' or 'close', a runner still held by
 * the request is rolled back and released.
 *
 * A 'close' before the response finished, while the request still holds its
 * runner, is a client abort (the browser navigated away, the proxy cut the
 * request). The transaction is rolled back, so nothing the handler wrote is
 * committed, and the connection goes back to the pool while the handler keeps
 * running (its JavaScript is not interrupted). Before the rollback the runner
 * is fenced: a query the handler sends from then on fails at once with
 * ClientAbortedError instead of reaching the connection. Without the fence it
 * could run between the ROLLBACK and the release, outside any transaction and
 * without tenant (row level security refused it, the logs filled with RLS
 * violations). `req._clientAborted` tells ReleaseTenantRunnerFilter to drop the
 * handler's final error quietly: the one warning line logged here is the only
 * trace of the abort.
 */
export class ClientAbortedError extends Error {
  constructor() {
    super('The client aborted the request; its transaction was rolled back.');
    this.name = 'ClientAbortedError';
  }
}

/** Lets only the rollback through: every other query of the runner fails with ClientAbortedError. */
function fenceRunner(runner: any) {
  if (runner.__clientAbortFence) return;
  const original = runner.query.bind(runner);
  runner.__clientAbortFence = true;
  runner.query = (sql: unknown, ...rest: unknown[]) => (
    typeof sql === 'string' && /^\s*ROLLBACK\b/i.test(sql) ? original(sql, ...rest) : Promise.reject(new ClientAbortedError())
  );
}

export function createRequestFinalizer() {
  return (req: any, res: any, next: NextFunction) => {
    const finalize = async (aborted: boolean) => {
      const runner = req?.queryRunner;
      if (!runner || req?._tenantRunnerReleased) return;
      if (aborted && !req._clientAborted) {
        req._clientAborted = true;
        fenceRunner(runner);
        // eslint-disable-next-line no-console
        console.warn(`[request] ${req.method} ${req.originalUrl ?? req.url}: client aborted, transaction rolled back`);
      }
      try {
        // One rollback per open level (a nested TypeORM transaction is a savepoint).
        for (let level = 0; runner.isTransactionActive && level < 10; level++) {
          try {
            await runner.rollbackTransaction();
          } catch (e: any) {
            // eslint-disable-next-line no-console
            console.error('[Finalizer] Rollback failed:', e);
            break;
          }
        }
      } finally {
        try {
          if (!runner.isReleased) await runner.release();
          req._tenantRunnerReleased = true;
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.error('[Finalizer] CRITICAL: Connection release failed:', e);
        }
      }
    };
    res.on('finish', () => { void finalize(false); });
    res.on('close', () => { void finalize(!res.writableFinished); });
    next();
  };
}
