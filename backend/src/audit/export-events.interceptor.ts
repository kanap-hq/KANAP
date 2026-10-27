import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { concat, defer, EMPTY, from, Observable } from 'rxjs';
import { ignoreElements, mergeMap } from 'rxjs/operators';
import type { EntityManager } from 'typeorm';
import { writeAuditLog } from './audit.service';
import { exportEventEntry, exportFormatOfContentType, exportRoutePath } from './security-events';

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
 * One UPDATE then adds what the export sent: `format`, from the response's Content-Type (none
 * when it has none), and `rows` when the handler reports its count. It runs in the request
 * transaction, read again from the request at that moment (nothing when it was released), inside
 * a savepoint: a failed update leaves the export row as written and logs a warning.
 * - A handler that answers itself (`@Res()`, a download) calls `await completeExport(res, { rows })`
 *   once its headers are set and before it sends: no database work may follow the response, since
 *   the request finalizer (request-finalizer.middleware.ts) rolls back, on the response's
 *   'finish', a transaction whose commit has not started. One that does not call it keeps a row
 *   without format.
 * - A handler that returns a value is completed here, after it and before TenantInterceptor
 *   commits (Nest sends the value after that commit). Its Content-Type is the one `@Header` set.
 * After a response that has already left, this interceptor adds no step at all: the commit starts
 * as soon as the handler is done.
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
      mergeMap((rowId) => {
        if (rowId && req && typeof req === 'object') req[EXPORT_ROW] = { id: rowId, tenantId: String(tenantId), completed: false };
        return concat(
          next.handle(),
          defer(() => {
            // Completed by the handler, or a response that has left: nothing more, not even a tick.
            const row: ExportRow | undefined = req?.[EXPORT_ROW];
            if (!row || row.completed || res?.headersSent || res?.writableEnded) return EMPTY;
            return from(completeExportRow(req, res, row, undefined)).pipe(ignoreElements());
          }),
        );
      }),
    );
  }
}

const EXPORT_ROW = Symbol('kanap.exportRow');

type ExportRow = { id: string; tenantId: string; completed: boolean };

/**
 * Called by an export handler that answers itself (`@Res()`), after setting its headers and
 * before sending: writes the format of its Content-Type and, when given, the row count
 * (`after_json.rows`, a whole number of rows) on the request's export row, in the request
 * transaction, now. Once per request: later calls, and the interceptor's own step, do nothing.
 * Nothing on a request without an export row. Never rejects.
 */
export async function completeExport(res: unknown, report: { rows?: number } = {}): Promise<void> {
  const req: any = (res as { req?: unknown } | null | undefined)?.req;
  const row: ExportRow | undefined = req && typeof req === 'object' ? req[EXPORT_ROW] : undefined;
  if (!row || row.completed) return;
  const rows = report.rows;
  await completeExportRow(req, res, row, Number.isSafeInteger(rows) && (rows as number) >= 0 ? rows : undefined);
}

const logger = new Logger('ExportEventsInterceptor');
const SAVEPOINT = 'export_event_update';

/**
 * Adds the format the response is sent in and the count the handler reported to its export row,
 * in one UPDATE, and marks the row completed. Nothing when there is neither, or when the request
 * transaction is gone. Never rejects: a failed update is rolled back to its savepoint and logged.
 */
async function completeExportRow(req: any, res: any, row: ExportRow, rows: number | undefined): Promise<void> {
  row.completed = true;
  const patch: { format?: string; rows?: number } = {};
  const format = exportFormatOfContentType(typeof res?.getHeader === 'function' ? res.getHeader('Content-Type') : undefined);
  if (format) patch.format = format;
  if (rows !== undefined) patch.rows = rows;
  if (patch.format === undefined && patch.rows === undefined) return;
  const runner = req?.queryRunner;
  if (!runner || runner.isReleased || !runner.manager) return;
  const manager: EntityManager = runner.manager;
  try {
    await manager.query(`SAVEPOINT ${SAVEPOINT}`);
  } catch (error) {
    logger.warn(`export row ${row.id}: no savepoint, the format and count are not recorded: ${errorText(error)}`);
    return;
  }
  try {
    await manager.query(
      `UPDATE audit_log SET after_json = coalesce(after_json, '{}'::jsonb) || $1::jsonb
        WHERE id = $2 AND tenant_id = $3 AND table_name = 'export'`,
      [JSON.stringify(patch), row.id, row.tenantId],
    );
    await manager.query(`RELEASE SAVEPOINT ${SAVEPOINT}`);
  } catch (error) {
    logger.warn(`export row ${row.id}: the format and count are not recorded: ${errorText(error)}`);
    await manager.query(`ROLLBACK TO SAVEPOINT ${SAVEPOINT}`).catch(() => undefined);
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
