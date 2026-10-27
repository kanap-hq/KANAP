import { CanActivate, ExecutionContext, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { AiApiKeysService, McpKeyRefusedException } from '../ai-api-keys.service';
import { AiMcpAuditService } from '../control-plane/mcp/ai-mcp-audit.service';
import { AiTenantExecutionService } from '../execution/ai-tenant-execution.service';
import { McpOAuthService } from '../oauth/mcp-oauth.service';
import { looksLikeJwt } from '../oauth/mcp-oauth-tokens';
import { mcpBearerChallenge, oauthHostOf, requestOrigin } from '../oauth/mcp-oauth.util';

const API_KEY_PREFIX = 'kanap_mcp_';
/** A refused key writes at most one journal line per this gap: a client retrying a revoked key cannot flood it. */
const REFUSED_KEY_JOURNAL_GAP_MS = 10_000;
const REFUSED_KEY_JOURNAL_MAX_TRACKED = 10_000;

/**
 * MCP endpoint authentication: a personal API key (`kanap_mcp_…`, `Authorization: Bearer` or
 * `X-API-Key`), or an OAuth access token of the `mcp-access` family (`Authorization: Bearer` only).
 * Nothing else opens it, a web session token included.
 *
 * Every 401 carries the `WWW-Authenticate` challenge that points MCP clients to the protected
 * resource metadata (RFC 9728): without a credential, it is what starts the OAuth sign-in.
 */
@Injectable()
export class McpApiKeyAuthGuard implements CanActivate {
  private readonly logger = new Logger(McpApiKeyAuthGuard.name);
  private readonly refusedKeyJournaledAt = new Map<string, number>();

  constructor(
    private readonly apiKeys: AiApiKeysService,
    private readonly tenantExecutor: AiTenantExecutionService,
    private readonly oauth: McpOAuthService,
    @Optional() private readonly mcpAudit?: AiMcpAuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req: any = http.getRequest();
    const startedAt = Date.now();
    try {
      return await this.authenticate(req);
    } catch (error) {
      if (error instanceof McpKeyRefusedException) {
        await this.recordRefusedKey(req, error, Date.now() - startedAt);
      }
      const res: any = http.getResponse?.();
      if (error instanceof UnauthorizedException && typeof res?.setHeader === 'function' && !res.headersSent) {
        const credentialPresented = !!this.extractRawKey(req);
        res.setHeader('WWW-Authenticate', mcpBearerChallenge(requestOrigin(req), credentialPresented ? 'invalid_token' : undefined));
      }
      throw error;
    }
  }

  private async authenticate(req: any): Promise<boolean> {
    const rawKey = this.extractRawKey(req);
    if (!rawKey) {
      throw new UnauthorizedException('Missing MCP credential');
    }
    const fromAuthorization = String(req?.headers?.authorization ?? '').trim().startsWith('Bearer ');

    // ai_api_keys is under FORCE RLS: the key is looked up inside the tenant named by the host.
    const tenantId = req?.tenant?.id ? String(req.tenant.id) : null;
    if (!tenantId) {
      throw new UnauthorizedException('MCP requests must use the tenant address.');
    }

    // An access token is accepted in `Authorization: Bearer` only (RFC 6750 §2.1, MCP authorization).
    if (fromAuthorization && !rawKey.startsWith(API_KEY_PREFIX) && looksLikeJwt(rawKey)) {
      return this.authenticateOAuth(req, rawKey);
    }

    const { apiKey, user } = await this.tenantExecutor.run(tenantId, (manager) =>
      this.apiKeys.authenticatePresentedKey(rawKey, { manager, tenantId }),
    );
    if (apiKey.tenant_id !== tenantId) {
      throw new UnauthorizedException('MCP API key tenant mismatch');
    }

    req.user = {
      sub: user?.id ?? apiKey.user_id,
      email: user?.email ?? null,
      authType: 'mcp',
      authMethod: 'api_key',
      aiApiKeyId: apiKey.id,
    };
    req.aiApiKey = this.apiKeys.toView(apiKey);

    return true;
  }

  private async authenticateOAuth(req: any, token: string): Promise<boolean> {
    const host = oauthHostOf(req);
    const authenticated = host ? await this.oauth.authenticateAccessToken(token, host) : null;
    if (!authenticated) {
      throw new UnauthorizedException('Invalid or expired MCP access token.');
    }
    const { grant, user } = authenticated;
    req.user = {
      sub: grant.user_id,
      email: user?.email ?? null,
      authType: 'mcp',
      authMethod: 'oauth',
      // The grant row stands for the key: MCP policy, rate limit and audit apply unchanged.
      aiApiKeyId: grant.id,
    };
    req.aiApiKey = this.apiKeys.toView(grant);
    return true;
  }

  /**
   * A known key refused (revoked, expired, owner no longer allowed) leaves a line in the MCP
   * journal: the tool named by a tools/call, or the JSON-RPC method. The key's value never does.
   * The request transaction rolled back, so the line has a transaction of its own. The duration is
   * the time the key check took, as for the other refusals.
   */
  private async recordRefusedKey(req: any, error: McpKeyRefusedException, durationMs: number): Promise<void> {
    if (!this.mcpAudit || req?.method !== 'POST') return;
    const messages = Array.isArray(req?.body) ? req.body : [req?.body];
    const first = messages.find((entry: any) => entry && typeof entry === 'object' && typeof entry.method === 'string');
    const isCall = first?.method === 'tools/call' && typeof first?.params?.name === 'string';
    const { tenantId, keyId, userId, reason } = error.refusal;
    const now = Date.now();
    const last = this.refusedKeyJournaledAt.get(keyId);
    if (last != null && now - last < REFUSED_KEY_JOURNAL_GAP_MS) return;
    if (this.refusedKeyJournaledAt.size >= REFUSED_KEY_JOURNAL_MAX_TRACKED) this.refusedKeyJournaledAt.clear();
    this.refusedKeyJournaledAt.set(keyId, now);
    try {
      await this.tenantExecutor.run(tenantId, (manager) => this.mcpAudit!.recordCall({ tenantId, manager }, {
        toolName: isCall ? first.params.name : (first?.method ?? 'request'),
        arguments: isCall ? first.params.arguments : undefined,
        reason,
        message: error.message,
        durationMs,
        userId,
        apiKeyId: keyId,
        requestId: req?.id ?? null,
      }));
    } catch (recordError) {
      this.logger.warn(
        `MCP journal line not written for a refused key, tenant ${tenantId}: ${recordError instanceof Error ? recordError.message : String(recordError)}`,
      );
    }
  }

  private extractRawKey(req: any): string | null {
    const authHeader = String(req?.headers?.authorization ?? '').trim();
    if (authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice('Bearer '.length).trim();
      return token || null;
    }

    const apiKeyHeader = String(req?.headers?.['x-api-key'] ?? '').trim();
    return apiKeyHeader || null;
  }
}
