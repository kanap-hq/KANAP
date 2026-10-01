import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, from, throwError } from 'rxjs';
import { DataSource, QueryRunner } from 'typeorm';
import { catchError, finalize, mergeMap } from 'rxjs/operators';
import { IS_PUBLIC_KEY } from '../auth/public.decorator';
import { SKIP_TENANT_TRANSACTION_KEY } from './skip-tenant-transaction.decorator';
import { DatabaseConnectionError } from './filters/database-error.mapping';
import { connectRequestRunner, rememberRequestDbTimeouts, resolveRequestDbTimeouts, startTenantTransaction } from './request-db-timeouts';

@Injectable()
export class TenantInterceptor implements NestInterceptor {
  constructor(
    private readonly dataSource: DataSource,
    private readonly reflector: Reflector,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return next.handle();

    const skipTenantTransaction = this.reflector.getAllAndOverride<boolean>(
      SKIP_TENANT_TRANSACTION_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (skipTenantTransaction) return next.handle();

    const http = context.switchToHttp();
    const req: any = http.getRequest();
    const tenantId: string | undefined = req?.tenant?.id;
    if (!tenantId) return next.handle();

    // Reuse runner if a guard already created it; otherwise create here
    const existing: QueryRunner | undefined = (req as any).queryRunner;
    const ownedByGuard: boolean = !!(req as any)._tenantRunnerOwner;
    const runner: QueryRunner = existing ?? this.dataSource.createQueryRunner();
    // Commit on success, roll back when the handler fails. Ownership: a runner
    // the handler swapped in, the runner opened here, or the one TenantInitGuard
    // opened; a runner someone else opened is theirs to finish.
    const finish = async (outcome: 'commit' | 'rollback') => {
      const activeRunner: QueryRunner | undefined = (req as any).queryRunner;
      if (activeRunner && activeRunner !== runner) {
        await finishRunner(req, activeRunner, outcome, {
          commit: '[TenantInterceptor] Swapped runner commit failed:',
          rollback: '[TenantInterceptor] Swapped runner rollback failed:',
          release: '[TenantInterceptor] CRITICAL: Swapped runner release failed:',
        });
        return;
      }

      if (!existing) {
        await finishRunner(req, runner, outcome, {
          commit: '[TenantInterceptor] Commit failed:',
          rollback: '[TenantInterceptor] Rollback failed:',
          release: '[TenantInterceptor] CRITICAL: Connection release failed:',
        });
      } else if (ownedByGuard) {
        await finishRunner(req, runner, outcome, {
          commit: '[TenantInterceptor] Guard-owned commit failed:',
          rollback: '[TenantInterceptor] Guard-owned rollback failed:',
          release: '[TenantInterceptor] CRITICAL: Guard-owned connection release failed:',
        });
      }
    };

    // Set once the commit or the rollback path has started: a runner is finished once.
    let finished = false;
    return from((async () => {
      if (!existing) {
        // No free connection: 503 busy (connectRequestRunner), not a 500.
        await connectRequestRunner(runner);
        const timeouts = resolveRequestDbTimeouts(this.reflector, context);
        await startTenantTransaction(runner, tenantId, timeouts);
        rememberRequestDbTimeouts(req, timeouts);
        (req as any).queryRunner = runner;
      }
      return true;
    })()).pipe(
      mergeMap(() => next.handle()),
      // A handler that fails after writing must not have its writes committed:
      // roll back and release before the error reaches the exception filter,
      // whose own rollback then finds nothing left to do.
      catchError((error) => {
        finished = true;
        return from(finish('rollback')).pipe(mergeMap(() => throwError(() => error)));
      }),
      // Success path: commit, then let the value through, so the response never
      // leaves before COMMIT returns. After catchError on purpose: a failed commit
      // is already rolled back and released, its error goes to the exception filter.
      // A handler that already answered itself (@Res() download) keeps its answer;
      // the commit error is logged.
      commitBeforeValue(async () => {
        finished = true;
        try {
          await finish('commit');
        } catch (error) {
          if (!http.getResponse()?.headersSent) throw error;
        }
      }),
      // Safety net, unsubscribed before completion: neither path ran, commit as
      // before. A failed handler never commits, even if its rollback or release
      // did not go through. A commit error here is already logged.
      finalize(() => {
        if (!finished) void finish('commit').catch(() => undefined);
      }),
    );
  }
}

/**
 * Holds the source's last value, runs `commit` once the source completes, then
 * emits that value (if any) and completes; a commit error is emitted as the
 * error. Nest reads a non-SSE handler with lastValueFrom (one value, the last
 * wins), so nothing is lost. An SSE route would only get its events at the end:
 * it must use @SkipTenantTransaction().
 */
function commitBeforeValue<T>(commit: () => Promise<void>) {
  return (source: Observable<T>) => new Observable<T>((subscriber) => {
    let hasValue = false;
    let lastValue: T;
    return source.subscribe({
      next: (value) => {
        hasValue = true;
        lastValue = value;
      },
      error: (error) => subscriber.error(error),
      complete: () => {
        commit().then(
          () => {
            if (hasValue) subscriber.next(lastValue);
            subscriber.complete();
          },
          (error) => subscriber.error(error),
        );
      },
    });
  });
}

type RunnerLabels = { commit: string; rollback: string; release: string };

/**
 * Commits or rolls back the runner, then releases it. A commit error is
 * rethrown once the runner is rolled back and released, so the request
 * answers 500 (or 409 / 503 for a database error a race can cause).
 * Rollback and release errors are only logged.
 *
 * A runner whose connection ended while the request held its transaction
 * (the server ended a transaction left idle too long, the database
 * restarted) is released by TypeORM with its transaction still marked
 * active, and nothing it wrote is committed. On the commit path that is a
 * DatabaseConnectionError (503 `busy`), never a success: answering 2xx would
 * claim changes that are gone.
 */
async function finishRunner(req: any, candidate: QueryRunner | undefined, outcome: 'commit' | 'rollback', labels: RunnerLabels) {
  if (!candidate) return;
  if (candidate.isReleased) {
    if (candidate.isTransactionActive) {
      if (req?.queryRunner === candidate) req._tenantRunnerReleased = true;
      if (outcome === 'commit') throw new DatabaseConnectionError('connection lost');
    }
    return;
  }

  try {
    if (candidate.isTransactionActive) {
      if (outcome === 'commit') {
        // A client abort from now on leaves the runner to us (request-finalizer.middleware.ts).
        if (req && req.queryRunner === candidate) req._tenantCommitStarted = true;
        try {
          await candidate.commitTransaction();
        } catch (commitError) {
          // The connection ended under the COMMIT: the transaction is gone with it.
          if (candidate.isReleased) throw new DatabaseConnectionError('connection lost', { cause: commitError });
          console.error(labels.commit, commitError);
          try {
            if (candidate.isTransactionActive) {
              await candidate.rollbackTransaction();
            }
          } catch (rollbackError) {
            console.error(labels.rollback, rollbackError);
          }
          throw commitError;
        }
      } else {
        try {
          await candidate.rollbackTransaction();
        } catch (rollbackError) {
          console.error(labels.rollback, rollbackError);
        }
      }
    }
  } finally {
    if (!candidate.isReleased) {
      try {
        await candidate.release();
        req._tenantRunnerReleased = true;
      } catch (releaseError) {
        console.error(labels.release, releaseError);
      }
    } else if (req?.queryRunner === candidate) {
      req._tenantRunnerReleased = true;
    }
  }
}
