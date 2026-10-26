import { Controller, ForbiddenException, Post, Req, UseGuards } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { SkipTenantTransaction } from '../../common/skip-tenant-transaction.decorator';
import { AiPolicyService } from '../ai-policy.service';
import { AiTenantExecutionService } from '../execution/ai-tenant-execution.service';
import { AiExecutionContext } from '../ai.types';
import { AiSearchIndexService } from './ai-search-index.service';
import { ReservedToUnscopedDataAccess } from '../../data-access/reserved-operations';

@ReservedToUnscopedDataAccess()
@Controller('ai/admin')
@UseGuards(JwtAuthGuard)
@SkipTenantTransaction()
export class AiAdminSearchIndexController {
  constructor(
    private readonly tenantExecutor: AiTenantExecutionService,
    private readonly policy: AiPolicyService,
    private readonly searchIndex: AiSearchIndexService,
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

  @Post('search-index/reindex')
  async reindex(@Req() req: any) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        const result = await this.searchIndex.reindexTenant(manager, context.tenantId);
        return { status: 'ok', ...result };
      },
      { transaction: false },
    );
  }
}
