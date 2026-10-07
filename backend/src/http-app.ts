import { INestApplication } from '@nestjs/common';
import * as express from 'express';
import { Request, Response } from 'express';
import helmet from 'helmet';
import { DataSource } from 'typeorm';
import { OpsMetricsStore } from './admin/ops/ops-metrics.store';
import { createRequestMetricsMiddleware } from './admin/ops/request-metrics.middleware';
import { createBodyParsers } from './common/body-parsers';
import { createCorsMiddlewares, createOriginPolicy } from './common/cors-policy';
import { parseCorsPatterns } from './common/env';
import { shouldTrustProxyForRateLimit } from './common/rate-limit';
import { createRequestFinalizer } from './common/request-finalizer.middleware';
import { useRequestPipeline } from './common/request-pipeline';
import { createRequestTenancyMiddleware } from './common/tenancy/request-tenancy.middleware';
import { Features } from './config/features';

// The HTTP wiring of the served API, in two parts because main.ts runs its start-up writes
// between them. Specs that serve the whole application over HTTP call both, in this order.

/** Before the start-up writes: proxy trust, headers, browser origins, body parsers, ops metrics. */
export function applyHttpMiddleware(app: INestApplication): void {
  if (shouldTrustProxyForRateLimit()) {
    const expressApp = app.getHttpAdapter().getInstance();
    expressApp.set('trust proxy', 1);
  }
  app.use(helmet());
  // Browser origins (common/cors-policy.ts): a refused origin gets a 403 without CORS headers.
  const corsPatterns = parseCorsPatterns();
  if (corsPatterns.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`[CORS] Configured ${corsPatterns.length} origin pattern(s)`);
  }
  app.use(...createCorsMiddlewares(createOriginPolicy()));
  const rawBodySaver = (req: Request, _res: Response, buffer: Buffer) => {
    if (buffer?.length) {
      (req as any).rawBody = buffer;
    }
  };
  app.use('/stripe/webhook', express.raw({ type: '*/*' }));
  app.use(...createBodyParsers(rawBodySaver));
  // Ops metrics middleware — must be registered before tenancy so it wraps the full pipeline
  const opsMetricsStore = app.get(OpsMetricsStore);
  app.use(createRequestMetricsMiddleware(opsMetricsStore));
}

/** After the start-up writes: tenant resolution, the request pipeline, the finalizer. */
export function applyTenancyAndPipeline(app: INestApplication, ds: DataSource): void {
  // Tenancy resolution middleware: attach { slug, id? } based on Host header (or the single-tenant
  // slug); a failed lookup answers 503 busy, a write to a tenant being reset 409. See
  // common/tenancy/request-tenancy.middleware.ts.
  // NOTE: TenancyMiddleware is available in common/tenancy for use with NestJS module-level
  // middleware configuration. New code should prefer using TenancyManager and @Tenant() decorator in controllers.
  app.use(createRequestTenancyMiddleware({
    query: (sql, params) => ds.query(sql, params),
    singleTenant: Features.SINGLE_TENANT,
    defaultTenantSlug: (process.env.DEFAULT_TENANT_SLUG || 'default').trim(),
    platformAdminHost: process.env.PLATFORM_ADMIN_HOST || '',
    marketingRedirectUrl: (process.env.MARKETING_BASE_URL || 'https://www.kanap.net').replace(/\/$/, ''),
  }));
  // Pipes (ValidationPipe for class-validator DTOs, ZodValidationPipe for Zod DTOs), the tenant
  // transaction (TenantInitGuard opens it before the other guards, TenantInterceptor finishes it),
  // saved list filters (`ctx=<id>`, inside that transaction, before the pipes) and the exception
  // filter that releases a transaction left open: see common/request-pipeline.ts.
  useRequestPipeline(app, ds);

  // Finalizer middleware: ensure any leftover queryRunner is released on finish/close; a client
  // abort rolls back quietly (one warning line). See common/request-finalizer.middleware.ts.
  app.use(createRequestFinalizer());
}
