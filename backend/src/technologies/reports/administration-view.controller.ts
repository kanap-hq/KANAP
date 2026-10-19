import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { RequireLevel } from '../../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../../common/decorators/tenant.decorator';
import { contentDisposition } from '../../common/content-disposition';
import { requireManager } from '../technology-rows';
import { AdministrationViewService, type AdministrationAssetQuery, type AdministrationOpts } from './administration-view.service';

/**
 * The administration view (lot A1e), under `infrastructure`. Its own module: every path is static
 * and none has the shape of a `technologies/:id/...` route (`:id` takes one segment, and no
 * `technologies/:id/administration` route exists), so the registration order does not matter.
 * Reads are `reader`. Assigning a zone is `member`.
 */
@UseGuards(JwtAuthGuard)
@Controller('technologies/reports/administration')
export class AdministrationViewController {
  constructor(private readonly svc: AdministrationViewService) {}

  private opts(ctx: TenantRequest): AdministrationOpts {
    return { manager: requireManager(ctx.manager), tenantId: ctx.tenantId, userId: ctx.userId || null };
  }

  /** Zone counts, the assets that have no zone, and the five control counts. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get()
  async view(@Tenant() ctx: TenantRequest) {
    return this.svc.summary(this.opts(ctx));
  }

  /** One page of the assets that are not retired, in the grid's order. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('assets')
  async assets(@Query() query: AdministrationAssetQuery, @Tenant() ctx: TenantRequest) {
    return this.svc.assets(query ?? {}, this.opts(ctx));
  }

  /** The administration zone of the chosen assets, or of every asset the list's filters reach. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'member')
  @Post('assets/zone')
  async assignZone(@Body() body: Record<string, unknown>, @Tenant() ctx: TenantRequest) {
    return this.svc.assignZone(body ?? {}, this.opts(ctx));
  }

  /** Directory services, and the domains of the catalog grouped by forest. */
  @UseGuards(PermissionGuard)
  @RequireLevel('infrastructure', 'reader')
  @Get('directories')
  async directories(@Tenant() ctx: TenantRequest) {
    return this.svc.directories(this.opts(ctx));
  }

  /** The assets or the domains as a CSV file; a path ending with /export: recorded as an export. */
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
