import { BadRequestException, Controller, Get, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { localizedBudgetColumnName } from '../budget-columns/budget-column-labels';
import { readBudgetColumns } from '../budget-columns/budget-columns.util';
import { reportExportBody, reportExportRequest, writeReportExport } from '../common/report-export';
import { transactionDataAccessMode } from '../data-access/data-access';
import { companyChargebackExport, globalChargebackExport } from './chargeback-report.export';
import { ChargebackReportService, resolveChargebackScope } from './chargeback-report.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The year of an export: absent is the current year, as the data routes; anything but a year is a 400. */
function exportYear(raw: unknown): number {
  if (raw === undefined || raw === '') return new Date().getFullYear();
  if (typeof raw !== 'string' || !/^\d{4}$/.test(raw.trim())) throw new BadRequestException('year must be a year (YYYY).');
  return Number(raw.trim());
}

/**
 * The chargeback reports. `scope` names the lines spread: `opex` (the default), `capex` or `all`;
 * any other value is a 400.
 *
 * Each report has a table export (`…/export`, `chargeback-report.export.ts`) beside its data route:
 * the same guard, the same request manager and the same parameters (`year`, `metric`, `scope`, and
 * `companyId` for a company), plus `format`, `language`, `tz` and `table` (the table of a CSV). It calls
 * the same service method, so a limited person outside their coverage gets the same 403. Recorded as an
 * export.
 */
@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('reports')
export class ChargebackReportController {
  constructor(private readonly svc: ChargebackReportService) {}

  @RequireLevel('reporting', 'reader')
  @Get('chargeback/global/export')
  async exportGlobal(@Query() query: Record<string, unknown>, @Req() req: any, @Res() res: Response) {
    const manager = req?.queryRunner?.manager;
    const tenantId: string = req.tenant.id;
    const request = await reportExportRequest(query, { manager, tenantId, userId: req?.user?.sub }, ['year', 'metric', 'scope', 'table']);
    const year = exportYear(query?.year);
    const scope = resolveChargebackScope(query?.scope);
    const metric = await this.svc.resolveMetric(query?.metric, tenantId, { manager });
    const report = await this.svc.generateGlobal(year, metric, tenantId, { manager, scope });
    const columnName = localizedBudgetColumnName(await readBudgetColumns(manager, tenantId), metric, request.language);
    const limited = (await transactionDataAccessMode(manager)) === 'limited';
    const exp = globalChargebackExport(report, { language: request.language, columnName, limited });
    res.send(await reportExportBody(res, writeReportExport(exp, request)));
  }

  @RequireLevel('reporting', 'reader')
  @Get('chargeback/company/export')
  async exportCompany(@Query() query: Record<string, unknown>, @Req() req: any, @Res() res: Response) {
    const manager = req?.queryRunner?.manager;
    const tenantId: string = req.tenant.id;
    const request = await reportExportRequest(query, { manager, tenantId, userId: req?.user?.sub }, ['companyId', 'year', 'metric', 'scope', 'table']);
    const companyId = typeof query?.companyId === 'string' ? query.companyId.trim() : '';
    if (!UUID.test(companyId)) throw new BadRequestException('companyId must be a company id.');
    const year = exportYear(query?.year);
    const scope = resolveChargebackScope(query?.scope);
    const metric = await this.svc.resolveMetric(query?.metric, tenantId, { manager });
    const report = await this.svc.generateCompany(year, metric, companyId, tenantId, { manager, scope });
    const columnName = localizedBudgetColumnName(await readBudgetColumns(manager, tenantId), metric, request.language);
    const exp = companyChargebackExport(report, { language: request.language, columnName });
    res.send(await reportExportBody(res, writeReportExport(exp, request)));
  }

  @RequireLevel('reporting', 'reader')
  @Get('chargeback/global')
  async global(
    @Query('year') yearRaw: string,
    @Query('metric') metricRaw: string,
    @Query('scope') scopeRaw: unknown,
    @Req() req: any,
  ) {
    const year = Number.isFinite(Number(yearRaw)) ? Number(yearRaw) : new Date().getFullYear();
    const scope = resolveChargebackScope(scopeRaw);
    const metric = await this.svc.resolveMetric(metricRaw, req?.tenant?.id ?? null, { manager: req?.queryRunner?.manager });
    return this.svc.generateGlobal(year, metric, req.tenant.id, { manager: req?.queryRunner?.manager, scope });
  }

  @RequireLevel('reporting', 'reader')
  @Get('chargeback/company')
  async company(
    @Query('companyId') companyId: string,
    @Query('year') yearRaw: string,
    @Query('metric') metricRaw: string,
    @Query('scope') scopeRaw: unknown,
    @Req() req: any,
  ) {
    const year = Number.isFinite(Number(yearRaw)) ? Number(yearRaw) : new Date().getFullYear();
    const scope = resolveChargebackScope(scopeRaw);
    const metric = await this.svc.resolveMetric(metricRaw, req?.tenant?.id ?? null, { manager: req?.queryRunner?.manager });
    const resolvedCompanyId = companyId || (req.query?.company_id as string);
    return this.svc.generateCompany(year, metric, resolvedCompanyId, req.tenant.id, { manager: req?.queryRunner?.manager, scope });
  }

  @RequireLevel('reporting', 'reader')
  @Get('chargeback')
  async chargeback(
    @Query('year') yearRaw: string,
    @Query('metric') metricRaw: string,
    @Query('scope') scopeRaw: unknown,
    @Req() req: any,
  ) {
    const year = Number.isFinite(Number(yearRaw)) ? Number(yearRaw) : new Date().getFullYear();
    const scope = resolveChargebackScope(scopeRaw);
    const metric = await this.svc.resolveMetric(metricRaw, req?.tenant?.id ?? null, { manager: req?.queryRunner?.manager });
    return this.svc.generateGlobal(year, metric, req.tenant.id, { manager: req?.queryRunner?.manager, scope });
  }
}
