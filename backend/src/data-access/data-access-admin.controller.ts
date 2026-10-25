import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators';
import { ReservedToUnscopedDataAccess } from './reserved-operations';
import { DataAccessAdminService } from './data-access-admin.service';

/**
 * Data-scoped access, lot 6: the administration of a person's access and the "who sees this node"
 * tabs (planning/data-scoped-access/spec.md §7.1, §7.2, §8). Every route is reserved to unscoped
 * persons who administer users: the permission guard answers a caller without `users` at admin
 * level, the tenant interceptor refuses a limited person with 403 `DATA_ACCESS_LIMITED`.
 *
 * The class is a controller of its own so the routes keep their own path order, away from
 * `UsersController`, `CompaniesController` and `CostCentersController`.
 */
@UseGuards(JwtAuthGuard, PermissionGuard)
@ReservedToUnscopedDataAccess()
@Controller()
export class DataAccessAdminController {
  constructor(private readonly svc: DataAccessAdminService) {}

  @Get('users/:id/data-access')
  @RequireLevel('users', 'admin')
  personAccess(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.personAccess(ctx.manager!, id);
  }

  @Put('users/:id/data-access')
  @RequireLevel('users', 'admin')
  updatePerson(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Tenant() ctx: TenantRequest) {
    return this.svc.updatePerson(ctx.manager!, id, body, ctx.userId || null, 'screen');
  }

  @Post('users/:id/data-access/preview')
  @RequireLevel('users', 'admin')
  preview(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: unknown, @Tenant() ctx: TenantRequest) {
    return this.svc.preview(ctx.manager!, id, body, ctx.userId);
  }

  @Get('companies/:id/data-access')
  @RequireLevel('users', 'admin')
  companyAccess(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.companyAccess(ctx.manager!, id);
  }

  @Get('cost-centers/:id/data-access')
  @RequireLevel('users', 'admin')
  costCenterAccess(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.costCenterAccess(ctx.manager!, id);
  }
}
