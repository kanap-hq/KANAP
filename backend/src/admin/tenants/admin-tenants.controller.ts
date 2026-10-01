import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../../auth/platform-admin.guard';
import { MultiTenantOnlyGuard } from '../../common/feature-gates';
import { AdminTenantsService } from './admin-tenants.service';
import { UpdateTenantPlanDto } from './dto/update-tenant-plan.dto';
import { FreezeTenantDto } from './dto/freeze-tenant.dto';
import { DeleteTenantDto } from './dto/delete-tenant.dto';

@UseGuards(MultiTenantOnlyGuard, JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/tenants')
export class AdminTenantsController {
  constructor(private readonly svc: AdminTenantsService) {}

  @Get()
  list(@Query() query: any) {
    return this.svc.listTenants(query);
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.svc.getTenantDetail(id);
  }

  @Patch(':id/plan')
  updatePlan(@Param('id') id: string, @Body() body: UpdateTenantPlanDto, @Req() req: any) {
    return this.svc.updatePlan(id, req.user?.sub ?? null, body);
  }

  @Post(':id/mark-internal')
  markInternal(@Param('id') id: string, @Req() req: any) {
    return this.svc.markInternal(id, req.user?.sub ?? null);
  }

  @Post(':id/freeze')
  freeze(@Param('id') id: string, @Body() body: FreezeTenantDto, @Req() req: any) {
    return this.svc.freezeTenant(id, req.user?.sub ?? null, body);
  }

  @Post(':id/unfreeze')
  unfreeze(@Param('id') id: string, @Req() req: any) {
    return this.svc.unfreezeTenant(id, req.user?.sub ?? null);
  }

  @Post(':id/delete')
  delete(@Param('id') id: string, @Body() body: DeleteTenantDto, @Req() req: any) {
    return this.svc.deleteTenant(id, req.user?.sub ?? null, body);
  }
}
