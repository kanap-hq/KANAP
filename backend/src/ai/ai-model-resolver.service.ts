import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { Features } from '../config/features';
import { AiModelConfig } from './ai-model-config.entity';
import { AiSecretCipherService } from './ai-secret-cipher.service';
import { AiSettings } from './ai-settings.entity';
import { AiAgentDefinition } from './control-plane/entities/ai-agent-definition.entity';
import { BuiltinProviderIdentity, PlatformAiConfigService } from './platform/platform-ai-config.service';
import { AiProviderRegistry } from './providers/ai-provider-registry.service';

export type AiModelConsumer = { type: 'chat' } | { type: 'agent'; agentId: string };

export type ResolvedModel = {
  source: 'registry' | 'builtin';
  configId: string | null;
  configName: string | null;
  provider: string;
  model: string;
  endpointUrl: string | null;
  // Decrypted only when resolving withSecrets (the default); config-inspection
  // paths (validation, pricing) resolve without secrets and get null here.
  apiKey: string | null;
  hasApiKey: boolean;
  supportsVision: boolean;
  priceInputEurPerMtok: number | null;
  priceOutputEurPerMtok: number | null;
  // Per-model LLM timeout; null falls back to the caller's per-stage env default.
  timeoutMs: number | null;
  // The included model's rate limits, from the same platform record as the runtime above;
  // null for a registry model.
  builtinRateLimits: { tenantPerMinute: number; userPerHour: number } | null;
};

export type ResolveModelOptions = {
  // False skips API-key decryption: readiness/validation and price lookups must
  // never throw on a corrupt or legacy key payload — only an actual LLM call
  // (withSecrets: true) should surface that.
  withSecrets?: boolean;
  // The workspace's confirmation of the included model to check, for a settings
  // payload not saved yet. Undefined reads it from ai_settings.
  builtinAcceptedKey?: string | null;
  // 'confirmed' (default): the included model only once the workspace confirmed its
  // current identity. 'none': for paths that send nothing to the included model (MCP
  // access and its message count): valid platform settings are enough, as before the
  // confirmation existed, and the result never carries the API key.
  includedModelGate?: 'confirmed' | 'none';
};

export type AiModelResolutionErrorCode = 'no_model_available' | 'builtin_not_configured' | 'builtin_not_accepted';

export const BUILTIN_NOT_ACCEPTED_MESSAGE = 'The KANAP included model needs an administrator\'s confirmation in Admin > Plaid.';

/** What a consumer would run on, without resolving secrets. */
export type AiModelReadiness = {
  // Empty when the consumer can call its model (chat_ready).
  errors: string[];
  errorCode: AiModelResolutionErrorCode | null;
  // The consumer lands on the included model, confirmed or not.
  usesBuiltin: boolean;
  // The included model's identity when workspaces can use it (multi-tenant only).
  builtinIdentity: BuiltinProviderIdentity | null;
};

export class AiModelResolutionError extends Error {
  constructor(
    readonly code: AiModelResolutionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AiModelResolutionError';
  }
}

function parsePriceEurPerMtok(value: string | null): number | null {
  if (value == null) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Single resolution point for "which LLM does this consumer use?".
 *
 * Chain: explicit assignment (ai_settings.chat_model_config_id or
 * ai_agent_definitions.llm_model_config_id) → tenant default registry entry →
 * platform builtin (multi-tenant only) → typed error.
 *
 * The platform builtin is used only once an administrator of the workspace has
 * confirmed the identity the platform shows: provider and endpoint host, provider
 * name and processing location (ai_settings builtin_accepted_key equal to the
 * platform's current builtinProviderKey). Otherwise the resolution fails with
 * builtin_not_accepted and no workspace data reaches it.
 *
 * An archived or dangling assignment falls through to the next step with a
 * structured warning (ops signal, never silent). Reads only — this service is
 * not an AI entry point and performs no quota or subscription checks.
 *
 * All lookups go through the caller's tenant-scoped EntityManager: the
 * ai_model_configs table is RLS-forced, so a manager without app.current_tenant
 * would simply see no rows.
 */
@Injectable()
export class AiModelResolverService {
  private readonly logger = new Logger(AiModelResolverService.name);

  constructor(
    @InjectRepository(AiModelConfig)
    private readonly configRepo: Repository<AiModelConfig>,
    @InjectRepository(AiSettings)
    private readonly settingsRepo: Repository<AiSettings>,
    @InjectRepository(AiAgentDefinition)
    private readonly agentRepo: Repository<AiAgentDefinition>,
    private readonly platformAiConfig: PlatformAiConfigService,
    private readonly providerRegistry: AiProviderRegistry,
    private readonly cipher: AiSecretCipherService,
  ) {}

  private configRepoFor(manager?: EntityManager) {
    return (manager ?? this.configRepo.manager).getRepository(AiModelConfig);
  }

  async resolve(
    tenantId: string,
    consumer: AiModelConsumer,
    manager?: EntityManager,
    opts?: ResolveModelOptions,
  ): Promise<ResolvedModel> {
    const assignmentId = await this.loadAssignmentId(tenantId, consumer, manager);
    return this.resolveForAssignment(tenantId, assignmentId, manager, this.describeConsumer(consumer), opts);
  }

  async tryResolve(
    tenantId: string,
    consumer: AiModelConsumer,
    manager?: EntityManager,
    opts?: ResolveModelOptions,
  ): Promise<ResolvedModel | null> {
    try {
      return await this.resolve(tenantId, consumer, manager, opts);
    } catch (error) {
      if (error instanceof AiModelResolutionError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Resolution chain starting from an explicit assignment id (already loaded by
   * the caller — e.g. validation of a settings payload not yet saved).
   */
  async resolveForAssignment(
    tenantId: string,
    assignmentId: string | null,
    manager?: EntityManager,
    consumerLabel = 'unknown',
    opts?: ResolveModelOptions,
  ): Promise<ResolvedModel> {
    const withSecrets = opts?.withSecrets !== false;
    if (assignmentId) {
      const assigned = await this.loadActiveConfig(tenantId, assignmentId, manager);
      if (assigned) {
        return this.fromConfig(assigned, withSecrets);
      }
      this.logger.warn(
        `AI model assignment ${assignmentId} for tenant ${tenantId} (consumer=${consumerLabel}) `
        + 'is archived or missing; falling back to the tenant default model.',
      );
    }

    const fallback = await this.configRepoFor(manager).findOne({
      where: { tenant_id: tenantId, is_default: true, status: 'active' },
    });
    if (fallback) {
      const withKey = await this.loadActiveConfig(tenantId, fallback.id, manager);
      if (withKey) {
        return this.fromConfig(withKey, withSecrets);
      }
    }

    if (!Features.SINGLE_TENANT) {
      const confirmationRequired = opts?.includedModelGate !== 'none';
      // One read of the platform record: the identity compared with the workspace's
      // confirmation and the runtime returned are the same record.
      const snapshot = await this.platformAiConfig.getBuiltinRuntime({ withSecrets: withSecrets && confirmationRequired });
      if (!snapshot || (confirmationRequired && !snapshot.identity)) {
        throw new AiModelResolutionError('builtin_not_configured', 'Built-in AI provider is not configured.');
      }
      if (confirmationRequired) {
        const acceptedKey = opts?.builtinAcceptedKey !== undefined
          ? opts.builtinAcceptedKey
          : await this.loadBuiltinAcceptedKey(tenantId, manager);
        if (acceptedKey !== snapshot.identity?.key) {
          throw new AiModelResolutionError('builtin_not_accepted', BUILTIN_NOT_ACCEPTED_MESSAGE);
        }
      }
      return {
        source: 'builtin',
        configId: null,
        configName: null,
        provider: snapshot.provider,
        model: snapshot.model,
        endpointUrl: snapshot.endpointUrl,
        apiKey: snapshot.apiKey,
        hasApiKey: snapshot.hasApiKey,
        // The platform-operated model is multimodal; tenants cannot configure it.
        supportsVision: true,
        priceInputEurPerMtok: 0,
        priceOutputEurPerMtok: 0,
        timeoutMs: null,
        builtinRateLimits: snapshot.rateLimits,
      };
    }

    throw new AiModelResolutionError(
      'no_model_available',
      'No AI model is configured: assign a model or define a default in the AI models registry.',
    );
  }

  /**
   * Validation errors for the model a consumer would resolve to — powers
   * chat_ready / provider_validation_errors without exposing resolution
   * internals to callers.
   */
  async validationErrors(
    tenantId: string,
    assignmentId: string | null,
    manager?: EntityManager,
    opts?: Pick<ResolveModelOptions, 'builtinAcceptedKey' | 'includedModelGate'>,
  ): Promise<string[]> {
    return (await this.readiness(tenantId, assignmentId, manager, opts)).errors;
  }

  /**
   * Validation errors plus why the chain stopped and whether it lands on the
   * included model (confirmed or not). Reads only; no secret is decrypted.
   */
  async readiness(
    tenantId: string,
    assignmentId: string | null,
    manager?: EntityManager,
    opts?: Pick<ResolveModelOptions, 'builtinAcceptedKey' | 'includedModelGate'>,
  ): Promise<AiModelReadiness> {
    const builtinIdentity = Features.SINGLE_TENANT
      ? null
      : (await this.platformAiConfig.getBuiltinRuntime())?.identity ?? null;
    let resolved: ResolvedModel;
    try {
      resolved = await this.resolveForAssignment(tenantId, assignmentId, manager, 'validation', {
        withSecrets: false,
        builtinAcceptedKey: opts?.builtinAcceptedKey,
        includedModelGate: opts?.includedModelGate,
      });
    } catch (error) {
      if (error instanceof AiModelResolutionError) {
        return {
          errors: [error.message],
          errorCode: error.code,
          usesBuiltin: error.code === 'builtin_not_accepted',
          builtinIdentity,
        };
      }
      throw error;
    }
    if (resolved.source === 'builtin') {
      return { errors: [], errorCode: null, usesBuiltin: true, builtinIdentity };
    }
    return {
      errors: this.providerRegistry.validate({
        llm_provider: resolved.provider,
        llm_model: resolved.model,
        llm_endpoint_url: resolved.endpointUrl,
        has_llm_api_key: resolved.hasApiKey,
      }),
      errorCode: null,
      usesBuiltin: false,
      builtinIdentity,
    };
  }

  private describeConsumer(consumer: AiModelConsumer): string {
    return consumer.type === 'agent' ? `agent:${consumer.agentId}` : 'chat';
  }

  private async loadAssignmentId(
    tenantId: string,
    consumer: AiModelConsumer,
    manager?: EntityManager,
  ): Promise<string | null> {
    if (consumer.type === 'chat') {
      const settings = await (manager ?? this.settingsRepo.manager)
        .getRepository(AiSettings)
        .findOne({ where: { tenant_id: tenantId } });
      return settings?.chat_model_config_id ?? null;
    }
    const definition = await (manager ?? this.agentRepo.manager)
      .getRepository(AiAgentDefinition)
      .findOne({ where: { id: consumer.agentId, tenant_id: tenantId } });
    return definition?.llm_model_config_id ?? null;
  }

  private async loadBuiltinAcceptedKey(tenantId: string, manager?: EntityManager): Promise<string | null> {
    const settings = await (manager ?? this.settingsRepo.manager)
      .getRepository(AiSettings)
      .findOne({ where: { tenant_id: tenantId } });
    return settings?.builtin_accepted_key ?? null;
  }

  private async loadActiveConfig(
    tenantId: string,
    configId: string,
    manager?: EntityManager,
  ): Promise<AiModelConfig | null> {
    return this.configRepoFor(manager)
      .createQueryBuilder('config')
      .addSelect('config.api_key_encrypted')
      .where('config.id = :configId', { configId })
      .andWhere('config.tenant_id = :tenantId', { tenantId })
      .andWhere('config.status = :status', { status: 'active' })
      .getOne();
  }

  private fromConfig(config: AiModelConfig, withSecrets: boolean): ResolvedModel {
    return {
      source: 'registry',
      configId: config.id,
      configName: config.name,
      provider: config.provider,
      model: config.model,
      endpointUrl: config.endpoint_url,
      apiKey: withSecrets && config.api_key_encrypted ? this.cipher.decrypt(config.api_key_encrypted) : null,
      hasApiKey: !!config.api_key_encrypted,
      supportsVision: config.supports_vision !== false,
      priceInputEurPerMtok: parsePriceEurPerMtok(config.price_input_eur_per_mtok),
      priceOutputEurPerMtok: parsePriceEurPerMtok(config.price_output_eur_per_mtok),
      timeoutMs: config.llm_timeout_ms ?? null,
      builtinRateLimits: null,
    };
  }
}
