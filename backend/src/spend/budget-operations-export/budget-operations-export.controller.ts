import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionGuard } from '../../auth/permission.guard';
import { RequireLevel } from '../../auth/require-level.decorator';
import { reportExportBody } from '../../common/report-export';
import { Tenant, TenantRequest } from '../../common/decorators/tenant.decorator';
import { ReservedToUnscopedDataAccess } from '../../data-access/reserved-operations';
import { BudgetOperationsExportService } from './budget-operations-export.service';

/**
 * The table exports of the budget operations pages (`budget-operations-export.service.ts`): the guard
 * of the operations they preview (`budget:admin`, reserved to unscoped persons), the request's
 * transaction, the screen's parameters plus `format`, `language` and `tz`. Recorded as exports.
 */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('budget-lines/budget-operations')
export class BudgetOperationsExportController {
  constructor(private readonly svc: BudgetOperationsExportService) {}

  @ReservedToUnscopedDataAccess()
  @RequireLevel('budget', 'admin')
  @Get('clear-column/export')
  async clearColumn(@Query() query: Record<string, unknown>, @Tenant() ctx: TenantRequest, @Res() res: Response) {
    res.send(await reportExportBody(res, await this.svc.clearColumn(query, ctx)));
  }

  @ReservedToUnscopedDataAccess()
  @RequireLevel('budget', 'admin')
  @Get('copy/export')
  async copy(@Query() query: Record<string, unknown>, @Tenant() ctx: TenantRequest, @Res() res: Response) {
    res.send(await reportExportBody(res, await this.svc.copy(query, ctx)));
  }
}
