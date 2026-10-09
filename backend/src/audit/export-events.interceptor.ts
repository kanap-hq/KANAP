import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import type { EntityManager } from 'typeorm';
import { writeAuditLog } from './audit.service';
import { exportEventEntry, exportRoutePath } from './security-events';

/**
 * The one place every export is recorded: a route whose path ends with `/export` (the CSV and
 * file exports of the lists, reports and documents, and `POST /export`, the document export), or
 * a route marked `@ExportRoute()` (another file the server produces, such as the PDF report of an
 * incident), writes an `export` row to the tenant's audit log (security-events.ts) before its
 * handler runs.
 *
 * Registered after `TenantInterceptor` (`request-pipeline.ts`), so the row is written in the
 * request's tenant transaction: it is committed with the request and rolled back with it when
 * the export fails. Guards run first, so a refused export writes nothing. A route without a
 * tenant transaction (public, `@SkipTenantTransaction`) writes nothing either.
 */
@Injectable()
export class ExportEventsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const routePath = exportRoutePath(context.getClass(), context.getHandler());
    if (!routePath) return next.handle();
    const req: any = context.switchToHttp().getRequest();
    const manager: EntityManager | undefined = req?.queryRunner?.isReleased ? undefined : req?.queryRunner?.manager;
    if (!manager || !req?.tenant?.id) return next.handle();
    return from(writeAuditLog(manager, exportEventEntry(routePath, req))).pipe(mergeMap(() => next.handle()));
  }
}
