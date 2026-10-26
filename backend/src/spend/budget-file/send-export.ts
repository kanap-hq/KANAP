import type { Response } from 'express';
import { contentDisposition } from '../../common/content-disposition';
import { DATA_ACCESS_HEADER } from '../../data-access/data-access';
import type { BudgetFileExport } from './budget-file.service';

/** The answer of the three budget file export routes (`GET …/budget-file/export`). */
export function sendBudgetFile(res: Response, exported: BudgetFileExport): void {
  res.setHeader('Content-Type', exported.contentType);
  res.setHeader('Content-Disposition', contentDisposition(exported.filename));
  // A limited person's file holds the lines of their access: the dialog says "Calculated on your access".
  if (exported.dataAccessLimited) res.setHeader(DATA_ACCESS_HEADER, 'limited');
  res.send(exported.content);
}
