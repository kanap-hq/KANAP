import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpException,
  Logger,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Request, Response } from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { validate as isUuid } from 'uuid';
import { SkipTenantTransaction } from '../common/skip-tenant-transaction.decorator';
import { McpApiKeyAuthGuard } from './auth/mcp-api-key-auth.guard';
import { AiCapabilityDispatcherService } from './control-plane/dispatcher/ai-capability-dispatcher.service';
import { AiMcpAuditService, AiMcpCallRecord, McpCallReason } from './control-plane/mcp/ai-mcp-audit.service';
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
import { AiExecutionContext } from './ai.types';
import { APP_VERSION } from '../config/version';

/** A readable tool title from its name: `get_entity_detail` → "Get entity detail". */
export function toolTitle(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : name;
}

/**
 * What `initialize` tells a client about this server: read only, the person's rights, how to
 * search, and the families it does not read (so that an empty answer is not taken for "none").
 */
export const MCP_SERVER_INSTRUCTIONS = [
  'KANAP MCP server. It only reads: no tool creates, changes or deletes anything; changes are made in KANAP.',
  'Every call runs with the rights of the person who owns the key or the connection: records they cannot read are left out.',
  'To find a record, start with search_all (names, codes and references such as APP-4; cost centers, calendars and dimensions included). Before query_entities or aggregate_entities on a family, call describe_entity_filters for its fields and get_filter_values for exact values. get_entity_detail and get_entity_context read one record.',
  'This server does not read the audit log or AI agents, and it reads roles and data access settings only for a person who administers users with access to all data: an empty answer about them does not mean they do not exist. Exchange rates: query_entities on exchange_rates.',
  'Budget lines are one family, budget_lines: a question that names no nature covers both OPEX and CAPEX. aggregate_entities describes their budget keys and computes FTE, cost per FTE and day rate per group (metric y_budget_cost_per_fte) with no describe call first.',
].join('\n');

/** The instructions of `initialize`, opened by the workspace the key or connection reads. */
export function mcpServerInstructions(workspace: { name: string | null; slug: string | null } | null): string {
  if (!workspace?.name && !workspace?.slug) return MCP_SERVER_INSTRUCTIONS;
  const label = workspace.name && workspace.slug && workspace.name !== workspace.slug
    ? `"${workspace.name}" (${workspace.slug})`
    : `"${workspace.name ?? workspace.slug}"`;
  return [`This connection reads the KANAP workspace ${label}, and only that one.`, MCP_SERVER_INSTRUCTIONS].join('\n');
}

/** A JSON-RPC error the MCP SDK sends with this code (it reads `code` from the thrown error). */
function jsonRpcError(code: number, message: string): Error & { code: number } {
  return Object.assign(new Error(message), { code });
}

/** How the journal records a tool that threw: an HTTP refusal by its status, anything else as an error. */
function reasonOfThrown(error: unknown): McpCallReason {
  if (!(error instanceof HttpException)) return 'error';
  const status = error.getStatus();
  if (status === 403) return 'permission';
  if (status === 404) return 'not_found';
  if (status >= 400 && status < 500) return 'invalid_input';
  return 'error';
}

/** What an MCP client reads when a tool fails for a reason other than its input or access. */
export function internalToolErrorMessage(reference: string): string {
  return `KANAP could not complete this request. This may be temporary: try again in a moment. If it keeps failing, report reference ${reference} to the KANAP administrator.`;
}

@Controller('ai/mcp')
@SkipTenantTransaction()
export class AiMcpController {
  private readonly logger = new Logger(AiMcpController.name);
  private readonly maxResponseChars = 64_000;

  constructor(
    private readonly dispatcher: AiCapabilityDispatcherService,
    private readonly mcpExposure: AiMcpExposureService,
    private readonly mcpAudit: AiMcpAuditService,
    private readonly mcpRateLimiter: AiMcpRateLimiter,
    private readonly tenantExecutor: AiTenantExecutionService,
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
      authMethod: (req as any)?.user?.authMethod === 'oauth' ? 'oauth' : 'api_key',
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

  // Each JSON-RPC message counts once against the key's limit; a body that is not one counts once.
  private mcpRequestCount(body: unknown): number {
    return Array.isArray(body) ? Math.max(body.length, 1) : 1;
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
    requestCount: number,
  ): AiMcpApiKeyPolicy {
    // The only place a POST is counted: before any lookup, so refused and bogus requests count too.
    // MCP sends nothing to the included model, so it draws on neither its throttle nor its monthly
    // allowance: this per-key limit is the guard.
    const keyPolicy = this.mcpExposure.parsePolicy(apiKey);
    this.mcpRateLimiter.assertAllowed(
      context.tenantId,
      context.aiApiKeyId,
      keyPolicy.rateLimitPerMinute,
      requestCount,
    );

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
    const text = (value: unknown) => (value == null ? null : String(value));
    return {
      runId: text(query.run_id),
      toolExecutionId: text(query.tool_execution_id),
      capabilityName: text(query.capability_name),
      status: text(query.status),
      result: text(query.result),
      from: text(query.from),
      to: text(query.to),
      limit: query.limit == null ? null : Number(query.limit),
      offset: query.offset == null ? null : Number(query.offset),
    };
  }

  /**
   * Writes a refused or failed call to the MCP journal, after the request transaction rolled
   * back, in one of its own. Never fails the call: a line that cannot be written is logged.
   */
  private async recordCall(
    context: AiExecutionContext,
    record: Omit<AiMcpCallRecord, 'userId' | 'apiKeyId' | 'requestId'>,
  ): Promise<void> {
    try {
      await this.tenantExecutor.runWithContext(context, (ctx) => this.mcpAudit.recordCall(ctx, {
        ...record,
        userId: context.userId || null,
        apiKeyId: context.aiApiKeyId ?? null,
        requestId: context.requestId ?? null,
      }));
    } catch (error) {
      this.logger.warn(
        // The tool name comes from the client: quoted and cut, so that it cannot forge or flood a log line.
        `MCP journal line not written for ${JSON.stringify(String(record.toolName).slice(0, 80))}, tenant ${context.tenantId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  @Post()
  @UseGuards(McpApiKeyAuthGuard)
  async handlePost(@Req() req: Request, @Res() res: Response) {
    const context = this.buildContext(req);
    const apiKey = this.requireApiKey(req);
    const methods = this.mcpMethods(req.body);
    this.assertMcpPostPreflight(context, apiKey, methods, this.mcpRequestCount(req.body));
    const definitionScope = this.toolDefinitionScope(methods);

    let workspace: { name: string | null; slug: string | null } | null = null;
    const toolDefs = await this.tenantExecutor.runWithContext(context, async (ctx) => {
      await this.mcpExposure.assertPostAccess(ctx, apiKey);
      if (methods.has('initialize')) {
        // The client names the workspace it reads from the instructions (a person may connect several).
        const rows = await ctx.manager.query(`SELECT name, slug FROM tenants WHERE id = $1`, [ctx.tenantId]);
        workspace = Array.isArray(rows) && rows[0] ? { name: rows[0].name ?? null, slug: rows[0].slug ?? null } : null;
      }
      if (definitionScope == null) {
        return [];
      }

      return this.mcpExposure.listToolJsonSchemas(ctx, apiKey, definitionScope);
    });

    // The low-level server takes the capabilities' JSON Schemas as they are (McpServer wants Zod).
    const server = new Server(
      { name: 'kanap-mcp', title: 'KANAP', version: APP_VERSION },
      { capabilities: { tools: {} }, instructions: mcpServerInstructions(workspace) },
    );

    server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: toolDefs.map((toolDef) => ({
        name: toolDef.name,
        title: toolTitle(toolDef.name),
        description: toolDef.description,
        inputSchema: toolDef.parameters as any,
        // MCP exposes read-only capabilities only (capability-contract.ts, `mcp_exposure`); the
        // Anthropic directory asks for a title and this hint on every tool.
        annotations: { title: toolTitle(toolDef.name), readOnlyHint: true },
      })),
    }));

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const startedAt = Date.now();
      const name = request.params.name;
      const args = request.params.arguments ?? {};
      const toolDef = toolDefs.find((def) => def.name === name);
      if (!toolDef) {
        // MCP: an unknown name is a JSON-RPC -32602; a known tool this call may not run is a tool
        // result the client's model reads, with the cause.
        const refusal = this.mcpExposure.explainRefusal(apiKey, name);
        await this.recordCall(context, {
          toolName: name,
          arguments: args,
          reason: refusal.reason,
          message: refusal.message,
          effect: refusal.effect,
          durationMs: Date.now() - startedAt,
        });
        if (refusal.reason === 'unknown_tool') {
          throw jsonRpcError(ErrorCode.InvalidParams, refusal.message);
        }
        return { content: [{ type: 'text' as const, text: refusal.message }], isError: true };
      }
      let result: unknown;
      try {
        result = await this.tenantExecutor.runWithContext(context, async (ctx) => {
          await this.mcpExposure.assertCanExecute(ctx, apiKey, toolDef.name);
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
      } catch (error) {
        // A tool error goes back as a tool result, so the client's model can read it and retry.
        // Only our own HTTP errors carry a message meant for the caller; any other error is logged
        // here, once, under a reference the caller can quote. The request transaction rolled back
        // the dispatcher's lines: the journal gets its own.
        let text: string;
        if (error instanceof HttpException) {
          text = error.message;
        } else {
          const reference = context.requestId || randomBytes(4).toString('hex');
          this.logger.error(
            `MCP tool ${toolDef.name} failed, reference ${reference}, tenant ${context.tenantId}`,
            error instanceof Error ? error.stack : String(error),
          );
          text = internalToolErrorMessage(reference);
        }
        await this.recordCall(context, {
          toolName: toolDef.name,
          arguments: args,
          reason: reasonOfThrown(error),
          message: text,
          effect: 'read',
          durationMs: Date.now() - startedAt,
        });
        return { content: [{ type: 'text' as const, text }], isError: true };
      }
      return {
        content: [{ type: 'text' as const, text: this.mcpTextResult(result) }],
      };
    });

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
