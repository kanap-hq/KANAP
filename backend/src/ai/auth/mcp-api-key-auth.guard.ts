import { CanActivate, ExecutionContext, Injectable, Logger, Optional, UnauthorizedException } from '@nestjs/common';
import { AiApiKeysService, McpKeyRefusedException } from '../ai-api-keys.service';
import { AiMcpAuditService } from '../control-plane/mcp/ai-mcp-audit.service';
import { AiTenantExecutionService } from '../execution/ai-tenant-execution.service';
import { McpOAuthService } from '../oauth/mcp-oauth.service';
import { looksLikeJwt } from '../oauth/mcp-oauth-tokens';
import { mcpBearerChallenge, oauthHostOf, requestOrigin } from '../oauth/mcp-oauth.util';

const API_KEY_PREFIX = 'kanap_mcp_';
/**
 * A refused key writes at most one MCP journal line and one general audit row per this gap:
 * a client retrying a revoked key cannot flood either.
 */
const REFUSED_KEY_JOURNAL_GAP_MS = 10_000;
const REFUSED_KEY_JOURNAL_MAX_TRACKED = 10_000;
/** The audit log keeps the short reason (`revoked`), the journal the long one (`key_revoked`). */
const REFUSED_KEY_AUDIT_REASON = {
  key_revoked: 'revoked',
  key_expired: 'expired',
  owner_not_allowed: 'owner_not_allowed',
} as const;

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
      if (error instanceof McpKeyRefusedException && this.claimRefusedKeySlot(error.refusal.keyId)) {
        const durationMs = Date.now() - startedAt;
        await this.recordRefusedKey(req, error, durationMs);
        await this.recordRefusedKeyAudit(error);
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
   * One slot per key per gap, shared by the MCP journal and the general audit log. The caller
   * takes it before either write, so a retry inside the gap leaves both as they were.
   */
  private claimRefusedKeySlot(keyId: string): boolean {
    const now = Date.now();
    const last = this.refusedKeyJournaledAt.get(keyId);
    if (last != null && now - last < REFUSED_KEY_JOURNAL_GAP_MS) return false;
    if (this.refusedKeyJournaledAt.size >= REFUSED_KEY_JOURNAL_MAX_TRACKED) this.refusedKeyJournaledAt.clear();
    this.refusedKeyJournaledAt.set(keyId, now);
    return true;
  }

  /**
   * A known key refused (revoked, expired, owner no longer allowed) leaves a line in the MCP
   * journal: the tool named by a tools/call, or the JSON-RPC method. The key's value never does.
   * The request transaction rolled back, so the line has a transaction of its own. The duration is
   * the time the key check took, as for the other refusals. The gap is applied by the caller.
   */
  private async recordRefusedKey(req: any, error: McpKeyRefusedException, durationMs: number): Promise<void> {
    if (!this.mcpAudit || req?.method !== 'POST') return;
    const messages = Array.isArray(req?.body) ? req.body : [req?.body];
    const first = messages.find((entry: any) => entry && typeof entry === 'object' && typeof entry.method === 'string');
    const isCall = first?.method === 'tools/call' && typeof first?.params?.name === 'string';
    const { tenantId, keyId, userId, reason } = error.refusal;
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

  /**
   * The same refusal in the general audit log. The request transaction rolled back, so the row
   * has a transaction of its own, after that one. One row per claimed slot, never two.
   */
  private async recordRefusedKeyAudit(error: McpKeyRefusedException): Promise<void> {
    const { tenantId, keyId, userId, reason } = error.refusal;
    try {
      await this.tenantExecutor.run(tenantId, (manager) => this.apiKeys.logAudit({
        table: 'ai_api_keys',
        recordId: keyId,
        action: 'update',
        before: null,
        after: { authentication: 'failed', reason: REFUSED_KEY_AUDIT_REASON[reason] },
        userId,
        source: 'system',
      }, { manager }));
    } catch (recordError) {
      this.logger.warn(
        `Audit row not written for a refused key, tenant ${tenantId}: ${recordError instanceof Error ? recordError.message : String(recordError)}`,
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
