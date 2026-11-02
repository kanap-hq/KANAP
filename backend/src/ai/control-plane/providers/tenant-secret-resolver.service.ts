import { createHash } from 'node:crypto';
import { BadRequestException, Injectable, Optional } from '@nestjs/common';
import { AiSecretCipherService } from '../../ai-secret-cipher.service';
import { AiExecutionContextWithManager } from '../../ai.types';
import { parseCredentialRef } from './adapter-config.service';
import { ProviderCredentialRef } from './provider.types';
import { codedForbidden, requestContextMissing } from '../../../auth/module-right-required';

const ENV_REF_RE = /^[A-Z][A-Z0-9_]{1,127}$/;
const SECRET_REF_RE = /^[A-Za-z0-9][A-Za-z0-9_./:@-]{0,255}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_KEY_RE = /(api[-_]?key|token|secret|password|authorization|cookie|session|client_secret|credential)/i;
const SECRET_VALUE_RE = /\b(Bearer\s+[A-Za-z0-9._~+/=-]{12,}|(?:password|token|secret|api[-_]?key)\s*[:=]\s*[^ \n\r\t]+)/i;
const BANNED_REF_VALUES = new Set(['', '*', 'all', 'any', 'none', 'null', 'undefined']);

export type TenantSecretDescriptor = {
  kind: ProviderCredentialRef['kind'];
  resolved: boolean;
  ref_hash?: string;
  version_hash?: string | null;
  source: 'none' | 'environment' | 'secret_ref' | 'encrypted';
};

export class AiResolvedTenantSecret {
  readonly descriptor: TenantSecretDescriptor;
  #secretMaterial: string | null;

  constructor(descriptor: TenantSecretDescriptor, secretMaterial: string | null) {
    this.descriptor = Object.freeze({ ...descriptor });
    this.#secretMaterial = secretMaterial;
  }

  hasSecret(): boolean {
    return this.#secretMaterial != null;
  }

  reveal(): string {
    if (this.#secretMaterial == null) {
      throw codedForbidden('AGENT_CREDENTIAL_UNAVAILABLE', 'Credential reference did not resolve to secret material.');
    }
    return this.#secretMaterial;
  }

  toJSON(): TenantSecretDescriptor {
    return this.descriptor;
  }
}

export function tenantSecretRefEnvName(input: {
  tenantId: string;
  ref: string;
  version?: string | null;
}): string {
  const digest = createHash('sha256')
    .update(`${input.tenantId}:${input.ref}:${input.version ?? ''}`)
    .digest('hex')
    .slice(0, 32)
    .toUpperCase();
  return `KANAP_SECRET_REF_${digest}`;
}

export function tenantEnvironmentSecretEnvPrefix(tenantId: string): string {
  const digest = createHash('sha256')
    .update(tenantId)
    .digest('hex')
    .slice(0, 16)
    .toUpperCase();
  return `KANAP_TENANT_${digest}_`;
}

export function tenantEnvironmentSecretEnvName(input: {
  tenantId: string;
  key: string;
}): string {
  const key = input.key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  if (!key || BANNED_REF_VALUES.has(key.toLowerCase()) || SECRET_VALUE_RE.test(key)) {
    throw new BadRequestException('Tenant environment credential key is malformed.');
  }
  return `${tenantEnvironmentSecretEnvPrefix(input.tenantId)}${key.slice(0, 96)}`;
}

function hashRef(value: string | null | undefined): string | null {
  if (!value) {
    return null;
  }
  return createHash('sha256').update(value).digest('hex');
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(value: unknown, field: string): string | null {
  const record = asRecord(value);
  const raw = record?.[field];
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
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

function assertTenantScopedRef(context: AiExecutionContextWithManager, rawRef: unknown, ref: ProviderCredentialRef): void {
  const rawTenantId = stringField(rawRef, 'tenant_id') ?? stringField(rawRef, 'tenantId') ?? ('tenant_id' in ref ? ref.tenant_id ?? null : null);
  if (ref.kind === 'environment' && !rawTenantId) {
    throw codedForbidden('AGENT_CREDENTIAL_UNAVAILABLE', 'Environment credential references must include a tenant_id.');
  }
  if (rawTenantId && rawTenantId !== context.tenantId) {
    throw codedForbidden('AGENT_CREDENTIAL_UNAVAILABLE', 'Credential reference belongs to a different tenant.');
  }
  if (ref.kind === 'environment' && !ref.ref.startsWith(tenantEnvironmentSecretEnvPrefix(context.tenantId))) {
    throw codedForbidden('AGENT_CREDENTIAL_UNAVAILABLE', 'Environment credential reference is not tenant-owned.');
  }
  if (ref.kind !== 'secret_ref') {
    return;
  }
  const slashMatch = ref.ref.match(/^tenant\/([^/]+)\//);
  const colonMatch = ref.ref.match(/^tenant:([^:]+):/);
  const embeddedTenant = slashMatch?.[1] ?? colonMatch?.[1] ?? null;
  if (embeddedTenant && embeddedTenant !== context.tenantId) {
    throw codedForbidden('AGENT_CREDENTIAL_UNAVAILABLE', 'Credential reference belongs to a different tenant.');
  }
}

function assertReferenceValueSafe(kind: ProviderCredentialRef['kind'], ref: string): void {
  const normalized = ref.trim();
  if (BANNED_REF_VALUES.has(normalized.toLowerCase())) {
    throw new BadRequestException('Credential reference is empty or broad.');
  }
  if (SECRET_VALUE_RE.test(normalized)) {
    throw new BadRequestException('Credential reference looks like plaintext secret material.');
  }
  if (kind === 'environment' && !ENV_REF_RE.test(normalized)) {
    throw new BadRequestException('Environment credential references must name an environment variable.');
  }
  if (kind === 'secret_ref' && !SECRET_REF_RE.test(normalized)) {
    throw new BadRequestException('Secret manager credential reference is malformed.');
  }
}

@Injectable()
export class AiTenantSecretResolverService {
  // Optional so lightweight instantiations (specs, non-Nest harnesses) keep
  // working; without a cipher the 'encrypted' kind fails closed exactly like
  // an unset environment reference.
  constructor(@Optional() private readonly cipher?: AiSecretCipherService) {}

  resolve(
    context: AiExecutionContextWithManager,
    rawRef: unknown,
    env: Record<string, string | undefined> = process.env,
  ): AiResolvedTenantSecret {
    if (!context?.tenantId) {
      throw requestContextMissing('Tenant context is required for credential resolution.');
    }
    if (rawRef == null) {
      throw new BadRequestException('Credential reference is missing.');
    }
    if (containsPlaintextSecret(rawRef)) {
      throw new BadRequestException('Credential reference contains plaintext-looking secret material.');
    }
    const parsed = parseCredentialRef(rawRef);
    if (!parsed) {
      throw new BadRequestException('Credential reference is malformed or unsupported.');
    }
    if (parsed.kind === 'environment' || parsed.kind === 'secret_ref') {
      assertReferenceValueSafe(parsed.kind, parsed.ref);
    }
    assertTenantScopedRef(context, rawRef, parsed);
    if (parsed.kind === 'none') {
      return new AiResolvedTenantSecret({
        kind: 'none',
        resolved: false,
        source: 'none',
      }, null);
    }
    if (parsed.kind === 'encrypted') {
      // Cipher unavailable or decrypt failure behaves exactly like an unset
      // environment variable: a structured missing-credential Forbidden, and
      // never a throw that carries material or ciphertext.
      if (!this.cipher?.canEncrypt()) {
        throw codedForbidden('CREDENTIAL_STORAGE_NOT_CONFIGURED', 'Encrypted credential storage is not configured on this instance.');
      }
      let material: string | null = null;
      try {
        material = this.cipher.decrypt(parsed.ciphertext);
      } catch {
        material = null;
      }
      if (typeof material !== 'string' || material.length === 0) {
        throw codedForbidden('AGENT_CREDENTIAL_UNAVAILABLE', 'Stored encrypted credential could not be decrypted.');
      }
      return new AiResolvedTenantSecret({
        kind: 'encrypted',
        resolved: true,
        ref_hash: hashRef(parsed.ciphertext) ?? undefined,
        source: 'encrypted',
      }, material);
    }
    if (parsed.kind === 'environment') {
      const value = env[parsed.ref];
      if (typeof value !== 'string' || value.length === 0) {
        throw codedForbidden('AGENT_CREDENTIAL_UNAVAILABLE', 'Environment credential reference is not configured.');
      }
      return new AiResolvedTenantSecret({
        kind: 'environment',
        resolved: true,
        ref_hash: hashRef(parsed.ref) ?? undefined,
        source: 'environment',
      }, value);
    }

    const envName = tenantSecretRefEnvName({
      tenantId: context.tenantId,
      ref: parsed.ref,
      version: parsed.version ?? null,
    });
    const value = env[envName];
    if (typeof value !== 'string' || value.length === 0) {
      throw codedForbidden('AGENT_NOT_AVAILABLE_YET', `Secret manager reference is not available through the local Phase 8 resolver (${envName}).`);
    }
    return new AiResolvedTenantSecret({
      kind: 'secret_ref',
      resolved: true,
      ref_hash: hashRef(parsed.ref) ?? undefined,
      version_hash: hashRef(parsed.version ?? null),
      source: 'secret_ref',
    }, value);
  }
}
