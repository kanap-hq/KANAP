import { Body, Controller, Get, Patch, Post, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SkipTenantTransaction } from '../common/skip-tenant-transaction.decorator';
import { Features } from '../config/features';
import { AiPolicyService } from './ai-policy.service';
import { AiProviderTestService } from './ai-provider-test.service';
import { AiSettingsService } from './ai-settings.service';
import { UpdateAiSettingsDto } from './dto/update-ai-settings.dto';
import { AiTenantExecutionService } from './execution/ai-tenant-execution.service';
import { AiBuiltinUsageService } from './platform/ai-builtin-usage.service';
import { AiProviderRegistry } from './providers/ai-provider-registry.service';
import { GlpiService } from './glpi/glpi.service';
import { BraveSearchService } from './web-search/brave-search.service';
import { AiExecutionContext } from './ai.types';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';

type AiSettingsRequest = {
  tenant?: { id?: string };
  user?: { sub?: string };
  isPlatformHost?: boolean;
  id?: string | null;
};

@ReservedToUnscopedDataAccess()
@Controller('ai/settings')
@UseGuards(JwtAuthGuard)
@SkipTenantTransaction()
export class AiSettingsController {
  constructor(
    private readonly tenantExecutor: AiTenantExecutionService,
    private readonly policy: AiPolicyService,
    private readonly settingsService: AiSettingsService,
    private readonly providerTest: AiProviderTestService,
    private readonly providerRegistry: AiProviderRegistry,
    private readonly braveSearch: BraveSearchService,
    private readonly glpi: GlpiService,
    private readonly builtinUsage: AiBuiltinUsageService,
  ) {}

  private requireTenantId(req: AiSettingsRequest): string {
    const tenantId = req?.tenant?.id;
    if (typeof tenantId !== 'string' || tenantId.trim() === '' || !isUuid(tenantId)) {
      throw new UnauthorizedException('Invalid tenant context.');
    }
    return tenantId;
  }

  private buildContext(req: AiSettingsRequest): AiExecutionContext {
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

  @Get()
  async getSettings(@Req() req: AiSettingsRequest) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        const settings = await this.settingsService.get(context.tenantId, { manager });
        return {
          instance_features: {
            ai_chat: Features.AI_CHAT_ENABLED,
            ai_mcp: Features.AI_MCP_ENABLED,
            ai_settings: Features.AI_SETTINGS_ENABLED,
            ai_web_search: Features.AI_WEB_SEARCH_READY,
          },
          settings: await this.settingsService.toView(settings, { manager }),
          available_providers: this.providerRegistry.list(),
        };
      },
    );
  }

  @Patch()
  async updateSettings(
    @Body() body: UpdateAiSettingsDto,
    @Req() req: AiSettingsRequest,
  ) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        const settings = await this.settingsService.update(context.tenantId, body, {
          manager,
          userId: context.userId,
          sourceRef: context.requestId ?? null,
        });
        return {
          settings: await this.settingsService.toView(settings, { manager }),
        };
      },
      { transaction: true },
    );
  }

  @Get('builtin-usage')
  async getBuiltinUsage(@Req() req: AiSettingsRequest) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        return this.builtinUsage.getCurrentUsage(context.tenantId, manager);
      },
      { transaction: false },
    );
  }

  @Post('test-provider')
  async testProvider(
    @Body() body: {
      llm_provider?: string | null;
      llm_model?: string | null;
      llm_endpoint_url?: string | null;
      llm_api_key?: string | null;
    },
    @Req() req: AiSettingsRequest,
  ) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        return this.providerTest.testProvider(context.tenantId, body, { manager });
      },
      { transaction: false },
    );
  }

  @Post('test-web-search')
  async testWebSearch(@Req() req: AiSettingsRequest) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        return this.braveSearch.testConnectivity();
      },
      { transaction: false },
    );
  }

  @Post('test-glpi')
  async testGlpi(
    @Body() body: {
      glpi_url?: string | null;
      glpi_user_token?: string | null;
      glpi_app_token?: string | null;
    },
    @Req() req: AiSettingsRequest,
  ) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        return this.glpi.testConnection(context.tenantId, body, manager);
      },
      { transaction: false },
    );
  }
}
