import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { EntityManager } from 'typeorm';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Tenant, TenantRequest } from '../decorators/tenant.decorator';
import { ListContextsService } from './list-contexts.service';

function managerOf(ctx: TenantRequest): EntityManager {
  if (!ctx.manager) throw new Error('List contexts need the request tenant transaction');
  return ctx.manager;
}

/**
 * Saved list states (`list-context.ts`). Any member of the tenant may save
 * and read one: a context holds only list parameters (filters, sort, search),
 * which the same member could send inline; the list endpoints it is used with
 * keep their own permission checks.
 */
@UseGuards(JwtAuthGuard)
@Controller('list-contexts')
export class ListContextsController {
  constructor(private readonly svc: ListContextsService) {}

  /** `{ list, state }` → `{ id }`. Saving the same state again answers the same id. */
  @Post()
  save(@Body() body: { list?: unknown; state?: unknown }, @Tenant() ctx: TenantRequest) {
    return this.svc.save(managerOf(ctx), ctx.tenantId, body?.list, body?.state);
  }

  /** `{ id, list, state }`: the list page restores its filters from it (reload, link opened in a new tab). */
  @Get(':id')
  get(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.get(managerOf(ctx), ctx.tenantId, id);
  }
}
