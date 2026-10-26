import type { Response } from 'express';
import { recordExportRows } from '../../audit/security-events';
import { contentDisposition } from '../../common/content-disposition';
import { DATA_ACCESS_HEADER } from '../../data-access/data-access';
import type { BudgetFileExport } from './budget-file.service';

/**
 * The headers of the three budget file export routes (`GET …/budget-file/export`), and the body
 * they send: `res.send(budgetFileBody(res, exported))`.
 */
export function budgetFileBody(res: Response, exported: BudgetFileExport): string | Buffer {
  // The export row of the audit log says how many lines the file holds.
  recordExportRows(res.req, exported.rows);
  res.setHeader('Content-Type', exported.contentType);
  res.setHeader('Content-Disposition', contentDisposition(exported.filename));
  // A limited person's file holds the lines of their access: the dialog says "Calculated on your access".
  if (exported.dataAccessLimited) res.setHeader(DATA_ACCESS_HEADER, 'limited');
  return exported.content;
}
