import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { validate as isUuid } from 'uuid';
import { SkipTenantTransaction } from '../common/skip-tenant-transaction.decorator';
import { AiModelResolverService } from './ai-model-resolver.service';
import { AiSettingsService } from './ai-settings.service';
import { McpApiKeyAuthGuard } from './auth/mcp-api-key-auth.guard';
import { AiCapabilityDispatcherService } from './control-plane/dispatcher/ai-capability-dispatcher.service';
import { AiMcpAuditService } from './control-plane/mcp/ai-mcp-audit.service';
import { AiMcpExposureService } from './control-plane/mcp/ai-mcp-exposure.service';
import { AiMcpRateLimiter } from './control-plane/mcp/ai-mcp-rate-limiter.service';
import {
  AiMcpApiKeyPolicy,
  AiMcpScope,
  MCP_SCOPE_TOOLS_EXECUTE,
  MCP_SCOPE_TOOLS_LIST,
  assertMcpScope,
} from './control-plane/mcp/ai-mcp-access-policy';
import { AiTenantExecutionService } from './execution/ai-tenant-execution.service';
import { AiBuiltinRateLimiter } from './platform/ai-builtin-rate-limiter';
import { AiBuiltinUsageService } from './platform/ai-builtin-usage.service';
import { AiExecutionContext } from './ai.types';

@Controller('ai/mcp')
@SkipTenantTransaction()
export class AiMcpController {
  private readonly maxResponseChars = 64_000;

  constructor(
    private readonly dispatcher: AiCapabilityDispatcherService,
    private readonly mcpExposure: AiMcpExposureService,
    private readonly mcpAudit: AiMcpAuditService,
    private readonly mcpRateLimiter: AiMcpRateLimiter,
    private readonly tenantExecutor: AiTenantExecutionService,
    private readonly settingsService: AiSettingsService,
    private readonly modelResolver: AiModelResolverService,
    private readonly builtinUsage: AiBuiltinUsageService,
    private readonly builtinRateLimiter: AiBuiltinRateLimiter,
  ) {}

  private requireTenantId(req: Request): string {
    const tenantId = (req as any)?.tenant?.id;
    if (typeof tenantId !== 'string' || tenantId.trim() === '' || !isUuid(tenantId)) {
      throw new UnauthorizedException('Invalid tenant context.');
    }
    return tenantId;
  }

  private buildContext(req: Request): AiExecutionContext {
    return {
      tenantId: this.requireTenantId(req),
      userId: String((req as any)?.user?.sub || ''),
      isPlatformHost: (req as any)?.isPlatformHost === true,
      surface: 'mcp',
      authMethod: 'api_key',
      requestId: (req as any)?.id ?? null,
      aiApiKeyId: (req as any)?.user?.aiApiKeyId ?? null,
    };
  }

  private requireApiKey(req: Request): any {
    const apiKey = (req as any)?.aiApiKey;
    if (!apiKey || typeof apiKey !== 'object') {
      throw new UnauthorizedException('Missing MCP API key context.');
    }
    return apiKey;
  }

  private mcpMethods(body: unknown): Set<string> {
    const methods = new Set<string>();
    const bodies = Array.isArray(body) ? body : [body];
    for (const entry of bodies) {
      if (entry && typeof entry === 'object' && typeof (entry as any).method === 'string') {
        methods.add((entry as any).method);
      }
    }
    return methods;
  }

  private toolDefinitionScope(methods: Set<string>): AiMcpScope | null {
    if (methods.has('tools/call')) {
      return MCP_SCOPE_TOOLS_EXECUTE;
    }
    if (methods.has('tools/list')) {
      return MCP_SCOPE_TOOLS_LIST;
    }
    return null;
  }

  private assertMcpPostPreflight(
    context: AiExecutionContext,
    apiKey: any,
    methods: Set<string>,
  ): AiMcpApiKeyPolicy {
    const keyPolicy = this.mcpExposure.parsePolicy(apiKey);
    this.mcpRateLimiter.assertAllowed(context.tenantId, context.aiApiKeyId, keyPolicy.rateLimitPerMinute);

    if (!keyPolicy.valid) {
      throw new ForbiddenException('MCP API key policy is invalid.');
    }
    if (methods.has('tools/list') && methods.has('tools/call')) {
      throw new BadRequestException('MCP JSON-RPC batches must not mix tools/list and tools/call requests.');
    }
    if (methods.has('tools/list')) {
      assertMcpScope(keyPolicy, MCP_SCOPE_TOOLS_LIST);
    }
    if (methods.has('tools/call')) {
      assertMcpScope(keyPolicy, MCP_SCOPE_TOOLS_EXECUTE);
    }
    return keyPolicy;
  }

  // MCP requests count against the included volume whenever the assistant would fall back
  // on the included model, confirmed or not: MCP sends nothing to that model, so its
  // confirmation does not apply here (and the resolution carries no key).
  private async assertBuiltinMcpBudget(ctx: AiExecutionContext & { manager: any }) {
    const resolved = await this.modelResolver.tryResolve(ctx.tenantId, { type: 'chat' }, ctx.manager, {
      includedModelGate: 'none',
    });
    if (resolved?.source !== 'builtin' || !resolved.builtinRateLimits) {
      return;
    }
    this.builtinRateLimiter.assertAllowed(ctx.tenantId, ctx.userId, resolved.builtinRateLimits);
    const limit = await this.builtinUsage.getMonthlyLimit(ctx.manager);
    await this.builtinUsage.reserveMessage(ctx.tenantId, limit, ctx.manager);
  }

  private mcpTextResult(result: unknown): string {
    const text = JSON.stringify(result) ?? 'null';
    if (text.length <= this.maxResponseChars) {
      return text;
    }
    return JSON.stringify({
      truncated: true,
      reason: 'mcp_response_size_limit',
      max_chars: this.maxResponseChars,
      preview: text.slice(0, this.maxResponseChars),
    });
  }

  private auditFilters(query: Record<string, unknown>) {
    return {
      runId: query.run_id == null ? null : String(query.run_id),
      toolExecutionId: query.tool_execution_id == null ? null : String(query.tool_execution_id),
      capabilityName: query.capability_name == null ? null : String(query.capability_name),
      status: query.status == null ? null : String(query.status),
      limit: query.limit == null ? null : Number(query.limit),
    };
  }

  @Post()
  @UseGuards(McpApiKeyAuthGuard)
  async handlePost(@Req() req: Request, @Res() res: Response) {
    const context = this.buildContext(req);
    const apiKey = this.requireApiKey(req);
    const methods = this.mcpMethods(req.body);
    this.assertMcpPostPreflight(context, apiKey, methods);
    const definitionScope = this.toolDefinitionScope(methods);

    const toolDefs = await this.tenantExecutor.runWithContext(context, async (ctx) => {
      await this.mcpExposure.assertPostAccess(ctx, apiKey);
      if (definitionScope == null) {
        return [];
      }

        const definitions = await this.mcpExposure.listToolJsonSchemas(ctx, apiKey, definitionScope);
        if (methods.has('tools/list')) {
          await this.assertBuiltinMcpBudget(ctx);
        }
        return definitions;
    });

    const server = new McpServer({
      name: 'kanap-mcp',
      version: '1.0.0',
    });

    for (const toolDef of toolDefs) {
      server.tool(
        toolDef.name,
        toolDef.description,
        toolDef.parameters as any,
        async (args: any) => {
          const result = await this.tenantExecutor.runWithContext(context, async (ctx) => {
            const keyPolicy = this.mcpExposure.parsePolicy(apiKey);
            await this.mcpExposure.assertCanExecute(ctx, apiKey, toolDef.name);
            this.mcpRateLimiter.assertAllowed(ctx.tenantId, ctx.aiApiKeyId, keyPolicy.rateLimitPerMinute);
            await this.assertBuiltinMcpBudget(ctx);
            const dispatched = await this.dispatcher.execute(ctx, {
              capabilityName: toolDef.name,
              input: args,
              execution: {
                surface: 'mcp',
                trigger_kind: 'mcp_client',
                metadata: {
                  ai_api_key_id: ctx.aiApiKeyId ?? null,
                },
              },
            });
            return dispatched.output;
          });
          return {
            content: [{ type: 'text' as const, text: this.mcpTextResult(result) }],
          };
        },
      );
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined, // stateless
    });

    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });

    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }

  @Get('audit')
  @UseGuards(McpApiKeyAuthGuard)
  async listAudit(@Req() req: Request, @Query() query: Record<string, unknown>) {
    const context = this.buildContext(req);
    const apiKey = this.requireApiKey(req);
    return this.tenantExecutor.runWithContext(context, async (ctx) => {
      const keyPolicy = await this.mcpExposure.assertCanReadAudit(ctx, apiKey);
      this.mcpRateLimiter.assertAllowed(ctx.tenantId, ctx.aiApiKeyId, keyPolicy.rateLimitPerMinute);
      return this.mcpAudit.list(ctx, {
        ...this.auditFilters(query),
        apiKeyId: ctx.aiApiKeyId ?? null,
      });
    });
  }

  @Get()
  handleGet(@Res() res: Response) {
    res.status(405).json({ error: 'SSE transport not supported. Use POST with Streamable HTTP.' });
  }

  @Delete()
  handleDelete(@Res() res: Response) {
    res.status(405).json({ error: 'Session cleanup not supported in stateless mode.' });
  }
}
