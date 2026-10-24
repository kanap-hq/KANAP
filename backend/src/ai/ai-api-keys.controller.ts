import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { SkipTenantTransaction } from '../common/skip-tenant-transaction.decorator';
import { AiApiKeysService } from './ai-api-keys.service';
import { AiPolicyService } from './ai-policy.service';
import { AiMcpAuditService } from './control-plane/mcp/ai-mcp-audit.service';
import { AiTenantExecutionService } from './execution/ai-tenant-execution.service';
import { AiExecutionContext } from './ai.types';
import { ReservedToUnscopedDataAccess } from '../data-access/reserved-operations';

@Controller('ai')
@UseGuards(JwtAuthGuard)
@SkipTenantTransaction()
export class AiApiKeysController {
  constructor(
    private readonly tenantExecutor: AiTenantExecutionService,
    private readonly policy: AiPolicyService,
    private readonly apiKeys: AiApiKeysService,
    private readonly mcpAudit: AiMcpAuditService,
  ) {}

  private buildContext(req: any): AiExecutionContext {
    return {
      tenantId: String(req?.tenant?.id || ''),
      userId: String(req?.user?.sub || ''),
      isPlatformHost: req?.isPlatformHost === true,
      surface: 'mcp',
      authMethod: 'jwt',
      requestId: req?.id ?? null,
      aiApiKeyId: null,
    };
  }

  // Self-service endpoints
  @Post('keys')
  async create(
    @Body() body: {
      label: string;
      expires_at?: string;
      mcp_scopes?: string[];
      mcp_allowed_capabilities?: string[];
      mcp_denied_capabilities?: string[];
      mcp_rate_limit_per_minute?: number | null;
    },
    @Req() req: any,
  ) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(context.tenantId, async (manager) => {
      await this.policy.assertKeyManagementAccess(context, manager);
      return this.apiKeys.createKey(
        {
          tenantId: context.tenantId,
          userId: context.userId,
          label: body.label,
          expiresAt: body.expires_at ? new Date(body.expires_at) : null,
          createdByUserId: context.userId,
          mcpScopes: body.mcp_scopes as any,
          mcpAllowedCapabilities: body.mcp_allowed_capabilities,
          mcpDeniedCapabilities: body.mcp_denied_capabilities,
          mcpRateLimitPerMinute: body.mcp_rate_limit_per_minute ?? undefined,
        },
        { manager },
      );
    });
  }

  @Get('keys')
  async list(@Req() req: any) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(context.tenantId, async (manager) => {
      await this.policy.assertKeyManagementAccess(context, manager);
      return this.apiKeys.listForUser(context.tenantId, context.userId, { manager });
    });
  }

  @Delete('keys/:id')
  async revoke(@Param('id') id: string, @Req() req: any) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(context.tenantId, async (manager) => {
      await this.policy.assertKeyManagementAccess(context, manager);
      const key = await this.apiKeys.findById(id, { manager });
      if (!key || key.tenant_id !== context.tenantId || key.user_id !== context.userId) {
        throw new ForbiddenException('Key not found or access denied.');
      }
      return this.apiKeys.revokeKey(id, {
        manager,
        userId: context.userId,
        tenantId: context.tenantId,
        revocationReason: 'user_self_service',
      });
    });
  }

  // Admin endpoints
  @ReservedToUnscopedDataAccess()
  @Get('admin/keys')
  async adminList(@Req() req: any) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(context.tenantId, async (manager) => {
      await this.policy.assertSettingsAccess(context, manager);
      return this.apiKeys.listForTenant(context.tenantId, { manager });
    });
  }

  @ReservedToUnscopedDataAccess()
  @Delete('admin/keys/:id')
  async adminRevoke(@Param('id') id: string, @Req() req: any) {
    const context = this.buildContext(req);
    return this.tenantExecutor.run(context.tenantId, async (manager) => {
      await this.policy.assertSettingsAccess(context, manager);
      const key = await this.apiKeys.findById(id, { manager });
      if (!key || key.tenant_id !== context.tenantId) {
        throw new ForbiddenException('Key not found.');
      }
      return this.apiKeys.revokeKey(id, {
        manager,
        userId: context.userId,
        tenantId: context.tenantId,
        revocationReason: 'admin_revocation',
      });
    });
  }

  @ReservedToUnscopedDataAccess()
  @Get('admin/mcp-audit')
  async adminMcpAudit(@Query() query: Record<string, unknown>, @Req() req: any) {
    const context = this.buildContext(req);
    return this.tenantExecutor.runWithContext(context, async (ctx) => {
      await this.policy.assertSettingsAccess(context, ctx.manager);
      return this.mcpAudit.list(ctx, {
        apiKeyId: query.api_key_id == null ? null : String(query.api_key_id),
        runId: query.run_id == null ? null : String(query.run_id),
        toolExecutionId: query.tool_execution_id == null ? null : String(query.tool_execution_id),
        capabilityName: query.capability_name == null ? null : String(query.capability_name),
        status: query.status == null ? null : String(query.status),
        limit: query.limit == null ? null : Number(query.limit),
      });
    });
  }
}
