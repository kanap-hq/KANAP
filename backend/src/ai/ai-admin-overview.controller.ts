import { Controller, ForbiddenException, Get, Req, UseGuards } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SkipTenantTransaction } from '../common/skip-tenant-transaction.decorator';
import { AiPolicyService } from './ai-policy.service';
import { AiTenantExecutionService } from './execution/ai-tenant-execution.service';
import { AiExecutionContext } from './ai.types';
import { AiAdminOverviewService } from './ai-admin-overview.service';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';

@ReservedToUnscopedDataAccess()
@Controller('ai/admin')
@UseGuards(JwtAuthGuard)
@SkipTenantTransaction()
export class AiAdminOverviewController {
  constructor(
    private readonly tenantExecutor: AiTenantExecutionService,
    private readonly policy: AiPolicyService,
    private readonly overviewService: AiAdminOverviewService,
  ) {}

  private buildContext(req: any): AiExecutionContext {
    const tenantId = req?.tenant?.id ? String(req.tenant.id) : '';
    if (!tenantId || !isUuid(tenantId)) {
      throw new ForbiddenException('Valid tenant context is required.');
    }

    return {
      tenantId,
      userId: String(req?.user?.sub || ''),
      isPlatformHost: req?.isPlatformHost === true,
      surface: 'chat',
      authMethod: 'jwt',
      requestId: req?.id ?? null,
      aiApiKeyId: null,
    };
  }

  @Get('overview')
  async getOverview(@Req() req: any) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        return this.overviewService.getOverview(context.tenantId, manager);
      },
      { transaction: false },
    );
  }
}
