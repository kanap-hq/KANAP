import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AiApiKeysService } from '../ai-api-keys.service';
import { AiTenantExecutionService } from '../execution/ai-tenant-execution.service';
import { McpOAuthService } from '../oauth/mcp-oauth.service';
import { looksLikeJwt } from '../oauth/mcp-oauth-tokens';
import { mcpBearerChallenge, oauthHostOf, requestOrigin } from '../oauth/mcp-oauth.util';

const API_KEY_PREFIX = 'kanap_mcp_';

/**
 * MCP endpoint authentication: a personal API key (`kanap_mcp_…`, `Authorization: Bearer` or
 * `X-API-Key`), or an OAuth access token of the `mcp-access` family (`Authorization: Bearer`).
 * Nothing else opens it, a web session token included.
 *
 * Every 401 carries the `WWW-Authenticate` challenge that points MCP clients to the protected
 * resource metadata (RFC 9728): without a credential, it is what starts the OAuth sign-in.
 */
@Injectable()
export class McpApiKeyAuthGuard implements CanActivate {
  constructor(
    private readonly apiKeys: AiApiKeysService,
    private readonly tenantExecutor: AiTenantExecutionService,
    private readonly oauth: McpOAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const req: any = http.getRequest();
    try {
      return await this.authenticate(req);
    } catch (error) {
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

    // ai_api_keys is under FORCE RLS: the key is looked up inside the tenant named by the host.
    const tenantId = req?.tenant?.id ? String(req.tenant.id) : null;
    if (!tenantId) {
      throw new UnauthorizedException('MCP requests must use the tenant address.');
    }

    if (!rawKey.startsWith(API_KEY_PREFIX) && looksLikeJwt(rawKey)) {
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
