import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { UsersService } from '../users/users.service';
import { AiApiKey } from './ai-api-key.entity';
import { AiSettingsService } from './ai-settings.service';
import { McpApiKeyHashService } from './auth/mcp-api-key-hash.service';
import {
  AiMcpScope,
  buildMcpApiKeyPolicyRecord,
} from './control-plane/mcp/ai-mcp-access-policy';
import { AiTenantExecutionService } from './execution/ai-tenant-execution.service';

function redirectHostOf(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    return new URL(uri).hostname || null;
  } catch {
    return null;
  }
}

export type CreateAiApiKeyInput = {
  tenantId: string;
  userId: string;
  label: string;
  expiresAt?: Date | null;
  createdByUserId: string;
  mcpScopes?: AiMcpScope[];
  mcpAllowedCapabilities?: string[];
  mcpDeniedCapabilities?: string[];
  mcpRateLimitPerMinute?: number | null;
};

export type AiApiKeyRecordDto = {
  id: string;
  tenant_id: string;
  user_id: string;
  key_prefix: string;
  label: string;
  expires_at: string | null;
  last_used_at: string | null;
  revoked_at: string | null;
  revoked_by_user_id: string | null;
  revocation_reason: string | null;
  mcp_scopes: string[];
  mcp_allowed_capabilities: string[];
  mcp_denied_capabilities: string[];
  mcp_max_effect: string;
  mcp_rate_limit_per_minute: number;
  created_at: string;
  created_by_user_id: string;
  credential_kind: string;
  oauth_client_id: string | null;
  oauth_client_name: string | null;
  /** The host an OAuth connection returns to (`claude.ai`, `localhost`), shown next to its name. */
  oauth_redirect_host: string | null;
};

export type AiApiKeyAuthentication = {
  apiKey: AiApiKey;
  user: Awaited<ReturnType<UsersService['findById']>>;
};

type RevokeAiApiKeyOptions = {
  manager?: EntityManager;
  userId?: string | null;
  tenantId?: string;
  revocationReason?: string | null;
};

@Injectable()
export class AiApiKeysService {
  constructor(
    @InjectRepository(AiApiKey)
    private readonly repo: Repository<AiApiKey>,
    private readonly users: UsersService,
    private readonly hashService: McpApiKeyHashService,
    private readonly aiSettings: AiSettingsService,
    private readonly audit?: AuditService,
    private readonly tenantExecutor?: AiTenantExecutionService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return (manager ?? this.repo.manager).getRepository(AiApiKey);
  }

  private async findWithHash(
    keyPrefix: string,
    opts?: { manager?: EntityManager; tenantId?: string },
  ): Promise<AiApiKey[]> {
    const repo = this.getRepo(opts?.manager);
    const qb = repo
      .createQueryBuilder('api_key')
      .addSelect('api_key.key_hash')
      .where('api_key.key_prefix = :keyPrefix', { keyPrefix });

    if (opts?.tenantId) {
      qb.andWhere('api_key.tenant_id = :tenantId', { tenantId: opts.tenantId });
    }

    return qb.getMany();
  }

  toView(record: AiApiKey): AiApiKeyRecordDto {
    return {
      id: record.id,
      tenant_id: record.tenant_id,
      user_id: record.user_id,
      key_prefix: record.key_prefix,
      label: record.label,
      expires_at: record.expires_at?.toISOString() ?? null,
      last_used_at: record.last_used_at?.toISOString() ?? null,
      revoked_at: record.revoked_at?.toISOString() ?? null,
      revoked_by_user_id: record.revoked_by_user_id ?? null,
      revocation_reason: record.revocation_reason ?? null,
      mcp_scopes: Array.isArray(record.mcp_scopes_json) ? [...record.mcp_scopes_json] : [],
      mcp_allowed_capabilities: Array.isArray(record.mcp_capability_allowlist_json) ? [...record.mcp_capability_allowlist_json] : [],
      mcp_denied_capabilities: Array.isArray(record.mcp_capability_denylist_json) ? [...record.mcp_capability_denylist_json] : [],
      mcp_max_effect: typeof record.mcp_max_effect === 'string' ? record.mcp_max_effect : '',
      mcp_rate_limit_per_minute: typeof record.mcp_rate_limit_per_minute === 'number' ? record.mcp_rate_limit_per_minute : 0,
      created_at: record.created_at.toISOString(),
      created_by_user_id: record.created_by_user_id,
      credential_kind: record.credential_kind ?? 'api_key',
      oauth_client_id: record.oauth_client_id ?? null,
      oauth_client_name: record.oauth_client_name ?? null,
      oauth_redirect_host: redirectHostOf(record.oauth_redirect_uri),
    };
  }

  async logAudit(
    params: Parameters<AuditService['log']>[0],
    opts?: { manager?: EntityManager; tenantId?: string },
  ) {
    if (!this.audit) {
      return;
    }
    if (opts?.manager) {
      await this.audit.log(params, { manager: opts.manager });
      return;
    }
    if (opts?.tenantId && this.tenantExecutor) {
      await this.tenantExecutor.run(
        opts.tenantId,
        async (manager) => this.audit!.log(params, { manager }),
        { transaction: false },
      );
    }
  }

  async createKey(input: CreateAiApiKeyInput, opts?: { manager?: EntityManager }) {
    const normalizedLabel = input.label.trim();
    if (!normalizedLabel) {
      throw new BadRequestException('A label is required for MCP API keys.');
    }

    // Enforce key max lifetime from tenant settings
    const settings = await this.aiSettings.find(input.tenantId, { manager: opts?.manager });
    let expiresAt = input.expiresAt ?? null;
    if (settings?.mcp_key_max_lifetime_days) {
      const maxExpiry = new Date(Date.now() + settings.mcp_key_max_lifetime_days * 86400000);
      if (!expiresAt || expiresAt.getTime() > maxExpiry.getTime()) {
        expiresAt = maxExpiry;
      }
    }

    const { rawKey, keyHash, keyPrefix } = this.hashService.generate();
    const mcpPolicy = buildMcpApiKeyPolicyRecord({
      scopes: input.mcpScopes,
      allowedCapabilities: input.mcpAllowedCapabilities,
      deniedCapabilities: input.mcpDeniedCapabilities,
      rateLimitPerMinute: input.mcpRateLimitPerMinute ?? undefined,
      maxEffect: 'read',
    });
    const repo = this.getRepo(opts?.manager);
    const record = await repo.save(repo.create({
      tenant_id: input.tenantId,
      user_id: input.userId,
      key_hash: keyHash,
      key_prefix: keyPrefix,
      label: normalizedLabel,
      expires_at: expiresAt,
      ...mcpPolicy,
      created_by_user_id: input.createdByUserId,
    }));
    await this.logAudit(
      {
        table: 'ai_api_keys',
        recordId: record.id,
        action: 'create',
        before: null,
        after: this.toView(record),
        userId: input.createdByUserId,
      },
      { manager: opts?.manager, tenantId: input.tenantId },
    );

    return {
      key: rawKey,
      record: this.toView(record),
    };
  }

  async listForUser(tenantId: string, userId: string, opts?: { manager?: EntityManager }) {
    const items = await this.getRepo(opts?.manager).find({
      where: { tenant_id: tenantId, user_id: userId },
      order: { created_at: 'DESC' },
    });
    return items.map((item) => this.toView(item));
  }

  async listForTenant(tenantId: string, opts?: { manager?: EntityManager }) {
    const items = await this.getRepo(opts?.manager).find({
      where: { tenant_id: tenantId },
      order: { created_at: 'DESC' },
    });
    return items.map((item) => this.toView(item));
  }

  async findById(id: string, opts?: { manager?: EntityManager }) {
    return this.getRepo(opts?.manager).findOne({ where: { id } });
  }

  async revokeKey(id: string, opts?: RevokeAiApiKeyOptions) {
    const repo = this.getRepo(opts?.manager);
    const record = await repo.findOne({ where: { id } });
    if (!record) return null;
    const before = this.toView(record);
    record.revoked_at = new Date();
    record.revoked_by_user_id = opts?.userId ?? record.revoked_by_user_id ?? null;
    record.revocation_reason = opts?.revocationReason ?? record.revocation_reason ?? null;
    const saved = await repo.save(record);
    await this.logAudit(
      {
        table: 'ai_api_keys',
        recordId: saved.id,
        action: 'disable',
        before,
        after: this.toView(saved),
        userId: opts?.userId ?? null,
      },
      { manager: opts?.manager, tenantId: saved.tenant_id },
    );
    return this.toView(saved);
  }

  /**
   * The owner of a key or an OAuth grant may use it: an enabled user whose primary role is a
   * custom role or Administrator. Same rule as the AI policy's permission state (ai-policy.service.ts):
   * the other system roles get no AI access, the AI roles come as additional roles.
   */
  ownerMayAuthenticate(user: AiApiKeyAuthentication['user']): boolean {
    const roleName = (user?.role?.role_name ?? '').toLowerCase();
    return !!user
      && user.status === 'enabled'
      && (!!user.role && (!user.role.is_system || roleName === 'administrator'));
  }

  async authenticatePresentedKey(
    presentedKey: string,
    opts?: { manager?: EntityManager; tenantId?: string },
  ): Promise<AiApiKeyAuthentication> {
    const keyPrefix = this.hashService.extractPrefix(presentedKey);
    if (!keyPrefix) {
      await this.logAudit(
        {
          table: 'ai_api_keys',
          action: 'update',
          before: null,
          after: { authentication: 'failed', reason: 'invalid_key_format' },
          userId: null,
          source: 'system',
        },
        { manager: opts?.manager, tenantId: opts?.tenantId },
      );
      throw new UnauthorizedException('Invalid MCP API key.');
    }

    const repo = this.getRepo(opts?.manager);
    const records = await this.findWithHash(keyPrefix, opts);
    const record = records.find(
      (candidate) => !!candidate.key_hash && this.hashService.matches(presentedKey, candidate.key_hash),
    );
    // An OAuth grant's hash is the one of its refresh token, never usable as an API key.
    if (!record || !record.key_hash || (record.credential_kind ?? 'api_key') !== 'api_key') {
      await this.logAudit(
        {
          table: 'ai_api_keys',
          recordId: null,
          action: 'update',
          before: null,
          after: {
            authentication: 'failed',
            reason: 'invalid_key',
            key_prefix: keyPrefix,
          },
          userId: null,
          source: 'system',
        },
        { manager: opts?.manager, tenantId: opts?.tenantId ?? records[0]?.tenant_id },
      );
      throw new UnauthorizedException('Invalid MCP API key.');
    }
    if (record.revoked_at) {
      await this.logAudit(
        {
          table: 'ai_api_keys',
          recordId: record.id,
          action: 'update',
          before: null,
          after: { authentication: 'failed', reason: 'revoked' },
          userId: record.user_id,
          source: 'system',
        },
        { manager: opts?.manager, tenantId: record.tenant_id },
      );
      throw new UnauthorizedException('MCP API key has been revoked.');
    }
    if (record.expires_at && record.expires_at.getTime() <= Date.now()) {
      await this.logAudit(
        {
          table: 'ai_api_keys',
          recordId: record.id,
          action: 'update',
          before: null,
          after: { authentication: 'failed', reason: 'expired' },
          userId: record.user_id,
          source: 'system',
        },
        { manager: opts?.manager, tenantId: record.tenant_id },
      );
      throw new UnauthorizedException('MCP API key has expired.');
    }

    const user = await this.users.findById(record.user_id, { manager: opts?.manager });
    if (!this.ownerMayAuthenticate(user)) {
      await this.logAudit(
        {
          table: 'ai_api_keys',
          recordId: record.id,
          action: 'update',
          before: null,
          after: { authentication: 'failed', reason: 'owner_not_allowed' },
          userId: record.user_id,
          source: 'system',
        },
        { manager: opts?.manager, tenantId: record.tenant_id },
      );
      throw new UnauthorizedException('The MCP API key owner is not allowed to authenticate.');
    }

    const before = this.toView(record);
    record.last_used_at = new Date();
    await repo.save(record);
    await this.logAudit(
      {
        table: 'ai_api_keys',
        recordId: record.id,
        action: 'update',
        before,
        after: this.toView(record),
        userId: record.user_id,
        source: 'system',
      },
      { manager: opts?.manager, tenantId: record.tenant_id },
    );

    return {
      apiKey: record,
      user,
    };
  }
}
