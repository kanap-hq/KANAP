import { Controller, Get, Patch, Delete, Query, Body, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { AllocationRulesService } from './allocation-rules.service';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';

@UseGuards(JwtAuthGuard)
@Controller('allocation-rules')
export class AllocationRulesController {
  constructor(private readonly svc: AllocationRulesService) {}

  /**
   * Readable by every authenticated member of the tenant, not just `budget_ops` readers:
   * the effective default drives the allocation percentages shown on their own OPEX and
   * CAPEX items, and hiding it made every non-admin see a wrong "Headcount (default)"
   * label. It exposes no sensitive data (the global standard row plus this tenant's own
   * setting). Writes below stay restricted to `budget_ops:admin`.
   */
  @Get('active')
  async getActive(@Query('year') yearRaw: string, @Req() req: any) {
    return this.svc.resolve(req?.tenant?.id ?? null, Number(yearRaw), {
      manager: req?.queryRunner?.manager,
    });
  }

  /** Body: `{ mode?: 'auto' | 'manual_company', method, company_ids? }`. */
  @ReservedToUnscopedDataAccess()
  @Patch('active')
  @UseGuards(PermissionGuard)
  @RequireLevel('budget_ops', 'admin')
  async setActive(@Query('year') yearRaw: string, @Body() body: any, @Req() req: any) {
    return this.svc.setTenantMethod(
      req?.tenant?.id ?? null,
      Number(yearRaw),
      body ?? {},
      req.user?.sub ?? null,
      { manager: req?.queryRunner?.manager },
    );
  }

  @ReservedToUnscopedDataAccess()
  @Delete('active')
  @UseGuards(PermissionGuard)
  @RequireLevel('budget_ops', 'admin')
  async clearActive(@Query('year') yearRaw: string, @Req() req: any) {
    return this.svc.clearTenantMethod(
      req?.tenant?.id ?? null,
      Number(yearRaw),
      req.user?.sub ?? null,
      { manager: req?.queryRunner?.manager },
    );
  }
}
