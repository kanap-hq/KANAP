import { Body, Controller, Get, Post, Put, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SkipTenantTransaction } from '../common/skip-tenant-transaction.decorator';
import { AiPolicyService } from './ai-policy.service';
import { AiExecutionContext } from './ai.types';
import {
  AiMonitoringIntegrationsService,
  PrtgIntegrationSaveInput,
  PrtgIntegrationTestInput,
} from './control-plane/providers/ai-monitoring-integrations.service';
import { AiTenantExecutionService } from './execution/ai-tenant-execution.service';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';

type AiIntegrationsRequest = {
  tenant?: { id?: string };
  user?: { sub?: string };
  isPlatformHost?: boolean;
  id?: string | null;
};

// Admin endpoints for external tool integrations (monitoring adapters).
// Gated exactly like the AI settings write path: JwtAuthGuard + the
// ai_settings admin policy assert inside the tenant executor.
@ReservedToUnscopedDataAccess()
@Controller('ai/admin/integrations')
@UseGuards(JwtAuthGuard)
@SkipTenantTransaction()
export class AiIntegrationsController {
  constructor(
    private readonly tenantExecutor: AiTenantExecutionService,
    private readonly policy: AiPolicyService,
    private readonly monitoringIntegrations: AiMonitoringIntegrationsService,
  ) {}

  private requireTenantId(req: AiIntegrationsRequest): string {
    const tenantId = req?.tenant?.id;
    if (typeof tenantId !== 'string' || tenantId.trim() === '' || !isUuid(tenantId)) {
      throw new UnauthorizedException('Invalid tenant context.');
    }
    return tenantId;
  }

  private buildContext(req: AiIntegrationsRequest): AiExecutionContext {
    return {
      tenantId: this.requireTenantId(req),
      userId: String(req?.user?.sub || ''),
      isPlatformHost: req?.isPlatformHost === true,
      surface: 'chat',
      authMethod: 'jwt',
      requestId: req?.id ?? null,
      aiApiKeyId: null,
    };
  }

  @Get('monitoring')
  async listMonitoring(@Req() req: AiIntegrationsRequest) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        return this.monitoringIntegrations.listMonitoringIntegrations({ ...context, manager });
      },
      { transaction: false },
    );
  }

  @Put('monitoring/prtg')
  async savePrtg(
    @Body() body: PrtgIntegrationSaveInput,
    @Req() req: AiIntegrationsRequest,
  ) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        return this.monitoringIntegrations.savePrtgIntegration({ ...context, manager }, body ?? {});
      },
      { transaction: true },
    );
  }

  @Post('monitoring/prtg/test')
  async testPrtg(
    @Body() body: PrtgIntegrationTestInput,
    @Req() req: AiIntegrationsRequest,
  ) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        return this.monitoringIntegrations.testPrtgIntegration({ ...context, manager }, body ?? {});
      },
      { transaction: false },
    );
  }
}
