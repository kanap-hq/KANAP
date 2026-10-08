import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { AuditService } from '../../audit/audit.service';
import { AiSecretCipherService } from '../ai-secret-cipher.service';
import { AiProviderRegistry } from '../providers/ai-provider-registry.service';
import { DEFAULT_FREE_MONTHLY_MESSAGE_LIMIT, FREE_MESSAGE_LIMIT_KEY } from './ai-builtin-usage.service';
import { PlatformAiConfig } from './platform-ai-config.entity';
import { PlatformAiPlanLimit } from './platform-ai-plan-limit.entity';

export type PlatformAiConfigView = {
  id: string;
  provider: string;
  model: string;
  endpoint_url: string | null;
  rate_limit_tenant_per_minute: number;
  rate_limit_user_per_hour: number;
  updated_at: string;
  updated_by: string | null;
  has_api_key: boolean;
  disclosure_name: string | null;
  disclosure_location: string | null;
  // Identity workspaces confirm (builtinProviderKey); null until both fields are filled.
  disclosure_key: string | null;
};

/** The included model as workspaces see and confirm it. */
export type BuiltinProviderIdentity = {
  name: string;
  location: string;
  key: string;
};

export type PlatformAiRuntimeConfig = PlatformAiConfigView & {
  apiKey: string;
};

/**
 * The included model from one read of the platform record: the identity workspaces
 * confirm and the runtime that is called always come from the same record.
 */
export type BuiltinRuntimeSnapshot = {
  // Null while the provider name or the processing location is empty.
  identity: BuiltinProviderIdentity | null;
  provider: string;
  model: string;
  endpointUrl: string | null;
  // Decrypted only when asked for (withSecrets).
  apiKey: string | null;
  hasApiKey: boolean;
  rateLimits: { tenantPerMinute: number; userPerHour: number };
};

export type UpdatePlatformAiConfigInput = {
  provider?: string | null;
  model?: string | null;
  api_key?: string | null;
  endpoint_url?: string | null;
  rate_limit_tenant_per_minute?: number | null;
  rate_limit_user_per_hour?: number | null;
  disclosure_name?: string | null;
  disclosure_location?: string | null;
};

export const DISCLOSURE_NAME_MAX_LENGTH = 80;
/** ISO 3166-1 alpha-2 region code in upper case, or EU. */
const DISCLOSURE_LOCATION_PATTERN = /^[A-Z]{2}$/;

export type BuiltinProviderKeyParts = {
  provider: string;
  endpointHost: string;
  name: string;
  location: string;
};

/**
 * The identity a workspace confirms before its data reaches the included model: the
 * technical provider (platform_ai_config.provider and the endpoint host, so a switch
 * of provider or endpoint asks again even when the shown name stays the same), and the
 * provider name and processing location shown to customers. A model change at the same
 * provider and endpoint keeps the key; any other change asks every workspace again.
 */
export function builtinProviderKey({ provider, endpointHost, name, location }: BuiltinProviderKeyParts): string {
  return `${provider}|${endpointHost}|${name.trim()}|${location}`;
}

/** The endpoint's host in lower case; empty without an endpoint (the provider's default API). */
export function endpointHostOf(endpointUrl: string | null | undefined): string {
  const raw = endpointUrl?.trim() ?? '';
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function disclosureIdentity(
  record: Pick<PlatformAiConfig, 'provider' | 'endpoint_url' | 'disclosure_name' | 'disclosure_location'> | null,
): BuiltinProviderIdentity | null {
  const name = record?.disclosure_name?.trim() ?? '';
  const location = record?.disclosure_location ?? '';
  if (!record || !name || !DISCLOSURE_LOCATION_PATTERN.test(location)) {
    return null;
  }
  const key = builtinProviderKey({
    provider: record.provider,
    endpointHost: endpointHostOf(record.endpoint_url),
    name,
    location,
  });
  return { name, location, key };
}

function normalizeDisclosureName(value: string | null | undefined, existing: string | null): string | null {
  if (value == null) return existing;
  const name = String(value).trim();
  if (name.length < 1 || name.length > DISCLOSURE_NAME_MAX_LENGTH) {
    throw new BadRequestException(`disclosure_name must be 1 to ${DISCLOSURE_NAME_MAX_LENGTH} characters.`);
  }
  return name;
}

function normalizeDisclosureLocation(value: string | null | undefined, existing: string | null): string | null {
  if (value == null) return existing;
  const location = String(value).trim();
  if (!DISCLOSURE_LOCATION_PATTERN.test(location)) {
    throw new BadRequestException('disclosure_location must be a two-letter region code in upper case, such as US or EU.');
  }
  return location;
}


const CACHE_TTL_MS = 60_000;

// The built-in (free-volume) provider runs reasoning models with capped thinking so
// latency and cost stay bounded for the shared free tier. Hardwired by design: it is
// applied wherever the built-in runtime is used and NEVER for tenant-provided
// configurations (see AiStreamParams.reasoningEffort).
export const BUILTIN_REASONING_EFFORT = 'low' as const;

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

@Injectable()
export class PlatformAiConfigService {
  private cache: { expiresAt: number; record: PlatformAiConfig | null } | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly providerRegistry: AiProviderRegistry,
    private readonly cipher: AiSecretCipherService,
    private readonly audit: AuditService,
  ) {}

  private get configRepo() {
    return this.dataSource.getRepository(PlatformAiConfig);
  }

  private get planLimitRepo() {
    return this.dataSource.getRepository(PlatformAiPlanLimit);
  }

  private getConfigRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(PlatformAiConfig) : this.configRepo;
  }

  private getPlanLimitRepo(manager?: EntityManager) {
    return manager ? manager.getRepository(PlatformAiPlanLimit) : this.planLimitRepo;
  }

  private async loadRecord(force = false, manager?: EntityManager): Promise<PlatformAiConfig | null> {
    const now = Date.now();
    if (!force && this.cache && this.cache.expiresAt > now) {
      return this.cache.record;
    }

    const record = await this.getConfigRepo(manager)
      .createQueryBuilder('config')
      .addSelect('config.api_key_encrypted')
      .where('config.singleton = true')
      .getOne();

    this.cache = {
      expiresAt: now + CACHE_TTL_MS,
      record,
    };
    return record;
  }

  private clearCache() {
    this.cache = null;
  }

  private toView(record: PlatformAiConfig): PlatformAiConfigView {
    return {
      id: record.id,
      provider: record.provider,
      model: record.model,
      endpoint_url: record.endpoint_url,
      rate_limit_tenant_per_minute: record.rate_limit_tenant_per_minute,
      rate_limit_user_per_hour: record.rate_limit_user_per_hour,
      updated_at: record.updated_at.toISOString(),
      updated_by: record.updated_by,
      has_api_key: !!record.api_key_encrypted,
      disclosure_name: record.disclosure_name ?? null,
      disclosure_location: record.disclosure_location ?? null,
      disclosure_key: disclosureIdentity(record)?.key ?? null,
    };
  }

  private validateRecord(record: Pick<PlatformAiConfig, 'provider' | 'model' | 'endpoint_url' | 'api_key_encrypted'>): string[] {
    return this.providerRegistry.validate({
      llm_provider: record.provider,
      llm_model: record.model,
      llm_endpoint_url: record.endpoint_url,
      has_llm_api_key: !!record.api_key_encrypted,
    });
  }

  /**
   * The included model's identity and runtime from a single read of the platform record,
   * so the identity checked against a workspace's confirmation is the one of the runtime
   * returned. Null when the record is missing or its provider settings are not valid. The
   * API key is decrypted only with withSecrets.
   */
  async getBuiltinRuntime(opts?: { withSecrets?: boolean }): Promise<BuiltinRuntimeSnapshot | null> {
    const record = await this.loadRecord();
    if (!record || this.validateRecord(record).length > 0) {
      return null;
    }
    return {
      identity: disclosureIdentity(record),
      provider: record.provider,
      model: record.model,
      endpointUrl: record.endpoint_url,
      apiKey: opts?.withSecrets && record.api_key_encrypted ? this.cipher.decrypt(record.api_key_encrypted) : null,
      hasApiKey: !!record.api_key_encrypted,
      rateLimits: {
        tenantPerMinute: record.rate_limit_tenant_per_minute,
        userPerHour: record.rate_limit_user_per_hour,
      },
    };
  }

  async getConfig(): Promise<PlatformAiConfigView> {
    const record = await this.loadRecord();
    if (!record) {
      throw new NotFoundException('Built-in AI provider is not configured.');
    }
    return this.toView(record);
  }

  async getRuntimeConfig(): Promise<PlatformAiRuntimeConfig> {
    const record = await this.loadRecord();
    if (!record) {
      throw new NotFoundException('Built-in AI provider is not configured.');
    }
    const validationErrors = this.validateRecord(record);
    if (validationErrors.length > 0) {
      throw new BadRequestException({
        code: 'BUILTIN_PROVIDER_NOT_READY',
        message: 'Built-in AI provider is not fully configured.',
        errors: validationErrors,
      });
    }
    return {
      ...this.toView(record),
      apiKey: this.cipher.decrypt(record.api_key_encrypted),
    };
  }

  async getFreeMessageLimit(opts?: { manager?: EntityManager }): Promise<number> {
    const row = await this.getPlanLimitRepo(opts?.manager).findOne({
      where: { plan_name: FREE_MESSAGE_LIMIT_KEY },
    });
    return row?.monthly_message_limit ?? DEFAULT_FREE_MONTHLY_MESSAGE_LIMIT;
  }

  async updateConfig(
    input: UpdatePlatformAiConfigInput,
    userId?: string | null,
    opts?: { manager?: EntityManager },
  ): Promise<PlatformAiConfigView> {
    const manager = opts?.manager;
    const existing = await this.loadRecord(true, manager);
    const provider = normalizeNullableString(input.provider) ?? existing?.provider ?? null;
    const model = normalizeNullableString(input.model) ?? existing?.model ?? null;
    const endpointUrl = normalizeNullableString(input.endpoint_url) ?? existing?.endpoint_url ?? null;
    const apiKey = normalizeNullableString(input.api_key);
    const apiKeyEncrypted = apiKey
      ? this.cipher.encrypt(apiKey)
      : existing?.api_key_encrypted ?? null;
    const tenantLimit = input.rate_limit_tenant_per_minute ?? existing?.rate_limit_tenant_per_minute ?? 30;
    const userLimit = input.rate_limit_user_per_hour ?? existing?.rate_limit_user_per_hour ?? 60;
    const disclosureName = normalizeDisclosureName(input.disclosure_name, existing?.disclosure_name ?? null);
    const disclosureLocation = normalizeDisclosureLocation(input.disclosure_location, existing?.disclosure_location ?? null);
    // A new provider or endpoint host changes what workspaces confirmed: the name and
    // location shown to them are entered again, or confirmed, in the same save.
    const technicalProviderChanged = !!existing && (
      provider !== existing.provider || endpointHostOf(endpointUrl) !== endpointHostOf(existing.endpoint_url)
    );
    if (technicalProviderChanged && (input.disclosure_name == null || input.disclosure_location == null)) {
      throw new BadRequestException(
        'The provider or its endpoint changed: enter or confirm the provider name and the processing location shown to customers in the same save.',
      );
    }

    if (!provider) throw new BadRequestException('provider is required.');
    if (!model) throw new BadRequestException('model is required.');
    if (!apiKeyEncrypted) throw new BadRequestException('api_key is required.');

    const validationErrors = this.providerRegistry.validate({
      llm_provider: provider,
      llm_model: model,
      llm_endpoint_url: endpointUrl,
      has_llm_api_key: true,
    });
    if (validationErrors.length > 0) {
      throw new BadRequestException({
        message: 'Built-in AI provider is not fully configured.',
        errors: validationErrors,
      });
    }

    const executor = manager ?? this.dataSource;
    const result = await executor.query(
      `
        INSERT INTO platform_ai_config (
          singleton,
          provider,
          model,
          api_key_encrypted,
          endpoint_url,
          rate_limit_tenant_per_minute,
          rate_limit_user_per_hour,
          updated_at,
          updated_by,
          disclosure_name,
          disclosure_location
        )
        VALUES (true, $1, $2, $3, $4, $5, $6, now(), $7, $8, $9)
        ON CONFLICT (singleton)
        DO UPDATE SET
          provider = EXCLUDED.provider,
          model = EXCLUDED.model,
          api_key_encrypted = EXCLUDED.api_key_encrypted,
          endpoint_url = EXCLUDED.endpoint_url,
          rate_limit_tenant_per_minute = EXCLUDED.rate_limit_tenant_per_minute,
          rate_limit_user_per_hour = EXCLUDED.rate_limit_user_per_hour,
          updated_at = now(),
          updated_by = EXCLUDED.updated_by,
          disclosure_name = EXCLUDED.disclosure_name,
          disclosure_location = EXCLUDED.disclosure_location
        RETURNING id
      `,
      [provider, model, apiKeyEncrypted, endpointUrl, tenantLimit, userLimit, userId ?? null, disclosureName, disclosureLocation],
    );

    this.clearCache();
    const saved = await this.loadRecord(true, manager);
    if (!saved) {
      throw new NotFoundException('Built-in AI provider was not saved.');
    }

    await this.audit.log(
      {
        table: 'platform_ai_config',
        recordId: result?.[0]?.id ?? saved.id,
        action: existing ? 'update' : 'create',
        before: existing ? this.toView(existing) : null,
        after: this.toView(saved),
        userId: userId ?? null,
      },
      { manager },
    );

    return this.toView(saved);
  }

  async updateFreeMessageLimit(
    monthlyMessageLimit: number,
    userId?: string | null,
    opts?: { manager?: EntityManager },
  ): Promise<number> {
    const manager = opts?.manager;
    const before = await this.getFreeMessageLimit({ manager });
    const executor = manager ?? this.dataSource;
    await executor.query(
      `
        INSERT INTO platform_ai_plan_limits (plan_name, monthly_message_limit, updated_at)
        VALUES ($1, $2, now())
        ON CONFLICT (plan_name)
        DO UPDATE SET
          monthly_message_limit = EXCLUDED.monthly_message_limit,
          updated_at = now()
      `,
      [FREE_MESSAGE_LIMIT_KEY, monthlyMessageLimit],
    );

    const after = await this.getFreeMessageLimit({ manager });
    await this.audit.log(
      {
        table: 'platform_ai_plan_limits',
        action: 'update',
        before: { monthly_message_limit: before },
        after: { monthly_message_limit: after },
        userId: userId ?? null,
      },
      { manager },
    );
    return after;
  }
}
