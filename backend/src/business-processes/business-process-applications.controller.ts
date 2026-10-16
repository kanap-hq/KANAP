import { Body, Controller, Delete, ForbiddenException, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { resolveBusinessContributorScopeForUser, type ParticipationAccessScope } from '../auth/business-contributor-scope';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { hasLevel } from '../technologies/technologies.controller';
import { TechnologyLinksService, type ApplicationsReach } from '../technologies/technology-links.service';
import { requireManager } from '../technologies/technology-rows';

/**
 * The applications of a business process (`application_business_processes`, lot S). The
 * applications show only to a caller who reads them (`items` null otherwise), within a Business
 * Contributor's participation scope; linking one needs that read too (403 otherwise).
 */
@UseGuards(JwtAuthGuard)
@Controller('business-processes')
export class BusinessProcessApplicationsController {
  constructor(private readonly links: TechnologyLinksService) {}

  private opts(ctx: TenantRequest) {
    return { manager: requireManager(ctx.manager), tenantId: ctx.tenantId, userId: ctx.userId || null };
  }

  private async applicationsReach(ctx: TenantRequest): Promise<ApplicationsReach> {
    if (!hasLevel(ctx, 'applications', 'reader')) return null;
    const scope = await resolveBusinessContributorScopeForUser({ manager: requireManager(ctx.manager), userId: ctx.userId, tenantId: ctx.tenantId, isAdmin: ctx.isAdmin }, 'applications', 'reader');
    return { scope };
  }

  private async requireApplications(ctx: TenantRequest): Promise<{ scope?: ParticipationAccessScope }> {
    const reach = await this.applicationsReach(ctx);
    if (!reach) throw new ForbiddenException('You cannot read applications.');
    return reach;
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'reader')
  @Get(':id/applications')
  async list(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    return this.links.applicationsOfProcess(id, this.opts(ctx), await this.applicationsReach(ctx));
  }

  /** Link an application: `{ application_id }`. */
  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'member')
  @Post(':id/applications')
  async add(@Param('id') id: string, @Body() body: { application_id?: string }, @Tenant() ctx: TenantRequest) {
    return this.links.setProcessApplication(id, String(body?.application_id ?? ''), true, this.opts(ctx), await this.requireApplications(ctx));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('business_processes', 'member')
  @Delete(':id/applications/:applicationId')
  async remove(@Param('id') id: string, @Param('applicationId') applicationId: string, @Tenant() ctx: TenantRequest) {
    return this.links.setProcessApplication(id, applicationId, false, this.opts(ctx), await this.requireApplications(ctx));
  }
}
