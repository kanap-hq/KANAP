import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { RequireLevel } from '../../auth/require-level.decorator';
import { resolveBusinessContributorScopeForUser } from '../../auth/business-contributor-scope';
import { Tenant, TenantRequest } from '../../common/decorators/tenant.decorator';
import { contentDisposition } from '../../common/content-disposition';
import { hasLevel } from '../technologies.controller';
import type { ApplicationsReach } from '../technology-links.service';
import { requireManager } from '../technology-rows';
import { EndOfSupportService, type ReportOpts } from './end-of-support.service';

/**
 * The "End of support" report (lot T4), under `infrastructure:reader`. Its own controller, listed
 * before `TechnologiesController` in the module so its static paths are registered first; none of
 * them has the shape of a `technologies/:id/...` route either (spec `end-of-support-routes`).
 */
@UseGuards(JwtAuthGuard)
@Controller('technologies/reports/end-of-support')
export class EndOfSupportController {
  constructor(private readonly svc: EndOfSupportService) {}

  private opts(ctx: TenantRequest): ReportOpts {
    return { manager: requireManager(ctx.manager), tenantId: ctx.tenantId, userId: ctx.userId || null };
  }

  /** As `GET /technologies/:id/applications`: none without `applications:reader`, a Business Contributor's own only. */
  private async applicationsReach(ctx: TenantRequest): Promise<ApplicationsReach> {
    if (!hasLevel(ctx, 'applications', 'reader')) return null;
    const scope = await resolveBusinessContributorScopeForUser({ manager: requireManager(ctx.manager), userId: ctx.userId, tenantId: ctx.tenantId, isAdmin: ctx.isAdmin }, 'applications', 'reader');
    return { scope };
  }

  /** The deadlines: `?horizon_months=6|12|24|36` (12 by default), `?type=` optional. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get()
  async deadlines(@Query() query: Record<string, unknown>, @Tenant() ctx: TenantRequest) {
    return this.svc.deadlines(query, this.opts(ctx), await this.applicationsReach(ctx));
  }

  /** The missing data that keeps the report from answering. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('gaps')
  async gaps(@Tenant() ctx: TenantRequest) {
    return this.svc.gaps(this.opts(ctx), await this.applicationsReach(ctx));
  }

  /** One list as a CSV file (`?list=deadlines|gaps`); a path ending with /export: recorded as an export. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('export')
  async export(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response, @Tenant() ctx: TenantRequest) {
    const file = await this.svc.csv(query, this.opts(ctx), await this.applicationsReach(ctx));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(file.filename));
    return file.content;
  }
}
