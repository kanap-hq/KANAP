import { Body, Controller, ForbiddenException, Get, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { incidentViewerFromContext } from '../incidents/incident-visibility';
import { ApplicationConversionService } from './application-conversion.service';
import { hasLevel } from './technologies.controller';
import { requireManager } from './technology-rows';

/**
 * Converting an application to a technology (lot C1), under the application routes. Both routes
 * need `applications:admin` (the guard) and `infrastructure:member` (checked here).
 */
@UseGuards(JwtAuthGuard)
@Controller('applications')
export class ApplicationConversionController {
  constructor(private readonly svc: ApplicationConversionService) {}

  private opts(ctx: TenantRequest) {
    if (!hasLevel(ctx, 'infrastructure', 'member')) throw new ForbiddenException('You cannot create technologies.');
    return { manager: requireManager(ctx.manager), tenantId: ctx.tenantId, userId: ctx.userId || null };
  }

  /**
   * What would move to the technology, what would be lost, and the refusals. Nothing is written.
   * A count of a module the caller cannot read is `null`; incidents follow the confidentiality rule.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'admin')
  @Get(':id/conversion-preview')
  async preview(@Param('id') id: string, @Tenant() ctx: TenantRequest) {
    const reads = (resource: string) => hasLevel(ctx, resource, 'reader');
    return this.svc.preview(id, {
      ...this.opts(ctx),
      access: { contracts: reads('contracts'), budget_lines: reads('budget'), projects: reads('portfolio_projects'), incidents: reads('incidents') },
      incidentViewer: incidentViewerFromContext(ctx),
    });
  }

  /**
   * Convert. The request transaction commits after the handler: the files are settled once the
   * answer has gone out, by its status (a failed commit answers an error). An answer that never
   * finishes (client gone) leaves both copies to the storage cleanup.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('applications', 'admin')
  @Post(':id/convert-to-technology')
  async convert(
    @Param('id') id: string,
    @Body() body: { family?: unknown },
    @Tenant() ctx: TenantRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { technology, files } = await this.svc.convert(id, body ?? {}, this.opts(ctx));
    res.once('finish', () => {
      void this.svc.settleFiles(files, res.statusCode < 400);
    });
    return { technology };
  }
}
