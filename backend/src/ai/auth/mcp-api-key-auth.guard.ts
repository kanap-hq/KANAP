import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AiApiKeysService } from '../ai-api-keys.service';
import { AiTenantExecutionService } from '../execution/ai-tenant-execution.service';

@Injectable()
export class McpApiKeyAuthGuard implements CanActivate {
  constructor(
    private readonly apiKeys: AiApiKeysService,
    private readonly tenantExecutor: AiTenantExecutionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req: any = context.switchToHttp().getRequest();
    const rawKey = this.extractRawKey(req);
    if (!rawKey) {
      throw new UnauthorizedException('Missing MCP API key');
    }

    // ai_api_keys is under FORCE RLS: the key is looked up inside the tenant named by the host.
    const tenantId = req?.tenant?.id ? String(req.tenant.id) : null;
    if (!tenantId) {
      throw new UnauthorizedException('MCP requests must use the tenant address.');
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
      aiApiKeyId: apiKey.id,
    };
    req.aiApiKey = this.apiKeys.toView(apiKey);

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
