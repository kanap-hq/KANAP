import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { Features } from '../config/features';
import { assertPublicHttpUrl } from '../common/ssrf-guard';
import { AiModelConfig } from './ai-model-config.entity';
import { AiModelReadiness, AiModelResolverService } from './ai-model-resolver.service';
import { AiSettings } from './ai-settings.entity';
import { AiSecretCipherService } from './ai-secret-cipher.service';
import { normalizeGlpiPathname } from './glpi/glpi-url';
import { BuiltinProviderIdentity, PlatformAiConfigService } from './platform/platform-ai-config.service';
import { AiProviderRegistry } from './providers/ai-provider-registry.service';

export type AiSettingsView = {
  id: string;
  tenant_id: string;
  chat_enabled: boolean;
  mcp_enabled: boolean;
  provider_source: 'builtin' | 'custom';
  chat_model_config_id: string | null;
  llm_provider: string | null;
  llm_endpoint_url: string | null;
  llm_model: string | null;
  mcp_key_max_lifetime_days: number | null;
  conversation_retention_days: number | null;
  web_search_enabled: boolean;
  llm_supports_vision: boolean;
  glpi_enabled: boolean;
  glpi_url: string | null;
  has_glpi_user_token: boolean;
  has_glpi_app_token: boolean;
  has_llm_api_key: boolean;
  provider_secret_writable: boolean;
  provider_validation_errors: string[];
  chat_ready: boolean;
  builtin_provider: AiBuiltinProviderView;
  created_at: string;
  updated_at: string;
};

/**
 * The KANAP included model as this workspace sees it. in_use: the assistant, or agents
 * without a model of their own, would run on it; used_by_assistant: the assistant would.
 * accepted: an administrator confirmed the platform's current identity (key).
 */
export type AiBuiltinProviderView = {
  in_use: boolean;
  used_by_assistant: boolean;
  name: string | null;
  location: string | null;
  key: string | null;
  accepted: boolean;
  accepted_at: string | null;
  accepted_by_name: string | null;
};

export const BUILTIN_PROVIDER_CHANGED = 'BUILTIN_PROVIDER_CHANGED';
export const BUILTIN_PROVIDER_CONFIRMATION_REQUIRED = 'BUILTIN_PROVIDER_CONFIRMATION_REQUIRED';

function identityBody(identity: BuiltinProviderIdentity | null) {
  return identity ? { name: identity.name, location: identity.location, key: identity.key } : null;
}

export type UpdateAiSettingsInput = {
  chat_enabled?: boolean;
  mcp_enabled?: boolean;
  provider_source?: 'builtin' | 'custom';
  chat_model_config_id?: string | null;
  llm_provider?: string | null;
  llm_api_key?: string | null;
  llm_endpoint_url?: string | null;
  llm_model?: string | null;
  mcp_key_max_lifetime_days?: number | null;
  conversation_retention_days?: number | null;
  web_search_enabled?: boolean;
  llm_supports_vision?: boolean;
  glpi_enabled?: boolean;
  glpi_url?: string | null;
  glpi_user_token?: string | null;
  glpi_app_token?: string | null;
  accept_builtin_provider_key?: string | null;
};

function normalizeNullableString(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = String(value).trim();
  return normalized === '' ? null : normalized;
}

function normalizeHttpUrl(value: string | null | undefined, fieldName: string): string | null {
  const normalized = normalizeNullableString(value);
  if (!normalized) {
    return null;
  }

  let parsed: URL;
  try {
    parsed = new URL(normalized);
  } catch {
    throw new BadRequestException(`${fieldName} must be a valid HTTP(S) URL.`);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new BadRequestException(`${fieldName} must use http:// or https://.`);
  }
  if (parsed.username || parsed.password) {
    throw new BadRequestException(`${fieldName} must not include embedded credentials.`);
  }

  parsed.search = '';
  parsed.hash = '';
  parsed.pathname = fieldName === 'glpi_url'
    ? normalizeGlpiPathname(parsed.pathname)
    : ((parsed.pathname || '/').replace(/\/+$/, '') || '/');
  return parsed.toString();
}

@Injectable()
export class AiSettingsService {
  constructor(
    @InjectRepository(AiSettings)
    private readonly repo: Repository<AiSettings>,
    private readonly providerRegistry: AiProviderRegistry,
    private readonly cipher: AiSecretCipherService,
    private readonly platformAiConfig: PlatformAiConfigService,
    private readonly modelResolver: AiModelResolverService,
    private readonly audit?: AuditService,
  ) {}

  private getRepo(manager?: EntityManager) {
    return (manager ?? this.repo.manager).getRepository(AiSettings);
  }

  private async findWithSecrets(
    tenantId: string,
    manager?: EntityManager,
  ): Promise<AiSettings | null> {
    const repo = this.getRepo(manager);
    return repo
      .createQueryBuilder('settings')
      .addSelect('settings.llm_api_key_encrypted')
      .addSelect('settings.glpi_user_token_encrypted')
      .addSelect('settings.glpi_app_token_encrypted')
      .where('settings.tenant_id = :tenantId', { tenantId })
      .getOne();
  }

  private normalizeProviderSourceValue(value: 'builtin' | 'custom' | undefined): 'builtin' | 'custom' {
    if (Features.SINGLE_TENANT) {
      return 'custom';
    }
    return value === 'custom' ? 'custom' : 'builtin';
  }

  private async normalizeProviderSource(settings: AiSettings, manager?: EntityManager): Promise<AiSettings> {
    const nextValue = this.normalizeProviderSourceValue(settings.provider_source);
    if (settings.provider_source === nextValue) {
      return settings;
    }
    settings.provider_source = nextValue;
    settings.updated_at = new Date();
    await this.getRepo(manager).save(settings);
    return settings;
  }

  async find(tenantId: string, opts?: { manager?: EntityManager }): Promise<AiSettings | null> {
    const settings = await this.findWithSecrets(tenantId, opts?.manager);
    if (!settings) {
      return null;
    }
    return this.normalizeProviderSource(settings, opts?.manager);
  }

  async get(tenantId: string, opts?: { manager?: EntityManager }): Promise<AiSettings> {
    const repo = this.getRepo(opts?.manager);
    let settings = await this.find(tenantId, opts);

    if (!settings) {
      settings = await repo.save(repo.create({
        tenant_id: tenantId,
        chat_enabled: false,
        mcp_enabled: false,
        provider_source: Features.SINGLE_TENANT ? 'custom' : 'builtin',
        web_search_enabled: false,
        llm_supports_vision: true,
        glpi_enabled: false,
        glpi_url: null,
      }));
      settings.llm_api_key_encrypted = null;
      settings.glpi_user_token_encrypted = null;
      settings.glpi_app_token_encrypted = null;
    }

    return settings;
  }

  getEffectiveProviderSource(settings: Pick<AiSettings, 'provider_source'>): 'builtin' | 'custom' {
    if (Features.SINGLE_TENANT) {
      return 'custom';
    }
    return settings.provider_source === 'custom' ? 'custom' : 'builtin';
  }

  toProviderSnapshot(settings: Pick<AiSettings, 'llm_provider' | 'llm_model' | 'llm_endpoint_url' | 'llm_api_key_encrypted'>) {
    return {
      llm_provider: settings.llm_provider,
      llm_model: settings.llm_model,
      llm_endpoint_url: settings.llm_endpoint_url,
      has_llm_api_key: !!settings.llm_api_key_encrypted,
    };
  }

  async getProviderValidationErrors(settings: AiSettings, manager?: EntityManager): Promise<string[]> {
    return (await this.getProviderReadiness(settings, manager)).errors;
  }

  /** The assistant's model readiness, checked against this settings row's confirmation of the included model. */
  async getProviderReadiness(settings: AiSettings, manager?: EntityManager): Promise<AiModelReadiness> {
    return this.modelResolver.readiness(
      settings.tenant_id,
      settings.chat_model_config_id ?? null,
      manager,
      { builtinAcceptedKey: settings.builtin_accepted_key ?? null },
    );
  }

  /**
   * The assistant's model readiness without the included model's confirmation, for paths
   * that send nothing to that model (MCP, tools run by agents): valid platform settings are
   * enough there, as before the confirmation existed.
   */
  async getProviderErrorsWithoutConfirmation(settings: AiSettings, manager?: EntityManager): Promise<string[]> {
    return this.modelResolver.validationErrors(
      settings.tenant_id,
      settings.chat_model_config_id ?? null,
      manager,
      { includedModelGate: 'none' },
    );
  }

  /**
   * Readiness of the workspace's fallback model (no explicit assignment): the one agents
   * without a model of their own run on. Reuses the assistant's readiness when the
   * assistant has no assignment either.
   */
  private async getFallbackReadiness(
    tenantId: string,
    settings: Pick<AiSettings, 'chat_model_config_id' | 'builtin_accepted_key'> | null,
    manager?: EntityManager,
    assistantReadiness?: AiModelReadiness | null,
  ): Promise<AiModelReadiness> {
    if (assistantReadiness && settings && settings.chat_model_config_id == null) {
      return assistantReadiness;
    }
    return this.modelResolver.readiness(tenantId, null, manager, {
      builtinAcceptedKey: settings?.builtin_accepted_key ?? null,
    });
  }

  /**
   * True when an enabled agent of the workspace runs on the fallback model (no model of
   * its own, or one no longer active) and that fallback is the included model, not
   * confirmed: those agents are paused.
   */
  async isBuiltinConfirmationNeeded(
    tenantId: string,
    settings: Pick<AiSettings, 'chat_model_config_id' | 'builtin_accepted_key'> | null,
    manager?: EntityManager,
    assistantReadiness?: AiModelReadiness | null,
  ): Promise<boolean> {
    const fallback = await this.getFallbackReadiness(tenantId, settings, manager, assistantReadiness);
    if (fallback.errorCode !== 'builtin_not_accepted') {
      return false;
    }
    const rows: unknown[] = await (manager ?? this.repo.manager).query(
      `SELECT 1
         FROM ai_agent_definitions d
        WHERE d.tenant_id = $1
          AND d.status = 'enabled'
          AND (
            d.llm_model_config_id IS NULL
            OR NOT EXISTS (
              SELECT 1 FROM ai_model_configs c
               WHERE c.id = d.llm_model_config_id AND c.tenant_id = $1 AND c.status = 'active'
            )
          )
        LIMIT 1`,
      [tenantId],
    );
    return rows.length > 0;
  }

  private async currentBuiltinIdentity(): Promise<BuiltinProviderIdentity | null> {
    if (Features.SINGLE_TENANT) {
      return null;
    }
    return (await this.platformAiConfig.getBuiltinRuntime())?.identity ?? null;
  }

  private async userDisplayName(tenantId: string, userId: string, manager?: EntityManager): Promise<string | null> {
    const rows: Array<{ first_name: string | null; last_name: string | null }> = await (manager ?? this.repo.manager).query(
      'SELECT first_name, last_name FROM users WHERE id = $1 AND tenant_id = $2',
      [userId, tenantId],
    );
    const name = [rows[0]?.first_name, rows[0]?.last_name]
      .map((part) => String(part ?? '').trim())
      .filter(Boolean)
      .join(' ');
    return name || null;
  }

  async update(
    tenantId: string,
    input: UpdateAiSettingsInput,
    opts?: { manager?: EntityManager; userId?: string | null; sourceRef?: string | null },
  ): Promise<AiSettings> {
    const repo = this.getRepo(opts?.manager);
    const existing = await this.find(tenantId, opts);
    const settings = existing ?? await this.get(tenantId, opts);
    const beforeView = existing ? await this.toView(settings, opts) : null;

    if (Object.prototype.hasOwnProperty.call(input, 'chat_enabled')) {
      settings.chat_enabled = input.chat_enabled === true;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'mcp_enabled')) {
      settings.mcp_enabled = input.mcp_enabled === true;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'provider_source')) {
      settings.provider_source = this.normalizeProviderSourceValue(input.provider_source);
    }
    if (Object.prototype.hasOwnProperty.call(input, 'chat_model_config_id')) {
      const configId = normalizeNullableString(input.chat_model_config_id);
      if (configId) {
        const config = await (opts?.manager ?? this.repo.manager)
          .getRepository(AiModelConfig)
          .findOne({ where: { id: configId, tenant_id: tenantId } });
        if (!config) {
          throw new BadRequestException('AI model configuration not found.');
        }
        if (config.status !== 'active') {
          throw new BadRequestException('An archived AI model cannot be assigned.');
        }
      }
      settings.chat_model_config_id = configId;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'llm_provider')) {
      const provider = normalizeNullableString(input.llm_provider);
      if (provider && !this.providerRegistry.get(provider)) {
        throw new BadRequestException('Unsupported AI provider.');
      }
      settings.llm_provider = provider;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'llm_api_key')) {
      const raw = normalizeNullableString(input.llm_api_key);
      settings.llm_api_key_encrypted = raw ? this.cipher.encrypt(raw) : null;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'llm_endpoint_url')) {
      const normalized = normalizeHttpUrl(input.llm_endpoint_url, 'llm_endpoint_url');
      if (normalized) assertPublicHttpUrl(normalized);
      settings.llm_endpoint_url = normalized;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'llm_model')) {
      const model = normalizeNullableString(input.llm_model);
      if (model && model.length > 100) {
        throw new BadRequestException('llm_model must not exceed 100 characters.');
      }
      settings.llm_model = model;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'mcp_key_max_lifetime_days')) {
      const value = input.mcp_key_max_lifetime_days;
      if (value != null && (!Number.isInteger(value) || value <= 0)) {
        throw new BadRequestException('mcp_key_max_lifetime_days must be a positive integer.');
      }
      settings.mcp_key_max_lifetime_days = value ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'conversation_retention_days')) {
      const value = input.conversation_retention_days;
      if (value != null && (!Number.isInteger(value) || value <= 0)) {
        throw new BadRequestException('conversation_retention_days must be a positive integer.');
      }
      settings.conversation_retention_days = value ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'web_search_enabled')) {
      const wantEnabled = input.web_search_enabled === true;
      if (wantEnabled && !Features.AI_WEB_SEARCH_READY) {
        throw new BadRequestException('Web search cannot be enabled: BRAVE_SEARCH_API_KEY is not configured.');
      }
      settings.web_search_enabled = wantEnabled;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'llm_supports_vision')) {
      settings.llm_supports_vision = input.llm_supports_vision === true;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'glpi_enabled')) {
      settings.glpi_enabled = input.glpi_enabled === true;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'glpi_url')) {
      {
        const normalizedGlpi = normalizeHttpUrl(input.glpi_url, 'glpi_url');
        if (normalizedGlpi) assertPublicHttpUrl(normalizedGlpi);
        settings.glpi_url = normalizedGlpi;
      }
    }
    if (Object.prototype.hasOwnProperty.call(input, 'glpi_user_token')) {
      const raw = normalizeNullableString(input.glpi_user_token);
      settings.glpi_user_token_encrypted = raw ? this.cipher.encrypt(raw) : null;
    }
    if (Object.prototype.hasOwnProperty.call(input, 'glpi_app_token')) {
      const raw = normalizeNullableString(input.glpi_app_token);
      settings.glpi_app_token_encrypted = raw ? this.cipher.encrypt(raw) : null;
    }

    if (Object.prototype.hasOwnProperty.call(input, 'accept_builtin_provider_key')) {
      const requestedKey = input.accept_builtin_provider_key;
      if (requestedKey == null) {
        settings.builtin_accepted_key = null;
        settings.builtin_accepted_at = null;
        settings.builtin_accepted_by = null;
      } else {
        const identity = await this.currentBuiltinIdentity();
        if (!identity || requestedKey !== identity.key) {
          throw new BadRequestException({
            code: BUILTIN_PROVIDER_CHANGED,
            message: 'The KANAP included model has changed. Review it and confirm again.',
            builtin_provider: identityBody(identity),
          });
        }
        settings.builtin_accepted_key = identity.key;
        settings.builtin_accepted_at = new Date();
        settings.builtin_accepted_by = opts?.userId || null;
      }
    }

    const glpiConfigTouched = [
      'glpi_enabled',
      'glpi_url',
      'glpi_user_token',
      'glpi_app_token',
    ].some((field) => Object.prototype.hasOwnProperty.call(input, field));
    if (glpiConfigTouched && settings.glpi_enabled) {
      if (!settings.glpi_url) {
        throw new BadRequestException('GLPI integration requires glpi_url.');
      }
      if (!settings.glpi_user_token_encrypted) {
        throw new BadRequestException('GLPI integration requires glpi_user_token.');
      }
    }

    if (settings.chat_enabled) {
      const readiness = await this.getProviderReadiness(settings, opts?.manager);
      if (readiness.errorCode === 'builtin_not_accepted') {
        // Turning the assistant on needs the included model confirmed, in this
        // payload or before. Other changes save; the assistant waits for it.
        if (input.chat_enabled === true) {
          throw new BadRequestException({
            code: BUILTIN_PROVIDER_CONFIRMATION_REQUIRED,
            message: 'Confirm the KANAP included model before turning on the assistant.',
            builtin_provider: identityBody(readiness.builtinIdentity),
          });
        }
      } else if (readiness.errors.length > 0) {
        throw new BadRequestException({
          message: 'AI chat cannot be enabled until the provider is fully configured.',
          errors: readiness.errors,
        });
      }
    }

    settings.updated_at = new Date();
    const saved = await repo.save(settings);
    saved.llm_api_key_encrypted = settings.llm_api_key_encrypted;
    saved.glpi_user_token_encrypted = settings.glpi_user_token_encrypted;
    saved.glpi_app_token_encrypted = settings.glpi_app_token_encrypted;
    if (this.audit) {
      await this.audit.log(
        {
          table: 'ai_settings',
          recordId: saved.id,
          action: beforeView ? 'update' : 'create',
          before: beforeView,
          after: await this.toView(saved, opts),
          userId: opts?.userId ?? null,
          sourceRef: opts?.sourceRef ?? null,
        },
        { manager: opts?.manager },
      );
    }
    return saved;
  }

  async toView(settings: AiSettings, opts?: { manager?: EntityManager }): Promise<AiSettingsView> {
    const normalized = await this.normalizeProviderSource(settings, opts?.manager);
    const readiness = await this.getProviderReadiness(normalized, opts?.manager);
    const providerErrors = readiness.errors;

    return {
      id: normalized.id,
      tenant_id: normalized.tenant_id,
      chat_enabled: normalized.chat_enabled,
      mcp_enabled: normalized.mcp_enabled,
      provider_source: this.getEffectiveProviderSource(normalized),
      chat_model_config_id: normalized.chat_model_config_id ?? null,
      llm_provider: normalized.llm_provider,
      llm_endpoint_url: normalized.llm_endpoint_url,
      llm_model: normalized.llm_model,
      mcp_key_max_lifetime_days: normalized.mcp_key_max_lifetime_days,
      conversation_retention_days: normalized.conversation_retention_days,
      web_search_enabled: normalized.web_search_enabled,
      llm_supports_vision: normalized.llm_supports_vision !== false,
      glpi_enabled: normalized.glpi_enabled,
      glpi_url: normalized.glpi_url,
      has_glpi_user_token: !!normalized.glpi_user_token_encrypted,
      has_glpi_app_token: !!normalized.glpi_app_token_encrypted,
      has_llm_api_key: !!normalized.llm_api_key_encrypted,
      provider_secret_writable: this.cipher.canEncrypt(),
      provider_validation_errors: providerErrors,
      chat_ready: providerErrors.length === 0,
      builtin_provider: await this.toBuiltinProviderView(normalized, readiness, opts?.manager),
      created_at: normalized.created_at.toISOString(),
      updated_at: normalized.updated_at.toISOString(),
    };
  }

  private async toBuiltinProviderView(
    settings: AiSettings,
    readiness: AiModelReadiness,
    manager?: EntityManager,
  ): Promise<AiBuiltinProviderView> {
    const identity = readiness.builtinIdentity;
    const usedByAssistant = !!identity && readiness.usesBuiltin;
    // Agents without a model of their own fall back on it even when the assistant has its own.
    const usedAsFallback = !!identity && !usedByAssistant
      && (await this.getFallbackReadiness(settings.tenant_id, settings, manager, readiness)).usesBuiltin;
    const accepted = !!identity && settings.builtin_accepted_key === identity.key;
    const acceptedBy = accepted ? settings.builtin_accepted_by ?? null : null;
    return {
      in_use: usedByAssistant || usedAsFallback,
      used_by_assistant: usedByAssistant,
      name: identity?.name ?? null,
      location: identity?.location ?? null,
      key: identity?.key ?? null,
      accepted,
      accepted_at: accepted && settings.builtin_accepted_at ? new Date(settings.builtin_accepted_at).toISOString() : null,
      // Null when the user who confirmed it no longer exists: shown as "Confirmed on <date>".
      accepted_by_name: acceptedBy ? await this.userDisplayName(settings.tenant_id, acceptedBy, manager) : null,
    };
  }
}
