import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { TechnologyLinksService } from '../technologies/technology-links.service';
import { requireManager } from '../technologies/technology-rows';

/** The applications of a business process (`application_business_processes`, lot S). */
@UseGuards(JwtAuthGuard)
@Controller('business-processes')
export class BusinessProcessApplicationsController {
  constructor(private readonly links: TechnologyLinksService) {}

  private opts(ctx: TenantRequest) {
    return { manager: requireManager(ctx.manager), tenantId: ctx.tenantId, userId: ctx.userId || null };
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'reader')
  @Get(':id/applications')
  list(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.links.applicationsOfProcess(id, this.opts(ctx));
  }

  /** Link an application: `{ application_id }`. */
  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'member')
  @Post(':id/applications')
  add(@Param('id') id: string, @Body() body: { application_id?: string }, @Tenant() ctx: TenantRequest) {
    return this.links.setProcessApplication(id, String(body?.application_id ?? ''), true, this.opts(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'member')
  @Delete(':id/applications/:applicationId')
  remove(@Param('id') id: string, @Param('applicationId') applicationId: string, @Tenant() ctx: TenantRequest) {
    return this.links.setProcessApplication(id, applicationId, false, this.opts(ctx));
  }
}
