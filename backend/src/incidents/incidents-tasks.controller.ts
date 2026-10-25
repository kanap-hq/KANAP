import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { resolveToUuid } from '../common/resolve-item-id';
import { TasksUnifiedService } from '../tasks/tasks-unified.service';
import { IncidentsService } from './services';
import { incidentViewerFromContext } from './incident-visibility';

@UseGuards(JwtAuthGuard)
@Controller('incidents/:id/tasks')
export class IncidentsTasksController {
  constructor(
    private readonly unified: TasksUnifiedService,
    private readonly incidents: IncidentsService,
  ) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'reader')
  @Get()
  async list(@Param('id') idOrRef: string, @Tenant() ctx: TenantRequest) {
    const id = await resolveToUuid(idOrRef, 'incident', ctx.manager as EntityManager);
    await this.incidents.ensureIncident(id, ctx.manager as EntityManager, ctx.tenantId, incidentViewerFromContext(ctx));
    return this.unified.listForTarget({ type: 'incident', id }, {
      manager: ctx.manager,
      tenantId: ctx.tenantId,
      viewer: incidentViewerFromContext(ctx),
    });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @Post()
  async create(@Param('id') idOrRef: string, @Body() body: any, @Tenant() ctx: TenantRequest) {
    const id = await resolveToUuid(idOrRef, 'incident', ctx.manager as EntityManager);
    // Closure lock: no new follow-up on a closed incident.
    await this.incidents.ensureEditable(id, {
      manager: ctx.manager,
      tenantId: ctx.tenantId,
      viewer: incidentViewerFromContext(ctx),
    });
    return this.unified.createForTarget({ type: 'incident', id, payload: body }, ctx.userId || undefined, {
      manager: ctx.manager,
      tenantId: ctx.tenantId,
    });
  }

  // PATCH expects body.id of the task to update
  @UseGuards(PermissionGuard)
  @RequireLevel('tasks', 'member')
  @Patch()
  async update(@Param('id') idOrRef: string, @Body() body: any, @Tenant() ctx: TenantRequest) {
    const id = await resolveToUuid(idOrRef, 'incident', ctx.manager as EntityManager);
    await this.incidents.ensureIncident(id, ctx.manager as EntityManager, ctx.tenantId, incidentViewerFromContext(ctx));
    return this.unified.updateForTarget({ type: 'incident', id, payload: body }, ctx.userId || undefined, {
      manager: ctx.manager,
      tenantId: ctx.tenantId,
    });
  }
}
