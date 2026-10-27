import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { reportExportBody, reportExportRequest, writeReportExport } from '../common/report-export';
import { normalizeReportTimeZone } from '../common/report-period';
import { TimeLoggedReportResponse } from './dto/time-logged-report.dto';
import { normalizeIdList, parseCsvIds } from './services/portfolio-report-filters';
import { filterNames, timeLoggedExport, timeLoggedExportMonths } from './services/portfolio-time-logged-export';
import { PortfolioTimeLoggedReportService } from './services/portfolio-time-logged-report.service';

@UseGuards(JwtAuthGuard)
@Controller('portfolio/reports')
export class PortfolioTimeLoggedReportController {
  constructor(private readonly svc: PortfolioTimeLoggedReportService) {}

  /** Days logged by month, team and person: counts only, never the notes of an entry. */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_reports', 'reader')
  @Get('time-logged')
  getTimeLogged(@Query() query: any, @Tenant() ctx: TenantRequest): Promise<TimeLoggedReportResponse> {
    return this.svc.getReport(
      ctx.tenantId,
      {
        months: query?.months,
        timeZone: String(query?.tz || '').trim() || undefined,
        projectIds: parseCsvIds(query?.projectIds),
        teamIds: parseCsvIds(query?.teamIds),
      },
      { manager: ctx.manager },
    );
  }

  /**
   * The table of the report as a CSV or Excel file (`format`), from the same report call as the
   * screen: `months` (6 or 12), `tz`, `projectIds`, `teamIds`, plus `language`. Recorded as an export.
   */
  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_reports', 'reader')
  @Get('time-logged/export')
  async exportTimeLogged(@Query() query: Record<string, unknown>, @Tenant() ctx: TenantRequest, @Res() res: Response) {
    const request = await reportExportRequest(query, ctx, ['months', 'projectIds', 'teamIds']);
    const months = timeLoggedExportMonths(query.months);
    const timeZone = String(query.tz || '').trim() || undefined;
    const projectIds = normalizeIdList(parseCsvIds(query.projectIds));
    const teamIds = normalizeIdList(parseCsvIds(query.teamIds));
    const report = await this.svc.getReport(ctx.tenantId, { months, timeZone, projectIds, teamIds }, { manager: ctx.manager });
    const exp = timeLoggedExport(report, request.language, {
      months,
      timeZone: normalizeReportTimeZone(timeZone),
      projectNames: await filterNames(ctx.manager!, ctx.tenantId, 'portfolio_projects', projectIds),
      teamNames: await filterNames(ctx.manager!, ctx.tenantId, 'portfolio_teams', teamIds),
    });
    res.send(await reportExportBody(res, writeReportExport(exp, request)));
  }
}
