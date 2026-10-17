import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { RequireLevel } from '../../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../../common/decorators/tenant.decorator';
import { contentDisposition } from '../../common/content-disposition';
import { requireManager } from '../technology-rows';
import { AdministrationViewService, type AdministrationOpts } from './administration-view.service';

/**
 * The administration view (lot A1a), under `infrastructure:reader`. Its own module: both paths
 * are static and none has the shape of a `technologies/:id/...` route (`:id` takes one segment,
 * and no `technologies/:id/administration` route exists), so the registration order does not matter.
 */
@UseGuards(JwtAuthGuard)
@Controller('technologies/reports/administration')
export class AdministrationViewController {
  constructor(private readonly svc: AdministrationViewService) {}

  private opts(ctx: TenantRequest): AdministrationOpts {
    return { manager: requireManager(ctx.manager), tenantId: ctx.tenantId, userId: ctx.userId || null };
  }

  /** Zones with their technologies, servers and directory services, then the domains. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get()
  async view(@Tenant() ctx: TenantRequest) {
    return this.svc.view(this.opts(ctx));
  }

  /** One list as a CSV file (`?list=zones|domains`); a path ending with /export: recorded as an export. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('export')
  async export(@Query() query: Record<string, unknown>, @Res({ passthrough: true }) res: Response, @Tenant() ctx: TenantRequest) {
    const file = await this.svc.csv(query, this.opts(ctx));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(file.filename));
    return file.content;
  }
}
