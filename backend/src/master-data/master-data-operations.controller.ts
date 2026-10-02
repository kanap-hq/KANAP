import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel } from '../auth/require-level.decorator';
import { MasterDataOperationsService } from './master-data-operations.service';
import { LongRunningRequest, BULK_WRITE_TIMEOUTS } from '../common/request-db-timeouts';

@UseGuards(JwtAuthGuard)
@Controller('master-data-operations')
export class MasterDataOperationsController {
  constructor(private readonly svc: MasterDataOperationsService) {}

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
}
