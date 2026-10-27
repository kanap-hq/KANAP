import { Controller, Get, Param, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ProjectStatuses } from './dto/create-project.dto';
import { ProjectStatus } from './portfolio-project.entity';
import { PortfolioCapacityReportService } from './services/portfolio-capacity-report.service';
import { CapacityHeatmapResponse, CapacityMode, CapacityGroupBy, ProjectBreakdownRow } from './dto/capacity-heatmap.dto';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { reportExportBody, reportExportRequest, writeReportExport } from '../common/report-export';
import {
  capacityHeatmapExport,
  capacityHeatmapExportQuery,
  capacityTeamNames,
} from './services/portfolio-capacity-heatmap-export';

const NO_TEAM_ID = 'no-team';

const parseCsv = (value?: string): string[] => {
  if (!value) return [];
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

const parseStatuses = (value?: string): ProjectStatus[] | undefined => {
  const items = parseCsv(value);
  if (items.length === 0) return undefined;
  const allowed = new Set(ProjectStatuses);
  const filtered = items.filter((s) => allowed.has(s as ProjectStatus)) as ProjectStatus[];
  return filtered.length ? filtered : undefined;
};

const parseTeamFilter = (value?: string): { isActive: boolean; teamIds: string[]; includeNoTeam: boolean } => {
  const ids = parseCsv(value);
  if (ids.length === 0) return { isActive: false, teamIds: [], includeNoTeam: false };
  const includeNoTeam = ids.includes(NO_TEAM_ID);
  const teamIds = ids.filter((id) => id !== NO_TEAM_ID);
  return { isActive: true, teamIds, includeNoTeam };
};

@UseGuards(JwtAuthGuard)
@Controller('portfolio/reports')
export class PortfolioCapacityReportController {
  constructor(private readonly svc: PortfolioCapacityReportService) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_reports', 'reader')
  @Get('capacity-heatmap')
  getCapacityHeatmap(
    @Query('teamIds') teamIds?: string,
    @Query('statuses') statuses?: string,
    @Query('capacityMode') capacityMode?: CapacityMode,
    @Query('groupBy') groupBy?: CapacityGroupBy,
    @Req() req?: any,
  ): Promise<CapacityHeatmapResponse> {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.getHeatmap(
      tenantId,
      {
        teamFilter: parseTeamFilter(teamIds),
        statuses: parseStatuses(statuses),
        capacityMode: capacityMode === 'theoretical' ? 'theoretical' : 'historical',
        groupBy: groupBy === 'team' ? 'team' : 'contributor',
      },
      { manager: req?.queryRunner?.manager },
    );
  }

  /**
   * The contributor and team tables as a CSV (the grouping asked by `groupBy`) or an Excel file (both,
   * that grouping first), from the same heatmap call as the screen: `capacityMode`, `statuses`, `teamIds`,
   * `groupBy`, plus `format` and `language`. Recorded as an export.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_reports', 'reader')
  @Get('capacity-heatmap/export')
  async exportCapacityHeatmap(@Query() query: Record<string, unknown>, @Tenant() ctx: TenantRequest, @Res() res: Response) {
    const request = await reportExportRequest(query, ctx, ['capacityMode', 'statuses', 'teamIds', 'groupBy']);
    const parsed = capacityHeatmapExportQuery(query);
    const heatmap = await this.svc.getHeatmap(ctx.tenantId, parsed, { manager: ctx.manager });
    const exp = capacityHeatmapExport(heatmap, request.language, {
      teamNames: await capacityTeamNames(ctx.manager!, ctx.tenantId, parsed.teamFilter, request.language),
    });
    res.send(await reportExportBody(res, writeReportExport(exp, { ...request, table: parsed.groupBy })));
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_reports', 'reader')
  @Get('capacity-heatmap/contributor/:contributorId')
  getContributorBreakdown(
    @Param('contributorId') contributorId: string,
    @Query('statuses') statuses?: string,
    @Req() req?: any,
  ): Promise<{ projects: ProjectBreakdownRow[] }> {
    const tenantId = req?.tenant?.id ?? '';
    return this.svc.getContributorBreakdown(
      tenantId,
      contributorId,
      parseStatuses(statuses),
      { manager: req?.queryRunner?.manager },
    );
  }
}
