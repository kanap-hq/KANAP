import { Body, Controller, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { reportExportBody, reportExportRequest, writeReportExport } from '../common/report-export';
import { RoadmapApplyInput, RoadmapGenerateInput } from './dto/roadmap.dto';
import { PortfolioRoadmapService } from './services/portfolio-roadmap.service';
import { ROADMAP_OCCUPATION_EXPORT_QUERY_KEYS, roadmapOccupationExport } from './services/roadmap-occupation-export';

@UseGuards(JwtAuthGuard)
@Controller('portfolio')
export class PortfolioRoadmapController {
  constructor(private readonly roadmapService: PortfolioRoadmapService) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_reports', 'reader')
  @Post('reports/roadmap/generate')
  generateRoadmap(
    @Body() body: RoadmapGenerateInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.roadmapService.generateRoadmap(
      ctx.tenantId,
      body,
      { manager: ctx.manager },
    );
  }

  /**
   * The occupation tables of a generation as a file: the body is the generate payload (validated the same
   * way), the query `format`, `language`, `tz` and `table` (`contributors` or `teams`, the table of a CSV).
   * The generation runs without the sensitivity reruns, which only rank the bottlenecks. The guard of
   * `generate`. Recorded as an export (the path ends with `/export`).
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_reports', 'reader')
  @Post('reports/roadmap/occupation/export')
  async exportRoadmapOccupation(
    @Query() query: Record<string, unknown>,
    @Body() body: RoadmapGenerateInput,
    @Tenant() ctx: TenantRequest,
    @Res() res: Response,
  ) {
    const request = await reportExportRequest(query, ctx, ROADMAP_OCCUPATION_EXPORT_QUERY_KEYS);
    const response = await this.roadmapService.generateRoadmap(ctx.tenantId, body, { manager: ctx.manager }, { skipSensitivity: true });
    const exp = roadmapOccupationExport(response, response.options, request.language);
    res.send(await reportExportBody(res, writeReportExport(exp, request)));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_projects', 'contributor')
  @Post('projects/planning/roadmap/apply')
  applyRoadmapDates(
    @Body() body: RoadmapApplyInput,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.roadmapService.applyDates(
      ctx.tenantId,
      body,
      ctx.userId || null,
      { manager: ctx.manager },
    );
  }
}
