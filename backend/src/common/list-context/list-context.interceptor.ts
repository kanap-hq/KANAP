import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, Observable } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import type { EntityManager } from 'typeorm';
import { mergeListContextQuery } from './list-context';
import { ListContextsService } from './list-contexts.service';

/**
 * The one place every list endpoint reads `ctx=<id>`: a GET carrying it gets
 * its saved list state merged into the request query before the controller
 * runs, explicit parameters first (`mergeListContextQuery`). The list parsers
 * (`parseListRequest` for the SQL list engine, `parsePagination` and
 * `parseExportPagination` for the other lists, services reading
 * `query.filters`) are synchronous and only see the query object they are
 * handed, so the context is resolved here, once, rather than in each of them.
 *
 * Runs after `TenantInterceptor` (registered after it in main.ts), inside the
 * request's tenant transaction: the read is tenant-scoped by RLS and by its
 * own `tenant_id` predicate. A route without a tenant transaction (public,
 * `@SkipTenantTransaction`) reads no context and leaves the query alone. An
 * unknown id answers 400 (`list_context_not_found`): a list silently shown
 * unfiltered would look filtered.
 */
@Injectable()
export class ListContextInterceptor implements NestInterceptor {
  constructor(private readonly contexts: ListContextsService = new ListContextsService()) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const req: any = context.switchToHttp().getRequest();
    if (String(req?.method ?? '').toUpperCase() !== 'GET') return next.handle();
    const query = req?.query;
    if (!query || query.ctx === undefined || query.ctx === '') return next.handle();
    const manager: EntityManager | undefined = req?.queryRunner?.manager;
    const tenantId: string | undefined = req?.tenant?.id;
    if (!manager || !tenantId) return next.handle();
    return from(applyListContext(this.contexts, req, manager, tenantId)).pipe(mergeMap(() => next.handle()));
  }
}

/**
 * Replaces the request's query by the merged one. Express 5 computes
 * `req.query` from the URL on every read (a getter), so the merged object is
 * set as the request's own property, which every later reader (Nest's
 * `@Query()`, a `@Req()` handler) gets.
 */
export async function applyListContext(contexts: ListContextsService, req: any, manager: EntityManager, tenantId: string): Promise<void> {
  const query = req.query as Record<string, unknown>;
  const stored = await contexts.require(manager, tenantId, query.ctx);
  Object.defineProperty(req, 'query', {
    value: mergeListContextQuery(stored.state, query),
    writable: true,
    configurable: true,
    enumerable: true,
  });
}
