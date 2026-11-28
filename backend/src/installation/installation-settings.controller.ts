import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Tenant, TenantRequest } from '../common/decorators';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';
import { InstallationAdminGuard } from './installation-admin.guard';
import { InstallationSettingsService } from './installation-settings.service';

/**
 * The settings of the installation set on the screen (installation-settings.ts): on-premise in
 * Administration > Installation, in the cloud on the platform host. Both modes.
 */
@ReservedToUnscopedDataAccess()
@Controller('admin/installation')
@UseGuards(JwtAuthGuard, InstallationAdminGuard)
export class InstallationSettingsController {
  constructor(private readonly settings: InstallationSettingsService) {}

  @Get('ai')
  async getAi(@Tenant() ctx: TenantRequest) {
    return this.settings.getState('ai', requestManager(ctx));
  }

  @Patch('ai')
  async updateAi(@Body() body: Record<string, unknown>, @Tenant() ctx: TenantRequest) {
    return this.settings.update('ai', body, { manager: requestManager(ctx), userId: ctx.userId || null });
  }
}

/** The request's transaction (TenantInitGuard): the reads and the audit entry go through it. */
function requestManager(ctx: TenantRequest): EntityManager {
  if (!ctx.manager) throw new Error('installation settings: the request has no transaction');
  return ctx.manager;
}
