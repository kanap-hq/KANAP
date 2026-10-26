import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { concat, defer, from, Observable } from 'rxjs';
import { ignoreElements, mergeMap } from 'rxjs/operators';
import type { EntityManager } from 'typeorm';
import { writeAuditLog } from './audit.service';
import { declaredExportFormat, exportEventEntry, exportRoutePath, reportedExportRows } from './security-events';

/**
 * The one place every export is recorded: a route whose path ends with `/export` (the CSV and
 * file exports of the lists, reports and documents, and `POST /export`, the document export), or
 * a route marked `@ExportRoute()` (another file the server produces, such as the PDF report of an
 * incident), writes an `export` row to the tenant's audit log (security-events.ts) before its
 * handler runs: what was exported, its format and the query asked for.
 *
 * Registered after `TenantInterceptor` (`request-pipeline.ts`), so the row is written in the
 * request's tenant transaction: it is committed with the request and rolled back with it when
 * the export fails. Guards run first, so a refused export writes nothing. A route without a
 * tenant transaction (public, `@SkipTenantTransaction`) writes nothing either.
 *
 * When the handler reports its row count (`recordExportRows`), the row gets `rows` once the
 * handler has finished, still in the request transaction: TenantInterceptor commits only after
 * this interceptor completes, also for a handler that answers itself (`@Res()`), whose response
 * has then already left.
 */
@Injectable()
export class ExportEventsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const routePath = exportRoutePath(context.getClass(), context.getHandler());
    if (!routePath) return next.handle();
    const req: any = context.switchToHttp().getRequest();
    const manager: EntityManager | undefined = req?.queryRunner?.isReleased ? undefined : req?.queryRunner?.manager;
    const tenantId: unknown = req?.tenant?.id;
    if (!manager || !tenantId) return next.handle();
    const entry = exportEventEntry(routePath, req, declaredExportFormat(context.getHandler()));
    return from(writeAuditLog(manager, entry)).pipe(
      mergeMap((rowId) => concat(
        next.handle(),
        defer(() => from(recordRowCount(manager, req, String(tenantId), rowId))).pipe(ignoreElements()),
      )),
    );
  }
}

/** Writes the count the handler reported on its export row. Nothing when it reported none. */
async function recordRowCount(manager: EntityManager, req: unknown, tenantId: string, rowId: string | null): Promise<void> {
  const rows = reportedExportRows(req);
  if (rows === undefined || !rowId) return;
  await manager.query(
    `UPDATE audit_log SET after_json = jsonb_set(coalesce(after_json, '{}'::jsonb), '{rows}', to_jsonb($1::bigint))
      WHERE id = $2 AND tenant_id = $3 AND table_name = 'export'`,
    [rows, rowId, tenantId],
  );
}
