import { Request, Response, NextFunction } from 'express';
import { OpsMetricsStore } from './ops-metrics.store';

/**
 * Express middleware that captures request timing and status for every HTTP request.
 * Must be registered BEFORE tenancy middleware in main.ts so it wraps the entire
 * NestJS pipeline — including guards (where 429/401/403 are thrown).
 */
export function createRequestMetricsMiddleware(store: OpsMetricsStore) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    res.on('finish', () => {
      const latencyMs = Date.now() - start;
      // req.route is populated by Express/NestJS after routing completes.
      // For guard-rejected requests (429/401/403), req.route may be undefined —
      // fall back to req.baseUrl + req.path which still gives a useful grouping.
      const route = (req as any).route?.path
        ? `${req.baseUrl || ''}${(req as any).route.path}`
        : req.originalUrl?.split('?')[0] || req.path;

      // Skip static/health noise, and the monitoring probe of the ops metrics
      if (route === '/health' || route === '/api/health' || route === '/ops/metrics') return;

      // Capture error info from NestJS-attached error (if any)
      let errorType: string | undefined;
      let errorMessage: string | undefined;
      if (res.statusCode >= 500) {
        const err = (res as any).__opsError;
        if (err) {
          errorType = err.constructor?.name || 'UnknownError';
          errorMessage = typeof err.message === 'string' ? err.message.slice(0, 200) : undefined;
        } else {
          errorType = `HTTP ${res.statusCode}`;
        }
      }

      store.record({
        ts: Date.now(),
        method: req.method,
        route,
        statusCode: res.statusCode,
        latencyMs,
        errorType,
        errorMessage,
      });
    });

    next();
  };
}

/**
 * NestJS exception filter hook — attach error details to response for the
 * metrics middleware to pick up. This is called from the global exception filter.
 */
export function attachErrorToResponse(res: Response, error: unknown): void {
  (res as any).__opsError = error;
}
