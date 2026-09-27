import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { BudgetColumnsService } from './budget-columns.service';

function requireTenantId(req: any): string {
  const tenantId: string | undefined = req?.tenant?.id;
  if (!tenantId) throw new Error('Tenant context is required for budget column settings');
  return tenantId;
}

@UseGuards(JwtAuthGuard)
@Controller('budget-columns')
export class BudgetColumnsController {
  constructor(private readonly svc: BudgetColumnsService) {}

  /**
   * Readable by every authenticated member of the tenant: lists, reports and
   * the dashboard name their columns with it. Column names and visibility are
   * not sensitive. Changes need Budget administration admin, like freezes.
   */
  @Get()
  async get(@Req() req: any) {
    return this.svc.get(requireTenantId(req), req?.queryRunner?.manager);
  }

  @Patch()
  @UseGuards(PermissionGuard)
  @RequireLevel('budget_ops', 'admin')
  async update(@Body() body: unknown, @Req() req: any) {
    return this.svc.update(requireTenantId(req), body ?? {}, req.user?.sub ?? null, req?.queryRunner?.manager);
  }
}
