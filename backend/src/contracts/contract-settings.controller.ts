import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';
import { ContractSettingsService } from './contract-settings.service';

function requireTenantId(req: any): string {
  const tenantId: string | undefined = req?.tenant?.id;
  if (!tenantId) throw new Error('Tenant context is required for contract settings');
  return tenantId;
}

/** The tenant's contract settings (`contract-settings.service.ts`): read by contract readers, changed by contract admins. */
@UseGuards(JwtAuthGuard)
@Controller('contract-settings')
export class ContractSettingsController {
  constructor(private readonly svc: ContractSettingsService) {}

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'reader')
  @Get()
  get(@Req() req: any) {
    return this.svc.get(requireTenantId(req), req?.queryRunner?.manager);
  }

  @UseGuards(PermissionGuard)
  @RequireLevel('contracts', 'admin')
  @ReservedToUnscopedDataAccess()
  @Patch()
  update(@Body() body: unknown, @Req() req: any) {
    return this.svc.update(requireTenantId(req), body ?? {}, req.user?.sub ?? null, req?.queryRunner?.manager);
  }
}
