import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put, Query, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PlatformAdminGuard } from '../../auth/platform-admin.guard';
import { MultiTenantOnlyGuard } from '../../common/feature-gates';
import { AdminTrialsService } from './admin-trials.service';

/**
 * The trial funnel of platform administration (`doc/trial-funnel.md`), cloud only.
 * - `GET /admin/trials?state=`: one row per trial sign-up, the weekly counts, the number of
 *   workspaces without a sign-in 24 hours after their activation;
 * - `PUT /admin/trials/:tenantId/discovery-call { scheduled_at, status?, note? }`: the discovery
 *   call set by hand; `DELETE` removes it.
 */
@UseGuards(MultiTenantOnlyGuard, JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/trials')
export class AdminTrialsController {
  constructor(private readonly svc: AdminTrialsService) {}

  @Get()
  list(@Query() query: { state?: string }) {
    return this.svc.list(query);
  }

  @Put(':tenantId/discovery-call')
  saveDiscoveryCall(@Param('tenantId') tenantId: string, @Body() body: unknown, @Req() req: any) {
    return this.svc.saveDiscoveryCall(tenantId, body, req.user?.sub ?? null);
  }

  @Delete(':tenantId/discovery-call')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeDiscoveryCall(@Param('tenantId') tenantId: string, @Req() req: any): Promise<void> {
    await this.svc.removeDiscoveryCall(tenantId, req.user?.sub ?? null);
  }
}
