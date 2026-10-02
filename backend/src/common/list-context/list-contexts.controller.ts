import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { EntityManager } from 'typeorm';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { Tenant, TenantRequest } from '../decorators/tenant.decorator';
import { RATE_LIMITS } from '../rate-limit';
import { UserRateLimitGuard } from '../rate-limit.guard';
import { ListContextsService } from './list-contexts.service';

function managerOf(ctx: TenantRequest): EntityManager {
  if (!ctx.manager) throw new Error('List contexts need the request tenant transaction');
  return ctx.manager;
}

/**
 * Saved list states (`list-context.ts`). Any member of the tenant may save
 * and read one: a context holds only the column filters of a list, which the
 * same member could send inline; the list endpoints it is used with keep their
 * own permission checks.
 *
 * A frozen tenant keeps saving them: the freeze (PermissionGuard) blocks the
 * writes of business data and keeps every read, and a context is how a read
 * with filters too long for an address travels. Bounded instead by the
 * per-tenant cap (`LIST_CONTEXTS_PER_TENANT`) and a per-user rate limit.
 */
@UseGuards(JwtAuthGuard)
@Controller('list-contexts')
export class ListContextsController {
  constructor(private readonly svc: ListContextsService) {}

  /** `{ list, state: { filters } }` → `{ id }`. Saving the same state again answers the same id. */
  @Post()
  @UseGuards(UserRateLimitGuard)
  @Throttle({ default: RATE_LIMITS.listContextSave })
  save(@Body() body: { list?: unknown; state?: unknown }, @Tenant() ctx: TenantRequest) {
    return this.svc.save(managerOf(ctx), ctx.tenantId, body?.list, body?.state);
  }

  /** `{ id, list, state }`: the list page restores its filters from it (reload, link opened in a new tab). */
  @Get(':id')
  get(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.get(managerOf(ctx), ctx.tenantId, id);
  }
}
