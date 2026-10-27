import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { RequireLevel } from '../../auth/require-level.decorator';
import { reportExportBody } from '../../common/report-export';
import { Tenant, TenantRequest } from '../../common/decorators/tenant.decorator';
import { BudgetReportExportService } from './budget-report-export.service';

/**
 * The table exports of the budget aggregate reports (`budget-report-export.service.ts`): the guard of
 * the aggregate routes they read (`budget:reader`), the request's transaction, the screen's parameters
 * (`budget-report-params.ts`) plus `format`, `language` and `tz`. Recorded as exports.
 */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('reports/budget')
export class BudgetReportExportController {
  constructor(private readonly svc: BudgetReportExportService) {}

  @RequireLevel('budget', 'reader')
  @Get('comparison/export')
  async comparison(@Query() query: Record<string, unknown>, @Tenant() ctx: TenantRequest, @Res() res: Response) {
    res.send(await reportExportBody(res, await this.svc.export('comparison', query, ctx)));
  }

  @RequireLevel('budget', 'reader')
  @Get('columns-compare/export')
  async columnsCompare(@Query() query: Record<string, unknown>, @Tenant() ctx: TenantRequest, @Res() res: Response) {
    res.send(await reportExportBody(res, await this.svc.export('columns-compare', query, ctx)));
  }

  @RequireLevel('budget', 'reader')
  @Get('top-lines/export')
  async topLines(@Query() query: Record<string, unknown>, @Tenant() ctx: TenantRequest, @Res() res: Response) {
    res.send(await reportExportBody(res, await this.svc.export('top-lines', query, ctx)));
  }
}
