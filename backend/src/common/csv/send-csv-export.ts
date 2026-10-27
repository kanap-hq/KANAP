import type { Response } from 'express';
import { completeExport } from '../../audit/export-events.interceptor';
import { contentDisposition } from '../content-disposition';

/**
 * The headers of a list export route (`GET …/export`, csv or xlsx: the field engine's
 * `CsvExportResult`, or `writeListExport`'s file), and the body it sends:
 * `res.send(await csvExportBody(res, result))`. Before the body goes out, the export row of the
 * audit log gets the format and the number of rows the file holds (completeExport).
 */
export async function csvExportBody(
  res: Response,
  result: { filename: string; contentType: string; content: string | Buffer; rows: number; warnings?: readonly string[] },
): Promise<string | Buffer> {
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', contentDisposition(result.filename));
  if (result.warnings && result.warnings.length > 0) res.setHeader('X-CSV-Warnings', JSON.stringify(result.warnings));
  await completeExport(res, { rows: result.rows });
  return result.content;
}
