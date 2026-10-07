import { BadRequestException, Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { contentDisposition } from '../common/content-disposition';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { isCalendarDate } from '../common/report-period';
import { resolveAppBaseUrl, resolveConfiguredAppBaseUrl, resolveTenantAppBaseUrl } from '../common/url';
import { Features } from '../config/features';
import { parseCsvIds as parseCsv } from './services/portfolio-report-filters';
import {
  PortfolioWeeklyReportService,
  WEEKLY_ENTITIES,
  WeeklyEntity,
  WeeklyReportQuery,
} from './services/portfolio-weekly-report.service';

@UseGuards(JwtAuthGuard)
@Controller('portfolio/reports')
export class PortfolioWeeklyReportController {
  constructor(private readonly svc: PortfolioWeeklyReportService) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_reports', 'reader')
  @Get('weekly')
  list(
    @Query() query: any,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.list(this.parseQuery(query, ctx), { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_reports', 'reader')
  @Get('weekly/filter-values')
  listFilterValues(
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.listFilterValues(ctx.tenantId, { manager: ctx.manager });
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('portfolio_reports', 'reader')
  @Get('weekly/export')
  async export(
    @Query() query: any,
    @Tenant() ctx: TenantRequest,
    @Req() req: any,
    @Res() res: Response,
  ) {
    const parsed = this.parseQuery(query, ctx);
    const format = String(query?.format || 'csv').toLowerCase();
    const tenantSlug = String(req?.tenant?.slug || '').trim().toLowerCase() || null;

    if (format === 'xlsx') {
      const appBaseUrl = this.resolveExportBaseUrl(req, tenantSlug);
      const result = await this.svc.exportXlsx(parsed, appBaseUrl, { manager: ctx.manager });
      res.setHeader(
        'Content-Type',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      );
      res.setHeader('Content-Disposition', contentDisposition(result.filename));
      res.send(result.content);
      return;
    }

    const result = await this.svc.exportCsv(parsed, { manager: ctx.manager });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', contentDisposition(result.filename));
    res.send(result.content);
  }

  private parseQuery(query: any, ctx: TenantRequest): WeeklyReportQuery {
    const startDate = String(query?.startDate || '').trim();
    const endDate = String(query?.endDate || '').trim();

    if (!isCalendarDate(startDate)) {
      throw new BadRequestException('startDate is required and must use YYYY-MM-DD format');
    }
    if (!isCalendarDate(endDate)) {
      throw new BadRequestException('endDate is required and must use YYYY-MM-DD format');
    }
    if (startDate > endDate) {
      throw new BadRequestException('startDate must be before or equal to endDate');
    }

    return {
      tenantId: ctx.tenantId,
      startDate,
      endDate,
      timeZone: String(query?.tz || '').trim() || undefined,
      sourceIds: parseCsv(query?.sourceIds),
      categoryIds: parseCsv(query?.categoryIds),
      streamIds: parseCsv(query?.streamIds),
      taskTypeIds: parseCsv(query?.taskTypeIds),
      statuses: parseCsv(query?.statuses),
      projectIds: parseCsv(query?.projectIds),
      teamIds: parseCsv(query?.teamIds),
      // Unknown values are dropped; nothing left means every object.
      entities: Array.from(new Set(parseCsv(query?.entities))).filter((value): value is WeeklyEntity =>
        (WEEKLY_ENTITIES as readonly string[]).includes(value),
      ),
      groupBy: String(query?.groupBy || '').trim() === 'person' ? 'person' : 'type',
    };
  }

  /**
   * Base of the links in the XLSX export, from the configuration (common/url.ts). Without a
   * configured address the export keeps relative links.
   */
  private resolveExportBaseUrl(req: any, tenantSlug: string | null): string | null {
    if (Features.SINGLE_TENANT) {
      return resolveConfiguredAppBaseUrl();
    }
    try {
      return tenantSlug ? resolveTenantAppBaseUrl(req, tenantSlug) : resolveAppBaseUrl(req);
    } catch {
      return null;
    }
  }
}
