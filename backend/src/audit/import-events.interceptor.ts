import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { from, Observable } from 'rxjs';
import { map, mergeMap } from 'rxjs/operators';
import type { EntityManager } from 'typeorm';
import { fixMulterFilename } from '../common/upload';
import { importRouteOf, writeImportEvent, type ImportRouteMetadata } from './security-events';

/**
 * The one place every import of a screen is recorded: a route marked `@ImportRoute('<list>')`
 * writes one `import` row to the tenant's audit log (security-events.ts) once its handler has
 * answered with a load that succeeded: the list, the name of the file sent, and the counts the
 * route's reader takes from its answer. A check (`dryRun`), a refused file (`ok: false`) and a
 * handler that fails write nothing. One row per request, whatever the number of rows.
 *
 * Registered after `TenantInterceptor` (`request-pipeline.ts`), so the row is written in the
 * request's tenant transaction, after the handler and before TenantInterceptor commits (it lets
 * the value through only once the row is written): committed with the import, rolled back with
 * it. Guards run first, so a refused request writes nothing. A route without a tenant
 * transaction writes nothing either.
 *
 * A handler that commits the request itself before it returns (the budget file's load, whose
 * `analyzeAfterLargeImport` commits and gives the connection back) calls `recordImport(req, result)`
 * first; the interceptor then writes nothing more.
 */
@Injectable()
export class ImportEventsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const route = importRouteOf(context.getHandler());
    if (!route) return next.handle();
    const req: any = context.switchToHttp().getRequest();
    if (!req || typeof req !== 'object') return next.handle();
    req[IMPORT_ROUTE] = { route, recorded: false } satisfies PendingImport;
    return next.handle().pipe(mergeMap((value) => from(recordImport(req, value)).pipe(map(() => value))));
  }
}

const IMPORT_ROUTE = Symbol('kanap.importRoute');

type PendingImport = { route: ImportRouteMetadata; recorded: boolean };

const logger = new Logger('ImportEventsInterceptor');

/**
 * Writes the `import` row of the request's import route for `result`, now, in the request
 * transaction: nothing when the request is not an import route, when its row is already written,
 * or when `result` is not a load that succeeded. Once per request.
 */
export async function recordImport(req: unknown, result: unknown): Promise<void> {
  const pending: PendingImport | undefined = req && typeof req === 'object' ? (req as any)[IMPORT_ROUTE] : undefined;
  if (!pending || pending.recorded) return;
  const counts = pending.route.counts(result);
  if (!counts) return;
  const request = req as any;
  const runner = request.queryRunner;
  const manager: EntityManager | undefined = runner && !runner.isReleased ? runner.manager : undefined;
  if (!manager || !request.tenant?.id) {
    // Committed before the row could be written: say so, a load must not go unrecorded unnoticed.
    if (request.tenant?.id) logger.warn(`${pending.route.list}: the import was committed before its audit row was written`);
    return;
  }
  pending.recorded = true;
  const userId = typeof request.user?.sub === 'string' && request.user.sub ? request.user.sub : null;
  const filename = fixMulterFilename(request.file?.originalname) || null;
  await writeImportEvent(manager, { list: pending.route.list, filename, counts, userId });
}
