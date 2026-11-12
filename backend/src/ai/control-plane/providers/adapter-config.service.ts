import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiExecutionContextWithManager } from '../../ai.types';
import { AiAdapterConfig } from './adapter-config.entity';
import {
  AdapterHealthResult,
  CapabilityApplicability,
  ProviderCredentialRef,
  ProviderKind,
} from './provider.types';

const SECRET_KEY_RE = /(api[-_]?key|token|secret|password|authorization|cookie|session|client_secret)/i;
const SECRET_VALUE_RE = /\b(Bearer\s+[A-Za-z0-9._~+/=-]{12,}|(?:password|token|secret|api[-_]?key)\s*[:=]\s*[^ \n\r\t]+)/i;
const VALID_CREDENTIAL_KINDS = new Set(['none', 'secret_ref', 'environment', 'encrypted']);

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function containsPlaintextSecret(value: unknown): boolean {
  if (typeof value === 'string') {
    return SECRET_VALUE_RE.test(value);
  }
  if (!value || typeof value !== 'object') {
    return false;
  }
  if (Array.isArray(value)) {
    return value.some((entry) => containsPlaintextSecret(entry));
  }
  return Object.entries(value as Record<string, unknown>).some(([key, entry]) => {
    if (SECRET_KEY_RE.test(key) && key !== 'ref' && key !== 'secret_ref') {
      return true;
    }
    return containsPlaintextSecret(entry);
  });
}

export function parseCredentialRef(value: unknown): ProviderCredentialRef | null {
  if (value == null) {
    return null;
  }
  const object = asRecord(value);
  if (!object) {
    return null;
  }
  const kind = object.kind;
  if (typeof kind !== 'string' || !VALID_CREDENTIAL_KINDS.has(kind)) {
    return null;
  }
  if (kind === 'none') {
    return { kind: 'none' };
  }
  if (kind === 'encrypted') {
    // AES-256-GCM envelope (versioned, base64url segments) — not plaintext, so
    // the plaintext heuristics above stay focused on the other ref kinds.
    const ciphertext = object.ciphertext;
    if (typeof ciphertext !== 'string' || ciphertext.trim().length === 0) {
      return null;
    }
    const materialShape = object.material_shape;
    return {
      kind: 'encrypted',
      ciphertext: ciphertext.trim(),
      material_shape: typeof materialShape === 'string' && materialShape.trim().length > 0
        ? materialShape.trim()
        : null,
    };
  }
  const ref = object.ref;
  if (typeof ref !== 'string' || ref.trim().length === 0) {
    return null;
  }
  if (kind === 'environment') {
    return {
      kind: 'environment',
      ref: ref.trim(),
      tenant_id: typeof object.tenant_id === 'string' && object.tenant_id.trim().length > 0
        ? object.tenant_id.trim()
        : null,
    };
  }
  const version = object.version;
  return {
    kind: 'secret_ref',
    ref: ref.trim(),
    version: typeof version === 'string' && version.trim().length > 0 ? version.trim() : null,
    tenant_id: typeof object.tenant_id === 'string' && object.tenant_id.trim().length > 0
      ? object.tenant_id.trim()
      : null,
  };
}

function structuredUnavailable(
  reasonCode: NonNullable<CapabilityApplicability['reasonCode']>,
  message: string,
): CapabilityApplicability {
  return { available: false, reasonCode, message };
}

@Injectable()
export class AiAdapterConfigService {
  constructor(
    @InjectRepository(AiAdapterConfig)
    private readonly adapterConfigRepo: Repository<AiAdapterConfig>,
  ) {}

  private repository(context: AiExecutionContextWithManager): Repository<AiAdapterConfig> {
    return context.manager.getRepository(AiAdapterConfig);
  }

  /**
   * `forUpdate` locks the row until the request's transaction ends: a save reads it that
   * way, so a save running at the same time waits and then reads what this one wrote,
   * instead of writing its stale address or credential back.
   */
  async getConfig(
    context: AiExecutionContextWithManager,
    providerKind: ProviderKind,
    providerKey = 'default',
    opts?: { forUpdate?: boolean },
  ): Promise<AiAdapterConfig | null> {
    return this.repository(context).findOne({
      where: {
        tenant_id: context.tenantId,
        provider_kind: providerKind,
        provider_key: providerKey,
      },
      ...(opts?.forUpdate ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
  }

  validateConfig(config: Pick<AiAdapterConfig, 'implementation' | 'credential_ref_json' | 'enabled'>): CapabilityApplicability {
    if (!config.enabled) {
      return structuredUnavailable('provider_disabled', 'Adapter configuration is disabled.');
    }
    if (containsPlaintextSecret(config.credential_ref_json)) {
      return structuredUnavailable('malformed_config', 'Adapter configuration contains plaintext-looking secret fields.');
    }
    const credential = parseCredentialRef(config.credential_ref_json);
    if (config.implementation !== 'mock' && !credential) {
      return structuredUnavailable('missing_credentials', 'Adapter configuration is missing a credential reference.');
    }
    if (credential && credential.kind === 'none' && config.implementation !== 'mock') {
      return structuredUnavailable('missing_credentials', 'Non-mock adapters require a credential reference.');
    }
    return { available: true };
  }

  async getApplicability(
    context: AiExecutionContextWithManager,
    providerKind: ProviderKind,
    providerKey = 'default',
  ): Promise<CapabilityApplicability> {
    const config = await this.getConfig(context, providerKind, providerKey);
    if (!config) {
      return structuredUnavailable('provider_not_configured', 'Adapter configuration was not found for this tenant.');
    }
    return this.validateConfig(config);
  }

  async getHealth(
    context: AiExecutionContextWithManager,
    providerKind: ProviderKind,
    providerKey = 'default',
  ): Promise<AdapterHealthResult> {
    const checkedAt = new Date().toISOString();
    const config = await this.getConfig(context, providerKind, providerKey);
    if (!config) {
      return {
        ok: false,
        providerKind,
        providerKey,
        checkedAt,
        errorCode: 'not_configured',
        message: 'Adapter configuration was not found for this tenant.',
        retryable: false,
      };
    }
    const applicability = this.validateConfig(config);
    if (!applicability.available) {
      return {
        ok: false,
        providerKind,
        providerKey,
        implementation: config.implementation,
        environment: config.environment,
        checkedAt,
        errorCode: applicability.reasonCode === 'provider_disabled'
          ? 'disabled'
          : applicability.reasonCode === 'malformed_config'
            ? 'malformed_config'
            : 'missing_credentials',
        message: applicability.message,
        retryable: false,
      };
    }
    return {
      ok: true,
      providerKind,
      providerKey,
      implementation: config.implementation,
      environment: config.environment,
      checkedAt,
      warnings: config.implementation === 'mock' ? ['mock_adapter'] : [],
    };
  }

  async saveConfig(
    context: AiExecutionContextWithManager,
    input: Omit<Partial<AiAdapterConfig>, 'tenant_id'> & {
      provider_kind: ProviderKind;
      provider_key: string;
      implementation: string;
      environment: string;
    },
  ): Promise<AiAdapterConfig> {
    const candidate = {
      enabled: input.enabled ?? true,
      implementation: input.implementation,
      credential_ref_json: input.credential_ref_json ?? null,
    };
    const applicability = this.validateConfig(candidate);
    if (!applicability.available && applicability.reasonCode === 'malformed_config') {
      throw new BadRequestException(applicability.message);
    }
    const repo = this.repository(context);
    const existing = await this.getConfig(context, input.provider_kind, input.provider_key, { forUpdate: true });
    const entity = repo.create({
      ...(existing ?? {}),
      ...input,
      tenant_id: context.tenantId,
      enabled: input.enabled ?? existing?.enabled ?? true,
      live_test_safety: input.live_test_safety ?? existing?.live_test_safety ?? 'mock_only',
      updated_at: new Date(),
      created_at: existing?.created_at ?? new Date(),
    });
    return repo.save(entity);
  }
}
