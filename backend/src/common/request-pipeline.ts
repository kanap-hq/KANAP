import { INestApplication, ValidationPipe } from '@nestjs/common';
import { HttpAdapterHost, Reflector } from '@nestjs/core';
import { ZodValidationPipe } from 'nestjs-zod';
import { DataSource } from 'typeorm';
import { ExportEventsInterceptor } from '../audit/export-events.interceptor';
import { ImportEventsInterceptor } from '../audit/import-events.interceptor';
import { ReleaseTenantRunnerFilter } from './filters/release-tenant-runner.filter';
import { ListContextInterceptor } from './list-context/list-context.interceptor';
import { ListContextsService } from './list-context/list-contexts.service';
import { TenantInitGuard } from './tenant-init.guard';
import { TenantInterceptor } from './tenant.interceptor';

/**
 * The global request pipeline of the API, installed by main.ts (and by the
 * HTTP specs on their probe apps, so they run the same one). On a request Nest
 * runs, after the middleware:
 * 1. TenantInitGuard: opens the tenant transaction before the other guards
 *    (PermissionGuard reads roles under RLS);
 * 2. TenantInterceptor: commits it on success, rolls it back on an error;
 * 3. ListContextInterceptor, inside that transaction: a GET's `ctx=<id>`
 *    becomes the saved filters in its query;
 * 4. ExportEventsInterceptor, inside that transaction: a route whose path ends
 *    with `/export`, or marked `@ExportRoute()`, writes its `export` row to the
 *    audit log;
 * 5. ImportEventsInterceptor, inside that transaction: a route marked
 *    `@ImportRoute('<list>')` writes its `import` row to the audit log once its
 *    load has succeeded, before the commit;
 * 6. the pipes (class-validator DTOs, Zod DTOs), on the merged query;
 * 7. ReleaseTenantRunnerFilter, on an error: releases a transaction left open.
 */
export function useRequestPipeline(app: INestApplication, dataSource: DataSource): void {
  const reflector = app.get(Reflector);
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
    new ZodValidationPipe(),
  );
  app.useGlobalGuards(new TenantInitGuard(dataSource, reflector));
  app.useGlobalInterceptors(
    new TenantInterceptor(dataSource, reflector),
    new ListContextInterceptor(app.get(ListContextsService)),
    new ExportEventsInterceptor(),
    new ImportEventsInterceptor(),
  );
  const { httpAdapter } = app.get(HttpAdapterHost);
  app.useGlobalFilters(new ReleaseTenantRunnerFilter(httpAdapter));
}
