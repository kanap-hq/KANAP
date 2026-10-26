import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { concat, defer, from, Observable } from 'rxjs';
import { ignoreElements, mergeMap } from 'rxjs/operators';
import type { EntityManager } from 'typeorm';
import { writeAuditLog } from './audit.service';
import { exportEventEntry, exportFormatOfContentType, exportRoutePath, reportedExportRows } from './security-events';

/**
 * The one place every export is recorded: a route whose path ends with `/export` (the CSV and
 * file exports of the lists, reports and documents, and `POST /export`, the document export), or
 * a route marked `@ExportRoute()` (another file the server produces, such as the PDF report of an
 * incident), writes an `export` row to the tenant's audit log (security-events.ts) before its
 * handler runs: what was exported and the query asked for.
 *
 * Registered after `TenantInterceptor` (`request-pipeline.ts`), so the row is written in the
 * request's tenant transaction: it is committed with the request and rolled back with it when
 * the export fails. Guards run first, so a refused export writes nothing. A route without a
 * tenant transaction (public, `@SkipTenantTransaction`) writes nothing either.
 *
 * Once the handler has finished, one UPDATE adds what the export sent: `format`, from the
 * response's Content-Type (none when it has none), and `rows` when the handler reported its count
 * (`recordExportRows`). It runs in the request transaction, read again from the request at that
 * moment (nothing when it was released), inside a savepoint: a failed update leaves the export row
 * as written and logs a warning. TenantInterceptor commits only after this interceptor completes,
 * also for a handler that answers itself (`@Res()`), whose response has then already left.
 */
@Injectable()
export class ExportEventsInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const routePath = exportRoutePath(context.getClass(), context.getHandler());
    if (!routePath) return next.handle();
    const http = context.switchToHttp();
    const req: any = http.getRequest();
    const res: any = http.getResponse();
    const manager: EntityManager | undefined = req?.queryRunner?.isReleased ? undefined : req?.queryRunner?.manager;
    const tenantId: unknown = req?.tenant?.id;
    if (!manager || !tenantId) return next.handle();
    const entry = exportEventEntry(routePath, req);
    return from(writeAuditLog(manager, entry)).pipe(
      mergeMap((rowId) => concat(
        next.handle(),
        defer(() => from(completeExportRow(req, res, String(tenantId), rowId))).pipe(ignoreElements()),
      )),
    );
  }
}

const logger = new Logger('ExportEventsInterceptor');
const SAVEPOINT = 'export_event_update';

/**
 * Adds the format the response was sent in and the count the handler reported to its export row,
 * in one UPDATE. Nothing when there is neither, or when the request transaction is gone. Never
 * rejects: a failed update is rolled back to its savepoint and logged.
 */
async function completeExportRow(req: any, res: any, tenantId: string, rowId: string | null): Promise<void> {
  if (!rowId) return;
  const patch: { format?: string; rows?: number } = {};
  const format = exportFormatOfContentType(typeof res?.getHeader === 'function' ? res.getHeader('Content-Type') : undefined);
  if (format) patch.format = format;
  const rows = reportedExportRows(req);
  if (rows !== undefined) patch.rows = rows;
  if (patch.format === undefined && patch.rows === undefined) return;
  const runner = req?.queryRunner;
  if (!runner || runner.isReleased || !runner.manager) return;
  const manager: EntityManager = runner.manager;
  try {
    await manager.query(`SAVEPOINT ${SAVEPOINT}`);
  } catch (error) {
    logger.warn(`export row ${rowId}: no savepoint, the format and count are not recorded: ${errorText(error)}`);
    return;
  }
  try {
    await manager.query(
      `UPDATE audit_log SET after_json = coalesce(after_json, '{}'::jsonb) || $1::jsonb
        WHERE id = $2 AND tenant_id = $3 AND table_name = 'export'`,
      [JSON.stringify(patch), rowId, tenantId],
    );
    await manager.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
  } catch (error) {
    logger.warn(`export row ${rowId}: the format and count are not recorded: ${errorText(error)}`);
    await manager.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`).catch(() => undefined);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
