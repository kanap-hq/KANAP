import type { Response } from 'express';
import { completeExport } from '../../audit/export-events.interceptor';
import { contentDisposition } from '../content-disposition';
import type { CsvExportResult } from './csv-field.types';
import type { ExportFileFormat } from '../xlsx/format';

/**
 * The headers of a field-engine export route (`GET …/export`, csv or xlsx), and the body it sends:
 * `res.send(await csvExportBody(res, result))`. Before the body goes out, the export row of the
 * audit log gets the format and the number of rows the file holds (completeExport).
 */
export async function csvExportBody<F extends ExportFileFormat>(res: Response, result: CsvExportResult<F>): Promise<string | Buffer> {
  res.setHeader('Content-Type', result.contentType);
  res.setHeader('Content-Disposition', contentDisposition(result.filename));
  if (result.warnings.length > 0) res.setHeader('X-CSV-Warnings', JSON.stringify(result.warnings));
  await completeExport(res, { rows: result.rows });
  return result.content;
}
