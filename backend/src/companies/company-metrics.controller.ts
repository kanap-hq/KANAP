import { Controller, Get, Query, UseGuards, Param, Patch, Body, Req } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { CompanyMetricsService } from './company-metrics.service';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';

@UseGuards(JwtAuthGuard)
@Controller('company-metrics')
export class CompanyMetricsController {
  constructor(private readonly svc: CompanyMetricsService) {}

  @Get()
  @UseGuards(PermissionGuard)
  @RequireLevel('companies', 'reader')
  async list(@Query('year') yearRaw: string, @Req() req: any) {
    const year = Number(yearRaw);
    return this.svc.list(year, { manager: req?.queryRunner?.manager });
  }

  @Get(':companyId')
  @UseGuards(PermissionGuard)
  @RequireLevel('companies', 'reader')
  async get(
    @Param('companyId') companyId: string,
    @Query('year') yearRaw: string,
    @Req() req: any,
  ) {
    const year = Number(yearRaw);
    return this.svc.getForCompany(companyId, year, { manager: req?.queryRunner?.manager });
  }

  @ReservedToUnscopedDataAccess()
  @Patch(':companyId')
  @UseGuards(PermissionGuard)
  @RequireLevel('companies', 'member')
  async upsert(
    @Param('companyId') companyId: string,
    @Query('year') yearRaw: string,
    @Body() body: any,
    @Req() req: any,
  ) {
    const year = Number(yearRaw);
    return this.svc.upsertForCompany(companyId, year, body, req.user?.sub ?? null, { manager: req?.queryRunner?.manager });
  }
}
