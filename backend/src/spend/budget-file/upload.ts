import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor, PayloadTooLargeException } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { csvImportMulterOptions } from '../../common/upload';
import { parseBudgetFileChoices } from './matching';
import type { BudgetFileChoice } from './types';

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

// The shared multipart limits and file filter (CSV, and .xlsx while `IMPORT_XLSX` is on), with the
// budget file's own sizes. The load sends two text fields (`snapshot`, and `choices` when the person
// made some), the preflight `choices` at most: `fields: 2` keeps the large field size from applying
// to ten fields.
export const budgetFileMulterOptions = {
  ...csvImportMulterOptions,
  limits: {
    ...csvImportMulterOptions.limits,
    fileSize: BUDGET_FILE_MAX_BYTES,
    fieldSize: BUDGET_FILE_SNAPSHOT_MAX_BYTES,
    fields: 2,
    parts: 3,
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

/**
 * The person's choices on the check (lot I1 of 26.11.9: the matches they undo, the "Create missing
 * suppliers" option), sent as the `choices` field of the form, a JSON list, never in the address: they
 * hold values of the file. The load receives the same list as the check it follows.
 */
export function budgetFileChoices(raw: unknown): BudgetFileChoice[] {
  try {
    return parseBudgetFileChoices(raw);
  } catch {
    throw new BadRequestException('The choices are not valid.');
  }
}
