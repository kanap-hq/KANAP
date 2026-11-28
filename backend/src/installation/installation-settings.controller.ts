import { Body, Controller, Get, Logger, Patch, Req, UseGuards } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Tenant, TenantRequest } from '../common/decorators';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';
import { InstallationAdminGuard } from './installation-admin.guard';
import { InstallationSettingsService } from './installation-settings.service';

/**
 * Settles once the response is sent or the connection closed: the request transaction has
 * committed (or ended) by then. Undefined outside HTTP. As in currency.controller.ts.
 */
function responseSent(req: any): Promise<void> | undefined {
  const res = req?.res;
  if (!res || typeof res.once !== 'function') return undefined;
  if (res.writableFinished || res.destroyed) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const done = () => resolve();
    res.once('finish', done);
    res.once('close', done);
  });
}

/**
 * The settings of the installation set on the screen (installation-settings.ts): on-premise in
 * Administration > Installation, in the cloud on the platform host. Both modes.
 */
@ReservedToUnscopedDataAccess()
@Controller('admin/installation')
@UseGuards(JwtAuthGuard, InstallationAdminGuard)
export class InstallationSettingsController {
  private readonly logger = new Logger(InstallationSettingsController.name);

  constructor(private readonly settings: InstallationSettingsService) {}

  @Get('ai')
  async getAi(@Tenant() ctx: TenantRequest) {
    return this.settings.getState('ai', requestManager(ctx));
  }

  /**
   * The answer carries the state read in the request's transaction; this process's snapshot
   * follows once the response is sent (the write committed, or not: the refresh reads what is
   * stored). The other processes follow at their next refresh, within 30 seconds.
   */
  @Patch('ai')
  async updateAi(@Body() body: Record<string, unknown>, @Tenant() ctx: TenantRequest, @Req() req: any) {
    const state = await this.settings.update('ai', body, { manager: requestManager(ctx), userId: ctx.userId || null });
    this.refreshAfterResponse(req);
    return state;
  }

  /** Never rejects: a failed refresh leaves the snapshot to the next one, with a warning. */
  private refreshAfterResponse(req: any): void {
    void (responseSent(req) ?? Promise.resolve())
      .then(() => this.settings.refresh())
      .catch((error) => this.logger.warn(`Installation settings refresh after a write failed: ${error instanceof Error ? error.message : String(error)}`));
  }
}

/** The request's transaction (TenantInitGuard): the reads and the audit entry go through it. */
function requestManager(ctx: TenantRequest): EntityManager {
  if (!ctx.manager) throw new Error('installation settings: the request has no transaction');
  return ctx.manager;
}
