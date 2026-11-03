import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators';
import { BULK_WRITE_TIMEOUTS, LongRunningRequest } from '../common/request-db-timeouts';
import { AnalyticsAxesService } from './analytics-axes.service';
import { isForced } from './analytics-forced-delete';
import { ANALYTICS_READERS, analyticsContext } from './analytics-categories.controller';
import { AnalyticsAxisCreateDto, AnalyticsAxisReorderDto, AnalyticsAxisUpdateDto, AnalyticsRecommendedDimensionsDto } from './dto/analytics.dto';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';
import { cancelCreation, readCreationChanges, withCreationToken } from '../common/creation/creation-routes';

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('analytics-axes')
export class AnalyticsAxesController {
  constructor(private readonly svc: AnalyticsAxesService) {}

  @RequireAnyLevel(ANALYTICS_READERS)
  @Get()
  list(@Tenant() ctx: TenantRequest) {
    return this.svc.list(analyticsContext(ctx));
  }

  // The order of the dimensions (same permission as PATCH :id), before the `:id` routes.
  @ReservedToUnscopedDataAccess()
  @RequireLevel('analytics', 'member')
  @Post('reorder')
  reorder(@Body() body: AnalyticsAxisReorderDto, @Tenant() ctx: TenantRequest) {
    return this.svc.reorder(body?.axis_ids, analyticsContext(ctx));
  }

  // The recommended dimensions (administrators), before the `:id` routes.
  @RequireLevel('analytics', 'admin')
  @Get('recommended')
  recommended(@Tenant() ctx: TenantRequest) {
    return this.svc.recommended(analyticsContext(ctx));
  }

  @ReservedToUnscopedDataAccess()
  @RequireLevel('analytics', 'admin')
  @Post('recommended')
  addRecommended(@Body() body: AnalyticsRecommendedDimensionsDto, @Tenant() ctx: TenantRequest) {
    return this.svc.addRecommended(body, analyticsContext(ctx));
  }

  @RequireLevel('analytics', 'reader')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.get(id, analyticsContext(ctx));
  }

  @ReservedToUnscopedDataAccess()
  @RequireLevel('analytics', 'member')
  @Post()
  async create(@Body() body: AnalyticsAxisCreateDto, @Tenant() ctx: TenantRequest) {
    return withCreationToken('analytics_axes', await this.svc.create(body, analyticsContext(ctx)), ctx);
  }

  // Before Cancel of the dimension (with the values added meanwhile) being created: what was written on it since (common/creation).
  @ReservedToUnscopedDataAccess()
  @RequireLevel('analytics', 'member')
  @Get(':id/creation')
  creationChanges(@Param('id', new ParseUUIDPipe()) id: string, @Query('token') token: string, @Tenant() ctx: TenantRequest) {
    return readCreationChanges('analytics_axes', id, token, ctx);
  }

  // Cancel: the creator deletes the dimension (with the values added meanwhile) they just created, with its token, without the delete right.
  @ReservedToUnscopedDataAccess()
  @RequireLevel('analytics', 'member')
  @Delete(':id/creation')
  cancelCreation(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: { token?: string }, @Tenant() ctx: TenantRequest) {
    return cancelCreation('analytics_axes', id, body?.token, ctx, () => this.svc.delete(id, analyticsContext(ctx), { force: true }));
  }

  @ReservedToUnscopedDataAccess()
  @RequireLevel('analytics', 'member')
  @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: AnalyticsAxisUpdateDto, @Tenant() ctx: TenantRequest) {
    return this.svc.update(id, body, analyticsContext(ctx));
  }

  // `?force=true` deletes the dimension with its values; the lines lose their value on it.
  @ReservedToUnscopedDataAccess()
  @RequireLevel('analytics', 'admin')
  @LongRunningRequest(BULK_WRITE_TIMEOUTS)
  @Delete(':id')
  delete(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Query('force') force: string | undefined,
    @Tenant() ctx: TenantRequest,
  ) {
    return this.svc.delete(id, analyticsContext(ctx), { force: isForced(force) });
  }
}
