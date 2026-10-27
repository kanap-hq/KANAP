import { BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import type { EntityManager } from 'typeorm';
import { completeExport } from '../../audit/export-events.interceptor';
import { DATA_ACCESS_HEADER } from '../../data-access/data-access';
import { contentDisposition } from '../content-disposition';
import { knownTimeZone } from '../csv-sheet/date';
import { languageOf, timeZoneOf } from '../csv-sheet/request-options';
import { parseExportFormat } from '../xlsx/format';
import type { ReportExportFile, ReportExportRequest } from './report-export';

/**
 * The controller side of a report export (report-export.ts):
 *
 *   @Get('<report>/export')            // same guard as the data route
 *   async export(@Query() query, @Tenant() ctx, @Res() res: Response) {
 *     const request = await reportExportRequest(query, ctx, ['months', 'teamIds']);
 *     const exp = buildMyReportExport(await this.svc.getReport(…same parameters…), request.language);
 *     res.send(await reportExportBody(res, writeReportExport(exp, request)));
 *   }
 *
 * `reportExportRequest` refuses a query key the report does not list (400), reads `format` (csv by
 * default), `language` (else the user's locale), `tz` (else the user's zone; a zone nobody knows is a 400)
 * and `table` when the report lists it, and the user's display name for the Parameters sheet.
 * `reportExportBody` sets the headers and records the format and the row count on the export's audit row
 * before the body is sent (`completeExport`: no database work may follow the response).
 */

/** Read by every report export: the file format, the language of its words, the user's zone. */
const COMMON_KEYS = ['format', 'language', 'tz'] as const;

export async function reportExportRequest(
  query: Record<string, unknown> | null | undefined,
  ctx: { manager?: EntityManager | null; tenantId: string; userId?: string | null },
  reportKeys: readonly string[],
): Promise<ReportExportRequest> {
  const manager = ctx.manager;
  if (!manager) throw new Error('A tenant-bound EntityManager is required');
  const source = query ?? {};
  const allowed = new Set<string>([...COMMON_KEYS, ...reportKeys]);
  const unknown = Object.keys(source).filter((key) => !allowed.has(key));
  if (unknown.length > 0) throw new BadRequestException(`Unknown parameter: ${unknown.join(', ')}.`);
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && typeof value !== 'string') throw new BadRequestException(`${key} must be given once.`);
  }
  const format = parseExportFormat(source.format);
  const userId = ctx.userId || null;
  const language = await languageOf(manager, ctx.tenantId, userId, source.language);
  const tz = typeof source.tz === 'string' ? source.tz.trim() : '';
  if (tz && !knownTimeZone(tz)) throw new BadRequestException('tz must be a known time zone.');
  const timeZone = await timeZoneOf(manager, ctx.tenantId, userId, tz || undefined);
  const table = reportKeys.includes('table') && typeof source.table === 'string' && source.table.trim() !== ''
    ? source.table.trim()
    : undefined;
  return { format, language, timeZone, table, generatedAt: new Date(), generatedBy: await displayName(manager, ctx.tenantId, userId) };
}

/** The headers of the file, its audit row completed, then the body to send: `res.send(await reportExportBody(res, file))`. */
export async function reportExportBody(res: Response, file: ReportExportFile): Promise<Buffer> {
  res.setHeader('Content-Type', file.contentType);
  res.setHeader('Content-Disposition', contentDisposition(file.filename));
  if (file.limited) res.setHeader(DATA_ACCESS_HEADER, 'limited');
  await completeExport(res, { rows: file.rows });
  return file.body;
}

/** The name a list shows for the user: first and last name, else the part of the email before @. */
async function displayName(manager: EntityManager, tenantId: string, userId: string | null): Promise<string> {
  if (!userId) return '';
  const rows: Array<{ name: string | null }> = await manager.query(
    `SELECT COALESCE(NULLIF(TRIM(CONCAT(first_name, ' ', last_name)), ''), split_part(email, '@', 1)) AS name
       FROM users WHERE tenant_id = $1 AND id = $2`,
    [tenantId, userId],
  );
  return rows[0]?.name ?? '';
}
