import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionGuard } from '../auth/permission.guard';
import { RequireAnyLevel, RequireLevel } from '../auth/require-level.decorator';
import { Tenant, TenantRequest } from '../common/decorators';
import { AnalyticsAxesService } from './analytics-axes.service';
import { ANALYTICS_READERS, analyticsContext } from './analytics-categories.controller';
import { AnalyticsAxisCreateDto, AnalyticsAxisUpdateDto } from './dto/analytics.dto';

@UseGuards(JwtAuthGuard, PermissionGuard)
@Controller('analytics-axes')
export class AnalyticsAxesController {
  constructor(private readonly svc: AnalyticsAxesService) {}

  @RequireAnyLevel(ANALYTICS_READERS)
  @Get()
  list(@Tenant() ctx: TenantRequest) {
    return this.svc.list(analyticsContext(ctx));
  }

  @RequireLevel('analytics', 'reader')
  @Get(':id')
  get(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.get(id, analyticsContext(ctx));
  }

  @RequireLevel('analytics', 'member')
  @Post()
  create(@Body() body: AnalyticsAxisCreateDto, @Tenant() ctx: TenantRequest) {
    return this.svc.create(body, analyticsContext(ctx));
  }

  @RequireLevel('analytics', 'member')
  @Patch(':id')
  update(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: AnalyticsAxisUpdateDto, @Tenant() ctx: TenantRequest) {
    return this.svc.update(id, body, analyticsContext(ctx));
  }

  @RequireLevel('analytics', 'admin')
  @Delete(':id')
  delete(@Param('id', new ParseUUIDPipe()) id: string, @Tenant() ctx: TenantRequest) {
    return this.svc.delete(id, analyticsContext(ctx));
  }
}
