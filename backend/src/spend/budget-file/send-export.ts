import type { Response } from 'express';
import { completeExport } from '../../audit/export-events.interceptor';
import { contentDisposition } from '../../common/content-disposition';
import { DATA_ACCESS_HEADER } from '../../data-access/data-access';
import type { BudgetFileExport } from './budget-file.service';

/**
 * The headers of the three budget file export routes (`GET …/budget-file/export`), and the body
 * they send: `res.send(await budgetFileBody(res, exported))`. Before the body goes out, the export
 * row of the audit log gets the format and the number of lines the file holds (completeExport).
 */
export async function budgetFileBody(res: Response, exported: BudgetFileExport): Promise<string | Buffer> {
  res.setHeader('Content-Type', exported.contentType);
  res.setHeader('Content-Disposition', contentDisposition(exported.filename));
  // A limited person's file holds the lines of their access: the dialog says "Calculated on your access".
  if (exported.dataAccessLimited) res.setHeader(DATA_ACCESS_HEADER, 'limited');
  await completeExport(res, { rows: exported.rows });
  return exported.content;
}
