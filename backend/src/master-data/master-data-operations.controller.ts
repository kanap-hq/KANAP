import { Body, Controller, Get, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel } from '../auth/require-level.decorator';
import { MasterDataOperationsService } from './master-data-operations.service';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';
import { reportExportBody } from '../common/report-export';
import { Tenant, TenantRequest } from '../common/decorators/tenant.decorator';
import { masterDataCopyExport } from './master-data-copy-export';

@UseGuards(JwtAuthGuard)
@Controller('master-data-operations')
export class MasterDataOperationsController {
  constructor(private readonly svc: MasterDataOperationsService) {}

  @ReservedToUnscopedDataAccess()
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Post('copy')
  @UseGuards(PermissionGuard)
  @RequireAnyLevel([
    { resource: 'budget_ops', level: 'admin' },
    { resource: 'companies', level: 'admin' },
    { resource: 'departments', level: 'admin' },
  ])
  async copy(@Body() body: any, @Req() req: any) {
    const manager = req?.queryRunner?.manager;
    const userId = req?.user?.sub ?? null;
    const includeCompanies = String(body?.includeCompanies ?? 'false').toLowerCase() === 'true';
    const includeDepartments = String(body?.includeDepartments ?? 'false').toLowerCase() === 'true';
    const dryRun = String(body?.dryRun ?? 'true').toLowerCase() === 'true';
    const metrics = Array.isArray(body?.companyMetrics)
      ? body.companyMetrics.map((m: any) => String(m))
      : [];

    return this.svc.copyMasterData({
      sourceYear: Number(body?.sourceYear),
      destinationYear: Number(body?.destinationYear),
      includeCompanies,
      includeDepartments,
      companyMetrics: metrics,
      dryRun,
      userId,
      access: { isAdmin: req?.isAdmin, permissions: req?.permissions },
    }, { manager });
  }

  /** The preview of the copy (its dry run) as a CSV or Excel file: the screen's table (`master-data-copy-export.ts`). */
  @ReservedToUnscopedDataAccess()
  @Get('copy/export')
  @UseGuards(PermissionGuard)
  @RequireAnyLevel([
    { resource: 'budget_ops', level: 'admin' },
    { resource: 'companies', level: 'admin' },
    { resource: 'departments', level: 'admin' },
  ])
  async exportCopy(@Query() query: Record<string, unknown>, @Tenant() ctx: TenantRequest, @Res() res: Response) {
    res.send(await reportExportBody(res, await masterDataCopyExport(this.svc, query, ctx)));
  }
}
