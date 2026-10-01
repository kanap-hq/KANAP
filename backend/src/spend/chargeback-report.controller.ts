import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ChargebackReportService } from './chargeback-report.service';

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('reports')
export class ChargebackReportController {
  constructor(private readonly svc: ChargebackReportService) {}

  @RequireLevel('reporting', 'reader')
  @Get('chargeback/global')
  async global(
    @Query('year') yearRaw: string,
    @Query('metric') metricRaw: string,
    @Req() req: any,
  ) {
    const year = Number.isFinite(Number(yearRaw)) ? Number(yearRaw) : new Date().getFullYear();
    const metric = await this.svc.resolveMetric(metricRaw, req?.tenant?.id ?? null, { manager: req?.queryRunner?.manager });
    return this.svc.generateGlobal(year, metric, req.tenant.id, { manager: req?.queryRunner?.manager });
  }

  @RequireLevel('reporting', 'reader')
  @Get('chargeback/company')
  async company(
    @Query('companyId') companyId: string,
    @Query('year') yearRaw: string,
    @Query('metric') metricRaw: string,
    @Req() req: any,
  ) {
    const year = Number.isFinite(Number(yearRaw)) ? Number(yearRaw) : new Date().getFullYear();
    const metric = await this.svc.resolveMetric(metricRaw, req?.tenant?.id ?? null, { manager: req?.queryRunner?.manager });
    const resolvedCompanyId = companyId || (req.query?.company_id as string);
    return this.svc.generateCompany(year, metric, resolvedCompanyId, req.tenant.id, { manager: req?.queryRunner?.manager });
  }

  @RequireLevel('reporting', 'reader')
  @Get('chargeback')
  async chargeback(
    @Query('year') yearRaw: string,
    @Query('metric') metricRaw: string,
    @Req() req: any,
  ) {
    const year = Number.isFinite(Number(yearRaw)) ? Number(yearRaw) : new Date().getFullYear();
    const metric = await this.svc.resolveMetric(metricRaw, req?.tenant?.id ?? null, { manager: req?.queryRunner?.manager });
    return this.svc.generateGlobal(year, metric, req.tenant.id, { manager: req?.queryRunner?.manager });
  }
}
