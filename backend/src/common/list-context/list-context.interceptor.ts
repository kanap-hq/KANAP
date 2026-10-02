import { BadRequestException, CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { from, Observable, throwError } from 'rxjs';
import { mergeMap } from 'rxjs/operators';
import type { EntityManager } from 'typeorm';
import { mergeListContextQuery } from './list-context';
import { ListContextsService } from './list-contexts.service';

/**
 * The one place every list endpoint reads `ctx=<id>`: a GET carrying it gets
 * its saved filters merged into the request query before the controller runs
 * (`mergeListContextQuery`: the filters only, inline filters first). The list
 * parsers (`parseListRequest` for the SQL list engine, `parsePagination` and
 * `parseExportPagination` for the other lists, services reading
 * `query.filters`) are synchronous and only see the query object they are
 * handed, so the context is resolved here, once, rather than in each of them.
 *
 * Registered right after `TenantInterceptor` (`request-pipeline.ts`): it runs
 * inside the request's tenant transaction, and before the pipes, which then
 * validate the merged query like an inline one. The read is tenant-scoped by
 * RLS and by its own `tenant_id` predicate. An unknown id answers 400
 * (`list_context_not_found`): a list silently shown unfiltered would look
 * filtered. A route without a tenant transaction (public,
 * `@SkipTenantTransaction`) cannot read a context: `ctx` there answers 400
 * (`list_context_unavailable`) rather than being ignored.
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
    if (!manager || !tenantId) {
      return throwError(() => new BadRequestException({
        code: 'list_context_unavailable',
        message: 'This address does not take saved list filters (ctx).',
      }));
    }
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
