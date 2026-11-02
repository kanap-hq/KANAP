import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UnauthorizedException, UseGuards } from '@nestjs/common';
import { validate as isUuid } from 'uuid';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SkipTenantTransaction } from '../common/skip-tenant-transaction.decorator';
import { AiModelConfigService } from './ai-model-config.service';
import { AiPolicyService } from './ai-policy.service';
import { AiProviderTestService } from './ai-provider-test.service';
import { AiSecretCipherService } from './ai-secret-cipher.service';
import { CreateAiModelConfigDto, UpdateAiModelConfigDto } from './dto/ai-model-config.dto';
import { AiTenantExecutionService } from './execution/ai-tenant-execution.service';
import { reasoningEffortSupport } from './providers/reasoning-effort.capability';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';

type AiModelConfigsRequest = {
  tenant?: { id?: string };
  user?: { sub?: string };
  isPlatformHost?: boolean;
  id?: string | null;
};

@Controller('ai/model-configs')
@UseGuards(JwtAuthGuard)
@SkipTenantTransaction()
export class AiModelConfigsController {
  constructor(
    private readonly tenantExecutor: AiTenantExecutionService,
    private readonly policy: AiPolicyService,
    private readonly modelConfigs: AiModelConfigService,
    private readonly providerTest: AiProviderTestService,
    private readonly cipher: AiSecretCipherService,
  ) {}

  private requireTenantId(req: AiModelConfigsRequest): string {
    const tenantId = req?.tenant?.id;
    if (typeof tenantId !== 'string' || tenantId.trim() === '' || !isUuid(tenantId)) {
      throw new UnauthorizedException('Invalid tenant context.');
    }
    return tenantId;
  }

  private buildContext(req: AiModelConfigsRequest) {
    return {
      tenantId: this.requireTenantId(req),
      userId: String(req?.user?.sub || ''),
      isPlatformHost: req?.isPlatformHost === true,
      surface: 'chat' as const,
      authMethod: 'jwt' as const,
      requestId: req?.id ?? null,
      aiApiKeyId: null,
    };
  }

  @Get()
  async list(@Req() req: AiModelConfigsRequest) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        const tier = await this.policy.resolveModelConfigReadTier(context, manager);
        const configs = await this.modelConfigs.list(context.tenantId, manager);
        if (tier === 'assignment') {
          return {
            model_configs: configs.map(({ id, name, status, is_default, supports_vision }) => ({
              id,
              name,
              status,
              is_default,
              supports_vision,
            })),
            secret_writable: false,
          };
        }
        return {
          model_configs: configs,
          secret_writable: this.cipher.canEncrypt(),
        };
      },
    );
  }

  // The reasoning efforts a provider and model accept, for the model dialog. Reads no tenant data.
  @Get('reasoning-efforts')
  reasoningEfforts(@Query('provider') provider?: string, @Query('model') model?: string) {
    const support = reasoningEffortSupport(provider ?? null, model ?? null);
    return { levels: support.levels, server_may_ignore: support.serverMayIgnore };
  }

  @ReservedToUnscopedDataAccess()
  @Post()
  async create(@Body() body: CreateAiModelConfigDto, @Req() req: AiModelConfigsRequest) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        return {
          model_config: await this.modelConfigs.create(context.tenantId, body, {
            manager,
            userId: context.userId,
            sourceRef: context.requestId ?? null,
          }),
        };
      },
      { transaction: true },
    );
  }

  @ReservedToUnscopedDataAccess()
  @Patch(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateAiModelConfigDto,
    @Req() req: AiModelConfigsRequest,
  ) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        return {
          model_config: await this.modelConfigs.update(context.tenantId, id, body, {
            manager,
            userId: context.userId,
            sourceRef: context.requestId ?? null,
          }),
        };
      },
      { transaction: true },
    );
  }

  @ReservedToUnscopedDataAccess()
  @Delete(':id')
  async archive(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AiModelConfigsRequest) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        return {
          model_config: await this.modelConfigs.archive(context.tenantId, id, {
            manager,
            userId: context.userId,
            sourceRef: context.requestId ?? null,
          }),
        };
      },
      { transaction: true },
    );
  }

  @ReservedToUnscopedDataAccess()
  @Post(':id/restore')
  async restore(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AiModelConfigsRequest) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        return {
          model_config: await this.modelConfigs.restore(context.tenantId, id, {
            manager,
            userId: context.userId,
            sourceRef: context.requestId ?? null,
          }),
        };
      },
      { transaction: true },
    );
  }

  @ReservedToUnscopedDataAccess()
  @Post(':id/set-default')
  async setDefault(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AiModelConfigsRequest) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        return {
          model_config: await this.modelConfigs.setDefault(context.tenantId, id, {
            manager,
            userId: context.userId,
            sourceRef: context.requestId ?? null,
          }),
        };
      },
      { transaction: true },
    );
  }

  @ReservedToUnscopedDataAccess()
  @Post(':id/clear-default')
  async clearDefault(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AiModelConfigsRequest) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        return {
          model_config: await this.modelConfigs.clearDefaultAssignment(context.tenantId, id, {
            manager,
            userId: context.userId,
            sourceRef: context.requestId ?? null,
          }),
        };
      },
      { transaction: true },
    );
  }

  // Connection test for a stored registry entry: decrypts the saved key
  // server-side and runs the same one-shot probe as the ad-hoc settings test.
  @ReservedToUnscopedDataAccess()
  @Post(':id/test')
  async test(@Param('id', new ParseUUIDPipe()) id: string, @Req() req: AiModelConfigsRequest) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(
      context.tenantId,
      async (manager) => {
        await this.policy.assertSettingsAccess(context, manager);
        const config = await this.modelConfigs.getById(context.tenantId, id, manager);
        return this.providerTest.testProvider(
          context.tenantId,
          {
            llm_provider: config.provider,
            llm_model: config.model,
            llm_endpoint_url: config.endpoint_url,
            llm_api_key: config.api_key_encrypted ? this.cipher.decrypt(config.api_key_encrypted) : null,
            reasoning_effort: config.reasoning_effort ?? null,
          },
          { manager, skipStoredFallback: true },
        );
      },
      { transaction: false },
    );
  }
}
