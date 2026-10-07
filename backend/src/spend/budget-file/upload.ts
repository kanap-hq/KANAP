import { CallHandler, ExecutionContext, Injectable, NestInterceptor, PayloadTooLargeException } from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { csvImportMulterOptions } from '../../common/upload';

/**
 * A monthly row of five columns over three years is about 2 KB (the spec
 * measures the writer). 20,000 such rows are about 40 MB and stay under this.
 * The csv-sheet row cap is still 20,000. The 413 message does not name the cap.
 */
export const BUDGET_FILE_MAX_BYTES = 48 * 1024 * 1024;

export const BUDGET_FILE_TOO_LARGE =
  'This file is too large. A budget file can hold 20,000 lines. Export fewer lines or fewer years.';

// The shared multipart limits, with the budget file's own size.
export const budgetFileMulterOptions = {
  ...csvImportMulterOptions,
  limits: { ...csvImportMulterOptions.limits, fileSize: BUDGET_FILE_MAX_BYTES },
};

/**
 * Multer refuses an oversized upload before the controller runs. This
 * interceptor has to be registered before `FileInterceptor` so it sees that
 * error and answers 413 in plain language.
 */
@Injectable()
export class BudgetFileSizeInterceptor implements NestInterceptor {
  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((err: unknown) => {
        if ((err as { code?: string })?.code === 'LIMIT_FILE_SIZE') {
          return throwError(() => new PayloadTooLargeException(BUDGET_FILE_TOO_LARGE));
        }
        return throwError(() => err);
      }),
    );
  }
}
