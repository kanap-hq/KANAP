import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor, PayloadTooLargeException } from '@nestjs/common';
import type { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import * as path from 'path';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { csvImportMulterOptions } from '../../common/upload';
import { XLSX_CONTENT_TYPE } from '../../common/xlsx';

/**
 * A monthly row of five columns over three years is about 2 KB (the spec
 * measures the writer). 20,000 such rows are about 40 MB and stay under this.
 * The csv-sheet row cap is still 20,000. The 413 message does not name the cap.
 */
export const BUDGET_FILE_MAX_BYTES = 48 * 1024 * 1024;

/**
 * The preflight's snapshot, sent back as the `snapshot` field of the load: one
 * entry per existing line of the file, about 95 bytes plus 77 per budget year
 * the line has (20,000 lines of 3 years measured 6.5 MB). This holds 20,000
 * lines of 14 years each. Multer's default of 1 MB stopped a load at a few
 * thousand lines.
 */
export const BUDGET_FILE_SNAPSHOT_MAX_BYTES = 24 * 1024 * 1024;

export const BUDGET_FILE_TOO_LARGE =
  'This file is too large. A budget file can hold 20,000 lines. Export fewer lines or fewer years.';

/**
 * The budget file is read by its content, CSV or .xlsx: a workbook passes the name check, and its
 * content decides (an .xls is refused with its own sentence). Anything else meets the CSV import's
 * filter and its sentences.
 */
const budgetFileFilter: NonNullable<MulterOptions['fileFilter']> = (req, file, cb) => {
  const extension = path.extname(String(file.originalname || '')).toLowerCase();
  const mimeType = String(file.mimetype || '').toLowerCase().split(';')[0].trim();
  if (extension === '.xlsx' || extension === '.xls' || mimeType === XLSX_CONTENT_TYPE) {
    cb(null, true);
    return;
  }
  csvImportMulterOptions.fileFilter!(req, file, cb);
};

// The shared multipart limits, with the budget file's own sizes. The load sends
// one text field (`snapshot`), the preflight none: `fields: 1` keeps the large
// field size from applying to ten fields.
export const budgetFileMulterOptions = {
  ...csvImportMulterOptions,
  fileFilter: budgetFileFilter,
  limits: {
    ...csvImportMulterOptions.limits,
    fileSize: BUDGET_FILE_MAX_BYTES,
    fieldSize: BUDGET_FILE_SNAPSHOT_MAX_BYTES,
    fields: 1,
    parts: 2,
  },
};

/**
 * Multer refuses an oversized upload before the controller runs, and
 * `FileInterceptor` hands its refusal on as an HTTP error: a 413 for the file,
 * a 400 "Field value too long - snapshot" for the snapshot. This interceptor
 * has to be registered before `FileInterceptor` so it sees that error and
 * answers 413 in plain language for both.
 */
@Injectable()
export class BudgetFileSizeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        if (err instanceof PayloadTooLargeException || (err instanceof BadRequestException && err.message.startsWith('Field value too long'))) {
          return throwError(() => new PayloadTooLargeException(BUDGET_FILE_TOO_LARGE));
        }
        return throwError(() => err);
      }),
    );
  }
}
